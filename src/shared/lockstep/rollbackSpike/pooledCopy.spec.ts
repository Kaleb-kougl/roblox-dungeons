// The rollback spike's pooled state copy (docs/ROLLBACK_SPIKE.md R1b): PooledStateCopier.copyInto, a copy INTO a
// reused scratch state. On endless floors 1, 5 (a boss floor) and 15 (dense: Depth 3), solo and 4 players, mid-fight:
//   (i)   the copy hashes like the original and is an exact independent copy (stateDifference: same keys in the same
//         pairs order everywhere, bit-equal numbers, the state's aliases kept, nothing mutable shared); a second copy
//         into the same scratch allocates no table; one ROAMING copier reused across every case (other floors, party
//         sizes, subsystems) is exact too;
//   (ii)  copy and original stepped 600 ticks with the same inputs agree at every 60-tick check, and structurally at
//         the end; (iii) the original (and the shared configs) never change while the copy steps;
//   (iv)  original and copies stepped alternately in one VM match states stepped alone;
//   (vi)  REUSE: copy at tick A, step the copy apart (other inputs: bullets, kills, events the source never had), copy
//         again at tick B, older ticks, another floor, a state without two subsystems; after every copy the scratch is
//         exact and, stepped beside a generic clone of the source, stays exact;
//   (v)   a bench: generic clone vs pooled copy, tables allocated per pooled copy, clone + 16 steps for both.
// Plus Maps / arrays / records whose key sets change between copies (pairs order checked, also after identical later
// inserts), the scratch refused as a source, and the StateCopyFn adapter. Setup shortcuts as clone.spec.ts
// (run/testing denseFight.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	Button,
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
	PooledStateCopier,
	SHARED_ANY_KEY,
	SHARED_BY_REFERENCE,
	cloneForRollback,
	isBulletPool,
	pooledCopyFn,
	stateDifference,
	type SharedNode,
} from "./index";

const SEED = 4242;
const FLOORS = [1, 5, 15];
const PARTY_SIZES = [1, 4];
const BOSS_FLOOR = 5;
const DENSE_FLOOR = 15;
const DENSE_DEPTH = 3;
const WARMUP_TICKS = 90;
const STEP_TICKS = 600;
const CHECK_EVERY = 60;
/** (vi): ticks a fresh copy is stepped beside a generic clone of its source, then compared. */
const VERIFY_TICKS = 60;
/** (vi): per round, ticks the scratch is stepped apart, and ticks the source advances. */
const DIVERGE_TICKS = [16, 45, 120, 8, 75, 30, 16];
const ADVANCE_TICKS = [30, 1, 90, 0, 45, 16, 60];
/** Bench: generic clones timed, pooled copies timed (after POOLED_WARMUP), and the prediction's horizon. */
const CLONE_RUNS = 8;
const POOLED_RUNS = 40;
const POOLED_WARMUP = 4;
const HORIZON = 16;

// ---------------------------------------------------------------------------------------------
// Scripted inputs (clone.spec.ts's): a pure function of (tick, player).

