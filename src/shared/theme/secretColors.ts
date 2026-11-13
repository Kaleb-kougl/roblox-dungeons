/**
 * Roblox port (docs/SECRET_ROOMS.md SR10): the secret rooms' colour rule and `secretReport`, in their own module like
 * fortuneColors.ts: validate.ts sits at Luau's 200-locals-per-function limit, so it imports nothing from here;
 * variantColors.ts' `variantColorProblems` (already called by validateManifest) folds this report's failures into its
 * own.
 *
 *   - SECRET_COLOR_RULES: `secret.dust` (secrets.ts SECRET_ROLES: the trickle from the crack, the knock's puff, the
 *     burst's dust) is >= MIN_DECOR_FX_BULLET_DIFFERENCE (40, CIE76) from every enemy-bullet role and `telegraph`, the
 *     `decor.fx.*` bar plus the telegraph: dust falls on the floor among bullets and warnings and must read as dust.
 *     Difference checks only, like the decor fx roles: the dust is meant to be subtle (SRD4), so no floor contrast bar.
 */

import { ENEMY_BULLET_ROLES, MIN_DECOR_FX_BULLET_DIFFERENCE } from "./contract";
import { floorAndDifferenceReport, type BuildColorEntry, type BuildColorRules } from "./buildColors";
import { SECRET_ROLES } from "./secrets";

/** What secretReport checks against what, and the bars (buildReport's shape; the floor bar is unused). */
export type SecretColorRules = BuildColorRules;

/** One check of secretReport (buildReport's entry: check "difference" only). */
export type SecretColorEntry = BuildColorEntry;

/** The secret rooms' colour rule (docs/SECRET_ROOMS.md Design 10): the dust apart from danger. */
export const SECRET_COLOR_RULES: SecretColorRules = {
	roles: SECRET_ROLES,
	minFloorContrast: 0,
	against: [...ENEMY_BULLET_ROLES, "telegraph"],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/** Every difference check of SECRET_COLOR_RULES on `manifest`, roles in SECRET_ROLES order (see BuildColorEntry). */
export function secretReport(manifest: unknown): Array<SecretColorEntry> {
	const out = new Array<SecretColorEntry>();
	for (const e of floorAndDifferenceReport(manifest, SECRET_COLOR_RULES)) if (e.check === "difference") out.push(e);
	return out;
}
