/**
 * runReplay with a read-only observer and a checkpoint hook. Exactly runReplay's loop (shared/sim replay.ts:
 * createSimState from the recording's seed and spawn, then step() every frame with the same config), so the final
 * state hashes the same (checked in validate.spec.ts). The observer sees the state after each step, the way the web
 * build's SimDriver observer feeds telemetry; it must not write to it.
 *
 * The replay itself never reads a clock: the server's time budget (ReplayBudget below, with os.clock injected) runs in
 * the checkpoint hook, so this file and the sim stay deterministic.
 *
 * @module
 */
import { createSimState, step, type Recording, type SimConfig, type SimState } from "shared/sim";

/** Called after every step with the state it produced. Read only. */
export type TickObserver = (state: Readonly<SimState>) => void;

/**
 * The checkpoint hook of a replay: how the server puts its time budget into `replayObserved`, `validateRun` and a
 * `SegmentedValidator`'s `advance` without the replay itself reading a clock. Absent hooks replay straight through.
 */
export interface ReplayHooks {
	/** Called after every `checkpointEvery`-th step (the server checks its time budget here and may yield). */
	onCheckpoint?: () => void;
	/** Ticks between checkpoints (> 0; default 1 = after every step). */
	checkpointEvery?: number;
}

/**
 * Replays `recording` from its own seed and spawn under `config` and returns the final state, calling `observe` after
 * every step (the state is read only) and `hooks.onCheckpoint` after every `hooks.checkpointEvery`-th step. Same loop
 * as the sim's `runReplay`, so the returned state hashes the same. An error raised by the sim propagates: `validateRun`
 * is the caller that turns it into a rejection.
 */
export function replayObserved(
	recording: Readonly<Recording>,
	config: Readonly<SimConfig>,
	observe?: TickObserver,
	hooks: ReplayHooks = {},
): SimState {
	const state = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
	const frames = recording.frames;
	const n = frames.size();
	const every = hooks.checkpointEvery ?? 1;
	const onCheckpoint = hooks.onCheckpoint;
	for (let i = 0; i < n; i++) {
		step(state, frames[i], config);
		if (observe) observe(state);
		if (onCheckpoint && every > 0 && (i + 1) % every === 0) onCheckpoint();
	}
	return state;
}

/**
 * A CPU time budget for long work on the server: `checkpoint()` yields (the injected `yieldNow`, task.wait on the
 * server) once more than `budgetSeconds` of `now()` time passed since the last yield. Pure: the clock and the yield
 * are injected (os.clock / task.wait on the server, fakes in tests).
 */
export class ReplayBudget {
	private since: number;
	/** Yields so far. */
	yields = 0;

	constructor(
		private readonly budgetSeconds: number,
		private readonly now: () => number,
		private readonly yieldNow: () => void,
	) {
		this.since = now();
	}

	checkpoint(): void {
		if (this.now() - this.since < this.budgetSeconds) return;
		this.yieldNow();
		this.yields++;
		this.since = this.now();
	}
}
