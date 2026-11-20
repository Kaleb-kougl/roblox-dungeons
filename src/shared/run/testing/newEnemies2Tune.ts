/**
 * Test support for specs (never imported by the game): docs/NEW_ENEMIES_2.md NX12-lite, the four new room enemies'
 * fights measured (no retune). characterTune.ts's arena fight (open arena, god mode, the AR13 fighter: the Knight's
 * sword with its guard and rolls, the Archer's charged shots back to back with the stream under fire), with a per-tick
 * tally of what the new kinds do:
 *   arrows       player bullets spawned (every kind: the Archer's stream / heavies, effect bullets)
 *   blocks       Shieldwall blocks and guard breaks (SimEvents.shieldBlocks / guardBreaks)
 *   throws       Chainhook throws (a hook in flight), latches, ends by reason (arrived = the yank, timed out, broken)
 *   pyres        pyres lit, shots each pyre fired (its reload restarting while lit), pyres the player killed / withered
 *   life         per new kind: the ticks from the fight's start to its death (-1: alive at the end)
 *
 * @module
 */
import { AffixKind } from "shared/dungeon";
import {
	CHAINHOOK_THROWN,
	EMPTY_INPUT,
	HookEnd,
	NO_KIND,
	PYRE,
	PYRE_FIRE,
	SIM_HZ,
	SimCtx,
	archetypeIndex,
	createSimState,
	simWorldConfig,
	spawnActor,
	step,
	type ActorState,
} from "shared/sim";
import {
	anyLiving,
	arenaConfig,
	grantBuild,
	nearestLiving,
	type BuildCase,
	type TuneFight,
	type TuneFloor,
} from "./buildTune";
import {
	arenaEnv,
	characterConfig,
	fighterFrame,
	fighterModeOf,
	newFighterMemory,
	type TuneCharacter,
} from "./characterTune";

/**
 * Spec support. The four docs/NEW_ENEMIES_2.md room kinds by archetype id, in the order of `Nx12Tally`'s per-kind
 * arrays and the table's life column.
 */
export const NX12_KINDS = ["bulwark", "chainhook", "snatcher", "pyrekeeper"] as const;

/**
 * Spec support. What `nx12Fight` counted in one arena fight (the file comment's list), or the means of several
 * (`meanTally`). Counts are events over the whole fight.
 */
export interface Nx12Tally {
	/** Seconds to the clear (-1: not within the fight's cap). */
	seconds: number;
	hits: number;
	arrows: number;
	heavies: number;
	blocks: number;
	breaks: number;
	throws: number;
	latches: number;
	arrived: number;
	timedOut: number;
	broken: number;
	pyresLit: number;
	pyreShots: number;
	pyresKilled: number;
	pyresWithered: number;
	/** Per NX12_KINDS entry: the sum of its actors' lives (seconds; an actor alive at the end counts the whole fight). */
	life: number[];
	/** Per NX12_KINDS entry: how many of its actors the fight held. */
	count: number[];
}

function emptyTally(): Nx12Tally {
	return {
		seconds: -1,
		hits: 0,
		arrows: 0,
		heavies: 0,
		blocks: 0,
		breaks: 0,
		throws: 0,
		latches: 0,
		arrived: 0,
		timedOut: 0,
		broken: 0,
		pyresLit: 0,
		pyreShots: 0,
		pyresKilled: 0,
		pyresWithered: 0,
		life: NX12_KINDS.map(() => 0),
		count: NX12_KINDS.map(() => 0),
	};
}

