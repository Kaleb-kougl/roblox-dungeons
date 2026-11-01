// Yesterday's podium (docs/DAILY.md DS8) and the daily verdict / status parts (DS5): fewer than 3 entries, the
// caller on the podium, the caller ranked below it, the caller absent; `dailyMineEntry`; `dailyRunResult`.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY } from "shared/daily";
import {
	boardTopOf,
	bucketOf,
	buildPodium,
	dailyMineEntry,
	dailyRunResult,
	emptyHistCounts,
	encodeOrderedValue,
	orderedKey,
	type BoardEntry,
} from "shared/leaderboard";

const T0 = DAILY.epochSeconds + 302 * 86400;
const value = (score: number, floor = 4) => encodeOrderedValue({ score, floor, at: T0 });
const nameOf = (id: number) => `p${id}`;

function board(scores: number[], asked = 100) {
	const entries: BoardEntry[] = [];
	const counts = emptyHistCounts();
	scores.forEach((score, i) => {
		entries.push({ key: orderedKey(i + 1), value: value(score) });
		counts[bucketOf(score)] += 1;
	});
	return { top: boardTopOf(entries, asked), counts };
}

describe("buildPodium", () => {
	it("lists fewer than 3 when fewer played, with yesterday's label", () => {
		const { top, counts } = board([900, 400]);
		const p = buildPodium(302, top, nameOf, 99, undefined, counts);
		expect(p).toEqual({
			day: 302,
			label: 303,
			top: [
				{ userId: 1, name: "p1", score: 900, floor: 4 },
				{ userId: 2, name: "p2", score: 400, floor: 4 },
			],
		});
		expect(buildPodium(302, board([]).top, nameOf, 1, undefined, undefined).top).toEqual([]);
	});

	it("the caller on the podium: their entry with its exact rank of the total (few entrants: no percentile)", () => {
		const { top, counts } = board([900, 800, 700, 600, 500]);
		const p = buildPodium(302, top, nameOf, 2, top.entries[1].value, counts);
		expect(p.top.map((r) => r.userId)).toEqual([1, 2, 3]);
		expect(p.mine).toEqual({ score: 800, floor: 4, rank: 2, total: 5 });
	});

	it("the caller below the podium on a big board: exact rank and percentile inside the rows", () => {
		const scores: number[] = [];
		for (let i = 0; i < 60; i++) scores.push(10000 - i * 10);
		const { top, counts } = board(scores);
		const p = buildPodium(302, top, nameOf, 12, top.entries[11].value, counts);
		expect(p.top.size()).toBe(DAILY.podiumSize);
		expect(p.mine).toEqual({ score: 9890, floor: 4, rank: 12, percentile: 20, total: 60 });
	});

	it("the caller unranked (beyond the top rows): percentile only; without a histogram, score and floor only", () => {
		const scores: number[] = [];
		for (let i = 0; i < 400; i++) scores.push(40000 - i * 50);
		const all = board(scores);
		const rows: BoardEntry[] = [];
		for (let i = 0; i < 100; i++) rows.push(all.top.entries[i]);
		const top = boardTopOf(rows, 100);
		const mineValue = value(40000 - 300 * 50);
		const p = buildPodium(302, top, nameOf, 301, mineValue, all.counts);
		expect(p.mine?.rank).toBe(undefined);
		expect(p.mine?.total).toBe(400);
		expect(p.mine?.percentile !== undefined && math.abs(p.mine.percentile - 76) <= 3).toBe(true);
		expect(buildPodium(302, top, nameOf, 301, mineValue, undefined).mine).toEqual({ score: 25000, floor: 4 });
	});
});

describe("dailyMineEntry and dailyRunResult", () => {
	it("no entry: nothing", () => {
		expect(dailyMineEntry(1, undefined, board([5]).top, undefined)).toBe(undefined);
	});

	it("the verdict: not posted carries the day only; posted carries improved, previous and the standing", () => {
		const key = { day: 303, ruleset: 1 };
		expect(dailyRunResult(key, undefined)).toEqual({ day: 303, ruleset: 1, posted: false, improved: false });
		expect(dailyRunResult(key, { posted: false, improved: false })).toEqual({
			day: 303,
			ruleset: 1,
			posted: false,
			improved: false,
		});
		const r = dailyRunResult(
			key,
			{ posted: true, improved: true, previous: value(800, 3), entry: value(1200) },
			{ rank: 38, percentile: 4, total: 1240 },
		);
		expect(r).toEqual({
			day: 303,
			ruleset: 1,
			posted: true,
			improved: true,
			previous: { score: 800, floor: 3 },
			rank: 38,
			percentile: 4,
			total: 1240,
		});
		expect(dailyRunResult(key, { posted: true, improved: true, entry: value(5) }, {})).toEqual({
			day: 303,
			ruleset: 1,
			posted: true,
			improved: true,
		});
	});
});
