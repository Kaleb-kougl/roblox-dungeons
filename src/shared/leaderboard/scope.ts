/**
 * Board identity with a scope (docs/DAILY.md DS5): the all-time boards (`LB_Solo_v1` / `LB_Coop_v1`, unscoped, exactly
 * as before) or a daily board (`LB_Daily_Solo_v1` / `LB_Daily_Coop_v1` under the scope `dailyScope(day, ruleset)`),
 * plus the client's request shape (`getLeaderboard`) and how the server resolves it with its own clock.
 *
 * Pure. The all-time ref keeps every key the M5 code used (cache key = the board name, details key `<board>_u_<id>`).
 */
import { DAILY, dailyScope, type DailyRunKey } from "shared/daily";
import {
	LEADERBOARD_BOARDS,
	LEADERBOARD_DAILY_ORDERED_STORES,
	LEADERBOARD_ORDERED_STORES,
	type LeaderboardBoard,
} from "./config";

/** What the client asks for: the all-time boards, today's daily board or yesterday's (by the server's clock). */
export type LeaderboardScope = "alltime" | "today" | "yesterday";
export const LEADERBOARD_SCOPES: ReadonlyArray<LeaderboardScope> = ["alltime", "today", "yesterday"];

/** The scope string of the all-time boards (their stores are unscoped: GetOrderedDataStore(name)). */
export const ALLTIME_SCOPE = "alltime";

/** A board on a scope: `scope` is ALLTIME_SCOPE or dailyScope(day, ruleset); `daily` names that day and ruleset. */
export interface BoardRef {
	readonly board: LeaderboardBoard;
	readonly scope: string;
	readonly daily?: DailyRunKey;
}

/** `getLeaderboard`'s argument (validated by parseLeaderboardRequest on the server). */
export interface LeaderboardRequest {
	board: LeaderboardBoard;
	scope: LeaderboardScope;
	/** The friends view (daily scopes only): the caller's friends with an entry, ranked, the caller included. */
	friends?: boolean;
}

export function alltimeBoard(board: LeaderboardBoard): BoardRef {
	return { board, scope: ALLTIME_SCOPE };
}

export function dailyBoard(board: LeaderboardBoard, key: DailyRunKey): BoardRef {
	return { board, scope: dailyScope(key.day, key.ruleset), daily: { day: key.day, ruleset: key.ruleset } };
}

export function isDailyBoard(ref: BoardRef): boolean {
	return ref.scope !== ALLTIME_SCOPE;
}

/**
 * A ref's key for caches, the write queue and the histogram: the board name for the all-time boards ("solo" /
 * "coop", as M5 keyed them), `<board>_<scope>` for a daily board ("solo_d303_r1").
 */
export function boardRefKey(ref: BoardRef): string {
	return isDailyBoard(ref) ? `${ref.board}_${ref.scope}` : ref.board;
}

/** The OrderedDataStore name and scope of a ref (scope undefined: the unscoped all-time store). */
export function orderedStoreOf(ref: BoardRef): { readonly name: string; readonly scope?: string } {
	if (!isDailyBoard(ref)) return { name: LEADERBOARD_ORDERED_STORES[ref.board] };
	return { name: LEADERBOARD_DAILY_ORDERED_STORES[ref.board], scope: ref.scope };
}

/** A remote argument as a request, or undefined (bad board / scope, friends not a boolean, friends on all-time). */
export function parseLeaderboardRequest(raw: unknown): LeaderboardRequest | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const r = raw as { board?: unknown; scope?: unknown; friends?: unknown };
	if (!typeIs(r.board, "string") || !LEADERBOARD_BOARDS.includes(r.board as LeaderboardBoard)) return undefined;
	if (!typeIs(r.scope, "string") || !LEADERBOARD_SCOPES.includes(r.scope as LeaderboardScope)) return undefined;
	if (r.friends !== undefined && !typeIs(r.friends, "boolean")) return undefined;
	const friends = r.friends === true;
	if (friends && r.scope === "alltime") return undefined;
	const out: LeaderboardRequest = { board: r.board as LeaderboardBoard, scope: r.scope as LeaderboardScope };
	if (friends) out.friends = true;
	return out;
}

/** The board a request means on `today` (the server's dailyDay) under `ruleset` (default the current one). */
export function resolveBoardRequest(
	request: Pick<LeaderboardRequest, "board" | "scope">,
	today: number,
	ruleset: number = DAILY.ruleset,
): BoardRef {
	if (request.scope === "today") return dailyBoard(request.board, { day: today, ruleset });
	if (request.scope === "yesterday") return dailyBoard(request.board, { day: today - 1, ruleset });
	return alltimeBoard(request.board);
}

/** A view's key in the client store (one slot per board, scope and friends flag): `solo:today:friends`. */
export function leaderboardRequestKey(request: Pick<LeaderboardRequest, "board" | "scope" | "friends">): string {
	return `${request.board}:${request.scope}${request.friends === true ? ":friends" : ""}`;
}
