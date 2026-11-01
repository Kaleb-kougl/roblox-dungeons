/**
 * Void decoration tunables (docs/VOID_DECOR.md VD2, VD4, VD5): the layers' heights and widths, the outcrop rules, the
 * per-band knobs, the set pieces' caps and spacing (VOID_PIECES, read by shared/view/decor's planDecor), the debug
 * attributes and the hash salts. Presentation only: nothing here reaches the sim, a replay or a Forge param.
 * Starting values from the plan; VD11 tunes them in Studio.
 */
import { GAME_WORLD } from "../config";

/** Share of the wall height the shoulder's top sits at (VDD6: below the wall top, so walls keep a crisp lip). */
const SHOULDER_TOP_SHARE = 0.85;

/** The void planner's tunables (heights in tiles above the floor; distances are Chebyshev, in tiles). */
export const VOID = {
	/** Every void cell within this distance of a wall / floor cell is shoulder (VDD5: no wall over the abyss). */
	shoulderMinTiles: 1,
	/** Top of the shoulder (and of the tall outcrops), tiles above the floor: 0.85 x the wall height. */
	shoulderTopTiles: SHOULDER_TOP_SHARE * GAME_WORLD.wallHeightTiles,
	/** Top of the ledge (and of the low outcrops), tiles above the floor. */
	ledgeTopTiles: 0.35,
	/** The abyss lies this far under the floor, tiles (abyss cells carry top = -abyssDepthTiles). */
	abyssDepthTiles: 5,
	/** An enclosed void pocket whose deepest cell is within this distance of a wall fills solid with shoulder. */
	pocketFillTiles: 4,
	/**
	 * Lattice spacing of the shoulder's width noise, tiles: the band's extra width is value noise interpolated between
	 * lattice points this far apart, so the edge is ragged over a few tiles, never cell-to-cell salt and pepper.
	 */
	shoulderNoiseTiles: 8,
	/** The ledge breaks up in square chunks this many tiles wide (one keep roll per chunk), not per cell. */
	ledgeChunkTiles: 3,
	/** Outcrops seed only at void cells at least this far from a wall / floor cell. */
	outcropMinDist: 4,
	/** ... and at most this far. */
	outcropMaxDist: 8,
	/** An outcrop grows to between 1 and this many cells (4-connected). */
	outcropMaxCells: 4,
	/** Share of outcrops at shoulder height (the rest at ledge height). Never above the shoulder top (VD5 adds tall). */
	outcropShoulderShare: 0.5,
	/** Outcrop rates in VOID_DEPTH are per this many eligible cells. */
	outcropRatePer: 100,
	/** Greedy rectangles (one Part each) per floor, at most (the VD2 budget, checked over the census seeds). */
	maxRects: 500,
	/**
	 * Hash salts (decorHash's third argument), one per independent choice; distinct from DECOR_SALT's.
	 * Arbitrary distinct 32-bit values.
	 */
	salt: {
		/** The shoulder width noise's lattice values. */
		shoulderNoise: 0x5bd1e995,
		/** The ledge's keep roll per chunk. */
		ledge: 0x7feb352d,
		/** An outcrop seed's roll per eligible cell. */
		outcropSeed: 0x846ca68b,
		/** An outcrop's size. */
		outcropSize: 0x2545f491,
		/** An outcrop's growth direction per step. */
		outcropGrow: 0x68e31da4,
		/** An outcrop's height (shoulder or ledge). */
		outcropTop: 0x1b56c4e9,
	},
	/** Lattice coordinates key the noise hash as ly * latticeStride + lx (any grid fits under it). */
	latticeStride: 4096,
} as const;

/**
 * The void set pieces (docs/VOID_DECOR.md VD5): what planDecor stands and lays on the void's surfaces when it is given a
 * VoidPlan (DecorSource "void"). Distances in tiles; starting values from the plan, VD11 tunes them. Every piece passes
 * the footprint rule at its surface's height (standing pieces) or lies wholly on one surface (flat pieces, `flatRadiusTiles`).
 */
