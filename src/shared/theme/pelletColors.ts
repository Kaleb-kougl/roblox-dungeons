/**
 * Roblox port (docs/PELLETS.md PL6, PD3): the pellet colour rules and `pelletReport`, in their own module like
 * buildColors.ts: validate.ts sits at Luau's 200-locals-per-function limit, so it imports nothing from here;
 * variantColors.ts' `variantColorProblems` (already called by validateManifest) folds this report's failures into its
 * own.
 *
 * Both pellet roles (pellets.ts PELLET_ROLES) are >= 3:1 (WCAG's graphics bar) on every biome floor, >=
 * MIN_DECOR_FX_BULLET_DIFFERENCE (40, CIE76) from every enemy-bullet role, `telegraph`, every build effect role and
 * `playerOutline`, and >= MIN_PELLET_BOOST_DIFFERENCE (30) from every boost role: a pellet lies on the floor among
 * bullets, boost drops and build effects, under the player, and must read as itself. The boost bar is lower on purpose
 * (owner, 2026-11-03: Pac-Man yellow pellets): a boost is a coin or gem with a halo and a beam, a pellet a small cube, so
 * shape tells them apart, and taking one for the other costs nothing (both are walked over). Danger keeps the full 40.
 *
 * @module
 */

import { BOOST_ROLES, ENEMY_BULLET_ROLES, MIN_DECOR_FX_BULLET_DIFFERENCE } from "./contract";
import { BUILD_EFFECT_ROLES } from "./builds";
import { floorAndDifferenceReport, type BuildColorEntry, type BuildColorRules } from "./buildColors";
import { PELLET_ROLES } from "./pellets";

/** What pelletReport checks against what, and the bars (buildReport's shape). */
export type PelletColorRules = BuildColorRules;

/** One check of pelletReport (buildReport's entry: check "floor" or "difference"). */
export type PelletColorEntry = BuildColorEntry;

/** The pellet colour rules (docs/PELLETS.md PL6). */
export const PELLET_COLOR_RULES: PelletColorRules = {
	roles: PELLET_ROLES,
	minFloorContrast: 3.0,
	against: [...ENEMY_BULLET_ROLES, "telegraph", ...BUILD_EFFECT_ROLES, "playerOutline"],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/** Minimum CIE76 difference of every pellet role from every boost role (see the file comment). */
export const MIN_PELLET_BOOST_DIFFERENCE = 30;

/** The pellets against the boosts: difference checks only (the floor checks are PELLET_COLOR_RULES'). */
export const PELLET_BOOST_COLOR_RULES: PelletColorRules = {
	roles: PELLET_ROLES,
	minFloorContrast: 3.0,
	against: BOOST_ROLES,
	minDifference: MIN_PELLET_BOOST_DIFFERENCE,
};

/**
 * Every check of PELLET_COLOR_RULES on `manifest`, then the difference checks of PELLET_BOOST_COLOR_RULES (roles in
 * PELLET_ROLES order within each; see BuildColorEntry).
 */
export function pelletReport(manifest: unknown): Array<PelletColorEntry> {
	const out = floorAndDifferenceReport(manifest, PELLET_COLOR_RULES);
	for (const e of floorAndDifferenceReport(manifest, PELLET_BOOST_COLOR_RULES))
		if (e.check === "difference") out.push(e);
	return out;
}
