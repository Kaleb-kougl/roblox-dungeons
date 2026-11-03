/**
 * Roblox port (docs/ENEMY_VARIANTS.md EV1): the enemy variants' colour rules and their reports, kept out of validate.ts,
 * whose compiled Luau sits at Luau's 200-locals-per-function limit (plan change 10): validate.ts imports one name from
 * here (`variantColorProblems`) and calls it inside validateManifest.
 *
 *   - `affixReport` (AFFIX_COLOR_RULES): the affix rings and the shield segment read on every biome floor and never as
 *     a bullet, a telegraph, the enemy rim or another affix;
 *   - `gooReport` (GOO_COLOR_RULES): the goo puddles read on every biome floor and never as decor or a pickup;
 *   - `auraReport` (AURA_COLOR_RULES, docs/NEW_ENEMIES.md NE1): the Warbanner's aura ring and tint read on every biome
 *     floor and never as a bullet, a telegraph, a pickup or an affix;
 *   - and, folded in here so validate.ts takes no new name (docs/BUILDS.md BU1), buildColors.ts `buildReport`: the
 *     builds effect colours read on every floor and never as danger;
 *   - likewise (docs/PELLETS.md PL6), pelletColors.ts `pelletReport`: the pellets read on every floor and never as a
 *     bullet, a telegraph, a boost, a build effect or the player's outline.
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import { BOOST_ROLES, DECOR_FX_ROLES, ENEMY_BULLET_ROLES, MIN_DECOR_FX_BULLET_DIFFERENCE } from "./contract";
import type { ColorRole } from "./types";
import { isObj, sortedEntries } from "./util";
import { AFFIX_ROLES, ENEMY_AURA_ROLE, ENEMY_GOO_ROLE, ENEMY_SHIELD_ROLE } from "./variants";
import { buildReport } from "./buildColors";
import { pelletReport } from "./pelletColors";

/** What a variant colour report checks against what, and the bars (AFFIX_COLOR_RULES, GOO_COLOR_RULES). */
export interface VariantColorRules {
	/** The roles checked, in order. */
	readonly roles: ReadonlyArray<ColorRole>;
	/** WCAG contrast of every role on every biome floor (walls are not checked: rings and puddles lie on floors). */
	readonly minFloorContrast: number;
	/** The colours every role must never be mistaken for. */
	readonly against: ReadonlyArray<ColorRole>;
	/** CIE76 between every role and every `against` colour. */
	readonly minDifference: number;
	/** CIE76 between every two roles (0: not checked). */
	readonly minApart: number;
}

/**
 * The affix colour rules (`affixReport`, docs/ENEMY_VARIANTS.md EV1): the four affix rings (AFFIX_ROLES) and
 * `enemyShield`, each >= 3:1 (WCAG's graphics bar) on every biome floor, >= MIN_DECOR_FX_BULLET_DIFFERENCE (CIE76)
 * from the enemy-bullet roles, `telegraph` and `enemyOutline` (a ring lies under an enemy among bullets, and the rim's
 * tint must still read as an affix, not as the outline), and as far from each other (each affix reads as itself).
 */
