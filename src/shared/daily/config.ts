/**
 * Daily tunables (docs/DAILY.md "2. The day and the daily seed"). Data only: day.ts, seed.ts and the services read
 * these (CLAUDE.md "No magic numbers"). The daily seed's SECRET is not here: it lives in the server only
 * (src/server/config/daily.ts, DSD8), so no client can compute a day's seed before the server reveals it.
 */
import { KV_EPOCH_UNIX_SECONDS, SECONDS_PER_DAY } from "shared/config";

export interface DailyConfig {
	/** Unix seconds of day 0's start (UTC midnight): the leaderboard's epoch, 2026-01-01 (shared/config). */
	readonly epochSeconds: number;
	/** Seconds per day: days roll over at UTC midnight (DSD5). */
	readonly secondsPerDay: number;
	/**
	 * The ruleset in the daily board scope (DSD11). Bump it with any change that alters endless play, so a daily board
	 * never mixes two rulesets (servers on the old build keep their old scope).
	 */
	readonly ruleset: number;
	/** Shown number = day + this (day 0, 2026-01-01, is Daily #1; 2026-10-31 is Daily #304). */
	readonly labelOffset: number;
}

export const DAILY: DailyConfig = table.freeze({
	epochSeconds: KV_EPOCH_UNIX_SECONDS,
	secondsPerDay: SECONDS_PER_DAY,
	ruleset: 1,
	labelOffset: 1,
});

/**
 * The daily world's kind (shared/run worlds.ts): the endless descent (buildEndlessRunConfig) on the server's seed of
 * the day. shared/run `isEndlessWorld` is true for it.
 */
export const DAILY_WORLD_KIND = "daily";

/**
 * dailySeedFrom's 32-bit mixer: `secret ^ imul(day, dayMultiplier)` (a bijection of the day for a fixed secret: no
 * two days of one secret share a seed), then MurmurHash3's fmix32 finalizer (multipliers and shifts below). The
 * day multiplier is the golden-ratio constant (odd).
 */
export const DAILY_SEED_MIX = table.freeze({
	dayMultiplier: 0x9e3779b1,
	mulA: 0x85ebca6b,
	mulB: 0xc2b2ae35,
	shiftA: 16,
	shiftB: 13,
	shiftC: 16,
});

/** Per player: `requestDaily` calls (sliding window; extra calls are dropped: the status is pushed anyway). */
export const DAILY_REQUEST_RATE = table.freeze({ count: 6, windowSeconds: 60 });

/** DailyService (server) pacing. */
export const DAILY_SERVICE = table.freeze({
	/** How often the server checks whether the UTC day changed (the midnight push goes out within this). */
	dayCheckSeconds: 1,
});

/** DailyController (client) pacing. */
export const DAILY_CLIENT = table.freeze({
	/** After the status's `resetsAt` passes on the server clock, ask again this much later (the push may race it). */
	resetRequestDelaySeconds: 2,
	/** While the answer is still the old day (its `resetsAt` already passed), ask again this often. */
	staleRetrySeconds: 15,
	/** No answer at all yet (join): ask again this often. */
	unansweredRetrySeconds: 30,
});
