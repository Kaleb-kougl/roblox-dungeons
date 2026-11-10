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
