/**
 * What the client's leaderboard panel shows (shared/network `leaderboard`), built from the ordered store's top
 * entries: rank, name, and score / floor decoded from the ordered value itself (no details read per row: 100
 * GetAsync calls per refresh would blow the DataStore read budget).
 *
 * The caller's own best comes from their details entry; their rank is known only when they are in the top rows.
 * OrderedDataStore has no "rank of key" query, so a true "around me" view would need paging through the whole
 * board; it is not offered.
 *
 * @module
 */
import { ORDERED_VALUE_LAYOUT, type LeaderboardBoard } from "./config";
import { decodeOrderedValue } from "./orderedValue";
import { userIdFromKey, type LeaderboardEntryDetails } from "./posting";
import type { LeaderboardScope } from "./scope";

/**
 * One ranked line of the leaderboard panel, sent to the client inside `LeaderboardView`. `rank` is 1-based within the
 * rows sent (among friends only, in the friends view); the score in points and the floor are decoded from the ordered
 * value, not read from a details document; `name` is the display name the server resolved for `userId`.
 */
export interface LeaderboardRow {
	rank: number;
	userId: number;
	name: string;
	score: number;
	floor: number;
}

/**
 * The caller's own best on the board shown, sent to the client inside `LeaderboardView` so the panel can show it even
 * when the player is outside the top rows. On the all-time boards it comes from the details document, on daily boards
 * from the ordered value alone.
 */
export interface LeaderboardMine {
	score: number;
	floor: number;
	/** 0 when unknown (daily boards keep no details, DSD12; a details write that has not landed yet). */
	partySize: number;
	/** Unix seconds of the run (daily boards: the start of its 2-hour time slot; 0 when unknown). */
	at: number;
	/** 1-based, when the player is in the top rows; undefined otherwise (outside the top, or not posted yet). */
	rank?: number;
	/** Daily boards: "top N %" (shared/daily DailyStanding), from DAILY.minEntrantsForPercentile entrants. */
	percentile?: number;
}

/**
 * The server's answer to a `getLeaderboard` request and the payload of the pushed `leaderboard` updates: one board on
 * one scope, its top rows (at most `LEADERBOARD_TOP_COUNT`) and the caller's own best. The client keeps one per board,
 * scope and friends flag (`leaderboardRequestKey`). `reason` says why when `ok` is false.
 */
export interface LeaderboardView {
	board: LeaderboardBoard;
	/** The scope asked for ("alltime", "today", "yesterday"). */
	scope: LeaderboardScope;
	/** Daily scopes: the board's day (shared/daily dailyDay) and ruleset, as the server resolved them. */
	day?: number;
	ruleset?: number;
	/** The friends view: `rows` are the caller's friends with an entry (and the caller), ranked among themselves. */
	friends?: boolean;
	/** The friends view: friends whose entry is still being looked up (the view fills in; updates are pushed). */
	pending?: number;
	/** Daily scopes: entrants on the board when known (histogram estimate, or exact for a short board). */
	total?: number;
	/** False when the board could not be read at all (rows empty). */
	ok: boolean;
	/** Served from an older read because the latest failed. */
	stale: boolean;
	rows: LeaderboardRow[];
	/** The caller's personal best on this board, if any. */
	mine?: LeaderboardMine;
	reason?: string;
}

/** Rows from the ordered store's entries (highest first), skipping keys this game did not write. */
export function rowsFromEntries(
	entries: ReadonlyArray<{ readonly key: string; readonly value: number }>,
	nameOf: (userId: number) => string,
): LeaderboardRow[] {
	const rows: LeaderboardRow[] = [];
	for (const e of entries) {
		const userId = userIdFromKey(e.key);
		if (userId === undefined || !typeIs(e.value, "number")) continue;
		const d = decodeOrderedValue(e.value);
		rows.push({ rank: rows.size() + 1, userId, name: nameOf(userId), score: d.score, floor: d.floor });
	}
	return rows;
}

/** The caller's best for the view: from their details entry, ranked if they appear in `rows`. */
export function mineFromDetails(
	details: LeaderboardEntryDetails | undefined,
	rows: ReadonlyArray<LeaderboardRow>,
	userId: number,
): LeaderboardMine | undefined {
	const row = rows.find((r) => r.userId === userId);
	if (details === undefined) {
		// The ordered write landed but the details did not (yet): show what the row knows.
		return row !== undefined
			? { score: row.score, floor: row.floor, partySize: 0, at: 0, rank: row.rank }
			: undefined;
	}
	return {
		score: details.score,
		floor: details.floor,
		partySize: details.partySize,
		at: details.at,
		rank: row?.rank,
	};
}

/** The caller's entry on a daily board (no details doc, DSD12): from the ordered value, ranked if in `rows`. */
export function mineFromOrderedValue(
	value: number | undefined,
	rows: ReadonlyArray<LeaderboardRow>,
	userId: number,
): LeaderboardMine | undefined {
	if (value === undefined) return undefined;
	const d = decodeOrderedValue(value);
	const L = ORDERED_VALUE_LAYOUT;
	return {
		score: d.score,
		floor: d.floor,
		partySize: 0,
		at: L.epochSeconds + d.timeSlot * L.timeSlotSeconds,
		rank: rows.find((r) => r.userId === userId)?.rank,
	};
}
