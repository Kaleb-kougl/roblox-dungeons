// Daily boards (docs/DAILY.md DS5): board refs with a scope, the request, the policy (a daily run posts to its day's
// daily board only, death-only, never Studio / private / debug / abandoned; an endless run never touches a daily
// board), the PB rule per day on in-memory scoped stores, co-op per member, the ruleset split, the after-write merge
// of the top rows, and the waits a daily verdict puts on its writes.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY, DAILY_WORLD_KIND } from "shared/daily";
import {
	ALLTIME_SCOPE,
	LEADERBOARD_DAILY_ORDERED_STORES,
	LEADERBOARD_ELIGIBLE_WORLDS,
	LEADERBOARD_ORDERED_STORES,
	LeaderboardWriteQueue,
	PostWaiters,
	alltimeBoard,
	boardRefKey,
	boardTopOf,
	dailyBoard,
	decodeOrderedValue,
	encodeOrderedValue,
	entryRank,
	isDailyBoard,
	leaderboardEligibility,
	leaderboardRequestKey,
	mergeEntry,
	orderedKey,
	orderedStoreOf,
	parseLeaderboardRequest,
	planPosts,
	postJobKey,
	postPersonalBest,
	postTarget,
	resolveBoardRequest,
	type DetailsStore,
	type LeaderboardStores,
	type OrderedScoreStore,
	type PostContext,
	type VerifiedRunPost,
} from "shared/leaderboard";
import { RECORDS_POLICY } from "shared/records";

const T0 = DAILY.epochSeconds + 303 * 86400 + 3600;
const DAY = { day: 303, ruleset: 1 };

class MemoryOrdered implements OrderedScoreStore {
	readonly values = new Map<string, number>();
	update(key: string, transform: (old: unknown) => number | undefined): void {
		const updated = transform(this.values.get(key));
		if (updated !== undefined) this.values.set(key, updated);
	}
	get(key: string): unknown {
		return this.values.get(key);
	}
	top(count: number): ReadonlyArray<{ readonly key: string; readonly value: number }> {
		const all: Array<{ key: string; value: number }> = [];
		for (const [key, value] of this.values) all.push({ key, value });
		all.sort((a, b) => a.value > b.value || (a.value === b.value && a.key < b.key));
		const out: Array<{ key: string; value: number }> = [];
		for (let i = 0; i < math.min(count, all.size()); i++) out.push(all[i]);
		return out;
	}
}

class MemoryDetails implements DetailsStore {
	readonly docs = new Map<string, unknown>();
	get(key: string): unknown {
		return this.docs.get(key);
	}
	update(key: string, transform: (old: unknown) => unknown): void {
		const updated = transform(this.docs.get(key));
		if (updated !== undefined) this.docs.set(key, updated);
	}
}

/** Ordered stores keyed "<store name>|<scope>" (as DataStoreService would tell them apart). */
function memoryStores() {
	const ordered = new Map<string, MemoryOrdered>();
	const details = new MemoryDetails();
	const storeKey = (name: string, scope?: string) => `${name}|${scope ?? "global"}`;
	const stores: LeaderboardStores = {
		ordered: (ref) => {
			const where = orderedStoreOf(ref);
			const key = storeKey(where.name, where.scope);
			let s = ordered.get(key);
			if (s === undefined) {
				s = new MemoryOrdered();
				ordered.set(key, s);
			}
			return s;
		},
		details,
	};
	const at = (name: string, scope?: string) => ordered.get(storeKey(name, scope))?.values;
	return { stores, ordered, details, at };
}

function dailyRun(score: number, members: number[], key = DAY, at = T0, floor = 3): VerifiedRunPost {
	return {
		runId: `d${score}`,
		worldKind: DAILY_WORLD_KIND,
		members: members.map((id) => ({ userId: id, name: `p${id}` })),
		score,
		floor,
		at,
		daily: key,
	};
}

function postAll(stores: LeaderboardStores, run: VerifiedRunPost) {
	return planPosts(run).map((job) => postPersonalBest(stores, job));
}

