// The Daily's menu / result text (docs/DAILY.md DS9 / DS11 / DS12): the string ids are the contract's required
// DAILY_STRING_KEYS in order and exist in every bundled pack; thousands, the countdown across the midnight edge, the
// UTC date, the standing forms (DSD15), the leaderboard tabs and the daily tab's lines, the run-over daily block's states.
import { describe, expect, it } from "@rbxts/jest-globals";
import { formatThousands } from "shared/l10n";
import { DAILY, dailyDayStart, dailyResetsAt, type DailyRunResult } from "shared/daily";
import type { LeaderboardView } from "shared/leaderboard";
import {
	DAILY_STRING_KEYS,
	PLACEHOLDER_MANIFEST,
	REQUIRED_STRING_KEYS,
	ThemePack,
	interpolate,
	type StringVars,
} from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import {
	DEFAULT_LEADERBOARD_TABS,
	RESULT_STANDING_KEYS,
	dailyBoardLines,
	dailyCivilDate,
	dailyCountdownLine,
	dailyDateText,
	dailyResultBlock,
	dailySecondsLeft,
	dailyStringKeys,
	dailyText,
	formatCountdown,
	leaderboardFilterShown,
	leaderboardTabRequest,
	standingOf,
	withLeaderboardTab,
	DAILY_STRINGS,
	baselineRecord,
	bestBlockDrawsBestLine,
	bestTargetKey,
	bestText,
	dailyServerRecords,
	recordRowText,
	runOverBestLines,
	runOverRecords,
	runOverRibbonKey,
	type DailyLine,
	type DailyResultInput,
	type DailyResultStatus,
	type RunBaseline,
} from "shared/view/hud";

const quiet = (): void => {};
const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const str = (key: string, vars?: StringVars) => pack.str(key, vars);
const text = (line: DailyLine | undefined) => (line === undefined ? undefined : dailyText(line, str));

describe("daily strings", () => {
	it("are the contract's required DAILY_STRING_KEYS, in order, in every bundled pack, well formed", () => {
		const keys = dailyStringKeys();
		expect(keys).toEqual([...DAILY_STRING_KEYS]);
		expect(new Set(keys).size()).toBe(keys.size());
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const p = new ThemePack(manifest, { warn: quiet });
			for (const key of keys) expect([key, p.hasString(key)]).toEqual([key, true]);
		}
	});
});

describe("daily text: numbers and the countdown", () => {
	it("groups thousands (shared/l10n, the source locale)", () => {
		expect(formatThousands(0)).toBe("0");
		expect(formatThousands(999)).toBe("999");
		expect(formatThousands(1000)).toBe("1,000");
		expect(formatThousands(1240)).toBe("1,240");
		expect(formatThousands(23410)).toBe("23,410");
		expect(formatThousands(1234567)).toBe("1,234,567");
		expect(formatThousands(-1500)).toBe("-1,500");
		expect(formatThousands(26870.7)).toBe("26,870");
	});

	it("formats h:mm:ss", () => {
		expect(formatCountdown(5 * 3600 + 12 * 60 + 33)).toBe("5:12:33");
		expect(formatCountdown(7)).toBe("0:00:07");
		expect(formatCountdown(23 * 3600 + 59 * 60 + 59)).toBe("23:59:59");
		expect(formatCountdown(-3)).toBe("0:00:00");
	});

	it("counts down to resetsAt and rolls over at the midnight edge without reading 0 or 24 h", () => {
		const resets = dailyResetsAt(303);
		expect(dailySecondsLeft(resets - (5 * 3600 + 12 * 60 + 33), resets)).toBe(5 * 3600 + 12 * 60 + 33);
		expect(dailySecondsLeft(resets - 1, resets)).toBe(1);
		expect(dailySecondsLeft(resets - 0.4, resets)).toBe(0);
		// The status is stale (its day is over): the next midnight by day math, kept under a day.
		expect(dailySecondsLeft(resets, resets)).toBe(DAILY.secondsPerDay - 1);
		expect(dailySecondsLeft(resets + 1, resets)).toBe(DAILY.secondsPerDay - 1);
		expect(dailySecondsLeft(resets + 2, resets)).toBe(DAILY.secondsPerDay - 2);
		expect(dailySecondsLeft(resets + 3 * DAILY.secondsPerDay + 60, resets)).toBe(DAILY.secondsPerDay - 60);
		// No status: day math only.
		expect(dailySecondsLeft(dailyDayStart(303) + 3600)).toBe(23 * 3600);
		expect(text(dailyCountdownLine(resets - 3600, resets))).toBe("New daily in 1:00:00");
		expect(text(dailyCountdownLine(resets + 2, resets))).toBe("New daily in 23:59:58");
	});
});

