/**
 * Fixed-timestep accumulator (source: `src/sim/loop.ts`). Converts variable render-frame deltas into whole ticks of
 * SIM_DT.
 *
 * Usage per rendered frame:
 *   const input = sampler.sample();               // sample ONCE per rendered frame
 *   const alpha = loop.advance(delta, () => {     // 0..MAX_TICKS_PER_FRAME ticks
 *     recorder.record(input);                     // record PER TICK (same frame reused)
 *     step(state, input, config);
 *   });
 *   // render: lerp(prev, current, alpha)
 *
 * Port note: the source's `alpha` getter is `getAlpha()`.
 *
 * @module
 */

import { jsRem } from "shared/jsmath";
import { isFiniteNumber } from "./jsnum";
import { SIM_DT } from "./units";

/** Spiral-of-death guard: at most this many ticks per rendered frame; excess time is dropped. */
export const MAX_TICKS_PER_FRAME = 5;

/** Absorbs float rounding so a 1/60 s frame reliably yields one tick at 60 Hz. */
const EPSILON = 1e-9;
/** `Number.EPSILON` (2^-52): alpha is capped just below 1. */
const DOUBLE_EPSILON = 2.220446049250313e-16;

/**
 * The accumulator itself: feed it each rendered frame's delta through `advance` and it calls back once per whole tick
 * of `dt` seconds (SIM_DT unless overridden), at most `maxTicksPerFrame` a frame. Lives outside the sim; nothing in it
 * is hashed.
 */
export class FixedStepLoop {
	readonly dt: number;
	readonly maxTicksPerFrame: number;
	/** Unsimulated time carried to the next frame, seconds. */
	accumulator = 0;
	/** Ticks run since construction or reset(). */
	totalTicks = 0;
	/** Seconds discarded by the per-frame cap since construction or reset(). */
	droppedTime = 0;
	private lastAlpha = 0;

	constructor(dt: number = SIM_DT, maxTicksPerFrame: number = MAX_TICKS_PER_FRAME) {
		this.dt = dt;
		this.maxTicksPerFrame = maxTicksPerFrame;
	}

	/**
	 * Adds a frame's delta (seconds) and runs as many ticks as fit, up to maxTicksPerFrame.
	 * Negative, NaN or infinite deltas count as 0. Returns the interpolation alpha in [0, 1).
	 */
	advance(frameDeltaSeconds: number, onTick: (tickInFrame: number) => void): number {
		const delta = isFiniteNumber(frameDeltaSeconds) && frameDeltaSeconds > 0 ? frameDeltaSeconds : 0;
		this.accumulator += delta;

		let n = 0;
		while (this.accumulator + EPSILON >= this.dt && n < this.maxTicksPerFrame) {
			onTick(n);
			this.accumulator -= this.dt;
			n++;
		}
		this.totalTicks += n;

		if (this.accumulator + EPSILON >= this.dt) {
			// Hit the cap: drop whole ticks of backlog, keep the fractional remainder for smooth alpha.
			let keep = jsRem(this.accumulator, this.dt);
			if (keep + EPSILON >= this.dt) keep = 0; // float % can return a hair under dt
			this.droppedTime += this.accumulator - keep;
			this.accumulator = keep;
		}
		if (this.accumulator < 0) this.accumulator = 0;

		this.lastAlpha = this.computeAlpha();
		return this.lastAlpha;
	}

	/** Alpha from the last advance(), in [0, 1). */
	getAlpha(): number {
		return this.lastAlpha;
	}

	/** Clears carried time (e.g. after unpausing) without touching totalTicks. */
	clearAccumulator(): void {
		this.accumulator = 0;
		this.lastAlpha = 0;
	}

	reset(): void {
		this.accumulator = 0;
		this.totalTicks = 0;
		this.droppedTime = 0;
		this.lastAlpha = 0;
	}

	private computeAlpha(): number {
		const a = this.accumulator / this.dt;
		if (!(a > 0)) return 0;
		return a < 1 ? a : 1 - DOUBLE_EPSILON;
	}
}
