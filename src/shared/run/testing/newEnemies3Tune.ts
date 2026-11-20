/**
 * Test support for specs (never imported by the game): docs/NEW_ENEMIES_3.md NT12-lite, the Mortar, the Mender and the
 * Jackal measured (no retune). Three harnesses, one per-tick observer:
 *   Nt12Observer  what the three do in any run, read after each step: hits taken (all, and by source kind from
 *                 SimEvents.lastHitSource), shells fired and hits from the Mortar (the strike or its shrapnel), heals,
 *                 beam cuts, channels started, every Mender's heal total (v[MENDER_HEALED], its own life's), lunges,
 *                 spooks, hits from Jackals, guard stops (staggers), and each kind's actors seen.
 *   nt12Fight     characterTune.ts's arena fight (open arena, god mode, the AR13 fighter: the Knight's sword with its
 *                 guard and rolls, the Archer's charged shots and stream) at a floor's hp, observed.
 *   nt12Drill     a passive bot in that arena (never attacks; hearts refilled): `stand`, `strafe` (side to side at
 *                 full speed, turning every STRAFE_TICKS), `wander` (a seeded random 8-way walk held 20-60 ticks) for
 *                 the shells on a moving target; `watch` (faces the nearest Jackal) / `fixed` (never turns) / `guard`
 *                 (watch, plus the sword's guard pressed when a Jackal lunges) for the pack's hits.
 *   nt12Survival  survivalBot.ts's honest descent on real floors with the hearts topped up (immortal), observed, and
 *                 each room fight's ticks against its par (buildDeferredScoreRooms' par: base + 90 ticks per cost + per
 *                 affixed spawn), classified by the new kinds it planned.
 *
 * @module
 */
import { AffixKind, encounterCost } from "shared/dungeon";
import {
	AFFIX_PAR_COST,
	Button,
	EMPTY_INPUT,
	JACKAL,
	JACKAL_LUNGE,
	JACKAL_STAGGER,
	MENDER,
	MENDER_CHANNEL,
	MENDER_HEALED,
	MORTAR,
	NO_KIND,
	ROOM_PAR_BASE_TICKS,
	ROOM_PAR_TICKS_PER_COST,
	Rng,
	SIM_HZ,
	SimCtx,
	archetypeIndex,
	createSimState,
	engage,
	simWorldConfig,
	spawnActor,
	step,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig } from "../endless";
import { anyLiving, arenaConfig, nearestLiving, type TuneFight, type TuneFloor } from "./buildTune";
import {
	arenaEnv,
	characterConfig,
	fighterFrame,
	fighterModeOf,
	newFighterMemory,
	type TuneCharacter,
} from "./characterTune";
import { frame } from "./endlessBot";
import { survivalRun } from "./survivalBot";

export const NT12_KINDS = ["mortar", "mender", "jackal"] as const;

/** What the three did in a run (file comment). */
export interface Nt12Tally {
	/** Seconds to the clear (-1: not cleared within the cap; a drill: its length). */
	seconds: number;
	hits: number;
	/** Per NT12_KINDS entry: hits whose source was that kind. */
	hitsBy: number[];
	shells: number;
	heals: number;
	cuts: number;
	channels: number;
	/** Menders seen, and the sum of their lives' heals (each Mender's v[MENDER_HEALED] at its death or the end). */
	menders: number;
	menderHealed: number;
	lunges: number;
	spooks: number;
	staggers: number;
	/** Per NT12_KINDS entry: actors seen. */
	count: number[];
}

export function emptyNt12Tally(): Nt12Tally {
	return {
		seconds: -1,
		hits: 0,
		hitsBy: NT12_KINDS.map(() => 0),
		shells: 0,
		heals: 0,
		cuts: 0,
		channels: 0,
		menders: 0,
		menderHealed: 0,
		lunges: 0,
		spooks: 0,
		staggers: 0,
		count: NT12_KINDS.map(() => 0),
	};
}

