// The sprite contract must port UNCHANGED (art made for the web build fits here). These values are
// copied from project-kaleb-vale src/theme/contract.ts @ 42897e2; a change here is a contract break.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AUDIO_EVENTS,
	BIOMES,
	BOSS,
	BOSS_OPTIONAL_ANIMATIONS,
	CLASS_OPTIONAL_ANIMATIONS,
	ENDLESS_BOSS_IDS,
	BULLET,
	CHARACTER,
	DIGIT_FONT,
	ENEMY,
	FACINGS,
	GAMEPLAY_KEY_WORDS,
	ITEM,
	MIN_DAMAGE_NUMBER_CONTRAST,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_HEALTH_BAR_CONTRAST,
	MAX_IMAGE_SIDE,
	MUSIC,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	SFX,
	SLOTS,
	SPRITE_FACING_COUNTS,
	SPRITE_RESAMPLE_MODES,
	TILE,
	UI,
	optionalBaseAnimations,
	requiredAnimationList,
	requiredAnimations,
	requiredBaseAnimations,
	slotFor,
} from "./contract";
import { sortedKeys } from "./util";

describe("sprite contract", () => {
	it("keeps the web build's cells, pivots, frame counts and facings", () => {
		expect(FACINGS).toEqual(["down", "up", "left", "right"]);
		expect([CHARACTER.cell, CHARACTER.pivot, CHARACTER.animations, CHARACTER.facings]).toEqual([
			{ w: 16, h: 24 },
			{ x: 8, y: 23 },
			{ idle: 4, run: 6, roll: 4, hit: 2, death: 6 },
			FACINGS,
		]);
		expect([ENEMY.cell, ENEMY.pivot, ENEMY.animations, ENEMY.facings]).toEqual([
			{ w: 16, h: 16 },
			{ x: 8, y: 15 },
			{ idle: 4, move: 4, attack: 4, hit: 2, death: 4 },
			FACINGS,
		]);
		expect([BOSS.cell, BOSS.pivot, BOSS.animations, BOSS.facings]).toEqual([
			{ w: 48, h: 48 },
			{ x: 24, y: 47 },
			{ idle: 4, move: 4, attack: 6, hit: 2, death: 8 },
			[],
		]);
		expect([BULLET.cell, BULLET.pivot, BULLET.animations]).toEqual([{ w: 8, h: 8 }, { x: 4, y: 4 }, { fly: 2 }]);
		expect([TILE.cell, ITEM.cell, UI.cell]).toEqual([{ w: 16, h: 16 }, { w: 16, h: 16 }, undefined]);
	});

	it("lists every contract animation in the order map", () => {
		for (const slot of SLOTS) {
			const order = slot.animationOrder ?? [];
			const names = new Set<string>();
			for (const name of sortedKeys(slot.animations ?? {})) {
				names.add(name);
			}
			expect([slot.slot, order.size()]).toEqual([slot.slot, names.size()]);
			for (const n of order) {
				expect([slot.slot, names.has(n)]).toEqual([slot.slot, true]);
			}
		}
	});

	it("requires <anim>.<facing> for directional slots, in contract order", () => {
		const list = requiredAnimationList(CHARACTER);
		expect(list.size()).toBe(20);
		expect(list.map((a) => a.name).filter((_, i) => i < 5)).toEqual([
			"idle.down",
			"idle.up",
			"idle.left",
			"idle.right",
			"run.down",
		]);
		expect(requiredAnimations(CHARACTER)["roll.left"]).toBe(4);
		expect(requiredAnimations(BOSS)).toEqual({ idle: 4, move: 4, attack: 6, hit: 2, death: 8 });
		expect(requiredAnimations(TILE)).toEqual({});
	});

	it("routes IDs to slots by prefix, and audio to SoundGroups", () => {
		expect(slotFor("class.ranger")).toBe(CHARACTER);
		expect(slotFor("bullet.enemy.wave")).toBe(BULLET);
		expect(slotFor("ui.font.digits")).toBe(UI);
		expect(slotFor("weapon.sword")).toBeUndefined();
		expect(SFX.soundGroup).toBe("sfx");
		expect(MUSIC.soundGroup).toBe("music");
		expect(slotFor("music.boss")?.soundGroup).toBe("music");
	});

	it("accepts placeholders for visuals and silence for audio", () => {
		expect(CHARACTER.kinds).toEqual(["spritesheet", "sprites", "placeholder"]);
		expect(BULLET.kinds).toEqual(["spritesheet", "placeholder"]);
		expect(TILE.kinds).toEqual(["image", "placeholder"]);
		expect(SFX.kinds).toEqual(["sound", "silent"]);
	});

	it("v2: actor slots also accept sprite sets, requiring only the base animation names", () => {
		expect([CHARACTER.kinds, ENEMY.kinds, BOSS.kinds]).toEqual([
			["spritesheet", "sprites", "placeholder"],
			["spritesheet", "sprites", "placeholder"],
			["spritesheet", "sprites", "placeholder"],
		]);
		for (const slot of [BULLET, TILE, ITEM, UI, SFX, MUSIC]) {
			expect([slot.slot, slot.kinds.includes("sprites")]).toEqual([slot.slot, false]);
		}
		expect(requiredBaseAnimations(CHARACTER)).toEqual(["idle", "run", "roll", "hit", "death"]);
		expect(requiredBaseAnimations(ENEMY)).toEqual(["idle", "move", "attack", "hit", "death"]);
		expect(requiredBaseAnimations(BOSS)).toEqual(["idle", "move", "attack", "hit", "death"]);
		expect(requiredBaseAnimations(TILE)).toEqual([]);
		// A copy: callers may not edit the contract through it.
		requiredBaseAnimations(CHARACTER).push("dance");
		expect(CHARACTER.animationOrder).toEqual(["idle", "run", "roll", "hit", "death"]);
		expect(MAX_IMAGE_SIDE).toBe(1024);
		expect(SPRITE_FACING_COUNTS).toEqual([1, 4, 8, 16]);
		expect(SPRITE_RESAMPLE_MODES).toEqual(["Default", "Pixelated"]);
	});

	it("v2: per-sheet cells (docs/DEMON_ART.md DD4) are accepted in the actor slots only", () => {
		const accepting = SLOTS.filter((slot) => slot.perSheetCells === true).map((slot) => slot.slot);
		expect(accepting).toEqual(["class", "enemy", "boss"]);
		for (const slot of SLOTS) {
			if (slot.perSheetCells === true) {
				expect([slot.slot, slot.kinds.includes("sprites")]).toEqual([slot.slot, true]);
			}
		}
	});

	it("v2: names the optional sprite-set animations: class attack.1..3; enemy attack.2 (ENEMY_VARIANTS EV10); boss attack.2..4 / intro / taunt (BRAMBLE_ART BR2, BOSS_DEMONLORD D2)", () => {
		expect(optionalBaseAnimations(CHARACTER)).toEqual(["attack.1", "attack.2", "attack.3"]);
		expect(optionalBaseAnimations(ENEMY)).toEqual(["attack.2"]);
		expect(optionalBaseAnimations(BOSS)).toEqual(["attack.2", "attack.3", "attack.4", "intro", "taunt"]);
		expect([CHARACTER.optionalAnimations, ENEMY.optionalAnimations, BOSS.optionalAnimations]).toEqual([
			CLASS_OPTIONAL_ANIMATIONS,
			["attack.2"],
			BOSS_OPTIONAL_ANIMATIONS,
		]);
		for (const slot of SLOTS) {
			const required = requiredBaseAnimations(slot);
			for (const name of optionalBaseAnimations(slot)) {
				// optional means never required (the boss's required five are the web build's, unchanged)
				expect([slot.slot, name, required.includes(name)]).toEqual([slot.slot, name, false]);
			}
			if (slot !== CHARACTER && slot !== ENEMY && slot !== BOSS) {
				expect([slot.slot, optionalBaseAnimations(slot)]).toEqual([slot.slot, []]);
			}
		}
		// A copy: callers may not edit the contract through it.
		optionalBaseAnimations(BOSS).push("dance");
		expect(BOSS.optionalAnimations).toEqual(["attack.2", "attack.3", "attack.4", "intro", "taunt"]);
	});

	it("keeps the digit font layout consistent", () => {
		expect(DIGIT_FONT.cellW).toBe(DIGIT_FONT.glyphW + 2 * DIGIT_FONT.pad);
		expect(DIGIT_FONT.cellH).toBe(DIGIT_FONT.glyphH + 2 * DIGIT_FONT.pad);
		expect(DIGIT_FONT.glyphs.size() * DIGIT_FONT.cellW).toBe(80);
	});
});

