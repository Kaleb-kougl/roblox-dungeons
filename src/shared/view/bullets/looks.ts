import { BOW_DATA, BulletKind, BulletPayload, NO_KIND, PYRE, archetypeIndex } from "shared/sim";
import { PlayerBulletLook } from "../buildBullets";

/** An enemy bullet's look (index into ENEMY_BULLET_LOOK_IDS). */
export const EnemyBulletLook = {
	SMALL: 0,
	MEDIUM: 1,
	LARGE: 2,
	NEEDLE: 3,
	/** docs/NEW_ENEMIES_2.md NXD12: a brazier's fireball. */
	FLAME: 4,
	/** The Chainhook's thrown hook (BulletKind.HOOK). */
	HOOK: 5,
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
	"bullet.enemy.flame",
	"bullet.enemy.hook",
];

/** The pyre's payload `source` (its archetype index + 1, stamped by ctx.fireEnemy), resolved once; -1: not registered. */
let pyreSource: number | undefined;
function pyreSourceOf(): number {
	if (pyreSource === undefined) {
		const [ok, index] = pcall(() => archetypeIndex(PYRE.id));
		pyreSource = ok && index !== NO_KIND ? (index as number) + 1 : -1;
	}
	return pyreSource;
}

/**
 * The look of an enemy bullet with `payload`, by its BulletKind: SNIPER the needle, CASTER the medium, BOSS the large,
 * HOOK the hook (docs/NEW_ENEMIES_2.md NX7); a plain ENEMY bullet whose `source` is the pyre's (its archetype index + 1:
 * docs/NEW_ENEMIES_2.md NX0 correction 5, NXD12) the flame; everything else (SPRAYER, ENEMY, STRESS, any kind without a
 * look) the small. Goo and strikes never reach it while their decal pools draw them (the enemy pools skip them); with
 * a decal off they are small like any other bullet.
 */
export function enemyBulletLookOf(payload: number): EnemyBulletLookId {
	const kind = BulletPayload.get(payload, "kind");
	if (kind === BulletKind.SNIPER) return EnemyBulletLook.NEEDLE;
	if (kind === BulletKind.CASTER) return EnemyBulletLook.MEDIUM;
	if (kind === BulletKind.BOSS) return EnemyBulletLook.LARGE;
	if (kind === BulletKind.HOOK) return EnemyBulletLook.HOOK;
	if (kind === BulletKind.ENEMY && BulletPayload.get(payload, "source") === pyreSourceOf())
		return EnemyBulletLook.FLAME;
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
