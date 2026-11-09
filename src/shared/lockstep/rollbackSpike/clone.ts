/**
 * The rollback spike's state copy (docs/ROLLBACK_SPIKE.md Design 1, task R1): `cloneSimState(state)`, a generic deep
 * copy of a live `SimState` that can be stepped on its own without touching the original.
 *
 * Spike grade, correct first and slow (RBD2): every call allocates a fresh copy (a real rollback would copy into
 * preallocated pools), so its time is an upper bound. Not in shared/sim (the sim is not touched) and not the sim's own
 * `cloneSimState` (state.ts), which refuses a state once any bullet has spawned. Roblox-API-free (no services, no
 * Instances): it runs headless under Lune and in the client's worker.
 *
 * The rules, per value reached from the state:
 *   - a table is copied with `table.clone` (Luau's: the same keys, the same array / hash layout, so `pairs` and
 *     generalized iteration visit the copy's entries in exactly the original's order, which a `Map` iterated by the
 *     sim depends on; and the same METATABLE, kept by reference, so a class instance such as a `BulletSimulation`
 *     stays an instance of its class), then each of its table / buffer values is copied the same way;
 *   - one memo (original -> copy) for the whole call: a table reached twice is copied once and both places point at
 *     the copy (the party's `players[0]` is `state.player`, `weapons[0]` is `combat.weapons`), and cycles end;
 *   - a buffer is copied (`buffer.create` + `buffer.copy`), through the same memo;
 *   - functions, strings, numbers, booleans and other immutable values are kept (functions by reference);
 *   - SHARED BY REFERENCE (not copied, the copy points at the original's object):
 *       (a) the explicit field paths of SHARED_BY_REFERENCE below: immutable run data the state points at;
 *       (b) any frozen table (`table.isfrozen`): immutable by construction (a write throws).
 *   - a table used as a KEY is refused (error): copying it would need its key remapped, which changes the table's
 *     iteration order. No SimState field has one (R1's census); a new one fails loudly here instead of sharing.
 *
 * Why explicit paths and not the identity of known objects: the copy takes only the state (a probe or a model has no
 * config at hand), the immutable objects are few and sit at fixed fields, and a path that goes stale (renamed or
 * removed) only makes the copy copy that object too, which is still correct (a copy of immutable data is safe; only a
 * shared MUTABLE object would be a bug). clone.spec.ts checks every path still resolves, that stepping never mutates
 * a shared object, and that the only tables the copy and the original have in common are the shared ones.
 */
import type { SimState } from "shared/sim";

/** A node of the shared-by-reference tree: at each key, `true` shares that value, a nested node descends into it. */
export interface SharedNode {
	readonly [key: string]: SharedNode | true;
}

/** In a SharedNode, this key matches every key of the table at that level (array elements, map entries). */
export const SHARED_ANY_KEY = "*";

/**
 * Immutable data a SimState points at (R1's census of sim/state.ts and every subsystem's type), shared by the copy:
 *   - `<subsystem>.config`: the run's per-subsystem config (BREAKABLES_CONFIG, ENDLESS_DROPS_CONFIG, AFFIXES_CONFIG,
 *     BUILDS_CONFIG, PELLETS_CONFIG, ENDLESS_TREASURE_CONFIG, ENDLESS_PACTS_CONFIG, ENDLESS_GOLDEN_CONFIG), the same
 *     object the SimConfig holds (`readonly config` in each state type; the sim's own clones share it too);
 *   - `golden.floor`: the floor's Goldling plan (EndlessFloorWorld.golden, part of the floor world: room rectangle and
 *     walk mask), hashed through `golden.room` only;
 *   - `golden.cache.floor`: the same plan, the flee field cache's key (compared by identity with `golden.floor`).
 * Everything else the state holds is plain mutable data (numbers, arrays, per-slot records, the two bullet pools) or
 * a cache rebuilt from hashed state (copied too: `golden.cache` itself, the breakables' / pellets' cell maps).
 * The SimConfig itself, the floor worlds, the dungeon grid, the archetype / weapon registries and the arc tables are
 * not reachable from the state at all: the sim gets them through `step`'s config argument and module imports.
 */
