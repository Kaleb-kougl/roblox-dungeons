/**
 * Rollback spike tunables (docs/ROLLBACK_SPIKE.md). Data only: the spike's modules read these, nothing is inlined in
 * logic. One plain readonly object so the spike's other tasks (model, probe, capture, live metrics) add their fields
 * here.
 */
export interface RollbackSpikeConfig {
	/**
	 * Design 5: the parallel worker steps a prediction in slices of this many ticks with a yield between them, so no
	 * single parallel task runs long.
	 */
	readonly sliceTicks: number;
	/** Design 5: the probe's statistics window (p50 / p95 / max, the `[Rollback]` line, one `ProbeSummary`), seconds. */
	readonly statsWindowSec: number;
	/** Design 7: the live metrics' summary period (one summary to the server), seconds. */
	readonly liveSummarySec: number;
	/** Design 5: the worker mirror sends its `hashState` back every this many ticks (the main thread compares). */
	readonly mirrorHashTicks: number;
	/** Design 2 / 5: the view digest's actor slots (and the digest buffer's size with the two below). */
	readonly digestActors: number;
	/** Design 2 / 5: the view digest's bullet slots. */
	readonly digestBullets: number;
	/** Design 2 / 5: the view digest's player slots. */
	readonly digestPlayers: number;
	/** Design 5: the probe's horizons H (ticks stepped ahead of the confirmed state per prediction). */
	readonly horizons: ReadonlyArray<number>;
	/** Design 2 (task R2), the prediction model's tunables. */
	readonly model: RollbackModelConfig;
}

/**
 * The prediction model's tunables (docs/ROLLBACK_SPIKE.md Design 2-4, task R2: model.ts, digest.ts, metrics.ts). One
 * model runs headless over recordings (harness.ts) and live in the client's worker (R4b), so every capacity is fixed
 * and preallocated.
 */
export interface RollbackModelConfig {
	/** H when the caller gives none: the drawn tick is at most this many ticks past the confirmed one. */
	readonly horizonCap: number;
	/**
	 * Bullets one view digest holds (the probe's `digestBullets` is the send buffer's size; the model keeps more so a
	 * dense fight is not cut). Bullets past it are dropped and counted (`RollbackMetrics.overflow`).
	 */
	readonly digestBullets: number;
	/** Events one view digest holds (an Ember can erase hundreds of bullets in a tick). Past it: dropped, counted. */
	readonly digestEvents: number;
	/**
	 * Bullets count (phantoms, truth errors, the cheap plan) only within this distance of the observing player (tiles):
	 * about the screen (VIEW_TILES_HIGH 16.9 tiles high, ~30 wide at 16:9).
	 */
	readonly viewRadiusTiles: number;
	/**
	 * A digest keeps bullets up to viewRadiusTiles + this: a bullet counted inside the radius in one digest is looked
	 * for this much farther in the other, so a bullet on the edge never reads as a phantom.
	 */
	readonly viewMarginTiles: number;
	/**
	 * Two digests' bullets match by identity key first (digest.ts); a bullet left over matches one of the same emitter
	 * and kind within this distance (tiles): a burst fired a tick or two apart, or aimed a little differently, is the
	 * same bullet on screen.
	 */
	readonly bulletMatchTiles: number;
	/**
	 * An enemy bullet removed with life left within this distance of a living player (tiles) was a hit on that player,
	 * not an erase (digest.ts "Events"): PLAYER_RADIUS 0.35 + the goo's 0.35 hit radius + slack.
	 */
	readonly hitRadiusTiles: number;
	/**
	 * A bullet only the newer of two predictions of a tick shows is a phantom (it "first appears already along its
	 * path") when it is older than this at the drawn tick, by its spike-side spawn tag; a younger one is drawn at its
	 * muzzle (a shot the last frame guessed a tick later).
	 */
	readonly appearAgeTicks: number;
	/** An event (kill, death, pickup, erase, hit) shown this many ticks early or late is the same event. */
	readonly eventSlackTicks: number;
	/** Correction buckets, tiles (Design 3): enemyCorr010 / 025 / 050 / 100 and mateCorr*. */
	readonly correctionTiles: ReadonlyArray<number>;
	/** Truth error thresholds, tiles: enemyErr050 / 100. */
	readonly truthErrorTiles: ReadonlyArray<number>;
	/** Input frames kept per stream (truth, own), ticks: at least the playout depth + the lead + 1. */
	readonly frameRingTicks: number;
	/** Error histograms (metrics.ts): bin width and range, tiles (past the range: the last bin). */
	readonly errorBinTiles: number;
	readonly errorMaxTiles: number;
	/** An entity counted once (undone, late, phantom) is not counted again for this many ticks. */
	readonly dedupTicks: number;
	/**
	 * The opt-in sweep (model.sweep.spec.ts): off by default, so `npm test` runs one trivial test there. Turn it on with
	 * the runner flag (`npm run test:only -- lockstep/rollbackSpike/model.sweep --flag rollbackSweep`, after a build) or
	 * here (`enabled: true`, e.g. for Studio).
	 */
	readonly sweep: RollbackSweepConfig;
}

/** The R2 sweep (Design 2, 4): L x D x strategy over the bot and noisy-bot runs and any captures. */
export interface RollbackSweepConfig {
	readonly enabled: boolean;
	readonly leads: ReadonlyArray<number>;
	readonly depths: ReadonlyArray<number>;
	/** Party size and seed of the two bot runs. */
	readonly partySize: number;
	readonly seed: number;
	/**
	 * Frames predicted per bot window: 0 = each bot run whole (one window from tick 0, every room type); else two
	 * windows of this many frames, the first floor 1 fight and the boss fight.
	 */
	readonly windowFrames: number;
	/** Observing players swept per input (indices 0 .. n - 1, capped at the party size). */
	readonly players: number;
	/** Frames predicted per capture (from its start; a capture is one window). */
	readonly captureFrames: number;
}

export const ROLLBACK_SPIKE: RollbackSpikeConfig = {
	sliceTicks: 4,
	statsWindowSec: 10,
	liveSummarySec: 60,
	mirrorHashTicks: 600,
	digestActors: 64,
	digestBullets: 150,
	digestPlayers: 8,
	horizons: [8, 16, 24],
	model: {
		horizonCap: 32,
		digestBullets: 512,
		digestEvents: 512,
		viewRadiusTiles: 12,
		viewMarginTiles: 1.5,
		bulletMatchTiles: 0.35,
		hitRadiusTiles: 0.8,
		appearAgeTicks: 1,
		eventSlackTicks: 6,
		correctionTiles: [0.1, 0.25, 0.5, 1.0],
		truthErrorTiles: [0.5, 1.0],
		frameRingTicks: 256,
		errorBinTiles: 0.01,
		errorMaxTiles: 8,
		dedupTicks: 600,
		sweep: {
			enabled: false,
			leads: [6, 11, 16, 25],
			depths: [0, 4],
			partySize: 3,
			seed: 4242,
			windowFrames: 0,
			players: 1,
			captureFrames: 1200,
		},
	},
};
