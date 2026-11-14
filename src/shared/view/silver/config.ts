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
