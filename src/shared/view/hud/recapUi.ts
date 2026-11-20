/**
 * How the run-over recap is drawn (docs/RUN_RECAP.md RR5 / RR6): the panel's layout numbers (RECAP_UI: the 2 x 2
 * highlight grid, the near-miss line, the exits row with the Details toggle in the wide / compact / narrow layouts) and
 * the pure text and fade helpers the client's RecapController and RunOverPanel share. The recap's logic (near-miss,
 * highlights, timeline) is recap.ts; its tunables recapConfig.ts. Presentation only.
 *
 *   - `recapNearMissText`    the near-miss line at a counted value (`{boss}` resolved, numbers grouped).
 *   - `recapHighlightValue`  a highlight cell's value at a counted value: the grouped number, `{n} of {total}`, or the
 *                            best combo's multiplier with its tier name in the tier's colour (RichText, the run-over
 *                            breakdown's own `comboBestRichText`).
 *   - `recapRowTransparency` a row fades up over RECAP_UI.fadeSec from its start (hidden before).
 *   - `recapRecordRowsSec`   when new best's record rows have rolled (the record-run timeline's `recordRowsSec`).
 *   - `recapExitSizes`       the exits row's button sizes per layout: Again is always the largest (RR7, touch).
 *   - `recapHidesBestLine`   new best's dim `Best ...` line steps aside for the near-miss line (it says the same, closer).
 *
 * @module
 */
import { formatThousands } from "shared/l10n";
import { COMBO_TIERS, comboTier } from "./comboConfig";
import { comboBestRichText, richTextEscape, type ComboTextStr } from "./comboDraw";
import { formatCombo } from "./layout";
import { NEW_BEST } from "./newBestConfig";
import type { RecapHighlight, RecapNearMiss, RecapRowState } from "./recap";
import { HUD_STRINGS } from "./strings";

/** A button size, reference px. */
export interface RecapButtonSize {
	readonly x: number;
	readonly y: number;
}

/** The run-over panel's three arrangements (client/ui/hud RunOverPanel through MenuFit). */
export type RecapLayout = "wide" | "compact" | "narrow";

/** The exits row's buttons in one layout: Again, and the others (Main menu / Back to lobby, Details). */
export interface RecapExitSizes {
	readonly again: RecapButtonSize;
	readonly other: RecapButtonSize;
	/** The other buttons' text size (smaller than Again's, so a long label still fits the narrower button). */
	readonly otherTextSize: number;
}

/**
 * The recap's layout numbers on the run-over panel, in reference px before the HUD scale: the 2 x 2 highlight grid's
 * cells and text sizes, the scope chip, the near-miss line and the exits row's buttons per layout (wide / compact /
 * narrow); transparencies are 0..1 (1 = invisible) and `fadeSec` real seconds.
 */
export const RECAP_UI = {
	/**
	 * One highlight cell (reference px): two columns of `cellWidth` and the list gap (HUD_VIEW.gap 6) are the score
	 * breakdown's width (200 + 6 + 110 = 316), so the grid takes the breakdown's place in every layout (Details swaps
	 * them, RRD5). Label line over the value line.
	 */
	cellWidth: 155,
	cellHeight: 48,
	columns: 2,
	/** The cell's label: TextScaled up to `labelText`, never below `labelMinText` (a long translation shrinks). */
	labelText: 14,
	labelMinText: 9,
	/** The cell's value (the counted number). */
	valueText: 24,
	valueMinText: 12,
	/** Label / value line heights inside a cell (their sum and the cell's padding are cellHeight). */
	labelHeight: 16,
	valueHeight: 28,
	/** The cell's background transparency (a faint uiPanel tile; 1 would be none). */
	cellTransparency: 0.6,
	/** The co-op scope chip (`Team` / `You`) at the label's right end: width, height, text size (TextScaled max). */
	chip: { w: 44, h: 14, text: 11, minText: 7 },
	/** The near-miss line: one TextScaled line of `text` (min `minText`); the record run's dim sub-line uses `dimText`. */
	nearMiss: { text: 20, minText: 12, dimText: 16, dimMinText: 10, height: 24, dimHeight: 20 },
	/** The dim sub-line's text transparency (over ember). */
	dimTransparency: 0.35,
	/** A row fades up over this long from its start (s); reduced motion too ("values fade in final"). */
	fadeSec: 0.15,
	/**
	 * The exits row (Again · Main menu · Details): Again the largest (RR7: touch's first target). Wide: the menu
	 * buttons (HUD_VIEW.buttonSize 260) for Again, 200 for the others (3 + 2 gaps = 672 of the 840 panel). Compact: the
	 * left column is MENU_FIT.runOverLeftWidth 400 = 176 + 2 x 106 + 2 gaps. Narrow: MENU_FIT.runOverNarrowWidth 480
	 * less the panel's 2 x 16 padding = 448 = 196 + 2 x 120 + 2 gaps.
	 */
	exits: {
		wide: { again: { x: 260, y: 40 }, other: { x: 200, y: 40 }, otherTextSize: 20 },
		compact: { again: { x: 176, y: 40 }, other: { x: 106, y: 40 }, otherTextSize: 16 },
		narrow: { again: { x: 196, y: 40 }, other: { x: 120, y: 40 }, otherTextSize: 16 },
	} as Readonly<Record<RecapLayout, RecapExitSizes>>,
} as const;

