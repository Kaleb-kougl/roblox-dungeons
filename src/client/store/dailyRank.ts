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

export const dailyRankSlice = createProducer(initialState, {
	setDailyPassed: (state, run: number, passed: ReadonlyArray<DailyRankEntry>) => ({ ...state, run, passed }),
});

export const selectDailyPassed = (state: { dailyRank: DailyRankState }) => state.dailyRank.passed;
export const selectDailyPassedRun = (state: { dailyRank: DailyRankState }) => state.dailyRank.run;
