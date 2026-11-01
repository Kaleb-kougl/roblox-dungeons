// Daily board histograms and percentiles (docs/DAILY.md DS6): bucket edges, deltas from the personal-best transform
// (first entry, replacement, same bucket, not improved), the per-server buffer, shard documents (adding, negative
// shard counts, summing), the JobId shard pick, rank estimates against exact ranks on synthetic boards (the error
// bound), and the fewer-than-20-entrants rule.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY, DAILY_HIST } from "shared/daily";
import {
	HistogramBuffer,
	addHistCounts,
	boardTopOf,
	bucketOf,
	dailyBoard,
	dailyStanding,
	decodeHistShard,
	emptyHistCounts,
	encodeOrderedValue,
	estimateRank,
	histBucketBounds,
	histBucketEdge,
	histDeltas,
	histShardKey,
	histShardOf,
	histTotal,
	maxEncodableScore,
	mergeEntry,
	orderedKey,
	percentileOf,
	sumHistShards,
	type BoardEntry,
} from "shared/leaderboard";

const T0 = DAILY.epochSeconds + 303 * 86400;
const value = (score: number, floor = 1, at = T0) => encodeOrderedValue({ score, floor, at });

describe("bucketOf", () => {
	it("has 64 buckets: 0 below 64, then 3 per doubling (x1, x5/4, x8/5), the last one open", () => {
		expect(DAILY_HIST.buckets).toBe(64);
		const firstEdges: number[] = [];
		for (let i = 0; i <= 7; i++) firstEdges.push(histBucketEdge(i));
		expect(firstEdges).toEqual([0, 64, 80, 102, 128, 160, 204, 256]);
		expect([histBucketEdge(61), histBucketEdge(62), histBucketEdge(63)]).toEqual([67108864, 83886080, 107374182]); // check-asset-ids: allow (bucket edges)
		expect(histBucketBounds(63).hi).toBe(maxEncodableScore() + 1);
		expect(histBucketBounds(0)).toEqual({ lo: 0, hi: 64 });
	});

	it("puts every edge in its own bucket and the value below it in the previous one", () => {
		for (let i = 1; i < DAILY_HIST.buckets; i++) {
			const edge = histBucketEdge(i);
			expect([i, bucketOf(edge), bucketOf(edge - 1)]).toEqual([i, i, i - 1]);
		}
		expect(bucketOf(0)).toBe(0);
		expect(bucketOf(-5)).toBe(0);
		expect(bucketOf(0 / 0)).toBe(0);
		expect(bucketOf(maxEncodableScore())).toBe(63);
		expect(bucketOf(1e12)).toBe(63);
	});

	it("is log-uniform to within a few percent: each bucket spans a ratio of 1.25-1.28", () => {
		for (let i = 1; i < DAILY_HIST.buckets - 1; i++) {
			const { lo, hi } = histBucketBounds(i);
			const ratio = hi / lo;
			expect([i, ratio >= 1.24 && ratio <= 1.29]).toEqual([i, true]);
		}
	});
});

describe("deltas from the personal-best transform", () => {
	it("a first entry adds one to its bucket", () => {
		expect(histDeltas(undefined, value(1000), true)).toEqual([{ bucket: bucketOf(1000), delta: 1 }]);
	});

	it("a replacement moves the entry: -1 in the old bucket, +1 in the new", () => {
		expect(histDeltas(value(100), value(5000), true)).toEqual([
			{ bucket: bucketOf(100), delta: -1 },
			{ bucket: bucketOf(5000), delta: 1 },
		]);
	});

	it("a replacement inside one bucket, or a write that did not raise the entry, changes nothing", () => {
		expect(bucketOf(1000)).toBe(bucketOf(1001));
		expect(histDeltas(value(1000), value(1001), true)).toEqual([]);
		expect(histDeltas(value(5000), value(100), false)).toEqual([]);
		expect(histDeltas(undefined, value(100), false)).toEqual([]);
	});
});

