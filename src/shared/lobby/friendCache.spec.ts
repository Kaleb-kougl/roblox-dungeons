// FriendCache: misses answer false and fetch in the background, landed answers fire onChanged, failures retry,
// refreshes, the concurrency cap and forget.
import { describe, expect, it } from "@rbxts/jest-globals";
import { FRIEND_CACHE, FriendCache, type FriendCacheConfig } from "shared/lobby";

interface Harness {
	cache: FriendCache;
	/** Spawned fetch jobs not run yet (the background). */
	jobs: (() => void)[];
	/** Pairs fetched, in order ("lo:hi"). */
	fetched: string[];
	changes: string[];
	setNow: (t: number) => void;
	/** Runs the oldest queued job. */
	runOne: () => void;
	runAll: () => void;
}

function harness(friendPairs: string[], opts: { failing?: string[]; config?: FriendCacheConfig } = {}): Harness {
	let now = 0;
	const jobs: (() => void)[] = [];
	const fetched: string[] = [];
	const changes: string[] = [];
	const failing = opts.failing ?? [];
	const cache = new FriendCache({
		fetch: (a, b) => {
			const key = `${a}:${b}`;
			fetched.push(key);
			if (failing.includes(key)) error("web call failed", 0);
			return friendPairs.includes(key);
		},
		spawn: (job) => {
			jobs.push(job);
		},
		clock: () => now,
		onChanged: (a, b, friends) => {
			changes.push(`${a}:${b}=${friends}`);
		},
		config: opts.config,
	});
	const runOne = () => {
		const job = jobs.remove(0);
		if (job !== undefined) job();
	};
	const runAll = () => {
		while (jobs.size() > 0) runOne();
	};
	return { cache, jobs, fetched, changes, setNow: (t) => (now = t), runOne, runAll };
}

describe("FriendCache", () => {
	it("a miss answers false, fetches once (pair order does not matter) and serves the landed answer", () => {
		const h = harness(["1:2"]);
		expect(h.cache.areFriends(2, 1)).toBe(false);
		expect(h.cache.areFriends(1, 2)).toBe(false); // still fetching: no second fetch
		expect(h.jobs.size()).toBe(1);
		h.runAll();
		expect(h.fetched).toEqual(["1:2"]);
		expect(h.changes).toEqual(["1:2=true"]);
		expect(h.cache.areFriends(2, 1)).toBe(true);
		expect(h.jobs.size()).toBe(0);
	});

	it("a player is never their own friend (no fetch)", () => {
		const h = harness([]);
		expect(h.cache.areFriends(5, 5)).toBe(false);
		expect(h.jobs.size()).toBe(0);
		expect(h.cache.size()).toBe(0);
	});

	it("a 'not friends' answer that matches the default fires no change", () => {
		const h = harness([]);
		h.cache.prefetch(3, 4);
		h.runAll();
		expect(h.fetched).toEqual(["3:4"]);
		expect(h.changes).toEqual([]);
		expect(h.cache.areFriends(3, 4)).toBe(false);
		expect(h.jobs.size()).toBe(0); // known: no refetch before refreshSeconds
	});

	it("a failed fetch counts as not friends and is retried after retrySeconds", () => {
		const h = harness(["1:2"], { failing: ["1:2"] });
		h.cache.areFriends(1, 2);
		h.runAll();
		expect(h.cache.areFriends(1, 2)).toBe(false);
		expect(h.jobs.size()).toBe(0);
		h.setNow(FRIEND_CACHE.retrySeconds - 1);
		h.cache.areFriends(1, 2);
		expect(h.jobs.size()).toBe(0);
		h.setNow(FRIEND_CACHE.retrySeconds);
		expect(h.cache.areFriends(1, 2)).toBe(false);
		expect(h.jobs.size()).toBe(1);
	});

	it("a known answer is refetched after refreshSeconds and served meanwhile", () => {
		const friendPairs = ["1:2"];
		const h = harness(friendPairs);
		h.cache.areFriends(1, 2);
		h.runAll();
		h.setNow(FRIEND_CACHE.refreshSeconds);
		friendPairs.clear(); // they unfriended
		expect(h.cache.areFriends(1, 2)).toBe(true); // stale but served
		h.runAll();
		expect(h.changes).toEqual(["1:2=true", "1:2=false"]);
		expect(h.cache.areFriends(1, 2)).toBe(false);
	});

	it("at most maxConcurrentFetches run at once; the rest wait in order", () => {
		const config: FriendCacheConfig = { refreshSeconds: 300, retrySeconds: 30, maxConcurrentFetches: 2 };
		const h = harness([], { config });
		h.cache.prefetch(1, 2);
		h.cache.prefetch(1, 3);
		h.cache.prefetch(1, 4);
		h.cache.prefetch(1, 5);
		expect(h.cache.fetching()).toBe(2);
		expect(h.cache.waiting()).toBe(2);
		h.runOne();
		expect(h.cache.fetching()).toBe(2);
		expect(h.cache.waiting()).toBe(1);
		h.runAll();
		expect(h.fetched).toEqual(["1:2", "1:3", "1:4", "1:5"]);
		expect(h.cache.fetching()).toBe(0);
	});

	it("forget drops the player's pairs; a fetch landing after it is discarded", () => {
		const h = harness(["1:2", "2:3"]);
		h.cache.prefetch(1, 2);
		h.cache.prefetch(2, 3);
		h.cache.prefetch(3, 4);
		h.cache.forget(2);
		expect(h.cache.size()).toBe(1);
		h.runAll();
		expect(h.changes).toEqual([]);
		expect(h.cache.size()).toBe(1);
		expect(h.cache.fetching()).toBe(0);
		// Asking again after the player came back fetches afresh.
		h.cache.areFriends(1, 2);
		h.runAll();
		expect(h.cache.areFriends(1, 2)).toBe(true);
	});

	it("works with a synchronous scheduler (the fetch lands before areFriends returns its miss)", () => {
		const cache = new FriendCache({ fetch: () => true, spawn: (job) => job(), clock: () => 0 });
		expect(cache.areFriends(1, 2)).toBe(false);
		expect(cache.areFriends(1, 2)).toBe(true);
	});
});
