/**
 * Silver in crates on screen: presentation tunables (docs/SILVER.md SC3, "Silver in crates" player experience). Data
 * only: crateFx.ts reads it. The twinkle on a Silver piece is the boost pieces' own (BREAKABLE_LOOT_VIEW, OC8 /
 * SVD21): nothing here changes it.
 *
 * @module
 */

/**
 * The shape of the Silver crate effect's tunables: the `+N` pop, the coins flying to the counter, the clink and the
 * Studio label.
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

/**
 * The Silver crate effect in play (crateFx.ts reads it): a `+N` pop that rises 1.1 tiles over 0.9 s, 2 to 6 coins per
 * piece (one per 2 Silver) that hop for 0.35 s and then fly to the counter in 0.45 s, and a clink that climbs 2
 * semitones per break made within 0.6 s of the last, up to 6 steps. The per-frame caps (3 pops, 12 coins, 1 clink) keep
 * a chain of breaks from flooding the screen.
 */
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

/**
 * The live Silver counter in play (counter.ts and tracker.ts read it): the `+N` beside it shows 1.4 s after the last
 * gain (fading over its last 0.5 s) and gains within 0.6 s add into it; the gain sound plays at most once per 0.15 s.
 * Sizes are reference px; `glyphAspect` and `minFloorText` drive the row fit (`silverRowFit`).
 */
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

/**
 * The run-over Silver rows in play (recap.ts reads it): the run row starts counting up 0.3 s in and takes 0.8 s; the
 * desktop panel draws 4 rows a line on up to 2 lines, the upright one 2 a line on up to 4, a landscape phone 2 a line
 * on up to 2; the client's own (not yet confirmed) figures draw at 0.45 transparency.
 */
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

/**
 * Buying with Silver in play (shared/view/menu armory.ts reads it): a buy is a 0.4 s hold, a purchase
 * with no answer is given up after 10 s, and the result line shows for 2.5 s. All real-time seconds.
 */
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
	/**
	 * With the pack's `fx.silver.coins` downloaded the coin is that flipbook instead: its cell at this many screen px per
	 * art px (whole, Pixelated; the art is drawn at the in-run frames' density, docs/UI_ART.md).
	 */
	readonly coinArtScale: number;
	/** The pop's glyphs, a share of the kill score pops' (SCORE_POP_GLYPH_PX). */
	readonly popScale: number;
	/** Where coins fly with no counter on screen: this far in from the coin layer's top-right corner (px). */
	readonly cornerInsetPx: number;
	/** The coin layer's DisplayOrder (over the world, with the HUD). */
	readonly coinDisplayOrder: number;
	/** The clink's volume scale. */
	readonly clinkVolume: number;
}

/**
 * The crate burst's drawing limits in play: at most 8 pops and 32 coins alive at once, a 7 px coin, pops at 0.85 of the
 * score pops' size, and the clink at 0.8 volume. Pixel values are screen px.
 */
export const SILVER_BURST_VIEW: SilverBurstViewTunables = table.freeze({
	maxAlivePops: 8,
	maxAliveCoins: 32,
	coinPx: 7,
	coinArtScale: 1,
	popScale: 0.85,
	cornerInsetPx: 48,
	coinDisplayOrder: 5,
	clinkVolume: 0.8,
});
