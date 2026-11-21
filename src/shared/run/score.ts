/**
 * The run's score, read from a SimState. The leaderboard score always comes from the SERVER's replayed state through
 * this function; the client's claim (computed with the same function on its live state) is only compared.
 *
 *   score  state.score.total (M2 scoring, shared/sim score/); 0 for an unscored run (the M1 "game" world)
 *   floor  state.endless.floor (endless mode); 1 outside endless runs
 *
 * The real reader is the DEFAULT (`stateRunScore`), so client and server agree from the first run whatever the load
 * order of their modules. `setRunScoreReader` stays as an override (tests); SegmentedValidator also takes a reader per
 * run.
 *
 * @module
 */
import type { SimState } from "shared/sim";

/**
 * A run's leaderboard numbers: its score and the deepest floor reached. Posted only from the server's replayed state;
 * the client's own reading is only compared with it.
 */
export interface RunScore {
	/** Non-negative integer score. */
	readonly score: number;
	/** Deepest floor reached (1 = the first floor). */
	readonly floor: number;
}

/**
 * Reads a run's `RunScore` from a sim state. The default is `stateRunScore`; tests replace it with `setRunScoreReader`,
 * and a `SegmentedValidator` can take one per run.
 */
export type RunScoreReader = (state: Readonly<SimState>) => RunScore;

/** What a run without scoring scores: nothing, on floor 1 (also a rejected run's placeholder). */
export const DEFAULT_RUN_SCORE: RunScore = table.freeze({ score: 0, floor: 1 });

/** The sim's own numbers: state.score.total (0 unscored) and state.endless.floor (1 outside endless). */
export function stateRunScore(state: Readonly<SimState>): RunScore {
	return {
		score: state.score?.total ?? DEFAULT_RUN_SCORE.score,
		floor: state.endless?.floor ?? DEFAULT_RUN_SCORE.floor,
	};
}

/** DEFAULT_RUN_SCORE for every state (tests; the reader before scoring existed). */
export function defaultReadRunScore(): RunScore {
	return { score: DEFAULT_RUN_SCORE.score, floor: DEFAULT_RUN_SCORE.floor };
}

let currentReader: RunScoreReader = stateRunScore;

/** Replaces the score reader (tests). Call it on client and server alike, before any run starts. */
export function setRunScoreReader(reader: RunScoreReader): void {
	currentReader = reader;
}

/** The score of `state` under the current reader (default: stateRunScore). */
export function readRunScore(state: Readonly<SimState>): RunScore {
	return currentReader(state);
}