describe("buffer and shards", () => {
	const ref = dailyBoard("solo", { day: 303, ruleset: 1 });
	const coop = dailyBoard("coop", { day: 303, ruleset: 1 });

	it("buffers deltas per board and scope; takeAll empties it and drops boards that cancel out", () => {
		const buf = new HistogramBuffer();
		buf.add(ref, histDeltas(undefined, value(1000), true));
		buf.add(ref, histDeltas(undefined, value(1000), true));
		buf.add(coop, [{ bucket: 3, delta: 1 }]);
		buf.add(coop, [{ bucket: 3, delta: -1 }]);
		expect(buf.pending(ref)![bucketOf(1000)]).toBe(2);
		const taken = buf.takeAll();
		expect(taken.size()).toBe(1);
		expect(taken[0].ref).toEqual(ref);
		expect(histTotal(taken[0].counts)).toBe(2);
		expect(buf.size()).toBe(0);
		buf.restore(ref, taken[0].counts); // a failed flush puts them back
		expect(buf.pending(ref)![bucketOf(1000)]).toBe(2);
	});

	it("flushes add counts into a shard document (UpdateAsync transform), from nothing or garbage too", () => {
		const add = emptyHistCounts();
		add[5] = 3;
		add[9] = -1;
		const doc = addHistCounts(undefined, add);
		expect(doc.v).toBe(DAILY_HIST.version);
		expect(doc.c.size()).toBe(DAILY_HIST.buckets);
		expect([doc.c[5], doc.c[9]]).toEqual([3, -1]); // a shard may go negative
		const again = addHistCounts(doc, add);
		expect([again.c[5], again.c[9]]).toEqual([6, -2]);
		expect(addHistCounts("garbage", add).c[5]).toBe(3);
		expect(decodeHistShard({ v: 99, c: [] })).toBe(undefined);
		expect(decodeHistShard({ v: DAILY_HIST.version, c: [1, 2.5] })).toBe(undefined);
	});

	it("reads sum the shards (missing or bad ones count as empty) and clamp each bucket at 0", () => {
		const a = emptyHistCounts();
		a[5] = 4;
		a[7] = 1;
		const b = emptyHistCounts();
		b[5] = -1; // the -1 of an entry whose +1 shard a holds
		b[7] = -3; // more removals than any shard holds: clamped
		const sum = sumHistShards([addHistCounts(undefined, a), addHistCounts(undefined, b), "junk"]);
		expect([sum[5], sum[7], histTotal(sum)]).toEqual([3, 0, 3]);
	});

	it("picks a shard from the JobId (stable, in range, spread) and keys it <board>_<scope>_s<n>", () => {
		expect(histShardOf("")).toBe(histShardOf("")); // Studio's empty JobId: one fixed shard
		expect(histShardOf("abc")).toBe(histShardOf("abc"));
		const seen = new Set<number>();
		for (let i = 0; i < 400; i++) {
			const s = histShardOf(`job-${i}-3f2a`);
			expect(s >= 0 && s < DAILY_HIST.shards).toBe(true);
			seen.add(s);
		}
		expect(seen.size()).toBe(DAILY_HIST.shards);
		expect(histShardKey(ref, 3)).toBe("solo_d303_r1_s3");
	});
});

/** A deterministic uniform in (0, 1) (Park-Miller: every product stays exact in a double). */
function lcg(seed: number): () => number {
	let s = seed % 2147483647;
	return () => {
		s = (s * 16807) % 2147483647;
		return s / 2147483647;
	};
}

/** A synthetic board: `n` scores from `draw`, sorted highest first, as ordered entries, plus its histogram. */
function board(n: number, draw: () => number) {
	const scores: number[] = [];
	for (let i = 0; i < n; i++) scores.push(math.max(0, math.floor(draw())));
	scores.sort((a, b) => a > b);
	const entries: BoardEntry[] = [];
	const counts = emptyHistCounts();
	for (let i = 0; i < n; i++) {
		entries.push({ key: orderedKey(i + 1), value: value(scores[i], 1, T0 + 60 * i) });
		counts[bucketOf(scores[i])] += 1;
	}
	return { scores, entries, counts };
}

/** The worst estimate errors of a board, over every 7th entry beyond the top 100. */
function measure(n: number, draw: () => number) {
	const { scores, entries, counts } = board(n, draw);
	const topEntries: BoardEntry[] = [];
	for (let i = 0; i < 100; i++) topEntries.push(entries[i]);
	const top = boardTopOf(topEntries, 100);
	let worstRank = 0;
	let worstPct = 0;
	let worstOverBucket = 0;
	for (let i = 100; i < n; i += 7) {
		const score = scores[i];
		let higher = 0;
		while (scores[higher] > score) higher++;
		const exact = higher + 1;
		const est = estimateRank(score, top, counts)!;
		expect(est.exact).toBe(score >= scores[99]);
		const err = math.abs(est.rank - exact);
		worstRank = math.max(worstRank, err);
		worstPct = math.max(worstPct, math.abs(percentileOf(est.rank, n) - percentileOf(exact, n)));
		worstOverBucket = math.max(worstOverBucket, err - counts[bucketOf(score)]);
	}
	return { worstRank, worstPct, worstOverBucket };
}

