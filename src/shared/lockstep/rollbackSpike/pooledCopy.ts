/**
 * The rollback spike's pooled state copy (docs/ROLLBACK_SPIKE.md Design 1, task R1b): `PooledStateCopier.copyInto(src)`
 * copies a live SimState INTO a scratch state the copier keeps and reuses, so a steady-state copy allocates (almost)
 * nothing and touches only what is alive. It is exact like R1's `cloneSimState` (clone.ts): the copy hashes like the
 * source and, stepped with the same inputs, stays equal to it; the source is never written. Roblox-API-free (headless
 * specs and the client's worker run it). Spike only: nothing in shared/sim changes.
 *
 * THE RETURNED STATE IS THE COPIER'S SCRATCH: the next `copyInto` on the same copier overwrites it (and may return a
 * different root table, e.g. once an optional subsystem appears or disappears). Keep one copier per state you need
 * alive at the same time. Stepping the returned state is the point (a prediction); passing it, or anything holding its
 * tables, back as a source of the same copier is refused (error).
 *
 * Why R1 is slow: the two bullet pools (combat/bullets.ts SimulationCore) hold one `{x, y, z}` table per slot and per
 * vector (2048 enemy + 512 player slots x pos / vel / acc = 7,680 tables) plus ~13 per-slot arrays, live or not.
 *
 * What is reused vs re-cloned, per table reached from the source (memo src -> scratch for the whole call, so the
 * state's own aliases, `party.players[0] === player` and `party.weapons[0] === combat.weapons`, stay aliases):
 *
 *   - BULLET POOLS (metatable = SimulationCore's): copied field by field into a scratch pool of the same capacity and
 *     options (allocated once). Only what the sim or the hash can read is written:
 *       scalars activeCount / stepCount / freeTop / highWaterMark / nextEmitterId;
 *       dense[0 .. activeCount - 1]; slotToDense: the scratch's old live slots reset to -1, the source's live slots set
 *       (a pool keeps slotToDense[s] >= 0 exactly for its live slots, so this makes the whole array equal);
 *       free[0 .. freeTop - 1] (the rest of the stack is never read: acquireSlot pops below freeTop, releaseSlot
 *       writes at freeTop);
 *       per LIVE slot: pos / vel / acc (x, y, z), delay, life, payload, emitter, scale, color, prev (3).
 *     Dead slots keep whatever the scratch had: `fireAt` rewrites every per-slot field of a slot it takes, every sim
 *     read of a slot is of a live one (forEachActive callbacks, or guarded by isLive: Siege pins), and the hash
 *     (`writeStateHash`, behind combat's writeBulletsHash) reads only slots with slotToDense >= 0 below highWaterMark.
 *     So dead-slot contents never reach the future or a hash. The readonly options (capacity, boundsLimit,
 *     interpolation, fadeTime, onPoolExhausted) must match, else a new scratch pool is made. An unknown pool field
 *     (bullets.ts changed) is an error, not a silent skip.
 *   - DENSE ARRAYS (the source's `pairs` order is 1, 2, ..., n): reused; elements written in place, the tail beyond n
 *     cleared, then checked that nothing else follows key n in the scratch's traversal. Iteration order of a dense
 *     array is 1..n whatever its capacity: Luau keeps keys 1..sizearray in the array part, and inserting key
 *     sizearray + 1 forces a rehash that sizes the array part to hold every key of a dense table, so a table that has
 *     only ever been dense (push / pop / in-range writes, all the sim does to state arrays) never has an integer key
 *     in its hash part. The sim walks arrays with generalized iteration (`for of`), so this is the order it sees.
 *   - RECORDS (string keys): reused when a paired `next` walk of source and scratch meets the same keys in the same
 *     order (so their iteration order is equal now); values written in place during the walk. Any difference (an
 *     optional field set in one and not the other, a different key order) -> re-cloned (below). The sim never
 *     iterates a record with `pairs` (no pairs / Object.keys over state in shared/sim, nor in the views or the hash),
 *     so a reused record's internal node layout, which can differ from the source's, never shows to the sim. It can
 *     show to a pairs walk later: when a key is inserted into both (an optional field set, golden.events.escaped), the
 *     two may order it differently (pooledCopy.spec found exactly that). Re-cloning every record would cost ~100
 *     tables a copy for an order nothing reads; stateDifference's `recordOrder` says which comparison is meant.
 *   - EVERYTHING ELSE (Maps / Sets keyed by numbers or tables, sparse or mixed tables, any key-sequence mismatch, a
 *     scratch table the copier does not own or already used in this call): re-cloned with `table.clone` (Luau's
 *     clone copies the array part, the hash nodes and the free pointer: the same layout, so `pairs` order equals the
 *     source's now and after any identical later inserts / deletes), then its table values copied recursively into
 *     the old scratch's children where usable. The state's Maps (`breakables.slotByCell`, `pellets.byCell`) are
 *     re-cloned on every copy: a hash table with the same key order can still hold another node layout, which a later
 *     insert would expose, so it is never reused; a clone is one memcpy.
 *   - An EMPTY source table: an empty scratch table, or a scratch array (cleared), is reused; a scratch that was a Map
 *     is re-cloned.
 *   - SHARED BY REFERENCE (clone.ts SHARED_BY_REFERENCE paths, frozen tables): the scratch points at the source's
 *     object, as R1. Functions are kept; buffers are copied (none in a SimState). A table used as a key is an error.
 *     Cycles are not supported (a SimState has none: R0's census).
 * A scratch table is reused only if this copier made it (weak-keyed ownership table, which also remembers what the
 * table held: array, record, Map, ...) and only for one source table per call: a table the sim put into the scratch
 * while it was stepped, a shared config, or a frozen table is never written. Steady state allocates only the re-cloned
 * Maps (2 in an endless state) and no bookkeeping (memo and claim tables cleared and reused, stats written in place).
 */