/** The per-tick observer (file comment); `finish` closes the Menders' heal totals. */
export class Nt12Observer {
	readonly t = emptyNt12Tally();
	private readonly kinds = NT12_KINDS.map((k) => archetypeIndex(k));
	private readonly menderKind = archetypeIndex(MENDER.id);
	private readonly jackalKind = archetypeIndex(JACKAL.id);
	/** Per actor id seen: its kind index into NT12_KINDS. */
	private readonly seen = new Map<number, number>();
	/** Per Mender id: its latest v[MENDER_HEALED]. */
	private readonly healed = new Map<number, number>();
	/** Per slot: the last state of a Jackal / Mender there, and its id. */
	private readonly lastState = new Map<number, number>();
	private readonly lastId = new Map<number, number>();

	observe(s: Readonly<SimState>): void {
		const t = this.t;
		const e = s.events;
		t.hits += e.playerHits;
		if (e.playerHits > 0 && e.lastHitSource >= 0) {
			const k = this.kinds.indexOf(e.lastHitSource);
			if (k >= 0) t.hitsBy[k] += e.playerHits;
		}
		t.shells += e.shells;
		t.heals += e.heals;
		t.cuts += e.healCuts;
		t.lunges += e.lunges;
		t.spooks += e.spooks;
		const actors = s.combat.actors;
		for (let slot = 0; slot < actors.size(); slot++) {
			const a = actors[slot];
			if (a.kind === NO_KIND) continue;
			const k = this.kinds.indexOf(a.kind);
			if (k < 0) continue;
			if (!this.seen.has(a.id)) {
				this.seen.set(a.id, k);
				t.count[k]++;
			}
			if (a.kind === this.menderKind) this.healed.set(a.id, a.v[MENDER_HEALED]);
			const same = this.lastId.get(slot) === a.id;
			const before = same ? this.lastState.get(slot) : undefined;
			if (a.alive !== 0) {
				if (a.kind === this.menderKind && a.aiState === MENDER_CHANNEL && before !== MENDER_CHANNEL)
					t.channels++;
				if (a.kind === this.jackalKind && a.aiState === JACKAL_STAGGER && before !== JACKAL_STAGGER)
					t.staggers++;
			}
			this.lastId.set(slot, a.id);
			this.lastState.set(slot, a.aiState);
		}
	}

	finish(seconds: number): Nt12Tally {
		const t = this.t;
		t.seconds = seconds;
		t.menders = 0;
		t.menderHealed = 0;
		for (const [, h] of this.healed) {
			t.menders++;
			t.menderHealed += h;
		}
		return t;
	}
}

function spawnAll(s: SimState, config: SimConfig, fight: TuneFight): void {
	const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
	for (const sp of fight.spawns) {
		if (spawnActor(ctx, archetypeIndex(sp.kind), sp.x, sp.z, sp.affix) === undefined)
			error(`nt12: could not spawn ${sp.kind}`, 0);
	}
}

/** One arena fight of `who` at floor `f`'s hp (file comment, nt12Fight); no build. */
export function nt12Fight(fight: TuneFight, who: TuneCharacter, f: TuneFloor, seed: number): Nt12Tally {
	const weapon = who === "archer" ? "weapon.bow" : "weapon.sword";
	const config = characterConfig(arenaConfig(seed, weapon, fight), who);
	const s = createSimState(seed, fight.startX, fight.startZ, config);
	s.endless!.floor = f.floor;
	s.endless!.depth = f.depth;
	spawnAll(s, config, fight);
	const obs = new Nt12Observer();
	const env = arenaEnv(fight.half);
	const mem = newFighterMemory();
	const maxTicks = fight.maxSeconds * SIM_HZ;
	for (let n = 0; n < maxTicks; n++) {
		step(s, fighterFrame(s, fighterModeOf(who), nearestLiving(s, s.player), env, mem), config);
		s.player.hearts = s.player.heartsMax;
		obs.observe(s);
		if (!anyLiving(s)) return obs.finish((n + 1) / SIM_HZ);
	}
	return obs.finish(-1);
}

/** The passive bots of nt12Drill (file comment). */
export type Nt12Bot = "stand" | "strafe" | "wander" | "watch" | "fixed" | "guard";