const DIRECTIONS = 16;
const DIR_X: number[] = [];
const DIR_Z: number[] = [];
for (let d = 0; d < DIRECTIONS; d++) {
	const a = (d / DIRECTIONS) * 2 * math.pi;
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

type Script = (tick: number, i: number) => InputFrame;

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

function tickScripted(s: SimState, config: Readonly<SimConfig>, inputs: Script = scripted): void {
	topUpHearts(s);
	tickAll(s, config, framesAt(s, inputs));
}

function stepN(s: SimState, config: Readonly<SimConfig>, ticks: number, inputs: Script = scripted): void {
	for (let k = 0; k < ticks; k++) tickScripted(s, config, inputs);
}

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

function prepare(players: number, floor: number): SimState {
	const setup = setupFor(players);
	const spawn = setup.spawn!;
	const s = createSimState(SEED, spawn.x, spawn.z, setup.config);
	skipPartyToFloor(s, setup.config, floor);
	expect(s.endless!.floor).toBe(floor);
	if (floor === DENSE_FLOOR) s.endless!.depth = DENSE_DEPTH;
	let room = floor === BOSS_FLOOR ? bossRoomOf(setup, floor) : -1;
	if (room < 0) room = busiestRoom(setup, floor);
	const first = setup.endlessFloor(floor).roomSpawns[room][0];
	placeParty(s, first.x, first.z);
	stepN(s, setup.config, WARMUP_TICKS);
	return s;
}

interface CaseCtx {
	readonly players: number;
	readonly floor: number;
	readonly config: Readonly<SimConfig>;
	readonly original: SimState;
	readonly hash0: string;
	aloneHashes?: string[];
	/** The state (iv) stepped alternately (600 ticks after the fight start), for (vi). */
	alternated?: SimState;
	stepSec?: number;
}

const cases = new Map<string, CaseCtx>();
function caseFor(players: number, floor: number): CaseCtx {
	const key = `${players}/${floor}`;
	let c = cases.get(key);
	if (c === undefined) {
		const original = prepare(players, floor);
		c = { players, floor, config: setupFor(players).config, original, hash0: hashState(original) };
		cases.set(key, c);
	}
	return c;
}

/** The SimState's Maps (re-cloned by every pooled copy), sorted. */
const MAP_PATHS = ["breakables.slotByCell", "pellets.byCell"];

/** One copier reused across every case (floors 1 / 5 / 15, solo and party): the dirtiest scratch there is. */
const roaming = new PooledStateCopier();

// ---------------------------------------------------------------------------------------------
// Shared objects (clone.spec.ts's check that stepping never mutates one)

type Table = Map<unknown, unknown>;

function sharedAt(root: object, node: SharedNode, out: Map<string, object>, path = ""): void {
	for (const [k, sub] of node as unknown as ReadonlyMap<string, SharedNode | true>) {
		const keys: defined[] = [];
		if (k === SHARED_ANY_KEY) for (const [kk] of pairs(root as Table)) keys.push(kk as defined);
		else keys.push(k);
		for (const kk of keys) {
			const v = (root as Table).get(kk);
			if (!typeIs(v, "table")) continue;
			const p = `${path}.${tostring(kk)}`;
			if (sub === true) out.set(p, v);
			else sharedAt(v, sub, out, p);
		}
	}
}

function fingerprint(v: unknown, out: string[] = []): string[] {
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
			fingerprint(byKey.get(k), out);
			out.push(",");
		}
		out.push("}");
	} else if (typeIs(v, "function")) out.push("fn");
	else if (typeIs(v, "number")) out.push(string.format("%.17g", v));
	else out.push(`${typeOf(v)}:${tostring(v)}`);
	return out;
}

function sharedFingerprints(s: SimState): Map<string, string> {
	const objs = new Map<string, object>();
	sharedAt(s, SHARED_BY_REFERENCE, objs);
	const out = new Map<string, string>();
	for (const [p, o] of objs) out.set(p, fingerprint(o).join(""));
	return out;
}

/**
 * Asserts `copy` is an exact independent copy of `src` (labelled for the failure message). `recordOrder` false after
 * stepping: a reused record may order a key inserted later differently (stateDifference), which nothing reads.
 */
function expectExact(label: string, src: SimState, copy: SimState, recordOrder = true): void {
	expect([label, stateDifference(src, copy, SHARED_BY_REFERENCE, recordOrder)]).toEqual([label, undefined]);
	expect([label, hashState(copy)]).toEqual([label, hashState(src)]);
}

/** Dead bullet slots whose position differs between two pools (the hash never reads them). */
function deadSlotsDiffering(a: SimState, b: SimState): number {
	let n = 0;
	for (const which of ["enemyBullets", "playerBullets"] as const) {
		const pa = a.combat[which];
		const pb = b.combat[which];
		for (let i = 0; i < pa.capacity; i++) {
			if (pa.isLive(i)) continue;
			const x = pa.positionAt(i);
			const y = pb.positionAt(i);
			if (x.x !== y.x || x.z !== y.z) n++;
		}
	}
	return n;
}

// ---------------------------------------------------------------------------------------------

