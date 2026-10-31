/**
 * Day math for the Daily (docs/DAILY.md "2. The day and the daily seed"). Pure: unix seconds in, day index out. Days
 * roll over at UTC midnight (DSD5); day 0 is 2026-01-01 (DAILY.epochSeconds), shown as Daily #1.
 */
import { DAILY } from "./config";

/** A daily run's board identity: the day it started on (DSD5) and the ruleset in force (DSD11). */
export interface DailyRunKey {
	readonly day: number;
	readonly ruleset: number;
}

/** The day index of unix time `unixSeconds` (UTC): floor((t - epoch) / secondsPerDay). Negative before the epoch. */
export function dailyDay(unixSeconds: number): number {
	return math.floor((unixSeconds - DAILY.epochSeconds) / DAILY.secondsPerDay);
}

/** Unix seconds of `day`'s first second (its UTC midnight). */
export function dailyDayStart(day: number): number {
	return DAILY.epochSeconds + day * DAILY.secondsPerDay;
}

/** Unix seconds of the next UTC midnight after `day` starts: when day + 1 begins and this day's Daily ends. */
export function dailyResetsAt(day: number): number {
	return dailyDayStart(day + 1);
}

/** The number players see: day + 1 (2026-10-31 is Daily #304). */
export function dailyLabel(day: number): number {
	return day + DAILY.labelOffset;
}

/** The daily board scope (DSD11 / DSD12): `d<day>_r<ruleset>`. */
export function dailyScope(day: number, ruleset: number = DAILY.ruleset): string {
	return `d${day}_r${ruleset}`;
}

/** The run key of a daily run started at `unixSeconds` under the current ruleset. */
export function dailyRunKeyAt(unixSeconds: number): DailyRunKey {
	return { day: dailyDay(unixSeconds), ruleset: DAILY.ruleset };
}
