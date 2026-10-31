/**
 * The Daily's wire status (`dailyStatus`, shared/network): what the menu, the countdown and (next phase) the board and
 * rank layers need about today's Daily. The server builds it (DailyService) from its clock and its secret seed; the
 * client stores it in the Reflex `daily` slice.
 */
import { DAILY, DAILY_CLIENT } from "./config";
import { dailyLabel, dailyResetsAt } from "./day";

/**
 * `dailyStatus`. Only today's seed is ever sent (tomorrow's stays on the server, DSD8). Later phases add optional
 * fields here (`mine`: this player's best today per board, `podium`: yesterday's top 3), so readers must not assume
 * the shape is closed.
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
