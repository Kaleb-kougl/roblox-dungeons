// Sprite bullets (docs/PROJECTILE_ART.md PA4): every BulletKind maps to one of the four enemy looks; each look's art
// reference scale (the heavy flame stands for the bow's heavy arrow).
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOW_DATA, BulletKind, BulletPayload } from "shared/sim";
import { PLAYER_BULLET_LOOK_IDS, PlayerBulletLook, playerBulletLookOf } from "../buildBullets";
import { BULLET_IDS } from "shared/theme";
import { BULLET_VIEW } from "../config";
import { ENEMY_BULLET_LOOK_IDS, EnemyBulletLook, bulletArtReferenceScale, enemyBulletLookOf } from "./looks";

function payloadOf(kind: number): number {
	return BulletPayload.with(BulletPayload.with(0, "kind", kind), "source", 1);
}

/** The expected look of every BulletKind (a new kind fails the coverage check below until it has a row). */
const EXPECTED: ReadonlyMap<number, number> = new Map([
	[BulletKind.PLAYER, EnemyBulletLook.SMALL],
	[BulletKind.SPRAYER, EnemyBulletLook.SMALL],
	[BulletKind.SNIPER, EnemyBulletLook.NEEDLE],
	[BulletKind.CASTER, EnemyBulletLook.MEDIUM],
	[BulletKind.STRESS, EnemyBulletLook.SMALL],
	[BulletKind.ENEMY, EnemyBulletLook.SMALL],
	[BulletKind.BOSS, EnemyBulletLook.LARGE],
	// Goo and strikes go to their decal pools (the enemy pools skip them); with a decal off they draw small.
	[BulletKind.GOO, EnemyBulletLook.SMALL],
	[BulletKind.BURST, EnemyBulletLook.SMALL],
	[BulletKind.SHARD, EnemyBulletLook.SMALL],
	[BulletKind.EMBER, EnemyBulletLook.SMALL],
	[BulletKind.SPARK_BOLT, EnemyBulletLook.SMALL],
	[BulletKind.STRIKE, EnemyBulletLook.SMALL],
	// docs/NEW_ENEMIES_2.md NX1: the Chainhook's hook draws small until NX7 gives it its look
	[BulletKind.HOOK, EnemyBulletLook.SMALL],
]);

describe("sprite bullets: enemy looks", () => {
	it("maps every BulletKind value: sniper needle, caster medium, boss large, every other kind small", () => {
		const kinds = BulletKind as unknown as ReadonlyMap<string, number>;
		let count = 0;
		for (const [name, kind] of kinds) {
			count += 1;
			const want = EXPECTED.get(kind);
			expect([name, want === undefined]).toEqual([name, false]);
			expect([name, enemyBulletLookOf(payloadOf(kind))]).toEqual([name, want]);
		}
		expect(count).toBe(EXPECTED.size());
	});

	it("free kinds (14..15) are small", () => {
		for (const kind of [14, 15]) expect(enemyBulletLookOf(payloadOf(kind))).toBe(EnemyBulletLook.SMALL);
	});

	it("names the four enemy theme IDs; look 0 is the visual every enemy bullet used before", () => {
		expect([...ENEMY_BULLET_LOOK_IDS]).toEqual([
			"bullet.enemy.small",
			"bullet.enemy.medium",
			"bullet.enemy.large",
			"bullet.enemy.needle",
		]);
		expect(ENEMY_BULLET_LOOK_IDS[EnemyBulletLook.SMALL]).toBe(BULLET_VIEW.enemyVisualId);
		const contract = BULLET_IDS as ReadonlyArray<string>;
		for (const id of ENEMY_BULLET_LOOK_IDS) expect([id, contract.includes(id)]).toEqual([id, true]);
	});
});

describe("sprite bullets: art reference scale", () => {
	it("the heavy look stands for the bow's heavy arrow; every other look for scale 1", () => {
		expect(BOW_DATA.heavyScale > BULLET_VIEW.heavyScaleThreshold).toBe(true);
		expect(bulletArtReferenceScale("player", PlayerBulletLook.HEAVY)).toBe(BOW_DATA.heavyScale);
		for (let look = 0; look < PLAYER_BULLET_LOOK_IDS.size(); look++) {
			if (look === PlayerBulletLook.HEAVY) continue;
			expect([look, bulletArtReferenceScale("player", look)]).toEqual([look, 1]);
		}
		for (let look = 0; look < ENEMY_BULLET_LOOK_IDS.size(); look++) {
			expect([look, bulletArtReferenceScale("enemy", look)]).toEqual([look, 1]);
		}
	});

	it("a heavy arrow (the bow's heavy scale) draws the flame at the art's own size", () => {
		const payload = BulletPayload.with(0, "kind", BulletKind.PLAYER);
		const look = playerBulletLookOf(payload, BOW_DATA.heavyScale);
		expect(look).toBe(PlayerBulletLook.HEAVY);
		expect(BOW_DATA.heavyScale / bulletArtReferenceScale("player", look)).toBe(1);
		expect(bulletArtReferenceScale("player", playerBulletLookOf(payload, 1))).toBe(1);
	});
});
