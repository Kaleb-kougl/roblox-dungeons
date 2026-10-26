// Enemy outlines (enemy outline plan O2): who gets the rim (living enemies and bosses with an outline role, while the
// debug switch is on), which group a placeholder body is parented to, and how the Workspace switch reads.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST } from "shared/theme";
import { ACTOR_OUTLINE, actorGroup, actorOutlined, outlineSwitchOn } from "shared/view";

describe("actorOutlined", () => {
	it("outlines a living enemy with an outline role while the switch is on, and nothing else", () => {
		expect(actorOutlined(true, true, true)).toBe(true);
		expect(actorOutlined(true, false, true)).toBe(false); // dead: a corpse drops the rim
		expect(actorOutlined(false, true, true)).toBe(false); // no outline role (the player, a class visual)
		expect(actorOutlined(true, true, false)).toBe(false); // KV_EnemyOutline = false
		expect(actorOutlined(false, false, false)).toBe(false);
	});
});

describe("actorGroup", () => {
	it("keeps living outlined bodies under the Highlight and moves the rest to corpses, whatever the switch", () => {
		expect(actorGroup(true, true)).toBe("enemies");
		expect(actorGroup(true, false)).toBe("corpses");
		expect(actorGroup(false, true)).toBe("corpses");
		expect(actorGroup(false, false)).toBe("corpses");
	});

	it("names three distinct children", () => {
		const g = ACTOR_OUTLINE.groups;
		expect(new Set([g.enemies, g.corpses, g.players]).size()).toBe(3);
	});
});

describe("outlineSwitchOn (KV_EnemyOutline)", () => {
	it("is on when absent or true, off only for false", () => {
		expect(ACTOR_OUTLINE.enabledAttribute).toBe("KV_EnemyOutline");
		expect(outlineSwitchOn(undefined)).toBe(true);
		expect(outlineSwitchOn(true)).toBe(true);
		expect(outlineSwitchOn(false)).toBe(false);
	});
});

describe("ACTOR_OUTLINE", () => {
	it("draws a rim only, in a role the theme fills", () => {
		expect(ACTOR_OUTLINE.role).toBe("enemyOutline");
		expect(PLACEHOLDER_MANIFEST.colors[ACTOR_OUTLINE.role]).toBeDefined();
		expect(ACTOR_OUTLINE.fillTransparency).toBe(1);
		expect(ACTOR_OUTLINE.outlineTransparency).toBe(0);
		expect(ACTOR_OUTLINE.depthMode).toBe("Occluded");
	});
});
