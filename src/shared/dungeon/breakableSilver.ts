/**
 * Silver in crates (docs/SILVER.md SC1, "Silver in crates (dungeon and sim)", decisions SVD15 / SVD16; a Roblox-port
 * feature, no web source): which barrels and crates of an endless floor hold Silver, and how much. Decided when the
 * floor is built, a PURE function of the floor like the rest of ./endless.ts, so live play, every co-op client and the
 * server's replay agree, the sim draws no rng for it, and break order or breaker never matters.
 *
 *   order       ONCE and LAST in buildEndlessFloor (after placeSecret, on the final parts: a floor modifier's loot
 *               included; never inside placeFloorParts). It adds no piece and takes no cell, so every earlier output,
 *               digest, slot and roomSpawnTiles is the option-off floor's.
 *   candidates  the floor's clutter (the pieces placeBreakables put down: slots 0 .. clutter - 1, before the vault's
 *               chest, the Goldling's own piece and the secret's pieces, which are appended after them) whose kind has
 *               a pieceWeight (barrels and crates) and that hold no boost (no loot slot, SVD16). An inert piece (a
 *               chest, a cracked wall) or the Goldling's piece is never one.
 *   stream      its own: new EncounterRng(breakableSilverSeed(floor seed)) = mulberry32 from (seed ^ BREAKABLE_SILVER.salt).
 *   count       ONE draw: rng.int(band.min, band.max) for the floor's band (BREAKABLE_SILVER.bands).
 *   pieces      that many times: the open candidates are those not chosen yet and not in a room that already holds
 *               maxPerRoom Silver pieces (room = roomAt on the piece's cell centre; a piece in no room has no cap). None
 *               left: stop. Else ONE weighted draw over them (pieceWeight by kind: rng.int(0, total - 1) walked in slot
 *               order), then ONE stack draw rng.int(lo, hi) (breakableSilverStack(floor)).
 *   draws       1 + 2 per Silver piece (fewer pieces than the count only when the candidates run out).
 *   every       (SilverOverride.every, the dev world's KV_SilverDebug) the count draw is still made and ignored; then every
 *               candidate, in slot order, takes ONE stack draw (no per-room cap). Absent: the natural roll.
 *
 * Output: the Silver pieces as { slot (index into the floor's breakables), amount (Silver, > 0) }, in slot order.
 *
 * @module
 */
import { u32 } from "shared/jsmath";
import { gridToWorld } from "./collision";
import { EncounterRng } from "./encounter";
import { roomAt, type EncounterConfig } from "./encounterTypes";
import type { BreakablePlacement } from "./breakables";
import type { BreakableLoot } from "./breakableLoot";
import type { BreakablePieceKindName } from "./breakablesData";
import { BREAKABLE_SILVER, type BreakableSilverBand } from "./breakableSilverData";

/** One Silver piece: its breakable slot (placement index) and the Silver it holds. */
export interface BreakableSilver {
	/** The piece's index in the floor's breakables list. */
	readonly slot: number;
	/** The Silver it pays when broken. */
	readonly amount: number;
}

/** The dev world's KV_SilverDebug (shared/run parseSilverDebug). Absent or empty: the natural roll. */
export interface SilverOverride {
	/** Every candidate piece holds Silver (the file comment's "every"). */
	readonly every?: boolean;
}

/** What placeBreakableSilver reads of a built floor. */
export interface BreakableSilverFloorInput {
	/** The floor seed (floorSeed(runSeed, floor)). */
	readonly seed: number;
	/** The floor's rooms (their types and sizes). */
	readonly encounter: EncounterConfig;
	/**
	 * The floor's clutter, slot order: exactly the pieces placeBreakables put down (the first slots of the floor's
	 * breakables; everything appended after them is never a candidate).
	 */
	readonly clutter: ReadonlyArray<BreakablePlacement>;
	/** The floor's final boost loot (a modifier's included): those slots never hold Silver. Absent: none. */
	readonly loot?: ReadonlyArray<BreakableLoot>;
}