for (const floor of FLOORS) {
	for (const players of PARTY_SIZES) {
		describe(`PooledStateCopier, endless floor ${floor}, ${players} player(s)`, () => {
			it("(i) an exact independent copy; a second copy allocates nothing; a roaming copier is exact", () => {
				const c = caseFor(players, floor);
				const o = c.original;
				// The comparison itself, on R1's generic clone.
				expect(stateDifference(o, cloneForRollback(o))).toBe(undefined);
				const cp = new PooledStateCopier();
				const copy = cp.copyInto(o);
				expectExact("first copy", o, copy);
				expect(cp.stats().poolsAllocated).toBe(2);
				if (players > 1) {
					expect(copy.party!.players[0] === copy.player).toBe(true);
					expect(copy.party!.weapons[0] === copy.combat.weapons).toBe(true);
				}
				expect(isBulletPool(copy.combat.enemyBullets)).toBe(true);
				expect(copy.combat.enemyBullets === o.combat.enemyBullets).toBe(false);
				cp.trackAllocations(true);
				const again = cp.copyInto(o);
				expect(again === copy).toBe(true);
				expectExact("second copy", o, again);
				const st = cp.stats();
				// Only the state's Maps are re-cloned (always: their node layout is not reused).
				const got = [...cp.allocatedPaths()];
				table.sort(got);
				expect(got).toEqual(MAP_PATHS);
				expect(st.tablesAllocated).toBe(MAP_PATHS.size());
				cp.trackAllocations(false);
				expect(st.poolsAllocated).toBe(0);
				expect(st.bulletsCopied).toBe(o.combat.enemyBullets.activeCount + o.combat.playerBullets.activeCount);
				expectExact("roaming copier", o, roaming.copyInto(o));
				expect(hashState(o)).toBe(c.hash0);
			});

			it("(ii, iii) stepping the copy leaves the original untouched; both stepped alike stay equal", () => {
				const c = caseFor(players, floor);
				const o = c.original;
				expect(hashState(o)).toBe(c.hash0);
				const before = sharedFingerprints(o);
				const copy = new PooledStateCopier().copyInto(o);
				const copyRun = runAlone(copy, c.config, STEP_TICKS);
				expect(hashState(o)).toBe(c.hash0);
				const after = sharedFingerprints(o);
				for (const [p, f] of before) expect([p, after.get(p) === f]).toEqual([p, true]);
				const alone = runAlone(o, c.config, STEP_TICKS);
				c.aloneHashes = alone.hashes;
				c.stepSec = alone.stepSec;
				expect(alone.hashes.size()).toBe(STEP_TICKS / CHECK_EVERY);
				for (let k = 0; k < alone.hashes.size(); k++) {
					const at = (k + 1) * CHECK_EVERY;
					expect([at, copyRun.hashes[k]]).toEqual([at, alone.hashes[k]]);
				}
				expectExact("both stepped 600 ticks", o, copy, false);
				expect(hashState(o) !== c.hash0).toBe(true);
			});

			it("(iv) original and copies stepped alternately match states stepped alone", () => {
				const c = caseFor(players, floor);
				const reference = c.aloneHashes!;
				expect(reference !== undefined).toBe(true);
				const o = prepare(players, floor);
				expect(hashState(o)).toBe(c.hash0);
				const copy = new PooledStateCopier().copyInto(o);
				const ahead = new PooledStateCopier().copyInto(o);
				const twin = runAlone(cloneForRollback(o), c.config, STEP_TICKS * 2, divergent).hashes;
				const mine: string[] = [];
				const theirs: string[] = [];
				const aheadHashes: string[] = [];
				for (let k = 1; k <= STEP_TICKS; k++) {
					tickScripted(o, c.config);
					tickScripted(ahead, c.config, divergent);
					tickScripted(copy, c.config);
					tickScripted(ahead, c.config, divergent);
					if (k % CHECK_EVERY === 0) {
						mine.push(hashState(o));
						theirs.push(hashState(copy));
					}
					if ((k * 2) % CHECK_EVERY === 0) aheadHashes.push(hashState(ahead));
				}
				for (let k = 0; k < reference.size(); k++) {
					const at = (k + 1) * CHECK_EVERY;
					expect([at, "original", mine[k]]).toEqual([at, "original", reference[k]]);
					expect([at, "copy", theirs[k]]).toEqual([at, "copy", reference[k]]);
				}
				expect(aheadHashes.size()).toBe(twin.size());
				for (let k = 0; k < twin.size(); k++) {
					const at = (k + 1) * CHECK_EVERY;
					expect([at, "ahead", aheadHashes[k]]).toEqual([at, "ahead", twin[k]]);
				}
				expect(aheadHashes[twin.size() - 1] !== reference[reference.size() - 1]).toBe(true);
				c.alternated = o;
			});

			it("(vi) reuse: copies into a dirty scratch (stepped apart, older / newer ticks, other floor, fewer subsystems)", () => {
				const c = caseFor(players, floor);
				const o = c.alternated!;
				expect(o !== undefined).toBe(true);
				const x = new PooledStateCopier();
				const snapshots: SimState[] = [];
				let deadDiffer = 0;
				let maxAllocated = 0;
				const rounds = DIVERGE_TICKS.size();
				for (let r = 0; r < rounds; r++) {
					// The source of this round: the live state, an older snapshot, the next floor, or a stripped state.
					let src = o;
					let steppable = true;
					let label = `round ${r} (tick ${o.tick})`;
					if (r === 2 && snapshots.size() > 0) {
						src = snapshots[0];
						label = `round ${r}: older snapshot (tick ${src.tick})`;
					} else if (r === 3) {
						src = cloneForRollback(o);
						skipPartyToFloor(src, c.config, floor + 1);
						label = `round ${r}: next floor (${src.endless!.floor})`;
					} else if (r === 5) {
						src = cloneForRollback(o);
						src.golden = undefined;
						src.pacts = undefined;
						steppable = false;
						label = `round ${r}: without golden / pacts`;
					}
					const srcHash = hashState(src);
					const s = x.copyInto(src);
					expectExact(label, src, s);
					if (r > 0) maxAllocated = math.max(maxAllocated, x.stats().tablesAllocated);
					if (r > 0) deadDiffer += deadSlotsDiffering(src, s);
					if (steppable) {
						// The scratch's future: stepped beside a generic clone of the source, exact at the end.
						const ref = cloneForRollback(src);
						for (let k = 0; k < VERIFY_TICKS; k++) {
							tickScripted(ref, c.config);
							tickScripted(s, c.config);
						}
						expectExact(`${label}, ${VERIFY_TICKS} ticks on`, ref, s, false);
					}
					expect([label, hashState(src)]).toEqual([label, srcHash]);
					// Dirty the scratch: other inputs (other bullets, kills, events, pickups).
					stepN(s, c.config, DIVERGE_TICKS[r], divergent);
					if (r === 0) snapshots.push(cloneForRollback(o));
					stepN(o, c.config, ADVANCE_TICKS[r]);
				}
				print(
					string.format(
						"[rollback pooled] floor %d, %d player(s), reuse: %d rounds exact; max %d tables allocated by a " +
							"reused copy; %d dead bullet slots differ from the source after copies (never hashed)",
						floor,
						players,
						rounds,
						maxAllocated,
						deadDiffer,
					),
				);
			});

			it("(v) bench: generic clone vs pooled copy, tables allocated, clone + 16 steps", () => {
				const c = caseFor(players, floor);
				const o = c.original;
				// Generic clone (R1): each clone stepped HORIZON ticks, as a prediction would.
				let cloneSec = 0;
				let cloneSteps = 0;
				for (let r = 0; r < CLONE_RUNS; r++) {
					const t0 = os.clock();
					const copy = cloneForRollback(o);
					cloneSec += os.clock() - t0;
					const t1 = os.clock();
					stepN(copy, c.config, HORIZON);
					cloneSteps += os.clock() - t1;
				}
				// Pooled: copy the confirmed state into the scratch, predict HORIZON ticks, the confirmed state advances
				// one tick (steady state after POOLED_WARMUP).
				const cp = new PooledStateCopier();
				let copySec = 0;
				let copyMax = 0;
				let predictSec = 0;
				let allocated = 0;
				let allocatedMax = 0;
				let visited = 0;
				let bullets = 0;
				const paths = new Set<string>();
				for (let r = 0; r < POOLED_WARMUP + POOLED_RUNS; r++) {
					const tracked = r === POOLED_WARMUP + POOLED_RUNS - 1;
					if (tracked) cp.trackAllocations(true);
					const t0 = os.clock();
					const s = cp.copyInto(o);
					const dt = os.clock() - t0;
					const t1 = os.clock();
					stepN(s, c.config, HORIZON, divergent);
					const pt = os.clock() - t1;
					if (tracked) {
						for (const p of cp.allocatedPaths()) paths.add(p);
						cp.trackAllocations(false);
					} else if (r >= POOLED_WARMUP) {
						const st = cp.stats();
						copySec += dt;
						copyMax = math.max(copyMax, dt);
						predictSec += pt;
						allocated += st.tablesAllocated;
						allocatedMax = math.max(allocatedMax, st.tablesAllocated);
						visited += st.tablesVisited;
						bullets += st.bulletsCopied;
					}
					tickScripted(o, c.config);
				}
				const runs = POOLED_RUNS - 1;
				const cloneMs = (cloneSec / CLONE_RUNS) * 1000;
				const cloneStepsMs = (cloneSteps / CLONE_RUNS) * 1000;
				const pooledMs = (copySec / runs) * 1000;
				const pooledStepsMs = (predictSec / runs) * 1000;
				const pathList: string[] = [];
				for (const p of paths) pathList.push(p);
				table.sort(pathList);
				print(
					string.format(
						"[rollback pooled] floor %d, %d player(s) (tick %d, %d actors alive, %d enemy / %d player " +
							"bullets): generic clone %.2f ms vs pooled copy %.3f ms (max %.3f, %d runs, %.0fx); pooled " +
							"steady state: %.2f tables allocated a copy (max %d), %.0f tables visited, %.0f bullets copied; " +
							"clone + %d steps: generic %.2f ms, pooled %.2f ms (steps %.2f / %.2f ms)%s",
						floor,
						players,
						o.tick,
						countActors(o.combat).alive,
						o.combat.enemyBullets.activeCount,
						o.combat.playerBullets.activeCount,
						cloneMs,
						pooledMs,
						copyMax * 1000,
						runs,
						cloneMs / math.max(pooledMs, 1e-6),
						allocated / runs,
						allocatedMax,
						visited / runs,
						bullets / runs,
						HORIZON,
						cloneMs + cloneStepsMs,
						pooledMs + pooledStepsMs,
						cloneStepsMs,
						pooledStepsMs,
						pathList.size() > 0 ? `; last copy allocated at: ${pathList.join(", ")}` : "",
					),
				);
				expect(pooledMs < cloneMs).toBe(true);
			});
		});
	}
}