describe("daily text: the UTC date", () => {
	it("knows the days around the epoch, month ends, today and a leap day", () => {
		expect(dailyCivilDate(0)).toEqual({ year: 2026, month: 1, date: 1, weekday: 3 });
		expect(dailyCivilDate(-1)).toEqual({ year: 2025, month: 12, date: 31, weekday: 2 });
		expect(dailyCivilDate(58)).toEqual({ year: 2026, month: 2, date: 28, weekday: 5 });
		expect(dailyCivilDate(59)).toEqual({ year: 2026, month: 3, date: 1, weekday: 6 });
		expect(dailyCivilDate(303)).toEqual({ year: 2026, month: 10, date: 31, weekday: 5 });
		expect(dailyCivilDate(364)).toEqual({ year: 2026, month: 12, date: 31, weekday: 3 });
		expect(dailyCivilDate(789)).toEqual({ year: 2028, month: 2, date: 29, weekday: 1 });
		expect(dailyDateText(303, str)).toBe("Sat Oct 31");
		expect(dailyDateText(304, str)).toBe("Sun Nov 1");
		// The order is the `daily.date.format` string's (docs/LOCALIZATION.md L1), so a locale can reorder it.
		const reorder = (key: string, vars?: StringVars) =>
			key === "daily.date.format" ? interpolate("{date}. {month} ({weekday})", vars) : str(key, vars);
		expect(dailyDateText(303, reorder)).toBe("31. Oct (Sat)");
	});
});

describe("daily text: standings (DSD15)", () => {
	it("exact rank, percentile beyond the top rows, #n of m under 20 entrants, nothing when unknown", () => {
		expect(text(standingOf({ rank: 41, total: 500 }))).toBe("#41");
		expect(text(standingOf({ rank: 41, percentile: 9, total: 500 }))).toBe("#41");
		expect(text(standingOf({ rank: 3 }))).toBe("#3");
		expect(text(standingOf({ rank: 3, total: 12 }))).toBe("#3 of 12");
		expect(text(standingOf({ rank: 19, total: 19 }))).toBe("#19 of 19");
		expect(text(standingOf({ rank: 20, total: 20 }))).toBe("#20");
		expect(text(standingOf({ percentile: 9, total: 1240 }))).toBe("top 9%");
		expect(standingOf({ total: 1240 })).toBe(undefined);
		expect(standingOf(undefined)).toBe(undefined);
		expect(text(standingOf({ rank: 1234, total: 5000 }, RESULT_STANDING_KEYS))).toBe("#1,234 today");
		expect(text(standingOf({ percentile: 14, total: 1240 }, RESULT_STANDING_KEYS))).toBe("Top 14%");
		expect(text(standingOf({ rank: 3, total: 12 }, RESULT_STANDING_KEYS))).toBe("#3 of 12 today");
	});
});

describe("leaderboard tabs", () => {
	it("open on all time solo, drop friends on all time, keep the other parts when one changes", () => {
		expect(leaderboardTabRequest(DEFAULT_LEADERBOARD_TABS)).toEqual({ board: "solo", scope: "alltime" });
		expect(leaderboardFilterShown(DEFAULT_LEADERBOARD_TABS)).toBe(false);
		const friends = withLeaderboardTab(DEFAULT_LEADERBOARD_TABS, { friends: true });
		expect(leaderboardTabRequest(friends)).toEqual({ board: "solo", scope: "alltime" });
		const today = withLeaderboardTab(friends, { scope: "today", board: "coop" });
		expect(today).toEqual({ scope: "today", board: "coop", friends: true });
		expect(leaderboardFilterShown(today)).toBe(true);
		expect(leaderboardTabRequest(today)).toEqual({ board: "coop", scope: "today", friends: true });
		expect(leaderboardTabRequest(withLeaderboardTab(today, { scope: "yesterday", friends: false }))).toEqual({
			board: "coop",
			scope: "yesterday",
		});
	});
});

