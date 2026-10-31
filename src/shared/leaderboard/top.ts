/**
 * A board's top rows as read from its ordered store (GetSortedAsync, highest first), kept as raw ordered values so a
 * rank compares exactly (score, then floor, then time), and the after-write merge the daily verdict uses (DS5).
 *
 * Why merge instead of a fresh read after the write: a GetSortedAsync per verdict would spend the scarcest DataStore
 * budget (5 + 2 x players sorted reads a minute per server) on every finished daily run. The cached rows (at most
 * LEADERBOARD_CACHE_SECONDS old) with the player's new entry merged in give the exact rank except for entries other
 * servers wrote since that read (the rank can be off by at most the number of such entries above it, and the next
 * read corrects it). The merged rows go back into the cache, so the board view agrees with the verdict.
 *
 * Pure.
 */
import { LEADERBOARD_TOP_COUNT } from "./config";
import { orderedKey, userIdFromKey } from "./posting";

/** One ordered store entry (`u_<UserId>`, ordered value). */
export interface BoardEntry {
	readonly key: string;
	readonly value: number;
}

/** A board's top rows: `complete` when the read returned fewer than the rows asked for (every entrant is in it). */
export interface BoardTop {
	readonly entries: ReadonlyArray<BoardEntry>;
	readonly complete: boolean;
}

/** The top rows from a read of `asked` rows (complete when it came back short). */
export function boardTopOf(entries: ReadonlyArray<BoardEntry>, asked: number = LEADERBOARD_TOP_COUNT): BoardTop {
	return { entries, complete: entries.size() < asked };
}

/** The 1-based position of `userId`'s entry in the rows, or undefined. Only keys this game wrote count. */
export function entryRank(top: BoardTop, userId: number): number | undefined {
	let rank = 0;
	for (const e of top.entries) {
		const id = userIdFromKey(e.key);
		if (id === undefined) continue;
		rank++;
		if (id === userId) return rank;
	}
	return undefined;
}

/** `userId`'s ordered value in the rows, or undefined. */
export function entryValue(top: BoardTop, userId: number): number | undefined {
	const key = orderedKey(userId);
	return top.entries.find((e) => e.key === key)?.value;
}

/**
 * The rows after `userId`'s entry became `value` (the personal-best rule: a lower value than their row changes
 * nothing). The entry goes after every equal value (the store's own tie order is unknown: the conservative rank), the
 * rows are trimmed to `count`, and a complete board stays complete while it fits.
 */
export function mergeEntry(top: BoardTop, userId: number, value: number, count = LEADERBOARD_TOP_COUNT): BoardTop {
	const key = orderedKey(userId);
	const old = entryValue(top, userId);
	if (old !== undefined && old >= value) return top;
	const out: BoardEntry[] = [];
	let placed = false;
	for (const e of top.entries) {
		if (e.key === key) continue;
		if (!placed && e.value < value) {
			out.push({ key, value });
			placed = true;
		}
		out.push(e);
	}
	// Not above any row: last on a complete board; on a full board entries the rows never saw may sit above it, so it
	// is not among the top rows.
	if (!placed && top.complete) out.push({ key, value });
	let complete = top.complete;
	while (out.size() > count) {
		out.pop();
		complete = false;
	}
	return { entries: out, complete };
}
