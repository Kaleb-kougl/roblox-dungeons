/**
 * Roblox port (docs/PELLETS.md PL6, PD3): the pellet colour rules and `pelletReport`, in their own module like
 * buildColors.ts: validate.ts sits at Luau's 200-locals-per-function limit, so it imports nothing from here;
 * variantColors.ts' `variantColorProblems` (already called by validateManifest) folds this report's failures into its
 * own.
 *
 * Both pellet roles (pellets.ts PELLET_ROLES) are >= 3:1 (WCAG's graphics bar) on every biome floor and >=
 * MIN_DECOR_FX_BULLET_DIFFERENCE (40, CIE76) from every enemy-bullet role, `telegraph`, every boost role, every build
 * effect role and `playerOutline`: a pellet lies on the floor among bullets, boost drops and build effects, under the
 * player, and must read as itself.
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
	against: [...ENEMY_BULLET_ROLES, "telegraph", ...BOOST_ROLES, ...BUILD_EFFECT_ROLES, "playerOutline"],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/** Every check of PELLET_COLOR_RULES on `manifest` (roles in PELLET_ROLES order; see BuildColorEntry). */
export function pelletReport(manifest: unknown): Array<PelletColorEntry> {
	return floorAndDifferenceReport(manifest, PELLET_COLOR_RULES);
}