describe("estimateRank against exact ranks (synthetic boards, 5,000 entries)", () => {
	const rand = lcg(20261031);
	const normal = () => {
		// Box-Muller.
		const u = rand();
		const v = rand();
		return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v);
	};

	it("is exact inside the top rows", () => {
		const { scores, entries, counts } = board(500, () => 1000 + rand() * 50000);
		const topEntries: BoardEntry[] = [];
		for (let i = 0; i < 100; i++) topEntries.push(entries[i]);
		const top = boardTopOf(topEntries, 100);
		for (let i = 0; i < 100; i++) {
			let higher = 0;
			while (scores[higher] > scores[i]) higher++;
			expect(estimateRank(scores[i], top, counts)).toEqual({ rank: higher + 1, exact: true });
		}
	});

	// Measured (seed 20261031, every 7th entry beyond the top 100): log-normal sigma 1: worst 34 ranks (0.7 %), 1
	// percentile point; sigma 2: 24 ranks, 1 point; bimodal (70 % around 3,000, 30 % around 60,000): 120 ranks (2.4 %),
	// 3 points. The bounds below leave no slack on the points, a little on the ranks.
	it("is off by at most the score's own bucket count, and within 1 percentile point (log-normal scores)", () => {
		const r = measure(5000, () => math.exp(math.log(20000) + 1.0 * normal()));
		expect(r.worstOverBucket <= 0).toBe(true);
		expect(r.worstPct <= 1).toBe(true);
		expect(r.worstRank <= 50).toBe(true);
		const wide = measure(5000, () => math.exp(math.log(8000) + 2.0 * normal()));
		expect(wide.worstOverBucket <= 0).toBe(true);
		expect(wide.worstPct <= 1).toBe(true);
		expect(wide.worstRank <= 50).toBe(true);
	});

	it("is within 3 percentile points (2.5 % of the entrants) on a dense bimodal board", () => {
		const bimodal = measure(5000, () => (rand() < 0.7 ? 3000 + 800 * normal() : 60000 + 15000 * normal()));
		expect(bimodal.worstOverBucket <= 0).toBe(true);
		expect(bimodal.worstPct <= 3).toBe(true);
		expect(bimodal.worstRank <= 125).toBe(true);
	});

	it("without a histogram there is no estimate beyond the rows", () => {
		const { entries } = board(300, () => 1000 + rand() * 9000);
		const topEntries: BoardEntry[] = [];
		for (let i = 0; i < 100; i++) topEntries.push(entries[i]);
		expect(estimateRank(10, boardTopOf(topEntries, 100), undefined)).toBe(undefined);
	});
});

describe("dailyStanding and the 20-entrant rule (DSD15)", () => {
	function smallBoard(n: number) {
		const entries: BoardEntry[] = [];
		const counts = emptyHistCounts();
		for (let i = 0; i < n; i++) {
			entries.push({ key: orderedKey(i + 1), value: value(30000 - i * 100) });
			counts[bucketOf(30000 - i * 100)] += 1;
		}
		return { entries, counts };
	}

	it("below 20 entrants: only an exact rank with its total, no percentile", () => {
		const { entries, counts } = smallBoard(12);
		const top = boardTopOf(entries);
		expect(dailyStanding(3, entries[2].value, top, counts)).toEqual({ rank: 3, total: 12 });
	});

	it("from 20 entrants: exact rank with percentile inside the rows", () => {
		const { entries, counts } = smallBoard(40);
		expect(dailyStanding(4, entries[3].value, boardTopOf(entries), counts)).toEqual({
			rank: 4,
			percentile: 10,
			total: 40,
		});
		expect(percentileOf(1, 1240)).toBe(1);
		expect(percentileOf(1240, 1240)).toBe(100);
		expect(percentileOf(174, 1240)).toBe(15);
	});

	it("beyond the top rows: percentile and total only (never a rank number)", () => {
		const { entries, counts } = smallBoard(300);
		const topEntries: BoardEntry[] = [];
		for (let i = 0; i < 100; i++) topEntries.push(entries[i]);
		const top = boardTopOf(topEntries, 100);
		const s = dailyStanding(250, entries[249].value, top, counts);
		expect(s.rank).toBe(undefined);
		expect(s.total).toBe(300);
		expect(s.percentile !== undefined && math.abs(s.percentile - percentileOf(250, 300)) <= 3).toBe(true);
		// Without a histogram nothing can be said there.
		expect(dailyStanding(250, entries[249].value, top, undefined)).toEqual({});
		// A fresh entry merged into the rows is exact.
		const merged = mergeEntry(top, 999, value(29950));
		expect(dailyStanding(999, value(29950), merged, counts)).toMatchObject({ rank: 2, total: 300 });
	});

	it("a short board without a histogram: exact rank and total from the rows", () => {
		const { entries } = smallBoard(25);
		expect(dailyStanding(1, entries[0].value, boardTopOf(entries), undefined)).toEqual({
			rank: 1,
			percentile: 4,
			total: 25,
		});
	});
});