function view(patch: Partial<LeaderboardView>): LeaderboardView {
	return { board: "solo", scope: "today", ok: true, stale: false, rows: [], ...patch };
}
const ROW = { rank: 1, userId: 7, name: "Alex", score: 30000, floor: 12 };

describe("daily board lines", () => {
	it("loading, unavailable, empty and friends states", () => {
		expect(dailyBoardLines(undefined, true, str)).toEqual({
			status: "loading",
			pending: "",
			total: "",
			mine: "Your best: not played yet",
		});
		expect(dailyBoardLines(view({ ok: false }), false, str).status).toBe("unavailable");
		expect(dailyBoardLines(view({}), false, str).status).toBe("empty");
		expect(dailyBoardLines(view({ friends: true }), false, str).status).toBe("friendsEmpty");
		const filling = dailyBoardLines(view({ friends: true, pending: 12 }), false, str);
		expect([filling.status, filling.pending]).toEqual([undefined, "finding friends... (12)"]);
		const some = dailyBoardLines(view({ friends: true, pending: 3, rows: [ROW] }), false, str);
		expect([some.status, some.pending]).toEqual([undefined, "finding friends... (3)"]);
		expect(dailyBoardLines(view({ rows: [ROW], stale: true }), false, str).status).toBe("stale");
		expect(dailyBoardLines(view({ rows: [ROW] }), true, str).status).toBe("loading");
		expect(dailyBoardLines(view({ rows: [ROW], pending: 4 }), false, str).pending).toBe("");
	});

	it("entrants and your best with its standing", () => {
		const mine = { score: 23410, floor: 9, partySize: 0, at: 0 };
		const ranked = dailyBoardLines(view({ rows: [ROW], total: 1240, mine: { ...mine, rank: 41 } }), false, str);
		expect([ranked.total, ranked.mine]).toEqual(["Players: 1,240", "Your best: 23,410 (floor 9) · #41"]);
		expect(
			dailyBoardLines(view({ rows: [ROW], total: 1240, mine: { ...mine, percentile: 9 } }), false, str).mine,
		).toBe("Your best: 23,410 (floor 9) · top 9%");
		expect(dailyBoardLines(view({ rows: [ROW], total: 12, mine: { ...mine, rank: 3 } }), false, str).mine).toBe(
			"Your best: 23,410 (floor 9) · #3 of 12",
		);
		expect(dailyBoardLines(view({ rows: [ROW], mine }), false, str)).toEqual({
			status: undefined,
			pending: "",
			total: "",
			mine: "Your best: 23,410 (floor 9)",
		});
	});
});

const RESULT: DailyRunResult = {
	day: 303,
	ruleset: 1,
	posted: true,
	improved: true,
	previous: { score: 23410, floor: 9 },
};
const input = (patch: Partial<DailyResultInput>): DailyResultInput => ({
	daily: true,
	status: "accepted",
	result: RESULT,
	score: 26870,
	...patch,
});
function blockText(i: DailyResultInput) {
	const b = dailyResultBlock(i);
	if (b === undefined) return undefined;
	return {
		title: text(b.title),
		standing: text(b.standing),
		entrants: text(b.entrants),
		best: text(b.best),
		improved: b.improved,
		saved: b.saved,
	};
}

