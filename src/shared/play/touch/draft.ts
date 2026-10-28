/**
 * Draft tap helpers (docs/MOBILE_IMPL.md MB6): a tapped card is selected by pushing the move stick into its column, so
 * the touch controls need the draft's ready rule and the card -> column map. Pure, read-only on the sim state.
 */
import {
	DRAFT_COLUMN_CENTRE,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_OFFER_COUNT,
	type SimState,
} from "shared/sim";

export interface DraftStatus {
	readonly open: boolean;
	/** The FIRE confirm counts from here (the same rule as the HUD snapshot's draftReady). */
	readonly ready: boolean;
}

/** The local player's draft (same rule as shared/play snapshot.ts `draftReady`). */
export function draftStatus(state: Readonly<SimState>, playerIndex: number): DraftStatus {
	const p = state.run?.players[playerIndex];
	if (p === undefined) return { open: false, ready: false };
	const open = p.draftOpen !== 0;
	return { open, ready: open && p.draftTicks + 1 >= DRAFT_MIN_OPEN_TICKS };
}

/** Card index -> the column that selects it (inverse of shared/sim draftCardFor). */
export function draftColumnForCard(index: number, count: number): number {
	if (count >= DRAFT_OFFER_COUNT) return index;
	if (count === 2) return index === 0 ? DRAFT_COLUMN_LEFT : DRAFT_COLUMN_RIGHT;
	return DRAFT_COLUMN_CENTRE;
}
