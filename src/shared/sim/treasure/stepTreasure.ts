/**
 * The vault's lock in the tick (docs/TREASURE.md TR3): stepTreasure runs after stepScore (step.ts 8b), never on a
 * frozen draft tick. TR2: a no-op stub (the call sites exist so the tick order is fixed).
 */
import type { SimState } from "../state";

/** End of every unfrozen tick, after stepScore. No-op without state.treasure. */
export function stepTreasure(state: SimState): void {
	if (state.treasure === undefined) return;
}
