// The rollback spike's state copy (docs/ROLLBACK_SPIKE.md R1). On endless floors 1, 5 (a boss floor) and 15 (dense:
// Depth 3, replay.bench's setup), solo and 4 players, mid-fight (bullets in flight):
//   (i)   the copy hashes like the original (and keeps the state's own shared references, class instances, no table in
//         common with the original but the SHARED_BY_REFERENCE / frozen ones);
//   (ii)  original and copy stepped 600 ticks with the same scripted inputs agree at every 60-tick check;
//   (iii) stepping the copy 600 ticks leaves the original (and a second copy) untouched, and never mutates a shared
//         object;
//   (iv)  an original and its copy stepped alternately (one tick each) both match a third, independently created state
//         stepped alone: catches module-level scratch carried from one state's tick into another's;
//   (v)   a bench: clone time (mean over CLONE_RUNS) and tables copied per case, on the original after (ii).
// Test-only setup shortcuts (run/testing denseFight.ts): debug-skip to the floor, Depth 3 on floor 15, the party
// teleported into the floor's boss room (floor 5) or busiest room, hearts topped up before every tick.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	Button,
	NO_KIND,
	archetypeAt,
	countActors,
	createSimState,
	hashState,
	partySize,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig, type EndlessRunSetup } from "shared/run";
import { bossRoomOf, busiestRoom, placeParty, skipPartyToFloor, tickAll, topUpHearts } from "shared/run/testing";
import {
	SHARED_ANY_KEY,
	SHARED_BY_REFERENCE,
	cloneSimState,
	cloneStats,
	deepCopy,
	type CloneStats,
	type SharedNode,
} from "./index";

const SEED = 4242;
const FLOORS = [1, 5, 15];
const PARTY_SIZES = [1, 4];
const BOSS_FLOOR = 5;
const DENSE_FLOOR = 15;
const DENSE_DEPTH = 3;
/** Ticks of the scripted fight before the state is copied (the room's enemies are up and firing). */
const WARMUP_TICKS = 90;
const STEP_TICKS = 600;
const CHECK_EVERY = 60;
const CLONE_RUNS = 20;

// ---------------------------------------------------------------------------------------------
// Scripted inputs: a pure function of (tick, player), so every state stepped at the same tick gets the same frame.

const DIRECTIONS = 16;
const DIR_X: number[] = [];
const DIR_Z: number[] = [];
for (let d = 0; d < DIRECTIONS; d++) {
	const a = (d / DIRECTIONS) * 2 * math.pi;
	// + 0 turns a -0 into 0 (the recording codec's integers; harmless here, kept like the bots).
	DIR_X.push(math.round(math.cos(a) * AXIS_MAX) + 0);
	DIR_Z.push(math.round(math.sin(a) * AXIS_MAX) + 0);
}
const MOVE_SCALE = 0.7;
const MOVE_TURN_TICKS = 40;
const AIM_TURN_TICKS = 7;
const PLAYER_PHASE = 23;
const FIRE_PERIOD = 24;
const FIRE_HELD = 14;
const ALT_PERIOD = 97;
const ALT_HELD = 20;
const ROLL_PERIOD = 71;
const SWAP_PERIOD = 233;

/** Player i's frame at `tick`: a walk turning every 40 ticks, an aim turning every tick, fire bursts, alt holds,
 * rolls and weapon swaps. */
function scripted(tick: number, i: number): InputFrame {
	const t = tick + i * PLAYER_PHASE;
	const m = (math.floor(t / MOVE_TURN_TICKS) * 5) % DIRECTIONS;
	const aim = (t * 3 + math.floor(t / AIM_TURN_TICKS)) % DIRECTIONS;
	let buttons = 0;
	if (t % FIRE_PERIOD < FIRE_HELD) buttons = bit32.bor(buttons, Button.FIRE);
	if (t % ALT_PERIOD < ALT_HELD) buttons = bit32.bor(buttons, Button.ALT);
	if (t % ROLL_PERIOD === 0) buttons = bit32.bor(buttons, Button.ROLL);
	if (t % SWAP_PERIOD === 0) buttons = bit32.bor(buttons, Button.SWAP);
	return {
		moveX: math.round(DIR_X[m] * MOVE_SCALE) + 0,
		moveZ: math.round(DIR_Z[m] * MOVE_SCALE) + 0,
		aimX: DIR_X[aim],
		aimZ: DIR_Z[aim],
		buttons,
	};
}

/** A party's inputs for one tick: player i's frame at `tick`. */
type Script = (tick: number, i: number) => InputFrame;