/** One arena fight of `who` (its own fighter mode) with `build` at floor `f`'s hp, tallied (file comment). */
export function nx12Fight(
	fight: TuneFight,
	build: BuildCase,
	who: TuneCharacter,
	f: TuneFloor,
	seed: number,
): Nx12Tally {
	const weapon = who === "archer" ? "weapon.bow" : "weapon.sword";
	const config = characterConfig(arenaConfig(seed, weapon, fight), who);
	const s = createSimState(seed, fight.startX, fight.startZ, config);
	s.endless!.floor = f.floor;
	s.endless!.depth = f.depth;
	grantBuild(s, 0, build.cards);
	const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
	const kinds = NX12_KINDS.map((k) => archetypeIndex(k));
	const watched: { a: ActorState; id: number; k: number }[] = [];
	for (const sp of fight.spawns) {
		const a = spawnActor(ctx, archetypeIndex(sp.kind), sp.x, sp.z, sp.affix);
		if (a === undefined) error(`nx12Fight: could not spawn ${sp.kind}`, 0);
		const k = kinds.indexOf(a.kind);
		if (k >= 0) watched.push({ a, id: a.id, k });
	}
	const t = emptyTally();
	for (const w of watched) t.count[w.k]++;
	const deathTick = watched.map(() => -1);
	const pyreKind = archetypeIndex(PYRE.id);
	const chainKind = archetypeIndex("chainhook");
	const env = arenaEnv(fight.half);
	const mem = newFighterMemory();
	const maxTicks = fight.maxSeconds * SIM_HZ;
	let ticks = maxTicks;
	for (let n = 0; n < maxTicks; n++) {
		const spawned0 = s.combat.playerSpawned;
		step(s, fighterFrame(s, fighterModeOf(who), nearestLiving(s, s.player), env, mem), config);
		s.player.hearts = s.player.heartsMax;
		const e = s.events;
		t.hits += e.playerHits;
		t.arrows += s.combat.playerSpawned - spawned0;
		t.blocks += e.shieldBlocks;
		t.breaks += e.guardBreaks;
		t.latches += e.hookLatched;
		t.pyresLit += e.pyresLanded;
		t.pyresWithered += e.pyresWithered;
		for (const r of s.combat.hookEvents.endReason) {
			if (r === HookEnd.ARRIVED) t.arrived++;
			else if (r === HookEnd.TIMED_OUT) t.timedOut++;
			else t.broken++;
		}
		for (const a of s.combat.actors) {
			if (a.kind === pyreKind && a.alive !== 0 && a.aiTicks === 0 && a.v[PYRE_FIRE] === PYRE.data.fireTicks)
				t.pyreShots++;
			if (a.kind === chainKind && a.alive !== 0 && a.aiState === CHAINHOOK_THROWN && a.aiTicks === 1) t.throws++;
		}
		for (let i = 0; i < watched.size(); i++) {
			const w = watched[i];
			if (deathTick[i] >= 0) continue;
			if (w.a.kind === NO_KIND || w.a.id !== w.id || w.a.alive === 0) deathTick[i] = n + 1;
		}
		if (!anyLiving(s)) {
			ticks = n + 1;
			t.seconds = ticks / SIM_HZ;
			break;
		}
	}
	t.heavies = mem.heavies;
	t.pyresKilled = 0;
	for (let i = 0; i < watched.size(); i++) {
		const w = watched[i];
		const life = deathTick[i] >= 0 ? deathTick[i] : ticks;
		t.life[w.k] += life / SIM_HZ;
	}
	// Pyres the player killed: lit minus withered minus those still alive at the end.
	let aliveEnd = 0;
	for (const a of s.combat.actors) if (a.kind === pyreKind && a.alive !== 0) aliveEnd++;
	t.pyresKilled = t.pyresLit - t.pyresWithered - aliveEnd;
	return t;
}

/** `fight` without the spawns of the kinds in `drop` (label suffixed). */
export function withoutKinds(fight: TuneFight, drop: ReadonlyArray<string>, label: string): TuneFight {
	return { ...fight, label: `${fight.label} ${label}`, spawns: fight.spawns.filter((sp) => !drop.includes(sp.kind)) };
}

