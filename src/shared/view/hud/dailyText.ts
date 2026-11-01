/**
 * The Daily's text helpers (docs/DAILY.md DS9 / DS11), shared by the main menu's Daily card and podium, the
 * leaderboard panel's daily tabs and the run-over daily block. Pure (headlessly tested, daily.spec.ts):
 *
 *   dailySecondsLeft  whole seconds to the Daily's end on the server clock: the status's `resetsAt` while it is
 *                     ahead, else the next UTC midnight from day math (a stale status past midnight never reads 0)
 *   formatCountdown   "5:12:33" (h:mm:ss)
 *   dailyCivilDate    a day index's UTC date (year, month, date, weekday): Howard Hinnant's civil_from_days
 *   dailyDateText     "Sat Oct 31" (`daily.date.format` with the weekday / month name strings)
 *   standingLine      where an entry stands (rank exact / "top N%" / "#n of m" under 20 entrants, DSD15)
 *
 * Numbers are grouped by shared/l10n formatThousands (the number locale's separator, docs/LOCALIZATION.md L2).
 */
import { DAILY, dailyDay, dailyResetsAt, type DailyStanding } from "shared/daily";
import { formatThousands } from "shared/l10n";
import type { StringVars } from "shared/theme";
import { DAILY_STRINGS, dailyMonthKey, dailyWeekdayKey } from "./dailyStrings";

/** How the Daily's clock is printed (numbers: shared/l10n formatThousands). */
export const DAILY_VIEW = {
	/** Seconds per minute / hour (the countdown's fields). */
	secondsPerMinute: 60,
	secondsPerHour: 3600,
} as const;

/** A theme string to show: its key and its vars (the client calls `str(key, vars)`). */
export interface DailyLine {
	readonly key: string;
	readonly vars?: StringVars;
}

/** A theme string lookup (ThemePack.str / the client's `str`). */
export type DailyStr = (key: string, vars?: StringVars) => string;

/** The text of a line through a lookup. */
export function dailyText(line: DailyLine, s: DailyStr): string {
	return s(line.key, line.vars);
}

/**
 * Whole seconds until the Daily ends, at server time `now` (Workspace:GetServerTimeNow): until `resetsAt` (the
 * status's) while it is still ahead, else until the next UTC midnight after `now` (day math: the status is stale, the
 * day already rolled over). Floored and kept under a day, so exactly midnight reads 23:59:59, never 24:00:00 or 0:00:00.
 */
export function dailySecondsLeft(now: number, resetsAt?: number): number {
	const endsAt = resetsAt !== undefined && now < resetsAt ? resetsAt : dailyResetsAt(dailyDay(now));
	return math.clamp(math.floor(endsAt - now), 0, DAILY.secondsPerDay - 1);
}

/** h:mm:ss ("5:12:33", "0:00:07"); negative reads 0:00:00. */
export function formatCountdown(seconds: number): string {
	const t = math.max(0, math.floor(seconds));
	const h = math.floor(t / DAILY_VIEW.secondsPerHour);
	const m = math.floor((t % DAILY_VIEW.secondsPerHour) / DAILY_VIEW.secondsPerMinute);
	const sec = t % DAILY_VIEW.secondsPerMinute;
	return string.format("%d:%02d:%02d", h, m, sec);
}

/** The countdown line ("New daily in 5:12:33") at server time `now`. */
export function dailyCountdownLine(now: number, resetsAt?: number): DailyLine {
	return { key: DAILY_STRINGS.resetsIn, vars: { time: formatCountdown(dailySecondsLeft(now, resetsAt)) } };
}

/** A UTC calendar date. */
export interface DailyCivilDate {
	readonly year: number;
	/** 1 = January. */
	readonly month: number;
	/** Day of the month, 1-based. */
	readonly date: number;
	/** 0 = Monday ... 6 = Sunday. */
	readonly weekday: number;
}

