import { createProducer } from "@rbxts/reflex";
import type { RecordsStatus } from "shared/records";
import type { NewBestRecord, RunBaseline } from "shared/view/hud";

/**
 * Client-local Reflex slice for the personal records (docs/NEW_BEST.md NB7): the latest `records(RecordsStatus)` the
 * server sent (once after the join load, after a verdict that raised a record, and on `requestRecords`), and the
 * current run's new-best baseline, frozen at run start by NewBestController (a records update mid-run never moves
 * it, NBD10). Read by the stage card's second line (StageController), the run-over panel, the pause overlay and the
 * main menu's best line. Dispatched rarely (a records message, a run start), never per frame.
 */
export interface RecordsState {
	/** The latest records status, or undefined until the first one arrives (the menu then shows no best). */
	readonly status: RecordsStatus | undefined;
	/** This run's baseline (shared/view/hud RunBaseline); unranked when there is no run or it is not the ranked world. */
	readonly baseline: RunBaseline;
	/** The run (RunInfo.run / RunContext.counter) the baseline belongs to; 0 before the first run. */
	readonly baselineRun: number;
}

const UNRANKED: RunBaseline = { kind: "unranked" };

const initialState: RecordsState = {
	status: undefined,
	baseline: UNRANKED,
	baselineRun: 0,
};

export const recordsSlice = createProducer(initialState, {
	setRecordsStatus: (state, status: RecordsStatus) => ({ ...state, status }),
	/** A run started: its frozen baseline (NewBestController). */
	setRunBaseline: (state, baseline: RunBaseline, run: number) => ({ ...state, baseline, baselineRun: run }),
});

export const selectRecordsStatus = (state: { records: RecordsState }) => state.records.status;
export const selectRunBaseline = (state: { records: RecordsState }) => state.records.baseline;
export const selectBaselineRun = (state: { records: RecordsState }) => state.records.baselineRun;
/** The solo board's record for the main menu: only once loaded and present. */
export const selectSoloBest = (state: { records: RecordsState }): NewBestRecord | undefined => {
	const status = state.records.status;
	return status !== undefined && status.loaded ? status.solo : undefined;
};
