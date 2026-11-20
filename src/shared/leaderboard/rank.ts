/**
 * Ranks and percentiles on a daily board (docs/DAILY.md "5. Percentile", DS6): exact from the top rows when the entry
 * is inside them, else estimated from the board's histogram (histogram.ts), interpolated linearly inside the score's
 * bucket. Shown as `#38` (exact) or `Top 14%` (estimate, never a rank number), and nothing but `#n of m` (when exact)
 * below DAILY.minEntrantsForPercentile entrants (DSD15).
 *
 * Error bound of the estimate (histogram.spec.ts, synthetic boards): the entries above a score are counted exactly in the
 * buckets above its bucket; inside its bucket the interpolation assumes scores spread evenly, so the estimated rank is
 * off by at most the count of that one bucket (each bucket spans a score ratio of 1.25-1.28), plus the histogram's
 * lag (deltas reach the shards within a minute). Measured on 5,000-entry synthetic boards beyond the top 100
 * (histogram.spec.ts): log-normal scores within 34 ranks (0.7 % of the entrants, 1 percentile point); a dense bimodal
 * board within 120 ranks (2.4 %, 3 points). Never worse than the score's own bucket count.
 *
 * Pure.
 *
 * @module
 */
import { DAILY, type DailyStanding } from "shared/daily";
import { histBucketBounds, histTotal, bucketOf } from "./histogram";
import { decodeOrderedValue } from "./orderedValue";
import { userIdFromKey } from "./posting";
import { entryRank, type BoardTop } from "./top";

/** "Top N %": ceil(100 x rank / total), clamped to [1, 100]. */
export function percentileOf(rank: number, total: number): number {
	if (total <= 0) return 100;
	return math.clamp(math.ceil((100 * rank) / total), 1, 100);
}

/** Entries the histogram puts above `score`: every higher bucket, plus the share of its own bucket above it. */
export function histAbove(score: number, counts: ReadonlyArray<number>): number {
	const b = bucketOf(score);
	let above = 0;
	for (let i = b + 1; i < counts.size(); i++) above += counts[i];
	const { lo, hi } = histBucketBounds(b);
	const s = math.clamp(math.floor(score), lo, hi - 1);
	// Integer scores lo .. hi - 1 spread evenly: (hi - 1 - s) of the (hi - lo) values are above s.
	return above + (counts[b] ?? 0) * ((hi - 1 - s) / (hi - lo));
}

/** Entries this game wrote among the rows. */
export function topEntrants(top: BoardTop): number {
	let n = 0;
	for (const e of top.entries) if (userIdFromKey(e.key) !== undefined) n++;
	return n;
}

/**
 * Entrants on a board: exact (the rows' entrants) on a complete board, else the histogram's count (at least the rows),
 * undefined without a histogram.
 */
export function boardTotal(top: BoardTop, counts: ReadonlyArray<number> | undefined): number | undefined {
	if (top.complete) return topEntrants(top);
	if (counts === undefined) return undefined;
	return math.max(histTotal(counts), topEntrants(top));
}

/**
 * The rank of `score` on a board: exact (1 + rows with a higher score) when the rows hold every score at least as
 * high (a complete board, or a score not below the last row), else estimated from `counts` (clamped below every row
 * and to the entrants). Undefined when it is beyond the rows and there is no histogram.
 */
export function estimateRank(
	score: number,
	top: BoardTop,
	counts: ReadonlyArray<number> | undefined,
): { readonly rank: number; readonly exact: boolean } | undefined {
	const rows: number[] = [];
	for (const e of top.entries) if (userIdFromKey(e.key) !== undefined) rows.push(decodeOrderedValue(e.value).score);
	const last = rows.size() > 0 ? rows[rows.size() - 1] : undefined;
	if (top.complete || (last !== undefined && score >= last)) {
		let higher = 0;
		for (const r of rows) if (r > score) higher++;
		return { rank: higher + 1, exact: true };
	}
	if (counts === undefined) return undefined;
	const total = math.max(histTotal(counts), rows.size() + 1);
	const rank = math.clamp(math.floor(histAbove(score, counts)) + 1, rows.size() + 1, total);
	return { rank, exact: false };
}

/**
 * Where `userId`'s entry (ordered value `value`) stands, as DailyStanding: `top` must already hold the entry if it is
 * among the rows (mergeEntry after a write). Exact rank from its position in the rows; else the histogram estimate
 * (percentile only). `total`: the rows' entrants on a complete board, else the histogram's (at least the rows and the
 * rank). Below DAILY.minEntrantsForPercentile: only an exact rank with its total, else nothing.
 */
export function dailyStanding(
	userId: number,
	value: number,
	top: BoardTop,
	counts: ReadonlyArray<number> | undefined,
	minEntrants: number = DAILY.minEntrantsForPercentile,
): DailyStanding {
	const exact = entryRank(top, userId);
	let rank = exact;
	if (rank === undefined) {
		const est = estimateRank(decodeOrderedValue(value).score, top, counts);
		rank = est?.rank;
	}
	let total = boardTotal(top, counts);
	if (total !== undefined && !top.complete) total = math.max(total, rank ?? 0);
	if (total !== undefined && total < minEntrants) return exact !== undefined ? { rank: exact, total } : {};
	if (exact !== undefined) {
		return total !== undefined ? { rank: exact, percentile: percentileOf(exact, total), total } : { rank: exact };
	}
	if (rank === undefined || total === undefined) return {};
	return { percentile: percentileOf(rank, total), total };
}
