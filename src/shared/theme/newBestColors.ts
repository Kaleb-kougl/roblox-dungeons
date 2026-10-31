/**
 * Roblox port (docs/NEW_BEST.md NB4): the new-best gold's colour rules and report, kept out of validate.ts, whose
 * compiled Luau sits at Luau's 200-locals-per-function limit: validate.ts imports one name from here
 * (`newBestColorProblems`) and calls it inside validateManifest, like variantColors.ts.
 *
 * `newBestReport` (NEW_BEST_COLOR_RULES): `newBest` reads on the score panel (`uiPanel`, WCAG's graphics bar), reads
 * apart from `ember` (today's meter gold, the reach state's colour) and every combo tier (the panel shows them side by
 * side), and never reads as an enemy bullet or a telegraph (the NEW BEST! shout is painted on the floor under bullets,
 * the combo shout's construction).
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import { COMBO_TIER_ROLES, MIN_DECOR_FX_BULLET_DIFFERENCE, ROOM_EDGE_DIFFERENCE_ROLES } from "./contract";
import type { ColorRole } from "./types";
import { isObj } from "./util";

/** What `newBestReport` checks against what, and the bars (NEW_BEST_COLOR_RULES). */
export interface NewBestColorRules {
	/** The role checked. */
	readonly role: ColorRole;
	/** What the target row and the gold score number are drawn over: the score panel. */
	readonly panel: ColorRole;
	/** WCAG contrast of `role` on `panel` (the graphics bar, like the combo tiers'). */
	readonly minPanelContrast: number;
	/** The colours the gold must read apart from on the panel: ember and the combo tiers (COMBO_TIER_ROLES). */
	readonly apartFrom: ReadonlyArray<ColorRole>;
	/** CIE76 between `role` and every `apartFrom` colour (the combo ladder's step bar). */
	readonly minApart: number;
	/** The colours the floor shout must never be mistaken for: the enemy bullets and `telegraph`. */
	readonly against: ReadonlyArray<ColorRole>;
	/** CIE76 between `role` and every `against` colour: the decor fx / enemy outline bar. */
	readonly minDifference: number;
}

/**
 * The new-best colour rules (`newBestReport`). The plan's starting gold #ffd75e failed `minApart` (14.8 from the
 * placeholder ember #ffd27a): the placeholder's #ffd700 is a deeper, purer gold.
 */
export const NEW_BEST_COLOR_RULES: NewBestColorRules = {
	role: "newBest",
	panel: "uiPanel",
	minPanelContrast: 3.0,
	apartFrom: COMBO_TIER_ROLES,
	minApart: 25,
	against: ROOM_EDGE_DIFFERENCE_ROLES,
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/**
 * One check of `newBestReport`, in this order: check "panel" (the role on `rules.panel`, WCAG contrast, >=
 * minPanelContrast), then "apart" per `rules.apartFrom` colour (CIE76, >= minApart), then "difference" per
 * `rules.against` colour (CIE76, >= minDifference). `value` is the ratio or the difference. A missing or non-hex role
 * gives no entries (the colour-role check reports it); a missing `against` colour is skipped.
 */
export interface NewBestEntry {
	role: string;
	check: "panel" | "apart" | "difference";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/** The new-best gold's checks (NEW_BEST_COLOR_RULES); see NewBestEntry. */
export function newBestReport(manifest: unknown): Array<NewBestEntry> {
	const out = new Array<NewBestEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const rules = NEW_BEST_COLOR_RULES;
	const role = rules.role;
	const color = colors[role];
	if (!isHexColor(color)) {
		return out;
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
	const differences: ReadonlyArray<["apart" | "difference", ReadonlyArray<ColorRole>, number]> = [
		["apart", rules.apartFrom, rules.minApart],
		["difference", rules.against, rules.minDifference],
	];
	for (const [check, list, min] of differences) {
		for (const against of list) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			out.push({ role, check, color, against, againstColor, value, min, ok: value >= min });
		}
	}
	return out;
}

/** A validator message: where (a manifest path) and what. */
export interface NewBestColorProblem {
	path: Array<string>;
	msg: string;
}

/** Every failed newBestReport check as a validator message (validateManifest adds them, path `colors.<role>`). */
export function newBestColorProblems(manifest: unknown): Array<NewBestColorProblem> {
	const fixed1 = (n: number) => "%.1f".format(n);
	const fixed2 = (n: number) => "%.2f".format(n);
	const out = new Array<NewBestColorProblem>();
	for (const c of newBestReport(manifest)) {
		if (c.ok) {
			continue;
		}
		let msg: string;
		if (c.check === "panel") {
			msg =
				`contrast: ${c.role} ${c.color} on ${c.against} ${c.againstColor} is ${fixed2(c.value)}:1, needs >= ` +
				`${fixed1(c.min)}:1: the new-best gold must read on the score panel`;
		} else {
			const why =
				c.check === "apart"
					? "the new-best gold must read apart from ember and every combo tier"
					: "the new-best gold must never read as an enemy bullet or a telegraph (the floor shout lies under " +
					  "bullets)";
			msg =
				`colour difference: ${c.role} ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(c.value)} ` +
				`(CIE76), needs >= ${fixed1(c.min)}: ${why}`;
		}
		out.push({ path: ["colors", c.role], msg });
	}
	return out;
}
