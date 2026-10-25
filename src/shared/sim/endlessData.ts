/**
 * Endless mode tunables the sim reads (GDD "Endless mode"): enemy hp and bullet speed scaling by floor and Depth, the
 * stairwell, the debug floor skip. Data plus pure scaling functions; imports nothing from the sim, so actors.ts and
 * ctx.ts can use it without a require cycle. Floor layout numbers live in shared/dungeon endlessData.ts.
 *
 * Every function is plain + - * (no `**`, which compiles to pow): the results replay bit for bit.
 */
import { TILE_SIZE } from "./units";

/** Depth at the start of a run; +1 per Mother Bramble kill. */
export const ENDLESS_FIRST_DEPTH = 1;

/** Enemy hp at spawn x (1 + ENEMY_HP_PER_FLOOR x (floor - 1)). */
export const ENEMY_HP_PER_FLOOR = 0.08;
/** Enemy (and boss) hp at spawn x DEPTH_HP_MULTIPLIER^(depth - 1). */
export const DEPTH_HP_MULTIPLIER = 1.5;
/** Enemy bullet speed x min(1 + BULLET_SPEED_PER_FLOOR x (floor - 1), BULLET_SPEED_MAX_MULTIPLIER). Speed only. */
export const BULLET_SPEED_PER_FLOOR = 0.02;
export const BULLET_SPEED_MAX_MULTIPLIER = 1.4;

/** The stairwell zone: the player's center within this distance of the stairwell's center ends the floor. */
export const STAIRWELL_RADIUS = TILE_SIZE;

/**
 * A room's deferred enemies never spawn closer than this to a living player (center to center). A spawn that would is
 * moved to the nearest free candidate tile of the room at least this far from every living player; a room too small
 * for that uses the free tile farthest from the players. 4 tiles is beyond the swarmer's lunge trigger (2.8) and the
 * bruiser's slam trigger (2.6), so nothing can hit the player on the tick it enters a room.
 */
export const SPAWN_SAFE_RADIUS = 4 * TILE_SIZE;

/**
 * Debug input bit (N, debug builds only): the floor ends at once, as if the player stepped into the stairwell (a boss
 * floor is skipped WITHOUT the boss kill, so Depth stays). A Roblox-port extension of the web build's button table:
 * it is not in Button / ALL_BUTTONS (fixtures/input.json pins those), see input.ts SIM_BUTTONS.
 */
export const DEBUG_FLOOR_BUTTON = 8192;

/** 1 + 0.08 (floor - 1). */
export function floorHpMultiplier(floor: number): number {
	return 1 + ENEMY_HP_PER_FLOOR * (floor - 1);
}

/** 1.5^(depth - 1), by repeated multiplication (1 for depth <= 1). */
export function depthHpMultiplier(depth: number): number {
	let m = 1;
	for (let d = ENDLESS_FIRST_DEPTH; d < depth; d++) m *= DEPTH_HP_MULTIPLIER;
	return m;
}

/** Spawn hp: base x floor multiplier x depth multiplier (left to right); bosses scale by Depth only. */
export function endlessActorHp(baseHp: number, isBoss: boolean, floor: number, depth: number): number {
	if (isBoss) return baseHp * depthHpMultiplier(depth);
	return baseHp * floorHpMultiplier(floor) * depthHpMultiplier(depth);
}

/** min(1 + 0.02 (floor - 1), 1.4). */
export function enemyBulletSpeedMultiplier(floor: number): number {
	return scaledEnemyBulletSpeedMultiplier(floor, 1);
}

/**
 * min((1 + 0.02 (floor - 1)) x extra, 1.4). `extra` is the M2 Haste curse's multiplier (1 without it: the product is
 * skipped, so the value is exactly the floor scaling's).
 */
export function scaledEnemyBulletSpeedMultiplier(floor: number, extra: number): number {
	const base = 1 + BULLET_SPEED_PER_FLOOR * (floor - 1);
	const m = extra === 1 ? base : base * extra;
	return m < BULLET_SPEED_MAX_MULTIPLIER ? m : BULLET_SPEED_MAX_MULTIPLIER;
}