export const VOID_PIECES = {
	/** Standing void pieces (ruin runs, columns, stumps, biome kinds) per room, at most ... */
	tallPerRoom: 4,
	/** ... and low curbs per room on top of them (the per-floor cap maxStanding counts both). */
	curbPerRoom: 2,
	/**
	 * VDD2, far side only: a standing piece's room must lie screen-down of each of its cells: marching along (+1, +1)
	 * (toward the camera) across the void and the wall, the first walkable cell is that room's, reached within the
	 * cell's field distance + 1 plus this many steps (the slack lets a piece just past a room's back corner count) ...
	 */
	farSideSlackTiles: 2,
	/** ... and no floor or pool cell lies within this many steps screen-up of it along (-1, -1) (no room's near side). */
	nearSideReachTiles: 6,
	/** Standing void pieces stand at least this far apart (Euclidean, between their nearest footprint cells). */
	tallMinSpacing: 3,
	/** ... and at least this far from every decor standing piece (Forge tall, far-wall dressing) and wall piece (torch). */
	decorClearTiles: 2,
	/** Standing void pieces per floor, at most (the plan's target: <= 80 tall / low). */
	maxStanding: 80,
	/** Flat void pieces per floor, at most (the plan's target: <= 200) ... */
	maxFlat: 200,
	/** ... and at most this share of the floor's shoulder cells. */
	flatShare: 0.25,
	/**
	 * A flat void piece is drawn no wider than this from its pivot (world tiles: DecorController scales larger art down,
	 * decorPieceLayout), and every cell within that radius must be the same void surface (layer and top), so it never
	 * hangs over a wall, the abyss or a lower step.
	 */
	flatRadiusTiles: 1.25,
	/** Flat void pieces lie at least this far apart (Euclidean, cell centres): two decals never overlap. */
	flatMinSpacing: 2.5,
	/**
	 * Flat candidates are taken at hashed gaps along the scan (one hash per piece, not per cell): the mean gap, in
	 * eligible cells. Larger = sparser.
	 */
	flatGap: 6,
	/** Ruin runs (`wall` / `wallBroken`) stand on straight shoulder rows exactly this far from the wall (field distance). */
	ruinDist: 2,
	/** Columns stand on shoulder cells this far from the wall, at least ... */
	columnMinDist: 2,
	/** ... and at most. */
	columnMaxDist: 3,
	/** Column candidates are tried at hashed gaps along the scan: the mean gap, in eligible cells. */
	columnGap: 4,
	/** A curb (`curb`, low) covers this many cells along a straight outer shoulder edge. */
	curbTiles: 3,
	/** Flagstone patches lie only on shoulder cells of a room (not a corridor) at most this far from its wall. */
	flagstoneMaxDist: 3,
	/** Share of column spots that take a biome void kind (decor.void.b<n>.<kind>) when the pack has art for one. */
	biomeShare: 0.5,
	/** Flat kinds every biome lays on the void (round clutter: the pack's rocks / bricks). */
	flatKinds: ["debris"] as ReadonlyArray<string>,
	/** Extra flat kinds per biome: bones in grim, moss in verdant (by BiomeId). */
	biomeFlatKinds: { "biome.4": ["bones"], "biome.5": ["moss"] } as Readonly<Record<string, ReadonlyArray<string>>>,
	/**
	 * Hash salts (decorHash's third argument), one per independent choice; distinct from DECOR_SALT's and VOID.salt's.
	 * Arbitrary distinct 32-bit values.
	 */
	salt: {
		/**
		 * A placed piece's one hash: its variant and facing, whole vs broken (the depth profile's columnBrokenShare /
		 * wallBrokenShare), a flat piece's kind, and the scan's next gap.
		 */
		variant: 0x4cf5ad43,
		/** The column and flat scans' first gaps. */
		gap: 0x5f356495,
		/** A column spot taking a biome void kind, and which one. */
		biome: 0x3c6ef372,
	},
} as const;

/** One depth band's void knobs (docs/VOID_DECOR.md "Depth bands"); index = DECOR_DEPTH.bands' index. */
export interface VoidDepthBand {
	/** The decor band this row belongs to (kept / worn / ruined / abyss); must match DECOR_DEPTH.bands[i].name. */
	readonly name: string;
	/** Shoulder width past VOID.shoulderMinTiles: at least this many tiles ... */
	readonly shoulderExtraMin: number;
	/** ... and at most this many (per cell, from the smoothed noise). */
	readonly shoulderExtraMax: number;
	/** Share of the ledge rim (chunks) kept, [0, 1]. */
	readonly ledgeKeep: number;
	/** Outcrop seeds per VOID.outcropRatePer eligible mid-band cells. */
	readonly outcropRate: number;
}

/**
 * Per-band void knobs (VD4), read through decorProfile's band (so KV_DecorBand forces them too). The shoulder wears
 * down with depth: narrower, its ledge more broken, more outcrops standing alone in the abyss.
 */
export const VOID_DEPTH = {
	bands: [
		{ name: "kept", shoulderExtraMin: 2, shoulderExtraMax: 3, ledgeKeep: 0.9, outcropRate: 1 },
		{ name: "worn", shoulderExtraMin: 2, shoulderExtraMax: 3, ledgeKeep: 0.75, outcropRate: 1.2 },
		{ name: "ruined", shoulderExtraMin: 1, shoulderExtraMax: 3, ledgeKeep: 0.6, outcropRate: 1.5 },
		{ name: "abyss", shoulderExtraMin: 1, shoulderExtraMax: 2, ledgeKeep: 0.4, outcropRate: 2 },
	] as ReadonlyArray<VoidDepthBand>,
} as const;
