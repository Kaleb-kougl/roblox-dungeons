/**
 * Silver in crates in the sim (docs/SILVER.md SC2, "Silver in crates (dungeon and sim)", decisions SVD15 / SVD16 /
 * SVD17; a Roblox-port feature, no web source). OPT-IN: only a SimConfig with `silver` (ENDLESS_SILVER_CONFIG: endless
 * solo / co-op, the Daily, dev; shared/run buildEndlessRunConfig) creates `SimState.silver`, and only then does anything
 * here run or the hash grow the appended `silver` group (after `secrets`, LAST). Without it nothing changes (M1, every
 * golden fixture, the tutorial, every replay that does not set it).
 *
 * Which pieces hold how much is decided when the floor is built (shared/dungeon placeBreakableSilver), so the sim draws
 * NO rng here and only counts what was broken:
 *
 *   floor start  silverOnFloorPieces(state, silver) from createSimState (floor 1, or dev mode's startFloor; sandboxes
 *                without endless: SilverConfig.floor) and from stepEndless right after dropsOnFloorPieces: `pieces` gets
 *                one entry per breakable slot of the floor (0), then each Silver entry's amount in its slot. `total`
 *                carries over (the run's).
 *   break        silverOnBreak(state, slot) from damageBreakable's break line, right after dropsOnBreak, every source
 *                (melee, player bullet, enemy bullet, the slam, a roll, a build effect, a Bomber's blast, a Charger):
 *                a slot holding Silver adds its amount to `total`, is zeroed (it pays once) and pushes an unhashed
 *                per-tick event (events.breaks: slot, cell centre, amount). Co-op: the team's (SVD6), so no player.
 *                No score source (SVD17), no combo, no rng.
 *
 * Read by shared/silver's run payout through silverTotalOf (0 without the flag), and by the view's twinkle through
 * silverPieceAt. A LEAF module (state types and shared/dungeon only), so breakables.ts can call its hook without a
 * require cycle.
 *
 * @module
 */
import { gridToWorld, type BreakableSilver } from "shared/dungeon";
import type { SimState } from "../state";

/** SimConfig.silver: presence turns Silver in crates on. */
export interface SilverConfig {
	/**
	 * The Silver pieces of a run WITHOUT endless mode (tests, sandboxes): { slot into BreakablesConfig.pieces, amount }.
	 * Endless runs ignore it: each floor's Silver comes from its world (EndlessFloorWorld.breakableSilver).
	 */
	readonly floor?: ReadonlyArray<BreakableSilver>;
}

/** The game's Silver config (every endless world; shared/run buildEndlessRunConfig). No tunables: the floor decides. */
export const ENDLESS_SILVER_CONFIG: SilverConfig = table.freeze({});

/** A SilverState.pieces entry that holds no Silver (or paid already). */
export const NO_SILVER = 0;

/** One Silver piece broken this tick (events.breaks). */
export interface SilverBreak {
	/** Its breakables slot. */
	readonly slot: number;
	/** Its cell centre (world). */
	readonly x: number;
	/** Its cell centre, world z (0 when the run has no breakables state). */
	readonly z: number;
	/** The Silver it paid. */
	readonly amount: number;
}

/** Per-tick Silver events for presentation. Cleared every tick; NOT hashed. */
export interface SilverEvents {
	/** Silver pieces broken this tick, in break order. */
	readonly breaks: SilverBreak[];
}

/** SimState.silver: plain numbers, every field but `config` and `events` hashed. */
export interface SilverState {
	/** The run's Silver config. Constant for the run: not hashed, shared by clones. */
	readonly config: Readonly<SilverConfig>;
	/** Silver the run's broken pieces paid so far (all floors; the team's in co-op). */
	total: number;
	/** The current floor's Silver per breakables slot (NO_SILVER: none, or paid). */
	pieces: number[];
	/** Not hashed. */
	events: SilverEvents;
}

/** Silver state at run start: nothing paid, no pieces (silverOnFloorPieces fills them). No rng. */
export function createSilverState(config: Readonly<SilverConfig>): SilverState {
	return { config, total: 0, pieces: [], events: { breaks: [] } };
}

