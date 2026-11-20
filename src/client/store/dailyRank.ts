import { createProducer } from "@rbxts/reflex";
import type { DailyRankEntry } from "shared/view/hud";

/**
 * Client-local Reflex slice for the Daily's in-run rank layer (docs/DAILY.md DS10): the friends this daily run passed
 * (in pass order) and the run (RunInfo.run / RunContext.counter) they belong to, for the run-over panel's row of
 * friends passed (DailyPassedRow). DailyRankController writes it at a daily run's start (empty) and on a frame that
 * passed a friend (rare), never per frame.
 */
export interface DailyRankState {
	/** The run the list belongs to; 0 before the first daily run. */
	readonly run: number;
	readonly passed: ReadonlyArray<DailyRankEntry>;
}

const initialState: DailyRankState = { run: 0, passed: [] };

/**
 * The Daily's in-run rank slice (state: `DailyRankState`): DailyRankController replaces the list and its run together,
 * with an empty list at a daily run's start and a longer one on a frame that passed a friend.
 */
export const dailyRankSlice = createProducer(initialState, {
	setDailyPassed: (state, run: number, passed: ReadonlyArray<DailyRankEntry>) => ({ ...state, run, passed }),
});

/**
 * The friends this daily run's score has passed, in the order they were passed (empty: none yet, or no daily run so
 * far). The run-over panel's friends-passed row draws them, and only when `selectDailyPassedRun` is the run on screen.
 */
export const selectDailyPassed = (state: { dailyRank: DailyRankState }) => state.dailyRank.passed;
/**
 * The run counter (`RunInfo.run`) the passed-friends list belongs to, 0 before the first daily run. The run-over row
 * compares it with the current run so another run's list is never shown.
 */
export const selectDailyPassedRun = (state: { dailyRank: DailyRankState }) => state.dailyRank.run;
