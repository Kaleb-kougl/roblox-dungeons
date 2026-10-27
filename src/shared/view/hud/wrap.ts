/**
 * Wrapping rows of equal cells (docs/HUD_LAYOUT.md H6 follow-up): the StatusPanel's owned items (RunItems) and running
 * boosts (BoostRow) wrap into more rows instead of growing past the status panel's footprint width. Pure and headless
 * (wrap.spec.ts); client/ui/hud GridRow lays the cells out with a UIGridLayout at this size.
 */
import { HUD_FOOTPRINT } from "./footprint";
import { HUD_VIEW } from "./layout";

export interface WrapGrid {
	/** Cells per row (at least 1). */
	readonly cols: number;
	readonly rows: number;
	/** The grid's size in reference px (0 x 0 for no cells). */
	readonly width: number;
	readonly height: number;
}

/**
 * `count` cells of `cellW` x `cellH` with `gap` between them, as many per row as fit in `maxWidth` (always at least
 * one, so a cell wider than maxWidth still shows).
 */
export function wrapGrid(count: number, cellW: number, cellH: number, gap: number, maxWidth: number): WrapGrid {
	if (!(count > 0)) return { cols: 1, rows: 0, width: 0, height: 0 };
	const fit = math.max(1, math.floor((maxWidth + gap) / (cellW + gap)));
	const cols = math.min(count, fit);
	const rows = math.ceil(count / cols);
	return { cols, rows, width: cols * cellW + (cols - 1) * gap, height: rows * cellH + (rows - 1) * gap };
}

/** The widest a StatusPanel row may be: its footprint width less the panel's padding. */
export function statusRowMaxWidth(): number {
	return HUD_FOOTPRINT.status.maxW - 2 * HUD_VIEW.pad;
}
