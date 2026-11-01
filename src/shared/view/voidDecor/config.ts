/**
 * Void decoration tunables (docs/VOID_DECOR.md VD2, VD4): the layers' heights and widths, the outcrop rules, the
 * per-band knobs and the hash salts. Presentation only: nothing here reaches the sim, a replay or a Forge param.
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
