// Ported from project-kaleb-vale src/theme/pack.test.ts @ 42897e2: loading, fallbacks (warn once),
// lookups and frame math. Texture/DataTexture cases became asset-ID / placeholder-visual cases, and
// the frame math adds the web's bottom-left UV -> Roblox's top-left pixel rect flip.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BIOMES, CHARACTER, DEFAULT_BIOME_MATERIAL, requiredAnimationList } from "./contract";
import { MISSING_COLOR, frameIndex, frameRect, frameUV, spriteSheetOutline, uvToPixelRect } from "./core";
import { ThemePack, listThemePacks, loadThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { PLACEHOLDER_VISUALS } from "./placeholders";
import { deepClone, type Obj } from "./util";
import { validateManifest } from "./validate";

/** A warning sink that records instead of printing. */
function sink() {
	const messages = new Array<string>();
	return { messages, warn: (m: string) => messages.push(m) };
}

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
function at(o: unknown, ...keys: Array<string>): Obj {
	let cur = o;
	for (const k of keys) {
		cur = (cur as Obj)[k];
	}
	return cur as Obj;
}
const pack = (w = sink(), manifest: unknown = PLACEHOLDER_MANIFEST) => new ThemePack(manifest, { warn: w.warn });
const contains = (s: string, sub: string) => s.find(sub, 1, true)[0] !== undefined;

/** A real (uploaded) class sheet laid out per the contract, one row per animation x facing. */
function rangerSheet(): Obj {
	const animations: Obj = {};
	let row = 0;
	for (const a of requiredAnimationList(CHARACTER)) {
		animations[a.name] = { row: row++, frames: a.frames, fps: 10, loop: a.name.sub(1, 5) !== "death" };
	}
	return {
		kind: "spritesheet",
		assetId: "rbxassetid://2001",
		frameW: 16,
		frameH: 24,
		pivot: { x: 8, y: 23 },
		animations,
	};
}

describe("loadThemePack", () => {
	it("every bundled pack validates clean", () => {
		const ids = listThemePacks();
		expect(ids).toContain("placeholder");
		for (const id of ids) {
			expect([id, validateManifest(THEME_PACKS[id], { packId: id })]).toEqual([id, []]);
		}
	});

	it("loads the placeholder pack with zero problems and nothing logged", () => {
		const w = sink();
		const p = loadThemePack("placeholder", { warn: w.warn });
		expect(p.id).toBe("placeholder");
		expect(p.problems).toEqual([]);
		expect(p.str("game.title")).toBe("Project Kaleb-Vale");
		expect(w.messages).toEqual([]);
	});

	it("falls back to the placeholder pack for an unknown pack id", () => {
		const w = sink();
		const p = loadThemePack("does-not-exist", { warn: w.warn });
		expect(p.id).toBe("placeholder");
		expect(w.messages).toEqual(['[theme] pack "does-not-exist" not found, falling back to "placeholder"']);
	});

	it("still loads a pack that fails validation, reporting its problems once", () => {
		const broken = clone();
		broken.id = "broken";
		at(broken, "assets")["enemy.sniper"] = undefined;
		const w = sink();
		const p = loadThemePack("broken", { packs: { broken }, warn: w.warn });
		expect(p.id).toBe("broken");
		expect(p.problems).toEqual(['assets: missing required asset "enemy.sniper" (slot enemy)']);
		expect(w.messages).toHaveLength(1);
		expect(contains(w.messages[0], "1 problem(s)")).toBe(true);
		expect(p.texture("enemy.sniper")).toBeUndefined();
		expect(p.placeholder("enemy.sniper").color).toEqual({ kind: "missing" });
	});

	it("throws only when even the placeholder pack is missing", () => {
		expect(() => loadThemePack("placeholder", { packs: {}, warn: () => undefined })).toThrow();
	});
});

describe("ThemePack fallbacks for missing IDs", () => {
	it("returns no asset and a magenta placeholder for a missing visual, and warns once", () => {
		const w = sink();
		const p = pack(w);
		expect(p.texture("enemy.dragon")).toBeUndefined();
		expect(p.texture("enemy.dragon")).toBeUndefined();
		const v = p.placeholder("enemy.dragon");
		expect(v.color).toEqual({ kind: "missing" });
		expect(v.shape).toBe("Block");
		expect(v.size).toEqual([4, 4, 4]); // the enemy slot's 16x16 cell
		expect(p.visualHex(v.color)).toBe(MISSING_COLOR);
		expect(p.visualColor(v.color).ToHex()).toBe("ff00ff");
		expect(w.messages).toEqual(['[theme:placeholder] missing asset "enemy.dragon", using the placeholder']);
	});

	it("returns the key for a missing string and warns once", () => {
		const w = sink();
		const p = pack(w);
		expect(p.str("hud.nope")).toBe("hud.nope");
		expect(p.str("hud.nope", { n: 1 })).toBe("hud.nope");
		expect(w.messages).toHaveLength(1);
	});

	it("returns magenta for a missing color role and warns once", () => {
		const m = clone();
		m.colors = {};
		const w = sink();
		const p = pack(w, m);
		expect(p.hex("enemyBullet")).toBe("#ff00ff");
		expect(p.color("enemyBullet").ToHex()).toBe("ff00ff");
		expect(w.messages).toEqual(['[theme:placeholder] missing color role "enemyBullet", using magenta']);
	});

	it("is silent for silent and missing audio events instead of crashing", () => {
		const w = sink();
		const p = pack(w);
		expect(p.sound("sfx.player.shoot")).toEqual({ assetId: undefined, volume: 0, group: "sfx", variants: [] });
		expect(p.sound("music.boss")).toEqual({ assetId: undefined, volume: 0, group: "music", variants: [] });
		expect(p.sound("sfx.nope")).toEqual({ assetId: undefined, volume: 0, group: "sfx", variants: [] });
		expect(p.sound("sfx.nope")).toEqual({ assetId: undefined, volume: 0, group: "sfx", variants: [] });
		expect(w.messages).toHaveLength(1);
	});

	it("warns once for an unknown animation and plays the first one", () => {
		const w = sink();
		const sheet = pack(w).spriteSheet("class.ranger");
		const f = sheet.frame("dance", 3);
		expect(sheet.animationNames[0]).toBe("idle.down");
		expect([f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual([0, 0, 16, 24]);
		sheet.frame("dance", 4);
		expect(w.messages).toEqual([
			'[theme:placeholder] sprite "class.ranger" has no animation "dance", using "idle.down"',
		]);
	});

	it("survives a manifest that is not even shaped right", () => {
		const w = sink();
		const p = pack(w, { id: "junk", assets: "nope", strings: 4 });
		expect(p.str("game.title")).toBe("game.title");
		expect(p.texture("class.ranger")).toBeUndefined();
		expect(p.biome("biome.1").floor).toBe("#ff00ff");
		expect(p.biome("biome.1").floorColor.ToHex()).toBe("ff00ff");
		expect(p.spriteSheet("class.ranger").frame("run.left", 3)).toBeDefined();
		expect(p.sound("sfx.ember").assetId).toBeUndefined();
	});
});

describe("ThemePack lookups", () => {
	it("resolves colors by role, as Color3 and hex, cached", () => {
		const p = pack();
		expect(p.hex("enemyBullet")).toBe("#ff3fa4");
		const c = p.color("enemyBullet");
		expect(c.ToHex()).toBe("ff3fa4");
		expect([math.round(c.R * 255), math.round(c.G * 255), math.round(c.B * 255)]).toEqual([255, 63, 164]);
		expect(p.color("enemyBullet")).toBe(c);
	});

	it("interpolates strings and prefers the active locale", () => {
		const m = clone();
		m.locales = { fr: { "hud.level": "Niv. {level}" } };
		const fr = new ThemePack(m, { locale: "fr", warn: sink().warn });
		expect(fr.str("hud.level", { level: 3 })).toBe("Niv. 3");
		expect(fr.str("ember.name")).toBe("Ember");
		expect(pack().str("hud.gold", { amount: 120 })).toBe("120 gold");
	});

	it("reports has() for asset IDs and hasString() for keys", () => {
		const p = pack();
		expect(p.has("bullet.enemy.small")).toBe(true);
		expect(p.has("bullet.enemy.huge")).toBe(false);
		expect(p.hasString("game.title")).toBe(true);
		expect(p.hasString("game.subtitle")).toBe(false);
	});

	it("returns undefined textures for placeholders without warning", () => {
		const w = sink();
		const p = pack(w);
		expect(p.texture("class.ranger")).toBeUndefined();
		expect(p.texture("tile.biome.1.floor")).toBeUndefined();
		expect(w.messages).toEqual([]);
	});

	it("lays out placeholder sheets per the contract: one row per facing", () => {
		const sheet = pack().spriteSheet("class.ranger");
		expect(sheet.assetId).toBeUndefined();
		expect(sheet.pivot).toEqual({ x: 8, y: 23 });
		expect([sheet.frameW, sheet.frameH]).toEqual([16, 24]);
		expect(sheet.animations["run.left"]).toEqual({ row: 2, frames: 1, fps: 1, loop: true });
		// Row 2 of 4 from the top. The web build's UV for this frame was { u: 0, v: 0.25, w: 1, h: 0.25 }
		// (bottom-left origin, 16x96 sheet); Roblox's top-left pixel rect is y = (1 - 0.25 - 0.25) * 96 = 48.
		const f = sheet.frame("run.left", 5);
		expect([f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual([0, 48, 16, 24]);
		expect(pack().spriteSheet("class.ranger")).toBeDefined();
		const boss = pack().spriteSheet("boss.act1");
		expect(boss.pivot).toEqual({ x: 24, y: 47 });
		expect(boss.animationNames).toEqual(["idle", "move", "attack", "hit", "death"]);
	});

	it("reads uploaded sheets: asset ID, rows, wrapping and held one-shots", () => {
		const m = clone();
		at(m, "assets")["class.ranger"] = rangerSheet();
		expect(validateManifest(m)).toEqual([]);
		const w = sink();
		const sheet = pack(w, m).spriteSheet("class.ranger");
		expect(sheet.assetId).toBe("rbxassetid://2001");
		expect(sheet.animationNames[0]).toBe("idle.down");
		// run.up: row 5, 6 frames, looping -> frame 7 wraps to column 1.
		const run = sheet.frame("run.up", 7);
		expect([run.offset.X, run.offset.Y, run.size.X, run.size.Y]).toEqual([16, 120, 16, 24]);
		// death.right: row 19, 6 frames, one-shot -> frame 99 holds column 5.
		const death = sheet.frame("death.right", 99);
		expect([death.offset.X, death.offset.Y]).toEqual([80, 456]);
		expect(w.messages).toEqual([]);
	});

	it("exposes biome colors and tile IDs", () => {
		const p = pack();
		const b = p.biome("biome.3");
		expect(b.forgeTheme).toBe("frost");
		expect(b.tiles.floor).toBe("tile.biome.3.floor");
		expect(p.str(b.nameKey)).toBe("Frost Reach");
		expect(b.floor).toBe("#1e2a33");
		expect(b.floorColor.ToHex()).toBe("1e2a33");
		expect(b.wallColor.ToHex()).toBe("2a3842");
	});

	it("biome materials default to SmoothPlastic when the pack names none (the placeholder pack draws as before R1)", () => {
		const w = sink();
		const p = pack(w);
		for (const b of BIOMES) {
			expect([b.id, p.biome(b.id).materials]).toEqual([
				b.id,
				{ floor: DEFAULT_BIOME_MATERIAL, wall: DEFAULT_BIOME_MATERIAL, pool: DEFAULT_BIOME_MATERIAL },
			]);
		}
		expect(DEFAULT_BIOME_MATERIAL).toBe("SmoothPlastic");
		// an unknown biome warns once (as before) and gets the defaults too
		expect(p.biome("biome.9").materials.wall).toBe("SmoothPlastic");
		expect(w.messages).toEqual(['[theme:placeholder] missing biome "biome.9"']);
	});

	it("exposes a biome's materials, filling absent surfaces; bad entries warn once and fall back", () => {
		const m = clone();
		at(m, "biomes", "biome.2").materials = { wall: "Rock", pool: "CrackedLava" };
		at(m, "biomes", "biome.3").materials = { floor: "Neon", wall: 7 };
		at(m, "biomes", "biome.4").materials = "Slate";
		const w = sink();
		const p = pack(w, m);
		expect(p.biome("biome.2").materials).toEqual({ floor: "SmoothPlastic", wall: "Rock", pool: "CrackedLava" });
		expect(p.core.biome("biome.2").materials).toEqual(p.biome("biome.2").materials);
		expect(p.biome("biome.3").materials).toEqual({
			floor: "SmoothPlastic",
			wall: "SmoothPlastic",
			pool: "SmoothPlastic",
		});
		expect(p.biome("biome.3").materials).toEqual(p.biome("biome.3").materials); // second lookup: no new warning
		expect(p.biome("biome.4").materials.floor).toBe("SmoothPlastic");
		expect(w.messages).toEqual([
			'[theme:placeholder] biome "biome.3" floor material "Neon" is not a known material, using "SmoothPlastic"',
			'[theme:placeholder] biome "biome.3" wall material 7 is not a known material, using "SmoothPlastic"',
			'[theme:placeholder] biome "biome.4" materials is not an object, using "SmoothPlastic"',
		]);
	});

	it("resolves placeholder visuals and their colours", () => {
		const w = sink();
		const p = pack(w);
		const bullet = p.placeholder("bullet.enemy.small");
		expect(bullet).toBe(PLACEHOLDER_VISUALS["bullet.enemy.small"]);
		expect(p.visualColor(bullet.color).ToHex()).toBe("ff3fa4");
		const wall = p.placeholder("tile.biome.2.wall");
		expect(p.visualHex(wall.color)).toBe("#4a2a20");
		expect(w.messages).toEqual([]);
	});
});

describe("frame math", () => {
	it("computes UVs with rows counted from the top (web, bottom-left origin)", () => {
		expect(frameUV(64, 48, 16, 24, 0, 0)).toEqual({ u: 0, v: 0.5, w: 0.25, h: 0.5 });
		expect(frameUV(64, 48, 16, 24, 3, 1)).toEqual({ u: 0.75, v: 0, w: 0.25, h: 0.5 });
	});

	it("computes pixel rects with rows counted from the top (Roblox, top-left origin)", () => {
		expect(frameRect(16, 24, 0, 0)).toEqual({ x: 0, y: 0, w: 16, h: 24 });
		expect(frameRect(16, 24, 3, 1)).toEqual({ x: 48, y: 24, w: 16, h: 24 });
	});

	it("flips the web's bottom-left UVs to the same top-left pixel rects", () => {
		expect(uvToPixelRect(frameUV(64, 48, 16, 24, 0, 0), 64, 48)).toEqual(frameRect(16, 24, 0, 0));
		expect(uvToPixelRect(frameUV(64, 48, 16, 24, 3, 1), 64, 48)).toEqual(frameRect(16, 24, 3, 1));
		expect(uvToPixelRect(frameUV(16, 96, 16, 24, 0, 2), 16, 96)).toEqual({ x: 0, y: 48, w: 16, h: 24 });
	});

	it("wraps looping animations and holds one-shots", () => {
		expect(frameIndex({ row: 0, frames: 4, fps: 8, loop: true }, 9)).toBe(1);
		expect(frameIndex({ row: 0, frames: 4, fps: 8, loop: false }, 9)).toBe(3);
		expect(frameIndex({ row: 0, frames: 4, fps: 8, loop: true }, -2.5)).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------
// Sprite contract v2: `sprites` assets (docs/ART.md task S2)

const SWARMER = "enemy.swarmer";

/**
 * The same valid set as validate.spec: 64x56 cells, 8 facings. Sheet 0 (1024x448) holds 16 x 8 cells: move 0-63,
 * death 64-127; idle is move's frame 0 (stride 8). Sheet 1 (256x112) holds 4 x 2 cells: hit, attack.1.
 */
function swarmerSet(): Obj {
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

function withSwarmerSet(edit?: (set: Obj) => void): Obj {
	const m = clone();
	const set = swarmerSet();
	if (edit !== undefined) {
		edit(set);
	}
	at(m, "assets")[SWARMER] = set;
	return m;
}

describe("sprite sets: ThemeCore.sprites layout", () => {
	it("exposes the set's layout, with sorted animation names", () => {
		const m = withSwarmerSet();
		expect(validateManifest(m)).toEqual([]);
		const w = sink();
		const s = pack(w, m).core.sprites(SWARMER);
		expect(s).toBeDefined();
		const layout = s!;
		expect([layout.id, layout.frameW, layout.frameH, layout.pixelsPerTile, layout.resample]).toEqual([
			SWARMER,
			64,
			56,
			32,
			"Default",
		]);
		expect(layout.pivot).toEqual({ x: 32, y: 48 });
		expect(layout.facings).toEqual({ count: 8, zeroDeg: 0, ccw: true });
		expect(layout.sheets).toEqual([
			{ assetId: "rbxassetid://3001", w: 1024, h: 448 },
			{ assetId: "rbxassetid://3002", w: 256, h: 112 },
		]);
		expect(layout.animationNames).toEqual(["attack", "attack.1", "death", "hit", "idle", "move"]);
		expect([layout.has("attack.1"), layout.has("run"), layout.has("attack.2")]).toEqual([true, false, false]);
		expect(layout.animation("hit")).toEqual({ sheet: 1, start: 0, frames: 1, fps: 8, loop: false });
		expect(layout.animation("run")).toBeUndefined();
		expect(w.messages).toEqual([]);
	});

	it("caches the layout per ID", () => {
		const core = pack(sink(), withSwarmerSet()).core;
		expect(core.sprites(SWARMER)).toBe(core.sprites(SWARMER));
	});

	it("computes frame rects (pixels, top-left) across sheets: cell = start + facing * stride + frame", () => {
		const s = pack(sink(), withSwarmerSet()).core.sprites(SWARMER)!;
		const A = "rbxassetid://3001";
		const B = "rbxassetid://3002";
		expect(s.frame("move", 0, 0)).toEqual({ sheet: 0, assetId: A, x: 0, y: 0, w: 64, h: 56 });
		// move facing 2, frame 9 wraps to 1: cell 17 = column 1, row 1 of a 16-wide sheet.
		expect(s.frame("move", 2, 9)).toEqual({ sheet: 0, assetId: A, x: 64, y: 56, w: 64, h: 56 });
		// death facing 7, frame 3: cell 64 + 56 + 3 = 123 = column 11, row 7.
		expect(s.frame("death", 7, 3)).toEqual({ sheet: 0, assetId: A, x: 704, y: 392, w: 64, h: 56 });
		// hit on sheet 1 (4 wide): facing 5 = cell 5 = column 1, row 1.
		expect(s.frame("hit", 5, 0)).toEqual({ sheet: 1, assetId: B, x: 64, y: 56, w: 64, h: 56 });
	});

	it("wraps looping animations and holds one-shots (frameIndex)", () => {
		const s = pack(sink(), withSwarmerSet()).core.sprites(SWARMER)!;
		// Looping move: frame 8 is frame 0 again, 15 is 7; negative and fractional indices clamp / floor.
		expect([s.frame("move", 0, 8).x, s.frame("move", 0, 15).x, s.frame("move", 0, -3).x]).toEqual([0, 448, 0]);
		expect(s.frame("move", 0, 2.9).x).toBe(128);
		// One-shot death holds its last frame: facing 7 frame 99 = cell 127 = column 15, row 7.
		const held = s.frame("death", 7, 99);
		expect([held.x, held.y]).toEqual([960, 392]);
		expect(s.frame("death", 7, 7)).toEqual(held);
	});

	it("wraps the facing modulo the facing count, negative too", () => {
		const s = pack(sink(), withSwarmerSet()).core.sprites(SWARMER)!;
		const cellOfHit = (facing: number) => {
			const r = s.frame("hit", facing, 0);
			return (r.y / 56) * 4 + r.x / 64;
		};
		expect([0, 7, 8, 9, 15, 16, -1, -8, -9, 2.7].map(cellOfHit)).toEqual([0, 7, 0, 1, 7, 0, 7, 0, 7, 2]);
	});

	it("uses the stride: a 1-frame stand-in reads frame 0 of every facing of a longer animation", () => {
		const s = pack(sink(), withSwarmerSet()).core.sprites(SWARMER)!;
		// idle facing 3 = cell 24 = column 8, row 1 (= move's facing 3, frame 0).
		expect(s.frame("idle", 3, 5)).toEqual(s.frame("move", 3, 0));
		expect([s.frame("idle", 3, 5).x, s.frame("idle", 3, 5).y]).toEqual([512, 56]);
		expect(s.frame("idle", 1, 0).x).toBe(512);
		expect(s.frame("idle", 1, 0).y).toBe(0);
	});

	it("warns once for an unknown animation and plays idle, else the first name", () => {
		const w = sink();
		const s = pack(w, withSwarmerSet()).core.sprites(SWARMER)!;
		expect(s.frame("dance", 1, 0)).toEqual(s.frame("idle", 1, 0));
		s.frame("dance", 2, 4);
		expect(w.messages).toEqual([
			'[theme:placeholder] sprite set "enemy.swarmer" has no animation "dance", using "idle"',
		]);
		// Without idle: in a slot that requires it the set is rejected (createSpriteSet); outside the slots (no required
		// names) the first name plays.
		const v = sink();
		const m = clone();
		const set = swarmerSet();
		at(set, "animations").idle = undefined;
		at(m, "assets")["test.spark"] = set;
		const noIdle = pack(v, m).core.sprites("test.spark")!;
		expect(noIdle.frame("dance", 0, 3)).toEqual(noIdle.frame("attack", 0, 3));
		expect(v.messages).toEqual([
			'[theme:placeholder] sprite set "test.spark" has no animation "dance", using "attack"',
		]);
	});

	it("is undefined without a warning for other kinds, and warns once for a missing ID", () => {
		const w = sink();
		const core = pack(w, withSwarmerSet()).core;
		expect(core.sprites("enemy.sniper")).toBeUndefined();
		expect(core.sprites("class.ranger")).toBeUndefined();
		expect(core.sprites("tile.biome.1.floor")).toBeUndefined();
		expect(core.sprites("sfx.ember")).toBeUndefined();
		expect(w.messages).toEqual([]);
		expect(core.sprites("enemy.dragon")).toBeUndefined();
		expect(core.sprites("enemy.dragon")).toBeUndefined();
		expect(core.texture("enemy.dragon")).toBeUndefined();
		expect(w.messages).toEqual(['[theme:placeholder] missing asset "enemy.dragon", using the placeholder']);
	});

	it("is undefined, warning once, for a sprite set too malformed to draw", () => {
		const w = sink();
		const core = pack(
			w,
			withSwarmerSet((set) => (set.sheets = "nope")),
		).core;
		expect(core.sprites(SWARMER)).toBeUndefined();
		expect(core.sprites(SWARMER)).toBeUndefined();
		expect(w.messages).toEqual([
			'[theme:placeholder] sprite set "enemy.swarmer" is malformed (no sheets), using the placeholder',
		]);
	});

	it("rejects a set the renderer could not draw, whatever the validator said", () => {
		const cases: Array<[(set: Obj) => void, string]> = [
			[(set) => (set.pixelsPerTile = 0), "pixelsPerTile must be > 0"],
			[(set) => (set.pixelsPerTile = undefined), "pixelsPerTile must be > 0"],
			[(set) => (set.facings = undefined), "bad facings.count"],
			[(set) => (at(set, "facings").count = 3), "bad facings.count"],
			[(set) => (at(set, "facings").zeroDeg = 0 / 0), "bad facings"],
			[(set) => (set.resample = "Linear"), "bad resample"],
			[(set) => (set.pivot = { x: 0 / 0, y: 1 }), "bad pivot"],
			[(set) => (set.pivot = { x: 65, y: 1 }), "pivot outside the cell"],
			[(set) => ((set.sheets as unknown as Array<Obj>)[1].h = 0), "bad sheet size"],
			[(set) => ((set.sheets as unknown as Array<Obj>)[1].w = 32), "bad sheet size"],
			[(set) => (at(set, "animations", "move").fps = undefined), 'animation "move": bad fps'],
			[(set) => (at(set, "animations", "move").fps = 61), 'animation "move": bad fps'],
			[
				(set) => (at(set, "animations", "death").start = 65),
				'animation "death": cell 128 is outside sheet 0 (128 cells)',
			],
			[
				(set) => (at(set, "animations", "move").stride = 4),
				'animation "move": stride < frames (facings would overlap)',
			],
			[(set) => (at(set, "animations").idle = undefined), 'missing animation "idle"'],
		];
		for (const [edit, reason] of cases) {
			const w = sink();
			const core = pack(w, withSwarmerSet(edit)).core;
			expect(core.sprites(SWARMER)).toBeUndefined();
			expect(w.messages).toEqual([
				`[theme:placeholder] sprite set "enemy.swarmer" is malformed (${reason}), using the placeholder`,
			]);
		}
	});

	it("drops a bad optional animation (warned once) and keeps the set", () => {
		const w = sink();
		const core = pack(
			w,
			withSwarmerSet((set) => (at(set, "animations", "attack.1").fps = 0)),
		).core;
		const set = core.sprites(SWARMER)!;
		expect(set).toBeDefined();
		expect(set.has("attack.1")).toBe(false);
		expect(set.has("move")).toBe(true);
		expect(core.sprites(SWARMER)).toBe(set);
		expect(w.messages).toEqual([
			'[theme:placeholder] sprite set "enemy.swarmer" drops animation "attack.1" (bad fps)',
		]);
	});

	it("keeps texture() and spriteSheet() on the placeholder path for a sprites asset", () => {
		const w = sink();
		const p = pack(w, withSwarmerSet());
		expect(p.texture(SWARMER)).toBeUndefined();
		const sheet = p.spriteSheet(SWARMER);
		const placeholder = pack().spriteSheet(SWARMER);
		expect(sheet.assetId).toBeUndefined();
		expect([sheet.frameW, sheet.frameH, sheet.pivot]).toEqual([16, 16, { x: 8, y: 15 }]);
		expect(sheet.animationNames).toEqual(placeholder.animationNames);
		expect(sheet.animations).toEqual(placeholder.animations);
		const f = sheet.frame("move.left", 3);
		expect([f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual([0, 32, 16, 16]);
		expect(w.messages).toEqual([]);
	});
});

describe("sprite sets: ThemePack.sprites", () => {
	it("wraps the core layout with Roblox frames (image, offset, size), cached per ID", () => {
		const w = sink();
		const p = pack(w, withSwarmerSet());
		const set = p.sprites(SWARMER)!;
		expect(set).toBeDefined();
		expect(p.sprites(SWARMER)).toBe(set);
		expect(set.layout).toBe(p.core.sprites(SWARMER));
		expect([set.id, set.frameW, set.frameH, set.pixelsPerTile, set.resample]).toEqual([
			SWARMER,
			64,
			56,
			32,
			"Default",
		]);
		expect(set.pivot).toEqual({ x: 32, y: 48 });
		expect(set.facings.count).toBe(8);
		expect(set.sheets.size()).toBe(2);
		expect(set.animationNames).toEqual(["attack", "attack.1", "death", "hit", "idle", "move"]);
		expect([set.has("death"), set.has("roll")]).toEqual([true, false]);
		expect(set.animation("attack.1")?.sheet).toBe(1);
		const f = set.frame("hit", -1, 0);
		expect([f.image, f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual(["rbxassetid://3002", 192, 56, 64, 56]);
		const g = set.frame("death", 7, 99);
		expect([g.image, g.offset.X, g.offset.Y]).toEqual(["rbxassetid://3001", 960, 392]);
		expect(w.messages).toEqual([]);
	});

	it("is undefined for placeholders, so callers fall back to placeholder(id)", () => {
		const w = sink();
		const p = pack(w);
		expect(p.sprites(SWARMER)).toBeUndefined();
		expect(p.sprites("boss.act1")).toBeUndefined();
		expect(p.placeholder(SWARMER).shape).toBe("Ball");
		expect(w.messages).toEqual([]);
	});
});

describe("sprite sets: outline sheets (enemy outline plan O4)", () => {
	const A = "rbxassetid://3001";
	const B = "rbxassetid://3002";
	const OA = "rbxassetid://4001";
	const OB = "rbxassetid://4002";
	const sheetAt = (set: Obj, i: number): Obj => (set.sheets as Array<Obj>)[i];
	const withOutlines = (set: Obj) => {
		sheetAt(set, 0).outlineAssetId = OA;
		sheetAt(set, 1).outlineAssetId = OB;
	};

	it("gives every frame its own sheet's outline, with the frame's rect", () => {
		const m = withSwarmerSet(withOutlines);
		expect(validateManifest(m)).toEqual([]);
		const w = sink();
		const p = pack(w, m);
		const s = p.core.sprites(SWARMER)!;
		// move and death on sheet 0, hit and attack.1 on sheet 1
		expect(s.frame("move", 2, 9)).toEqual({ sheet: 0, assetId: A, outlineAssetId: OA, x: 64, y: 56, w: 64, h: 56 });
		expect(s.frame("death", 7, 3).outlineAssetId).toBe(OA);
		expect(s.frame("hit", 5, 0)).toEqual({ sheet: 1, assetId: B, outlineAssetId: OB, x: 64, y: 56, w: 64, h: 56 });
		expect(s.frame("attack.1", 0, 0).outlineAssetId).toBe(OB);
		// ThemePack: outlineImage next to image, same offset and size
		const set = p.sprites(SWARMER)!;
		const f = set.frame("hit", -1, 0);
		expect([f.image, f.outlineImage, f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual([B, OB, 192, 56, 64, 56]);
		const g = set.frame("move", 0, 0);
		expect([g.image, g.outlineImage]).toEqual([A, OA]);
		expect(w.messages).toEqual([]);
	});

	it("has no outline without outline IDs, and only on the sheets that carry one", () => {
		const plain = pack(sink(), withSwarmerSet()).sprites(SWARMER)!;
		expect(plain.frame("move", 0, 0).outlineImage).toBeUndefined();
		expect(plain.frame("hit", 0, 0).outlineImage).toBeUndefined();
		expect(plain.layout.frame("move", 0, 0).outlineAssetId).toBeUndefined();
		// only sheet 1 outlined: hit has a rim, move draws without one
		const m = withSwarmerSet((set) => (sheetAt(set, 1).outlineAssetId = OB));
		expect(validateManifest(m)).toEqual([]);
		const half = pack(sink(), m).sprites(SWARMER)!;
		expect(half.frame("move", 3, 2).outlineImage).toBeUndefined();
		expect(half.frame("hit", 3, 0).outlineImage).toBe(OB);
	});

	it("draws a set with a malformed outline (failed validation) rimless, warning once", () => {
		const w = sink();
		const core = pack(
			w,
			withSwarmerSet((set) => (sheetAt(set, 0).outlineAssetId = 42 as unknown as string)),
		).core;
		const s = core.sprites(SWARMER)!;
		expect(s).toBeDefined();
		expect(s.frame("move", 0, 0).outlineAssetId).toBeUndefined();
		expect(s.frame("move", 0, 0).assetId).toBe(A);
		expect(core.sprites(SWARMER)).toBe(s);
		expect(w.messages).toEqual([
			'[theme:placeholder] sprite set "enemy.swarmer" sheet 0 has a bad outlineAssetId, drawing it without a rim',
		]);
	});

	it("spriteSheetOutline reads a string outline and nothing else", () => {
		expect(spriteSheetOutline({ assetId: A, w: 64, h: 56, outlineAssetId: OA })).toBe(OA);
		expect(spriteSheetOutline({ assetId: A, w: 64, h: 56 })).toBeUndefined();
		expect(
			spriteSheetOutline({ assetId: A, w: 64, h: 56, outlineAssetId: true as unknown as typeof OA }),
		).toBeUndefined();
	});
});

describe("image()", () => {
	it("returns an uploaded image's asset ID, size and tilesPerImage; undefined (no warning) otherwise", () => {
		const m = clone();
		const assets = at(m, "assets");
		assets["tile.biome.1.floor"] = {
			kind: "image",
			assetId: "rbxassetid://3001",
			w: 256,
			h: 256,
			tilesPerImage: 4,
		};
		assets["ui.ring.player"] = { kind: "image", assetId: "rbxassetid://3002", w: 41, h: 31 };
		const w = sink();
		const p = pack(w, m);
		expect(p.image("tile.biome.1.floor")).toEqual({
			assetId: "rbxassetid://3001",
			w: 256,
			h: 256,
			tilesPerImage: 4,
		});
		expect(p.core.image("ui.ring.player")).toEqual({
			assetId: "rbxassetid://3002",
			w: 41,
			h: 31,
			tilesPerImage: undefined,
		});
		expect(p.image("tile.biome.2.floor")).toBeUndefined(); // placeholder
		expect(p.image("class.vanguard")).toBeUndefined(); // not an image
		expect(p.image("ui.marker.pedestal")).toBeUndefined(); // missing
		expect(p.image("sfx.ember")).toBeUndefined(); // audio
		expect(w.messages).toEqual([]);
	});
});
