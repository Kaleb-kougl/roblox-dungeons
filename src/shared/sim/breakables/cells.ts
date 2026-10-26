/**
 * The breakables' cell lookups (docs/DECOR.md D4), a LEAF module (types and shared/dungeon only), so the movement code
 * (player.ts movePlayer, combat/actors/helpers.ts moveActor) can read them without importing breakables.ts (whose score
 * hook would close a require cycle through score.ts -> party.ts -> player.ts).
 */
import { cellKey, worldToGrid, type SolidCells } from "shared/dungeon";
import type { SimState } from "../state";
import type { BreakablesState } from "./breakables";

/**
 * The movers' / blockers' `solid` argument: the intact pieces' cells, or undefined (no breakables state, or every piece
 * broken: the grid-only path).
 */
export function solidCells(state: Readonly<SimState>): SolidCells | undefined {
	const b = state.breakables;
	return b !== undefined && b.intact > 0 ? b.slotByCell : undefined;
}

/** Slot of the intact piece whose cell holds world (x, z), or -1. */
export function breakableSlotAt(b: Readonly<BreakablesState>, x: number, z: number): number {
	return b.slotByCell.get(cellKey(worldToGrid(x), worldToGrid(z))) ?? -1;
}