describe("board refs and requests", () => {
	it("keeps the all-time boards unscoped under their M5 names and keys", () => {
		expect(orderedStoreOf(alltimeBoard("solo"))).toEqual({ name: LEADERBOARD_ORDERED_STORES.solo });
		expect(orderedStoreOf(alltimeBoard("coop"))).toEqual({ name: "LB_Coop_v1" });
		expect(boardRefKey(alltimeBoard("solo"))).toBe("solo");
		expect(isDailyBoard(alltimeBoard("coop"))).toBe(false);
		expect(alltimeBoard("solo").scope).toBe(ALLTIME_SCOPE);
	});

	it("scopes the daily boards by day and ruleset", () => {
		const ref = dailyBoard("coop", DAY);
		expect(ref.scope).toBe("d303_r1");
		expect(orderedStoreOf(ref)).toEqual({ name: LEADERBOARD_DAILY_ORDERED_STORES.coop, scope: "d303_r1" });
		expect(orderedStoreOf(dailyBoard("solo", DAY)).name).toBe("LB_Daily_Solo_v1");
		expect(boardRefKey(ref)).toBe("coop_d303_r1");
		expect(isDailyBoard(ref)).toBe(true);
		expect(ref.daily).toEqual(DAY);
	});

	it("validates requests: board, scope, friends (daily scopes only)", () => {
		expect(parseLeaderboardRequest({ board: "solo", scope: "alltime" })).toEqual({
			board: "solo",
			scope: "alltime",
		});
		expect(parseLeaderboardRequest({ board: "coop", scope: "today", friends: true })).toEqual({
			board: "coop",
			scope: "today",
			friends: true,
		});
		expect(parseLeaderboardRequest({ board: "solo", scope: "yesterday", friends: false })).toEqual({
			board: "solo",
			scope: "yesterday",
		});
		expect(parseLeaderboardRequest({ board: "solo", scope: "alltime", friends: true })).toBe(undefined);
		expect(parseLeaderboardRequest({ board: "trio", scope: "today" })).toBe(undefined);
		expect(parseLeaderboardRequest({ board: "solo", scope: "tomorrow" })).toBe(undefined);
		expect(parseLeaderboardRequest({ board: "solo", scope: "today", friends: 1 })).toBe(undefined);
		expect(parseLeaderboardRequest("solo")).toBe(undefined);
	});

	it("resolves today / yesterday by the server's day and the current ruleset", () => {
		expect(resolveBoardRequest({ board: "solo", scope: "today" }, 303)).toEqual(
			dailyBoard("solo", { day: 303, ruleset: DAILY.ruleset }),
		);
		expect(resolveBoardRequest({ board: "coop", scope: "yesterday" }, 303)).toEqual(
			dailyBoard("coop", { day: 302, ruleset: DAILY.ruleset }),
		);
		expect(resolveBoardRequest({ board: "solo", scope: "alltime" }, 303)).toEqual(alltimeBoard("solo"));
		expect(resolveBoardRequest({ board: "solo", scope: "today" }, 303, 2).scope).toBe("d303_r2");
		expect(leaderboardRequestKey({ board: "solo", scope: "today" })).toBe("solo:today");
		expect(leaderboardRequestKey({ board: "coop", scope: "yesterday", friends: true })).toBe(
			"coop:yesterday:friends",
		);
	});
});

describe("daily posting policy", () => {
	const ok: PostContext = {
		worldKind: DAILY_WORLD_KIND,
		partySize: 1,
		debug: false,
		studio: false,
		privateServer: false,
		died: true,
		bossDefeated: false,
		daily: DAY,
	};

	it("a finished daily run with its day posts; death only, never debug / Studio / private servers", () => {
		expect(leaderboardEligibility(ok)).toBe(undefined);
		expect(leaderboardEligibility({ ...ok, died: false, bossDefeated: true })).toBe("abandoned");
		expect(leaderboardEligibility({ ...ok, died: false })).toBe("abandoned");
		expect(leaderboardEligibility({ ...ok, debug: true })).toBe("debug");
		expect(leaderboardEligibility({ ...ok, studio: true })).toBe("studio");
		expect(leaderboardEligibility({ ...ok, privateServer: true })).toBe("private_server");
		expect(leaderboardEligibility({ ...ok, partySize: 3, contributors: 1 })).toBe("contributors");
		expect(leaderboardEligibility({ ...ok, daily: undefined })).toBe("daily_key");
	});

	it("daily runs never count toward records, which stay endless-only (DSD6)", () => {
		expect(LEADERBOARD_ELIGIBLE_WORLDS).toEqual(["endless"]);
		expect(RECORDS_POLICY.eligibleWorlds.includes(DAILY_WORLD_KIND)).toBe(false);
	});

	it("targets the run's own day (never the clock at finish); endless runs always the all-time board", () => {
		const late = dailyRun(100, [7], DAY, T0 + 2 * 86400); // finished two days later
		expect(postTarget(late)).toEqual(dailyBoard("solo", DAY));
		expect(postTarget(dailyRun(100, [7, 8]))).toEqual(dailyBoard("coop", DAY));
		const endless = { ...dailyRun(100, [7]), worldKind: "endless" };
		expect(postTarget(endless)).toEqual(alltimeBoard("solo"));
		const jobs = planPosts(endless);
		expect(jobs.map((j) => [j.board, j.scope, j.details !== undefined])).toEqual([["solo", ALLTIME_SCOPE, true]]);
	});

	it("plans one daily job per credited member, without a details document", () => {
		const jobs = planPosts(dailyRun(500, [7, 8, 9]));
		expect(jobs.map((j) => [j.board, j.scope, j.userId, j.details])).toEqual([
			["coop", "d303_r1", 7, undefined],
			["coop", "d303_r1", 8, undefined],
			["coop", "d303_r1", 9, undefined],
		]);
		expect(decodeOrderedValue(jobs[0].value)).toEqual({ score: 500, floor: 3, timeSlot: 303 * 12 });
		expect(postJobKey(jobs[1])).toBe("coop:d303_r1:8");
	});
});

