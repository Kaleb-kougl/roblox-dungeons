/**
 * Silver in crates on screen: presentation tunables (docs/SILVER.md SC3, "Silver in crates" player experience). Data
 * only: crateFx.ts reads it. The twinkle on a Silver piece is the boost pieces' own (BREAKABLE_LOOT_VIEW, OC8 /
 * SVD21): nothing here changes it.
 */

export interface SilverCrateFxTunables {
	// --- The `+N` pop that rises from a broken Silver piece --------------------------------------------------------
	/** How long a pop shows, seconds (real time). */
	readonly popSeconds: number;
	/** How far it rises over its life, tiles (up the screen). */
	readonly popRiseTiles: number;
	/** It starts at this height over the piece's cell centre, tiles. */
	readonly popStartTiles: number;
	/** It fades out over the last share of its life (0..1). */
	readonly popFadeShare: number;
	/** At most this many new pops a frame (the rest still tick the counter; their Silver joins the last pop shown). */
	readonly maxPopsPerFrame: number;

	// --- The coins: hop once off the piece, then fly to the Silver counter -----------------------------------------
	/** One coin per this much Silver (rounded up), within [minCoins, maxCoins] per piece. */
	readonly silverPerCoin: number;
	readonly minCoins: number;
	readonly maxCoins: number;
	/** At most this many new coins a frame over every break (a cap on noise, docs/SILVER.md Risks). */
	readonly maxCoinsPerFrame: number;
	/** The hop: seconds, its peak over the floor (tiles) and how far a coin lands from the cell centre (tiles). */
	readonly hopSeconds: number;
	readonly hopTiles: number;
	readonly spreadTiles: number;
	/** The flight to the counter after the hop, seconds; coins leave one after another this far apart. */
	readonly flySeconds: number;
	readonly flyStaggerSeconds: number;
	/** Seed salt of the coins' render rng (shared/view/fx burstSeed; never the sim's). */
	readonly coinSalt: number;

	// --- The clink (sfx.silver.crate), climbing a step for quick successive breaks --------------------------------
	/** A break within this many seconds of the last one climbs a step; a longer gap starts again at step 0. */
	readonly chainWindowSeconds: number;
	/** Semitones per step, and the highest step. */
	readonly semitonesPerStep: number;
	readonly maxStep: number;
	/** At most this many clinks a frame (several breaks on one frame clink once, at the frame's last step). */
	readonly maxClinksPerFrame: number;

	// --- KV_SilverLabel (Studio check aid, off by default) ----------------------------------------------------------
	/** The Workspace attribute that labels every Silver piece with its stack (shared/view silverDebugText). */
	readonly labelAttribute: string;
}

export const SILVER_CRATE_FX: SilverCrateFxTunables = table.freeze({
	popSeconds: 0.9,
	popRiseTiles: 1.1,
	popStartTiles: 0.6,
	popFadeShare: 0.35,
	maxPopsPerFrame: 3,
	silverPerCoin: 2,
	minCoins: 2,
	maxCoins: 6,
	maxCoinsPerFrame: 12,
	hopSeconds: 0.35,
	hopTiles: 0.7,
	spreadTiles: 0.45,
	flySeconds: 0.45,
	flyStaggerSeconds: 0.04,
	coinSalt: 0x53,
	chainWindowSeconds: 0.6,
	semitonesPerStep: 2,
	maxStep: 6,
	maxClinksPerFrame: 1,
	labelAttribute: "KV_SilverLabel",
});

/** The live Silver counter on the score panel's floor / Depth line (docs/SILVER.md SV8, OC20). */
export interface SilverCounterTunables {
	/** The counter's `+N` shows this long after its last gain, seconds (real time), fading over its last fadeSec. */
	readonly showSec: number;
	readonly fadeSec: number;
	/** Gains within this many seconds of the last one add into the `+N` showing. */
	readonly mergeSec: number;
	/** The icon's box (reference px; the fallback chip is drawn in it), and the gap after it and after the number. */
	readonly iconPx: number;
	readonly gap: number;
	/** The widest number the fit spec allows for (digits) and the widest `+N` (characters). */
	readonly fitDigits: number;
	readonly fitGainChars: number;
	/** The gain sound (sfx.silver.gain) plays at most once per this many seconds (a frame of several gains: once). */
	readonly gainSoundGapSec: number;
	/** The gain sound's volume scale. */
	readonly gainVolume: number;
	/** The counter's number text size (reference px; the floor line's own size is HUD_VIEW.smallText). */
	readonly numberText: number;
	/**
	 * The row's fit (silverRowFit): text is estimated at glyphAspect px of advance per px of size per byte (the HUD
	 * font's, as the room-clear tally's: provisional until the Studio check measures TextBounds), and the floor line
	 * scales down to the room the counter leaves, never under minFloorText (fit spec: the widest floor / Depth line
	 * with a fitDigits counter).
	 */
	readonly glyphAspect: number;
	readonly minFloorText: number;
}