/** Another pattern for a copy that must DIFFER from the original (iv): faster, phase-shifted, players swapped. */
const DIVERGENT_TICK_SCALE = 2;
const DIVERGENT_TICK_SHIFT = 13;
function divergent(tick: number, i: number): InputFrame {
	return scripted(tick * DIVERGENT_TICK_SCALE + DIVERGENT_TICK_SHIFT, i + 1);
}

function framesAt(s: SimState, inputs: Script): InputFrame[] {
	const out: InputFrame[] = [];
	const n = partySize(s);
	for (let i = 0; i < n; i++) out.push(inputs(s.tick, i));
	return out;
}

/** One scripted tick (hearts topped up first, so nobody dies). */
function tickScripted(s: SimState, config: Readonly<SimConfig>, inputs: Script = scripted): void {
	topUpHearts(s);
	tickAll(s, config, framesAt(s, inputs));
}

/** Steps `ticks` scripted ticks; returns the hash at every CHECK_EVERY-th one and the mean step time (s). */
function runAlone(
	s: SimState,
	config: Readonly<SimConfig>,
	ticks: number,
	inputs: Script = scripted,
): { hashes: string[]; stepSec: number } {
	const hashes: string[] = [];
	let stepSec = 0;
	for (let k = 1; k <= ticks; k++) {
		const t0 = os.clock();
		tickScripted(s, config, inputs);
		stepSec += os.clock() - t0;
		if (k % CHECK_EVERY === 0) hashes.push(hashState(s));
	}
	return { hashes, stepSec: stepSec / ticks };
}

// ---------------------------------------------------------------------------------------------
// The cases

const setups = new Map<number, EndlessRunSetup>();
function setupFor(players: number): EndlessRunSetup {
	let s = setups.get(players);
	if (s === undefined) {
		s = buildEndlessRunConfig(SEED, players);
		setups.set(players, s);
	}
	return s;
}

/** A fresh state on `floor`, the party in its fight room after WARMUP_TICKS of the scripted fight. */
function prepare(players: number, floor: number): SimState {
	const setup = setupFor(players);
	const spawn = setup.spawn!;
	const s = createSimState(SEED, spawn.x, spawn.z, setup.config);
	skipPartyToFloor(s, setup.config, floor);
	expect(s.endless!.floor).toBe(floor);
	if (floor === DENSE_FLOOR) s.endless!.depth = DENSE_DEPTH; // test-only, as replay.bench: two bosses below
	let room = floor === BOSS_FLOOR ? bossRoomOf(setup, floor) : -1;
	if (room < 0) room = busiestRoom(setup, floor);
	const first = setup.endlessFloor(floor).roomSpawns[room][0];
	placeParty(s, first.x, first.z);
	for (let k = 0; k < WARMUP_TICKS; k++) tickScripted(s, setup.config);
	return s;
}

interface CaseCtx {
	readonly players: number;
	readonly floor: number;
	readonly config: Readonly<SimConfig>;
	readonly original: SimState;
	readonly hash0: string;
	readonly prepareSec: number;
	/** The original stepped alone (set by the (ii) test). */
	aloneHashes?: string[];
	/** The clone bench on the original before any stepping (set by the (i) test). */
	benchStart?: CloneBench;
	stepSec?: number;
}

const cases = new Map<string, CaseCtx>();
function caseFor(players: number, floor: number): CaseCtx {
	const key = `${players}/${floor}`;
	let c = cases.get(key);
	if (c === undefined) {
		const t0 = os.clock();
		const original = prepare(players, floor);
		c = {
			players,
			floor,
			config: setupFor(players).config,
			original,
			hash0: hashState(original),
			prepareSec: os.clock() - t0,
		};
		cases.set(key, c);
	}
	return c;
}

// ---------------------------------------------------------------------------------------------
// Shared objects and table identity

type Table = Map<unknown, unknown>;

/** A SharedNode's entries (a string-keyed table, not an array). */
function nodeEntries(node: SharedNode): ReadonlyMap<string, SharedNode | true> {
	return node as unknown as ReadonlyMap<string, SharedNode | true>;
}

/** Every object at a SHARED_BY_REFERENCE path of `root`, by path. */
function sharedAt(root: object, node: SharedNode, path: string, out: Map<string, object>): void {
	for (const [k, sub] of nodeEntries(node)) {
		const keys: defined[] = [];
		if (k === SHARED_ANY_KEY) for (const [kk] of pairs(root as Table)) keys.push(kk as defined);
		else keys.push(k);
		for (const kk of keys) {
			const v = (root as Table).get(kk);
			if (!typeIs(v, "table")) continue;
			const p = `${path}${path === "" ? "" : "."}${tostring(kk)}`;
			if (sub === true) out.set(p, v);
			else sharedAt(v, sub, p, out);
		}
	}
}