describe("run-over daily block", () => {
	it("is absent for a run that is not a daily", () => {
		expect(dailyResultBlock(input({ daily: false }))).toBe(undefined);
	});

	it("waiting: the title only, no standing and no save chip", () => {
		expect(blockText(input({ status: "pending", result: undefined, label: 304 }))).toEqual({
			title: "Daily #304",
			improved: false,
		});
		expect(blockText(input({ status: "pending", result: undefined }))).toEqual({ improved: false });
	});

	it("exact rank inside the top rows, entrants, improved best, saved", () => {
		expect(blockText(input({ result: { ...RESULT, rank: 38, total: 1240 } }))).toEqual({
			title: "Daily #304",
			standing: "#38 today",
			entrants: "Players: 1,240",
			best: "Best today 23,410 -> 26,870 pts",
			improved: true,
			saved: "saved",
		});
	});

	it("estimate beyond the top rows", () => {
		const b = blockText(input({ result: { ...RESULT, percentile: 14, total: 1240 } }));
		expect([b?.standing, b?.entrants]).toEqual(["Top 14%", "Players: 1,240"]);
	});

	it("too few entrants for a percentile: #n of m, no separate entrants line", () => {
		const b = blockText(input({ result: { ...RESULT, rank: 3, total: 12 } }));
		expect([b?.standing, b?.entrants]).toEqual(["#3 of 12 today", undefined]);
	});

	it("best-today lines: first entry of the day, not improved, left to new best's rows", () => {
		expect(blockText(input({ result: { ...RESULT, previous: undefined } }))?.best).toBe("Best today 26,870 pts");
		const kept = blockText(
			input({ result: { ...RESULT, improved: false, previous: { score: 30000, floor: 12 } } }),
		);
		expect([kept?.best, kept?.improved]).toEqual(["Best today 30,000 pts", false]);
		expect(blockText(input({ bestLineShown: true }))?.best).toBe(undefined);
	});

	it("not saved: the write did not land, rejected, skipped, or an accepted run without a daily result", () => {
		const late = blockText(input({ result: { ...RESULT, posted: false, improved: false, previous: undefined } }));
		expect([late?.saved, late?.best, late?.standing]).toEqual(["unsaved", undefined, undefined]);
		expect(blockText(input({ status: "rejected", label: 304 }))).toEqual({
			title: "Daily #304",
			improved: false,
			saved: "unsaved",
		});
		expect(blockText(input({ status: "skipped", result: undefined }))?.saved).toBe("unsaved");
		// (Built without the default result: a spread `undefined` is nil in Luau and keeps the default.)
		expect(blockText({ daily: true, status: "accepted", score: 26870 })?.saved).toBe("unsaved");
	});
});

/**
 * The run-over panel of a daily run as the client composes it (client/ui runOverBest -> BestBlock, then
 * DailyResultBlock): every line both blocks draw, in order, with the real placeholder strings.
 */
function dailyPanel(
	baseline: RunBaseline,
	status: DailyResultStatus,
	result: DailyRunResult | undefined,
	score: number,
) {
	const accepted = status === "accepted";
	const server = accepted ? dailyServerRecords(result) : undefined;
	const records =
		server !== undefined ? runOverRecords(baseline, score, 9, server) : runOverRecords(baseline, score, 9);
	const target = server !== undefined ? server.previous : baselineRecord(baseline);
	const lines = runOverBestLines(true, records, status, target, true);
	const best: string[] = [];
	if (lines.rows) for (const row of records.rows) best.push(recordRowText(row, row.to, str, formatThousands, true));
	if (lines.saved !== undefined) best.push(str(lines.saved));
	const targetText = bestText(lines.target, bestTargetKey(true), str, formatThousands);
	if (targetText !== "") best.push(targetText);
	const block = dailyResultBlock({
		daily: true,
		status,
		result,
		score,
		label: 304,
		bestLineShown: bestBlockDrawsBestLine(lines),
	});
	const daily: string[] = [];
	for (const line of [block?.title, block?.standing, block?.entrants, block?.best]) {
		const t = text(line);
		if (t !== undefined) daily.push(t);
	}
	if (block?.saved !== undefined) {
		daily.push(str(block.saved === "saved" ? DAILY_STRINGS.resultSaved : DAILY_STRINGS.resultUnsaved));
	}
	const ribbonKey = runOverRibbonKey(records, true);
	return { ribbon: ribbonKey !== undefined ? str(ribbonKey) : undefined, best, daily };
}

