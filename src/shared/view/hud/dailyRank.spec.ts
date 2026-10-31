// docs/DAILY.md DS10: the Daily's in-run rank layer. The frozen rank baseline (unknown parts, self dropped, the run's
// board and day only, complete boards), the DailyRankTracker (the row after best today: rungs, #1, beyond the rows the
// nearer of the next friend and the cut-off; thresholds once each and only on a real improvement, the highest of a frame
// wins; every friend passed once, all of a frame queued; edges held under the stage cover, none after run over, none
// with an unknown baseline) and the text / run-over / debug helpers.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { StringVars } from "shared/theme";
import {
	DailyRankTracker,
	dailyPassedMoreText,
	dailyPassedToastText,
	dailyPassedView,
	dailyRankBaselineFrom,
	dailyRankRowText,
	dailyRankShoutKey,
	debugRankBaseline,
	parseDailyRankDebug,
	type DailyRankBaseline,
	type DailyRankBoardInput,
	type DailyRankFrame,
} from "./dailyRank";
import { DAILY_RANK, FLOOR_SHOUT_PRIORITY } from "./dailyRankConfig";
import { DAILY_RANK_STRINGS } from "./dailyRankStrings";

const SELF = 999;
const DAY = 303;
const TOP = 100;

/** A board view: `scores` highest first become rows with user ids 1.. (or the given ids). */
function view(
	scores: ReadonlyArray<number>,
	o: { board?: string; friends?: boolean; day?: number; ids?: ReadonlyArray<number>; ok?: boolean } = {},
): DailyRankBoardInput {
	const rows = scores.map((score, i) => ({ userId: o.ids?.[i] ?? i + 1, name: `P${o.ids?.[i] ?? i + 1}`, score }));
	return {
		board: o.board ?? "solo",
		scope: "today",
		day: o.day ?? DAY,
		friends: o.friends,
		ok: o.ok ?? true,
		total: rows.size(),
		rows,
	};
}

/** `n` rows scored n x step down to step. */
function ladder(n: number, step: number): number[] {
	const out: number[] = [];
	for (let i = n; i >= 1; i--) out.push(i * step);
	return out;
}

function baseline(
	best: number | undefined,
	top: DailyRankBoardInput | undefined,
	friends?: DailyRankBoardInput,
	board: "solo" | "coop" = "solo",
): DailyRankBaseline {
	return dailyRankBaselineFrom({ board, best, day: DAY, top, friends, selfUserId: SELF, topCount: TOP });
}

interface Snap {
	row: string;
	from: number;
	to: number;
	gap: number;
	friend: string;
	rank: number;
	threshold: number;
	passed: string;
}

function snap(f: DailyRankFrame): Snap {
	return {
		row: f.row,
		from: f.fromRank,
		to: f.toRank,
		gap: f.gap,
		friend: f.friend?.name ?? "",
		rank: f.rank,
		threshold: f.threshold,
		passed: f.passed.map((p) => p.name).join(","),
	};
}

function step(t: DailyRankTracker, shown: number, o: { covered?: boolean; over?: boolean } = {}): Snap {
	return snap(t.frame({ shownScore: shown, underCover: o.covered ?? false, runOver: o.over ?? false }));
}

const VAR_ORDER = ["from", "to", "points", "name", "n", "score"];
function str(key: string, vars?: StringVars): string {
	let out = key;
	if (vars !== undefined) {
		for (const name of VAR_ORDER) {
			const v = vars[name];
			if (v !== undefined) out += `|${name}=${tostring(v)}`;
		}
	}
	return out;
}

