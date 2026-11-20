/**
 * One server's view of its players' daily activity (docs/DAILY.md DS13), for RecordsService. Pure.
 *
 * The base is the `daily` field of the player's records doc as loaded at join (the session cache never changes it);
 * the ledger keeps what THIS server added since (starts on its day, finished days) and how many of those starts are
 * not written yet. What the player has done = base + added (addDailyActivity: the same day sums). So:
 *
 *   started(...)   a daily session started: +1 start (in memory only), the attempt number and the returning flag
 *   finished(...)  an accepted daily run concluded: its attempt number (remembered from its start), the returning
 *                  flag, and the delta to write (the unwritten starts and the finished day); the unwritten count
 *                  resets
 *   flush(...)     the unwritten starts alone (on leave / shutdown), or undefined
 *
 * Starts are therefore written once per accepted daily run (folded into its finish write) plus at most once on leave,
 * never per start. A start of a later day drops the older day's unwritten starts (only today's count matters).
 *
 * @module
 */
import { DAILY_LEDGER_OPEN_ATTEMPTS } from "./config";
import { addDailyActivity, dailyStartsOn, finishedDailyOn, type DailyActivity, type DailyActivityDelta } from "./daily";

/** The player's stored activity as this server knows it. */
export interface DailyBase {
	/** False when the records doc is not loaded (load failed or still loading): the base is then unknown. */
	readonly known: boolean;
	/** The doc's `daily` (as loaded); undefined = none (or unknown). */
	readonly activity: Readonly<DailyActivity> | undefined;
}

/** What a start or a finish tells telemetry. */
export interface DailyActivityNote {
	/** This run's attempt number on its day (1 = the player's first daily start that day). */
	readonly attempt: number;
	/**
	 * True when the player finished a daily run on the day before the run's day; undefined when unknown (the base is
	 * unknown and this server saw no such finish).
	 */
	readonly returning: boolean | undefined;
}

export interface DailyFinishNote extends DailyActivityNote {
	/** The write for this finish (the unwritten starts and the finished day). */
	readonly delta: DailyActivityDelta;
}

interface LedgerEntry {
	/** This server's additions: starts on `added.day` and the finished days it saw. */
	added: DailyActivity | undefined;
	/** Starts on `added.day` not written yet. */
	pending: number;
	/**
	 * Runs started and not concluded yet with their attempt numbers, oldest first, at most DAILY_LEDGER_OPEN_ATTEMPTS
	 * (a run that never concludes accepted is pushed out by later starts).
	 */
	readonly attempts: Array<{ readonly runId: string; readonly attempt: number }>;
}

/** The smallest attempt number (a finish whose start this server never counted is at least an attempt). */
const FIRST_ATTEMPT = 1;

export class DailyActivityLedger {
	private readonly entries = new Map<number, LedgerEntry>();

	/** What the player has done: base (when known) + this server's additions. */
	view(userId: number, base: DailyBase): DailyActivity | undefined {
		return addDailyActivity(base.known ? base.activity : undefined, this.entries.get(userId)?.added);
	}

	/** A daily session of day `day` started for the player (run `runId`). */
	started(userId: number, day: number, runId: string, base: DailyBase): DailyActivityNote {
		const entry = this.entry(userId);
		let added = entry.added;
		if (added === undefined || added.day < day) {
			const fresh: DailyActivity = { day, starts: 0 };
			if (added?.lastFinishedDay !== undefined) fresh.lastFinishedDay = added.lastFinishedDay;
			if (added?.prevFinishedDay !== undefined) fresh.prevFinishedDay = added.prevFinishedDay;
			added = fresh;
			entry.added = fresh;
			entry.pending = 0;
		}
		// A start of a day older than this server's (a clock step back) counts nowhere; its attempt is still answered.
		if (added.day === day) {
			added.starts += 1;
			entry.pending += 1;
		}
		const view = this.view(userId, base);
		const attempt = math.max(FIRST_ATTEMPT, dailyStartsOn(view, day));
		takeAttempt(entry.attempts, runId);
		entry.attempts.push({ runId, attempt });
		while (entry.attempts.size() > DAILY_LEDGER_OPEN_ATTEMPTS) entry.attempts.remove(0);
		return { attempt, returning: returningOf(view, day, base.known) };
	}

	/** An accepted daily run of day `day` (run `runId`) concluded for the player. */
	finished(userId: number, day: number, runId: string, base: DailyBase): DailyFinishNote {
		const entry = this.entry(userId);
		const view = this.view(userId, base);
		const attempt = takeAttempt(entry.attempts, runId) ?? math.max(FIRST_ATTEMPT, dailyStartsOn(view, day));
		const returning = returningOf(view, day, base.known);
		const addedDay = entry.added?.day ?? day;
		const delta: DailyActivityDelta = { day: addedDay, starts: entry.pending, finishedDay: day };
		entry.pending = 0;
		entry.added = addDailyActivity(entry.added, { day: addedDay, starts: 0, lastFinishedDay: day });
		return { attempt, returning, delta };
	}

	/** The player's unwritten starts as a delta (then cleared), or undefined when there are none. */
	flush(userId: number): DailyActivityDelta | undefined {
		const entry = this.entries.get(userId);
		if (entry === undefined || entry.added === undefined || entry.pending <= 0) return undefined;
		const delta: DailyActivityDelta = { day: entry.added.day, starts: entry.pending };
		entry.pending = 0;
		return delta;
	}

	/** Drops the player (call flush first). */
	forget(userId: number): void {
		this.entries.delete(userId);
	}

	/** Runs whose attempt number is still remembered for the player (for leak checks). */
	openAttempts(userId: number): number {
		return this.entries.get(userId)?.attempts.size() ?? 0;
	}

	/** UserIds with an entry (shutdown flush). */
	userIds(): number[] {
		const out: number[] = [];
		for (const [id] of this.entries) out.push(id);
		return out;
	}

	private entry(userId: number): LedgerEntry {
		let entry = this.entries.get(userId);
		if (entry === undefined) {
			entry = { added: undefined, pending: 0, attempts: [] };
			this.entries.set(userId, entry);
		}
		return entry;
	}
}

/** Removes `runId` from the open attempts and returns its attempt number, or undefined when it is not there. */
function takeAttempt(attempts: Array<{ readonly runId: string; readonly attempt: number }>, runId: string) {
	for (let i = 0; i < attempts.size(); i++) {
		if (attempts[i].runId === runId) return attempts.remove(i)!.attempt;
	}
	return undefined;
}

/** Finished on `day - 1`: true / false, or undefined when the base is unknown and nothing here says true. */
function returningOf(view: DailyActivity | undefined, day: number, known: boolean): boolean | undefined {
	if (finishedDailyOn(view, day - 1)) return true;
	return known ? false : undefined;
}
