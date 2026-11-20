/**
 * The leaderboard flush at server shutdown (BindToClose), pure: LeaderboardService passes the clock, task.wait,
 * task.spawn, the write queue and its write function. Within `budgetSeconds` in all it
 *
 *   1. writes everything queued, in parallel (rate and backoff ignored: the server is going away),
 *   2. keeps going while runs are still validating (`pendingValidations`: a finished run whose last segment is being
 *      replayed, a party run collecting final claims) - their posts arrive in the queue during the flush and are
 *      written too - and while writes are in flight or a failed write was queued again (a retry),
 *   3. stops once nothing is queued, in flight or validating, or at the deadline (reported, never silent).
 *
 * @module
 */
import type { QueuedPost } from "./writeQueue";

/**
 * What `flushOnShutdown` needs from the server, injected so the flush is pure and runs in the specs with a fake clock:
 * LeaderboardService passes `os.clock`, `task.wait`, `task.spawn`, its write queue and its write function.
 */
export interface ShutdownFlushDeps {
	/** Seconds, monotonic (os.clock). */
	readonly now: () => number;
	/** Yields until the next frame (task.wait). */
	readonly wait: () => void;
	/** Runs `fn` in its own thread (task.spawn): writes yield on DataStore calls. */
	readonly spawn: (fn: () => void) => void;
	/** Runs still validating that may post (each post lands in the queue). */
	readonly pendingValidations: () => number;
	/** Everything queued now, removed (LeaderboardWriteQueue.takeAll). */
	readonly takeAll: () => QueuedPost[];
	/** Writes queued (LeaderboardWriteQueue.size): a failed write may have been queued again. */
	readonly queued: () => number;
	/** One personal-best write (may yield; a failure requeues it through the queue's retry policy). */
	readonly write: (q: QueuedPost) => void;
}

/**
 * What the shutdown flush did, returned so the server can log it: a flush cut off by the deadline is reported with what
 * it left behind (writes in flight, still queued, runs still validating), never silently.
 */
export interface ShutdownFlushReport {
	/** Writes started (each one completed unless counted in `inFlight`). */
	readonly started: number;
	/** Writes still running at the deadline. */
	readonly inFlight: number;
	/** Writes still queued at the deadline. */
	readonly queued: number;
	/** Runs still validating at the deadline (their posts are lost). */
	readonly validating: number;
	/** The deadline cut the flush short. */
	readonly timedOut: boolean;
	/** Seconds the flush took. */
	readonly seconds: number;
}

/**
 * Runs the shutdown flush described in the file comment and returns its report. Server only, called from BindToClose;
 * it yields through `deps.wait` once per pass until nothing is queued, in flight or validating, or until
 * `budgetSeconds` have passed since it started (the pass that notices the deadline returns with `timedOut` true). Each
 * write runs in its own thread and one that throws still counts as finished.
 */
export function flushOnShutdown(deps: ShutdownFlushDeps, budgetSeconds: number): ShutdownFlushReport {
	const startedAt = deps.now();
	let started = 0;
	let inFlight = 0;
	for (;;) {
		for (const q of deps.takeAll()) {
			started++;
			inFlight++;
			deps.spawn(() => {
				// pcall: a throwing write must still count as finished (the service's write never throws anyway).
				pcall(() => deps.write(q));
				inFlight--;
			});
		}
		const validating = deps.pendingValidations();
		const queued = deps.queued();
		if (inFlight === 0 && queued === 0 && validating === 0) {
			return { started, inFlight, queued, validating, timedOut: false, seconds: deps.now() - startedAt };
		}
		if (deps.now() - startedAt >= budgetSeconds) {
			return { started, inFlight, queued, validating, timedOut: true, seconds: deps.now() - startedAt };
		}
		deps.wait();
	}
}
