// The Daily's analytics (docs/DAILY.md DS13): names within Roblox's limits, fixed field value sets, buckets, and the
// event mapping (first start vs retry, the returning flag, daily_finish's fields).
import { describe, expect, it } from "@rbxts/jest-globals";
import { LOBBY_ANALYTICS_EVENT } from "shared/lobby";
import { TUTORIAL_FUNNEL, TUTORIAL_SKIPPED_EVENT } from "shared/onboarding";
import {
	ANALYTICS_EVENT,
	DAILY_ANALYTICS,
	DAILY_RETURNING_VALUES,
	RUN_FUNNEL,
	analyticsForDailyFinish,
	analyticsForDailyStart,
	dailyAnalyticsCombinations,
	dailyAttemptBucket,
	dailyFloorBucket,
	dailyReturningValue,
	dailyScoreBucket,
	type AnalyticsBucket,
	type AnalyticsEventSpec,
} from "shared/run";

/** Roblox AnalyticsService limits (per experience). */
const ROBLOX_MAX_CUSTOM_EVENT_NAMES = 100;
const ROBLOX_MAX_FUNNELS = 10;
const ROBLOX_MAX_FIELD_COMBINATIONS = 8000;
/** This feature's own share of the field combinations. */
const DAILY_COMBINATION_BUDGET = 1000;

function labels(buckets: ReadonlyArray<AnalyticsBucket>): string[] {
	return buckets.map((b) => b.label);
}

function custom(spec: AnalyticsEventSpec) {
	if (spec.kind !== "custom") error("not a custom event", 0);
	return spec;
}

describe("daily analytics names and limits", () => {
	it("the three daily names are in the run name table, unique among every custom event name", () => {
		const names: string[] = [];
		for (const [, n] of pairs(ANALYTICS_EVENT)) names.push(n);
		for (const [, n] of pairs(LOBBY_ANALYTICS_EVENT)) names.push(n);
		names.push(TUTORIAL_SKIPPED_EVENT);
		const seen = new Set<string>();
		for (const n of names) {
			expect(seen.has(n)).toBe(false);
			seen.add(n);
		}
		expect(names.size() <= ROBLOX_MAX_CUSTOM_EVENT_NAMES).toBe(true);
		expect(seen.has("daily_start")).toBe(true);
		expect(seen.has("daily_finish")).toBe(true);
		expect(seen.has("daily_retry")).toBe(true);
		// No new funnel.
		expect([RUN_FUNNEL, TUTORIAL_FUNNEL].size() <= ROBLOX_MAX_FUNNELS).toBe(true);
	});

	it("field combinations stay within the feature's budget (and far under Roblox's)", () => {
		const n = dailyAnalyticsCombinations();
		expect(n).toBe(2 * 5 * 3 + 5 * 2 + 8 * 6 * 5 * 3);
		expect(n <= DAILY_COMBINATION_BUDGET).toBe(true);
		expect(n < ROBLOX_MAX_FIELD_COMBINATIONS).toBe(true);
	});

	it("bucket tables ascend and have unique labels", () => {
		for (const t of [DAILY_ANALYTICS.attemptBuckets, DAILY_ANALYTICS.scoreBuckets, DAILY_ANALYTICS.floorBuckets]) {
			const seen = new Set<string>();
			for (let i = 0; i < t.size(); i++) {
				if (i > 0) expect(t[i].min > t[i - 1].min).toBe(true);
				expect(seen.has(t[i].label)).toBe(false);
				seen.add(t[i].label);
			}
		}
	});
});

