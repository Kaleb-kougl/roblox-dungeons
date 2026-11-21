/**
 * The Daily's wire status (`dailyStatus`, shared/network): what the menu, the countdown and (next phase) the board and
 * rank layers need about today's Daily. The server builds it (DailyService) from its clock and its secret seed; the
 * client stores it in the Reflex `daily` slice.
 *
 * @module
 */
import { DAILY, DAILY_CLIENT } from "./config";
import { dailyLabel, dailyResetsAt } from "./day";

/**
 * Where an entry stands on a daily board (DS6): `rank` only when exact (inside the top rows read), `percentile` only
 * from DAILY.minEntrantsForPercentile entrants (DSD15), `total` (entrants, from the histogram or a board shorter than
 * the top rows) when known. Beyond the top rows there is no rank, only the estimated percentile.
 */
export interface DailyStanding {
	/** 1-based, exact (the entry is inside the top LEADERBOARD_TOP_COUNT rows). */
	rank?: number;
	/** "Top N %": ceil(100 x rank / total) in [1, 100], the rank estimated beyond the top rows. */
	percentile?: number;
	/** Entrants on the board (estimate: the histogram lags up to a minute). */
	total?: number;
}

/** A player's entry on a daily board: score and floor decoded from the ordered value, and where it stands. */
export interface DailyMineEntry extends DailyStanding {
	score: number;
	floor: number;
}

/** This player's entries today (`dailyStatus.mine`), per board; a board without an entry is absent. */
export interface DailyMine {
	solo?: DailyMineEntry;
	coop?: DailyMineEntry;
}

/** One board's read of a player's entry today (the server's LeaderboardService.dailyMineOf). */
export type DailyMineRead =
	/** The board holds an entry of the player. */
	| { readonly kind: "entry"; readonly entry: DailyMineEntry }
	/** The board was read and holds no entry of the player today. */
	| { readonly kind: "none" }
	/** The board (or the player's entry on it) could not be read: unknown. */
	| { readonly kind: "unreadable" };

/**
 * `dailyStatus.mine` from one read per board: undefined (unknown) when any board was unreadable, else the entries
 * found, `{}` when there are none. Readers rely on it: `mine` absent = unknown, a board missing from `mine` = no entry
 * today (new best's daily baseline, the rank layer, the menu's `Not played yet`).
 */
export function dailyMineFrom(
	reads: ReadonlyArray<{ readonly board: "solo" | "coop"; readonly read: DailyMineRead }>,
): DailyMine | undefined {
	const mine: DailyMine = {};
	for (const r of reads) {
		const read = r.read;
		if (read.kind === "unreadable") return undefined;
		if (read.kind === "entry") mine[r.board] = read.entry;
	}
	return mine;
}

/** One row of yesterday's podium. */
export interface DailyPodiumEntry {
	userId: number;
	name: string;
	score: number;
	floor: number;
}

/** Yesterday's podium (DS8): the top DAILY.podiumSize of yesterday's solo board and the caller's final entry. */
export interface DailyPodium {
	/** Yesterday's day index and shown number. */
	day: number;
	label: number;
	/** Highest first; fewer than DAILY.podiumSize when fewer played. */
	top: DailyPodiumEntry[];
	/** The caller's entry on yesterday's solo board, with its final rank / percentile; absent if they did not play. */
	mine?: DailyMineEntry;
}

/**
 * A daily run's outcome on its board (`RunFinishVerdict.daily`, per recipient), for accepted daily runs. `posted`:
 * the recipient's entry write completed (the board holds this run or a better one of theirs); `improved`: this run
 * raised their entry; `previous`: their entry before it; the standing is their entry's after the write.
 */
export interface DailyRunResult extends DailyStanding {
	/** The board's day (the run's start day, DSD5) and ruleset (DSD11). */
	day: number;
	ruleset: number;
	posted: boolean;
	improved: boolean;
	previous?: { score: number; floor: number };
}

/**
 * `dailyStatus`. Only today's seed is ever sent (tomorrow's stays on the server, DSD8). `mine` and `podium` come
 * from the daily boards (absent while unknown: Studio without API access, an outage, nothing posted), so readers must
 * not assume the shape is closed.
 */
export interface DailyStatus {
	/** Day index (0 = 2026-01-01 UTC). */
	day: number;
	/** The shown number (`dailyLabel`: day + 1). */
	label: number;
	/** Today's run seed (the server's dailySeed(day)): the menu's roster / boss preview. */
	seed: number;
	/** DAILY.ruleset of the server that answered (its board scope). */
	ruleset: number;
	/** Unix seconds (UTC) of the next midnight, when this Daily ends (compare with Workspace:GetServerTimeNow()). */
	resetsAt: number;
	/**
	 * This player's entries today (per board, with rank / percentile): `{}` when both boards were read and hold no entry
	 * of theirs (dailyMineFrom); absent when unknown (a board could not be read).
	 */
	mine?: DailyMine;
	/** Yesterday's podium (top 3 solo and the caller's final entry); absent when unknown. */
	podium?: DailyPodium;
}

/** The status of `day` whose seed is `seed`, under the current ruleset. */
export function dailyStatusFor(day: number, seed: number): DailyStatus {
	return { day, label: dailyLabel(day), seed, ruleset: DAILY.ruleset, resetsAt: dailyResetsAt(day) };
}

/**
 * The client's next `requestDaily` time on the server clock (Workspace:GetServerTimeNow), given the status it holds
 * and when it last asked (DAILY_CLIENT): no answer yet -> retry after unansweredRetrySeconds; a current status -> just
 * after its `resetsAt` (the server's midnight push may race it); asked after that and still the old day -> every
 * staleRetrySeconds.
 */
export function nextDailyRequestAt(status: DailyStatus | undefined, lastAskedAt: number): number {
	if (status === undefined) return lastAskedAt + DAILY_CLIENT.unansweredRetrySeconds;
	const due = status.resetsAt + DAILY_CLIENT.resetRequestDelaySeconds;
	return lastAskedAt < due ? due : lastAskedAt + DAILY_CLIENT.staleRetrySeconds;
}