import {
	createBulletSimulation,
	type BulletSimulation,
	type PoolExhaustedCallback,
	type SimState,
	type Vec3,
} from "shared/sim";
import { SHARED_ANY_KEY, SHARED_BY_REFERENCE, type SharedNode } from "./clone";

/**
 * A state copy function a model or probe can be given: `cloneSimState` (R1, a fresh copy each call) or a pooled copier's
 * `copyFn()` (R1b, the SAME scratch overwritten by every call: use the result before the next call). Structurally the
 * model's injectable copy type.
 */
export type StateCopyFn = (state: Readonly<SimState>) => SimState;

/** What the last copy did (for the bench). */
export interface PooledCopyStats {
	/** Tables reached (pools included, shared and frozen ones not). */
	readonly tablesVisited: number;
	/** Of those, scratch tables written in place (pools included). */
	readonly tablesReused: number;
	/** Tables allocated: `table.clone`s, plus every table of a newly made scratch pool. */
	readonly tablesAllocated: number;
	/** Bullet pools copied, and of those newly made (first copy, or options changed). */
	readonly poolsCopied: number;
	readonly poolsAllocated: number;
	/** Live bullets copied (both pools). */
	readonly bulletsCopied: number;
	/** Shared by a SHARED_BY_REFERENCE path / because frozen. */
	readonly sharedByPath: number;
	readonly sharedFrozen: number;
	readonly buffersCopied: number;
}

// ---------------------------------------------------------------------------------------------
// The bullet pool's internals (combat/bullets.ts SimulationCore, private fields read through a cast).

interface PoolInternals {
	readonly capacity: number;
	readonly boundsLimit: number;
	readonly interpolation: boolean;
	readonly fadeTime: number;
	readonly onPoolExhausted: PoolExhaustedCallback | undefined;
	activeCount: number;
	stepCount: number;
	freeTop: number;
	highWaterMark: number;
	nextEmitterId: number;
	readonly pos: Vec3[];
	readonly vel: Vec3[];
	readonly acc: Vec3[];
	readonly delay: number[];
	readonly life: number[];
	readonly payload: number[];
	readonly emitter: number[];
	readonly scale: number[];
	readonly color: number[];
	readonly prev: number[] | undefined;
	readonly dense: number[];
	readonly slotToDense: number[];
	readonly free: number[];
}