// ---------------------------------------------------------------------------------------------
// Key sets that change: Maps, Sets, arrays, records, holes

interface Rec {
	a: number;
	b?: number;
	c: number[];
}

interface Tree {
	nums: Map<number, number>;
	strs: Map<string, number>;
	set: Set<number>;
	list: number[];
	recs: Rec[];
	sparse: Array<number | undefined>;
	nested: Map<number, Rec>;
	opt?: { v: number[] };
}

/** A small deterministic generator (Park-Miller) for the mutations. */
class Lcg {
	private s: number;
	constructor(seed: number) {
		this.s = seed;
	}
	nextInt(n: number): number {
		this.s = (this.s * 48271) % 2147483647;
		return this.s % n;
	}
}

const KEY_SPACE = 40;
const STRING_KEYS = 24;

function newTree(): Tree {
	return { nums: new Map(), strs: new Map(), set: new Set(), list: [], recs: [], sparse: [], nested: new Map() };
}

/** Random edits: inserts and deletes in every Map / Set, pushes and pops, optional fields, holes. */
function mutate(t: Tree, g: Lcg, edits: number): void {
	for (let e = 0; e < edits; e++) {
		const op = g.nextInt(12);
		const k = g.nextInt(KEY_SPACE);
		if (op === 0) t.nums.set(k * 7919, k);
		else if (op === 1) t.nums.delete(((k * 7) % KEY_SPACE) * 7919);
		else if (op === 2) t.strs.set(`k${k % STRING_KEYS}`, k);
		else if (op === 3) t.strs.delete(`k${(k * 5) % STRING_KEYS}`);
		else if (op === 4) t.set.add(k);
		else if (op === 5) t.set.delete((k * 3) % KEY_SPACE);
		else if (op === 6) t.list.push(k);
		else if (op === 7) t.list.pop();
		else if (op === 8) {
			if (t.recs.size() < 6 || k % 2 === 0) t.recs.push({ a: k, c: [k] });
			else t.recs.pop();
		} else if (op === 9) {
			const r = t.recs[k % math.max(1, t.recs.size())];
			if (r !== undefined) r.b = r.b === undefined ? k : undefined;
		} else if (op === 10) t.sparse[k % 12] = t.sparse[k % 12] === undefined ? k : undefined;
		else {
			if (k % 3 === 0) t.opt = t.opt === undefined ? { v: [k] } : undefined;
			else if (k % 3 === 1) t.nested.set(k, { a: k, c: [k, k] });
			else t.nested.delete(k - 1);
		}
	}
}

