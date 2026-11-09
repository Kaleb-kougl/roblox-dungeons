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
};
