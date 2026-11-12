// The Goldling tuning census (docs/FORTUNE.md GE4): a chase bot plays every Goldling of a set of run seeds on floors
// 2 / 6 / 12, solo and as a party of 2, with the port's sword and with the bow, and logs the catch rate, the damaging
// hits to a catch and the seconds from its appearance to the catch, and what a catch and an escape pay. The plan's
// target: a solo catch rate of 50-65 %.
//
// The bot is a focused chaser: from the Goldling's appearance it does nothing else (the room's enemies are ignored and
// harmless: god mode solo, hearts topped up in the party), walks at it (a BFS path round pillars and pieces, straight
// once in sight within CLOSE_TILES), aims straight at its centre and holds FIRE: the sword whenever it is within the
// swing's reach, the bow whenever it has a line of sight (keeping BOW_KEEP from it). `sword+roll` also dodge-rolls at
// it when it is ROLL_MIN-ROLL_MAX tiles away and in sight (the roll is the player's only speed over the Goldling's).
// Perfect aim and no enemy pressure make these UPPER bounds for a real player, who also fights the room. `sword, room`
// is the closer measure: the bot fights the room (walks at the nearest living enemy and swings, the drops census
// bot's fight) and turns on the Goldling only while it is within SWITCH_TILES or once the room is clear.
//
// Test-only surgery: the player is teleported into the Goldling's room and its piece broken open; drafts never open
// (the dev world's floor jump; the party run's startFloor / startDepth). SWEEP (off) prints the tuning sweeps behind
// GE4's numbers instead.
import { describe, expect, it } from "@rbxts/jest-globals";
import { bulletBlocker, gridToWorld, lineOfSight, pathField, type Dungeon, type PathField } from "shared/dungeon";
import {
	BreakableSource,
	Button,
	EMPTY_INPUT,
	ENDLESS_GOLDEN_CONFIG,
	GOLDEN_KIND,
	GoldenStatus,
	NOT_BROKEN,
	SIM_HZ,
	SWORD_DATA,
	ScoreSource,
	archetypeIndex,
	createSimState,
	damageBreakable,
	partySize,
	playerAt,
	step,
	stepParty,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig, devStartDepth } from "shared/run";
import { frame, walkDir } from "shared/run/testing";

type Weapon = "sword" | "sword+roll" | "bow" | "sword, room";

/** Off: the census table. On: the GE4 sweeps (flee factor x hp), slow; never on in a commit. */
const SWEEP = false;
/**
 * Off: the suite's rows (sword solo / party, bow solo, sword fighting the room solo). On: also sword+roll solo / party
 * and bow party (docs/FORTUNE.md GE4's full table; about twice as slow).
 */
const FULL = false;

const FLOORS: ReadonlyArray<number> = [2, 6, 12];
/** Goldling floors per (floor, party size): the first this many run seeds whose floor rolled one. */
const SEEDS_PER_FLOOR = 6;
const MAX_SEED = 400;
/** The bot walks straight at it (no path) once in sight within this many tiles. */
const CLOSE_TILES = 3;
/** The bow keeps this far from it. */
const BOW_KEEP = 5;
/** The path is rebuilt every this many ticks. */
const PATH_TICKS = 10;
/** `sword, room` goes for the Goldling while it is this close (tiles), else fights the nearest enemy. */
const SWITCH_TILES = 4;
/** sword+roll rolls at it in this distance band (tiles), in sight. */
const ROLL_MIN = 2.5;
const ROLL_MAX = 6;

const fmt1 = (x: number) => string.format("%.1f", x);

interface Outcome {
	readonly caught: boolean;
	/** Damaging hits taken by the Goldling (hits to catch when caught). */
	readonly hits: number;
	/** Ticks from its appearance to the catch (caught only). */
	readonly ticks: number;
	/** ScoreSource.GOLDEN points it paid in all (coins, + the jackpot when caught). */
	readonly points: number;
	readonly hp: number;
}

/** Tuning knobs of one chase (the sweeps): the flee factor and an hp multiplier on its spawn hp. */
interface Knobs {
	readonly fleeFactor?: number;
	readonly hpScale?: number;
}

const seedCache = new Map<string, number[]>();

