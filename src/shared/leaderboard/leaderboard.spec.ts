// Leaderboards (M5): the ordered-value encoding (ordering, tie-breaks, bounds), who posts where, the personal-best
// rules against an in-memory store behind the service's interfaces (solo, co-op members, retries after a half-done
// write), the throttled write queue and the shared TTL cache.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	COOP_MIN_PARTY,
	LEADERBOARD_POLICY,
	LeaderboardWriteQueue,
	MAX_PARTY_SIZE,
	ORDERED_VALUE_LAYOUT,
	ORDERED_VALUE_MAX_BITS,
	SharedTtlCache,
	asOrderedValue,
	boardForParty,
	decodeDetails,
	decodeOrderedValue,
	detailsKey,
	encodeOrderedValue,
	flushOnShutdown,
	isBetterValue,
	isValidLayout,
	leaderboardEligibility,
	maxEncodableScore,
	mineFromDetails,
	orderedKey,
	partyContributors,
	planPosts,
	postPersonalBest,
	pow2,
	rowsFromEntries,
	timeSlotOf,
	userIdFromKey,
	type CacheLoad,
	type DetailsStore,
	type LeaderboardBoard,
	type LeaderboardStores,
	boardRefKey,
	type OrderedScoreStore,
	type PostContext,
	type PostJob,
	type VerifiedRunPost,
} from "shared/leaderboard";

const L = ORDERED_VALUE_LAYOUT;
/** 2026-03-01, well inside the layout's time range. */
const T0 = L.epochSeconds + 59 * 86400;

// ---------------------------------------------------------------------------------------------
// In-memory stores behind the same interfaces LeaderboardService gives the poster (DataStore adapters there).

class MemoryOrdered implements OrderedScoreStore {
	readonly values = new Map<string, number>();
	readonly tagged = new Array<string>();
	failNext = 0;

