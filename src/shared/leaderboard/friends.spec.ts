// Friends on the daily boards (docs/DAILY.md DS7, DSD16): lookup order (in-server friends first, then list order, up
// to 200), the per-server read budget, the shared cache per (board, scope, userId), free answers from the top rows,
// pending counts, the friends rows, and Studio's KV_FakeFriends.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY, DAILY_FRIENDS } from "shared/daily";
import {
	FriendLookupQueue,
	boardTopOf,
	dailyBoard,
	encodeOrderedValue,
	friendsRows,
	orderFriends,
	orderedKey,
	parseFakeFriends,
	type FriendLookup,
} from "shared/leaderboard";

const T0 = DAILY.epochSeconds + 303 * 86400;
const REF = dailyBoard("solo", { day: 303, ruleset: 1 });
const COOP = dailyBoard("coop", { day: 303, ruleset: 1 });
const value = (score: number) => encodeOrderedValue({ score, floor: 2, at: T0 });

function drain(q: FriendLookupQueue, now: number): FriendLookup[] {
	const out: FriendLookup[] = [];
	let l = q.take(now);
	while (l !== undefined) {
		out.push(l);
		l = q.take(now);
	}
	return out;
}

describe("orderFriends", () => {
	it("puts friends in this server first (list order kept within each group), drops repeats and the caller", () => {
		const here = new Set([30, 50]);
		expect(orderFriends([10, 20, 30, 40, 50, 20, 99], (id) => here.has(id), 99)).toEqual([30, 50, 10, 20, 40]);
	});

	it("caps at DAILY_FRIENDS.max (200), in-server friends kept first", () => {
		expect(DAILY_FRIENDS.max).toBe(200);
		const ids: number[] = [];
		for (let i = 1; i <= 250; i++) ids.push(i);
		const out = orderFriends(ids, (id) => id === 250, 0);
		expect(out.size()).toBe(200);
		expect(out[0]).toBe(250);
		expect(out[199]).toBe(199);
	});
});

