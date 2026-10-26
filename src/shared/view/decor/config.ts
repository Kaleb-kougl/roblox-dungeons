/**
 * Decor tunables (docs/DECOR.md R3, R6, R8) that are Roblox-port choices rather than the web decor plan's own
 * constants (those keep their web names in ./decorPlan.ts: MAX_TALL_PER_ROOM, TALL_MIN_SPACING, MAX_DECOR_SHARE,
 * BULLET_Y, BULLET_PAD_PX, DECOR_BOX, WALL_DEPTH_BIAS). Presentation only: nothing here reaches the sim or a replay,
 * and none of it touches a Forge param (the Forge's props are the candidate set; these only thin, swap and re-weight).
 *
 * Kept in this folder rather than in `shared/config` (where docs/DECOR.md Phase 2 names DECOR_DEPTH) so the decor
 * plan's data lives with the module that owns it; move it if a non-view module ever needs it.
 */
import { PEDESTAL_RADIUS, SHRINE_RADIUS, STAIRWELL_RADIUS } from "shared/sim";

/** One depth band of DECOR_DEPTH (docs/DECOR.md Phase 2 part 1). Shares are fractions in [0, 1]. */
export interface DecorDepthBand {
	/** kept / worn / ruined / abyss. */
	readonly name: string;
	/** The band holds from this endless floor on (until the next band's). */
	readonly fromFloor: number;
	/** Flat clutter cap as a share of a room's floor tiles (the R3 cap MAX_DECOR_SHARE stays the ceiling). */
	readonly flatShare: number;
	/** Share of legal `column` / tall `pillar` spots drawn as the broken stump `columnBroken` (Lords of Pain column2). */
	readonly columnBrokenShare: number;
	/** Share of far-wall segments drawn broken (`wallBroken`, wall3) instead of whole (`wall`, wall2). */
	readonly wallBrokenShare: number;
	/** Weight of the clutter kinds (bones, debris: rocks / bricks) against the other flat kinds when a room is thinned. */
	readonly clutterWeight: number;
	/** Share of wall torches that start lit. */
	readonly litTorchShare: number;
	/** Ambient light multiplier (and the ambient particle rate multiplier, R9). */
	readonly light: number;
}

/**
 * Depth bands (docs/DECOR.md Phase 2 part 1; starting values, R15 tunes them). Bands go by endless floor, like the
 * breakables' (BREAKABLE.bands): kept 1-4, worn 5-9, ruined 10-14, abyss 15+. The boss floors (every 5th) sit on the
 * boundaries, so every boss floor opens on a new look.
 */
export const DECOR_DEPTH = {
	bands: [
		{
			name: "kept",
			fromFloor: 1,
			flatShare: 0.2,
			columnBrokenShare: 0,
			wallBrokenShare: 0,
			clutterWeight: 1,
			litTorchShare: 1,
			light: 1,
		},
		{
			name: "worn",
			fromFloor: 5,
			flatShare: 0.28,
			columnBrokenShare: 0.3,
			wallBrokenShare: 0.4,
			clutterWeight: 1.3,
			litTorchShare: 0.85,
			light: 0.9,
		},
		{
			name: "ruined",
			fromFloor: 10,
			flatShare: 0.34,
			columnBrokenShare: 0.6,
			wallBrokenShare: 0.7,
			clutterWeight: 1.7,
			litTorchShare: 0.65,
			light: 0.8,
		},
		{
			name: "abyss",
			fromFloor: 15,
			flatShare: 0.4,
			columnBrokenShare: 0.85,
			wallBrokenShare: 1,
			clutterWeight: 2,
			litTorchShare: 0.45,
			light: 0.7,
		},
	] as ReadonlyArray<DecorDepthBand>,
	/** Flat kinds the band's clutterWeight applies to (debris covers the pack's rocks and bricks). */
	clutterKinds: ["bones", "debris"] as ReadonlyArray<string>,
	/** Workspace attribute that forces a band in Studio (its index, 0 = kept); read by the client (R4). */
	forceBandAttribute: "KV_DecorBand",
} as const;

/**
 * Keep-out zones of the decor plan (the slice's interactables, docs/DECOR.md D3: they replace the web Delve's), tiles.
 * A piece whose cell centre is closer than a zone's radius to its centre is dropped.
 */
export const DECOR_CLEAR = {
	/** Chebyshev distance from any doorway cell within which nothing is drawn (R6 doorway jamb columns excepted). */
	doorTiles: 1,
	/** Around each treasure room's relic pedestal (its pickup radius plus a margin). */
	pedestalTiles: PEDESTAL_RADIUS + 1,
	/** Around each shrine room's shrine (its zone plus a margin): the shrine crystal under it is dropped. */
	shrineTiles: SHRINE_RADIUS + 1,
	/** Around the stairwell (the boss room's centre, also the boss arena centre). */
	stairwellTiles: STAIRWELL_RADIUS + 1,
	/** Around the boss arena centre (the boss's spot; the boss crystal there is dropped). */
	bossCentreTiles: 2,
	/** Around the entrance spawn (the entrance `ring` is its marker and is kept). */
	entranceTiles: 1.5,
} as const;

/** Far-wall dressing (docs/DECOR.md R6): wall segments on straight far-wall runs, columns at corners and jambs. */
export const DECOR_DRESSING = {
	/** A far-wall run this many tiles long or more gets wall segments; shorter runs get a column or nothing. */
	minRunTiles: 4,
	/** Wall cells one segment covers (Lords of Pain wall2 / wall3 are about 4 tiles long). */
	segmentTiles: 4,
} as const;

/** Placement details of the port (where pieces sit on their cell). */
export const DECOR_PLACE = {
	/** Height of a wall piece's anchor (torch, banner) on its face, tiles above the floor. */
	wallPieceHeightTiles: 0.65,
} as const;

/**
 * Salts of decorHash (one per independent choice), so e.g. a torch's lit roll and its variant never correlate.
 * Arbitrary distinct 32-bit values.
 */
export const DECOR_SALT = {
	variant: 0x1b873593,
	flat: 0x2c1b3c6d,
	column: 0x297a2d39,
	wall: 0x6b43a9b5,
	torch: 0x3d4d51cb,
} as const;
