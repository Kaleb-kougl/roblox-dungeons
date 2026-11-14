/**
 * A frame's Silver crate breaks (docs/SILVER.md SC3). The sim's feed is per TICK and cleared at the start of every tick
 * (`state.silver.events.breaks`, SC2: slot, cell centre, amount), so the run views (shared/play LiveRun, shared/lockstep
 * LockstepClient) `collect` it after every tick into one SilverFrameEvents and `reset` it at the start of every frame,
 * as they do the secrets' and the Goldling's. SilverCrateFx reads it once per frame. Presentation only: plain numbers
 * copied out of the state, read-only on the sim, tested headlessly. A leaf (shared/sim only).
 */
import type { SimState } from "shared/sim";

/** One Silver piece broken: the tick (state.tick at the END of its tick), its slot, cell centre (world) and Silver. */
export interface SilverBreakEvent {
	readonly tick: number;
	readonly slot: number;
	readonly x: number;
	readonly z: number;
	readonly amount: number;
}

/** What the planners read (SilverFrameEvents satisfies it). In tick order. */
export interface SilverFrameSource {
	readonly breaks: ReadonlyArray<SilverBreakEvent>;
}

/** No Silver events (a run view without the feed). */
export const NO_SILVER_EVENTS: SilverFrameSource = table.freeze({ breaks: table.freeze([]) });

/** The Silver breaks of every tick a frame ran, in tick order. */
export class SilverFrameEvents implements SilverFrameSource {
	readonly breaks: SilverBreakEvent[] = [];

	/** A new frame: forget the last one's breaks. */
	reset(): void {
		this.breaks.clear();
	}

	/** After every tick: appends that tick's breaks (no-op without state.silver). Copies: the sim clears its list. */
	collect(state: Readonly<SimState>): void {
		const sv = state.silver;
		if (sv === undefined) return;
		for (const e of sv.events.breaks)
			this.breaks.push({ tick: state.tick, slot: e.slot, x: e.x, z: e.z, amount: e.amount });
	}
}