/** The strafe bot turns every this many ticks; the wander bot holds a direction 20-60 ticks. */
export const STRAFE_TICKS = 60;
const WANDER_MIN = 20;
const WANDER_MAX = 60;
const AXIS = 1;

/** One passive drill of `seconds` in an arena holding `fight`'s spawns (the Knight's sword, floor `f`'s hp). */
export function nt12Drill(fight: TuneFight, bot: Nt12Bot, f: TuneFloor, seed: number, seconds: number): Nt12Tally {
	const config = characterConfig(arenaConfig(seed, "weapon.sword", fight), "knight");
	const s = createSimState(seed, fight.startX, fight.startZ, config);
	s.endless!.floor = f.floor;
	s.endless!.depth = f.depth;
	spawnAll(s, config, fight);
	// Engaged from the start (a drill has no walk-in), so every kind acts within seconds.
	for (const a of s.combat.actors) if (a.kind !== NO_KIND) engage(a);
	const obs = new Nt12Observer();
	const rng = new Rng(seed * 31 + 7);
	let hold = 0;
	let wx = 0;
	let wz = 0;
	let pressed = false;
	const jackalKind = archetypeIndex(JACKAL.id);
	const ticks = seconds * SIM_HZ;
	for (let n = 0; n < ticks; n++) {
		const p = s.player;
		let input: InputFrame = frame(0, 0, 0, 0, 1);
		if (bot === "strafe") {
			const dir = math.floor(n / STRAFE_TICKS) % 2 === 0 ? AXIS : -AXIS;
			input = frame(dir, 0, 0, 0, 1);
		} else if (bot === "wander") {
			if (hold <= 0) {
				hold = rng.int(WANDER_MIN, WANDER_MAX);
				wx = rng.int(-1, 1);
				wz = rng.int(-1, 1);
				// Keep inside the arena: turn back toward the centre near its edge.
				if (math.abs(p.x) > fight.half - 3) wx = p.x > 0 ? -1 : 1;
				if (math.abs(p.z) > fight.half - 3) wz = p.z > 0 ? -1 : 1;
			}
			hold--;
			input = frame(wx, wz, 0, 0, 1);
		} else if (bot === "watch" || bot === "guard") {
			let best: ActorState | undefined;
			let bd = math.huge;
			let lunging = false;
			for (const a of s.combat.actors) {
				if (a.kind !== jackalKind || a.alive === 0) continue;
				const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
				if (a.aiState === JACKAL_LUNGE) lunging = true;
				if (d < bd) {
					bd = d;
					best = a;
				}
			}
			const d = math.sqrt(bd);
			const ax = best !== undefined && d > 1e-9 ? (best.x - p.x) / d : 0;
			const az = best !== undefined && d > 1e-9 ? (best.z - p.z) / d : 1;
			const press: boolean = bot === "guard" && lunging && !pressed;
			pressed = press;
			input = frame(0, 0, press ? Button.ALT : 0, ax, az);
		}
		step(s, input, config);
		s.player.hearts = s.player.heartsMax;
		obs.observe(s);
	}
	return obs.finish(seconds);
}

/** A synthetic room ahead of the player (newEnemies2Tune.ts nx12Room's shape). */
export function nt12Room(
	label: string,
	spawns: ReadonlyArray<readonly [string, number, number]>,
	maxSeconds = 180,
	half = 12,
): TuneFight {
	return {
		label,
		spawns: spawns.map(([kind, x, z]) => ({ kind, x, z, affix: AffixKind.NONE })),
		half,
		startX: 0,
		startZ: 0,
		boss: false,
		maxSeconds,
	};
}

