/**
 * What happens once Leave run's forfeit has landed, and which run-over panel says the run was left (client
 * SimController / RunOverPanel). Pure, headlessly tested (leaveRun.spec.ts).
 *
 * Leave run in a solo run forfeits it (LiveRun.requestForfeit: it ends as a death and is submitted like one). The run
 * then stays on its run-over panel, so the player sees the run's stats, and goes on from there with Again or Main
 * menu as after any death. A forfeiting restart (R / Restart mid-run in a ranked run) starts the next run instead.
 *
 * Leave run in a party run sends `lockstepLeave` (the server plays this player as disconnected; the others play on)
 * and ends the run on this client (LockstepClient.end with LEFT_RUN_END_REASON): nothing more is stepped or sent, and
 * its run-over panel shows the run up to the leave. Back to lobby then goes at once: the party's verdict comes only
 * when the rest of the party is done, and a player who left does not wait for it (partyExitStep).
 *
 * @module
 */

/** LockstepClient.end's reason for a party run this client left. */
export const LEFT_RUN_END_REASON = "left";

/** After a frame: show the left run's run-over panel, start the next run, or nothing to do. */
export type AfterForfeit = "runOver" | "restart" | "none";

/**
 * `leave` / `restart`: Leave run / a forfeiting restart is waiting for its forfeit; `over`: the run's outcome is no
 * longer "playing"; `submitted`: its death was submitted. Nothing happens until both. Leave run wins when both wait
 * (a restart is never asked while a leave waits).
 */
export function afterForfeitStep(leave: boolean, restart: boolean, over: boolean, submitted: boolean): AfterForfeit {
	if (!over || !submitted) return "none";
	if (leave) return "runOver";
	return restart ? "restart" : "none";
}

/**
 * The run-over panel of run `run` says the run was left: `leftRun` (the run Leave run ended, 0 for none) is this run.
 * Solo and party runs alike.
 */
export function runOverLeft(leftRun: number, run: number): boolean {
	return leftRun !== 0 && leftRun === run;
}

/** A party run's run-over exit (Back to lobby / Main menu, R): leave it first, go now, or wait for the verdict. */
export type PartyExit = "leave" | "exit" | "wait";

/**
 * `over`: the party run is over on this client (LockstepClient.isOver: the party is down, the server ended it, or this
 * player left); `left`: this player left it with Leave run; `decided`: the party's verdict arrived. A run still being
 * played is left first (Leave run). A finished run waits for the party's verdict (the server decides it from every
 * member's final), unless this player left: the rest of the party may play on for a long time.
 */
export function partyExitStep(over: boolean, left: boolean, decided: boolean): PartyExit {
	if (!over) return "leave";
	return left || decided ? "exit" : "wait";
}