/** Every field a SimulationCore instance holds (raw keys). A key outside this set fails the copy. */
export const POOL_FIELDS: ReadonlySet<string> = new Set([
	"capacity",
	"boundsLimit",
	"interpolation",
	"fadeTime",
	"onPoolExhausted",
	"activeCount",
	"stepCount",
	"freeTop",
	"highWaterMark",
	"nextEmitterId",
	"pos",
	"vel",
	"acc",
	"delay",
	"life",
	"payload",
	"emitter",
	"scale",
	"color",
	"prev",
	"dense",
	"slotToDense",
	"free",
]);

/** Values per slot in `prev` (x, y, z). */
const PREV_STRIDE = 3;
/** Tables of a new pool besides its per-slot vectors: the instance and its 13 arrays (prev counted when present). */
const POOL_ARRAYS = 13;
/** Per-slot vector tables (pos, vel, acc). */
const POOL_VECTORS = 3;

const POOL_META = getmetatable(createBulletSimulation({ maxBullets: 0 }));

/** Whether `t` is a bullet pool (a SimulationCore instance). */
export function isBulletPool(t: unknown): boolean {
	return typeIs(t, "table") && getmetatable(t) === POOL_META;
}

function poolOf(t: unknown): PoolInternals {
	return t as PoolInternals;
}

function checkPoolFields(p: object): void {
	for (const [k] of pairs(p as Map<unknown, unknown>)) {
		if (!typeIs(k, "string") || !POOL_FIELDS.has(k)) {
			error(`PooledStateCopier: unknown bullet pool field ${tostring(k)} (combat/bullets.ts changed?)`, 0);
		}
	}
}

function samePoolOptions(a: PoolInternals, b: PoolInternals): boolean {
	return (
		a.capacity === b.capacity &&
		a.boundsLimit === b.boundsLimit &&
		a.interpolation === b.interpolation &&
		a.fadeTime === b.fadeTime &&
		a.onPoolExhausted === b.onPoolExhausted &&
		(a.prev === undefined) === (b.prev === undefined)
	);
}

function newPoolLike(s: PoolInternals): PoolInternals {
	return poolOf(
		createBulletSimulation({
			maxBullets: s.capacity,
			boundsLimit: s.boundsLimit,
			interpolation: s.interpolation,
			fadeTime: s.fadeTime,
			onPoolExhausted: s.onPoolExhausted,
		}) as BulletSimulation,
	);
}

/** Copies every part of `s` the sim or the hash can read into `d` (same capacity and options). Returns live count. */
function copyPoolInto(d: PoolInternals, s: PoolInternals): number {
	const dDense = d.dense;
	const dS2d = d.slotToDense;
	// The scratch's live slots: back to free (-1). A while loop: the bound is a field.
	let j = 0;
	const dLive = d.activeCount;
	while (j < dLive) {
		dS2d[dDense[j]] = -1;
		j++;
	}
	const n = s.activeCount;
	const sDense = s.dense;
	const sPos = s.pos;
	const sVel = s.vel;
	const sAcc = s.acc;
	const dPos = d.pos;
	const dVel = d.vel;
	const dAcc = d.acc;
	const sDelay = s.delay;
	const sLife = s.life;
	const sPayload = s.payload;
	const sEmitter = s.emitter;
	const sScale = s.scale;
	const sColor = s.color;
	const dDelay = d.delay;
	const dLife = d.life;
	const dPayload = d.payload;
	const dEmitter = d.emitter;
	const dScale = d.scale;
	const dColor = d.color;
	const sPrev = s.prev;
	const dPrev = d.prev;
	j = 0;
	while (j < n) {
		const slot = sDense[j];
		dDense[j] = slot;
		dS2d[slot] = j;
		let a = sPos[slot];
		let b = dPos[slot];
		b.x = a.x;
		b.y = a.y;
		b.z = a.z;
		a = sVel[slot];
		b = dVel[slot];
		b.x = a.x;
		b.y = a.y;
		b.z = a.z;
		a = sAcc[slot];
		b = dAcc[slot];
		b.x = a.x;
		b.y = a.y;
		b.z = a.z;
		dDelay[slot] = sDelay[slot];
		dLife[slot] = sLife[slot];
		dPayload[slot] = sPayload[slot];
		dEmitter[slot] = sEmitter[slot];
		dScale[slot] = sScale[slot];
		dColor[slot] = sColor[slot];
		if (sPrev !== undefined && dPrev !== undefined) {
			const o = slot * PREV_STRIDE;
			dPrev[o] = sPrev[o];
			dPrev[o + 1] = sPrev[o + 1];
			dPrev[o + 2] = sPrev[o + 2];
		}
		j++;
	}
	const top = s.freeTop;
	const sFree = s.free;
	const dFree = d.free;
	j = 0;
	while (j < top) {
		dFree[j] = sFree[j];
		j++;
	}
	d.activeCount = n;
	d.stepCount = s.stepCount;
	d.freeTop = top;
	d.highWaterMark = s.highWaterMark;
	d.nextEmitterId = s.nextEmitterId;
	return n;
}

