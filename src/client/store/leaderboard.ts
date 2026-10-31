import { createProducer } from "@rbxts/reflex";
import { leaderboardRequestKey, type LeaderboardBoard, type LeaderboardView } from "shared/leaderboard";

/**
 * Client-local Reflex slice for the leaderboard panel (M5): open or not, the shown board (Solo / Co-op tab), the last
 * all-time view the server sent per board (`getLeaderboard` -> `leaderboard`), and whether a request is in flight.
 * Daily views (scope "today" / "yesterday", friends or not; docs/DAILY.md DS5 / DS7) are kept apart in `scoped`, keyed
 * by shared/leaderboard leaderboardRequestKey (`solo:today`, `coop:yesterday:friends`), so they never replace the
 * all-time tabs.
 */
export interface LeaderboardState {
	readonly open: boolean;
	readonly board: LeaderboardBoard;
	readonly solo: LeaderboardView | undefined;
	readonly coop: LeaderboardView | undefined;
	readonly scoped: { readonly [key: string]: LeaderboardView | undefined };
	readonly loading: boolean;
}

const initialState: LeaderboardState = {
	open: false,
	board: "solo",
	solo: undefined,
	coop: undefined,
	scoped: {},
	loading: false,
};

export const leaderboardSlice = createProducer(initialState, {
	setLeaderboardOpen: (state, open: boolean) => (state.open === open ? state : { ...state, open }),
	setLeaderboardBoard: (state, board: LeaderboardBoard) => (state.board === board ? state : { ...state, board }),
	setLeaderboardLoading: (state, loading: boolean) => (state.loading === loading ? state : { ...state, loading }),
	setLeaderboardView: (state, view: LeaderboardView) => {
		if (view.scope !== "alltime" || view.friends === true) {
			return { ...state, scoped: { ...state.scoped, [leaderboardRequestKey(view)]: view }, loading: false };
		}
		return view.board === "coop"
			? { ...state, coop: view, loading: false }
			: { ...state, solo: view, loading: false };
	},
});

export const selectLeaderboardOpen = (state: { leaderboard: LeaderboardState }) => state.leaderboard.open;
export const selectLeaderboard = (state: { leaderboard: LeaderboardState }) => state.leaderboard;

/** A menu panel that takes the controls is open (juice settings or leaderboards): the run pauses under it. */
export const selectAnyPanelOpen = (state: {
	leaderboard: LeaderboardState;
	settings: { readonly panelOpen: boolean };
}) => state.leaderboard.open || state.settings.panelOpen;

/** The last daily view received for a board, scope and friends flag (undefined until one arrives). */
export const selectScopedLeaderboard = (key: string) => (state: { leaderboard: LeaderboardState }) =>
	state.leaderboard.scoped[key];
