/**
 * Breakable loot (docs/BREAKABLE_DROPS.md BL1, decisions BLD1 / BLD2 / BLD8; a Roblox-port feature, no web source):
 * which barrels and crates of an endless floor hold a boost, and which boost. Decided when the floor is built, a PURE
 * function of the floor like the rest of ./endless.ts, so live play, every co-op client and the server's replay agree,
 * the sim draws no rng for it, and break order or breaker never matters.
 *
 *   stream   its own: new EncounterRng(breakableLootSeed(floor seed)) = mulberry32 from (seed ^ BREAKABLE_LOOT.salt),
 *            run after the breakables; it only reads the placed pieces and the room bounds, so the layout, digest,
 *            props, spawns, pieces, boss pick and affixes never move.
 *   count    ONE draw: rng.int(band.min, band.max) for the floor's band (BREAKABLE_LOOT.bands), capped by the pieces.
 *   pieces   that many times: the candidates are the pieces (placement order) not loaded yet and not in a room that
 *            already holds maxPerRoom loaded pieces (room = roomAt on the piece's cell centre; a piece in no room has no
 *            cap). None left: stop. Else ONE weighted draw over them (pieceWeight by kind: rng.int(0, total - 1)
 *            walked in placement order), then ONE weighted draw of the boost kind (kindWeights, the sim's BOOSTS
 *            weights, walked in Boost order).
 *   draws    1 + 2 per loaded piece (fewer loaded pieces than the count only when the candidates run out).
 *   every    (BreakableLootForce.everyRoom, docs/FLOOR_MODIFIERS.md FM2: the Plunder floor) the count draw is still
 *            made and ignored; then, per room holding a weighted piece (breakableLootRooms: room id order; a piece in no
 *            room is no room's), ONE weighted draw over that room's pieces (placement order) and ONE kind draw: one
 *            loaded piece in every such room (maxPerRoom permitting). Absent: the floor exactly as before.
 *
 * Output: the loaded pieces as { slot (index into the floor's breakables), kind (shared/sim Boost index) }, in slot
 * order.
 *
 * @module
 */
import { u32 } from "shared/jsmath";
import { gridToWorld } from "./collision";
import { EncounterRng } from "./encounter";
import { roomAt, type EncounterConfig } from "./encounterTypes";
import type { BreakablePlacement } from "./breakables";
import { BREAKABLE_LOOT, type BreakableLootBand } from "./breakableLootData";
import type { BreakablePieceKindName } from "./breakablesData";

/** One loaded piece: its breakable slot (placement index) and the boost kind it holds (shared/sim Boost index). */
export interface BreakableLoot {
	readonly slot: number;
	readonly kind: number;
}

/** A piece in no room (roomAt undefined): never capped by maxPerRoom. */
const NO_ROOM = -1;

/** Seed of the loot stream: the floor seed with BREAKABLE_LOOT.salt mixed in (uint32). */
export function breakableLootSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), BREAKABLE_LOOT.salt);
}

/** The loot band of `floor` (the last band whose fromFloor <= floor). */
export function breakableLootBand(floor: number): BreakableLootBand {
	const bands = BREAKABLE_LOOT.bands;
	let out = bands[0];
	for (const b of bands) if (floor >= b.fromFloor) out = b;
	return out;
}

/**
 * The piece pick's weight of a piece of `kind` (BREAKABLE_LOOT.pieceWeight); 0 for a kind it has no entry for (a
 * vault's chest, docs/TREASURE.md: never loaded, and appended after the loot is picked anyway).
 */
export function lootPieceWeight(kind: BreakablePieceKindName): number {
	return (BREAKABLE_LOOT.pieceWeight as Readonly<Partial<Record<BreakablePieceKindName, number>>>)[kind] ?? 0;
}

/** The sum of BREAKABLE_LOOT.kindWeights (the kind draw's range). */
function kindTotalWeight(): number {
	let w = 0;
	for (const k of BREAKABLE_LOOT.kindWeights) w += k;
	return w;
}

/** One weighted kind pick: ONE rng.int(0, total - 1), walked in kind order. */
function pickKind(rng: EncounterRng): number {
	const weights = BREAKABLE_LOOT.kindWeights;
	let roll = rng.int(0, kindTotalWeight() - 1);
	for (let k = 0; k < weights.size(); k++) {
		if (roll < weights[k]) return k;
		roll -= weights[k];
	}
	return weights.size() - 1; // unreachable: the roll is below the total weight
}

/** placeBreakableLoot's force flag (docs/FLOOR_MODIFIERS.md FM2). Absent or empty: the natural roll. */
export interface BreakableLootForce {
	/** One loaded piece in every room that holds a weighted piece (the file comment's "every"). Plunder floors. */
	readonly everyRoom?: boolean;
}