describe("required IDs and strings", () => {
	it("has the web build's roster (plus the port's dummy, breakables and boosts), every ID unique and in a slot", () => {
		// 5 classes + 6 enemies (+ the port's dummy) + 5 bosses + 6 bullets + 12 items + 6 ui + 20 audio events
		// (+ the port's 2 breakables and their 2 audio events, 37 port audio events (the Demon Lord's sfx.boss.taunt
		// the 21st, the boost drops' four after it, then the room clear celebration's three (docs/ROOM_CLEAR.md RC4), the
		// combo's two (docs/COMBO.md CB3), the near misses' two (docs/GRAZE_PARRY.md GP3) and the draft reveal's five
		// (docs/DRAFT_REVEAL.md DR4)), 5 ambience beds and 4 boost drops). The draft's card art (draftSkinIds) is
		// optional, so not here. + docs/ENEMY_VARIANTS.md EV1: enemy.imp, enemy.slime, bullet.enemy.goo and 5 port
		// audio events. + docs/NEW_BEST.md NB4: 2 port audio events (sfx.best.new, sfx.jingle.record).
		// + docs/BUILDS.md BU1: 4 effect bullet visuals and 9 port audio events. + docs/DAILY.md DS10: 2 port audio
		// events (sfx.rank.up, sfx.friend.passed).
		expect(REQUIRED_ASSET_IDS.size()).toBe(60 + 1 + 2 + 2 + 37 + 5 + 4 + 2 + 1 + 5 + 2 + 4 + 9 + 2);
		expect(AUDIO_EVENTS.size()).toBe(20);
		expect(new Set(REQUIRED_ASSET_IDS).size()).toBe(REQUIRED_ASSET_IDS.size());
		for (const id of REQUIRED_ASSET_IDS) {
			expect([id, slotFor(id) !== undefined]).toEqual([id, true]);
		}
		// + enemy.dummy.name, breakable.<kind>.name, boost.<kind>.name / .desc / .icon, hud.toast.boost, the loading
		// screen's three (docs/PRELOAD.md P4), the stage loader's five (docs/STAGE_LOADER.md SL2) and the touch
		// controls' thirteen (docs/MOBILE.md MB7)
		// + ROOM_CLEAR_STRING_KEYS (docs/ROOM_CLEAR.md RC3) + COMBO_STRING_KEYS (docs/COMBO.md CB3)
		// + NEAR_MISS_STRING_KEYS (docs/GRAZE_PARRY.md GP3)
		// + docs/ENEMY_VARIANTS.md EV1: enemy.imp.name, enemy.slime.name, AFFIX_STRING_KEYS (4), BESTIARY_STRING_KEYS (7)
		// + docs/NEW_BEST.md NB4: NEW_BEST_STRING_KEYS (18) + docs/BUILDS.md BU1: BUILD_STRING_KEYS (7)
		// + docs/DAILY.md DS2: ROSTER_STRING_KEYS (2)
		// + docs/DAILY.md DS9 / DS11 / DS12: DAILY_STRING_KEYS (63)
		// + docs/DAILY.md DS10: DAILY_RANK_STRING_KEYS (22)
		expect(REQUIRED_STRING_KEYS.size()).toBe(
			41 + 1 + 2 + 4 * 3 + 1 + 3 + 5 + 13 + 10 + 6 + 2 + 2 + 4 + 7 + 18 + 7 + 2 + 63 + 22,
		);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
		expect(BIOMES.map((b) => b.forgeTheme)).toEqual(["ancient", "molten", "frost", "grim", "verdant"]);
	});

	it("the port's endless bosses are boss-slot IDs outside the web build's required roster", () => {
		expect(ENDLESS_BOSS_IDS).toEqual(["boss.act1", "boss.demonlord"]);
		for (const id of ENDLESS_BOSS_IDS) {
			expect([id, slotFor(id)]).toEqual([id, BOSS]);
			expect([id, REQUIRED_ASSET_IDS.includes(id), REQUIRED_STRING_KEYS.includes(`${id}.name`)]).toEqual([
				id,
				false,
				false,
			]);
		}
	});

	it("keeps the contrast thresholds and gameplay key words", () => {
		expect([MIN_ENEMY_BULLET_CONTRAST, MIN_HEALTH_BAR_CONTRAST, MIN_DAMAGE_NUMBER_CONTRAST]).toEqual([3, 3, 4.5]);
		expect(GAMEPLAY_KEY_WORDS.size()).toBe(26);
		expect(GAMEPLAY_KEY_WORDS).toContain("hitbox");
		expect(GAMEPLAY_KEY_WORDS).toContain("stats");
	});
});
