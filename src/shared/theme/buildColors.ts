/**
 * Roblox port (docs/BUILDS.md BU1, BUD12): the builds effect colour rules and `buildReport`, in their own module:
 * validate.ts sits at Luau's 200-locals-per-function limit, so it imports nothing from here; variantColors.ts'
 * `variantColorProblems` (already called by validateManifest) folds this report's failures into its own.
 *
 * Every effect role (builds.ts BUILD_EFFECT_ROLES: spark, burst, shard, ember, overkill, counter, overcap) is >= 3:1 (WCAG's graphics bar) on every
 * biome floor and >= MIN_DECOR_FX_BULLET_DIFFERENCE (40, CIE76) from every enemy-bullet role, `telegraph`, `enemyGoo`,
 * `enemyOutline` and every boost role: a player effect must never read as danger, and danger never as decoration.
 * Then BUILD_APART_RULES (docs/BUILDS_V2.md BV10): the overcap points' gold is also >= 40 CIE76 from `newBest`, so an
 * overcap pop never reads as a record.
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import { BOOST_ROLES, ENEMY_BULLET_ROLES, MIN_DECOR_FX_BULLET_DIFFERENCE } from "./contract";
import type { ColorRole } from "./types";
import { isObj, sortedEntries } from "./util";
import { BUILD_EFFECT_ROLES } from "./builds";

/** What buildReport checks against what, and the bars. */
export interface BuildColorRules {
	readonly roles: ReadonlyArray<ColorRole>;
	readonly minFloorContrast: number;
	readonly against: ReadonlyArray<ColorRole>;
	readonly minDifference: number;
}

/** The builds effect colour rules (BUD12). */
export const BUILD_COLOR_RULES: BuildColorRules = {
	roles: BUILD_EFFECT_ROLES,
	minFloorContrast: 3.0,
	against: [...ENEMY_BULLET_ROLES, "telegraph", "enemyGoo", "enemyOutline", ...BOOST_ROLES],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/** One role that must also read apart from a few colours outside BUILD_COLOR_RULES.against (buildReport's "apart"). */
export interface BuildApartRule {
	readonly role: ColorRole;
	readonly from: ReadonlyArray<ColorRole>;
	readonly minApart: number;
}

/**
 * docs/BUILDS_V2.md BV10: the overcap pops are gold, like the new-best score number and floor shout; they must never
 * read as a record (the decor fx bar, 40 CIE76). Checked after BUILD_COLOR_RULES' entries.
 */
export const BUILD_APART_RULES: ReadonlyArray<BuildApartRule> = [
	{ role: "build.overcap", from: ["newBest"], minApart: MIN_DECOR_FX_BULLET_DIFFERENCE },
];

/**
 * One check of buildReport, per role in BUILD_COLOR_RULES.roles order: check "floor" (the role vs every biome's floor,
 * biomes in sorted order; `against` = the biome ID) then "difference" (the role vs every `against` colour, CIE76);
 * then, per BUILD_APART_RULES entry, check "apart" (the role vs every `from` colour, CIE76).
 * A role that is missing or not a hex colour is skipped (the colour-role check reports it).
 */
export interface BuildColorEntry {
	role: string;
	check: "floor" | "difference" | "apart";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/** Every check of BUILD_COLOR_RULES, then BUILD_APART_RULES, on `manifest` (see BuildColorEntry). */
export function buildReport(manifest: unknown): Array<BuildColorEntry> {
	const out = floorAndDifferenceReport(manifest, BUILD_COLOR_RULES);
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	for (const rule of BUILD_APART_RULES) {
		const color = colors[rule.role];
		if (!isHexColor(color)) {
			continue;
		}
		for (const against of rule.from) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			const min = rule.minApart;
			out.push({ role: rule.role, check: "apart", color, against, againstColor, value, min, ok: value >= min });
		}
	}
	return out;
}

/**
 * Every check of `rules` on `manifest`, as buildReport describes (per role: "floor" vs every biome floor, then
 * "difference" vs every `against` colour). Shared with pelletColors.ts' `pelletReport` (docs/PELLETS.md PL6).
 */
export function floorAndDifferenceReport(manifest: unknown, rules: BuildColorRules): Array<BuildColorEntry> {
	const out = new Array<BuildColorEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const biomes = isObj(manifest.biomes) ? sortedEntries(manifest.biomes) : [];
	for (const role of rules.roles) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		for (const [biome, def] of biomes) {
			const againstColor = isObj(def) ? def.floor : undefined;
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = contrastRatio(color, againstColor);
			const min = rules.minFloorContrast;
			out.push({ role, check: "floor", color, against: biome, againstColor, value, min, ok: value >= min });
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
	}
	return out;
}
