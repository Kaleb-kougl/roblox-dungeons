// The Daily's day math and seed (docs/DAILY.md DS3): UTC-midnight day boundaries from the leaderboard epoch, labels
// (2026-10-31 is Daily #304), the board scope, the keyless seed mixer (valid run seeds, all distinct and well spread
// over 10,000 days with a test secret), and the daily world building exactly the endless world for the same seed.
import { describe, expect, it } from "@rbxts/jest-globals";
import { KV_EPOCH_UNIX_SECONDS } from "shared/config";
import { ORDERED_VALUE_LAYOUT } from "shared/leaderboard";
import { hashState, createSimState } from "shared/sim";
import {
	DAILY,
	DAILY_CLIENT,
	DAILY_WORLD_KIND,
	dailyDay,
	dailyDayStart,
	dailyLabel,
	dailyResetsAt,
	dailyRunKeyAt,
	dailyScope,
	dailySeedFrom,
	dailyStatusFor,
	nextDailyRequestAt,
} from "shared/daily";
import {
	ENDLESS_WORLD_KIND,
	SERVER_REFUSED_WORLDS,
	TUTORIAL_WORLD_KIND,
	buildWorldSetup,
	isEndlessWorld,
	isRunWorldKind,
	isServerRunWorld,
	isValidRunSeed,
} from "shared/run";

/** 2026-10-31T00:00:00Z (today in the plan: Daily #304). */
const OCT_31 = 1793404800;
/** A test secret (the real one is server-only, src/server/config/daily.ts). */
const TEST_SECRET = 0x1234abcd;
const DAYS = 10000;

describe("day math", () => {
	it("starts at the leaderboard's epoch (one source of truth), day 0 = 2026-01-01", () => {
		expect(DAILY.epochSeconds).toBe(KV_EPOCH_UNIX_SECONDS);
		expect(ORDERED_VALUE_LAYOUT.epochSeconds).toBe(KV_EPOCH_UNIX_SECONDS);
		expect(DAILY.secondsPerDay).toBe(86400);
		expect(dailyDay(KV_EPOCH_UNIX_SECONDS)).toBe(0);
		expect(dailyDay(KV_EPOCH_UNIX_SECONDS - 1)).toBe(-1);
	});

	it("rolls over at UTC midnight: 23:59:59 is still the day, 00:00:00 the next", () => {
		expect(dailyDay(OCT_31)).toBe(303);
		expect(dailyDay(OCT_31 - 1)).toBe(302); // 2026-10-30T23:59:59Z
		expect(dailyDay(OCT_31 + 86399)).toBe(303); // 2026-10-31T23:59:59Z
		expect(dailyDay(OCT_31 + 86400)).toBe(304); // 2026-11-01T00:00:00Z
		expect(dailyDay(OCT_31 + 0.5)).toBe(303); // GetServerTimeNow is fractional
		expect(dailyDayStart(303)).toBe(OCT_31);
		expect(dailyResetsAt(303)).toBe(OCT_31 + 86400);
		expect(dailyResetsAt(dailyDay(OCT_31 + 86399))).toBe(OCT_31 + 86400);
	});

	it("labels day + 1: 2026-10-31 is Daily #304, 2026-01-01 is #1", () => {
		expect(dailyLabel(dailyDay(OCT_31))).toBe(304);
		expect(dailyLabel(0)).toBe(1);
	});

	it("scopes boards by day and ruleset: d<day>_r<ruleset>", () => {
		expect(dailyScope(303, 1)).toBe("d303_r1");
		expect(dailyScope(303, 7)).toBe("d303_r7");
		expect(dailyScope(303)).toBe(`d303_r${DAILY.ruleset}`);
		expect(DAILY.ruleset).toBe(1);
		expect(dailyRunKeyAt(OCT_31 + 86399)).toEqual({ day: 303, ruleset: DAILY.ruleset });
	});

	it("builds the wire status of a day", () => {
		expect(dailyStatusFor(303, 42)).toEqual({
			day: 303,
			label: 304,
			seed: 42,
			ruleset: DAILY.ruleset,
			resetsAt: OCT_31 + 86400,
		});
	});
});

describe("client re-requests", () => {
	it("retries without an answer, asks just after the reset, then keeps asking while the answer is stale", () => {
		const C = DAILY_CLIENT;
		expect(nextDailyRequestAt(undefined, 100)).toBe(100 + C.unansweredRetrySeconds);
		const today = dailyStatusFor(303, 42);
		expect(nextDailyRequestAt(today, OCT_31 + 10)).toBe(today.resetsAt + C.resetRequestDelaySeconds);
		const askedAfterReset = today.resetsAt + C.resetRequestDelaySeconds;
		expect(nextDailyRequestAt(today, askedAfterReset)).toBe(askedAfterReset + C.staleRetrySeconds);
		const tomorrow = dailyStatusFor(304, 43);
		expect(nextDailyRequestAt(tomorrow, askedAfterReset)).toBe(tomorrow.resetsAt + C.resetRequestDelaySeconds);
	});
});