/** The room id of every piece (roomAt on its cell centre; NO_ROOM for none), placement order. */
function pieceRooms(pieces: ReadonlyArray<BreakablePlacement>, encounter: EncounterConfig): number[] {
	const rooms: number[] = [];
	for (const p of pieces) rooms.push(roomAt(encounter, gridToWorld(p.x), gridToWorld(p.y))?.id ?? NO_ROOM);
	return rooms;
}

/** The rooms of `rooms` (pieceRooms) holding a piece of weight > 0, ascending, each once (NO_ROOM never). */
function weightedRooms(rooms: ReadonlyArray<number>, weights: ReadonlyArray<number>): number[] {
	const seen = new Set<number>();
	const out: number[] = [];
	for (let i = 0; i < rooms.size(); i++) {
		const room = rooms[i];
		if (room === NO_ROOM || weights[i] <= 0 || seen.has(room)) continue;
		seen.add(room);
		out.push(room);
	}
	out.sort((a, b) => a < b);
	return out;
}

/**
 * The encounter rooms (ids, ascending) that hold at least one piece the loot can load (lootPieceWeight > 0; a piece in
 * no room counts for none): the rooms a Plunder floor loads (docs/FLOOR_MODIFIERS.md FM2). Pure; draws nothing.
 */
export function breakableLootRooms(pieces: ReadonlyArray<BreakablePlacement>, encounter: EncounterConfig): number[] {
	const weights: number[] = [];
	for (const p of pieces) weights.push(lootPieceWeight(p.kind));
	return weightedRooms(pieceRooms(pieces, encounter), weights);
}

/**
 * The loaded pieces of floor `floor` (seed `floorSeed`) whose breakables are `pieces` (placement order) in the rooms of
 * `encounter` (see the file comment). Pure and deterministic. `force.everyRoom`: the Plunder floor (file comment).
 */
export function placeBreakableLoot(
	floorSeed: number,
	floor: number,
	pieces: ReadonlyArray<BreakablePlacement>,
	encounter: EncounterConfig,
	force?: BreakableLootForce,
): BreakableLoot[] {
	const rng = new EncounterRng(breakableLootSeed(floorSeed));
	const band = breakableLootBand(floor);
	const count = math.min(rng.int(band.min, band.max), pieces.size());
	const rooms = pieceRooms(pieces, encounter);
	const weights: number[] = [];
	for (const p of pieces) weights.push(lootPieceWeight(p.kind));
	const loaded = new Map<number, number>(); // slot -> kind
	const perRoom = new Map<number, number>();
	if (force?.everyRoom === true) {
		for (const room of weightedRooms(rooms, weights)) {
			if ((perRoom.get(room) ?? 0) >= BREAKABLE_LOOT.maxPerRoom) continue;
			let total = 0;
			for (let i = 0; i < pieces.size(); i++) if (rooms[i] === room && !loaded.has(i)) total += weights[i];
			if (total <= 0) continue;
			let roll = rng.int(0, total - 1);
			let slot = -1;
			for (let i = 0; i < pieces.size(); i++) {
				if (rooms[i] !== room || loaded.has(i) || weights[i] <= 0) continue;
				if (roll < weights[i]) {
					slot = i;
					break;
				}
				roll -= weights[i];
			}
			loaded.set(slot, pickKind(rng));
			perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
		}
	}
	const natural = force?.everyRoom === true ? 0 : count;
	for (let k = 0; k < natural; k++) {
		let total = 0;
		const open: boolean[] = [];
		for (let i = 0; i < pieces.size(); i++) {
			const room = rooms[i];
			const ok =
				!loaded.has(i) &&
				weights[i] > 0 &&
				(room === NO_ROOM || (perRoom.get(room) ?? 0) < BREAKABLE_LOOT.maxPerRoom);
			open.push(ok);
			if (ok) total += weights[i];
		}
		if (total <= 0) break;
		let roll = rng.int(0, total - 1);
		let slot = -1;
		for (let i = 0; i < pieces.size(); i++) {
			if (!open[i]) continue;
			if (roll < weights[i]) {
				slot = i;
				break;
			}
			roll -= weights[i];
		}
		loaded.set(slot, pickKind(rng));
		const room = rooms[slot];
		if (room !== NO_ROOM) perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
	}
	const out: BreakableLoot[] = [];
	for (let i = 0; i < pieces.size(); i++) {
		const kind = loaded.get(i);
		if (kind !== undefined) out.push({ slot: i, kind });
	}
	return out;
}
