/**
 * Roblox port (docs/FLOOR_MODIFIERS.md FM7): the floor modifiers' colour rules and `floorModifierReport`, in their own
 * module like fortuneColors.ts: validate.ts sits at Luau's 200-locals-per-function limit, so it imports nothing from
 * here; variantColors.ts' `variantColorProblems` (already called by validateManifest) folds this report's failures into
 * its own.
 *
 *   - Every kind's colour (floorModifiers.ts FLOOR_MODIFIER_ROLES) is TEXT: the banner's name on the floor card (drawn
 *     over `background`), the chip's text and the pause line (over `uiPanel`). So each is >= 4.5:1 (WCAG's text bar, not
 *     the 3:1 graphics bar) on both.
 *   - A twist (Blood Moon) must never read as a boon: every twist role is >= MIN_FLOOR_MODIFIER_TWIST_DIFFERENCE (40
 *     CIE76, the decor fx / bullet bar) from every boon role, so "something good" and "something dangerous" never look
 *     alike on the card (docs/FLOOR_MODIFIERS.md Rules that keep it kind).
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import { FLOOR_MODIFIER_BOON_ROLES, FLOOR_MODIFIER_ROLES, FLOOR_MODIFIER_TWIST_ROLES } from "./floorModifiers";
import type { ColorRole } from "./types";
import { isObj } from "./util";

/** What `floorModifierReport` checks against what, and the bars (FLOOR_MODIFIER_COLOR_RULES). */
export interface FloorModifierColorRules {
	/** Every kind's role (contrast checks). */
	readonly roles: ReadonlyArray<ColorRole>;
	/** What the text is drawn over: the floor card's backdrop and the HUD panel. */
	readonly panels: ReadonlyArray<ColorRole>;
	/** WCAG contrast of every role on every panel (the text bar). */
	readonly minPanelContrast: number;
	/** The twists' roles, each checked against every boon role. */
	readonly twists: ReadonlyArray<ColorRole>;
	readonly boons: ReadonlyArray<ColorRole>;
	/** CIE76 between every twist and every boon. */
	readonly minTwistDifference: number;
}

/** Minimum CIE76 difference of a twist's colour from every boon's (see the file comment). */
export const MIN_FLOOR_MODIFIER_TWIST_DIFFERENCE = 40;

/** The floor modifiers' colour rules (docs/FLOOR_MODIFIERS.md FM7). */
export const FLOOR_MODIFIER_COLOR_RULES: FloorModifierColorRules = {
	roles: FLOOR_MODIFIER_ROLES,
	panels: ["background", "uiPanel"],
	minPanelContrast: 4.5,
	twists: FLOOR_MODIFIER_TWIST_ROLES,
	boons: FLOOR_MODIFIER_BOON_ROLES,
	minTwistDifference: MIN_FLOOR_MODIFIER_TWIST_DIFFERENCE,
};

/**
 * One check of `floorModifierReport`, in this order: per role (FLOOR_MODIFIER_ROLES order) check "panel" on every
 * `rules.panels` colour (WCAG contrast, >= minPanelContrast); then per twist check "apart" against every boon (CIE76,
 * >= minTwistDifference). `value` is the ratio or the difference. A missing or non-hex colour is skipped (the
 * colour-role check reports it).
 */
export interface FloorModifierColorEntry {
	role: string;
	check: "panel" | "apart";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/** Every check of FLOOR_MODIFIER_COLOR_RULES on `manifest` (see FloorModifierColorEntry). */
export function floorModifierReport(manifest: unknown): Array<FloorModifierColorEntry> {
	const out = new Array<FloorModifierColorEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const rules = FLOOR_MODIFIER_COLOR_RULES;
	for (const role of rules.roles) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		for (const against of rules.panels) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = contrastRatio(color, againstColor);
			const min = rules.minPanelContrast;
			out.push({ role, check: "panel", color, against, againstColor, value, min, ok: value >= min });
		}
	}
	for (const role of rules.twists) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		for (const against of rules.boons) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			const min = rules.minTwistDifference;
			out.push({ role, check: "apart", color, against, againstColor, value, min, ok: value >= min });
		}
	}
	return out;
}