function sharedObjects(s: SimState): Map<string, object> {
	const out = new Map<string, object>();
	sharedAt(s, SHARED_BY_REFERENCE, "", out);
	return out;
}

/** Every table reachable from `root` (not descending into `stop` or frozen tables, which are included). */
function tablesOf(root: object, stop: ReadonlySet<unknown>): Set<unknown> {
	const seen = new Set<unknown>();
	const queue: defined[] = [root];
	while (queue.size() > 0) {
		const t = queue.pop()!;
		if (seen.has(t)) continue;
		seen.add(t);
		if (stop.has(t) || table.isfrozen(t as object)) continue;
		for (const [, v] of pairs(t as Table)) if (typeIs(v, "table") || typeIs(v, "buffer")) queue.push(v as defined);
	}
	return seen;
}

/** A deterministic deep text of `v` (sorted keys; functions by name only), for "never mutated" checks. */
function fingerprint(v: unknown, out: string[] = [], depth = 0): string[] {
	if (typeIs(v, "table")) {
		const keys: string[] = [];
		const byKey = new Map<string, unknown>();
		for (const [k, x] of pairs(v as Table)) {
			const ks = `${typeOf(k)}:${tostring(k)}`;
			keys.push(ks);
			byKey.set(ks, x);
		}
		table.sort(keys);
		out.push("{");
		for (const k of keys) {
			out.push(k, "=");
			fingerprint(byKey.get(k), out, depth + 1);
			out.push(",");
		}
		out.push("}");
	} else if (typeIs(v, "function")) out.push("fn");
	else if (typeIs(v, "number")) out.push(string.format("%.17g", v));
	else out.push(`${typeOf(v)}:${tostring(v)}`);
	return out;
}

function fingerprints(objs: ReadonlyMap<string, object>): Map<string, string> {
	const out = new Map<string, string>();
	for (const [p, o] of objs) out.set(p, fingerprint(o).join(""));
	return out;
}

// Paths that resolved in at least one case (checked at the end: a stale path would never resolve).
const resolvedPaths = new Set<string>();

// ---------------------------------------------------------------------------------------------

interface CloneBench {
	readonly tick: number;
	readonly actors: number;
	readonly boss: boolean;
	readonly enemyBullets: number;
	readonly playerBullets: number;
	readonly meanMs: number;
	readonly maxMs: number;
	readonly stats: CloneStats;
	/** Tables in the two bullet pools (deepCopy of each alone) and their copy time (mean, ms). */
	readonly poolTables: number;
	readonly poolMs: number;
}

/** CLONE_RUNS copies of `s`, timed, with the bullet pools' share. */
function benchClone(s: SimState): CloneBench {
	let total = 0;
	let worst = 0;
	for (let r = 0; r < CLONE_RUNS; r++) {
		const t0 = os.clock();
		cloneSimState(s);
		const dt = os.clock() - t0;
		total += dt;
		worst = math.max(worst, dt);
	}
	cloneSimState(s);
	const stats = cloneStats();
	let poolTables = 0;
	let poolSec = 0;
	for (const pool of [s.combat.enemyBullets, s.combat.playerBullets]) {
		for (let r = 0; r < CLONE_RUNS; r++) {
			const t0 = os.clock();
			deepCopy(pool);
			poolSec += os.clock() - t0;
		}
		poolTables += cloneStats().tablesCopied;
	}
	return {
		tick: s.tick,
		actors: countActors(s.combat).alive,
		boss: s.combat.actors.some(
			(a) => a.kind !== NO_KIND && a.alive !== 0 && archetypeAt(a.kind).data.boss === true,
		),
		enemyBullets: s.combat.enemyBullets.activeCount,
		playerBullets: s.combat.playerBullets.activeCount,
		meanMs: (total / CLONE_RUNS) * 1000,
		maxMs: worst * 1000,
		stats,
		poolTables,
		poolMs: (poolSec / CLONE_RUNS) * 1000,
	};
}

/** A class instance (its metatable is the class). */
class Probe {
	readonly v = [1, 2, 3];
	sum(): number {
		return this.v[0] + this.v[1] + this.v[2];
	}
}