/** The first SEEDS_PER_FLOOR run seeds whose `floor` (party of `n`) rolled a Goldling. */
function goldenSeeds(floor: number, n: number): number[] {
	const key = `${floor}/${n}`;
	const hit = seedCache.get(key);
	if (hit !== undefined) return hit;
	const out: number[] = [];
	for (let seed = 1; seed <= MAX_SEED && out.size() < SEEDS_PER_FLOOR; seed++)
		if (buildEndlessRunConfig(seed, n).endlessFloor(floor).golden !== undefined) out.push(seed);
	seedCache.set(key, out);
	return out;
}

interface Chase {
	readonly config: SimConfig;
	readonly s: SimState;
	readonly d: Dungeon;
}

function chaseRun(seed: number, floor: number, n: number, knobs: Knobs): Chase {
	const golden =
		knobs.fleeFactor !== undefined ? { ...ENDLESS_GOLDEN_CONFIG, fleeFactor: knobs.fleeFactor } : undefined;
	if (n === 1) {
		const dev = buildDevRunConfig(seed, { startFloor: floor, invulnerable: true });
		const config: SimConfig = golden !== undefined ? { ...dev.config, golden } : dev.config;
		return { config, s: createSimState(seed, dev.spawn!.x, dev.spawn!.z, config), d: dev.dungeon! };
	}
	const party = buildEndlessRunConfig(seed, n);
	let config: SimConfig = {
		...party.config,
		endless: { ...party.config.endless!, startFloor: floor, startDepth: devStartDepth(floor) },
	};
	if (golden !== undefined) config = { ...config, golden };
	const w = party.endlessFloor(floor);
	return { config, s: createSimState(seed, w.spawnX, w.spawnZ, config), d: w.dungeon };
}

function tickAll(c: Chase, frames: InputFrame[]): void {
	const n = partySize(c.s);
	for (let i = 0; i < n; i++) {
		const p = playerAt(c.s, i);
		if (p.dead === 0) p.hearts = p.heartsMax;
	}
	if (c.s.party === undefined) step(c.s, frames[0], c.config);
	else stepParty(c.s, frames, c.config);
}

/** The intact breakables' cells as pathField's `blocked` (y * W + x). */
function blockedCells(c: Chase): Set<number> {
	const out = new Set<number>();
	for (const p of c.s.breakables?.pieces ?? []) if (p.brokenTick === NOT_BROKEN) out.add(p.y * c.d.W + p.x);
	return out;
}

/**
 * `sword, room`'s target: the Goldling `a` while it is within SWITCH_TILES of player 0 or no other actor is alive in its
 * room (its floor rectangle), else the nearest other living actor there.
 */
function roomTarget(c: Chase, a: ActorState): ActorState {
	const p = c.s.player;
	const da = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
	if (da <= SWITCH_TILES * SWITCH_TILES) return a;
	const f = c.s.golden!.floor!;
	let best: ActorState | undefined;
	let bestD = math.huge;
	for (const o of c.s.combat.actors) {
		if (o === a || o.kind < 0 || o.alive === 0) continue;
		const gx = math.floor(o.x + 0.5) - f.x0;
		const gy = math.floor(o.z + 0.5) - f.y0;
		if (gx < 0 || gy < 0 || gx >= f.w || gy >= f.h) continue;
		const d = (o.x - p.x) * (o.x - p.x) + (o.z - p.z) * (o.z - p.z);
		if (d < bestD) {
			bestD = d;
			best = o;
		}
	}
	return best ?? a;
}

