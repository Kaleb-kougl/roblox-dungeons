/**
 * Per-player daily activity (docs/DAILY.md DS13): how many Dailies the player started on a day (the attempt number)
 * and which days they finished one on (the "played yesterday's daily too" flag). Stored as the optional `daily` field
 * of the records doc (`KV_Records_v1`, doc.ts; still doc version 1: a doc without it decodes exactly as before), and
 * written only by RecordsService. It never touches the endless records (DSD6: daily runs write no records).
 *
 *   daily: { day, starts, lastFinishedDay?, prevFinishedDay? }
 *
 * `starts` counts the daily starts on `day` (shared/daily dailyDay); a later day replaces it. `lastFinishedDay` is the
 * latest day the player finished an accepted daily run on (the run's start day, DSD5) and `prevFinishedDay` the one
 * before it (strictly lower), so "finished yesterday's" stays answerable after finishing today's too.
 *
 * Two merges, both safe whatever order servers write in:
 *   mergeDailyActivity  max-merge (whole-doc writes, `mergeStoredRecords`): the later day wins, the same day keeps the
 *                       higher count; finished days are the two highest of both. Idempotent: a stale copy of the
 *                       field (a session's doc as loaded at join) can never lower or double anything.
 *   addDailyActivity    sum (the delta writes, `mergeStoredDailyDelta`): the same day ADDS the counts, so two servers
 *                       counting starts on the same day both land; a delta for an older day leaves the count alone.
 *
 * Pure: decoding never throws; a malformed field reads as absent.
 */

/** The stored `daily` field. */
export interface DailyActivity {
	/** The day `starts` counts (shared/daily dailyDay). */
	day: number;
	/** Daily starts on `day` (>= 0). */
	starts: number;
	/** The latest day with an accepted daily run (absent: none known). */
	lastFinishedDay?: number;
	/** The finished day before `lastFinishedDay` (strictly lower; absent: none known). */
	prevFinishedDay?: number;
}

/**
 * One server's addition to a player's daily activity (RecordsService's delta write): starts on `day` not written yet,
 * and optionally a day the player finished a daily run on.
 */
export interface DailyActivityDelta {
	/** The day `starts` counts. */
	day: number;
	/** Unwritten daily starts on `day` (>= 0). */
	starts: number;
	/** A day the player finished an accepted daily run on (the run's start day). */
	finishedDay?: number;
}

function isDay(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v >= 0 && v % 1 === 0 && v !== math.huge;
}

/** The highest two distinct days of `days` (undefined entries skipped), highest first. */
function topTwoDays(days: ReadonlyArray<number | undefined>): [number | undefined, number | undefined] {
	let first: number | undefined;
	let second: number | undefined;
	for (const d of days) {
		if (d === undefined || d === first || d === second) continue;
		if (first === undefined || d > first) {
			second = first;
			first = d;
		} else if (second === undefined || d > second) {
			second = d;
		}
	}
	return [first, second];
}

function build(day: number, starts: number, finished: ReadonlyArray<number | undefined>): DailyActivity {
	const out: DailyActivity = { day, starts };
	const [last, prev] = topTwoDays(finished);
	if (last !== undefined) out.lastFinishedDay = last;
	if (prev !== undefined) out.prevFinishedDay = prev;
	return out;
}

/**
 * A stored `daily` value -> activity. Undefined (absent) for a non-table or a bad `day` / `starts` (not a non-negative
 * integer). A bad finished day reads as absent on its own; `prevFinishedDay` without a valid `lastFinishedDay`, or not
 * below it, is dropped.
 */
export function decodeDailyActivity(raw: unknown): DailyActivity | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const r = raw as { day?: unknown; starts?: unknown; lastFinishedDay?: unknown; prevFinishedDay?: unknown };
	if (!isDay(r.day) || !isDay(r.starts)) return undefined;
	const out: DailyActivity = { day: r.day, starts: r.starts };
	if (isDay(r.lastFinishedDay)) {
		out.lastFinishedDay = r.lastFinishedDay;
		if (isDay(r.prevFinishedDay) && r.prevFinishedDay < r.lastFinishedDay) out.prevFinishedDay = r.prevFinishedDay;
	}
	return out;
}