// ---------------------------------------------------------------------------------------------
// The copy. Module-level context for the call in progress (one copy at a time per VM; not re-entrant).

type Table = Map<unknown, unknown>;

/** What a scratch table held at its last copy (the ownership table's value). */
const KIND_EMPTY = 1;
const KIND_ARRAY = 2;
const KIND_RECORD = 3;
const KIND_MAP = 4;
const KIND_POOL = 5;

let memo: Map<unknown, unknown> = new Map();
let owned: Map<object, number> = new Map();
/** Scratch tables already used in this call (a table is written for one source table only). */
let claimed: Map<object, boolean> = new Map();
let pathStack: string[] | undefined;
let allocatedPaths: string[] | undefined;

let tablesVisited = 0;
let tablesReused = 0;
let tablesAllocated = 0;
let poolsCopied = 0;
let poolsAllocated = 0;
let bulletsCopied = 0;
let sharedByPath = 0;
let sharedFrozen = 0;
let buffersCopied = 0;

function resetStats(): void {
	tablesVisited = 0;
	tablesReused = 0;
	tablesAllocated = 0;
	poolsCopied = 0;
	poolsAllocated = 0;
	bulletsCopied = 0;
	sharedByPath = 0;
	sharedFrozen = 0;
	buffersCopied = 0;
}

/** The shared tree's node (or `true`) under `node` for key `k`; undefined once off the tree. */
function childNode(node: SharedNode | undefined, k: unknown): SharedNode | true | undefined {
	if (node === undefined) return undefined;
	if (typeIs(k, "string")) {
		const exact = node[k];
		if (exact !== undefined) return exact;
	}
	return node[SHARED_ANY_KEY];
}

function noteAllocation(): void {
	tablesAllocated += 1;
	const stack = pathStack;
	if (stack !== undefined && allocatedPaths !== undefined) allocatedPaths.push(stack.join("."));
}

/** `old` if this copier made it, has not used it in this call, and has metatable `mt`; else undefined. */
function usable(old: unknown, mt: unknown): Table | undefined {
	if (!typeIs(old, "table")) return undefined;
	if (owned.get(old) === undefined || claimed.get(old) !== undefined) return undefined;
	if (getmetatable(old) !== mt) return undefined;
	return old as Table;
}

function copyChild(old: unknown, v: unknown, node: SharedNode | undefined, k: unknown): unknown {
	const stack = pathStack;
	if (stack !== undefined) stack.push(tostring(k));
	const r = copyValue(old, v, childNode(node, k));
	if (stack !== undefined) stack.pop();
	return r;
}

