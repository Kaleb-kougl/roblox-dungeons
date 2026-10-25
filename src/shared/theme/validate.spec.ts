// Ported from project-kaleb-vale src/theme/validate.test.ts @ 42897e2. File checks became Roblox
// asset-ID checks and the `generated` kind became `placeholder`; every other case is kept.
import { describe, expect, it } from "@rbxts/jest-globals";
import { contrastRatio } from "./color";
import {
	BIOMES,
	BIOME_MATERIALS,
	BIOME_MATERIAL_SURFACES,
	CHARACTER,
	DAMAGE_NUMBER_ROLES,
	HEALTH_BAR_FILL_ROLES,
	MIN_DAMAGE_NUMBER_CONTRAST,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_HEALTH_BAR_CONTRAST,
	requiredAnimationList,
} from "./contract";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { deepClone, sortedEntries, startsWith, type Obj } from "./util";
import { contrastReport, isGameplayKey, juiceContrastReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
/** Drill into nested manifest tables: at(m, "assets", "class.ranger"). */
function at(o: unknown, ...keys: Array<string>): Obj {
	let cur = o;
	for (const k of keys) {
		cur = (cur as Obj)[k];
	}
	return cur as Obj;
}
const endsWith = (s: string, suffix: string) => s.sub(-suffix.size()) === suffix;

const SHEET_ID = "rbxassetid://1001";

/** A contract-correct class spritesheet (16x24, pivot (8, 23), every animation x facing). */
function sheet(overrides: Obj = {}): Obj {
	const animations: Obj = {};
	let row = 0;
	for (const a of requiredAnimationList(CHARACTER)) {
		animations[a.name] = { row: row++, frames: a.frames, fps: 10, loop: true };
	}
	const out: Obj = {
		kind: "spritesheet",
		assetId: SHEET_ID,
		frameW: 16,
		frameH: 24,
		pivot: { x: 8, y: 23 },
		animations,
	};
	for (const [k, v] of sortedEntries(overrides)) {
		out[k] = v;
	}
	return out;
}

describe("validateManifest: placeholder pack", () => {
	it("accepts the placeholder pack with no errors", () => {
		expect(validateManifest(PLACEHOLDER_MANIFEST, { packId: "placeholder" })).toEqual([]);
	});

	it("passes enemy-bullet contrast on every biome floor and wall", () => {
		const report = contrastReport(PLACEHOLDER_MANIFEST);
		expect(report).toHaveLength(BIOMES.size() * 2);
		for (const c of report) {
			expect(c.ratio).toBeGreaterThanOrEqual(MIN_ENEMY_BULLET_CONTRAST);
		}
	});

	it("accepts contract-correct uploaded art and sound", () => {
		const m = clone();
		const assets = at(m, "assets");
		assets["class.ranger"] = sheet();
		assets["tile.biome.1.floor"] = { kind: "image", assetId: "rbxassetid://1002", w: 16, h: 16 };
		assets["ui.font.digits"] = { kind: "image", assetId: "rbxassetid://1003", w: 80, h: 7 };
		assets["sfx.ember"] = { kind: "sound", assetId: "rbxassetid://1004", volume: 0.8 };
		assets["music.boss"] = { kind: "sound", assetId: "rbxassetid://1005" };
		expect(validateManifest(m)).toEqual([]);
	});
});

describe("validateManifest: rejects bad manifests", () => {
	it("rejects non-objects", () => {
		expect(validateManifest(undefined)).toEqual(["(root): manifest must be a JSON object"]);
		expect(validateManifest("manifest")).toHaveLength(1);
		expect(validateManifest([1, 2])).toHaveLength(1);
	});

	it("reports a missing slot ID", () => {
		const m = clone();
		at(m, "assets")["enemy.sniper"] = undefined;
		expect(validateManifest(m)).toEqual(['assets: missing required asset "enemy.sniper" (slot enemy)']);
	});

	it("reports a missing biome and its forge theme", () => {
		const m = clone();
		at(m, "biomes")["biome.3"] = undefined;
		expect(validateManifest(m)).toContain('biomes: missing biome "biome.3" (Dungeon Forge theme "frost")');
	});

	it("reports missing color roles and strings", () => {
		const m = clone();
		at(m, "colors").enemyBullet = undefined;
		at(m, "strings")["game.title"] = undefined;
		const errors = validateManifest(m);
		expect(errors).toContain('colors: missing color role "enemyBullet"');
		expect(errors).toContain('strings: missing required string "game.title"');
	});

	it("reports dangling string and tile references from biomes", () => {
		const m = clone();
		at(m, "biomes", "biome.2").name = "place.nowhere";
		at(m, "biomes", "biome.2", "tiles").wall = "tile.biome.9.wall";
		const errors = validateManifest(m);
		expect(errors).toContain('biomes["biome.2"].name: string key "place.nowhere" is not in strings');
		expect(errors).toContain('biomes["biome.2"].tiles.wall: asset "tile.biome.9.wall" is not in assets');
	});

	it("rejects gameplay-looking keys anywhere, with a pointer to gameplay data", () => {
		const m = clone();
		at(m, "assets", "bullet.enemy.small").radius = 3;
		at(m, "assets", "enemy.bruiser").hitbox = { w: 10, h: 12 };
		at(m, "biomes", "biome.1").moveSpeed = 2;
		m.extra = { fireRate: 4, cooldownMs: 300, nested: [{ damage: 5 }] };
		const errors = validateManifest(m);
		const paths = errors
			.filter((e) => e.find("looks like gameplay data", 1, true)[0] !== undefined)
			.map((e) => e.sub(1, (e.find(": ", 1, true)[0] as number) - 1));
		paths.sort();
		const expected = [
			'assets["bullet.enemy.small"].radius',
			'assets["enemy.bruiser"].hitbox',
			'biomes["biome.1"].moveSpeed',
			"extra.cooldownMs",
			"extra.fireRate",
			"extra.nested[0].damage",
		];
		expected.sort();
		expect(paths).toEqual(expected);
		const radius = errors.find((e) => startsWith(e, 'assets["bullet.enemy.small"].radius'));
		expect(radius).toBe(
			'assets["bullet.enemy.small"].radius: looks like gameplay data; hitboxes, radii, speeds, damage and timings belong in gameplay data, not the theme pack',
		);
		// 'extra' is not gameplay-looking but is still unknown.
		expect(errors).toContain(
			"extra: unknown key (allowed: format, id, name, version, colors, biomes, assets, strings, locales)",
		);
	});

	it("does not flag logical IDs that merely contain gameplay words", () => {
		const m = clone();
		at(m, "strings")["hud.damage"] = "Damage";
		at(m, "assets")["ui.icon.speed"] = { kind: "placeholder" };
		expect(validateManifest(m)).toEqual([]);
	});

	it("reports bad asset IDs and string keys", () => {
		const m = clone();
		at(m, "assets")["enemy"] = { kind: "placeholder" };
		at(m, "assets")["enemy.Big"] = { kind: "placeholder" };
		at(m, "strings")["Hud.title"] = "x";
		const errors = validateManifest(m);
		expect(errors).toContain(
			'assets.enemy: bad asset ID (use lowercase dot.separated segments, e.g. "enemy.sniper")',
		);
		expect(errors).toContain(
			'assets["enemy.Big"]: bad asset ID (use lowercase dot.separated segments, e.g. "enemy.sniper")',
		);
		expect(errors).toContain('strings["Hud.title"]: bad string key (use dot.separated.words)');
	});

	it("reports low enemy-bullet contrast per biome", () => {
		const m = clone();
		at(m, "biomes", "biome.3").floor = "#e05090"; // close to the magenta bullets
		// (So bright a floor also fails the juice damage-number checks; those have their own tests below.)
		const errors = validateManifest(m).filter((e) => e.find("enemyBullet", 1, true)[0] !== undefined);
		const ratio = "%.2f".format(contrastRatio("#ff3fa4", "#e05090"));
		expect(errors).toEqual([
			`biomes["biome.3"].floor: contrast: enemyBullet #ff3fa4 on biome.3 (frost) floor #e05090 is ${ratio}:1, needs >= 3.0:1`,
		]);
		expect(startsWith(ratio, "1.")).toBe(true);
	});

	it("checks contrast against walls too", () => {
		const m = clone();
		at(m, "biomes", "biome.5").wall = "#ff3fa4";
		expect(validateManifest(m)).toEqual([
			'biomes["biome.5"].wall: contrast: enemyBullet #ff3fa4 on biome.5 (verdant) wall #ff3fa4 is 1.00:1, needs >= 3.0:1',
		]);
	});

	it("reports malformed spritesheets against the sprite contract", () => {
		const m = clone();
		const s = sheet({ frameW: 32, pivot: { x: 0, y: 0 }, assetId: "rbxassetid://abc" });
		const anims = at(s, "animations");
		anims["roll.left"] = undefined;
		at(anims, "run.up").frames = 4;
		at(anims, "idle.up").row = 0; // duplicates idle.down's row
		at(anims, "hit.down").fps = "fast";
		at(m, "assets")["class.ranger"] = s;
		const errors = validateManifest(m);
		for (const e of [
			'assets["class.ranger"].assetId: "rbxassetid://abc" must be "rbxassetid://<digits>" (upload with Asphalt or the Studio Asset Manager)',
			'assets["class.ranger"]: sprite contract: class cells are 16x24, got 32x24',
			'assets["class.ranger"].pivot: sprite contract: class pivot is (8, 23), got (0, 0)',
			'assets["class.ranger"].animations: sprite contract: missing animation "roll.left" (4 frames)',
			'assets["class.ranger"].animations["run.up"].frames: sprite contract: "run.up" has 6 frames, got 4',
			'assets["class.ranger"].animations["idle.up"].row: row 0 is already used by "idle.down"',
			'assets["class.ranger"].animations["hit.down"].fps: must be a number in (0, 60]',
		]) {
			expect(errors).toContain(e);
		}
		expect(errors).toHaveLength(7);
	});

	it("requires uploaded Roblox asset IDs (no local content, paths or bare numbers)", () => {
		const m = clone();
		const assets = at(m, "assets");
		const noId = sheet();
		noId.assetId = undefined;
		assets["class.ranger"] = noId;
		assets["sfx.ember"] = { kind: "sound", assetId: "sfx/ember.ogg" };
		assets["item.gold"] = { kind: "image", assetId: "rbxasset://textures/gold.png", w: 16, h: 16 };
		assets["sfx.ui.click"] = { kind: "sound", assetId: 1234, volume: 2 };
		const errors = validateManifest(m);
		expect(errors).toEqual([
			'assets["class.ranger"].assetId: must be an uploaded Roblox asset, "rbxassetid://<digits>"',
			'assets["item.gold"].assetId: "rbxasset://textures/gold.png" must be "rbxassetid://<digits>" (upload with Asphalt or the Studio Asset Manager)',
			'assets["sfx.ember"].assetId: "sfx/ember.ogg" must be "rbxassetid://<digits>" (upload with Asphalt or the Studio Asset Manager)',
			'assets["sfx.ui.click"].assetId: must be an uploaded Roblox asset, "rbxassetid://<digits>"',
			'assets["sfx.ui.click"].volume: must be a number in [0, 1]',
		]);
	});

	it("reports wrong kinds for a slot, extra keys and unknown IDs", () => {
		const m = clone();
		const assets = at(m, "assets");
		assets["bullet.enemy.small"] = { kind: "sound", assetId: "rbxassetid://1" };
		assets["enemy.swarmer"] = { kind: "generated", shape: "circle", color: "enemy.swarmer", w: 16, h: 16 };
		assets["enemy.sniper"] = { kind: "placeholder", color: "enemy.sniper" };
		assets["sfx.ember"] = { kind: "placeholder" };
		assets["weapon.sword"] = { kind: "silent" };
		const errors = validateManifest(m);
		expect(errors).toContain(
			'assets["bullet.enemy.small"].kind: slot "bullet" accepts kind "spritesheet" | "placeholder", got "sound"',
		);
		expect(errors).toContain(
			'assets["enemy.swarmer"].kind: slot "enemy" accepts kind "spritesheet" | "sprites" | "placeholder", got "generated"',
		);
		expect(errors).toContain('assets["enemy.sniper"].color: unknown key (allowed: kind)');
		expect(errors).toContain(
			'assets["sfx.ember"].kind: slot "sfx" accepts kind "sound" | "silent", got "placeholder"',
		);
		expect(errors.some((e) => startsWith(e, 'assets["weapon.sword"]: ID matches no slot'))).toBe(true);
	});

	it("checks locales and string placeholders", () => {
		const m = clone();
		at(m, "strings")["hud.level"] = "Lv {level";
		m.locales = { fr: { "game.title": "Projet Kaleb-Vale", "not.a.key": "x" } };
		expect(validateManifest(m)).toEqual([
			'strings["hud.level"]: has a malformed placeholder (use {name} with letters, digits or _)',
			'locales.fr["not.a.key"]: not in the default string table',
		]);
		const n = clone();
		n.locales = { FR: { "game.title": "x" }, "pt-BR": { "game.title": "y" } };
		expect(validateManifest(n)).toEqual(['locales.FR: bad locale code (use e.g. "fr" or "pt-BR")']);
	});

	it("checks the pack id against its folder", () => {
		expect(validateManifest(PLACEHOLDER_MANIFEST, { packId: "other" })).toEqual([
			'id: is "placeholder" but the pack folder is "other"',
		]);
	});

	it("checks the format and the header fields", () => {
		const m = clone();
		m.format = 2;
		m.id = "Bad Id";
		m.name = "  ";
		expect(validateManifest(m)).toEqual([
			"format: must be 1, got 2",
			'id: must be a lowercase pack id like "placeholder" or "my-pack"',
			"name: must be a non-empty string",
		]);
	});
});

describe("validateManifest: juice colours and digit font", () => {
	it("placeholder bars and damage numbers pass, with one entry per bar fill and per number role x biome", () => {
		const report = juiceContrastReport(PLACEHOLDER_MANIFEST);
		const bars = report.filter((c) => c.check === "healthBar");
		const numbers = report.filter((c) => c.check === "damageNumber");
		expect(bars.map((c) => c.role)).toEqual([...HEALTH_BAR_FILL_ROLES]);
		expect(numbers).toHaveLength(DAMAGE_NUMBER_ROLES.size() * BIOMES.size());
		for (const c of bars) {
			expect(c.ratio).toBeGreaterThanOrEqual(MIN_HEALTH_BAR_CONTRAST);
		}
		for (const c of numbers) {
			expect(c.ratio).toBeGreaterThanOrEqual(MIN_DAMAGE_NUMBER_CONTRAST);
		}
		expect(numbers.filter((c) => c.role === "damageNumber").map((c) => c.against)).toEqual(
			BIOMES.map((b) => b.id as string),
		);
	});

	it("reports a health bar that does not read on its back plate", () => {
		const m = clone();
		at(m, "colors").enemyHealth = "#2a1418";
		expect(validateManifest(m)).toEqual([
			"colors.enemyHealth: contrast: enemyHealth #2a1418 on enemyHealthBack #1a0d10 is 1.09:1, needs >= 3.0:1",
		]);
	});

	it("reports damage-number contrast per biome floor", () => {
		const m = clone();
		at(m, "colors").damageNumber = "#5a5048";
		const errors = validateManifest(m);
		expect(errors).toHaveLength(BIOMES.size());
		const first = errors[0];
		expect(
			startsWith(
				first,
				"colors.damageNumber: contrast: damageNumber #5a5048 on biome.1 (ancient) floor #2b2722 is ",
			),
		).toBe(true);
		expect(endsWith(first, ":1, needs >= 4.5:1")).toBe(true);
		expect(errors.some((e) => e.find("biome.4 (grim)", 1, true)[0] !== undefined)).toBe(true);
	});

	it("requires the digit font and holds an uploaded strip to the font contract", () => {
		const m = clone();
		at(m, "assets")["ui.font.digits"] = undefined;
		expect(validateManifest(m)).toEqual(['assets: missing required asset "ui.font.digits" (slot ui)']);
		const o = clone();
		at(o, "assets")["ui.font.digits"] = { kind: "image", assetId: "rbxassetid://7", w: 64, h: 7 };
		expect(validateManifest(o)).toEqual([
			'assets["ui.font.digits"]: font contract: the digit strip is 80x7 (16 cells of 5x7: "0123456789+-CAP!"), got 64x7',
		]);
	});
});

describe("isGameplayKey", () => {
	it("flags gameplay-looking keys", () => {
		for (const k of [
			"hitbox",
			"hitboxes",
			"speed",
			"bulletSpeed",
			"damage",
			"radius",
			"cooldown",
			"fireRate",
			"hp",
			"move_speed",
		]) {
			expect([k, isGameplayKey(k)]).toEqual([k, true]);
		}
	});

	it("allows art and layout keys", () => {
		for (const k of [
			"kind",
			"assetId",
			"frameW",
			"frameH",
			"fps",
			"loop",
			"pivot",
			"row",
			"frames",
			"volume",
			"tiles",
			"w",
			"h",
			// sprite contract v2
			"pixelsPerTile",
			"resample",
			"facings",
			"count",
			"zeroDeg",
			"ccw",
			"sheets",
			"sheet",
			"start",
			"stride",
			"tilesPerImage",
		]) {
			expect([k, isGameplayKey(k)]).toEqual([k, false]);
		}
	});
});

// ---------------------------------------------------------------------------------------------
// Sprite contract v2: the `sprites` kind and repeating tile images (docs/ART.md task S2)

const SET = 'assets["enemy.swarmer"]';

/**
 * A valid enemy sprite set: 64x56 cells, 8 facings, two sheets. Sheet 0 is 1024x448 (16 x 8 = 128 cells), sheet 1 is
 * 256x112 (4 x 2 = 8 cells). move fills cells 0-63 and death 64-127 (sheet 0 exactly full); idle is a 1-frame stand-in
 * (move's frame 0, stride 8); hit and the extra `attack.1` use sheet 1.
 */
function spriteSet(): Obj {
	return {
		kind: "sprites",
		frameW: 64,
		frameH: 56,
		pivot: { x: 32, y: 48 },
		pixelsPerTile: 32,
		resample: "Default",
		facings: { count: 8, zeroDeg: 0, ccw: true },
		sheets: [
			{ assetId: "rbxassetid://3001", w: 1024, h: 448 },
			{ assetId: "rbxassetid://3002", w: 256, h: 112 },
		],
		animations: {
			idle: { sheet: 0, start: 0, frames: 1, stride: 8, fps: 1, loop: true },
			move: { sheet: 0, start: 0, frames: 8, fps: 10, loop: true },
			attack: { sheet: 0, start: 0, frames: 8, fps: 12, loop: true },
			hit: { sheet: 1, start: 0, frames: 1, fps: 8, loop: false },
			death: { sheet: 0, start: 64, frames: 8, fps: 10, loop: false },
			"attack.1": { sheet: 1, start: 0, frames: 1, fps: 12, loop: false },
		},
	};
}

/** Sheet `i` of a sprite set (an array: string keys do not reach Luau array slots). */
const sheetAt = (set: Obj, i: number): Obj => (set.sheets as Array<Obj>)[i];

/** Validator errors for the placeholder pack with `enemy.swarmer` = spriteSet() after `edit`. */
function spriteErrors(edit: (set: Obj) => void): Array<string> {
	const m = clone();
	const set = spriteSet();
	edit(set);
	at(m, "assets")["enemy.swarmer"] = set;
	return validateManifest(m);
}

describe("validateManifest: sprite sets (contract v2)", () => {
	it("accepts a valid sprite set in the enemy, boss and class slots", () => {
		expect(spriteErrors(() => undefined)).toEqual([]);
		const m = clone();
		const boss = spriteSet();
		boss.facings = { count: 1, zeroDeg: 0, ccw: true };
		at(m, "assets")["boss.act1"] = boss;
		const knight = spriteSet();
		const anims = at(knight, "animations");
		anims.run = anims.move;
		anims.roll = anims.attack;
		anims.move = undefined;
		anims.attack = undefined;
		knight.resample = "Pixelated";
		knight.pivot = { x: 64, y: 56 }; // the cell's bottom-right corner is still inside
		at(m, "assets")["class.vanguard"] = knight;
		expect(validateManifest(m)).toEqual([]);
	});

	it("is not accepted outside the actor slots", () => {
		const m = clone();
		at(m, "assets")["bullet.enemy.small"] = spriteSet();
		expect(validateManifest(m)).toEqual([
			'assets["bullet.enemy.small"].kind: slot "bullet" accepts kind "spritesheet" | "placeholder", got "sprites"',
		]);
	});

	it("requires the slot's base animations, and only those", () => {
		expect(spriteErrors((s) => (at(s, "animations").hit = undefined))).toEqual([
			`${SET}.animations: sprite contract: missing animation "hit" (>= 1 frame)`,
		]);
		const m = clone();
		at(m, "assets")["class.vanguard"] = spriteSet();
		expect(validateManifest(m)).toEqual([
			'assets["class.vanguard"].animations: sprite contract: missing animation "run" (>= 1 frame)',
			'assets["class.vanguard"].animations: sprite contract: missing animation "roll" (>= 1 frame)',
		]);
	});

	it("rejects unknown keys on the set, its facings, sheets and animations", () => {
		expect(
			spriteErrors((s) => {
				s.assetId = "rbxassetid://1";
				at(s, "facings").mirror = true;
				sheetAt(s, 0).name = "a";
				at(s, "animations", "move").row = 0;
			}),
		).toEqual([
			`${SET}.assetId: unknown key (allowed: kind, frameW, frameH, pivot, pixelsPerTile, resample, facings, sheets, animations)`,
			`${SET}.facings.mirror: unknown key (allowed: count, zeroDeg, ccw)`,
			`${SET}.sheets[0].name: unknown key (allowed: assetId, w, h)`,
			`${SET}.animations.move.row: unknown key (allowed: sheet, start, frames, stride, fps, loop)`,
		]);
	});

	it("checks the cell size: positive integers up to 1024", () => {
		expect(spriteErrors((s) => (s.frameW = 0))).toEqual([`${SET}.frameW: must be an integer in [1, 1024]`]);
		expect(spriteErrors((s) => (s.frameH = 1025))).toEqual([`${SET}.frameH: must be an integer in [1, 1024]`]);
		expect(spriteErrors((s) => (s.frameW = 64.5))).toEqual([`${SET}.frameW: must be an integer in [1, 1024]`]);
	});

	it("keeps the pivot inside the cell", () => {
		expect(spriteErrors((s) => (s.pivot = { x: 65, y: 10 }))).toEqual([
			`${SET}.pivot: (65, 10) is outside the 64x56 cell`,
		]);
		expect(spriteErrors((s) => (s.pivot = { x: 0, y: -1 }))).toEqual([
			`${SET}.pivot: (0, -1) is outside the 64x56 cell`,
		]);
		expect(spriteErrors((s) => (s.pivot = { x: "middle", y: 0 }))).toEqual([
			`${SET}.pivot: must be { "x": number, "y": number } in pixels from the cell top-left`,
		]);
	});

	it("checks the texel density and the resample mode", () => {
		expect(spriteErrors((s) => (s.pixelsPerTile = 0))).toEqual([
			`${SET}.pixelsPerTile: must be a number > 0 (cell pixels per world tile)`,
		]);
		expect(spriteErrors((s) => (s.resample = "Bilinear"))).toEqual([
			`${SET}.resample: must be "Default" | "Pixelated", got "Bilinear"`,
		]);
	});

	it("checks the facings", () => {
		expect(spriteErrors((s) => (at(s, "facings").count = 6))).toEqual([
			`${SET}.facings.count: must be 1 | 4 | 8 | 16, got 6`,
		]);
		expect(spriteErrors((s) => (at(s, "facings").zeroDeg = math.huge))).toEqual([
			`${SET}.facings.zeroDeg: must be a finite number (degrees; 0 = screen right)`,
		]);
		expect(spriteErrors((s) => (at(s, "facings").ccw = "yes"))).toEqual([
			`${SET}.facings.ccw: must be true or false`,
		]);
		expect(spriteErrors((s) => (s.facings = 8))).toEqual([
			`${SET}.facings: must be { "count": 1 | 4 | 8 | 16, "zeroDeg": number, "ccw": boolean }`,
		]);
	});

	it("checks the sheets: non-empty, uploaded IDs, sizes up to 1024 and at least one cell", () => {
		expect(spriteErrors((s) => (s.sheets = []))).toEqual([
			`${SET}.sheets: must be a non-empty array of { assetId, w, h }`,
		]);
		expect(spriteErrors((s) => (sheetAt(s, 0).assetId = "rbxasset://textures/skeleton.png"))).toEqual([
			`${SET}.sheets[0].assetId: "rbxasset://textures/skeleton.png" must be "rbxassetid://<digits>" (upload with Asphalt or the Studio Asset Manager)`,
		]);
		expect(spriteErrors((s) => (sheetAt(s, 1).assetId = undefined))).toEqual([
			`${SET}.sheets[1].assetId: must be an uploaded Roblox asset, "rbxassetid://<digits>"`,
		]);
		expect(spriteErrors((s) => (sheetAt(s, 1).w = 2048))).toEqual([
			`${SET}.sheets[1].w: must be an integer in [1, 1024]`,
		]);
		expect(spriteErrors((s) => (sheetAt(s, 1).w = 32))).toEqual([
			`${SET}.sheets[1]: sheet is 32x112, smaller than the 64x56 cell`,
		]);
	});

	it("checks every animation field", () => {
		expect(spriteErrors((s) => (at(s, "animations", "hit").sheet = 2))).toEqual([
			`${SET}.animations.hit.sheet: must be a sheet index in [0, 1], got 2`,
		]);
		expect(spriteErrors((s) => (at(s, "animations", "hit").start = -1))).toEqual([
			`${SET}.animations.hit.start: must be an integer >= 0 (first cell)`,
		]);
		expect(spriteErrors((s) => (at(s, "animations", "hit").frames = 0))).toEqual([
			`${SET}.animations.hit.frames: must be an integer >= 1`,
		]);
		expect(spriteErrors((s) => (at(s, "animations", "hit").stride = 0))).toEqual([
			`${SET}.animations.hit.stride: must be an integer >= 1 (cells between facings)`,
		]);
		expect(spriteErrors((s) => (at(s, "animations", "hit").fps = 0))).toEqual([
			`${SET}.animations.hit.fps: must be a number in (0, 60]`,
		]);
		expect(spriteErrors((s) => (at(s, "animations", "hit").loop = "no"))).toEqual([
			`${SET}.animations.hit.loop: must be true or false`,
		]);
		expect(spriteErrors((s) => (at(s, "animations")["attack.2"] = 4))).toEqual([
			`${SET}.animations["attack.2"]: must be { sheet, start, frames, stride?, fps, loop }`,
		]);
	});

	it("keeps every referenced cell inside its sheet, for every facing", () => {
		// death starts one cell later: only the LAST facing's last frame (cell 65 + 7 * 8 + 7 = 128) falls off sheet 0.
		expect(spriteErrors((s) => (at(s, "animations", "death").start = 65))).toEqual([
			`${SET}.animations.death: facing 7 frame 7 is cell 128, but sheet 0 (1024x448) holds 128 cells of 64x56`,
		]);
		// The stride counts: facing 7 of a 1-frame idle with stride 19 is cell 133.
		expect(spriteErrors((s) => (at(s, "animations", "idle").stride = 19))).toEqual([
			`${SET}.animations.idle: facing 7 frame 0 is cell 133, but sheet 0 (1024x448) holds 128 cells of 64x56`,
		]);
		// hit on the 8-cell sheet 1 with 2 frames: facing 4 starts at cell 8.
		expect(spriteErrors((s) => (at(s, "animations", "hit").frames = 2))).toEqual([
			`${SET}.animations.hit: facing 4 frame 0 is cell 8, but sheet 1 (256x112) holds 8 cells of 64x56`,
		]);
	});

	it("rejects a stride shorter than the animation when facings would overlap", () => {
		// move: 8 frames, 4 cells between facings: facing 1's frames 0..3 are facing 0's frames 4..7.
		expect(spriteErrors((s) => (at(s, "animations", "move").stride = 4))).toEqual([
			`${SET}.animations.move.stride: is 4, less than frames (8): consecutive facings would share cells`,
		]);
		// stride = frames is the default layout; a single facing has nothing to overlap.
		expect(spriteErrors((s) => (at(s, "animations", "move").stride = 8))).toEqual([]);
		expect(
			spriteErrors((s) => {
				at(s, "facings").count = 1;
				at(s, "animations", "move").stride = 4;
			}),
		).toEqual([]);
	});

	it("accepts a stride-based 1-frame stand-in that reuses frame 0 of a longer animation", () => {
		// idle = move's frame 0 in every facing: cells 0, 8, ..., 56 (without the stride it would be cells 0..7).
		expect(
			spriteErrors((s) => {
				at(s, "animations").idle = { sheet: 0, start: 0, frames: 1, stride: 8, fps: 1, loop: true };
				at(s, "animations").attack = { sheet: 0, start: 7, frames: 1, stride: 8, fps: 1, loop: false };
			}),
		).toEqual([]);
	});

	it("catches a gameplay key inside a sprite set but not its animation names", () => {
		expect(
			spriteErrors((s) => {
				s.hitbox = { w: 10, h: 12 };
				at(s, "animations", "move").duration = 0.5;
				at(s, "animations")["attack.3"] = { sheet: 1, start: 0, frames: 1, fps: 12, loop: false };
			}),
		).toEqual([
			`${SET}.animations.move.duration: looks like gameplay data; hitboxes, radii, speeds, damage and timings belong in gameplay data, not the theme pack`,
			`${SET}.hitbox: looks like gameplay data; hitboxes, radii, speeds, damage and timings belong in gameplay data, not the theme pack`,
		]);
	});
});

describe("validateManifest: repeating tile images (tilesPerImage)", () => {
	const withAsset = (id: string, def: Obj) => {
		const m = clone();
		at(m, "assets")[id] = def;
		return validateManifest(m);
	};
	const FLOOR = "tile.biome.1.floor";

	it("frees a tile image's size when it repeats", () => {
		expect(
			withAsset(FLOOR, { kind: "image", assetId: "rbxassetid://4001", w: 256, h: 256, tilesPerImage: 4 }),
		).toEqual([]);
		expect(
			withAsset(FLOOR, { kind: "image", assetId: "rbxassetid://4001", w: 1024, h: 512, tilesPerImage: 2.5 }),
		).toEqual([]);
	});

	it("still caps a repeating tile at 1024 px and needs tilesPerImage > 0", () => {
		expect(
			withAsset(FLOOR, { kind: "image", assetId: "rbxassetid://4001", w: 2048, h: 256, tilesPerImage: 4 }),
		).toEqual([`assets["${FLOOR}"].w: must be an integer in [1, 1024]`]);
		expect(
			withAsset(FLOOR, { kind: "image", assetId: "rbxassetid://4001", w: 256, h: 256, tilesPerImage: 0 }),
		).toEqual([`assets["${FLOOR}"].tilesPerImage: must be a number > 0 (world tiles per image side)`]);
	});

	it("keeps the 16x16 contract for a tile image without tilesPerImage", () => {
		expect(withAsset(FLOOR, { kind: "image", assetId: "rbxassetid://4001", w: 256, h: 256 })).toEqual([
			`assets["${FLOOR}"]: sprite contract: tile cells are 16x16, got 256x256`,
		]);
	});

	it("rejects tilesPerImage outside the tile slot", () => {
		expect(
			withAsset("item.gold", { kind: "image", assetId: "rbxassetid://4002", w: 16, h: 16, tilesPerImage: 2 }),
		).toEqual(['assets["item.gold"].tilesPerImage: only tile.* images repeat; slot "item" has no tilesPerImage']);
	});
});

describe("validateManifest: image pivots", () => {
	const withAsset = (id: string, def: Obj) => {
		const m = clone();
		at(m, "assets")[id] = def;
		return validateManifest(m);
	};
	const image = (pivot: unknown) => ({ kind: "image", assetId: "rbxassetid://4003", w: 8, h: 103, pivot });

	it("accepts a pivot inside a ui image", () => {
		expect(withAsset("ui.cursor", image({ x: 4, y: 100 }))).toEqual([]);
		expect(withAsset("ui.cursor", image({ x: 8, y: 103 }))).toEqual([]);
		expect(withAsset("ui.cursor", image({ x: 20.5 / 5, y: 0 }))).toEqual([]);
	});

	it("rejects a pivot outside the image, malformed, or outside the ui slot", () => {
		expect(withAsset("ui.cursor", image({ x: 9, y: 100 }))).toEqual([
			'assets["ui.cursor"].pivot: (9, 100) is outside the 8x103 image',
		]);
		expect(withAsset("ui.cursor", image({ x: 4 }))).toEqual([
			'assets["ui.cursor"].pivot: must be { "x": number, "y": number } in pixels from the image top-left',
		]);
		expect(withAsset("ui.cursor", image({ x: 4, y: 1, z: 0 }))).toEqual([
			'assets["ui.cursor"].pivot.z: unknown key (allowed: x, y)',
		]);
		expect(
			withAsset("item.gold", {
				kind: "image",
				assetId: "rbxassetid://4002",
				w: 16,
				h: 16,
				pivot: { x: 8, y: 8 },
			}),
		).toEqual(['assets["item.gold"].pivot: only ui.* images have a pivot; slot "item" has none']);
	});
});

describe("validateManifest: biome materials (docs/DECOR.md R1)", () => {
	const ALLOWED = BIOME_MATERIALS.join(", ");

	it("accepts every allowed material on every surface, and a partial map", () => {
		for (const name of BIOME_MATERIALS) {
			const m = clone();
			at(m, "biomes", "biome.2").materials = { floor: name, wall: name, pool: name };
			expect([name, validateManifest(m)]).toEqual([name, []]);
		}
		const m = clone();
		at(m, "biomes", "biome.2").materials = { floor: "Basalt" };
		at(m, "biomes", "biome.3").materials = {};
		expect(validateManifest(m)).toEqual([]);
	});

	it("is not caught by the gameplay-key scan", () => {
		expect(isGameplayKey("materials")).toBe(false);
		for (const s of BIOME_MATERIAL_SURFACES) {
			expect([s, isGameplayKey(s)]).toEqual([s, false]);
		}
	});

	it("rejects an unknown surface key", () => {
		const m = clone();
		at(m, "biomes", "biome.4").materials = { wall: "Slate", ceiling: "Slate" };
		expect(validateManifest(m)).toEqual([
			'biomes["biome.4"].materials.ceiling: unknown key (allowed: floor, wall, pool)',
		]);
	});

	it("rejects an unknown material name (Neon included: it is the bullets')", () => {
		const m = clone();
		at(m, "biomes", "biome.2").materials = { pool: "Neon", wall: "Lava" };
		expect(validateManifest(m)).toEqual([
			`biomes["biome.2"].materials.wall: unknown material "Lava" (allowed: ${ALLOWED})`,
			`biomes["biome.2"].materials.pool: unknown material "Neon" (allowed: ${ALLOWED})`,
		]);
	});

	it("rejects wrong types", () => {
		const m = clone();
		at(m, "biomes", "biome.1").materials = "Slate";
		at(m, "biomes", "biome.3").materials = { floor: 3, wall: true };
		expect(validateManifest(m)).toEqual([
			'biomes["biome.1"].materials: must map floor, wall, pool to material names, got "Slate"',
			'biomes["biome.3"].materials.floor: must be a material name string, got 3',
			'biomes["biome.3"].materials.wall: must be a material name string, got true',
		]);
	});

	it("a textured floor (tilesPerImage) must stay SmoothPlastic; walls and pools are free", () => {
		const m = clone();
		at(m, "assets")["tile.biome.1.floor"] = {
			kind: "image",
			assetId: "rbxassetid://1002",
			w: 256,
			h: 256,
			tilesPerImage: 4,
		};
		at(m, "biomes", "biome.1").materials = { floor: "Slate", wall: "Brick", pool: "Mud" };
		expect(validateManifest(m)).toEqual([
			'biomes["biome.1"].materials.floor: floor tile "tile.biome.1.floor" is a repeating texture: use ' +
				'"SmoothPlastic", "Slate" would fight the image',
		]);
		at(m, "biomes", "biome.1").materials = { floor: "SmoothPlastic", wall: "Brick" };
		expect(validateManifest(m)).toEqual([]);
		// a plain 16x16 tile image is not a repeating texture: any floor material
		at(m, "assets")["tile.biome.1.floor"] = { kind: "image", assetId: "rbxassetid://1002", w: 16, h: 16 };
		at(m, "biomes", "biome.1").materials = { floor: "Slate" };
		expect(validateManifest(m)).toEqual([]);
	});
});
