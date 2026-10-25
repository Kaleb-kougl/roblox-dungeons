import { createProducer } from "@rbxts/reflex";
import type { LeaderboardBoard, LeaderboardView } from "shared/leaderboard";

/**
 * Client-local Reflex slice for the leaderboard panel (M5): open or not, the shown board (Solo / Co-op tab), the last
 * view the server sent per board (`getLeaderboard` -> `leaderboard`), and whether a request is in flight.
 */
export interface LeaderboardState {
	readonly open: boolean;
	readonly board: LeaderboardBoard;
	readonly solo: LeaderboardView | undefined;
	readonly coop: LeaderboardView | undefined;
	readonly loading: boolean;
}

const initialState: LeaderboardState = {
	open: false,
	board: "solo",
	solo: undefined,
	coop: undefined,
	loading: false,
};

export const leaderboardSlice = createProducer(initialState, {
	setLeaderboardOpen: (state, open: boolean) => (state.open === open ? state : { ...state, open }),
	setLeaderboardBoard: (state, board: LeaderboardBoard) => (state.board === board ? state : { ...state, board }),
	setLeaderboardLoading: (state, loading: boolean) => (state.loading === loading ? state : { ...state, loading }),
	setLeaderboardView: (state, view: LeaderboardView) =>
		view.board === "coop" ? { ...state, coop: view, loading: false } : { ...state, solo: view, loading: false },
});

export const selectLeaderboardOpen = (state: { leaderboard: LeaderboardState }) => state.leaderboard.open;
export const selectLeaderboard = (state: { leaderboard: LeaderboardState }) => state.leaderboard;

/** A menu panel that takes the controls is open (juice settings or leaderboards): the run pauses under it. */
export const selectAnyPanelOpen = (state: {
	leaderboard: LeaderboardState;
	settings: { readonly panelOpen: boolean };
}) => state.leaderboard.open || state.settings.panelOpen;