describe("daily rank baseline", () => {
	it("best today unknown -> unknown: the tracker draws and fires nothing, whatever the boards say", () => {
		const b = baseline(undefined, view([500, 400]), view([450], { friends: true }));
		expect(b.kind).toBe("unknown");
		const t = new DailyRankTracker(b);
		for (const s of [0, 460, 600, 10000]) {
			expect(step(t, s)).toEqual({
				row: "none",
				from: 0,
				to: 0,
				gap: 0,
				friend: "",
				rank: 0,
				threshold: 0,
				passed: "",
			});
		}
	});

	it("drops the player's own row, junk scores, failed / other-board / other-day / wrong-kind answers", () => {
		const own = view([500, 400, 300], { ids: [1, SELF, 3] });
		const b = baseline(200, own);
		if (b.kind !== "known") error("expected known");
		expect(b.rows!.map((r) => r.userId)).toEqual([1, 3]);
		expect(b.complete).toBe(true); // 3 rows read < 100: the whole board
		expect(baseline(0, view([5], { ok: false })).kind === "known").toBe(true);
		const failed = baseline(0, view([5], { ok: false }));
		const otherBoard = baseline(0, view([5], { board: "coop" }));
		const otherDay = baseline(0, view([5], { day: DAY - 1 }));
		const friendsAsTop = baseline(0, view([5], { friends: true }));
		for (const x of [failed, otherBoard, otherDay, friendsAsTop]) {
			if (x.kind !== "known") error("expected known");
			expect(x.rows).toBe(undefined);
		}
		const junk = baseline(0, { ...view([5]), rows: [{ userId: 1, name: "a", score: 0 / 0 }] });
		if (junk.kind !== "known") error("expected known");
		expect(junk.rows!.size()).toBe(0);
		// a full top read is not complete: ranks may lie beyond it
		const full = baseline(0, view(ladder(TOP, 10)));
		if (full.kind !== "known") error("expected known");
		expect([full.complete, full.rows!.size(), full.total]).toEqual([false, TOP, TOP]);
	});

	it("co-op runs read today's co-op board (a solo answer is ignored for them, and the reverse)", () => {
		const solo = view([900, 800], { board: "solo" });
		const coop = view([300, 200], { board: "coop" });
		const c = baseline(0, coop, undefined, "coop");
		const wrong = baseline(0, solo, undefined, "coop");
		if (c.kind !== "known" || wrong.kind !== "known") error("expected known");
		expect([c.board, c.rows!.map((r) => r.score)]).toEqual(["coop", [300, 200]]);
		expect(wrong.rows).toBe(undefined);
		const t = new DailyRankTracker(c);
		expect(step(t, 250).row).toBe("rung");
		expect(step(t, 250).from).toBe(2);
	});
});

describe("daily rank tracker: the target row", () => {
	it("before best today: none (new best's row stays); after it the next rung, then #1", () => {
		const t = new DailyRankTracker(baseline(350, view([500, 400, 300])));
		expect(step(t, 100).row).toBe("none");
		expect(step(t, 350).row).toBe("none"); // equal is not past
		// 351: 500 and 400 still above -> #3, 50 to pass the 400
		expect(step(t, 351)).toEqual({
			row: "rung",
			from: 3,
			to: 2,
			gap: 50,
			friend: "",
			rank: 3,
			threshold: 0,
			passed: "",
		});
		// a tie keeps the older entry above: 400 shown is still #3 behind the 400
		const t2 = new DailyRankTracker(baseline(0, view([500, 400, 300])));
		expect(step(t2, 400)).toEqual({
			row: "rung",
			from: 3,
			to: 2,
			gap: 1,
			friend: "",
			rank: 3,
			threshold: 3, // three others on the board and no entry before: entering the top 3
			passed: "",
		});
		expect(step(t2, 501).row).toBe("top");
		expect([step(t2, 600).from, step(t2, 600).to, step(t2, 600).rank]).toEqual([1, 1, 1]);
	});

	it("no entry today (best 0): the rank layer owns the row from the first point", () => {
		const t = new DailyRankTracker(baseline(0, view([50, 40])));
		expect(step(t, 0).row).toBe("none");
		expect(step(t, 1)).toEqual({
			row: "rung",
			from: 3,
			to: 2,
			gap: 40,
			friend: "",
			rank: 3,
			threshold: 0,
			passed: "",
		});
	});

	it("beyond the rows read: the nearer of the next friend and the top-rows cut-off", () => {
		const rows = ladder(TOP, 100); // 10000 .. 100
		// a friend outside the top rows at 60, another at 95
		const friends = view([95, 60], { friends: true, ids: [501, 502] });
		const t = new DailyRankTracker(baseline(0, view(rows), friends));
		const a = step(t, 10);
		expect([a.row, a.friend, a.gap, a.rank]).toEqual(["friend", "P502", 51, 0]);
		const b = step(t, 70); // passed 60: next friend 95 (gap 26) vs cut-off 100 (gap 31)
		expect([b.row, b.friend, b.gap, b.passed]).toEqual(["friend", "P501", 26, "P502"]);
		const c = step(t, 99); // passed 95: only the cut-off is left
		expect([c.row, c.gap, c.passed]).toEqual(["cutoff", 2, "P501"]);
		const d = step(t, 101); // in the top rows now: #100 -> #99
		expect([d.row, d.from, d.to, d.gap]).toEqual(["rung", 100, 99, 100]);
	});

	it("top rows unknown: the next friend only, else none (new best's NEW BEST TODAY row stays)", () => {
		const t = new DailyRankTracker(baseline(100, undefined, view([300, 200], { friends: true })));
		expect([step(t, 150).row, step(t, 150).friend, step(t, 150).gap]).toEqual(["friend", "P2", 51]);
		expect(step(t, 301).row).toBe("none");
	});
});