/** One player's bot frame against the target `a` (the Goldling, or `sword, room`'s enemy). */
function botFrame(c: Chase, i: number, a: ActorState, field: PathField, weapon: Weapon, rollPrev: boolean): InputFrame {
	const p = playerAt(c.s, i);
	const dx = a.x - p.x;
	const dz = a.z - p.z;
	const dist = math.sqrt(dx * dx + dz * dz);
	const ux = dist > 1e-9 ? dx / dist : 1;
	const uz = dist > 1e-9 ? dz / dist : 0;
	const sight = lineOfSight(bulletBlocker(c.d), p.x, p.z, a.x, a.z);
	let [mx, mz] = sight && dist <= CLOSE_TILES ? [ux, uz] : walkDir(field, p.x, p.z);
	let buttons = 0;
	if (weapon === "bow") {
		if (sight && dist <= BOW_KEEP + 2) {
			const radial = math.max(-1, math.min(1, (dist - BOW_KEEP) * 0.8));
			mx = ux * radial;
			mz = uz * radial;
		}
		if (sight) buttons = Button.FIRE;
	} else {
		if (dist <= SWORD_DATA.reach + a.radius) buttons = Button.FIRE;
		if (weapon === "sword+roll" && sight && dist >= ROLL_MIN && dist <= ROLL_MAX && !rollPrev) {
			buttons = bit32.bor(buttons, Button.ROLL);
			mx = ux;
			mz = uz;
		}
	}
	return frame(mx, mz, buttons, ux, uz);
}

/** One Goldling chased to its catch or escape (see the file comment). */
function chase(seed: number, floor: number, n: number, weapon: Weapon, knobs: Knobs = {}): Outcome {
	const c = chaseRun(seed, floor, n, knobs);
	const g = c.s.golden!;
	const f = g.floor!;
	// The bow: weapon set 1 (DEFAULT_LOADOUT's bow), one SWAP press for every player.
	if (weapon === "bow") {
		const swap: InputFrame[] = [];
		for (let i = 0; i < n; i++) swap.push(frame(0, 0, Button.SWAP));
		tickAll(c, swap);
	}
	// Into the room: every player on a walk-mask cell near its middle.
	let lx = math.floor(f.w / 2);
	const ly = math.floor(f.h / 2);
	while (f.walk[ly * f.w + lx] !== 1) lx = (lx + 1) % f.w;
	for (let i = 0; i < n; i++) {
		const p = playerAt(c.s, i);
		p.x = gridToWorld(f.x0 + lx);
		p.z = gridToWorld(f.y0 + ly);
	}
	const idle: InputFrame[] = [];
	for (let i = 0; i < n; i++) idle.push(EMPTY_INPUT);
	tickAll(c, idle);
	// Its piece broken open (docs/GOLDLING_RUMOURS.md GR2; test surgery, player 0's swing): it comes out on the next
	// tick. The rest of the census (GE4's chase from the appearance) is unchanged; GR8 rewrites it as a hunt.
	const slot = f.piece;
	damageBreakable(c.s, slot, c.s.breakables!.pieces[slot].hp, BreakableSource.MELEE, 0);
	tickAll(c, idle);
	if (g.status !== GoldenStatus.RUNNING) error(`seed ${seed} floor ${floor}: the Goldling did not appear`, 0);
	const a = c.s.combat.actors[g.actorSlot];
	expect(a.kind).toBe(archetypeIndex(GOLDEN_KIND));
	if (knobs.hpScale !== undefined) {
		a.hpMax *= knobs.hpScale;
		a.hp = a.hpMax;
	}
	const hp = a.hpMax;
	const appear = g.appearTick;
	const points0 = c.s.score!.points[ScoreSource.GOLDEN];
	let field = pathField(c.d, a.x, a.z, undefined, blockedCells(c));
	const rollPrev: boolean[] = [];
	for (let i = 0; i < n; i++) rollPrev.push(false);
	let k = 0;
	let target: ActorState = a;
	while (g.status === GoldenStatus.RUNNING) {
		const t = weapon === "sword, room" ? roomTarget(c, a) : a;
		if (k % PATH_TICKS === 0 || t !== target) field = pathField(c.d, t.x, t.z, undefined, blockedCells(c));
		target = t;
		const frames: InputFrame[] = [];
		for (let i = 0; i < n; i++) {
			const fr = botFrame(c, i, t, field, weapon, rollPrev[i]);
			rollPrev[i] = bit32.band(fr.buttons, Button.ROLL) !== 0;
			frames.push(fr);
		}
		tickAll(c, frames);
		k++;
	}
	const caught = g.status === GoldenStatus.CAUGHT;
	return {
		caught,
		hits: g.hits,
		ticks: caught ? c.s.tick - 1 - appear : -1,
		points: c.s.score!.points[ScoreSource.GOLDEN] - points0,
		hp,
	};
}

