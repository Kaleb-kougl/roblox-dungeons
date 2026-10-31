import { createProducer } from "@rbxts/reflex";
import type { DailyStatus } from "shared/daily";

/**
 * Client-local Reflex slice for the Daily (docs/DAILY.md DS4): the latest `dailyStatus(DailyStatus)` the server sent
 * (on request at join, at the server's midnight push, and when the client re-asks after `resetsAt`). DailyController
 * fills it; the main menu's Daily card and countdown read it (next phase). Dispatched rarely (once per day or so).
 */
export interface DailyState {
	/** Today's status, or undefined until the first answer arrives (the menu then shows no Daily card). */
	readonly status: DailyStatus | undefined;
}

const initialState: DailyState = {
	status: undefined,
};

export const dailySlice = createProducer(initialState, {
	setDailyStatus: (state, status: DailyStatus) => ({ ...state, status }),
});

export const selectDailyStatus = (state: { daily: DailyState }) => state.daily.status;