describe("daily rank tracker: edges", () => {
	it("each threshold once, on entering it; several in one frame shout the highest (#1 > top 3 > 10 > 100)", () => {
		const t = new DailyRankTracker(baseline(0, view(ladder(TOP, 10)))); // 1000 .. 10, a full top read
		expect(step(t, 5).threshold).toBe(0); // beyond the rows
		expect(step(t, 11).threshold).toBe(100); // passes the last row: #100
		expect(step(t, 12).threshold).toBe(0); // once
		expect(step(t, 911).threshold).toBe(10); // nine rows above: #10
		expect(step(t, 2000).threshold).toBe(1); // skips top 3 in the same frame: the highest wins
		expect(step(t, 2001).threshold).toBe(0);
		const jump = new DailyRankTracker(baseline(0, view(ladder(TOP, 10))));
		expect(step(jump, 5000).threshold).toBe(1); // 100, 10, 3 and 1 in one frame: one shout, #1
		expect(step(jump, 6000).threshold).toBe(0); // every one of them spent
	});

	it("no threshold the player already held with best today, none on a board too short to pass anyone", () => {
		// best today 955 is already #6 (top 10): reaching #4 or the top 10 again is no news, top 3 is
		const t = new DailyRankTracker(baseline(955, view(ladder(TOP, 10))));
		expect(step(t, 975).threshold).toBe(0); // 1000, 990, 980 above -> #4
		expect(step(t, 985).threshold).toBe(3);
		// a board of 2 others: no top 100 / 10 / 3, but passing both is #1
		const short = new DailyRankTracker(baseline(0, view([20, 10])));
		expect(step(short, 15).threshold).toBe(0);
		expect(step(short, 21).threshold).toBe(1);
		// an empty board: the first run of the day is never #1 news
		const empty = new DailyRankTracker(baseline(0, view([])));
		expect([step(empty, 500).threshold, step(empty, 500).row]).toEqual([0, "top"]);
	});

	it("every friend once, in pass order; all of one frame together; friends already below best today never", () => {
		const friends = view([900, 500, 400, 120], { friends: true, ids: [11, 12, 13, 14] });
		const t = new DailyRankTracker(baseline(300, view([1000]), friends));
		expect(t.friendsAhead().map((f) => f.userId)).toEqual([13, 12, 11]); // 120 is below best today
		expect(step(t, 350).passed).toEqual("");
		expect(step(t, 401).passed).toEqual("P13");
		expect(step(t, 402).passed).toEqual("");
		expect(step(t, 950).passed).toEqual("P12,P11"); // two in one frame: both, nearest first
		expect(step(t, 2000).passed).toEqual("");
	});

	it("a friend tied with best today counts (the board kept them above), passing needs more than their score", () => {
		const t = new DailyRankTracker(baseline(300, undefined, view([300], { friends: true, ids: [7] })));
		expect(step(t, 300).passed).toBe("");
		expect(step(t, 301).passed).toBe("P7");
	});

	it("under the stage cover edges wait for the first uncovered frame (the reveal); the row still follows", () => {
		const friends = view([150], { friends: true, ids: [5] });
		const t = new DailyRankTracker(baseline(0, view([200, 100]), friends));
		const covered = step(t, 160, { covered: true });
		expect([covered.threshold, covered.passed, covered.row]).toEqual([0, "", "rung"]);
		expect(step(t, 300, { covered: true }).threshold).toBe(0);
		const reveal = step(t, 300);
		expect([reveal.threshold, reveal.passed]).toEqual([1, "P5"]);
		expect(step(t, 301).threshold).toBe(0);
	});

	it("nothing after run over: held edges are dropped and later crossings never fire", () => {
		const t = new DailyRankTracker(baseline(0, view([200, 100]), view([150], { friends: true, ids: [5] })));
		step(t, 160, { covered: true }); // held
		const over = step(t, 300, { over: true });
		expect([over.threshold, over.passed]).toEqual([0, ""]);
		expect([step(t, 400, { over: true }).threshold, step(t, 400).threshold, step(t, 400).passed]).toEqual([
			0,
			0,
			"",
		]);
	});
});