function copyValue(old: unknown, v: unknown, node: SharedNode | true | undefined): unknown {
	if (typeIs(v, "table")) {
		const seen = memo.get(v);
		if (seen !== undefined) return seen;
		if (node === true) {
			memo.set(v, v);
			sharedByPath += 1;
			return v;
		}
		if (table.isfrozen(v)) {
			memo.set(v, v);
			sharedFrozen += 1;
			return v;
		}
		return copyTable(old, v as Table, node);
	}
	if (typeIs(v, "buffer")) {
		const seen = memo.get(v);
		if (seen !== undefined) return seen;
		const out = buffer.create(buffer.len(v));
		buffer.copy(out, 0, v);
		memo.set(v, out);
		buffersCopied += 1;
		return out;
	}
	return v;
}

function copyPool(old: unknown, src: Table): Table {
	checkPoolFields(src);
	const s = poolOf(src);
	const cand = usable(old, POOL_META);
	let d: PoolInternals;
	if (cand !== undefined && samePoolOptions(poolOf(cand), s)) {
		d = poolOf(cand);
		tablesReused += 1;
	} else {
		d = newPoolLike(s);
		poolsAllocated += 1;
		const arrays = s.prev !== undefined ? POOL_ARRAYS : POOL_ARRAYS - 1;
		tablesAllocated += 1 + arrays + POOL_VECTORS * s.capacity;
		const stack = pathStack;
		if (stack !== undefined && allocatedPaths !== undefined) allocatedPaths.push(`${stack.join(".")} (new pool)`);
	}
	if (owned.get(d) !== KIND_POOL) owned.set(d, KIND_POOL);
	claimed.set(d, true);
	memo.set(src, d);
	poolsCopied += 1;
	bulletsCopied += copyPoolInto(d, s);
	return d as unknown as Table;
}

/** Writes `src` into the reusable scratch `dst` in place; the stamp kind on success, undefined to re-clone. */
function copyInPlace(dst: Table, src: Table, node: SharedNode | undefined, was: number): number | undefined {
	const [k1] = next(src);
	if (k1 === undefined) {
		const [d1] = next(dst);
		if (d1 === undefined) return was === KIND_MAP ? undefined : KIND_EMPTY;
		if (d1 !== 1 || was === KIND_MAP) return undefined;
		const n = (dst as unknown as unknown[]).size();
		if (n < 1 || next(dst, n)[0] !== undefined) return undefined;
		table.clear(dst);
		return KIND_ARRAY;
	}
	if (k1 === 1) {
		let i = 0;
		for (const [k, v] of pairs(src)) {
			i += 1;
			if (k !== i) return undefined;
			if (typeIs(v, "number") || !(typeIs(v, "table") || typeIs(v, "buffer"))) dst.set(i, v);
			else dst.set(i, copyChild(rawget(dst, i), v, node, i));
		}
		let j = i + 1;
		while (rawget(dst, j) !== undefined) {
			dst.set(j, undefined);
			j += 1;
		}
		if (next(dst, i)[0] !== undefined) return undefined;
		return KIND_ARRAY;
	}
	if (!typeIs(k1, "string")) return undefined;
	let ks: unknown = undefined;
	let kd: unknown = undefined;
	for (;;) {
		const [a, v] = next(src, ks);
		const [b] = next(dst, kd);
		if (a === undefined) return b === undefined ? KIND_RECORD : undefined;
		if (a !== b || !typeIs(a, "string")) return undefined;
		if (typeIs(v, "number") || !(typeIs(v, "table") || typeIs(v, "buffer"))) dst.set(a, v);
		else dst.set(a, copyChild(rawget(dst, a), v, node, a));
		ks = a;
		kd = b;
	}
}

function kindOfSource(src: Table): number {
	const [k1] = next(src);
	if (k1 === undefined) return KIND_EMPTY;
	if (k1 === 1) return KIND_ARRAY;
	if (typeIs(k1, "string")) return KIND_RECORD;
	return KIND_MAP;
}

