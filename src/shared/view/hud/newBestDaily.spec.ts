// docs/DAILY.md DS10 / DSD6: new best on a daily run. Its baseline is best today (dailyBaselineFrom: the run's board,
// the status of the run's own seed, this day's pending daily claims folded in, unknown -> no in-run beats), score only
// (no deepest-floor beat or record row), the "best today" strings, and the endless paths untouched (baselineFrom still
// answers unranked for the daily world; withPendingRuns ignores daily claims).
import { describe, expect, it } from "@rbxts/jest-globals";
import { RANKED_WORLD_KIND } from "shared/play";
import type { StringVars } from "shared/theme";
import { DAILY_RANK_STRINGS } from "./dailyRankStrings";
import {
	NewBestTracker,
	baselineFrom,
	bestTargetKey,
	dailyBaselineFrom,
	dailyServerRecords,
	debugBaseline,
	floorTarget,
	isDailyBaseline,
	isRecordRun,
	newBestRowText,
	newBestShoutKey,
	recordRowText,
	runOverRecords,
	runOverRibbonKey,
	stageBestLine,
	withPendingRuns,
	type NewBestDailyInput,
	type PendingRunClaim,
} from "./newBest";
import { NEW_BEST_STRINGS } from "./newBestStrings";

const SEED = 123456;
const DAY = 303;

function status(mine?: NewBestDailyInput["mine"], seed = SEED): NewBestDailyInput {
	return { day: DAY, seed, mine };
}

function str(key: string, vars?: StringVars): string {
	let out = key;
	if (vars !== undefined) {
		for (const name of ["points", "old", "new", "delta", "score"]) {
			const v = vars[name];
			if (v !== undefined) out += `|${name}=${tostring(v)}`;
		}
	}
	return out;
}

describe("new best on a daily run: the baseline", () => {
	it("is best today on the run's board (solo / co-op by party size), score only", () => {
		const st = status({ solo: { score: 23410 }, coop: { score: 5000 } });
		expect(dailyBaselineFrom(st, 1, SEED, true)).toEqual({
			kind: "known",
			board: "solo",
			score: 23410,
			floor: 0,
			daily: true,
		});
		expect(dailyBaselineFrom(st, 3, SEED, true)).toEqual({
			kind: "known",
			board: "coop",
			score: 5000,
			floor: 0,
			daily: true,
		});
	});

	it("unknown (no in-run beats) without a status, without `mine`, or for another day's seed; unranked runs never", () => {
		expect(dailyBaselineFrom(undefined, 1, SEED, true)).toEqual({ kind: "unknown", board: "solo", daily: true });
		expect(dailyBaselineFrom(status(undefined), 2, SEED, true)).toEqual({
			kind: "unknown",
			board: "coop",
			daily: true,
		});
		expect(dailyBaselineFrom(status({ solo: { score: 9000 } }, SEED + 1), 1, SEED, true).kind).toBe("unknown");
		expect(dailyBaselineFrom(status({ solo: { score: 9000 } }), 1, SEED, false)).toEqual({ kind: "unranked" });
		const t = new NewBestTracker(dailyBaselineFrom(undefined, 1, SEED, true));
		const look = t.frame({
			dt: 0.016,
			shownScore: 99999,
			score: 99999,
			floor: 9,
			underCover: false,
			runOver: false,
			reducedMotion: false,
		});
		expect([look.line, look.scoreCrossed, look.fanfare]).toEqual(["none", false, false]);
	});

	it("no entry on the board today (or one under minScore) is none: quiet in-run", () => {
		expect(dailyBaselineFrom(status({ coop: { score: 9000 } }), 1, SEED, true)).toEqual({
			kind: "none",
			board: "solo",
			score: 0,
			floor: 0,
			daily: true,
		});
		expect(dailyBaselineFrom(status({ solo: { score: 400 } }), 1, SEED, true).kind).toBe("none");
	});

	it("folds in this day's pending daily claims on the board; endless claims and other days never", () => {
		const claims: PendingRunClaim[] = [
			{ board: "solo", score: 30000, floor: 7, daily: DAY },
			{ board: "solo", score: 90000, floor: 20 }, // an endless run
			{ board: "solo", score: 80000, floor: 9, daily: DAY - 1 }, // yesterday's daily
			{ board: "coop", score: 70000, floor: 9, daily: DAY },
		];
		const b = dailyBaselineFrom(status({ solo: { score: 23410 } }), 1, SEED, true, claims);
		expect(b).toEqual({ kind: "known", board: "solo", score: 30000, floor: 0, daily: true });
		// a first daily of the day still pending makes the next one's baseline known
		expect(dailyBaselineFrom(status({}), 1, SEED, true, claims).kind).toBe("known");
		// unknown stays unknown (no claim invents an entry the boards did not answer)
		expect(dailyBaselineFrom(status(undefined), 1, SEED, true, claims).kind).toBe("unknown");
	});

	it("leaves the endless paths alone: baselineFrom is unranked for the daily world, withPendingRuns skips daily claims", () => {
		const records = { loaded: true, solo: { score: 5000, floor: 3 } };
		expect(baselineFrom(records, 1, "daily", true)).toEqual({ kind: "unranked" });
		expect(baselineFrom(records, 1, RANKED_WORLD_KIND, true)).toEqual({
			kind: "known",
			board: "solo",
			score: 5000,
			floor: 3,
		});
		const daily: PendingRunClaim = { board: "solo", score: 99999, floor: 30, daily: DAY };
		expect(withPendingRuns(records, "solo", [daily])).toBe(records);
	});

	it("isDailyBaseline; the debug override keeps daily runs score only", () => {
		expect(isDailyBaseline({ kind: "known", board: "solo", score: 1, floor: 0, daily: true })).toBe(true);
		expect(isDailyBaseline({ kind: "known", board: "solo", score: 1, floor: 2 })).toBe(false);
		expect(isDailyBaseline({ kind: "unranked" })).toBe(false);
		expect(debugBaseline({ kind: "set", score: 2000, floor: 3 }, "solo", true)).toEqual({
			kind: "known",
			board: "solo",
			score: 2000,
			floor: 0,
			daily: true,
		});
		expect(debugBaseline({ kind: "first" }, "coop", true)).toEqual({
			kind: "none",
			board: "coop",
			score: 0,
			floor: 0,
			daily: true,
		});
		expect(debugBaseline({ kind: "set", score: 2000, floor: 3 }, "solo")).toEqual({
			kind: "known",
			board: "solo",
			score: 2000,
			floor: 3,
		});
	});
});

