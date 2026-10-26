/**
 * Breakable clutter placement tunables (docs/DECOR.md Phase 2 part 4, decisions B1 / B6, task R11). Data only:
 * ./breakables.ts reads it, nothing is inline in the logic. The sim-side numbers (toughness, damage, score points)
 * live in shared/sim (breakables/breakablesData.ts, score/scoreData.ts).
 *
 * Distances are in tiles (TILE_SIZE = 1 world unit), measured between tile centers unless a rule says otherwise.
 */
import type { EncounterRoomType } from "./encounterTypes";

/** The two kinds of piece, in the sim's kind index order (shared/sim BreakableKind: barrel 0, crate 1). */
export const BREAKABLE_KINDS = ["barrel", "crate"] as const;
export type BreakableKindName = (typeof BREAKABLE_KINDS)[number];

/** A depth band of the descent (docs/DECOR.md Phase 2 part 1: kept 1-4, worn 5-9, ruined 10-14, abyss 15+). */
export interface BreakableBand {
	readonly name: string;
	/** The band's first floor. */
	readonly fromFloor: number;
	/** Pieces per reference room (B6), drawn uniformly in [min, max], then scaled by the room's area. */
	readonly min: number;
	readonly max: number;
}

export interface BreakableTunables {
	/** Mixed into the floor seed for the placement stream (never the Forge's own stream). */
	readonly salt: number;
	/** Room types that get pieces (B6): never the entrance, shrine, boss room or corridors. */
	readonly roomTypes: ReadonlyArray<EncounterRoomType>;
	/** No piece within this distance of a doorway cell (strictly closer is refused). */
	readonly doorClearTiles: number;
	/** ... of a deferred room spawn. */
	readonly spawnClearTiles: number;
	/** ... of the entrance spawn. */
	readonly entranceClearTiles: number;
	/** ... of the stairwell (shared/sim STAIRWELL_RADIUS 1, + 1; a spec checks it). */
	readonly stairwellClearTiles: number;
	/** ... of a TREASURE room's relic pedestal (its centre floor tile; shared/sim PEDESTAL_RADIUS 0.5, + 1.5). */
	readonly pedestalClearTiles: number;
	/** ... of a SHRINE room's curse shrine (its centre floor tile; shared/sim SHRINE_RADIUS 1, + 1). */
	readonly shrineClearTiles: number;
	/** No piece within this Chebyshev distance of a POOL cell (liquid pits block movement already). */
	readonly poolClearTiles: number;
	/**
	 * Two solids (wall, solid pillar, pool, another piece) either touch or leave at least this much free space between
	 * their tile squares, so the largest enemy (bruiser, radius 0.5) always fits round them.
	 */
	readonly minGapTiles: number;
	/** Depth bands, by first floor ascending. */
	readonly bands: ReadonlyArray<BreakableBand>;
	/** A band's [min, max] is per room of this many floor tiles; a room gets floor(draw x its tiles / this). */
	readonly referenceRoomTiles: number;
	/** At most this many pieces in one room. */
	readonly maxPerRoom: number;
	/** Wall clusters hold this many pieces (the last one of a room may be smaller). */
	readonly clusterMin: number;
	readonly clusterMax: number;
	/** The one optional lone mid-room piece: combat rooms whose floor spans at least this many tiles both ways. */
	readonly loneMinRoomSide: number;
	/** ... drawn with this chance (one rng draw per eligible room with a non-zero count). */
	readonly loneChance: number;
	/** ... on a cell with no non-FLOOR cell within this Chebyshev distance (mid-room cover, not wall clutter). */
	readonly loneWallClearTiles: number;
	/** A room gives up after this many rejected seed draws (cluster seeds and the lone piece). */
	readonly seedTries: number;
	/** Chance that a piece is a crate (else a barrel), one draw per piece. */
	readonly crateShare: number;
}

export const BREAKABLE: BreakableTunables = table.freeze({
	salt: 0x5bd1e995,
	roomTypes: table.freeze(["combat", "elite", "treasure"] as EncounterRoomType[]),
	doorClearTiles: 3,
	spawnClearTiles: 1.5,
	entranceClearTiles: 3,
	stairwellClearTiles: 2,
	pedestalClearTiles: 2,
	shrineClearTiles: 2,
	poolClearTiles: 1,
	minGapTiles: 2,
	bands: table.freeze([
		table.freeze({ name: "kept", fromFloor: 1, min: 0, max: 2 }),
		table.freeze({ name: "worn", fromFloor: 5, min: 1, max: 3 }),
		table.freeze({ name: "ruined", fromFloor: 10, min: 2, max: 4 }),
		table.freeze({ name: "abyss", fromFloor: 15, min: 3, max: 6 }),
	]),
	referenceRoomTiles: 150,
	maxPerRoom: 16,
	clusterMin: 2,
	clusterMax: 4,
	loneMinRoomSide: 10,
	loneChance: 0.5,
	loneWallClearTiles: 3,
	seedTries: 12,
	crateShare: 0.5,
});
