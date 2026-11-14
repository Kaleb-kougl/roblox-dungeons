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
		// docs/PROJECTILE_ART.md PA3: bullets also take one-facing sprite sets (bulletArt.spec.ts)
		expect(BULLET.kinds).toEqual(["spritesheet", "sprites", "placeholder"]);
		expect(TILE.kinds).toEqual(["image", "placeholder"]);
		expect(SFX.kinds).toEqual(["sound", "silent"]);
	});

	it("v2: actor slots also accept sprite sets, requiring only the base animation names", () => {
		expect([CHARACTER.kinds, ENEMY.kinds, BOSS.kinds]).toEqual([
			["spritesheet", "sprites", "placeholder"],
			["spritesheet", "sprites", "placeholder"],
			["spritesheet", "sprites", "placeholder"],
		]);
		for (const slot of [TILE, ITEM, UI, SFX, MUSIC]) {
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

	it("v2: names the optional sprite-set animations: class attack.1..3; enemy attack.2 (ENEMY_VARIANTS EV10), death.2 / move.back (NEW_ENEMIES NE8); boss attack.2..4 / intro / taunt (BRAMBLE_ART BR2, BOSS_DEMONLORD D2)", () => {
		expect(optionalBaseAnimations(CHARACTER)).toEqual(["attack.1", "attack.2", "attack.3"]);
		expect(optionalBaseAnimations(ENEMY)).toEqual(["attack.2", "death.2", "move.back"]);
		expect(optionalBaseAnimations(BOSS)).toEqual(["attack.2", "attack.3", "attack.4", "intro", "taunt"]);
		expect([CHARACTER.optionalAnimations, ENEMY.optionalAnimations, BOSS.optionalAnimations]).toEqual([
			CLASS_OPTIONAL_ANIMATIONS,
			["attack.2", "death.2", "move.back"],
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
		// events (sfx.rank.up, sfx.friend.passed). + docs/BREAKABLE_DROPS.md BL5: 1 port audio event (sfx.breakable.loot).
		// + docs/NEW_ENEMIES.md NE1: 5 enemy archetypes, 1 bullet visual (bullet.enemy.strike), 6 port audio events.
		// + docs/PELLETS.md PL6: 3 port audio events (sfx.pellet.*), 2 pellets (pellet.normal / .power).
		// + docs/RUN_RECAP.md CM4: 2 port audio events (sfx.room.teamperfect, sfx.player.syncparry).
		// + docs/TREASURE.md TR6: 4 port audio events (sfx.treasure.*, sfx.jingle.treasure), 3 treasure looks.
		// + docs/FORTUNE.md FD9: 1 enemy archetype (enemy.golden). + FO6: 8 port audio events (sfx.pact.take,
		// sfx.horde.*, sfx.golden.*), the pact altar. + docs/LEGENDARIES.md LG5: 2 port audio events (sfx.build.overkill,
		// sfx.build.brace). + docs/BUILDS_V2.md BV10: 5 port audio events (sfx.build.counter / .pin / .slam / .smash /
		// .beam). + docs/FLOOR_MODIFIERS.md FM7: 5 port audio events (sfx.floor.modifier.*). + docs/GOLDLING_RUMOURS.md
		// GR6: 2 port audio events (sfx.golden.rumour.floor / .room). + claude/codex-plan.md CX5: 1 port audio event
		// (sfx.codex.new). + docs/SECRET_ROOMS.md SR10: 3 port audio events (sfx.secret.knock / .open, sfx.jingle.secret);
		// its crack / rubble art and dust effect are optional, so not here. + docs/NEW_ENEMIES_2.md NX1: 5 enemy archetypes,
		// 2 bullet visuals (bullet.enemy.hook / .flame), 8 port audio events.
		const assetsBefore =
			60 + 1 + 2 + 2 + 37 + 5 + 4 + 2 + 1 + 5 + 2 + 4 + 9 + 2 + 1 + 5 + 1 + 6 + 3 + 2 + 2 + 4 + 3 + 1 + 8 + 1 + 2;
		const codexSounds = 1;
		const secretSounds = 3;
		const newEnemies2 = 5 + 2 + 8;
		expect(REQUIRED_ASSET_IDS.size()).toBe(assetsBefore + 5 + 5 + 2 + codexSounds + secretSounds + newEnemies2);
		expect(AUDIO_EVENTS.size()).toBe(20);
		expect(new Set(REQUIRED_ASSET_IDS).size()).toBe(REQUIRED_ASSET_IDS.size());
		for (const id of REQUIRED_ASSET_IDS) {
			expect([id, slotFor(id) !== undefined]).toEqual([id, true]);
		}
		// + enemy.dummy.name, breakable.<kind>.name, boost.<kind>.name / .desc / .icon, hud.toast.boost, the loading
		// screen's three (docs/PRELOAD.md P4), the stage loader's five (docs/STAGE_LOADER.md SL2) and the touch
		// controls' thirteen (docs/MOBILE.md MB7)
		// + ROOM_CLEAR_STRING_KEYS (docs/ROOM_CLEAR.md RC3) + COMBO_STRING_KEYS (docs/COMBO.md CB3; + shout, bestNamed)
		// + NEAR_MISS_STRING_KEYS (docs/GRAZE_PARRY.md GP3)
		// + docs/ENEMY_VARIANTS.md EV1: enemy.imp.name, enemy.slime.name, AFFIX_STRING_KEYS (4), BESTIARY_STRING_KEYS (7)
		// + docs/NEW_BEST.md NB4: NEW_BEST_STRING_KEYS (17: one floors-to-go key) + docs/BUILDS.md BU1: BUILD_STRING_KEYS (7)
		// + docs/DAILY.md DS2: ROSTER_STRING_KEYS (3, with the separator)
		// + docs/DAILY.md DS9 / DS11 / DS12: DAILY_STRING_KEYS (64, with the podium row)
		// + docs/DAILY.md DS10: DAILY_RANK_STRING_KEYS (22)
		// + docs/LOCALIZATION.md L1: INPUT_KEY_STRING_KEYS (51 key labels + input.separator)
		// + docs/NEW_ENEMIES.md NE1: 5 enemy.<id>.name, 5 bestiary.<id> (BESTIARY_STRING_KEYS)
		// + docs/PELLETS.md PL6: 2 room clear tally segments (ROOM_CLEAR_STRING_KEYS), bestiary.pellet.power
		// + docs/RUN_RECAP.md RR3 / CM3: RECAP_STRING_KEYS (28, + the Chests highlight from docs/TREASURE.md, + the `{n} pts` value),
		// TEAM_MOMENT_STRING_KEYS (4) + docs/TREASURE.md TR6: TREASURE_STRING_KEYS (16)
		// + docs/FORTUNE.md FD9: enemy.golden.name. + FO6: FORTUNE_STRING_KEYS (18), the Horde's tally segment
		// (ROOM_CLEAR_STRING_KEYS), bestiary.golden (BESTIARY_STRING_KEYS); FO7: hud.score.pop.horde (in FORTUNE_STRING_KEYS)
		// + docs/LEGENDARIES.md LG5: 3 BUILD_STRING_KEYS (hud.toast.brace / .braceHeal, fx.brace.text)
		// + docs/ITEM_TOOLTIPS.md IT3: 18 shared/view/hud TOOLTIP_STRINGS
		const before =
			41 + 1 + 2 + 4 * 3 + 1 + 3 + 5 + 13 + 10 + 8 + 2 + 2 + 4 + 7 + 17 + 7 + 3 + 64 + 22 + 52 + 5 + 5 + 2 + 1;
		// + docs/GAMEPAD_MENUS.md GM7 / GM9: GAMEPAD_MENU_STRING_KEYS (16 pad.hint.*, options.controls.vibration)
		// + docs/BUILDS_V2.md BV10: 5 BUILD_STRING_KEYS (hud.draft.duoHint, fx.counter / .pinned / .slam.text,
		// hud.toast.happyHour)
		// + docs/RUN_CONTRIBUTION.md CT4: CONTRIB_STRING_KEYS (44; CT5's `run.recap.party.share`: 45)
		// + docs/ARCHER.md AR11: the character screen's 7 (theme characters.ts characterStringKeys)
		// + docs/FLOOR_MODIFIERS.md FM7: FLOOR_MODIFIER_STRING_KEYS (11: five names and lines, the pause line)
		// + docs/GOLDLING_RUMOURS.md GR7: the rumour chip's 2 (GOLDEN_RUMOUR_STRING_KEYS), bestiary.golden.rumour
		// + claude/codex-plan.md CX5: CODEX_STRING_KEYS (54)
		// + docs/SECRET_ROOMS.md SR10: SECRET_STRING_KEYS (5), bestiary.secret.crack (BESTIARY_STRING_KEYS); SRD12: the
		// Codex's secrets sub-header, kind line and description (CODEX_STRING_KEYS, 57)
		// + docs/NEW_ENEMIES_2.md NX1: 5 enemy.<id>.name, 4 bestiary.<id> (BESTIARY_STRING_KEYS)
		const newEnemies2Strings = 5 + 4;
		const earlier = 28 + 1 + 1 + 4 + 16 + 1 + 19 + 1 + 1 + 3 + 18 + 17 + 5 + 45 + 7 + 11 + 2 + 1;
		expect(REQUIRED_STRING_KEYS.size()).toBe(before + earlier + 54 + 5 + 1 + 3 + newEnemies2Strings);
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