describe("daily seed", () => {
	it("is a valid run seed for every day of 10,000, all distinct, and deterministic", () => {
		const seen = new Set<number>();
		for (let day = 0; day < DAYS; day++) {
			const seed = dailySeedFrom(day, TEST_SECRET);
			if (!isValidRunSeed(seed)) error(`day ${day}: invalid seed ${seed}`);
			seen.add(seed);
		}
		expect(seen.size()).toBe(DAYS);
		expect(dailySeedFrom(303, TEST_SECRET)).toBe(dailySeedFrom(303, TEST_SECRET));
		expect(isValidRunSeed(dailySeedFrom(-1, TEST_SECRET))).toBe(true); // before the epoch too
	});

	it("spreads over the whole 32-bit range (top 4 bits and every bit near 50 %)", () => {
		const buckets: number[] = [];
		const ones: number[] = [];
		for (let i = 0; i < 16; i++) buckets.push(0);
		for (let b = 0; b < 32; b++) ones.push(0);
		for (let day = 0; day < DAYS; day++) {
			const seed = dailySeedFrom(day, TEST_SECRET);
			buckets[bit32.rshift(seed, 28)] += 1;
			for (let b = 0; b < 32; b++) if (bit32.btest(seed, bit32.lshift(1, b))) ones[b] += 1;
		}
		const expected = DAYS / 16;
		for (let i = 0; i < 16; i++) {
			expect([i, buckets[i] > expected * 0.85 && buckets[i] < expected * 1.15]).toEqual([i, true]);
		}
		for (let b = 0; b < 32; b++) {
			expect([b, ones[b] > DAYS * 0.45 && ones[b] < DAYS * 0.55]).toEqual([b, true]);
		}
	});

	it("depends on the secret: another secret gives another seed for the same day", () => {
		let same = 0;
		for (let day = 0; day < 100; day++) if (dailySeedFrom(day, TEST_SECRET) === dailySeedFrom(day, 7)) same++;
		expect(same).toBe(0);
	});
});

describe("daily world", () => {
	it("is a server world, the endless descent, building the identical setup for the same seed", () => {
		expect(isRunWorldKind(DAILY_WORLD_KIND)).toBe(true);
		expect(isServerRunWorld(DAILY_WORLD_KIND)).toBe(true);
		expect(SERVER_REFUSED_WORLDS.has(DAILY_WORLD_KIND)).toBe(false);
		expect(isEndlessWorld(DAILY_WORLD_KIND)).toBe(true);
		expect(isEndlessWorld(ENDLESS_WORLD_KIND)).toBe(true);
		for (const kind of ["game", "dungeonNoEncounter", "greybox", TUTORIAL_WORLD_KIND, "nowhere"]) {
			expect([kind, isEndlessWorld(kind)]).toEqual([kind, false]);
		}
		for (const [seed, partySize] of [
			[dailySeedFrom(303, TEST_SECRET), 1],
			[1337, 3],
		] as const) {
			const daily = buildWorldSetup(DAILY_WORLD_KIND, seed, { atBossDoor: false, partySize });
			const endless = buildWorldSetup(ENDLESS_WORLD_KIND, seed, { atBossDoor: false, partySize });
			expect(daily.spawn).toEqual(endless.spawn);
			expect(daily.config.scoring).toEqual(endless.config.scoring);
			expect(daily.config.party).toEqual(endless.config.party);
			for (const floor of [1, 2, 5]) {
				const a = daily.endlessFloor!(floor);
				const b = endless.endlessFloor!(floor);
				expect([floor, a.layout.seed, a.layout.dungeon.name, a.layout.bossKind]).toEqual([
					floor,
					b.layout.seed,
					b.layout.dungeon.name,
					b.layout.bossKind,
				]);
				expect(a.layout.stairwell).toEqual(b.layout.stairwell);
				expect(a.layout.roomSpawns).toEqual(b.layout.roomSpawns);
				expect(a.layout.roomAffixes).toEqual(b.layout.roomAffixes);
			}
			const spawn = daily.spawn!;
			expect(hashState(createSimState(seed, spawn.x, spawn.z, daily.config))).toBe(
				hashState(createSimState(seed, spawn.x, spawn.z, endless.config)),
			);
		}
	});
});
