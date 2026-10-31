/**
 * The daily seed's secret (docs/DAILY.md DSD8). SERVER ONLY: src/server maps to ServerScriptService
 * (default.project.json / publish.project.json "ServerScriptService.TS" <- out/server), which never replicates to
 * clients, so no client can compute tomorrow's seed and practise it in a dev world. Never move or import this from
 * shared/ or client/; the pure mixer is shared/daily dailySeedFrom (keyless), and only today's seed is sent
 * (`dailyStatus`).
 *
 * Changing the secret changes every day's seed, so it must not change while a day's boards are live.
 */
import { Workspace } from "@rbxts/services";
import { dailySeedFrom } from "shared/daily";

/** A fixed 32-bit secret. */
export const DAILY_SECRET = 0x6b1d2c97;

/** The run seed of day `day` (shared/daily dailyDay): valid by shared/run isValidRunSeed. */
export function dailySeed(day: number): number {
	return dailySeedFrom(day, DAILY_SECRET);
}

/**
 * The server's wall clock for the Daily, unix seconds UTC (fractional): Workspace:GetServerTimeNow(), the clock the
 * client compares `resetsAt` with, so the server's day and the client's countdown agree. RunSessionService (a daily
 * start's day) and DailyService (the status, the midnight push) both read it.
 */
export function dailyClockNow(): number {
	return Workspace.GetServerTimeNow();
}