/** A piece in no room (roomAt undefined): never capped by maxPerRoom. */
const NO_ROOM = -1;

/** Seed of the Silver stream: the floor seed with BREAKABLE_SILVER.salt mixed in (uint32). */
export function breakableSilverSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), BREAKABLE_SILVER.salt);
}

/** The Silver band of `floor` (the last band whose fromFloor <= floor). */
export function breakableSilverBand(floor: number): BreakableSilverBand {
	const bands = BREAKABLE_SILVER.bands;
	let out = bands[0];
	for (const b of bands) if (floor >= b.fromFloor) out = b;
	return out;
}

/** The stack range [lo, hi] of a Silver piece on `floor` (BREAKABLE_SILVER.stack). */
export function breakableSilverStack(floor: number): readonly [number, number] {
	const s = BREAKABLE_SILVER.stack;
	const steps = math.max(0, math.floor((floor - 1) / s.floorsPerStep));
	const bonus = math.min(s.bonusCap, steps);
	return [s.min + bonus, s.max + bonus];
}

/** The piece pick's weight of a piece of `kind` (BREAKABLE_SILVER.pieceWeight); 0 for a kind it has no entry for. */
export function silverPieceWeight(kind: BreakablePieceKindName): number {
	return (BREAKABLE_SILVER.pieceWeight as Readonly<Partial<Record<BreakablePieceKindName, number>>>)[kind] ?? 0;
}

/**
 * The Silver pieces of floor `floor` (see the file comment). Pure and deterministic; nothing in `input` is mutated.
 * `override.every`: every candidate (the dev world).
 */
export function placeBreakableSilver(
	input: BreakableSilverFloorInput,
	floor: number,
	override?: SilverOverride,
): BreakableSilver[] {
	const rng = new EncounterRng(breakableSilverSeed(input.seed));
	const band = breakableSilverBand(floor);
	const count = rng.int(band.min, band.max);
	const [lo, hi] = breakableSilverStack(floor);
	const pieces = input.clutter;
	const n = pieces.size();
	const loaded = new Set<number>();
	for (const l of input.loot ?? []) loaded.add(l.slot);
	// Candidate weight per slot (0: never), and its room.
	const weights: number[] = [];
	const rooms: number[] = [];
	for (let i = 0; i < n; i++) {
		const p = pieces[i];
		weights.push(loaded.has(i) ? 0 : silverPieceWeight(p.kind));
		rooms.push(roomAt(input.encounter, gridToWorld(p.x), gridToWorld(p.y))?.id ?? NO_ROOM);
	}
	const amounts = new Map<number, number>(); // slot -> amount
	if (override?.every === true) {
		for (let i = 0; i < n; i++) if (weights[i] > 0) amounts.set(i, rng.int(lo, hi));
	} else {
		const perRoom = new Map<number, number>();
		for (let k = 0; k < count; k++) {
			let total = 0;
			const open: boolean[] = [];
			for (let i = 0; i < n; i++) {
				const room = rooms[i];
				const ok =
					weights[i] > 0 &&
					!amounts.has(i) &&
					(room === NO_ROOM || (perRoom.get(room) ?? 0) < BREAKABLE_SILVER.maxPerRoom);
				open.push(ok);
				if (ok) total += weights[i];
			}
			if (total <= 0) break;
			let roll = rng.int(0, total - 1);
			let slot = -1;
			for (let i = 0; i < n; i++) {
				if (!open[i]) continue;
				if (roll < weights[i]) {
					slot = i;
					break;
				}
				roll -= weights[i];
			}
			amounts.set(slot, rng.int(lo, hi));
			const room = rooms[slot];
			if (room !== NO_ROOM) perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
		}
	}
	const out: BreakableSilver[] = [];
	for (let i = 0; i < n; i++) {
		const amount = amounts.get(i);
		if (amount !== undefined) out.push({ slot: i, amount });
	}
	return out;
}
