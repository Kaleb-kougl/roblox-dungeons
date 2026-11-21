/**
 * Roblox port (docs/FORTUNE.md FO6): Fortune's colour rules and `fortuneReport`, in their own module like
 * pelletColors.ts: validate.ts sits at Luau's 200-locals-per-function limit, so it imports nothing from here;
 * variantColors.ts' `variantColorProblems` (already called by validateManifest) folds this report's failures into its
 * own.
 *
 *   - FORTUNE_COLOR_RULES: every Fortune role (fortune.ts FORTUNE_ROLES: the Horde room's edge, the two pacts, the
 *     Goldling's coins) is >= 3:1 (WCAG's graphics bar) on every biome floor and >= MIN_DECOR_FX_BULLET_DIFFERENCE (40,
 *     CIE76) from every enemy-bullet role and `telegraph`: edges, altar cards, shouts, pops and coins lie on the floor
 *     among bullets and warnings, and must read as themselves.
 *   - FORTUNE_COIN_PELLET_RULES: the coins are >= MIN_GOLDEN_COIN_PELLET_DIFFERENCE (30) from `pellet.normal`: a burst
 *     of coins spills over a fight's pellets and must never read as more pellets (the pellets' own bar against the
 *     boosts, pelletColors.ts: both are walked over or fly off, so shape and motion carry the rest).
 *   - GOLDEN_ENEMY_COLOR_RULES: `enemy.golden` (the Goldling's body and placeholder block) keeps the distance every
 *     other enemy colour keeps by hand (>= 40 CIE76 from the enemy bullet, its outline, the telegraph and the enemy
 *     outline red; the closest today is enemy.charger vs enemyBulletOutline, 41.6): a harmless runner must never read
 *     as a threat cue. Gold sits next to the telegraph orange, so this one is checked. No floor check (enemy colours
 *     have none: the actor outline carries them).
 *
 * @module
 */

import { ENEMY_BULLET_ROLES, MIN_DECOR_FX_BULLET_DIFFERENCE } from "./contract";
import { floorAndDifferenceReport, type BuildColorEntry, type BuildColorRules } from "./buildColors";
import { FORTUNE_ROLES, GOLDEN_COIN_ROLE } from "./fortune";

/** What fortuneReport checks against what, and the bars (buildReport's shape). */
export type FortuneColorRules = BuildColorRules;

/** One check of fortuneReport (buildReport's entry: check "floor" or "difference"). */
export type FortuneColorEntry = BuildColorEntry;

/** Fortune's colour rules (docs/FORTUNE.md FO6): floors and danger. */
export const FORTUNE_COLOR_RULES: FortuneColorRules = {
	roles: FORTUNE_ROLES,
	minFloorContrast: 3.0,
	against: [...ENEMY_BULLET_ROLES, "telegraph"],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/** Minimum CIE76 difference of `golden.coin` from `pellet.normal` (see the file comment). */
export const MIN_GOLDEN_COIN_PELLET_DIFFERENCE = 30;

/** The coins against the pellets: difference checks only (the floor checks are FORTUNE_COLOR_RULES'). */
export const FORTUNE_COIN_PELLET_RULES: FortuneColorRules = {
	roles: [GOLDEN_COIN_ROLE],
	minFloorContrast: 3.0,
	against: ["pellet.normal"],
	minDifference: MIN_GOLDEN_COIN_PELLET_DIFFERENCE,
};

/** The Goldling's body against the threat cues: difference checks only (see the file comment). */
export const GOLDEN_ENEMY_COLOR_RULES: FortuneColorRules = {
	roles: ["enemy.golden"],
	minFloorContrast: 3.0,
	against: [...ENEMY_BULLET_ROLES, "telegraph", "enemyOutline"],
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/**
 * Every check of FORTUNE_COLOR_RULES on `manifest` (roles in FORTUNE_ROLES order, floors then differences), then the
 * difference checks of FORTUNE_COIN_PELLET_RULES and GOLDEN_ENEMY_COLOR_RULES (see BuildColorEntry).
 */
export function fortuneReport(manifest: unknown): Array<FortuneColorEntry> {
	const out = floorAndDifferenceReport(manifest, FORTUNE_COLOR_RULES);
	for (const rules of [FORTUNE_COIN_PELLET_RULES, GOLDEN_ENEMY_COLOR_RULES])
		for (const e of floorAndDifferenceReport(manifest, rules)) if (e.check === "difference") out.push(e);
	return out;
}