export const SHARED_BY_REFERENCE: SharedNode = {
	breakables: { config: true },
	drops: { config: true },
	affixes: { config: true },
	builds: { config: true },
	pellets: { config: true },
	treasure: { config: true },
	pacts: { config: true },
	golden: { config: true, floor: true, cache: { floor: true } },
};

/** What the last copy did (for the bench). */
export interface CloneStats {
	/** Tables copied (every one, instances included). */
	readonly tablesCopied: number;
	/** Of those, tables with a metatable (class instances: the two BulletSimulations, ...). */
	readonly instancesCopied: number;
	/** Entries visited in the copied tables (keys of every kind). */
	readonly entriesVisited: number;
	/** Buffers copied. */
	readonly buffersCopied: number;
	/** Tables shared because of a SHARED_BY_REFERENCE path. */
	readonly sharedByPath: number;
	/** Tables shared because they are frozen. */
	readonly sharedFrozen: number;
	/** Function values kept by reference. */
	readonly functionsKept: number;
}

type Table = Map<unknown, unknown>;

let tablesCopied = 0;
let instancesCopied = 0;
let entriesVisited = 0;
let buffersCopied = 0;
let sharedByPath = 0;
let sharedFrozen = 0;
let functionsKept = 0;

function resetStats(): void {
	tablesCopied = 0;
	instancesCopied = 0;
	entriesVisited = 0;
	buffersCopied = 0;
	sharedByPath = 0;
	sharedFrozen = 0;
	functionsKept = 0;
}

/** The counts of the last cloneSimState / deepCopy call. */
export function cloneStats(): CloneStats {
	return { tablesCopied, instancesCopied, entriesVisited, buffersCopied, sharedByPath, sharedFrozen, functionsKept };
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

function copyBuffer(b: buffer, memo: Map<unknown, unknown>): buffer {
	const out = buffer.create(buffer.len(b));
	buffer.copy(out, 0, b);
	memo.set(b, out);
	buffersCopied += 1;
	return out;
}

function copyTable(t: Table, node: SharedNode | undefined, memo: Map<unknown, unknown>): Table {
	const out = table.clone(t);
	memo.set(t, out);
	tablesCopied += 1;
	if (getmetatable(t) !== undefined) instancesCopied += 1;
	// Assigning to keys that already exist during a traversal is allowed (Lua's `next` contract), and keeps the layout.
	for (const [k, v] of pairs(out)) {
		entriesVisited += 1;
		if (typeIs(k, "table")) error("cloneSimState: a table used as a key is not supported (see clone.ts)", 0);
		if (typeIs(v, "table")) {
			const seen = memo.get(v);
			if (seen !== undefined) {
				out.set(k, seen);
				continue;
			}
			const sub = childNode(node, k);
			if (sub === true) {
				memo.set(v, v);
				sharedByPath += 1;
			} else if (table.isfrozen(v)) {
				memo.set(v, v);
				sharedFrozen += 1;
			} else {
				out.set(k, copyTable(v as Table, sub, memo));
			}
		} else if (typeIs(v, "buffer")) {
			const seen = memo.get(v);
			out.set(k, seen !== undefined ? seen : copyBuffer(v, memo));
		} else if (typeIs(v, "function")) {
			functionsKept += 1;
		}
	}
	return out;
}

/**
 * A deep copy of any table by the rules in the file comment, with `shared` as the shared-by-reference tree (rooted at
 * `value`). Resets cloneStats().
 */
export function deepCopy<T extends object>(value: T, shared: SharedNode | undefined = undefined): T {
	resetStats();
	return copyTable(value as unknown as Table, shared, new Map()) as unknown as T;
}

/**
 * An independent copy of a live SimState (any tick, bullets in flight included): stepping either never changes the
 * other, and `hashState(copy) === hashState(state)`. Shares SHARED_BY_REFERENCE and frozen tables. Resets
 * cloneStats().
 */
export function cloneSimState(state: Readonly<SimState>): SimState {
	return deepCopy(state as SimState, SHARED_BY_REFERENCE);
}