describe("daily rank text and run-over helpers", () => {
	it("row text: rung / #1 / friend / cut-off, wide and compact; none for none", () => {
		const L = (row: string, fromRank: number, toRank: number, gap: number, name?: string) =>
			({
				row,
				fromRank,
				toRank,
				gap,
				friend: name !== undefined ? { userId: 1, name, score: 1 } : undefined,
			} as Pick<DailyRankFrame, "row" | "fromRank" | "toRank" | "gap" | "friend">);
		const K = DAILY_RANK_STRINGS;
		expect(dailyRankRowText(L("rung", 41, 40, 310), false, TOP, str)).toBe(`${K.rung}|from=41|to=40|points=310`);
		expect(dailyRankRowText(L("rung", 41, 40, 310), true, TOP, str)).toBe(`${K.rungShort}|to=40|points=310`);
		expect(dailyRankRowText(L("top", 1, 1, 0), false, TOP, str)).toBe(K.top);
		expect(dailyRankRowText(L("top", 1, 1, 0), true, TOP, str)).toBe(K.topShort);
		expect(dailyRankRowText(L("friend", 0, 0, 12, "Alex"), false, TOP, str)).toBe(
			`${K.friend}|points=12|name=Alex`,
		);
		expect(dailyRankRowText(L("friend", 0, 0, 12, "Alex"), true, TOP, str)).toBe(`${K.chaseShort}|points=12`);
		expect(dailyRankRowText(L("cutoff", 0, 0, 9), false, TOP, str)).toBe(`${K.cutoff}|points=9|n=100`);
		expect(dailyRankRowText(L("none", 0, 0, 0), false, TOP, str)).toBe(undefined);
	});

	it("shout keys per threshold, the toast line, the passed row (3 headshots then +n more)", () => {
		const K = DAILY_RANK_STRINGS;
		expect(DAILY_RANK.thresholds.map((t) => dailyRankShoutKey(t))).toEqual([
			K.shout100,
			K.shout10,
			K.shout3,
			K.shout1,
		]);
		expect(dailyRankShoutKey(7)).toBe(undefined);
		expect(dailyPassedToastText({ userId: 1, name: "Alex", score: 21900 }, str)).toBe(
			`${K.passed}|name=Alex|score=21900`,
		);
		const five = [1, 2, 3, 4, 5].map((i) => ({ userId: i, name: `F${i}`, score: i }));
		const v = dailyPassedView(five);
		expect([v.shown.map((f) => f.name), v.more]).toEqual([["F1", "F2", "F3"], 2]);
		expect(dailyPassedMoreText(v.more, str)).toBe(`${K.passedMore}|n=2`);
		expect(dailyPassedMoreText(0, str)).toBe("");
		expect(dailyPassedView([]).shown.size()).toBe(0);
	});

	it("the floor shout priorities: new best > rank threshold > combo tier", () => {
		const P = FLOOR_SHOUT_PRIORITY;
		expect(P.newBest > P.rankThreshold && P.rankThreshold > P.comboTier).toBe(true);
	});
});

describe("KV_DailyRankDebug", () => {
	it("parses rows / friends / best and rejects junk", () => {
		expect(parseDailyRankDebug("rows:20:500, friends:3, best:800")).toEqual({
			rows: 20,
			step: 500,
			friendsEvery: 3,
			best: 800,
		});
		expect(parseDailyRankDebug("rows:5:10")).toEqual({ rows: 5, step: 10, friendsEvery: 0, best: 0 });
		for (const junk of [undefined, 3, "", "best:5", "rows:0:10", "rows:5", "rows:5:10,foo:1", "rows:5:1.5"]) {
			expect([junk, parseDailyRankDebug(junk)]).toEqual([junk, undefined]);
		}
	});

	it("builds a known baseline: rows scored step x count down, every n-th a friend, complete under the top count", () => {
		const b = debugRankBaseline({ rows: 4, step: 100, friendsEvery: 2, best: 150 }, "solo", TOP);
		if (b.kind !== "known") error("expected known");
		expect([b.rows!.map((r) => r.score), b.friends!.map((f) => f.userId), b.complete, b.best]).toEqual([
			[400, 300, 200, 100],
			[2, 4],
			true,
			150,
		]);
		const t = new DailyRankTracker(b);
		expect(step(t, 201)).toEqual({
			row: "rung",
			from: 3,
			to: 2,
			gap: 100,
			friend: "",
			rank: 3,
			threshold: 3, // best today 150 was #4 of 4 others
			passed: "", // Rival 2 (300) is the one friend ahead; Rival 4 (100) was below best today
		});
	});
});