/** A synthetic room 5-7 ahead of the player (characterTune.ts KIND_ROOMS' shape). */
export function nx12Room(
	label: string,
	spawns: ReadonlyArray<readonly [string, number, number]>,
	maxSeconds = 180,
): TuneFight {
	return {
		label,
		spawns: spawns.map(([kind, x, z]) => ({ kind, x, z, affix: AffixKind.NONE })),
		half: 12,
		startX: 0,
		startZ: 0,
		boss: false,
		maxSeconds,
	};
}

/** The NX12 per-kind rooms: each new kind alone (the Shieldwall at its cap, 2), and the Shieldwall covering snipers. */
export const NX12_ROOMS: ReadonlyArray<TuneFight> = [
	nx12Room("2 bulwark", [
		["bulwark", -2, 5],
		["bulwark", 2, 5],
	]),
	nx12Room("1 chainhook", [["chainhook", 0, 6]]),
	nx12Room("1 snatcher", [["snatcher", 0, 6]]),
	nx12Room("1 pyrekeeper", [["pyrekeeper", 0, 7]]),
	nx12Room("bulwark + 2 sniper behind", [
		["bulwark", 0, 5],
		["sniper", -1, 7],
		["sniper", 1, 7],
	]),
	nx12Room("3 sniper (baseline)", [
		["sniper", -1, 7],
		["sniper", 1, 7],
		["sniper", 0, 8],
	]),
];

/** Means of `n` tallies (seconds: -1 if any fight timed out; the rest summed / n). */
export function meanTally(ts: ReadonlyArray<Nx12Tally>): Nx12Tally {
	const m = emptyTally();
	const n = ts.size();
	let failed = false;
	let sec = 0;
	for (const t of ts) {
		if (t.seconds < 0) failed = true;
		sec += t.seconds;
		m.hits += t.hits / n;
		m.arrows += t.arrows / n;
		m.heavies += t.heavies / n;
		m.blocks += t.blocks / n;
		m.breaks += t.breaks / n;
		m.throws += t.throws / n;
		m.latches += t.latches / n;
		m.arrived += t.arrived / n;
		m.timedOut += t.timedOut / n;
		m.broken += t.broken / n;
		m.pyresLit += t.pyresLit / n;
		m.pyreShots += t.pyreShots / n;
		m.pyresKilled += t.pyresKilled / n;
		m.pyresWithered += t.pyresWithered / n;
		for (let k = 0; k < NX12_KINDS.size(); k++) {
			m.life[k] += t.life[k] / n;
			m.count[k] = t.count[k];
		}
	}
	m.seconds = failed ? -1 : sec / n;
	return m;
}

const f1 = (x: number) => string.format("%.1f", x);

/** One Markdown row of a tally. */
export function formatNx12Row(label: string, who: string, t: Nx12Tally): string {
	const lives = NX12_KINDS.map((_k, i) => (t.count[i] > 0 ? f1(t.life[i] / t.count[i]) : "-")).join(" / ");
	return (
		`| ${label} | ${who} | ${t.seconds < 0 ? "t/o" : f1(t.seconds)} | ${f1(t.hits)} | ${f1(t.arrows)} | ` +
		`${f1(t.heavies)} | ${f1(t.blocks)} / ${f1(t.breaks)} | ${f1(t.throws)} / ${f1(t.latches)} / ${f1(
			t.arrived,
		)} / ${f1(t.timedOut)} / ${f1(t.broken)} | ${f1(t.pyresLit)} / ${f1(t.pyreShots)} / ${f1(t.pyresKilled)} / ${f1(
			t.pyresWithered,
		)} | ${lives} |`
	);
}

/** Spec support. Markdown header of the NX12 fight table that `formatNx12Row` fills. */
export function nx12Header(): string {
	return (
		"| room | who | s | hits | player bullets | heavies | blocks / breaks | throws / latches / arrived / timed out / " +
		"broken | pyres lit / shots / killed / withered | mean life s bul / cha / sna / pyr |"
	);
}