/**
 * A new floor's breakables are in place (createSimState, stepEndless after dropsOnFloorPieces): pieces = one NO_SILVER
 * per breakable slot, then `silver`'s amounts in their slots; `total` is kept. No-op without state.silver; without
 * state.breakables it stays empty. Throws on a slot out of range, a slot listed twice or an amount that is not a
 * positive integer (floor data out of step). No rng.
 */
export function silverOnFloorPieces(state: SimState, silver: ReadonlyArray<BreakableSilver> | undefined): void {
	const sv = state.silver;
	if (sv === undefined) return;
	const list = sv.pieces;
	list.clear();
	const b = state.breakables;
	if (b === undefined) return;
	const n = b.pieces.size();
	for (let i = 0; i < n; i++) list.push(NO_SILVER);
	if (silver === undefined) return;
	for (const s of silver) {
		if (!(s.slot >= 0 && s.slot < n) || s.slot % 1 !== 0)
			error(`silver: breakable slot ${s.slot} out of range (${n} pieces)`, 0);
		if (!(s.amount > 0) || s.amount % 1 !== 0)
			error(`silver: slot ${s.slot} amount ${s.amount} is not positive`, 0);
		if (list[s.slot] !== NO_SILVER) error(`silver: breakable slot ${s.slot} listed twice`, 0);
		list[s.slot] = s.amount;
	}
}

/**
 * damageBreakable's break line, right after dropsOnBreak: the piece in breakable slot `slot` just broke (any source). A
 * slot holding Silver pays it into `total`, is zeroed and pushes events.breaks (see the file comment). No-op for a slot
 * without Silver or without state.silver. No rng.
 */
export function silverOnBreak(state: SimState, slot: number): void {
	const sv = state.silver;
	if (sv === undefined) return;
	const amount = sv.pieces[slot];
	if (amount === undefined || amount === NO_SILVER) return;
	sv.pieces[slot] = NO_SILVER;
	sv.total += amount;
	const p = state.breakables?.pieces[slot];
	const x = p !== undefined ? gridToWorld(p.x) : 0;
	const z = p !== undefined ? gridToWorld(p.y) : 0;
	sv.events.breaks.push({ slot, x, z, amount });
}

/** Start of every tick (step.ts, after clearEvents). */
export function clearSilverEvents(sv: SilverState): void {
	sv.events.breaks.clear();
}

/**
 * A deep copy for a state clone: the per-slot amounts and this tick's break events are copied; `config` is shared
 * (constant for the run).
 */
export function cloneSilverState(sv: Readonly<SilverState>): SilverState {
	const breaks: SilverBreak[] = [];
	for (const e of sv.events.breaks) breaks.push({ ...e });
	return { config: sv.config, total: sv.total, pieces: [...sv.pieces], events: { breaks } };
}

/**
 * The Silver the run's broken barrels and crates paid so far (all floors; the team's in co-op). 0 without
 * SimConfig.silver. The seam shared/silver's runSilver reads (docs/SILVER.md "Payout").
 */
export function silverTotalOf(state: Readonly<SimState>): number {
	return state.silver?.total ?? 0;
}

/**
 * The Silver breakables slot `slot` still holds (NO_SILVER: none, already paid, or no state.silver). The view's twinkle
 * reads it (shared/view pieceGlints), like breakableLootAt.
 */
export function silverPieceAt(state: Readonly<SimState>, slot: number): number {
	return state.silver?.pieces[slot] ?? NO_SILVER;
}

// ---------------------------------------------------------------------------------------------
// Hash: the `silver` group, appended after `secrets` (last) only when state.silver exists.
//   total, pieces.length, pieces

/**
 * Appends the `silver` hash group to `out`: total, then pieces' length and values in slot order. `config` and `events`
 * are not hashed. Must stay in step with silverHashNames.
 */
export function writeSilverHash(sv: Readonly<SilverState>, out: number[]): void {
	out.push(sv.total);
	out.push(sv.pieces.size());
	for (const v of sv.pieces) out.push(v);
}

/** Dump names for writeSilverHash, same order (`silver.total`, `silver.pieces[3]`, ...). */
export function silverHashNames(sv: Readonly<SilverState>, out: string[]): void {
	out.push("silver.total");
	out.push("silver.pieces.length");
	for (let i = 0; i < sv.pieces.size(); i++) out.push(`silver.pieces[${i}]`);
}