describe("FriendLookupQueue", () => {
	it("reads in-server friends first, then the rest in order", () => {
		const q = new FriendLookupQueue(100, 300);
		expect(q.request(REF, [5, 6, 1, 2, 3], 2, 0)).toBe(5);
		expect(drain(q, 0).map((l) => l.userId)).toEqual([5, 6, 1, 2, 3]);
	});

	it("a later request's in-server friends jump ahead of queued strangers; a queued one is promoted", () => {
		const q = new FriendLookupQueue(100, 300);
		q.request(REF, [1, 2, 3, 4], 0, 0);
		q.request(REF, [3, 9], 2, 0); // 3 and 9 are in this server for the second player
		expect(drain(q, 0).map((l) => l.userId)).toEqual([3, 9, 1, 2, 4]);
	});

	it("stays within the read budget per minute, shared by every request", () => {
		const q = new FriendLookupQueue(3, 300);
		const ids: number[] = [];
		for (let i = 1; i <= 8; i++) ids.push(i);
		q.request(REF, ids, 0, 0);
		q.request(COOP, [100], 0, 0);
		expect(drain(q, 0).size()).toBe(3);
		expect(drain(q, 30).size()).toBe(0);
		expect(drain(q, 60).size()).toBe(3);
		expect(drain(q, 120).map((l) => l.userId)).toEqual([7, 8, 100]);
		expect(q.queuedCount()).toBe(0);
	});

	it("deduplicates per (board, scope, userId): queued, in flight and cached friends are not read twice", () => {
		const q = new FriendLookupQueue(100, 300);
		expect(q.request(REF, [1, 2], 0, 0)).toBe(2);
		expect(q.request(REF, [2, 1], 0, 0)).toBe(2); // already queued
		const [a, b] = drain(q, 0);
		expect(q.request(REF, [1, 2], 0, 1)).toBe(2); // in flight: still pending, not queued again
		expect(q.queuedCount()).toBe(0);
		q.resolve(a, value(500), 2);
		q.resolve(b, undefined, 2); // no entry
		expect(q.request(REF, [1, 2], 0, 3)).toBe(0);
		expect(q.answer(REF, 1, 3)).toEqual({ known: true, value: value(500) });
		expect(q.answer(REF, 2, 3)).toEqual({ known: true, value: undefined });
		// Another board or scope is another lookup.
		expect(q.request(COOP, [1], 0, 3)).toBe(1);
		expect(q.request(dailyBoard("solo", { day: 304, ruleset: 1 }), [1], 0, 3)).toBe(1);
	});

	it("caches answers for DAILY_FRIENDS.cacheSeconds, then looks them up again", () => {
		expect(DAILY_FRIENDS.cacheSeconds).toBe(300);
		const q = new FriendLookupQueue(100, 300);
		q.request(REF, [1], 0, 0);
		q.resolve(drain(q, 0)[0], value(10), 0);
		expect(q.request(REF, [1], 0, 299)).toBe(0);
		expect(q.request(REF, [1], 0, 300)).toBe(1);
		expect(q.cachedCount()).toBe(0); // the expired answer was pruned
	});

	it("answers from the top rows for free: an entry in the rows, or none on a complete board", () => {
		const q = new FriendLookupQueue(100, 300);
		const full = boardTopOf([{ key: orderedKey(1), value: value(900) }], 1);
		q.learnFromTop(REF, full, [1, 2], 0);
		expect(q.answer(REF, 1, 0)).toEqual({ known: true, value: value(900) });
		expect(q.answer(REF, 2, 0)).toEqual({ known: false }); // the board is full: 2 may sit below the rows
		const complete = boardTopOf([{ key: orderedKey(1), value: value(900) }], 100);
		q.learnFromTop(REF, complete, [2], 0);
		expect(q.answer(REF, 2, 0)).toEqual({ known: true, value: undefined });
		expect(q.request(REF, [1, 2, 3], 0, 0)).toBe(1);
	});

	it("a learned answer (this server's write) drops the queued lookup; a failed one is retried on the next request", () => {
		const q = new FriendLookupQueue(100, 300);
		q.request(REF, [1, 2], 0, 0);
		q.learn(REF, 1, value(42), 0);
		const taken = drain(q, 0);
		expect(taken.map((l) => l.userId)).toEqual([2]);
		q.failed(taken[0]);
		expect(q.pending(REF, [1, 2])).toBe(0);
		expect(q.request(REF, [1, 2], 0, 1)).toBe(1);
	});
});

describe("friendsRows", () => {
	it("ranks the caller and the friends with an entry among themselves", () => {
		const values = new Map<number, number>([
			[10, value(300)],
			[20, value(900)],
			[30, value(300)],
		]);
		const rows = friendsRows(
			7,
			value(500),
			[30, 20, 40, 10, 7],
			(id) => values.get(id),
			(id) => `p${id}`,
		);
		expect(rows.map((r) => [r.rank, r.userId, r.name, r.score, r.floor])).toEqual([
			[1, 20, "p20", 900, 2],
			[2, 7, "p7", 500, 2],
			[3, 10, "p10", 300, 2],
			[4, 30, "p30", 300, 2],
		]);
	});

	it("without an entry the caller is not listed", () => {
		expect(friendsRows(7, undefined, [1], () => undefined, tostring)).toEqual([]);
	});
});

describe("KV_FakeFriends (Studio)", () => {
	it("parses UserIds with spaces, negative test ids allowed, repeats dropped", () => {
		expect(DAILY_FRIENDS.fakeAttribute).toBe("KV_FakeFriends");
		expect(parseFakeFriends("1, 2 ,-1,2")).toEqual([1, 2, -1]);
		expect(parseFakeFriends("")).toBe(undefined);
		expect(parseFakeFriends("1,x")).toBe(undefined);
		expect(parseFakeFriends(5)).toBe(undefined);
	});
});