describe("daily personal bests (in-memory scoped stores)", () => {
	it("the PB rule per day: higher value only; another day is its own board", () => {
		const { stores, at, details } = memoryStores();
		expect(postAll(stores, dailyRun(100, [7]))[0]).toMatchObject({ improved: true, previous: undefined });
		const v100 = at("LB_Daily_Solo_v1", "d303_r1")!.get("u_7")!;
		const lower = postAll(stores, dailyRun(90, [7]))[0];
		expect(lower).toMatchObject({ improved: false, detailsWritten: false, previous: v100 });
		const higher = postAll(stores, dailyRun(250, [7]))[0];
		expect(higher).toMatchObject({ improved: true, previous: v100 });
		expect(decodeOrderedValue(at("LB_Daily_Solo_v1", "d303_r1")!.get("u_7")!).score).toBe(250);
		// The next day starts empty.
		expect(postAll(stores, dailyRun(10, [7], { day: 304, ruleset: 1 }))[0].improved).toBe(true);
		expect(decodeOrderedValue(at("LB_Daily_Solo_v1", "d304_r1")!.get("u_7")!).score).toBe(10);
		expect(details.docs.size()).toBe(0); // no details documents for daily boards (DSD12)
	});

	it("a co-op daily run posts one entry per member on the daily co-op board", () => {
		const { stores, at } = memoryStores();
		postAll(stores, dailyRun(600, [9])); // 9's solo daily, unrelated
		const out = postAll(stores, dailyRun(400, [7, 8, 9]));
		expect(out.map((o) => o.improved)).toEqual([true, true, true]);
		const coop = at("LB_Daily_Coop_v1", "d303_r1")!;
		const scores = [7, 8, 9].map((id) => decodeOrderedValue(coop.get(orderedKey(id))!).score);
		expect(scores).toEqual([400, 400, 400]);
		expect(decodeOrderedValue(at("LB_Daily_Solo_v1", "d303_r1")!.get("u_9")!).score).toBe(600);
	});

	it("an endless run never touches a daily board, and a daily run never an all-time board", () => {
		const { stores, ordered, at } = memoryStores();
		postAll(stores, { ...dailyRun(100, [7]), worldKind: "endless" });
		expect(at("LB_Solo_v1")!.get("u_7")).toBe(encodeOrderedValue({ score: 100, floor: 3, at: T0 }));
		expect(at("LB_Daily_Solo_v1", "d303_r1")).toBe(undefined);
		postAll(stores, dailyRun(900, [8]));
		expect(at("LB_Solo_v1")!.get("u_8")).toBe(undefined);
		expect(at("LB_Coop_v1")).toBe(undefined);
		const names: string[] = [];
		for (const [key] of ordered) names.push(key);
		names.sort();
		expect(names).toEqual(["LB_Daily_Solo_v1|d303_r1", "LB_Solo_v1|global"]);
	});

	it("an abandoned daily run does not post", () => {
		const ctx: PostContext = {
			worldKind: DAILY_WORLD_KIND,
			partySize: 1,
			debug: false,
			studio: false,
			privateServer: false,
			died: false,
			bossDefeated: true,
			daily: DAY,
		};
		expect(leaderboardEligibility(ctx)).toBe("abandoned");
	});

	it("the ruleset splits boards: the same day under another ruleset is another board", () => {
		const { stores, at } = memoryStores();
		postAll(stores, dailyRun(300, [7], { day: 303, ruleset: 1 }));
		postAll(stores, dailyRun(200, [7], { day: 303, ruleset: 2 }));
		expect(decodeOrderedValue(at("LB_Daily_Solo_v1", "d303_r1")!.get("u_7")!).score).toBe(300);
		expect(decodeOrderedValue(at("LB_Daily_Solo_v1", "d303_r2")!.get("u_7")!).score).toBe(200);
	});

	it("the write queue keeps daily and all-time writes of one player apart", () => {
		const q = new LeaderboardWriteQueue({ count: 100, windowSeconds: 60 });
		const [daily] = planPosts(dailyRun(100, [7]));
		const [alltime] = planPosts({ ...dailyRun(50, [7]), worldKind: "endless" });
		expect(q.enqueue(daily, 0)).toBe("queued");
		expect(q.enqueue(alltime, 0)).toBe("queued");
		const [better] = planPosts(dailyRun(200, [7]));
		expect(q.enqueue(better, 0)).toBe("replaced");
		expect(q.size()).toBe(2);
	});
});