describe("deepCopy rules", () => {
	it("keeps shared references and cycles, metatables, frozen tables and functions; copies buffers", () => {
		const shared = { n: 1 };
		const frozen = table.freeze({ f: 2 });
		const fn = () => 3;
		const b = buffer.create(4);
		buffer.writeu32(b, 0, 0xdeadbeef);
		const inst = new Probe();
		const root: { [k: string]: unknown } = { a: shared, b: shared, frozen, fn, buf: b, inst, keep: { x: 1 } };
		root.self = root;
		const copy = deepCopy(root, { keep: true });
		expect(copy === root).toBe(false);
		expect(copy.a === copy.b).toBe(true);
		expect(copy.a === shared).toBe(false);
		expect(copy.self === copy).toBe(true);
		expect(copy.frozen === frozen).toBe(true);
		expect(copy.fn === fn).toBe(true);
		expect(copy.keep === root.keep).toBe(true);
		expect(copy.buf === b).toBe(false);
		expect(buffer.readu32(copy.buf as buffer, 0)).toBe(0xdeadbeef);
		const ci = copy.inst as typeof inst;
		expect(ci === inst).toBe(false);
		expect(getmetatable(ci) === getmetatable(inst)).toBe(true);
		expect(ci.sum()).toBe(6);
		expect(ci.v === inst.v).toBe(false);
		expect(ci.v[2]).toBe(3);
		const st = cloneStats();
		expect(st.tablesCopied).toBe(4); // root, shared, inst, inst.v
		expect(st.instancesCopied).toBe(1);
		expect(st.buffersCopied).toBe(1);
		expect(st.sharedByPath).toBe(1);
		expect(st.sharedFrozen).toBe(1);
		expect(st.functionsKept).toBe(1);
	});

	it("refuses a table used as a key", () => {
		const m = new Map<object, number>();
		m.set({}, 1);
		expect(() => deepCopy({ m })).toThrow("table used as a key");
	});
});

