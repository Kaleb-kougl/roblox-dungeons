/**
 * Public API of the weapon system (E1.8; source: `src/sim/weapons/index.ts`).
 *
 * @module
 */
export { NO_WEAPON, WEAPON_SCRATCH_SLOTS, WEAPON_SETS } from "./types";
export type { WeaponData, WeaponDef, WeaponSlotState, WeaponStyle, WeaponTrigger, WeaponsState } from "./types";
export { hasWeapon, registerWeapon, weaponAt, weaponIds, weaponIndex } from "./registry";
export { sweepArc, sweepGooErased } from "./melee";
export type { ArcActorHit } from "./melee";
export { activeWeaponSlot, weaponMoveMultiplier, weaponSpacingActive } from "./weapons";
export { BOW_WEAPON_ID, DEFAULT_LOADOUT, SWORD_WEAPON_ID } from "./loadout";
export {
	BOW,
	BOW_DATA,
	BOW_HEAVY_DAMAGE,
	BOW_V_CHARGE,
	BOW_V_HEAVY_TICK,
	BOW_V_SHOT,
	BOW_WOBBLE_COS,
	BOW_WOBBLE_SIN,
	WEB_BOW_TUNING,
	bowAssistAim,
	bowCharge,
	bowChargeTicks,
	setBowTuning,
} from "./defs/bow";
export type { BowData, BowTuning } from "./defs/bow";
export {
	SWORD,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_GUARD,
	SWORD_V_LAST,
	SWORD_V_STEP,
	SWORD_V_WINDOW,
	SWORD_REACH_PERCENT,
	SWORD_TEMPO_PERCENT,
	WEB_SWORD_TIMINGS,
	setSwordTimings,
	swordGuard,
	swordGuardHalfAngleCos,
	swordGuardRing,
	swordGuardSweepCos,
	swordGuardTicks,
} from "./defs/sword";
export type { SwordData, SwordTimings } from "./defs/sword";
export {
	PLAYER_BULLET_DAMAGE,
	PLAYER_BULLET_LIFE,
	PLAYER_BULLET_SPEED,
	PLAYER_FIRE_SECONDS,
	PLAYER_FIRE_TICKS,
	PLAYER_SHOT_COUNT,
	PLAYER_SHOT_SPREAD,
	TEST_WEAPON,
} from "./defs/test";
export { TEST_MELEE_DATA, TEST_MELEE_WEAPON } from "./defs/testMelee";