describe("top rows after a write (mergeEntry)", () => {
	const entry = (id: number, score: number) => ({
		key: orderedKey(id),
		value: encodeOrderedValue({ score, floor: 1, at: T0 }),
	});

	it("inserts the new entry in order, replacing the player's old row; a lower value changes nothing", () => {
		const top = boardTopOf([entry(1, 500), entry(2, 300), entry(3, 100)]);
		expect(top.complete).toBe(true);
		const merged = mergeEntry(top, 3, entry(3, 400).value);
		expect(merged.entries.map((e) => e.key)).toEqual(["u_1", "u_3", "u_2"]);
		expect(entryRank(merged, 3)).toBe(2);
		expect(mergeEntry(merged, 1, entry(1, 10).value)).toBe(merged);
		const fresh = mergeEntry(top, 9, entry(9, 50).value);
		expect(entryRank(fresh, 9)).toBe(4); // last on a complete board
	});

	it("on a full board, an entry below the last row is not among the rows; the rows stay at the cap", () => {
		const rows: Array<{ key: string; value: number }> = [];
		for (let i = 1; i <= 5; i++) rows.push(entry(i, 1000 - i * 100));
		const full = boardTopOf(rows, 5);
		expect(full.complete).toBe(false);
		expect(entryRank(mergeEntry(full, 9, entry(9, 50).value, 5), 9)).toBe(undefined);
		const into = mergeEntry(full, 9, entry(9, 850).value, 5);
		expect(entryRank(into, 9)).toBe(2);
		expect(into.entries.size()).toBe(5);
		// A complete board that overflows the cap is no longer complete.
		const short = boardTopOf([entry(1, 500), entry(2, 400)], 2 + 1);
		const over = mergeEntry(mergeEntry(short, 3, entry(3, 450).value, 2), 4, entry(4, 1).value, 2);
		expect(over.complete).toBe(false);
	});
});

describe("PostWaiters (the daily verdict's waits on its writes)", () => {
	const v = (score: number) => encodeOrderedValue({ score, floor: 1, at: T0 });

	it("a write resolves the waits it covers, each judged on its own value", () => {
		const w = new PostWaiters();
		const first = w.add("solo:d303_r1:7", v(300));
		const twin = w.add("solo:d303_r1:7", v(500)); // coalesced better run of the same player
		w.written("solo:d303_r1:7", v(500), true, v(400));
		expect([first.done, twin.done]).toEqual([true, true]);
		expect(first.outcome).toEqual({ posted: true, improved: false, previous: v(400), entry: v(500) });
		expect(twin.outcome).toEqual({ posted: true, improved: true, previous: v(400), entry: v(500) });
		expect(w.size()).toBe(0);
	});

	it("an older write in flight does not resolve a better run's wait; a drop resolves as not posted", () => {
		const w = new PostWaiters();
		const better = w.add("k", v(900));
		w.written("k", v(100), true, undefined);
		expect(better.done).toBe(false);
		w.dropped("k", v(900));
		expect(better.outcome).toEqual({ posted: false, improved: false });
		const late = w.add("k", v(5));
		w.cancel(late);
		expect(w.size()).toBe(0);
	});

	it("a write that found a better entry: posted, not improved, the entry stays", () => {
		const w = new PostWaiters();
		const wait = w.add("k", v(200));
		w.written("k", v(200), false, v(800));
		expect(wait.outcome).toEqual({ posted: true, improved: false, previous: v(800), entry: v(800) });
	});
});