interface Row {
	readonly m: number;
	readonly caught: number;
	readonly hp: number;
	readonly hits: number;
	readonly seconds: number;
	readonly pointsCaught: number;
	readonly pointsEscaped: number;
}

function row(floor: number, n: number, weapon: Weapon, knobs: Knobs = {}): Row {
	const seeds = goldenSeeds(floor, n);
	let caught = 0;
	let hits = 0;
	let ticks = 0;
	let hp = 0;
	let pc = 0;
	let pe = 0;
	for (const seed of seeds) {
		const o = chase(seed, floor, n, weapon, knobs);
		hp = o.hp;
		expect(o.points).toBeGreaterThanOrEqual(0);
		if (o.caught) {
			caught++;
			hits += o.hits;
			ticks += o.ticks;
			pc += o.points;
		} else pe += o.points;
	}
	const m = seeds.size();
	return {
		m,
		caught,
		hp,
		hits: caught > 0 ? hits / caught : -1,
		seconds: caught > 0 ? ticks / caught / SIM_HZ : -1,
		pointsCaught: caught > 0 ? pc / caught : -1,
		pointsEscaped: m > caught ? pe / (m - caught) : -1,
	};
}

const cell = (x: number) => (x < 0 ? "-" : fmt1(x));
const pct = (r: Row) => `${r.caught}/${r.m} (${math.floor((100 * r.caught) / r.m + 0.5)} %)`;

describe("golden: GE4 tuning census", () => {
	if (SWEEP) {
		it("sweep: flee factor x hp scale, sword solo, floors 2 / 6 / 12", () => {
			const lines: string[] = [];
			for (const fleeFactor of [1.2]) {
				for (const hpScale of [1, 2.4, 3]) {
					let caught = 0;
					let all = 0;
					const cells: string[] = [];
					for (const floor of FLOORS) {
						const r = row(floor, 1, "sword, room", { fleeFactor, hpScale });
						caught += r.caught;
						all += r.m;
						cells.push(`f${floor} ${pct(r)} ${cell(r.hits)} hits ${cell(r.seconds)} s`);
					}
					lines.push(`factor ${fleeFactor} hp x${hpScale}: ${caught}/${all} | ${cells.join(" | ")}`);
				}
			}
			print(`[golden] GE4 sweep:\n${lines.join("\n")}`);
		});
		return;
	}

	it("catch rate, hits to catch and time to catch (sword / sword+roll / bow, solo / party of 2, floors 2 / 6 / 12)", () => {
		const lines: string[] = [
			"| weapon | party | floor | Goldlings | caught | hp | hits to catch | s to catch | points if caught | points if escaped |",
			"|---|---|---|---|---|---|---|---|---|---|",
		];
		let soloCaught = 0;
		let soloAll = 0;
		let roomCaught = 0;
		let roomAll = 0;
		const weapons: Weapon[] = FULL
			? ["sword", "sword+roll", "bow", "sword, room"]
			: ["sword", "bow", "sword, room"];
		for (const weapon of weapons) {
			const parties = weapon === "sword" || (FULL && weapon !== "sword, room") ? [1, 2] : [1];
			for (const n of parties) {
				for (const floor of FLOORS) {
					const r = row(floor, n, weapon);
					if (n === 1 && weapon === "sword") {
						soloCaught += r.caught;
						soloAll += r.m;
					}
					if (weapon === "sword, room") {
						roomCaught += r.caught;
						roomAll += r.m;
					}
					lines.push(
						`| ${weapon} | ${n} | ${floor} | ${r.m} | ${pct(r)} | ${fmt1(r.hp)} | ${cell(r.hits)} | ` +
							`${cell(r.seconds)} | ${cell(r.pointsCaught)} | ${cell(r.pointsEscaped)} |`,
					);
				}
			}
		}
		print(`[golden] GE4 census (${SEEDS_PER_FLOOR} Goldling floors per row):\n${lines.join("\n")}`);
		print(
			`[golden] GE4 solo sword catch rate: focused ${soloCaught}/${soloAll} (upper bound), fighting the room ` +
				`${roomCaught}/${roomAll} (lower bound); the plan's target 50-65 %`,
		);
		expect(soloAll).toBe(SEEDS_PER_FLOOR * FLOORS.size());
	});
});
