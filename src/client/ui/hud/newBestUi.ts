import { NEW_BEST_DRAW } from "shared/view/hud";
import { ComboUiValue } from "./comboUi";

/**
 * The new-best celebration's per-frame HUD values (docs/NEW_BEST.md NB6): module-level React bindings like COMBO_UI,
 * written by the client's NewBestController once per rendered frame (each only when it changed) and read by the score
 * panel's label row (BestTargetRow), its score number (ScoreNumber), the touch strip's compact target line and the
 * run-over panel's record rows. A binding update changes the one property it is bound to and never re-renders the
 * tree. Strings and colours are resolved by the controller (theme strings, theme roles). An unranked run never writes
 * anything but the initial values, so its HUD is exactly the one before the feature.
 */
export class NewBestUiValue<T> extends ComboUiValue<T> {}

const NO_COLOR = new Color3();

function perRow<T>(initial: T): NewBestUiValue<T>[] {
	const out: NewBestUiValue<T>[] = [];
	for (let i = 0; i < NEW_BEST_DRAW.maxRecordRows; i++) out.push(new NewBestUiValue(initial));
	return out;
}

/**
 * Every value the new-best celebration draws in the HUD (see the comment on `NewBestUiValue`): the score panel's target
 * row, the touch strip's compact line, the score number's gold and shine, and the run-over panel's record rows.
 * NewBestController writes them; the components bind to them.
 */
export const NEW_BEST_UI = {
	// --- score panel row 1, left slot (shared/view/hud newBestRowText) ---
	/** `12340 TO BEST` / `NEW BEST +3120`, or "" (no target: the slot is empty). */
	rowText: new NewBestUiValue(""),
	/** uiTextDim (chasing), ember brightened by the pulse (reach), newBest (passed). */
	rowColor: new NewBestUiValue(NO_COLOR),
	/** The slot's UIScale: the crossing's slam (NewBestFrame.slamScale). */
	rowScale: new NewBestUiValue(1),
	/** The touch strip's compact line (`-12340` / `NEW BEST`), or "". */
	compactText: new NewBestUiValue(""),
	// --- the score number ---
	/** How far the number is drawn from uiText toward newBest gold: goldMix x (1 - whiteFlash). */
	scoreGold: new NewBestUiValue(0),
	/** The shine sweep across the gold number, 0..1, or -1 (none). */
	shine: new NewBestUiValue(-1),
	// --- run-over record rows (NB9; recordRowText at the rolled value) ---
	recordRows: perRow(""),
};

/** Every NEW_BEST_UI value back to its initial value (a run start / exit, an unranked run). */
export function resetNewBestUi(): void {
	const U = NEW_BEST_UI;
	U.rowText.reset();
	U.rowColor.reset();
	U.rowScale.reset();
	U.compactText.reset();
	U.scoreGold.reset();
	U.shine.reset();
	for (const v of U.recordRows) v.reset();
}
