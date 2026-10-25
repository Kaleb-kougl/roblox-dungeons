// M4 co-op presentation: teammates' bullets draw at 40 % opacity in parties of 5+ (own bullets and small parties
// stay opaque); ownership is the bullet's emitter id (player i fires with emitter i + 1).
import { describe, expect, it } from "@rbxts/jest-globals";
import { LARGE_PARTY_MIN_SIZE, TEAMMATE_BULLET_OPACITY, playerBulletTransparency } from "shared/view";

describe("playerBulletTransparency", () => {
	it("fades only a teammate's bullets, only in large parties", () => {
		expect(LARGE_PARTY_MIN_SIZE).toBe(5);
		expect(TEAMMATE_BULLET_OPACITY).toBe(0.4);
		for (const n of [1, 2, 3, 4]) expect(playerBulletTransparency(n, 2, 0)).toBe(0);
		for (const n of [5, 8]) {
			expect(playerBulletTransparency(n, 1, 0)).toBe(0); // emitter 1 = player 0 = me
			expect(playerBulletTransparency(n, 2, 0)).toBeCloseTo(0.6);
			expect(playerBulletTransparency(n, 4, 3)).toBe(0);
			expect(playerBulletTransparency(n, 1, 3)).toBeCloseTo(0.6);
		}
	});
});
