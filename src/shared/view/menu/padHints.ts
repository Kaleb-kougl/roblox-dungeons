/**
 * Gamepad menus (docs/GAMEPAD_MENUS.md 4.1, GM1): the hint bar's entries, built from the same table as menuPadAction
 * (padActions.ts PAD_SURFACES), so a hint never names a button that does nothing: a row whose condition is false (Y
 * with no pending invite, LT / RT off the Controls tab) is left out, and B shows its meaning (`pad.hint.holdExit` on
 * the run-over panel; nothing where B does nothing).
 */
import { padConditionHolds, padRows, type PadContext, type PadSurface } from "./padActions";

/** One hint: the pad keys it draws (Enum.KeyCode names; a pair like LB / RB is one hint) and its string key. */
export interface PadHint {
	readonly keyNames: ReadonlyArray<string>;
	readonly stringKey: string;
}

/** The hint bar for `surface` in `ctx`, in order (A, B, bumpers, triggers, X, Y, the right stick). */
export function padHints(surface: PadSurface, ctx: PadContext): ReadonlyArray<PadHint> {
	const out = new Array<PadHint>();
	for (const row of padRows(surface)) {
		if (row.hint === undefined || !padConditionHolds(row.when, ctx)) continue;
		const stringKey =
			ctx.detailsOpen === true && row.hintDetailsOpen !== undefined ? row.hintDetailsOpen : row.hint;
		out.push({ keyNames: row.keys, stringKey });
	}
	return out;
}