export const SILVER_COUNTER: SilverCounterTunables = table.freeze({
	showSec: 1.4,
	fadeSec: 0.5,
	mergeSec: 0.6,
	iconPx: 12,
	gap: 3,
	fitDigits: 4,
	fitGainChars: 4,
	gainSoundGapSec: 0.15,
	gainVolume: 0.7,
	numberText: 14,
	glyphAspect: 0.62,
	minFloorText: 10,
});

/** The run-over panel's Silver rows (docs/SILVER.md SV8, "Run over"). */
export interface SilverRecapTunables {
	/** The run row counts up after this delay, over this long (seconds, real time). */
	readonly delaySec: number;
	readonly countSec: number;
	/**
	 * Rows per drawn line by run-over layout (wide: the desktop panel; narrow: upright; compact: a landscape phone), and
	 * the most lines each draws (full: 7 rows; compact, its bonuses folded: 4). The block takes the run-over panel's
	 * info line's place; wide holds four a line so the desktop panel keeps its full size at 1280 x 720 (fit.spec).
	 */
	readonly perLine: { readonly wide: number; readonly narrow: number; readonly compact: number };
	readonly maxLines: { readonly wide: number; readonly narrow: number; readonly compact: number };
	/** The dimmed (client) figures' text transparency. */
	readonly dimTransparency: number;
}

export const SILVER_RECAP: SilverRecapTunables = table.freeze({
	delaySec: 0.3,
	countSec: 0.8,
	perLine: table.freeze({ wide: 4, narrow: 2, compact: 2 }),
	maxLines: table.freeze({ wide: 2, narrow: 4, compact: 2 }),
	dimTransparency: 0.45,
});

/** Buying in the Armory and on the character screen (docs/SILVER.md "The Armory", SV9 / SV18). */
export interface SilverShopTunables {
	/** A buy is a press held this long (seconds); a confirm only from shared/wallet CONFIRM_FROM_TIER. */
	readonly holdSec: number;
	/** A purchase with no answer in this long is given up (the button works again; seconds). */
	readonly buyTimeoutSec: number;
	/** The result line under the button shows this long (seconds). */
	readonly resultSec: number;
}

export const SILVER_SHOP: SilverShopTunables = table.freeze({
	holdSec: 0.4,
	buyTimeoutSec: 10,
	resultSec: 2.5,
});

/** How the client draws the crate burst (docs/SILVER.md SV8: pops under every bullet's notice, coins to the counter). */
export interface SilverBurstViewTunables {
	/** Pooled pops alive at once (each lives SILVER_CRATE_FX.popSeconds) and coins in flight at once. */
	readonly maxAlivePops: number;
	readonly maxAliveCoins: number;
	/** A coin's side on screen (px) and its rim. */
	readonly coinPx: number;
	/** The pop's glyphs, a share of the kill score pops' (SCORE_POP_GLYPH_PX). */
	readonly popScale: number;
	/** Where coins fly with no counter on screen: this far in from the coin layer's top-right corner (px). */
	readonly cornerInsetPx: number;
	/** The coin layer's DisplayOrder (over the world, with the HUD). */
	readonly coinDisplayOrder: number;
	/** The clink's volume scale. */
	readonly clinkVolume: number;
}

export const SILVER_BURST_VIEW: SilverBurstViewTunables = table.freeze({
	maxAlivePops: 8,
	maxAliveCoins: 32,
	coinPx: 7,
	popScale: 0.85,
	cornerInsetPx: 48,
	coinDisplayOrder: 5,
	clinkVolume: 0.8,
});