/** The NT12 per-kind rooms: each new kind at its cap, the Mender with allies, the pack, and baselines. */
export const NT12_ROOMS: ReadonlyArray<TuneFight> = [
	nt12Room("2 mortar", [
		[MORTAR.id, -3, 8],
		[MORTAR.id, 3, 8],
	]),
	nt12Room("mender + 2 bruiser", [
		[MENDER.id, 0, 8],
		["bruiser", -2, 6],
		["bruiser", 2, 6],
	]),
	nt12Room("2 bruiser (baseline)", [
		["bruiser", -2, 6],
		["bruiser", 2, 6],
	]),
	nt12Room("jackal pack", [
		[JACKAL.id, -1.5, 6],
		[JACKAL.id, 0, 6.5],
		[JACKAL.id, 1.5, 6],
	]),
	nt12Room("3 swarmer (baseline)", [
		["swarmer", -1.5, 6],
		["swarmer", 0, 6.5],
		["swarmer", 1.5, 6],
	]),
	nt12Room("mortar + mender + pack", [
		[MORTAR.id, -3, 8],
		[MENDER.id, 2, 8],
		[JACKAL.id, -1.5, 5],
		[JACKAL.id, 0, 5.5],
		[JACKAL.id, 1.5, 5],
	]),
];

/** The drills: one Mortar 8 ahead (the shells on a moving target), and a pack of three 5 ahead (the pack's hits). */
export const NT12_MORTAR_DRILL: TuneFight = nt12Room("mortar drill", [[MORTAR.id, 0, 8]], 60, 14);
export const NT12_JACKAL_DRILL: TuneFight = nt12Room(
	"jackal drill",
	[
		[JACKAL.id, -1.5, 5],
		[JACKAL.id, 0, 5.5],
		[JACKAL.id, 1.5, 5],
	],
	60,
	14,
);

/** Means of `n` tallies (seconds: -1 if any fight timed out; the rest summed / n). */
export function meanNt12(ts: ReadonlyArray<Nt12Tally>): Nt12Tally {
	const m = emptyNt12Tally();
	const n = ts.size();
	let failed = false;
	let sec = 0;
	for (const t of ts) {
		if (t.seconds < 0) failed = true;
		sec += t.seconds;
		m.hits += t.hits / n;
		for (let k = 0; k < NT12_KINDS.size(); k++) {
			m.hitsBy[k] += t.hitsBy[k] / n;
			m.count[k] += t.count[k] / n;
		}
		m.shells += t.shells / n;
		m.heals += t.heals / n;
		m.cuts += t.cuts / n;
		m.channels += t.channels / n;
		m.menders += t.menders / n;
		m.menderHealed += t.menderHealed / n;
		m.lunges += t.lunges / n;
		m.spooks += t.spooks / n;
		m.staggers += t.staggers / n;
	}
	m.seconds = failed ? -1 : sec / n;
	return m;
}

const f1 = (x: number) => string.format("%.1f", x);
const f2 = (x: number) => string.format("%.2f", x);

export function nt12Header(): string {
	return (
		"| room | who | s | hits (mortar / mender / jackal) | shells, hits a shell | heals, per Mender life, " +
		"channels / cuts | lunges / spooks / staggers, hits a lunge |"
	);
}

/** One Markdown row of a tally. */
export function formatNt12Row(label: string, who: string, t: Nt12Tally): string {
	const perShell = t.shells > 0 ? f2(t.hitsBy[0] / t.shells) : "-";
	const perLife = t.menders > 0 ? f1(t.menderHealed / t.menders) : "-";
	const perLunge = t.lunges > 0 ? f2(t.hitsBy[2] / t.lunges) : "-";
	return (
		`| ${label} | ${who} | ${t.seconds < 0 ? "t/o" : f1(t.seconds)} | ${f1(t.hits)} (${f1(t.hitsBy[0])} / ` +
		`${f1(t.hitsBy[1])} / ${f1(t.hitsBy[2])}) | ${f1(t.shells)}, ${perShell} | ${f1(t.heals)}, ${perLife}, ` +
		`${f1(t.channels)} / ${f1(t.cuts)} | ${f1(t.lunges)} / ${f1(t.spooks)} / ${f1(t.staggers)}, ${perLunge} |`
	);
}

// ---------------------------------------------------------------------------------------------
// Real floors

/** Room fights on real floors, by the new kinds their room planned. */
export interface Nt12RoomClass {
	readonly label: string;
	rooms: number;
	cleared: number;
	/** Sums over the cleared rooms: fight ticks, par ticks; and rooms cleared under par. */
	ticks: number;
	par: number;
	underPar: number;
	hits: number;
}