	update(key: string, transform: (old: unknown) => number | undefined): void {
		if (this.failNext > 0) {
			this.failNext--;
			error("DataStore request was throttled", 0);
		}
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
	readonly owners = new Map<string, ReadonlyArray<number>>();
	failNext = 0;

	get(key: string): unknown {
		return this.docs.get(key);
	}

	update(key: string, transform: (old: unknown) => unknown, userIds?: ReadonlyArray<number>): void {
		if (this.failNext > 0) {
			this.failNext--;
			error("DataStore request was throttled", 0);
		}
		const updated = transform(this.docs.get(key));
		if (updated !== undefined) {
			this.docs.set(key, updated);
			if (userIds !== undefined) this.owners.set(key, userIds);
		}
	}
}

/** One in-memory ordered store per board and scope, keyed by boardRefKey ("solo", "coop", "solo_d303_r1", ...). */
function memoryStores() {
	const ordered = new Map<string, MemoryOrdered>([
		["solo", new MemoryOrdered()],
		["coop", new MemoryOrdered()],
	]);
	const details = new MemoryDetails();
	const stores: LeaderboardStores = {
		ordered: (ref) => {
			const key = boardRefKey(ref);
			let store = ordered.get(key);
			if (store === undefined) {
				store = new MemoryOrdered();
				ordered.set(key, store);
			}
			return store;
		},
		details,
	};
	return { stores, ordered, details };
}

function run(score: number, floor: number, members: number[], at = T0, runId = "r"): VerifiedRunPost {
	return {
		runId,
		worldKind: "game",
		members: members.map((id) => ({ userId: id, name: `p${id}` })),
		score,
		floor,
		at,
	};
}

/** Posts every job of a run; the outcomes without `previous` (checked on its own below). */
function postAll(stores: LeaderboardStores, r: VerifiedRunPost) {
	return planPosts(r).map((job) => {
		const o = postPersonalBest(stores, job);
		return { improved: o.improved, detailsWritten: o.detailsWritten };
	});
}

describe("ordered value encoding", () => {
	it("fits an exact double and round-trips its parts", () => {
		expect(isValidLayout(L)).toBe(true);
		expect(L.scoreBits + L.floorBits + L.timeBits).toBe(ORDERED_VALUE_MAX_BITS);
		const top = encodeOrderedValue({ score: math.huge, floor: math.huge, at: -math.huge });
		expect(top).toBe(pow2(53) - 1);
		expect(top + 1 - 1).toBe(top); // still exact
		expect(encodeOrderedValue({ score: 0, floor: 0, at: math.huge })).toBe(0);
		const parts = { score: 123456, floor: 37, at: T0 };
		expect(decodeOrderedValue(encodeOrderedValue(parts))).toEqual({
			score: 123456,
			floor: 37,
			timeSlot: timeSlotOf(T0),
		});
		expect(asOrderedValue(encodeOrderedValue(parts))).toBe(encodeOrderedValue(parts));
	});

	it("ranks by score, then deeper floor, then the earlier submission", () => {
		const v = (score: number, floor: number, at: number) => encodeOrderedValue({ score, floor, at });
		expect(v(101, 1, T0 + 1e7)).toBeGreaterThan(v(100, 999, T0)); // score first
		expect(v(100, 6, T0 + 1e7)).toBeGreaterThan(v(100, 5, T0)); // then floor
		expect(v(100, 5, T0)).toBeGreaterThan(v(100, 5, T0 + L.timeSlotSeconds)); // then earlier first
		expect(v(100, 5, T0)).toBe(v(100, 5, T0 + L.timeSlotSeconds - 1 - ((T0 - L.epochSeconds) % L.timeSlotSeconds)));
	});

	it("clamps out-of-range parts instead of overflowing into the next field", () => {
		const maxScore = maxEncodableScore();
		expect(maxScore).toBe(pow2(L.scoreBits) - 1);
		const clamped = decodeOrderedValue(encodeOrderedValue({ score: maxScore * 4, floor: 5000, at: T0 }));
		expect([clamped.score, clamped.floor]).toEqual([maxScore, pow2(L.floorBits) - 1]);
		const neg = decodeOrderedValue(encodeOrderedValue({ score: -5, floor: -1, at: L.epochSeconds - 100 }));
		expect(neg).toEqual({ score: 0, floor: 0, timeSlot: 0 });
		const frac = decodeOrderedValue(encodeOrderedValue({ score: 10.9, floor: 2.5, at: T0 }));
		expect([frac.score, frac.floor]).toEqual([10, 2]);
		expect(decodeOrderedValue(encodeOrderedValue({ score: 0 / 0, floor: 3, at: T0 })).score).toBe(0);
		expect(timeSlotOf(L.epochSeconds + L.timeSlotSeconds * pow2(L.timeBits) * 2)).toBe(pow2(L.timeBits) - 1);
		expect(asOrderedValue(-1)).toBe(undefined);
		expect(asOrderedValue(1.5)).toBe(undefined);
		expect(asOrderedValue("5")).toBe(undefined);
	});
});

describe("who posts where", () => {
	const ok: PostContext = {
		worldKind: "endless",
		partySize: 1,
		debug: false,
		studio: false,
		privateServer: false,
		died: true,
		bossDefeated: false,
	};

	it("only validated runs of an eligible world, never debug / Studio / VIP servers / abandoned", () => {
		expect(leaderboardEligibility(ok)).toBe(undefined);
		// Endless runs end only in death: a boss kill is a floor of the run, so R after it is an abandoned run.
		expect(LEADERBOARD_POLICY.deathOnlyWorlds).toEqual(["endless", "daily"]);
		expect(leaderboardEligibility({ ...ok, died: false, bossDefeated: true })).toBe("abandoned");
		expect(leaderboardEligibility({ ...ok, partySize: 3, died: false, bossDefeated: true })).toBe("abandoned");
		// A world whose run ENDS at the boss (the M1 run, were it eligible) still posts a boss kill.
		const m1 = { ...LEADERBOARD_POLICY, eligibleWorlds: ["endless", "game"] };
		expect(leaderboardEligibility({ ...ok, worldKind: "game", died: false, bossDefeated: true }, m1)).toBe(
			undefined,
		);
		expect(leaderboardEligibility({ ...ok, worldKind: "game", died: false }, m1)).toBe("abandoned");
		expect(leaderboardEligibility({ ...ok, worldKind: "greybox" })).toBe("world");
		expect(leaderboardEligibility({ ...ok, worldKind: "game" })).toBe("world"); // the unscored M1 run never posts
		expect(
			leaderboardEligibility({ ...ok, worldKind: "game" }, { ...LEADERBOARD_POLICY, eligibleWorlds: ["game"] }),
		).toBe(undefined);
		expect(leaderboardEligibility({ ...ok, debug: true })).toBe("debug");
		expect(leaderboardEligibility({ ...ok, studio: true })).toBe("studio");
		expect(leaderboardEligibility({ ...ok, privateServer: true })).toBe("private_server");
		expect(leaderboardEligibility({ ...ok, died: false })).toBe("abandoned");
		expect(leaderboardEligibility({ ...ok, partySize: MAX_PARTY_SIZE + 1 })).toBe("party");
	});

	it("a party run posts to co-op only when 2+ members contributed", () => {
		expect(leaderboardEligibility({ ...ok, partySize: 3 })).toBe(undefined); // default: everyone contributed
		expect(leaderboardEligibility({ ...ok, partySize: 3, contributors: 2 })).toBe(undefined);
		expect(leaderboardEligibility({ ...ok, partySize: 3, contributors: 1 })).toBe("contributors");
		expect(leaderboardEligibility({ ...ok, partySize: 2, contributors: 0 })).toBe("contributors");
		expect(leaderboardEligibility({ ...ok, partySize: 1, contributors: 1 })).toBe(undefined);
	});

	it("partyContributors: present until the end (or the wipe), or through the first floor change", () => {
		const NEVER = -1;
		const leftAt = (ticks: number[]) => (i: number) => ticks[i] === NEVER ? undefined : ticks[i];
		// 4 players, final tick 2000, floor 1 -> 2 on tick 900.
		expect(partyContributors(leftAt([NEVER, 500, 901, 2000]), 4, 2000, 900)).toEqual([true, false, true, true]);
		// Left exactly on the floor-change tick: their leave frame stepped it, so floor 1 was not played through.
		expect(partyContributors(leftAt([NEVER, 900]), 2, 2000, 900)).toEqual([true, false]);
		// The run never left floor 1: only those present at the end contributed.
		expect(partyContributors(leftAt([NEVER, 1500, NEVER]), 3, 2000, undefined)).toEqual([true, false, true]);
		// Stalled / left after the final tick (the wipe came first): still credited.
		expect(partyContributors(leftAt([2500, NEVER]), 2, 2000, undefined)).toEqual([true, true]);
	});

	it("planPosts: the credited members on the party's board, the details keep the party size", () => {
		const post: VerifiedRunPost = { ...run(80, 3, [7, 9]), partySize: 3 };
		const jobs = planPosts(post);
		expect(jobs.map((j) => [j.board, j.userId])).toEqual([
			["coop", 7],
			["coop", 9],
		]);
		expect(jobs[0].details!.partySize).toBe(3);
		expect(jobs[0].details!.members.map((m) => m.userId)).toEqual([7, 9]);
	});

	it("solo for one player, co-op from two; one job per member with the same value and details", () => {
		expect(boardForParty(1)).toBe("solo");
		expect(boardForParty(COOP_MIN_PARTY)).toBe("coop");
		expect(boardForParty(MAX_PARTY_SIZE)).toBe("coop");
		const solo = planPosts(run(50, 2, [7]));
		expect(solo.map((j) => [j.board, j.userId])).toEqual([["solo", 7]]);
		const coop = planPosts(run(80, 3, [7, 8, 9]));
		expect(coop.map((j) => [j.board, j.userId])).toEqual([
			["coop", 7],
			["coop", 8],
			["coop", 9],
		]);
		expect(coop[0].value).toBe(coop[2].value);
		expect(coop[1].details!.partySize).toBe(3);
		expect(coop[1].details!.members.map((m) => m.userId)).toEqual([7, 8, 9]);
		expect(orderedKey(7)).toBe("u_7");
		expect(detailsKey("coop", 7)).toBe("coop_u_7");
		expect(userIdFromKey("u_7")).toBe(7);
		expect(userIdFromKey("x_7")).toBe(undefined);
		expect(userIdFromKey("u_")).toBe(undefined);
	});
});

describe("personal bests (in-memory stores)", () => {
	it("a first post writes both stores; only a higher value replaces it", () => {
		const { stores, ordered, details } = memoryStores();
		const first = postAll(stores, run(100, 4, [7]));
		expect(first).toEqual([{ improved: true, detailsWritten: true }]);
		const v100 = ordered.get("solo")!.values.get("u_7");
		expect(postAll(stores, run(90, 9, [7]))).toEqual([{ improved: false, detailsWritten: false }]);
		// Same score and floor, later: ranks lower (earlier wins), not a new best.
		expect(postAll(stores, run(100, 4, [7], T0 + L.timeSlotSeconds))).toEqual([
			{ improved: false, detailsWritten: false },
		]);
		expect(ordered.get("solo")!.values.get("u_7")).toBe(v100);
		// Same score, deeper floor: ranks higher, so it is the new best.
		expect(postAll(stores, run(100, 5, [7], T0 + 1e6))).toEqual([{ improved: true, detailsWritten: true }]);
		expect(postAll(stores, run(250, 1, [7], T0, "best"))).toEqual([{ improved: true, detailsWritten: true }]);
		const d = decodeDetails(details.docs.get("solo_u_7"));
		expect([d?.score, d?.floor, d?.runId, d?.partySize]).toEqual([250, 1, "best", 1]);
		expect(details.owners.get("solo_u_7")).toEqual([7]); // tagged for erasure
		expect(ordered.get("coop")!.values.size()).toBe(0); // a solo run never touches co-op
	});

	it("a co-op run counts toward every member's co-op best, each judged on its own", () => {
		const { stores, ordered } = memoryStores();
		postAll(stores, run(300, 6, [8])); // 8's solo best, unrelated
		postAll(stores, run(500, 5, [9, 10])); // 9 and 10 already have a co-op best of 500
		const out = postAll(stores, run(400, 7, [7, 8, 9, 10]));
		expect(out.map((o) => o.improved)).toEqual([true, true, false, false]);
		const coop = ordered.get("coop")!;
		expect(decodeOrderedValue(coop.values.get("u_7")!).score).toBe(400);
		expect(decodeOrderedValue(coop.values.get("u_9")!).score).toBe(500);
		expect(decodeOrderedValue(ordered.get("solo")!.values.get("u_8")!).score).toBe(300);
		const rows = rowsFromEntries(coop.top(100), (id) => `p${id}`);
		// Equal values (same run): the store's own order, here by key ("u_10" < "u_9").
		expect(rows.map((r) => [r.rank, r.userId, r.score])).toEqual([
			[1, 10, 500],
			[2, 9, 500],
			[3, 7, 400],
			[4, 8, 400],
		]);
	});

	it("a retry after a half-done write (ordered written, details failed) still writes the details", () => {
		const { stores, details } = memoryStores();
		const [job] = planPosts(run(100, 2, [7]));
		details.failNext = 1;
		expect(() => postPersonalBest(stores, job)).toThrow();
		expect(details.docs.get("solo_u_7")).toBe(undefined);
		expect(postPersonalBest(stores, job)).toMatchObject({ improved: false, detailsWritten: true });
		expect(decodeDetails(details.docs.get("solo_u_7"))?.score).toBe(100);
		expect(postPersonalBest(stores, job)).toMatchObject({ improved: false, detailsWritten: false });
	});

	it("never lowers a best another server wrote meanwhile (the check runs inside UpdateAsync)", () => {
		const { stores, ordered } = memoryStores();
		const [job] = planPosts(run(100, 2, [7]));
		ordered.get("solo")!.values.set("u_7", encodeOrderedValue({ score: 900, floor: 1, at: T0 }));
		const outcome = postPersonalBest(stores, job);
		expect(outcome.improved).toBe(false);
		expect(outcome.previous).toBe(encodeOrderedValue({ score: 900, floor: 1, at: T0 })); // what the transform found
		expect(isBetterValue(5, undefined)).toBe(true);
		expect(isBetterValue(5, "garbage")).toBe(true);
		expect(isBetterValue(5, 5)).toBe(false);
	});

	it("the view: rows decode score and floor from the value; my best is ranked only inside the top", () => {
		const { stores, ordered, details } = memoryStores();
		for (let i = 1; i <= 5; i++) postAll(stores, run(i * 10, i, [i]));
		const rows = rowsFromEntries(ordered.get("solo")!.top(3), (id) => `p${id}`);
		expect(rows.map((r) => [r.rank, r.name, r.score, r.floor])).toEqual([
			[1, "p5", 50, 5],
			[2, "p4", 40, 4],
			[3, "p3", 30, 3],
		]);
		const mine4 = mineFromDetails(decodeDetails(details.docs.get("solo_u_4")), rows, 4);
		expect([mine4?.score, mine4?.rank]).toEqual([40, 2]);
		const mine1 = mineFromDetails(decodeDetails(details.docs.get("solo_u_1")), rows, 1);
		expect([mine1?.score, mine1?.rank]).toEqual([10, undefined]);
		expect(mineFromDetails(undefined, rows, 99)).toBe(undefined);
		expect(mineFromDetails(undefined, rows, 5)?.rank).toBe(1); // details not written yet
		expect(rowsFromEntries([{ key: "junk", value: 5 }], () => "")).toEqual([]);
	});
});

describe("LeaderboardWriteQueue", () => {
	const job = (userId: number, score: number, board: LeaderboardBoard = "solo"): PostJob => {
		const [j] = planPosts(run(score, 1, [userId]));
		return { ...j, board };
	};

	it("keeps only the best queued write per player and board", () => {
		const q = new LeaderboardWriteQueue({ count: 100, windowSeconds: 60 });
		expect(q.enqueue(job(7, 10), 0)).toBe("queued");
		expect(q.enqueue(job(7, 30), 0)).toBe("replaced");
		expect(q.enqueue(job(7, 20), 0)).toBe("kept");
		expect(q.enqueue(job(7, 5, "coop"), 0)).toBe("queued");
		expect(q.enqueue(job(8, 1), 0)).toBe("queued");
		expect(q.size()).toBe(3);
		const first = q.take(0)!;
		expect([first.job.userId, decodeOrderedValue(first.job.value).score]).toEqual([7, 30]);
	});

	it("goes out at most `count` per window, in arrival order", () => {
		const q = new LeaderboardWriteQueue({ count: 2, windowSeconds: 60 });
		for (let id = 1; id <= 4; id++) q.enqueue(job(id, 1), 0);
		expect([q.take(0)?.job.userId, q.take(1)?.job.userId, q.take(2)]).toEqual([1, 2, undefined]);
		expect(q.take(59)).toBe(undefined);
		expect(q.take(60)?.job.userId).toBe(3);
		expect(q.size()).toBe(1);
	});

	it("retries a failed write with doubling backoff (capped) and drops it after the last attempt", () => {
		const q = new LeaderboardWriteQueue(
			{ count: 100, windowSeconds: 60 },
			{ attempts: 4, baseDelaySeconds: 2, maxDelaySeconds: 5 },
		);
		q.enqueue(job(7, 1), 0);
		let t = 0;
		const delays: number[] = [];
		let item = q.take(t)!;
		for (let attempt = 1; attempt < 4; attempt++) {
			expect(q.failed(item, t)).toBe("retry");
			const before = t;
			while (q.take(t) === undefined) t += 1;
			delays.push(t - before);
			// take() removed it again; put it back as the item under test
			item = { job: item.job, attempts: attempt, notBefore: t };
		}
		expect(delays).toEqual([2, 4, 5]);
		expect(q.failed(item, t)).toBe("dropped");
		expect(q.size()).toBe(0);
	});

	it("a failed write gives way to a better one queued meanwhile; takeAll flushes everything", () => {
		const q = new LeaderboardWriteQueue({ count: 100, windowSeconds: 60 });
		q.enqueue(job(7, 10), 0);
		const taken = q.take(0)!;
		q.enqueue(job(7, 50), 0);
		expect(q.failed(taken, 0)).toBe("dropped"); // the queued 50 supersedes the failed 10
		q.enqueue(job(8, 1), 0);
		expect(q.takeAll().map((x) => x.job.userId)).toEqual([7, 8]);
		expect(q.size()).toBe(0);
	});
});

describe("SharedTtlCache", () => {
	it("serves from memory within the TTL, then fetches again", () => {
		const c = new SharedTtlCache<string, number>(60, (w) => coroutine.resume(w));
		let fetches = 0;
		const fetch = () => ++fetches;
		expect(c.load("solo", 0, fetch)).toEqual({ ok: true, value: 1, stale: false });
		expect(c.load("solo", 59, fetch)).toEqual({ ok: true, value: 1, stale: false });
		expect(c.load("solo", 60, fetch)).toEqual({ ok: true, value: 2, stale: false });
		c.invalidate("solo");
		expect(c.load("solo", 61, fetch)).toEqual({ ok: true, value: 3, stale: false });
	});

	it("callers during a load share it (one fetch), and a failed fetch serves the old value as stale", () => {
		const c = new SharedTtlCache<string, number>(60, (w) => coroutine.resume(w));
		let fetches = 0;
		const results: Array<CacheLoad<number>> = [];
		const slow = () => {
			fetches++;
			coroutine.yield(); // a DataStore call yields
			return 7;
		};
		const a = coroutine.create(() => results.push(c.load("k", 0, slow)));
		const b = coroutine.create(() => results.push(c.load("k", 0, slow)));
		coroutine.resume(a);
		coroutine.resume(b);
		expect(fetches).toBe(1);
		coroutine.resume(a); // the fetch returns; b is resumed with the same value
		expect(results).toEqual([
			{ ok: true, value: 7, stale: false },
			{ ok: true, value: 7, stale: false },
		]);
		const failing = () => error("throttled", 0);
		expect(c.load("k", 100, failing)).toEqual({ ok: true, value: 7, stale: true });
		expect(c.load("other", 100, failing)).toEqual({ ok: false, error: "throttled" });
	});

	it("an invalidate during a load wins: the loaded value is served once but not cached as fresh", () => {
		const c = new SharedTtlCache<string, number>(60, (w) => coroutine.resume(w));
		let stored = 1; // what the store holds
		let fetches = 0;
		const slow = () => {
			fetches++;
			const v = stored; // read before the write lands
			if (fetches === 1) coroutine.yield(); // the first read is the slow one (later ones run on the test thread)
			return v;
		};
		let first: CacheLoad<number> | undefined;
		const a = coroutine.create(() => (first = c.load("mine", 0, slow)));
		coroutine.resume(a);
		stored = 2; // the player posts a new best meanwhile...
		c.invalidate("mine"); // ...and the service drops their cached entry
		coroutine.resume(a);
		expect(first).toEqual({ ok: true, value: 1, stale: false });
		// The next read within the TTL fetches again and sees the new value.
		expect(c.load("mine", 1, slow)).toEqual({ ok: true, value: 2, stale: false });
		expect(fetches).toBe(2);
		expect(c.load("mine", 2, slow)).toEqual({ ok: true, value: 2, stale: false });
		expect(fetches).toBe(2);
	});
});

describe("SharedTtlCache patches", () => {
	it("a patch during a load (a histogram flush racing a shard read): the load is not cached as fresh", () => {
		const c = new SharedTtlCache<string, number>(60, (w) => coroutine.resume(w));
		let stored = 10; // the summed shards in the store
		let fetches = 0;
		const slow = () => {
			fetches++;
			const v = stored; // the shards are read before this server's flush lands
			if (fetches === 1) coroutine.yield();
			return v;
		};
		let first: CacheLoad<number> | undefined;
		const a = coroutine.create(() => (first = c.load("hist", 0, slow)));
		coroutine.resume(a);
		stored += 5; // the flush writes 5 counts...
		c.patch("hist", (v) => v + 5); // ...and patches the cached sum (nothing cached yet: a no-op on the value)
		coroutine.resume(a);
		expect(first).toEqual({ ok: true, value: 10, stale: false });
		// The next read within the TTL fetches again, so the flushed counts are not left out until it expires.
		expect(c.load("hist", 1, slow)).toEqual({ ok: true, value: 15, stale: false });
		expect(fetches).toBe(2);
	});

	it("a patch with no load in flight updates the value in place and keeps its age", () => {
		const c = new SharedTtlCache<string, number>(60, (w) => coroutine.resume(w));
		let fetches = 0;
		const fetch = () => {
			fetches++;
			return 10;
		};
		c.load("hist", 0, fetch);
		c.patch("hist", (v) => v + 5);
		expect(c.load("hist", 59, fetch)).toEqual({ ok: true, value: 15, stale: false });
		expect(fetches).toBe(1);
		expect(c.load("hist", 60, fetch)).toEqual({ ok: true, value: 10, stale: false });
		c.patch("missing", (v) => v + 1); // no slot: nothing happens
		expect(c.size()).toBe(1);
	});
});

// ---------------------------------------------------------------------------------------------
// The shutdown flush, against a fake clock: task.wait advances it one frame and resumes writes whose DataStore call
// "returned"; validations finishing mid-flush post into the queue.

describe("flushOnShutdown", () => {
	const FRAME = 1 / 60;
	const WRITE_SECONDS = 0.3;

	interface Harness {
		readonly queue: LeaderboardWriteQueue;
		readonly written: number[];
		clock: number;
		run: (budget: number) => ReturnType<typeof flushOnShutdown>;
	}

	function harness(validations: Array<{ doneAt: number; userId: number }>, failFirst = 0): Harness {
		const queue = new LeaderboardWriteQueue({ count: 1, windowSeconds: 60 }); // the rate never matters here
		const written: number[] = [];
		const sleeping: Array<{ until: number; co: thread }> = [];
		let failures = failFirst;
		const h: Harness = {
			queue,
			written,
			clock: 0,
			run: (budget) =>
				flushOnShutdown(
					{
						now: () => h.clock,
						wait: () => {
							h.clock += FRAME;
							for (const v of validations) {
								if (v.doneAt >= 0 && h.clock >= v.doneAt) {
									v.doneAt = -1;
									for (const job of planPosts(run(100, 3, [v.userId]))) queue.enqueue(job, h.clock);
								}
							}
							for (let i = sleeping.size() - 1; i >= 0; i--) {
								if (sleeping[i].until <= h.clock) coroutine.resume(sleeping.remove(i)!.co);
							}
						},
						spawn: (fn) => {
							coroutine.resume(coroutine.create(fn));
						},
						pendingValidations: () => validations.filter((v) => v.doneAt >= 0).size(),
						takeAll: () => queue.takeAll(),
						queued: () => queue.size(),
						write: (q) => {
							sleeping.push({ until: h.clock + WRITE_SECONDS, co: coroutine.running() });
							coroutine.yield(); // the DataStore call
							if (failures > 0) {
								failures--;
								queue.failed(q, h.clock); // requeued (backoff ignored by the flush)
								return;
							}
							written.push(q.job.userId);
						},
					},
					budget,
				),
		};
		return h;
	}

	it("writes what was queued AND what validations post during the flush, then stops", () => {
		const h = harness([
			{ doneAt: 1, userId: 3 },
			{ doneAt: 2.5, userId: 4 },
		]);
		for (const id of [1, 2]) for (const job of planPosts(run(50, 2, [id]))) h.queue.enqueue(job, 0);
		const r = h.run(20);
		expect(r.timedOut).toBe(false);
		expect([...h.written].sort()).toEqual([1, 2, 3, 4]);
		expect(r.started).toBe(4);
		expect([r.inFlight, r.queued, r.validating]).toEqual([0, 0, 0]);
		expect(r.seconds >= 2.5 + WRITE_SECONDS).toBe(true);
		expect(r.seconds < 3.5).toBe(true);
	});

	it("a failed write is retried within the budget", () => {
		const h = harness([], 2);
		for (const job of planPosts(run(50, 2, [9]))) h.queue.enqueue(job, 0);
		const r = h.run(20);
		expect(r.timedOut).toBe(false);
		expect(h.written).toEqual([9]);
		expect(r.started).toBe(3);
	});

	it("stops at the deadline and reports what is left", () => {
		const h = harness([{ doneAt: 999, userId: 5 }]);
		for (const job of planPosts(run(50, 2, [1]))) h.queue.enqueue(job, 0);
		const r = h.run(5);
		expect(r.timedOut).toBe(true);
		expect(h.written).toEqual([1]);
		expect(r.validating).toBe(1);
		expect(r.seconds >= 5 && r.seconds < 5 + 2 * FRAME).toBe(true);
	});

	it("returns at once when there is nothing to do", () => {
		const h = harness([]);
		const r = h.run(20);
		expect([r.started, r.timedOut, r.seconds]).toEqual([0, false, 0]);
	});
});
