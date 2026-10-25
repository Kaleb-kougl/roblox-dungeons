/**
 * What the client's leaderboard panel shows (shared/network `leaderboard`), built from the ordered store's top
 * entries: rank, name, and score / floor decoded from the ordered value itself (no details read per row: 100
 * GetAsync calls per refresh would blow the DataStore read budget).
 *
 * The caller's own best comes from their details entry; their rank is known only when they are in the top rows.
 * OrderedDataStore has no "rank of key" query, so a true "around me" view would need paging through the whole
 * board; it is not offered.
 */
import type { LeaderboardBoard } from "./config";
import { decodeOrderedValue } from "./orderedValue";
import { userIdFromKey, type LeaderboardEntryDetails } from "./posting";

export interface LeaderboardRow {
	rank: number;
	userId: number;
	name: string;
	score: number;
	floor: number;
}

export interface LeaderboardMine {
	score: number;
	floor: number;
	partySize: number;
	/** Unix seconds of the run. */
	at: number;
	/** 1-based, when the player is in the top rows; undefined otherwise (outside the top, or not posted yet). */
	rank?: number;
}

export interface LeaderboardView {
	board: LeaderboardBoard;
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
