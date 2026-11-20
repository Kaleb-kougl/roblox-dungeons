/**
 * Roblox port (docs/SILVER.md SV7): Silver's colour rule and `silverReport`, in their own module like secretColors.ts:
 * validate.ts sits at Luau's 200-locals-per-function limit, so it imports nothing from here; variantColors.ts'
 * `variantColorProblems` (already called by validateManifest) folds this report's failures into its own.
 *
 *   - "panel": `silver` on `uiPanel` >= SILVER_COLOR_RULES.minPanelContrast (4.5, WCAG's text bar: the counter, its
 *     `+N`, the recap rows and the Armory's prices are text on panels);
 *   - "difference": >= MIN_DECOR_FX_BULLET_DIFFERENCE (40, CIE76) from every enemy-bullet role and `telegraph` (the
 *     crate pops and coins rise among bullets);
 *   - "apart": >= 40 CIE76 from the score's golds (`newBest`, `golden.coin`, `uiAccent`): Silver is what you take home,
 *     never this run's score, so it must not read as the gold coin beside the score number.
 *
 * @module
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import { MIN_DECOR_FX_BULLET_DIFFERENCE, ROOM_EDGE_DIFFERENCE_ROLES } from "./contract";
import { SILVER_ROLES } from "./silver";
import type { ColorRole } from "./types";
import { isObj } from "./util";

export interface SilverColorRules {
	readonly roles: ReadonlyArray<ColorRole>;
	/** The panel the text is drawn on. */
	readonly panel: ColorRole;
	readonly minPanelContrast: number;
	/** Danger: the enemy bullets and the telegraph. */
	readonly against: ReadonlyArray<ColorRole>;
	readonly minDifference: number;
	/** The score's golds. */
	readonly apartFrom: ReadonlyArray<ColorRole>;
	readonly minApart: number;
}

export const SILVER_COLOR_RULES: SilverColorRules = {
	roles: SILVER_ROLES,
	panel: "uiPanel",
	minPanelContrast: 4.5,
	against: ROOM_EDGE_DIFFERENCE_ROLES,
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
	apartFrom: ["newBest", "golden.coin", "uiAccent"],
	minApart: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/** One check of silverReport: per role, "panel", then "difference" per `against`, then "apart" per `apartFrom`. */
export interface SilverColorEntry {
	role: string;
	check: "panel" | "difference" | "apart";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/** Every check of SILVER_COLOR_RULES on `manifest` (a missing or non-hex colour is skipped: the role check reports it). */
export function silverReport(manifest: unknown): Array<SilverColorEntry> {
	const out = new Array<SilverColorEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const rules = SILVER_COLOR_RULES;
	for (const role of rules.roles) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		const panel = colors[rules.panel];
		if (isHexColor(panel)) {
			const value = contrastRatio(color, panel);
			const min = rules.minPanelContrast;
			out.push({
				role,
				check: "panel",
				color,
				against: rules.panel,
				againstColor: panel,
				value,
				min,
				ok: value >= min,
			});
		}
		for (const against of rules.against) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			const min = rules.minDifference;
			out.push({ role, check: "difference", color, against, againstColor, value, min, ok: value >= min });
		}
		for (const against of rules.apartFrom) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			const min = rules.minApart;
			out.push({ role, check: "apart", color, against, againstColor, value, min, ok: value >= min });
		}
	}
	return out;
}