export const AFFIX_COLOR_RULES: VariantColorRules = {
	roles: [...AFFIX_ROLES, ENEMY_SHIELD_ROLE],
	minFloorContrast: 3.0,
	against: [...ENEMY_BULLET_ROLES, "telegraph", "enemyOutline"],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
	minApart: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/**
 * The goo colour rules (`gooReport`, docs/ENEMY_VARIANTS.md EVD5): `enemyGoo` >= 3:1 on every biome floor and >=
 * MIN_DECOR_FX_BULLET_DIFFERENCE (CIE76) from every decor fx colour (DECOR_FX_ROLES: flames, glows, zones, the biome
 * motes) and every boost colour, so a puddle on the floor reads as danger, never as decor or a pickup.
 */
export const GOO_COLOR_RULES: VariantColorRules = {
	roles: [ENEMY_GOO_ROLE],
	minFloorContrast: 3.0,
	against: [...DECOR_FX_ROLES, ...BOOST_ROLES],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
	minApart: 0,
};

/**
 * The aura colour rules (`auraReport`, docs/NEW_ENEMIES.md NE1 / NED8): `enemyAura` (the ring under a Warbanner and
 * the faint rim tint on every enemy it buffs) >= 3:1 on every biome floor and >= MIN_DECOR_FX_BULLET_DIFFERENCE (40
 * CIE76) from the enemy-bullet roles, `telegraph`, every boost colour and every affix colour (with the shield
 * segment's), so a buffed enemy never reads as a threat cue, a pickup or an elite.
 */
export const AURA_COLOR_RULES: VariantColorRules = {
	roles: [ENEMY_AURA_ROLE],
	minFloorContrast: 3.0,
	against: [...ENEMY_BULLET_ROLES, "telegraph", ...BOOST_ROLES, ...AFFIX_ROLES, ENEMY_SHIELD_ROLE],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
	minApart: 0,
};

/**
 * One check of a variant colour report, for each role in `rules.roles` order:
 * - check "floor": the role vs every biome's floor (WCAG contrast, >= minFloorContrast; `against` = the biome ID,
 *   biomes in sorted order);
 * - check "difference": the role vs every `rules.against` colour (CIE76, >= minDifference; `against` = the role);
 * - check "apart": the role vs every LATER role (CIE76, >= minApart; each pair once; affixes only).
 * `value` is the ratio or the difference. A role that is missing or not a hex colour is skipped (the colour-role check
 * reports it).
 */
export interface VariantColorEntry {
	role: string;
	check: "floor" | "difference" | "apart";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

export type AffixEntry = VariantColorEntry;
export type GooEntry = VariantColorEntry;
export type AuraEntry = VariantColorEntry;

function variantReport(manifest: unknown, rules: VariantColorRules): Array<VariantColorEntry> {
	const out = new Array<VariantColorEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const biomes = isObj(manifest.biomes) ? sortedEntries(manifest.biomes) : [];
	const roleCount = rules.roles.size();
	for (let i = 0; i < roleCount; i++) {
		const role = rules.roles[i];
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
		if (rules.minApart <= 0) {
			continue;
		}
		for (let j = i + 1; j < roleCount; j++) {
			const against = rules.roles[j];
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

/** The affix rings and shield segment (AFFIX_COLOR_RULES); see VariantColorEntry. */
export function affixReport(manifest: unknown): Array<AffixEntry> {
	return variantReport(manifest, AFFIX_COLOR_RULES);
}

/** The goo puddles (GOO_COLOR_RULES); see VariantColorEntry. */
export function gooReport(manifest: unknown): Array<GooEntry> {
	return variantReport(manifest, GOO_COLOR_RULES);
}

/** The Warbanner's aura (AURA_COLOR_RULES); see VariantColorEntry. */
export function auraReport(manifest: unknown): Array<AuraEntry> {
	return variantReport(manifest, AURA_COLOR_RULES);
}

/** A validator message: where (a manifest path) and what. */
export interface VariantColorProblem {
	path: Array<string>;
	msg: string;
}

const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);

/** Why each check matters, per report, worded for the validator's messages. */
const WHY = {
	affix: {
		floor: "an affix ring must read on the floor",
		difference: "an affix colour must never read as an enemy bullet, a telegraph or the enemy outline",
		apart: "each affix colour must read apart from the others",
	},
	goo: {
		floor: "goo must read on the floor",
		difference: "goo must read as danger, never as decor or a boost drop",
		apart: "",
	},
	aura: {
		floor: "a Warbanner's aura must read on the floor",
		difference: "the aura colour must never read as an enemy bullet, a telegraph, a boost drop or an affix",
		apart: "",
	},
	build: {
		floor: "a build effect must read on the floor",
		difference:
			"a build effect must never read as an enemy bullet, a telegraph, goo, the enemy outline or a boost drop",
		apart: "",
	},
	pellet: {
		floor: "a pellet must read on the floor",
		difference:
			"a pellet must never read as an enemy bullet, a telegraph, a boost drop, a build effect or the player's outline",
		apart: "",
	},
} as const;

/**
 * Every failed affix, goo, aura, build effect and pellet check as a validator message (validateManifest adds them to its errors, path
 * `colors.<role>`). `suffix(biome)` is the validator's forge-theme suffix for a biome ID (" (crypt)").
 */
export function variantColorProblems(manifest: unknown, suffix: (biome: string) => string): Array<VariantColorProblem> {
	const out = new Array<VariantColorProblem>();
	const reports = [
		{ entries: affixReport(manifest), why: WHY.affix },
		{ entries: gooReport(manifest), why: WHY.goo },
		{ entries: auraReport(manifest), why: WHY.aura },
		{ entries: buildReport(manifest), why: WHY.build },
		{ entries: pelletReport(manifest), why: WHY.pellet },
	];
	for (const report of reports) {
		for (const c of report.entries) {
			if (c.ok) {
				continue;
			}
			const msg =
				c.check === "floor"
					? `contrast: ${c.role} ${c.color} on ${c.against}${suffix(c.against)} floor ${c.againstColor} is ` +
					  `${fixed2(c.value)}:1, needs >= ${fixed1(c.min)}:1: ${report.why.floor}`
					: `colour difference: ${c.role} ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
							c.value,
					  )} (CIE76), needs >= ${fixed1(c.min)}: ${report.why[c.check]}`;
			out.push({ path: ["colors", c.role], msg });
		}
	}
	return out;
}
