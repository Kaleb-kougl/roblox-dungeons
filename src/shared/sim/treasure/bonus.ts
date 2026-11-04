/**
 * A Legendary chest's bonus deal (docs/TREASURE.md TR4, TRD9, TR0 correction 7). A LEAF (state types only):
 * progression.ts's stepRun step 1 adds these to the floor's deals when it opens each present player's draft, so it never
 * imports the treasure step.
 */
import type { SimState } from "../state";

/**
 * Player `playerIndex`'s bonus deals for the draft opening now (a Legendary open on the floor just left, with builds),
 * taken: they are zeroed. 0 without treasure. No rng.
 */
export function takeTreasureBonusDeals(state: SimState, playerIndex: number): number {
	const t = state.treasure;
	if (t === undefined) return 0;
	const n = t.bonusDeals[playerIndex];
	if (n === undefined || n === 0) return 0;
	t.bonusDeals[playerIndex] = 0;
	return n;
}
