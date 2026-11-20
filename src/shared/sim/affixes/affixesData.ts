/**
 * Elite affix rules in the sim (docs/ENEMY_VARIANTS.md EV7, decisions EVD6 / EVD8 / EVD9; a Roblox-port feature, no web
 * source). Data only: ./affixes.ts and ./stepAffixes.ts read it. Which spawn gets which affix is decided by the
 * dungeon (shared/dungeon affixes.ts, AFFIXES); the numeric ids are shared/dungeon AffixKind (theme AFFIX_IDS order).
 * Every percent is an integer (scalePercent / scaleTicks / combinedPercent).
 *
 * @module
 */
import { secondsToTicks } from "../playerData";

export interface AffixRules {
	/** Hulking: hp and radius at the stamp (before init), and its walk. */
	readonly hulkingHpPercent: number;
	readonly hulkingRadiusPercent: number;
	readonly hulkingWalkPercent: number;
	/** Swift: walk and attack cooldowns (never a telegraph, lunge, recover or strafe timer: EVD9). */
	readonly swiftWalkPercent: number;
	readonly swiftCooldownPercent: number;
	/** Shielded: a shield of this percent of its hp (at the stamp) absorbs damage first ... */
	readonly shieldHpPercent: number;
	/** ... and refills fully after this many ticks without damage. */
	readonly shieldRefillTicks: number;
	/** Vengeful: the corpse telegraphs this long after the kill, then fires the bruiser's gapped ring. */
	readonly vengefulTelegraphTicks: number;
	/** Rewards (EVD8): an affixed kill's points percent (through scoreKill's bonus percent) ... */
	readonly killPointsPercent: number;
	/** ... and percentage points added to its drop chance. */
	readonly dropChanceBonus: number;
}

/** The game's rules (EVD6 / EVD8). */
export const AFFIX_RULES: AffixRules = table.freeze({
	hulkingHpPercent: 175,
	hulkingRadiusPercent: 120,
	hulkingWalkPercent: 85,
	swiftWalkPercent: 135,
	swiftCooldownPercent: 75,
	shieldHpPercent: 40,
	shieldRefillTicks: secondsToTicks(5), // 300
	vengefulTelegraphTicks: secondsToTicks(0.6), // 36
	killPointsPercent: 150,
	dropChanceBonus: 4,
});

/**
 * Encounter-cost units each affixed PLANNED member adds to its room's par time (EVD8): par += ROOM_PAR_TICKS_PER_COST x
 * this, fixed at floor start from the floor's roomAffixes (score.ts buildDeferredScoreRooms), never at the stamp.
 */
export const AFFIX_PAR_COST = 2;
