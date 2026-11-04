import { RECAP } from "shared/view/hud";
import { ComboUiValue } from "./comboUi";

/**
 * The run-over recap's per-frame values (docs/RUN_RECAP.md RR5 / RR6): module-level React bindings like NEW_BEST_UI,
 * written by RecapController once per rendered frame (each only when it changed) and read by the panel's NearMissLine
 * and HighlightGrid. What the blocks are (which line, which cells, their labels) is the store's `recap` slice; these
 * are only the counted texts and the fades, so a counting number never re-renders the tree. Strings are resolved by
 * the controller.
 */
export class RecapUiValue<T> extends ComboUiValue<T> {}

function perCell<T>(initial: T): RecapUiValue<T>[] {
	const out: RecapUiValue<T>[] = [];
	for (let i = 0; i < RECAP.maxHighlights; i++) out.push(new RecapUiValue(initial));
	return out;
}

export const RECAP_BINDINGS = {
	/** The near-miss line's text at its counted value (shared/view/hud recapNearMissText). */
	nearMissText: new RecapUiValue(""),
	/** Its text transparency (recapRowTransparency: hidden, then the fade up). */
	nearMissTransparency: new RecapUiValue(1),
	/** Each highlight cell's value text (recapHighlightValue: RichText). */
	cellValue: perCell(""),
	/** Each cell's transparency (label, value, chip and tile fade together). */
	cellTransparency: perCell(1),
};

/** Every RECAP_BINDINGS value back to its initial value (a new run, an exit). */
export function resetRecapBindings(): void {
	const B = RECAP_BINDINGS;
	B.nearMissText.reset();
	B.nearMissTransparency.reset();
	for (const v of B.cellValue) v.reset();
	for (const v of B.cellTransparency) v.reset();
}
