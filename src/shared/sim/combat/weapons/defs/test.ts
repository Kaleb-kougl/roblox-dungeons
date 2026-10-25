/**
 * 'weapon.test' (source: `src/sim/weapons/defs/test.ts`): the E1.6 placeholder gun. FIRE held: a 3-bullet volley
 * down the facing vector every PLAYER_FIRE_TICKS (the first on the press tick). Registered so the weapon index table
 * matches the web build (`weapon.test` = 2).
 */

import { PLAYER_MUZZLE_OFFSET } from "../../combatData";
import { secondsToTicks } from "../../../playerData";
import { BulletKind, type BurstSpec } from "../../patterns";
import { registerWeapon } from "../registry";
import type { WeaponData } from "../types";

/** FIRE held: one volley every PLAYER_FIRE_TICKS (the first on the press tick). */
export const PLAYER_FIRE_SECONDS = 0.15;
export const PLAYER_FIRE_TICKS = secondsToTicks(PLAYER_FIRE_SECONDS); // 9
/** Bullets per volley (odd: one flies exactly down the facing vector). */
export const PLAYER_SHOT_COUNT = 3;
/** Volley spread, radians (whole cone, edge to edge). */
export const PLAYER_SHOT_SPREAD = 0.12;
/** Player bullet speed, world units per second. */
export const PLAYER_BULLET_SPEED = 15;
/** Player bullet lifetime, seconds (range = speed x life = 15 tiles). */
export const PLAYER_BULLET_LIFE = 1;
/** Damage per player bullet, enemy hit points. */
export const PLAYER_BULLET_DAMAGE = 1;

const VOLLEY: BurstSpec = {
	count: PLAYER_SHOT_COUNT,
	spread: PLAYER_SHOT_SPREAD,
	speed: PLAYER_BULLET_SPEED,
	life: PLAYER_BULLET_LIFE,
	damage: PLAYER_BULLET_DAMAGE,
	kind: BulletKind.PLAYER,
};

export const TEST_WEAPON = registerWeapon<WeaponData>({
	id: "weapon.test",
	data: { cooldownTicks: PLAYER_FIRE_TICKS, damage: PLAYER_BULLET_DAMAGE, style: "ranged", spriteId: "item.weapon" },
	fire(ctx, slot) {
		const p = ctx.player;
		ctx.firePlayer(
			slot,
			p.x + p.faceX * PLAYER_MUZZLE_OFFSET,
			p.z + p.faceZ * PLAYER_MUZZLE_OFFSET,
			p.faceX,
			p.faceZ,
			VOLLEY,
		);
		return true;
	},
});
