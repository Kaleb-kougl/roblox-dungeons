// Build effect bullets on screen (docs/BUILDS.md BU8): payload kind -> look (burst / shard / bolt, the weapon's bolt
// heavy by scale as before), the trailed looks, the ember decal pool split and the ember decal's pop / fade.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BulletKind, BulletPayload, buildSource, BuildEffect } from "shared/sim";
import { BUILD_BULLET_IDS } from "shared/theme";
import { BUILD_BULLET_VIEW } from "./buildBulletsConfig";
import {
	PLAYER_BULLET_LOOK_IDS,
	PlayerBulletLook,
	emberDecalLook,
	lookHasTrail,
	playerBulletLookOf,
	playerBulletPool,
	type EmberLook,
} from "./buildBullets";
import { BULLET_VIEW } from "./config";

function payloadOf(kind: number, source = 1): number {
	return BulletPayload.with(BulletPayload.with(0, "kind", kind), "source", source);
}

describe("build bullets: looks by kind", () => {
	it("maps every effect kind to its look and visual; any other kind is the weapon's bolt (heavy by scale)", () => {
		const heavy = BULLET_VIEW.heavyScaleThreshold + 0.5;
		const cases: Array<[number, number, number]> = [
			[BulletKind.BURST, 1, PlayerBulletLook.BURST],
			[BulletKind.BURST, heavy, PlayerBulletLook.BURST],
			[BulletKind.SHARD, 1, PlayerBulletLook.SHARD],
			[BulletKind.SPARK_BOLT, 1, PlayerBulletLook.BOLT],
			[BulletKind.EMBER, 1, PlayerBulletLook.EMBER],
			[0, 1, PlayerBulletLook.BASIC],
			[0, heavy, PlayerBulletLook.HEAVY],
		];
		for (const [kind, scale, look] of cases) {
			expect([
				kind,
				scale,
				playerBulletLookOf(payloadOf(kind, buildSource(BuildEffect.VOLATILE, 1)), scale),
			]).toEqual([kind, scale, look]);
		}
		expect([...PLAYER_BULLET_LOOK_IDS]).toEqual([
			BULLET_VIEW.playerVisualId,
			BULLET_VIEW.heavyVisualId,
			"bullet.player.burst",
			"bullet.player.shard",
			"bullet.player.bolt",
			"bullet.player.ember",
		]);
		for (const id of BUILD_BULLET_IDS) expect(PLAYER_BULLET_LOOK_IDS.includes(id)).toBe(true);
	});

	it("only burst and shard bolts trail", () => {
		const trailed: number[] = [];
		for (let i = 0; i < PLAYER_BULLET_LOOK_IDS.size(); i++) if (lookHasTrail(i as never)) trailed.push(i);
		expect(trailed).toEqual([PlayerBulletLook.BURST, PlayerBulletLook.SHARD]);
	});

	it("embers go to the decal pool while it is on, every other bullet to the player pool", () => {
		expect(BUILD_BULLET_VIEW.ember.decal).toBe(true);
		expect(playerBulletPool(payloadOf(BulletKind.EMBER))).toBe("ember");
		expect(playerBulletPool(payloadOf(BulletKind.EMBER), false)).toBe("player");
		expect(playerBulletPool(payloadOf(BulletKind.BURST))).toBe("player");
		expect(playerBulletPool(payloadOf(0))).toBe("player");
	});

	it("an ember decal pops in over popSec and fades out over its last fadeSec", () => {
		const e = BUILD_BULLET_VIEW.ember;
		const total = 1.2;
		const out: EmberLook = { scale: 0, transparency: 0 };
		expect(emberDecalLook(total, total, out).scale).toBe(0);
		expect(emberDecalLook(total - e.popSec / 2, total, out).scale).toBeCloseTo(0.5, 9);
		expect(emberDecalLook(total - e.popSec, total, out).scale).toBe(1);
		expect(emberDecalLook(total / 2, total, out).transparency).toBe(0);
		expect(emberDecalLook(e.fadeSec / 2, total, out).transparency).toBeCloseTo(0.5, 9);
		expect(emberDecalLook(0, total, out).transparency).toBe(1);
	});

	it("the ember decal sits under the goo decal and every marking", () => {
		const e = BUILD_BULLET_VIEW.ember;
		// GOO_VIEW.liftStuds 0.08: the hazard always over the player's own flame.
		expect(e.liftStuds + e.thicknessStuds < 0.08).toBe(true);
	});
});