function copyTable(old: unknown, src: Table, node: SharedNode | undefined): Table {
	tablesVisited += 1;
	if (owned.get(src) !== undefined) {
		error("PooledStateCopier: the source holds a table of this copier's scratch (a copy passed back?)", 0);
	}
	const mt = getmetatable(src);
	if (mt === POOL_META) return copyPool(old, src);
	const dst = usable(old, mt);
	if (dst !== undefined && !table.isfrozen(dst)) {
		const was = owned.get(dst)!;
		claimed.set(dst, true);
		memo.set(src, dst);
		const kind = copyInPlace(dst, src, node, was);
		if (kind !== undefined) {
			if (kind !== was) owned.set(dst, kind);
			tablesReused += 1;
			return dst;
		}
	}
	// Re-clone: the source's exact layout. Its table values still point into the source: each is copied (into the
	// old scratch's child at that key when usable; one already copied by a failed in-place walk comes from the memo).
	const out = table.clone(src);
	owned.set(out, kindOfSource(src));
	claimed.set(out, true);
	memo.set(src, out);
	noteAllocation();
	for (const [k, v] of pairs(out)) {
		if (typeIs(k, "table")) error("PooledStateCopier: a table used as a key is not supported", 0);
		if (typeIs(v, "table") || typeIs(v, "buffer")) {
			out.set(k, copyChild(dst !== undefined ? rawget(dst, k) : undefined, v, node, k));
		}
	}
	return out;
}

/**
 * Copies live SimStates into one reused scratch state (see the file comment). Not thread-safe; one copy at a time per
 * VM. The returned state is overwritten by the next call.
 */
export class PooledStateCopier {
	private root: object | undefined;
	private readonly memo = new Map<unknown, unknown>();
	private readonly claimed = new Map<object, boolean>();
	/** Weak keys: scratch tables dropped from the scratch are collected. */
	private readonly owned: Map<object, number> = new WeakMap<object, number>();
	private readonly last: { -readonly [K in keyof PooledCopyStats]: number } = {
		tablesVisited: 0,
		tablesReused: 0,
		tablesAllocated: 0,
		poolsCopied: 0,
		poolsAllocated: 0,
		bulletsCopied: 0,
		sharedByPath: 0,
		sharedFrozen: 0,
		buffersCopied: 0,
	};
	private paths: string[] | undefined;

	/** `shared`: the shared-by-reference tree (SHARED_BY_REFERENCE for a SimState; another for copyTree's tests). */
	constructor(private readonly shared: SharedNode = SHARED_BY_REFERENCE) {}

	/** Copies `src` into the scratch and returns it (the same scratch next time). */
	copyInto(src: Readonly<SimState>): SimState {
		return this.copyTree(src as SimState);
	}

	/** Any table tree by the same rules (the SimState entry point is copyInto). */
	copyTree<T extends object>(src: Readonly<T>): T {
		if (src === this.root) error("PooledStateCopier: the source is this copier's own scratch", 0);
		memo = this.memo;
		owned = this.owned;
		claimed = this.claimed;
		table.clear(memo);
		table.clear(claimed);
		resetStats();
		const tracking = this.paths !== undefined;
		pathStack = tracking ? [] : undefined;
		allocatedPaths = tracking ? [] : undefined;
		const root = copyTable(this.root, src as unknown as Table, this.shared);
		this.root = root;
		if (tracking) this.paths = allocatedPaths;
		pathStack = undefined;
		allocatedPaths = undefined;
		table.clear(memo);
		table.clear(claimed);
		// One stats record per copier, written in place (no allocation per copy).
		const st = this.last;
		st.tablesVisited = tablesVisited;
		st.tablesReused = tablesReused;
		st.tablesAllocated = tablesAllocated;
		st.poolsCopied = poolsCopied;
		st.poolsAllocated = poolsAllocated;
		st.bulletsCopied = bulletsCopied;
		st.sharedByPath = sharedByPath;
		st.sharedFrozen = sharedFrozen;
		st.buffersCopied = buffersCopied;
		return root as T;
	}

	/** A `StateCopyFn` over this copier (each call overwrites the previous result). */
	copyFn(): StateCopyFn {
		return (state) => this.copyInto(state);
	}

