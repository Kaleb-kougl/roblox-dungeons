/**
 * The game's calendar epoch, shared by everything that counts time in slots or days: the leaderboard's ordered value
 * (shared/leaderboard ORDERED_VALUE_LAYOUT time slot 0) and the Daily (shared/daily: day 0, shown as Daily #1). One
 * source of truth here, under shared/config, so neither module imports the other (shared/leaderboard imports
 * shared/run, which imports shared/daily).
 */

/** 2026-01-01T00:00:00Z, unix seconds. */
export const KV_EPOCH_UNIX_SECONDS = 1767225600;

/** Seconds in one UTC day (unix time has no leap seconds). */
export const SECONDS_PER_DAY = 86400;
