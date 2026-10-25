/**
 * Read-only observers of the live sim (E1.8: playtest telemetry; source: `src/sim/observer.ts`). The client's sim
 * driver calls them OUTSIDE step(), so nothing here can affect determinism: an observer reads the state after a tick
 * and must never write to it.
 */

import type { InputFrame } from "./input";
import type { Recording } from "./replay";
import type { SimState } from "./state";

/** What the driver lets an observer do from outside the frame loop (e.g. a "Retry" button). */
export interface SimControls {
	/** Restart the run on the next tick boundary, exactly like the reset key. */
	requestReset(): void;
	/** The live state (read-only; read it, never keep or mutate it). */
	getState(): Readonly<SimState>;
	/** Snapshot of the current run's input recording (copies the frame array: call it rarely). */
	getRecording(): Recording;
}

/** Why a run started: the driver mounted, or a reset replaced the previous run. */
export type RunStartCause = "mount" | "reset";

/**
 * Optional callbacks, all called by the driver outside step():
 *   attach      once on mount (may return a cleanup, called on unmount)
 *   onRunStart  after a run's SimState is created (mount, and after every reset)
 *   onTick      after EVERY step(), with the frame step() got; state.events holds that tick's events
 *   onRunEnd    just before a reset throws the run away: its final state and full recording
 */
export interface SimObserver {
	attach?(controls: SimControls): (() => void) | void;
	onRunStart?(state: Readonly<SimState>, cause: RunStartCause): void;
	onTick?(state: Readonly<SimState>, input: Readonly<InputFrame>): void;
	onRunEnd?(state: Readonly<SimState>, recording: Recording): void;
}