	/** What the last copy did (one record per copier, overwritten by the next copy). */
	stats(): PooledCopyStats {
		return this.last;
	}

	/** Debug: record the path of every table the following copies allocate (allocatedPaths()). Slower. */
	trackAllocations(on: boolean): void {
		this.paths = on ? [] : undefined;
	}

	/** Debug: the paths the last copy allocated at (with trackAllocations on). */
	allocatedPaths(): ReadonlyArray<string> {
		return this.paths ?? [];
	}
}

/** A `StateCopyFn` backed by a new PooledStateCopier: every call overwrites (and returns) the same scratch state. */
export function pooledCopyFn(): StateCopyFn {
	return new PooledStateCopier().copyFn();
}

// ---------------------------------------------------------------------------------------------
// An exact structural comparison (specs and debug checks).

function sameNumber(a: number, b: number): boolean {
	if (a !== a) return b !== b;
	return a === b && (a !== 0 || 1 / a === 1 / b);
}

function sameValue(a: unknown, b: unknown): boolean {
	if (typeIs(a, "number") && typeIs(b, "number")) return sameNumber(a, b);
	return a === b;
}

function poolDifference(a: PoolInternals, b: PoolInternals, path: string): string | undefined {
	if (a.pos === b.pos || a.dense === b.dense || a.free === b.free) return `${path}: pool arrays shared`;
	if (!samePoolOptions(a, b)) return `${path}: pool options`;
	const scalars: Array<[string, number, number]> = [
		["activeCount", a.activeCount, b.activeCount],
		["stepCount", a.stepCount, b.stepCount],
		["freeTop", a.freeTop, b.freeTop],
		["highWaterMark", a.highWaterMark, b.highWaterMark],
		["nextEmitterId", a.nextEmitterId, b.nextEmitterId],
	];
	for (const [name, x, y] of scalars) if (!sameNumber(x, y)) return `${path}.${name}: ${x} vs ${y}`;
	const cap = a.capacity;
	for (let i = 0; i < cap; i++) {
		if (a.slotToDense[i] !== b.slotToDense[i]) return `${path}.slotToDense[${i}]`;
	}
	for (let j = 0; j < a.freeTop; j++) if (a.free[j] !== b.free[j]) return `${path}.free[${j}]`;
	for (let j = 0; j < a.activeCount; j++) {
		const s = a.dense[j];
		if (s !== b.dense[j]) return `${path}.dense[${j}]`;
		for (const [name, x, y] of [
			["pos", a.pos[s], b.pos[s]],
			["vel", a.vel[s], b.vel[s]],
			["acc", a.acc[s], b.acc[s]],
		] as const) {
			if (x === y) return `${path}.${name}[${s}]: shared vector`;
			if (!sameNumber(x.x, y.x) || !sameNumber(x.y, y.y) || !sameNumber(x.z, y.z)) return `${path}.${name}[${s}]`;
		}
		for (const [name, x, y] of [
			["delay", a.delay, b.delay],
			["life", a.life, b.life],
			["payload", a.payload, b.payload],
			["emitter", a.emitter, b.emitter],
			["scale", a.scale, b.scale],
			["color", a.color, b.color],
		] as const) {
			if (!sameNumber(x[s], y[s])) return `${path}.${name}[${s}]`;
		}
		const ap = a.prev;
		const bp = b.prev;
		if (ap !== undefined && bp !== undefined) {
			for (let c = 0; c < PREV_STRIDE; c++) {
				if (!sameNumber(ap[s * PREV_STRIDE + c], bp[s * PREV_STRIDE + c])) return `${path}.prev[${s}]`;
			}
		}
	}
	return undefined;
}

