/**
 * 'weapon.test.melee' (source: `src/sim/weapons/defs/testMelee.ts`): a placeholder melee swing that exercises
 * sweepArc. FIRE held: a 120-degree swing in front of the player every 0.4 s that hits every enemy in the arc and
 * deletes the enemy bullets inside it.
 *
 * @module
 */

import { secondsToTicks } from "../../../playerData";
import { sweepArc, type ArcActorHit } from "../melee";
import { registerWeapon } from "../registry";
import type { WeaponData } from "../types";

export interface TestMeleeData extends WeaponData {
	/** Reach from the player's center, world units. */
	reach: number;
	/** Cosine of the half-angle (0.5 = 60 degrees each side). */
	halfAngleCos: number;
}

export const TEST_MELEE_DATA: TestMeleeData = {
	cooldownTicks: secondsToTicks(0.4), // 24
	damage: 3,
	style: "melee",
	spriteId: "item.weapon",
	reach: 1.6,
	halfAngleCos: 0.5,
};

const hit: ArcActorHit = (ctx, actor) => {
	ctx.damageActor(actor, TEST_MELEE_DATA.damage);
};

export const TEST_MELEE_WEAPON = registerWeapon<TestMeleeData>({
	id: "weapon.test.melee",
	data: TEST_MELEE_DATA,
	fire(ctx) {
		const p = ctx.player;
		sweepArc(ctx, p.x, p.z, p.faceX, p.faceZ, TEST_MELEE_DATA.reach, TEST_MELEE_DATA.halfAngleCos, hit, true);
		return true;
	},
});