/** The keys of `t` in pairs order. */
function keyOrder(t: object): string {
	const out: string[] = [];
	for (const [k] of pairs(t as Table)) out.push(tostring(k));
	return out.join(",");
}

describe("PooledStateCopier: key sets that change", () => {
	it("keeps every table's pairs order, also after identical later inserts", () => {
		const g = new Lcg(12345);
		const src = newTree();
		mutate(src, g, 200);
		const cp = new PooledStateCopier({});
		const rounds = 60;
		let reused = 0;
		let strsOrderDrift = 0;
		for (let r = 0; r < rounds; r++) {
			const copy = cp.copyTree(src);
			expect([r, stateDifference(src, copy, {})]).toEqual([r, undefined]);
			reused += cp.stats().tablesReused;
			// The same later edits on both (as two states stepped alike): pairs order stays equal.
			const probe = new PooledStateCopier({}).copyTree(src);
			const seed = 1000 + r;
			mutate(probe, new Lcg(seed), 30);
			mutate(copy, new Lcg(seed), 30);
			for (const field of ["nums", "set", "nested", "list", "recs", "sparse"] as const) {
				expect([r, field, keyOrder(copy[field])]).toEqual([r, field, keyOrder(probe[field])]);
			}
			// A string-keyed table is reused as a record when its key order matches: equal now (checked above), but
			// its node layout may differ, so later inserts may order differently. Counted, not asserted (the sim never
			// iterates a string-keyed state table).
			if (keyOrder(copy.strs) !== keyOrder(probe.strs)) strsOrderDrift++;
			// The scratch drifts apart (the prediction's own edits), then the source moves on.
			mutate(copy, g, 25);
			mutate(src, g, 1 + (r % 4) * 10);
		}
		print(
			`[rollback pooled] key sets: ${rounds} rounds exact; string-keyed Map order drifted after identical later ` +
				`inserts in ${strsOrderDrift} rounds`,
		);
		expect(reused).toBeGreaterThan(rounds);
	});

	it("refuses its own scratch as a source", () => {
		const cp = new PooledStateCopier({});
		const copy = cp.copyTree({ a: [1, 2], b: { c: 3 } });
		expect(() => cp.copyTree(copy)).toThrow("own scratch");
		expect(() => cp.copyTree({ held: copy.a })).toThrow("scratch");
	});

	it("pooledCopyFn: one scratch, overwritten by each call", () => {
		const c = caseFor(1, FLOORS[0]);
		const copyFn = pooledCopyFn();
		const a = copyFn(c.original);
		expectExact("copyFn", c.original, a);
		const b = copyFn(c.original);
		expect(a === b).toBe(true);
	});
});
