/**
 * The run-over panel's retry gate (docs/RUN_RECAP.md RR7, RRD6): which presses on the run-over screen retry, and which
 * only skip the recap's timeline. Pure: the client's RecapController feeds it the panel's presses and the sampled FIRE
 * bit, and restarts (SimController.requestRestart) only when it answers "retry".
 *
 *   - `again` (the Again / Retry Daily button: mouse, touch, a gamepad confirm on the focused button), `confirm`
 *     (Enter / Space on the keyboard: Again is the focused button) and `fire` (a FIRE press edge that did not begin over
 *     a GUI) go through the recap timeline's press(): before RECAP.retryArmSec they skip it to its settled state
 *     ("skip"), after it they retry ("retry").
 *   - `restartKey` (the bound `restart` input, R / D-pad down) is deliberate: it retries at once. SimController takes
 *     that key itself (its driver action); the source is here so the rule is written down and specced in one place.
 *   - No recap on screen (a run the recap leaves alone: the tutorial, M1, unscored worlds): Again retries at once as
 *     before, confirm / FIRE do nothing.
 *   - A party run (`canRetry` false: runOverExits has no Again, docs/RUN_RECAP.md CMD6) never retries from here; a press
 *     only skips the timeline.
 *   - One retry per run over: after a "retry" every later press answers "none" (Activated and Enter can both fire for
 *     one key press; a second restart would start a second run).
 *   - FIRE edges: a FIRE held when the panel opened (attack mashed through the death) counts only once released and
 *     pressed again (`open(fireDown)` primes it); a press that began over a GUI (a click on Main menu or Details) is no
 *     FIRE press.
 *
 * @module
 */
import { Button } from "shared/sim";

/** A press on the run-over screen (see the file comment). */
export type RunOverPressSource = "again" | "confirm" | "fire" | "restartKey";

/** What a press did: restart now, skip the recap's timeline, or nothing. */
export type RunOverPressResult = "retry" | "skip" | "none";

/** The recap timeline as the gate drives it (shared/view/hud RecapTimeline fits). */
export interface RunOverRecapTarget {
	/** Before the arm: skip, answers "skip"; after it: answers "retry" (and leaves the timeline as it is). */
	press(): "skip" | "retry";
	/** Jump to the settled state (a press that cannot retry). */
	skip(): void;
}

/**
 * The gate itself (see the file comment): one per client, reused across runs. The RecapController calls `open` each
 * time the run-over panel appears, `fireEdge` on every sampled frame while it shows, and `press` for each press; only a
 * `retry` answer restarts the run, and at most one is given per run over.
 */
export class RunOverRetryGate {
	private retried = false;
	private fireHeld = true;

	/** The panel opened (a new run over): no retry yet; FIRE counts as held when `fireDown` (it must be let go first). */
	open(fireDown: boolean): void {
		this.retried = false;
		this.fireHeld = fireDown;
	}

	/** This run over already retried (every later press is "none"). */
	hasRetried(): boolean {
		return this.retried;
	}

	/**
	 * One sampled frame's FIRE bit (`buttons`, the frame's InputFrame buttons) and whether the mouse press under it began
	 * over a GUI; true on a FIRE press edge that counts (see the file comment).
	 */
	fireEdge(buttons: number, overGui: boolean): boolean {
		const down = bit32.band(buttons, Button.FIRE) !== 0;
		const edge = down && !this.fireHeld && !overGui;
		this.fireHeld = down;
		return edge;
	}

	/**
	 * A press from `source`. `recap`: the recap timeline on screen (undefined: none); `canRetry`: the panel has an Again
	 * (a solo run). Answers what the client does (see the file comment).
	 */
	press(source: RunOverPressSource, recap: RunOverRecapTarget | undefined, canRetry: boolean): RunOverPressResult {
		if (this.retried) return "none";
		if (!canRetry) {
			if (recap === undefined) return "none";
			recap.skip();
			return "skip";
		}
		if (source === "restartKey" || (recap === undefined && source === "again")) return this.retry();
		if (recap === undefined) return "none";
		return recap.press() === "retry" ? this.retry() : "skip";
	}

	private retry(): RunOverPressResult {
		this.retried = true;
		return "retry";
	}
}