/** The exits row's button sizes in `layout` (RECAP_UI.exits). */
export function recapExitSizes(layout: RecapLayout): RecapExitSizes {
	return RECAP_UI.exits[layout];
}

/** The exits row's width with `buttons` buttons (Again + the rest), list gaps of `gap` between them. */
export function recapExitsWidth(layout: RecapLayout, buttons: number, gap: number): number {
	const e = RECAP_UI.exits[layout];
	if (buttons <= 0) return 0;
	return e.again.x + (buttons - 1) * (e.other.x + gap);
}

/** The highlight grid's size for `cells` cells (RECAP_UI.columns per row), list gaps of `gap`. */
export function recapGridSize(cells: number, gap: number): { readonly w: number; readonly h: number } {
	const cols = RECAP_UI.columns;
	const rows = math.ceil(math.max(0, cells) / cols);
	return {
		w: cols * RECAP_UI.cellWidth + (cols - 1) * gap,
		h: rows > 0 ? rows * RECAP_UI.cellHeight + (rows - 1) * gap : 0,
	};
}

/** A theme string lookup (ThemePack.str's shape). */
export type RecapStr = ComboTextStr;
/** A number printer (default: shared/l10n formatThousands). */
export type RecapFormat = (n: number) => string;

const grouped: RecapFormat = (n) => formatThousands(n);

/**
 * The near-miss line with its counted variable at `value` (recapNearMissRow's counted value; pass the final value
 * when settled): every number variable grouped by `fmt`, `{boss}` the boss's name (its `bossKey` string).
 */
export function recapNearMissText(n: RecapNearMiss, value: number, s: RecapStr, fmt: RecapFormat = grouped): string {
	const vars: Record<string, string | number> = {};
	for (const [k, v] of pairs(n.vars as unknown as ReadonlyMap<string, number>)) vars[k] = fmt(v);
	if (n.countVar !== undefined) vars[n.countVar] = fmt(value);
	if (n.bossKey !== undefined) vars.boss = s(n.bossKey);
	return s(n.key, vars);
}

/**
 * A highlight cell's value at the counted `value`: the best combo's multiplier (`x4.2`) with the counted tier's name
 * in `tierHex` ("#rrggbb", "" for none; RichText, escaped), `{n} of {total}` (valueKey), or the grouped number.
 */
export function recapHighlightValue(
	h: RecapHighlight,
	value: number,
	s: RecapStr,
	tierHex = "",
	fmt: RecapFormat = grouped,
): string {
	if (h.format === "combo") {
		const tier = COMBO_TIERS[comboTier(value)];
		const name = tier.nameKey !== undefined ? s(tier.nameKey) : undefined;
		return comboBestRichText(s(HUD_STRINGS.combo, { combo: formatCombo(value) }), name, tierHex, s);
	}
	if (h.valueKey !== undefined) {
		const vars: Record<string, string | number> = { n: fmt(value) };
		if (h.vars !== undefined) {
			for (const [k, v] of pairs(h.vars as unknown as ReadonlyMap<string, number>)) vars[k] = fmt(v);
		}
		return richTextEscape(s(h.valueKey, vars));
	}
	return richTextEscape(fmt(value));
}

/** A row's text transparency `t` seconds after the run-over frame: hidden until it shows, then a RECAP_UI.fadeSec fade. */
export function recapRowTransparency(row: Readonly<RecapRowState>, t: number): number {
	if (!row.visible) return 1;
	const fade = RECAP_UI.fadeSec;
	if (fade <= 0) return 0;
	return 1 - math.clamp((t - row.startSec) / fade, 0, 1);
}

/**
 * When new best's record rows have finished rolling (seconds from the run-over frame; NEW_BEST.runOver: row i starts
 * at rowDelaySec + i x rowGapSec and lands rollSec later). No rows (FIRST RECORD): the rows' start, so the highlights
 * follow the ribbon.
 */
export function recapRecordRowsSec(rows: number): number {
	const R = NEW_BEST.runOver;
	if (rows <= 0) return R.rowDelaySec;
	return R.rowDelaySec + (rows - 1) * R.rowGapSec + R.rollSec;
}

/** New best's dim `Best ...` line is left out while the near-miss line shows (RR5: it says the same thing, closer). */
export function recapHidesBestLine(nearMiss: RecapNearMiss | undefined): boolean {
	return nearMiss !== undefined;
}