describe("daily buckets", () => {
	it("attempts", () => {
		const cases: [number, string][] = [
			[0, "1"],
			[1, "1"],
			[2, "2"],
			[3, "3-5"],
			[5, "3-5"],
			[6, "6-10"],
			[10, "6-10"],
			[11, "11+"],
			[500, "11+"],
		];
		for (const [n, label] of cases) expect(dailyAttemptBucket(n)).toBe(label);
	});

	it("scores", () => {
		const cases: [number, string][] = [
			[0, "<1k"],
			[999, "<1k"],
			[1000, "1k-5k"],
			[23410, "10k-25k"],
			[25000, "25k-50k"],
			[99999, "50k-100k"],
			[100000, "100k-250k"],
			[250000, "250k+"],
			[-5, "<1k"],
			[0 / 0, "<1k"],
		];
		for (const [n, label] of cases) expect(dailyScoreBucket(n)).toBe(label);
	});

	it("floors", () => {
		const cases: [number, string][] = [
			[0, "1"],
			[1, "1"],
			[2, "2-4"],
			[4, "2-4"],
			[5, "5-9"],
			[9, "5-9"],
			[10, "10-14"],
			[19, "15-19"],
			[20, "20+"],
			[87, "20+"],
		];
		for (const [n, label] of cases) expect(dailyFloorBucket(n)).toBe(label);
	});

	it("returning flag", () => {
		expect(dailyReturningValue(true)).toBe("returning");
		expect(dailyReturningValue(false)).toBe("notReturning");
		expect(dailyReturningValue(undefined)).toBe("unknown");
	});
});

describe("daily event mapping", () => {
	it("a first daily start logs daily_start only", () => {
		const events = analyticsForDailyStart({ board: "solo", attempt: 1, returning: true });
		expect(events).toEqual([
			{
				kind: "custom",
				name: ANALYTICS_EVENT.dailyStart,
				value: 1,
				fields: { field01: "solo", field02: "1", field03: "returning" },
			},
		]);
	});

	it("a retry logs daily_start and daily_retry with the attempt bucket", () => {
		const events = analyticsForDailyStart({ board: "coop", attempt: 4, returning: undefined });
		expect(events.size()).toBe(2);
		expect(custom(events[0]).fields).toEqual({ field01: "coop", field02: "3-5", field03: "unknown" });
		expect(events[1]).toEqual({
			kind: "custom",
			name: ANALYTICS_EVENT.dailyRetry,
			value: 4,
			fields: { field01: "3-5", field02: "coop" },
		});
	});

	it("daily_finish: score and floor buckets, attempt bucket / returning, value = score", () => {
		const events = analyticsForDailyFinish({ board: "solo", attempt: 2, returning: false, score: 23410, floor: 7 });
		expect(events).toEqual([
			{
				kind: "custom",
				name: ANALYTICS_EVENT.dailyFinish,
				value: 23410,
				fields: { field01: "10k-25k", field02: "5-9", field03: "2/notReturning" },
			},
		]);
	});

	it("every field value comes from the fixed sets", () => {
		const attempts = new Set(labels(DAILY_ANALYTICS.attemptBuckets));
		const scores = new Set(labels(DAILY_ANALYTICS.scoreBuckets));
		const floors = new Set(labels(DAILY_ANALYTICS.floorBuckets));
		const boards = new Set<string>(DAILY_ANALYTICS.boards);
		const returning = new Set(DAILY_RETURNING_VALUES);
		const combos = new Set<string>();
		for (const a of attempts) for (const r of returning) combos.add(`${a}${DAILY_ANALYTICS.comboSeparator}${r}`);
		const flags: (boolean | undefined)[] = [true, false, undefined];
		for (const board of DAILY_ANALYTICS.boards) {
			for (const attempt of [1, 2, 3, 7, 12, 999]) {
				for (const returningFlag of flags) {
					for (const spec of analyticsForDailyStart({ board, attempt, returning: returningFlag })) {
						const e = custom(spec);
						if (e.name === ANALYTICS_EVENT.dailyStart) {
							expect(boards.has(e.fields!.field01!)).toBe(true);
							expect(attempts.has(e.fields!.field02!)).toBe(true);
							expect(returning.has(e.fields!.field03!)).toBe(true);
						} else {
							expect(e.name).toBe(ANALYTICS_EVENT.dailyRetry);
							expect(attempts.has(e.fields!.field01!)).toBe(true);
							expect(boards.has(e.fields!.field02!)).toBe(true);
						}
					}
					for (const [score, floor] of [
						[0, 1],
						[1234, 3],
						[48210, 9],
						[1e7, 40],
					]) {
						const e = custom(
							analyticsForDailyFinish({ board, attempt, returning: returningFlag, score, floor })[0],
						);
						expect(scores.has(e.fields!.field01!)).toBe(true);
						expect(floors.has(e.fields!.field02!)).toBe(true);
						expect(combos.has(e.fields!.field03!)).toBe(true);
					}
				}
			}
		}
	});
});