/** civil_from_days (Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms"): its fixed constants. */
const CIVIL = {
	/** Days from 0000-03-01 to 1970-01-01. */
	shift: 719468,
	daysPerEra: 146097,
	daysPer4Years: 1460,
	daysPer100Years: 36524,
	lastDayOfEra: 146096,
	daysPerYear: 365,
	yearsPerEra: 400,
	monthSpan: 153,
	/** Months are counted from March: index 10 and 11 are January and February of the next year. */
	marchBased: 10,
	marchOffset: 3,
	januaryOffset: 9,
	/** 1970-01-01 was a Thursday: index 3 with Monday 0. */
	epochWeekday: 3,
	daysPerWeek: 7,
} as const;

/** The UTC date of `day` (shared/daily day index: 0 = 2026-01-01). */
export function dailyCivilDate(day: number): DailyCivilDate {
	const C = CIVIL;
	const unixDays = math.floor(DAILY.epochSeconds / DAILY.secondsPerDay) + day;
	const z = unixDays + C.shift;
	const era = math.floor(z / C.daysPerEra);
	const doe = z - era * C.daysPerEra;
	const yoe = math.floor(
		(doe -
			math.floor(doe / C.daysPer4Years) +
			math.floor(doe / C.daysPer100Years) -
			math.floor(doe / C.lastDayOfEra)) /
			C.daysPerYear,
	);
	const doy = doe - (C.daysPerYear * yoe + math.floor(yoe / 4) - math.floor(yoe / 100));
	const mp = math.floor((5 * doy + 2) / C.monthSpan);
	const date = doy - math.floor((C.monthSpan * mp + 2) / 5) + 1;
	const month = mp < C.marchBased ? mp + C.marchOffset : mp - C.januaryOffset;
	const year = yoe + era * C.yearsPerEra + (month <= 2 ? 1 : 0);
	const weekday = (unixDays + C.epochWeekday) % C.daysPerWeek;
	return { year, month, date, weekday };
}

/** "Sat Oct 31": `daily.date.format` (the order translatable) with the weekday and month names looked up through `s`. */
export function dailyDateText(day: number, s: DailyStr): string {
	const d = dailyCivilDate(day);
	return s(DAILY_STRINGS.date, {
		weekday: s(dailyWeekdayKey(d.weekday)),
		month: s(dailyMonthKey(d.month)),
		date: d.date,
	});
}

/** The three keys a standing reads, per place (the card / board vs the result block). */
export interface StandingKeys {
	readonly rank: string;
	readonly percentile: string;
	readonly rankOf: string;
}

/** The plain standing keys: "#41", "top 9%", "#3 of 12". */
export const STANDING_KEYS: StandingKeys = {
	rank: DAILY_STRINGS.standingRank,
	percentile: DAILY_STRINGS.standingPercentile,
	rankOf: DAILY_STRINGS.standingRankOf,
};

/** The result block's: "#38 today", "Top 14%", "#3 of 12 today". */
export const RESULT_STANDING_KEYS: StandingKeys = {
	rank: DAILY_STRINGS.resultRank,
	percentile: DAILY_STRINGS.resultPercentile,
	rankOf: DAILY_STRINGS.resultRankOf,
};

/** Which form a standing takes. */
export type StandingKind = "rank" | "percentile" | "rankOf";

/**
 * Where an entry stands (DSD15): fewer than DAILY.minEntrantsForPercentile entrants (known) and an exact rank ->
 * `#n of m`; an exact rank (inside the top rows) -> `#n`; else a percentile -> `top N%`; nothing known -> undefined.
 * Numbers come formatted (thousands).
 */
export function standingOf(
	standing: DailyStanding | undefined,
	keys: StandingKeys = STANDING_KEYS,
): (DailyLine & { readonly kind: StandingKind }) | undefined {
	if (standing === undefined) return undefined;
	const { rank, percentile, total } = standing;
	if (rank !== undefined && total !== undefined && total < DAILY.minEntrantsForPercentile) {
		return {
			kind: "rankOf",
			key: keys.rankOf,
			vars: { rank: formatThousands(rank), total: formatThousands(total) },
		};
	}
	if (rank !== undefined) return { kind: "rank", key: keys.rank, vars: { rank: formatThousands(rank) } };
	if (percentile !== undefined) return { kind: "percentile", key: keys.percentile, vars: { percent: percentile } };
	return undefined;
}
