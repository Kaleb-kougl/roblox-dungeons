/**
 * Local prediction on screen (docs/LOCAL_PREDICTION.md Design 4): the PredictionSmoother's tunables. Presentation only.
 * All provisional until LP8 (the playtest); the predictor's own (horizon, stats) are shared/lockstep PREDICTION.
 */
export interface PredictionViewTunables {
	/** A correction's visual offset halves every this many seconds of real time (mostly gone in ~4 frames). */
	readonly halfLifeSec: number;
	/** A correction larger than this (tiles) snaps instead of gliding: teleports, clamps, a floor change. */
	readonly snapTiles: number;
	/** The drawn body is never farther than this (tiles) from the prediction. */
	readonly maxOffsetTiles: number;
}

export const PREDICTION_VIEW: PredictionViewTunables = table.freeze({
	halfLifeSec: 0.06,
	snapTiles: 1.0,
	maxOffsetTiles: 1.0,
});

/**
 * Enemy bullets drawn ahead (docs/LOCAL_PREDICTION.md Design 5, LP10, LPD9): the bullet renderers draw every enemy
 * bullet `aheadTicks` ticks past the merged state, the ticks the local knight is drawn ahead. Presentation only.
 */
export interface BulletAheadTunables {
	/**
	 * The most ticks a bullet is drawn ahead (the predictor's own cap, shared/lockstep PREDICTION.maxTicks, is the real
	 * limit; this keeps the view's scratch bounded if it is raised).
	 */
	readonly maxTicks: number;
}

export const BULLET_AHEAD: BulletAheadTunables = table.freeze({
	maxTicks: 30,
});
