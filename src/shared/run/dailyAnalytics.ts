/**
 * The Daily's analytics (docs/DAILY.md DS13) -> AnalyticsService custom events. Pure, like analytics.ts: RecordsService
 * reports each daily start and each accepted daily run with the player's attempt number and returning flag (from the
 * records doc's `daily` activity, shared/records), and TelemetryService logs these specs. Score and floor come from
 * the server's replay.
 *
 *   daily_start   value 1        field01 board        field02 attempt bucket   field03 returning
 *   daily_retry   value attempt  field01 attempt bucket  field02 board          (attempt >= 2 only)
 *   daily_finish  value score    field01 score bucket field02 floor bucket     field03 "<attempt bucket>/<returning>"
 *
 * Every field value comes from a small fixed set (the tables below), so the three events add at most
 * dailyAnalyticsCombinations() field combinations (Roblox: 8,000 per experience, 100 custom event names; no funnel).
 *
 * @module
 */
import type { AnalyticsEventSpec } from "./analytics";
import { ANALYTICS_EVENT } from "./analytics";

/** The board a daily run counts on (shared/leaderboard LeaderboardBoard). */
export type DailyAnalyticsBoard = "solo" | "coop";

/** An accepted daily session start, for one member. */
export interface DailyStartFacts {
	readonly board: DailyAnalyticsBoard;
	/** The member's attempt number on the run's day (1 = first daily start that day). */
	readonly attempt: number;
	/** Finished a daily run on the previous day; undefined = unknown (records doc not loaded). */
	readonly returning: boolean | undefined;
}

/** An accepted daily run, for one credited member. */
export interface DailyFinishFacts extends DailyStartFacts {
	/** The run's score (server replay). */
	readonly score: number;
	/** The deepest floor (`state.endless.floor`). */
	readonly floor: number;
}

/** A labelled bucket: values from `min` up to the next bucket's `min`. */
export interface AnalyticsBucket {
	readonly min: number;
	readonly label: string;
}

/** Bucket tables (ascending `min`; a value below the first `min`, or not a number, takes the first bucket). */
export const DAILY_ANALYTICS = table.freeze({
	attemptBuckets: [
		{ min: 1, label: "1" },
		{ min: 2, label: "2" },
		{ min: 3, label: "3-5" },
		{ min: 6, label: "6-10" },
		{ min: 11, label: "11+" },
	] as ReadonlyArray<AnalyticsBucket>,
	scoreBuckets: [
		{ min: 0, label: "<1k" },
		{ min: 1_000, label: "1k-5k" },
		{ min: 5_000, label: "5k-10k" },
		{ min: 10_000, label: "10k-25k" },
		{ min: 25_000, label: "25k-50k" },
		{ min: 50_000, label: "50k-100k" },
		{ min: 100_000, label: "100k-250k" },
		{ min: 250_000, label: "250k+" },
	] as ReadonlyArray<AnalyticsBucket>,
	/** Floor 5 is the first boss floor. */
	floorBuckets: [
		{ min: 0, label: "1" },
		{ min: 2, label: "2-4" },
		{ min: 5, label: "5-9" },
		{ min: 10, label: "10-14" },
		{ min: 15, label: "15-19" },
		{ min: 20, label: "20+" },
	] as ReadonlyArray<AnalyticsBucket>,
	boards: ["solo", "coop"] as ReadonlyArray<DailyAnalyticsBoard>,
	/** The returning flag's values: finished yesterday's daily / did not / unknown. */
	returning: table.freeze({ yes: "returning", no: "notReturning", unknown: "unknown" }),
	/** Between the attempt bucket and the returning value in daily_finish's field03. */
	comboSeparator: "/",
});

/** Every value of the returning flag's field. */
export const DAILY_RETURNING_VALUES: ReadonlyArray<string> = [
	DAILY_ANALYTICS.returning.yes,
	DAILY_ANALYTICS.returning.no,
	DAILY_ANALYTICS.returning.unknown,
];

/** The label of the bucket `value` falls in. */
export function analyticsBucket(buckets: ReadonlyArray<AnalyticsBucket>, value: number): string {
	let label = buckets[0].label;
	if (!typeIs(value, "number") || value !== value) return label;
	for (const b of buckets) if (value >= b.min) label = b.label;
	return label;
}

export function dailyAttemptBucket(attempt: number): string {
	return analyticsBucket(DAILY_ANALYTICS.attemptBuckets, attempt);
}

export function dailyScoreBucket(score: number): string {
	return analyticsBucket(DAILY_ANALYTICS.scoreBuckets, score);
}

export function dailyFloorBucket(floor: number): string {
	return analyticsBucket(DAILY_ANALYTICS.floorBuckets, floor);
}

export function dailyReturningValue(returning: boolean | undefined): string {
	const r = DAILY_ANALYTICS.returning;
	return returning === undefined ? r.unknown : returning ? r.yes : r.no;
}

/** `daily_start`, plus `daily_retry` when it is not the member's first daily start of the day. */
export function analyticsForDailyStart(f: DailyStartFacts): AnalyticsEventSpec[] {
	const attempt = dailyAttemptBucket(f.attempt);
	const out: AnalyticsEventSpec[] = [
		{
			kind: "custom",
			name: ANALYTICS_EVENT.dailyStart,
			value: 1,
			fields: { field01: f.board, field02: attempt, field03: dailyReturningValue(f.returning) },
		},
	];
	if (f.attempt > 1) {
		out.push({
			kind: "custom",
			name: ANALYTICS_EVENT.dailyRetry,
			value: f.attempt,
			fields: { field01: attempt, field02: f.board },
		});
	}
	return out;
}

/** `daily_finish` for one credited member of an accepted daily run. */
export function analyticsForDailyFinish(f: DailyFinishFacts): AnalyticsEventSpec[] {
	const combo = `${dailyAttemptBucket(f.attempt)}${DAILY_ANALYTICS.comboSeparator}${dailyReturningValue(
		f.returning,
	)}`;
	return [
		{
			kind: "custom",
			name: ANALYTICS_EVENT.dailyFinish,
			value: f.score,
			fields: { field01: dailyScoreBucket(f.score), field02: dailyFloorBucket(f.floor), field03: combo },
		},
	];
}

/** The most field combinations the three daily events can produce (spec: well under Roblox's 8,000). */
export function dailyAnalyticsCombinations(): number {
	const a = DAILY_ANALYTICS.attemptBuckets.size();
	const boards = DAILY_ANALYTICS.boards.size();
	const returning = DAILY_RETURNING_VALUES.size();
	const start = boards * a * returning;
	const retry = a * boards;
	const finish = DAILY_ANALYTICS.scoreBuckets.size() * DAILY_ANALYTICS.floorBuckets.size() * a * returning;
	return start + retry + finish;
}
