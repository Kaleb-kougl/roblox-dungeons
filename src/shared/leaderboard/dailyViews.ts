/**
 * What the Daily tells a player about the daily boards (docs/DAILY.md DS5 / DS8): their entry with its standing
 * (`dailyStatus.mine`), yesterday's podium (`dailyStatus.podium`) and a daily run's verdict (`RunFinishVerdict.daily`).
 * Pure: the rows, histogram and write outcome come from LeaderboardService.
 *
 * @module
 */
import {
	DAILY,
	dailyLabel,
	type DailyMineEntry,
	type DailyPodium,
	type DailyPodiumEntry,
	type DailyRunKey,
	type DailyRunResult,
} from "shared/daily";
import { decodeOrderedValue } from "./orderedValue";
import { userIdFromKey } from "./posting";
import { dailyStanding } from "./rank";
import type { BoardTop } from "./top";
import type { PostWaitOutcome } from "./waiters";

/** `userId`'s entry (ordered value, undefined: none) with its standing on the board. */
export function dailyMineEntry(
	userId: number,
	value: number | undefined,
	top: BoardTop,
	counts: ReadonlyArray<number> | undefined,
): DailyMineEntry | undefined {
	if (value === undefined) return undefined;
	const d = decodeOrderedValue(value);
	return { score: d.score, floor: d.floor, ...dailyStanding(userId, value, top, counts) };
}

/**
 * Yesterday's podium: the first DAILY.podiumSize entrants of the board's top rows (fewer when fewer played) and the
 * caller's final entry (`callerValue`, undefined when they did not play) with its rank / percentile.
 */
export function buildPodium(
	day: number,
	top: BoardTop,
	nameOf: (userId: number) => string,
	callerId: number,
	callerValue: number | undefined,
	counts: ReadonlyArray<number> | undefined,
	size: number = DAILY.podiumSize,
): DailyPodium {
	const rows: DailyPodiumEntry[] = [];
	for (const e of top.entries) {
		if (rows.size() >= size) break;
		const userId = userIdFromKey(e.key);
		if (userId === undefined) continue;
		const d = decodeOrderedValue(e.value);
		rows.push({ userId, name: nameOf(userId), score: d.score, floor: d.floor });
	}
	const podium: DailyPodium = { day, label: dailyLabel(day), top: rows };
	const mine = dailyMineEntry(callerId, callerValue, top, counts);
	if (mine !== undefined) podium.mine = mine;
	return podium;
}

/**
 * One recipient's `RunFinishVerdict.daily`: the board's day and ruleset, whether their entry write completed
 * (`outcome`; undefined: not credited, ineligible or still waiting at the deadline), improved / previous from the
 * personal-best transform, and the standing of their entry after the write.
 */
export function dailyRunResult(
	key: DailyRunKey,
	outcome: PostWaitOutcome | undefined,
	standing?: { readonly rank?: number; readonly percentile?: number; readonly total?: number },
): DailyRunResult {
	const result: DailyRunResult = { day: key.day, ruleset: key.ruleset, posted: false, improved: false };
	if (outcome === undefined || !outcome.posted) return result;
	result.posted = true;
	result.improved = outcome.improved;
	if (outcome.previous !== undefined) {
		const d = decodeOrderedValue(outcome.previous);
		result.previous = { score: d.score, floor: d.floor };
	}
	if (standing !== undefined) {
		if (standing.rank !== undefined) result.rank = standing.rank;
		if (standing.percentile !== undefined) result.percentile = standing.percentile;
		if (standing.total !== undefined) result.total = standing.total;
	}
	return result;
}