/** How many of the panel's lines start with `prefix`. */
function count(panel: { best: string[]; daily: string[] }, prefix: string): number {
	let n = 0;
	for (const line of [...panel.best, ...panel.daily]) if (line.sub(1, prefix.size()) === prefix) n++;
	return n;
}

describe("run over on a daily run: one owner per piece (new best's block, then the daily block)", () => {
	const known: RunBaseline = { kind: "known", board: "solo", score: 23410, floor: 0, daily: true };
	const first: RunBaseline = { kind: "none", board: "solo", score: 0, floor: 0, daily: true };

	it("improved: new best's record row, then the standing and ONE Saved chip (no second best-today line)", () => {
		const p = dailyPanel(known, "accepted", { ...RESULT, rank: 38, total: 1240 }, 26870);
		expect(p).toEqual({
			ribbon: "NEW BEST TODAY!",
			best: ["Best today 23,410 -> 26,870 pts (+3,460)"],
			daily: ["Daily #304", "#38 today", "Players: 1,240", "Saved"],
		});
		expect([count(p, "Saved"), count(p, "Best today")]).toEqual([1, 1]);
	});

	it("first run today: the FIRST RUN TODAY ribbon (no rows), the daily block's Best today line and ONE Saved chip", () => {
		const p = dailyPanel(first, "accepted", { ...RESULT, previous: undefined, rank: 1, total: 1 }, 26870);
		expect(p).toEqual({
			ribbon: "FIRST RUN TODAY",
			best: [],
			daily: ["Daily #304", "#1 of 1 today", "Best today 26,870 pts", "Saved"],
		});
	});

	it("not improved: new best's dim Best today target line only once, then the standing and Saved", () => {
		const kept = { ...RESULT, improved: false, previous: { score: 30000, floor: 12 }, rank: 12, total: 1240 };
		const p = dailyPanel(known, "accepted", kept, 26870);
		expect(p).toEqual({
			ribbon: undefined,
			best: ["Best today 30,000 pts"],
			daily: ["Daily #304", "#12 today", "Players: 1,240", "Saved"],
		});
		expect([count(p, "Saved"), count(p, "Best today")]).toEqual([1, 1]);
	});

	it("not saved: rejected or not posted, ONE Not saved chip (new best draws no unsaved chip on a daily run)", () => {
		const rejected = dailyPanel(known, "rejected", undefined, 26870);
		expect(rejected).toEqual({
			ribbon: "NEW BEST TODAY!",
			best: ["Best today 23,410 -> 26,870 pts (+3,460)"],
			daily: ["Daily #304", "Not saved"],
		});
		const late = dailyPanel(
			known,
			"accepted",
			{ ...RESULT, posted: false, improved: false, previous: undefined },
			26870,
		);
		expect(late).toEqual({ ribbon: undefined, best: [], daily: ["Daily #304", "Not saved"] });
		expect([count(rejected, "Not saved"), count(late, "Not saved")]).toEqual([1, 1]);
	});

	it("waiting: new best's guess (rows or target) and the daily title only, no chip anywhere", () => {
		expect(dailyPanel(known, "pending", undefined, 26870)).toEqual({
			ribbon: "NEW BEST TODAY!",
			best: ["Best today 23,410 -> 26,870 pts (+3,460)"],
			daily: ["Daily #304"],
		});
		expect(dailyPanel(known, "pending", undefined, 100)).toEqual({
			ribbon: undefined,
			best: ["Best today 23,410 pts"],
			daily: ["Daily #304"],
		});
	});

	it("the endless save chip is unchanged (new best's own, never on a daily run)", () => {
		const endless: RunBaseline = { kind: "known", board: "solo", score: 100, floor: 2 };
		const server = { scoreImproved: true, floorImproved: false, previous: { score: 100, floor: 2 } };
		const records = runOverRecords(endless, 500, 2, server);
		expect(runOverBestLines(true, records, "accepted", server.previous, false).saved).toBe("run.best.saved");
		expect(runOverBestLines(true, records, "accepted", server.previous, true).saved).toBe(undefined);
		expect(runOverBestLines(false, records, "accepted", server.previous, false)).toEqual({
			rows: false,
			target: undefined,
			saved: undefined,
		});
	});
});
