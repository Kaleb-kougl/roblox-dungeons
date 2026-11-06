import { BOW_DATA, BulletKind, BulletPayload } from "shared/sim";
import { PlayerBulletLook } from "../buildBullets";

/** An enemy bullet's look (index into ENEMY_BULLET_LOOK_IDS). */
export const EnemyBulletLook = {
	SMALL: 0,
	MEDIUM: 1,
	LARGE: 2,
	NEEDLE: 3,
} as const;
export type EnemyBulletLookId = (typeof EnemyBulletLook)[keyof typeof EnemyBulletLook];

/**
 * The theme ID of each enemy look (EnemyBulletLook order; docs/PROJECTILE_ART.md "The mapping"). Look 0 is
 * BULLET_VIEW.enemyVisualId, the one every enemy bullet was drawn with before.
 */
export const ENEMY_BULLET_LOOK_IDS: ReadonlyArray<string> = [
	"bullet.enemy.small",
	"bullet.enemy.medium",
	"bullet.enemy.large",
	"bullet.enemy.needle",
];

/**
 * The look of an enemy bullet with `payload`, by its BulletKind: SNIPER the needle, CASTER the medium, BOSS the large,
 * everything else (SPRAYER, ENEMY, STRESS, any kind without a look) the small. Goo and strikes never reach it while
 * their decal pools draw them (the enemy pools skip them); with a decal off they are small like any other bullet.
 */
export function enemyBulletLookOf(payload: number): EnemyBulletLookId {
	const kind = BulletPayload.get(payload, "kind");
	if (kind === BulletKind.SNIPER) return EnemyBulletLook.NEEDLE;
	if (kind === BulletKind.CASTER) return EnemyBulletLook.MEDIUM;
	if (kind === BulletKind.BOSS) return EnemyBulletLook.LARGE;
	return EnemyBulletLook.SMALL;
}

/**
 * The draw scale a look's sprite art stands for (docs/PROJECTILE_ART.md "The mapping"): the art already carries its
 * size, so a sprite draws at its own size x (the bullet's draw scale / this). The player heavy (the Hyper flame,
 * already larger than the bolt) stands for the bow's charged arrow, BOW_DATA.heavyScale: a heavy arrow draws the flame
 * at its own size, not scaled by the arrow's sim scale again. Every other look (each enemy look, every other player
 * look): 1.
 */
export function bulletArtReferenceScale(pool: "player" | "enemy", look: number): number {
	return pool === "player" && look === PlayerBulletLook.HEAVY ? BOW_DATA.heavyScale : 1;
}