describe("new best on a daily run: beats and text", () => {
	it("the same crossing on best today; no deepest-floor beat or stage line", () => {
		const b = dailyBaselineFrom(status({ solo: { score: 2000 } }), 1, SEED, true);
		expect(floorTarget(b)).toBe(undefined);
		expect(stageBestLine(5, b, false)).toBe(undefined);
		const t = new NewBestTracker(b);
		const input = {
			dt: 0.016,
			shownScore: 2001,
			score: 2001,
			floor: 30,
			underCover: false,
			runOver: false,
			reducedMotion: false,
		};
		const look = t.frame(input);
		expect([look.scoreCrossed, look.deepestReached, look.recordFloor, look.line]).toEqual([
			true,
			false,
			0,
			"passed",
		]);
	});

	it("records: score only (a deeper floor on a none baseline is no daily record)", () => {
		const none = dailyBaselineFrom(status({}), 1, SEED, true);
		expect(isRecordRun(none, 0, 12)).toBe(false);
		expect(isRecordRun(none, 10, 1)).toBe(true);
		const r = runOverRecords(none, 500, 12);
		expect([r.record, r.first, r.rows.map((row) => row.kind)]).toEqual([true, true, ["score"]]);
		expect(runOverRecords(none, 0, 12).record).toBe(false);
		// the endless none baseline still counts a deeper floor
		expect(isRecordRun({ kind: "none", board: "solo", score: 0, floor: 0 }, 0, 12)).toBe(true);
	});

	it("the run over reads verdict.daily: improved -> a score row from the previous entry, never a floor row", () => {
		const b = dailyBaselineFrom(status({ solo: { score: 2000 } }), 1, SEED, true);
		expect(dailyServerRecords(undefined)).toBe(undefined);
		const raised = dailyServerRecords({ improved: true, previous: { score: 1500, floor: 4 } });
		expect(raised).toEqual({ scoreImproved: true, floorImproved: false, previous: { score: 1500, floor: 4 } });
		const r = runOverRecords(b, 2600, 9, raised);
		expect([r.record, r.first, r.fromServer, r.rows]).toEqual([
			true,
			false,
			true,
			[{ kind: "score", from: 1500, to: 2600, delta: 1100 }],
		]);
		// the day's first entry: no previous -> FIRST RUN TODAY
		const first = runOverRecords(b, 800, 3, dailyServerRecords({ improved: true }));
		expect([first.record, first.first]).toEqual([true, true]);
		// not raised: no record, the dim line shows the server's previous
		const kept = dailyServerRecords({ improved: false, previous: { score: 5000, floor: 7 } });
		expect(runOverRecords(b, 2600, 9, kept).record).toBe(false);
	});

	it("says best today: the row, the shout, the ribbon, the record row and the target line", () => {
		const D = DAILY_RANK_STRINGS;
		const K = NEW_BEST_STRINGS;
		const chase = { line: "chasing" as const, gap: 310, margin: 0 };
		const passed = { line: "passed" as const, gap: 0, margin: 42 };
		expect(newBestRowText(chase, false, str, undefined, true)).toBe(`${D.toGo}|points=310`);
		expect(newBestRowText(chase, true, str, undefined, true)).toBe(`${K.toGoShort}|points=310`);
		expect(newBestRowText(passed, false, str, undefined, true)).toBe(`${D.over}|points=42`);
		expect(newBestRowText(passed, true, str, undefined, true)).toBe(D.newBest);
		// endless unchanged
		expect(newBestRowText(chase, false, str)).toBe(`${K.toGo}|points=310`);
		expect([newBestShoutKey(true), newBestShoutKey()]).toEqual([D.shout, K.shout]);
		const rec = { record: true, first: false, fromServer: true, rows: [] };
		expect([runOverRibbonKey(rec, true), runOverRibbonKey({ ...rec, first: true }, true)]).toEqual([
			D.ribbon,
			D.first,
		]);
		expect(runOverRibbonKey(rec)).toBe(K.ribbon);
		const row = { kind: "score" as const, from: 100, to: 250, delta: 150 };
		expect(recordRowText(row, 250, str, undefined, true)).toBe(`${D.scoreRow}|old=100|new=250|delta=150`);
		expect(recordRowText(row, 250, str)).toBe(`${K.scoreRow}|old=100|new=250|delta=150`);
		expect([bestTargetKey(true), bestTargetKey()]).toEqual([D.target, K.target]);
	});
});
