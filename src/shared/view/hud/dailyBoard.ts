/**
 * The leaderboard panel's tabs (docs/DAILY.md DS9: Today / Yesterday x Solo / Co-op x Global / Friends, plus the
 * all-time boards as their own tab, unchanged) and the daily tabs' text lines. Pure (daily.spec.ts): the client's
 * LeaderboardPanel keeps the tab state in the store, asks LeaderboardController for `leaderboardTabRequest(tabs)` and
 * reads the view under `leaderboardRequestKey(request)`.
 */
import {
	LEADERBOARD_BOARDS,
	type LeaderboardBoard,
	type LeaderboardRequest,
	type LeaderboardScope,
	type LeaderboardView,
} from "shared/leaderboard";
import { DAILY_STRINGS } from "./dailyStrings";
import { STANDING_KEYS, dailyText, formatThousands, standingOf, type DailyStr } from "./dailyText";

/** The panel's tab state: scope (today / yesterday / all time), board (solo / co-op), global or friends. */
export interface LeaderboardTabs {
	readonly scope: LeaderboardScope;
	readonly board: LeaderboardBoard;
	/** Friends only (daily scopes; ignored on all time). */
	readonly friends: boolean;
}

/** The scope tabs, in order (all time last: the daily boards come first). */
export const LEADERBOARD_SCOPE_TABS: ReadonlyArray<{ readonly scope: LeaderboardScope; readonly key: string }> = [
	{ scope: "today", key: DAILY_STRINGS.tabToday },
	{ scope: "yesterday", key: DAILY_STRINGS.tabYesterday },
	{ scope: "alltime", key: DAILY_STRINGS.tabAlltime },
];

/** The filter tabs, in order (daily scopes only). */
export const LEADERBOARD_FILTER_TABS: ReadonlyArray<{ readonly friends: boolean; readonly key: string }> = [
	{ friends: false, key: DAILY_STRINGS.tabGlobal },
	{ friends: true, key: DAILY_STRINGS.tabFriends },
];

/** The board tabs, in order (shared/leaderboard LEADERBOARD_BOARDS). */
export const LEADERBOARD_BOARD_TABS: ReadonlyArray<LeaderboardBoard> = LEADERBOARD_BOARDS;

/** The tabs the panel opens on the first time: the all-time solo board, as before the Daily. */
export const DEFAULT_LEADERBOARD_TABS: LeaderboardTabs = { scope: "alltime", board: "solo", friends: false };

/** Whether the filter row (Global / Friends) shows: daily scopes only. */
export function leaderboardFilterShown(tabs: LeaderboardTabs): boolean {
	return tabs.scope !== "alltime";
}

/** The request for the shown tabs: all time never carries `friends` (the server refuses it there). */
export function leaderboardTabRequest(tabs: LeaderboardTabs): LeaderboardRequest {
	const request: LeaderboardRequest = { board: tabs.board, scope: tabs.scope };
	if (tabs.friends && tabs.scope !== "alltime") request.friends = true;
	return request;
}

/** The tabs with one part changed (the rest kept: switching scope keeps the board and the filter). */
export function withLeaderboardTab(tabs: LeaderboardTabs, patch: Partial<LeaderboardTabs>): LeaderboardTabs {
	return {
		scope: patch.scope ?? tabs.scope,
		board: patch.board ?? tabs.board,
		friends: patch.friends ?? tabs.friends,
	};
}

/** Which plain status a daily tab shows above its rows (the all-time keys: hud.leaderboard.*), or none. */
export type DailyBoardStatus = "loading" | "unavailable" | "empty" | "friendsEmpty" | "stale" | undefined;

/** A daily tab's text: the status above the rows, the friends still being looked up, the entrants, your best. */
export interface DailyBoardLines {
	readonly status: DailyBoardStatus;
	/** `finding friends... (12)` while the friends view fills in ("" when none). */
	readonly pending: string;
	/** `1,240 players` ("" when unknown). */
	readonly total: string;
	/** `Your best: 23,410 (floor 9) · #41` / `... · top 9%` / without a standing / `Your best: not played yet`. */
	readonly mine: string;
}

/**
 * The daily tab's lines for `view` (undefined until the first answer) and whether a request is in flight, through
 * the string lookup `s`. Empty board: `friendsEmpty` on a friends view (none while friends are still being looked
 * up: the pending line says it), else `empty`. Your standing is the global one (a friends view keeps it:
 * shared/leaderboard), against the view's total.
 */
export function dailyBoardLines(view: LeaderboardView | undefined, loading: boolean, s: DailyStr): DailyBoardLines {
	const mineNone = s(DAILY_STRINGS.boardMineNone);
	if (view === undefined) return { status: "loading", pending: "", total: "", mine: mineNone };
	const pendingCount = view.friends === true ? view.pending ?? 0 : 0;
	const pending = pendingCount > 0 ? s(DAILY_STRINGS.boardPending, { n: pendingCount }) : "";
	let status: DailyBoardStatus;
	if (!view.ok) status = "unavailable";
	else if (view.rows.size() === 0) {
		status = pendingCount > 0 ? undefined : view.friends === true ? "friendsEmpty" : "empty";
	} else if (view.stale) status = "stale";
	else if (loading) status = "loading";
	const total =
		view.ok && view.total !== undefined ? s(DAILY_STRINGS.boardTotal, { total: formatThousands(view.total) }) : "";
	const m = view.mine;
	let mine = mineNone;
	if (m !== undefined) {
		const standing = standingOf({ rank: m.rank, percentile: m.percentile, total: view.total }, STANDING_KEYS);
		const score = formatThousands(m.score);
		mine =
			standing !== undefined
				? s(DAILY_STRINGS.boardMine, { score, floor: m.floor, standing: dailyText(standing, s) })
				: s(DAILY_STRINGS.boardMineScore, { score, floor: m.floor });
	}
	return { status, pending, total, mine };
}
