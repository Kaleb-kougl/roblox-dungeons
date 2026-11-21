/**
 * Wrapping rows of equal cells (docs/HUD_LAYOUT.md H6 follow-up): the StatusPanel's owned items (RunItems) and running
 * boosts (BoostRow) wrap into more rows instead of growing past the status panel's footprint width. Pure and headless
 * (wrap.spec.ts); client/ui/hud GridRow lays the cells out with a UIGridLayout at this size.
 *
 * @module
 */
import { HUD_FOOTPRINT } from "./footprint";
import { HUD_VIEW } from "./layout";

/**
 * A wrapped grid's shape (`wrapGrid`): what the client's GridRow gives its UIGridLayout. No cells: 1 column, 0 rows.
 */
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

/** How a list is cut to one row (`capOneRow`). No cells: 0 shown, 0 more. */
export interface OneRowCap {
	/** Cells drawn (the last `shown` of the list). */
	readonly shown: number;
	/** Cells left out, summed up in one extra "+more" cell (0: none, no extra cell). */
	readonly more: number;
}

/**
 * Caps `count` cells to the one row that fits in `maxWidth` (docs/HUD_LAYOUT.md review fix: RunItems never grows the
 * StatusPanel past its footprint height). When they all fit, all show; otherwise the last `cols - 1` show and one
 * cell says how many more there are, so the row still holds `cols` cells.
 */
export function capOneRow(count: number, cellW: number, gap: number, maxWidth: number): OneRowCap {
	if (!(count > 0)) return { shown: 0, more: 0 };
	const cols = math.max(1, math.floor((maxWidth + gap) / (cellW + gap)));
	if (count <= cols) return { shown: count, more: 0 };
	const shown = math.max(0, cols - 1);
	return { shown, more: count - shown };
}

/** The widest a StatusPanel row may be: its footprint width less the panel's padding. */
export function statusRowMaxWidth(): number {
	return HUD_FOOTPRINT.status.maxW - 2 * HUD_VIEW.pad;
}