/** A normalized copy (what is stored), or undefined. */
export function encodeDailyActivity(a: Readonly<DailyActivity> | undefined): DailyActivity | undefined {
	return decodeDailyActivity(a);
}

export function sameDailyActivity(
	a: Readonly<DailyActivity> | undefined,
	b: Readonly<DailyActivity> | undefined,
): boolean {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.day === b.day &&
		a.starts === b.starts &&
		a.lastFinishedDay === b.lastFinishedDay &&
		a.prevFinishedDay === b.prevFinishedDay
	);
}

/**
 * The max-merge (whole-doc writes): the later `day` wins with its count, the same day keeps the higher count;
 * finished days are the two highest of both sides. Commutative and idempotent. A new value (or undefined when both are).
 */
export function mergeDailyActivity(
	a: Readonly<DailyActivity> | undefined,
	b: Readonly<DailyActivity> | undefined,
): DailyActivity | undefined {
	if (a === undefined) return b === undefined ? undefined : encodeDailyActivity(b);
	if (b === undefined) return encodeDailyActivity(a);
	const finished = [a.lastFinishedDay, a.prevFinishedDay, b.lastFinishedDay, b.prevFinishedDay];
	if (a.day !== b.day) {
		const later = a.day > b.day ? a : b;
		return build(later.day, later.starts, finished);
	}
	return build(a.day, math.max(a.starts, b.starts), finished);
}

/**
 * The sum (delta writes, and a server's own additions on top of the doc it loaded): the same `day` adds the counts,
 * the later day wins with its own count (an older day's starts are dropped: only today's count matters); finished
 * days are the two highest of both. A new value (or undefined when both are).
 */
export function addDailyActivity(
	a: Readonly<DailyActivity> | undefined,
	b: Readonly<DailyActivity> | undefined,
): DailyActivity | undefined {
	if (a === undefined) return b === undefined ? undefined : encodeDailyActivity(b);
	if (b === undefined) return encodeDailyActivity(a);
	const finished = [a.lastFinishedDay, a.prevFinishedDay, b.lastFinishedDay, b.prevFinishedDay];
	if (a.day !== b.day) {
		const later = a.day > b.day ? a : b;
		return build(later.day, later.starts, finished);
	}
	return build(a.day, a.starts + b.starts, finished);
}

/** A stored / wire delta -> delta; undefined when `day` or `starts` is bad. A bad `finishedDay` reads as absent. */
export function decodeDailyDelta(raw: unknown): DailyActivityDelta | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const r = raw as { day?: unknown; starts?: unknown; finishedDay?: unknown };
	if (!isDay(r.day) || !isDay(r.starts)) return undefined;
	const out: DailyActivityDelta = { day: r.day, starts: r.starts };
	if (isDay(r.finishedDay)) out.finishedDay = r.finishedDay;
	return out;
}

/** The activity a delta alone adds (addDailyActivity's right side). */
export function activityOfDelta(d: Readonly<DailyActivityDelta>): DailyActivity {
	return build(d.day, d.starts, [d.finishedDay]);
}

/** `a` with `d` added (addDailyActivity). */
export function applyDailyDelta(
	a: Readonly<DailyActivity> | undefined,
	d: Readonly<DailyActivityDelta>,
): DailyActivity | undefined {
	return addDailyActivity(a, activityOfDelta(d));
}

/** Daily starts on `day` (0 when `a` counts another day or is absent). */
export function dailyStartsOn(a: Readonly<DailyActivity> | undefined, day: number): number {
	return a !== undefined && a.day === day ? a.starts : 0;
}

/** True when `a` records an accepted daily run on `day`. */
export function finishedDailyOn(a: Readonly<DailyActivity> | undefined, day: number): boolean {
	return a !== undefined && (a.lastFinishedDay === day || a.prevFinishedDay === day);
}