/** One real-floor survival run per seed (file comment), observed, its rooms against par. */
export interface Nt12Survival {
	readonly tally: Nt12Tally;
	readonly classes: ReadonlyArray<Nt12RoomClass>;
	readonly floorReached: number;
}

/** Room classes: none of the three, then each kind (a room with two of them counts in both). */
export const NT12_ROOM_CLASSES = ["none of the three", "with a Mortar", "with a Mender", "with a Jackal pack"] as const;

export function nt12Survival(seed: number, who: TuneCharacter, maxFloor: number): Nt12Survival {
	const obs = new Nt12Observer();
	const run = survivalRun(seed, who, { maxFloor, immortal: true, onStep: (s) => obs.observe(s) });
	const setup =
		who === "both" ? buildEndlessRunConfig(seed, 1) : buildEndlessRunConfig(seed, 1, { characters: [who] });
	const classes: Nt12RoomClass[] = NT12_ROOM_CLASSES.map((label) => ({
		label,
		rooms: 0,
		cleared: 0,
		ticks: 0,
		par: 0,
		underPar: 0,
		hits: 0,
	}));
	for (const r of run.rooms) {
		const w = setup.endlessFloor(r.floor);
		const spawns = w.roomSpawns[r.room];
		const affixes = w.roomAffixes?.[r.room];
		let par = ROOM_PAR_BASE_TICKS;
		const has = [false, false, false];
		for (let i = 0; i < spawns.size(); i++) {
			par += ROOM_PAR_TICKS_PER_COST * encounterCost(spawns[i].kind);
			const affix = affixes?.[i];
			if (affix !== undefined && affix !== AffixKind.NONE) par += ROOM_PAR_TICKS_PER_COST * AFFIX_PAR_COST;
			const k = (NT12_KINDS as ReadonlyArray<string>).indexOf(spawns[i].kind);
			if (k >= 0) has[k] = true;
		}
		const into: number[] = [];
		if (!has[0] && !has[1] && !has[2]) into.push(0);
		for (let k = 0; k < 3; k++) if (has[k]) into.push(k + 1);
		for (const c of into) {
			const cl = classes[c];
			cl.rooms++;
			cl.hits += r.hits;
			if (!r.cleared) continue;
			cl.cleared++;
			cl.ticks += r.ticks;
			cl.par += par;
			if (r.ticks < par) cl.underPar++;
		}
	}
	return { tally: obs.finish(run.ticks / SIM_HZ), classes, floorReached: run.floorReached };
}

/** Merges the classes of several runs. */
export function mergeNt12Classes(runs: ReadonlyArray<Nt12Survival>): Nt12RoomClass[] {
	const out: Nt12RoomClass[] = NT12_ROOM_CLASSES.map((label) => ({
		label,
		rooms: 0,
		cleared: 0,
		ticks: 0,
		par: 0,
		underPar: 0,
		hits: 0,
	}));
	for (const r of runs) {
		for (let c = 0; c < out.size(); c++) {
			const a = out[c];
			const b = r.classes[c];
			a.rooms += b.rooms;
			a.cleared += b.cleared;
			a.ticks += b.ticks;
			a.par += b.par;
			a.underPar += b.underPar;
			a.hits += b.hits;
		}
	}
	return out;
}

export function formatNt12Class(who: string, c: Nt12RoomClass): string {
	const share = c.cleared > 0 ? f2(c.ticks / c.par) : "-";
	const mean = c.cleared > 0 ? f1(c.ticks / c.cleared / SIM_HZ) : "-";
	const par = c.cleared > 0 ? f1(c.par / c.cleared / SIM_HZ) : "-";
	return (
		`| ${c.label} | ${who} | ${c.rooms} | ${c.cleared} | ${mean} | ${par} | ${share} | ` +
		`${c.underPar} | ${c.rooms > 0 ? f2(c.hits / c.rooms) : "-"} |`
	);
}

export function nt12ClassHeader(): string {
	return "| rooms | who | fought | cleared | mean s | mean par s | time / par | under par | hits / room |";
}