/** A string-keyed table compared as a key set (its pairs order not compared; see stateDifference). */
function recordDifference(
	a: Table,
	b: Table,
	node: SharedNode | undefined,
	path: string,
	aToB: Map<unknown, unknown>,
	bToA: Map<unknown, unknown>,
): string | undefined {
	let count = 0;
	for (const [k, v] of pairs(a)) {
		count++;
		const w = rawget(b, k);
		if (w === undefined) return `${path}: key ${tostring(k)} missing`;
		const d = difference(v, w, childNode(node, k), `${path}.${tostring(k)}`, aToB, bToA, false);
		if (d !== undefined) return d;
	}
	for (const [bk] of pairs(b)) if (bk !== undefined) count--;
	return count === 0 ? undefined : `${path}: extra keys`;
}

function difference(
	a: unknown,
	b: unknown,
	node: SharedNode | true | undefined,
	path: string,
	aToB: Map<unknown, unknown>,
	bToA: Map<unknown, unknown>,
	recordOrder: boolean,
): string | undefined {
	if (typeOf(a) !== typeOf(b)) return `${path}: ${typeOf(a)} vs ${typeOf(b)}`;
	if (typeIs(a, "table")) {
		const bt = b as Table;
		if (node === true || table.isfrozen(a)) return a === b ? undefined : `${path}: shared object not shared`;
		const mapped = aToB.get(a);
		if (mapped !== undefined || bToA.get(bt) !== undefined) {
			return mapped === bt && bToA.get(bt) === a ? undefined : `${path}: alias structure differs`;
		}
		if (a === b) return `${path}: the same mutable table in both`;
		aToB.set(a, bt);
		bToA.set(bt, a);
		if (getmetatable(a) !== getmetatable(bt)) return `${path}: metatable`;
		if (getmetatable(a) === POOL_META) {
			checkPoolFields(a);
			checkPoolFields(bt);
			return poolDifference(poolOf(a), poolOf(bt), path);
		}
		const [first] = next(a as Table);
		if (!recordOrder && typeIs(first, "string")) return recordDifference(a as Table, bt, node, path, aToB, bToA);
		let ka: unknown = undefined;
		let kb: unknown = undefined;
		for (;;) {
			const [x, xv] = next(a as Table, ka);
			const [y, yv] = next(bt, kb);
			if (x === undefined || y === undefined) {
				return x === y ? undefined : `${path}: key ${tostring(x)} vs ${tostring(y)} (key order or set)`;
			}
			if (!sameValue(x, y)) return `${path}: key ${tostring(x)} vs ${tostring(y)} (key order)`;
			const sub = childNode(node, x);
			const d = difference(xv, yv, sub, `${path}.${tostring(x)}`, aToB, bToA, recordOrder);
			if (d !== undefined) return d;
			ka = x;
			kb = y;
		}
	}
	if (typeIs(a, "buffer")) {
		const bb = b as buffer;
		if (a === bb) return `${path}: the same buffer in both`;
		if (buffer.len(a) !== buffer.len(bb) || buffer.tostring(a) !== buffer.tostring(bb)) return `${path}: buffer`;
		return undefined;
	}
	return sameValue(a, b) ? undefined : `${path}: ${tostring(a)} vs ${tostring(b)}`;
}

/**
 * The first difference between two state trees, or undefined when `b` is an exact, independent copy of `a`: the same
 * keys in the same `pairs` order at every table, bit-equal numbers (NaN, -0), the same metatables, the same alias
 * structure, no mutable table in common, the `shared` paths and frozen tables the same objects; bullet pools compared
 * by everything the sim or the hash can read (dead slots skipped). With `recordOrder` false, a string-keyed table
 * (a record) is compared as a key set: right after a copy every order is equal (the copier reuses a record only when
 * its key order matches), but two states stepped alike can then order a record's keys differently once a key is
 * inserted (an optional field set: golden.events.escaped, ...), because a reused record keeps the scratch's own node
 * layout. Nothing reads a state record by pairs (shared/sim, the views, the hash), so that order is not state.
 */
export function stateDifference(
	a: object,
	b: object,
	shared: SharedNode = SHARED_BY_REFERENCE,
	recordOrder = true,
): string | undefined {
	return difference(a, b, shared, "state", new Map(), new Map(), recordOrder);
}