for (const floor of FLOORS) {
	for (const players of PARTY_SIZES) {
		describe(`cloneSimState, endless floor ${floor}, ${players} player(s)`, () => {
			it("(i) the copy hashes like the original and shares nothing mutable", () => {
				const c = caseFor(players, floor);
				const o = c.original;
				const copy = cloneSimState(o);
				expect(hashState(copy)).toBe(c.hash0);
				expect(hashState(o)).toBe(c.hash0);
				// The state's own shared references stay shared, in the copy.
				if (players > 1) {
					expect(copy.party!.players[0] === copy.player).toBe(true);
					expect(copy.party!.weapons[0] === copy.combat.weapons).toBe(true);
				}
				// Class instances stay instances of their class.
				expect(getmetatable(copy.combat.enemyBullets) === getmetatable(o.combat.enemyBullets)).toBe(true);
				expect(copy.combat.enemyBullets === o.combat.enemyBullets).toBe(false);
				// The only tables in common are the shared ones.
				const shared = sharedObjects(o);
				for (const [p] of shared) resolvedPaths.add(p);
				const stop = new Set<unknown>();
				for (const [, x] of shared) stop.add(x);
				const mine = tablesOf(o, stop);
				const theirs = tablesOf(copy, stop);
				const common: string[] = [];
				for (const t of theirs) {
					if (mine.has(t) && !stop.has(t) && !table.isfrozen(t as object)) common.push(tostring(t));
				}
				expect(common).toEqual([]);
				const copied = sharedObjects(copy);
				for (const [p, x] of shared) expect([p, copied.get(p) === x]).toEqual([p, true]);
				c.benchStart = benchClone(o);
				expect(hashState(o)).toBe(c.hash0);
			});

			it("(ii, iii) stepping the copy leaves the original untouched; both stepped alike stay equal", () => {
				const c = caseFor(players, floor);
				const o = c.original;
				expect(hashState(o)).toBe(c.hash0);
				const copy = cloneSimState(o);
				const second = cloneSimState(o);
				const shared = sharedObjects(o);
				const before = fingerprints(shared);
				const copyRun = runAlone(copy, c.config, STEP_TICKS);
				// (iii)
				expect(hashState(o)).toBe(c.hash0);
				expect(hashState(second)).toBe(c.hash0);
				const after = fingerprints(shared);
				for (const [p, f] of before) expect([p, after.get(p) === f]).toEqual([p, true]);
				// (ii): the original stepped alone with the same inputs, compared at every check.
				const alone = runAlone(o, c.config, STEP_TICKS);
				c.aloneHashes = alone.hashes;
				c.stepSec = alone.stepSec;
				expect(alone.hashes.size()).toBe(STEP_TICKS / CHECK_EVERY);
				for (let k = 0; k < alone.hashes.size(); k++) {
					expect([(k + 1) * CHECK_EVERY, copyRun.hashes[k]]).toEqual([
						(k + 1) * CHECK_EVERY,
						alone.hashes[k],
					]);
				}
				expect(hashState(o) !== c.hash0).toBe(true); // the fight moved on
			});

			it("(iv) original and copy stepped alternately match a third state stepped alone", () => {
				const c = caseFor(players, floor);
				const reference = c.aloneHashes;
				expect(reference !== undefined).toBe(true);
				const o = prepare(players, floor); // independent of c.original, which was stepped alone in (ii)
				expect(hashState(o)).toBe(c.hash0);
				const copy = cloneSimState(o);
				// A third copy that diverges (other inputs, two ticks per round: ahead of the others, like a prediction),
				// checked against its own twin stepped alone first.
				const ahead = cloneSimState(o);
				const twin = runAlone(cloneSimState(o), c.config, STEP_TICKS * 2, divergent).hashes;
				const got = new Map<string, string[]>([
					["original", []],
					["copy", []],
					["ahead", []],
				]);
				for (let k = 1; k <= STEP_TICKS; k++) {
					tickScripted(o, c.config);
					tickScripted(ahead, c.config, divergent);
					tickScripted(copy, c.config);
					tickScripted(ahead, c.config, divergent);
					if (k % CHECK_EVERY === 0) {
						got.get("original")!.push(hashState(o));
						got.get("copy")!.push(hashState(copy));
					}
					if ((k * 2) % CHECK_EVERY === 0) got.get("ahead")!.push(hashState(ahead));
				}
				const at = (k: number) => (k + 1) * CHECK_EVERY;
				for (let k = 0; k < reference!.size(); k++) {
					expect([at(k), "original", got.get("original")![k]]).toEqual([at(k), "original", reference![k]]);
					expect([at(k), "copy", got.get("copy")![k]]).toEqual([at(k), "copy", reference![k]]);
				}
				const aheadHashes = got.get("ahead")!;
				expect(aheadHashes.size()).toBe(twin.size());
				for (let k = 0; k < twin.size(); k++) {
					expect([at(k), "ahead", aheadHashes[k]]).toEqual([at(k), "ahead", twin[k]]);
				}
				// The divergent inputs did diverge.
				expect(aheadHashes[STEP_TICKS / CHECK_EVERY - 1] !== reference![STEP_TICKS / CHECK_EVERY - 1]).toBe(
					true,
				);
			});

			it("(v) bench: clone time and tables copied", () => {
				const c = caseFor(players, floor);
				const start = c.benchStart;
				expect(start !== undefined).toBe(true);
				// The original after (ii)'s 600 ticks alone: the fight further on (enemies killed, bullets fired).
				const later = benchClone(c.original);
				const stepMs = (c.stepSec ?? 0) * 1000;
				for (const [label, r] of [
					["fight start", start!],
					["600 ticks on", later],
				] as const) {
					const st = r.stats;
					print(
						string.format(
							"[rollback clone] floor %d, %d player(s), %s (tick %d): %d actors alive%s, %d enemy / %d " +
								"player bullets; clone mean %.2f ms (max %.2f, %d runs), bullet pools %.2f ms; %d tables " +
								"copied (%d in the bullet pools, %d instances), %d entries, %d shared by path, %d frozen, " +
								"%d buffers; step %.3f ms/tick -> clone + 16 steps %.2f ms; setup %.1f s",
							floor,
							players,
							label,
							r.tick,
							r.actors,
							r.boss ? " (boss up)" : "",
							r.enemyBullets,
							r.playerBullets,
							r.meanMs,
							r.maxMs,
							CLONE_RUNS,
							r.poolMs,
							st.tablesCopied,
							r.poolTables,
							st.instancesCopied,
							st.entriesVisited,
							st.sharedByPath,
							st.sharedFrozen,
							st.buffersCopied,
							stepMs,
							r.meanMs + 16 * stepMs,
							c.prepareSec,
						),
					);
					expect(st.tablesCopied).toBeGreaterThan(r.poolTables);
				}
				if (floor === BOSS_FLOOR) expect(start!.boss).toBe(true);
			});
		});
	}
}

describe("SHARED_BY_REFERENCE", () => {
	it("every subsystem config path resolves on the endless states above", () => {
		const configs: string[] = [];
		for (const [k, node] of nodeEntries(SHARED_BY_REFERENCE)) {
			if (node !== true && node.config === true) configs.push(`${k}.config`);
		}
		table.sort(configs);
		const missing = configs.filter((p) => !resolvedPaths.has(p));
		const all: string[] = [];
		for (const p of resolvedPaths) all.push(p);
		table.sort(all);
		print(`[rollback clone] shared paths resolved: ${all.join(", ")}`);
		expect(missing).toEqual([]);
	});
});
