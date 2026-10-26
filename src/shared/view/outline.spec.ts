// Enemy outlines (enemy outline plan O2 / O4): who gets the rim (living enemies and bosses with an outline role, while
// the debug switch is on), which group a placeholder body is parented to, how the Workspace switch reads, and when a
// sprite's baked rim label draws.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST } from "shared/theme";
import { ACTOR_OUTLINE, actorGroup, actorOutlined, outlineSwitchOn, spriteOutlineVisible } from "shared/view";

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

describe("spriteOutlineVisible (plan O4)", () => {
	/** Any outline image (only its presence matters; asset IDs live in src/shared/theme). */
	const RIM = "outline-sheet";
	it("draws the rim only while visible, shown and the frame's sheet has an outline", () => {
		expect(spriteOutlineVisible(true, true, RIM)).toBe(true);
		expect(spriteOutlineVisible(false, true, RIM)).toBe(false); // the post-hit blink hides both labels
		expect(spriteOutlineVisible(true, false, RIM)).toBe(false); // dead, or KV_EnemyOutline = false
		expect(spriteOutlineVisible(true, true, undefined)).toBe(false); // that sheet's outline is not uploaded
		expect(spriteOutlineVisible(false, false, undefined)).toBe(false);
	});

	it("follows actorOutlined for the shown flag", () => {
		expect(spriteOutlineVisible(true, actorOutlined(true, true, true), RIM)).toBe(true);
		expect(spriteOutlineVisible(true, actorOutlined(true, false, true), RIM)).toBe(false);
		expect(spriteOutlineVisible(true, actorOutlined(true, true, false), RIM)).toBe(false);
		expect(spriteOutlineVisible(true, actorOutlined(false, true, true), RIM)).toBe(false);
	});

	it("puts the rim label under the frame", () => {
		expect(ACTOR_OUTLINE.spriteZIndex.outline < ACTOR_OUTLINE.spriteZIndex.frame).toBe(true);
		expect(ACTOR_OUTLINE.spriteLabelName).toBe("Outline");
	});
});
