// The vale pack (docs/ART.md S5): the generated atlas layout must satisfy the contract v2 validator once uploaded, the
// runtime must address the cells the pipeline wrote, and entries without uploaded art must stay placeholders.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BIOMES,
	BIOME_MATERIALS,
	BIOME_MATERIAL_SURFACES,
	BOOST_BEAM_IMAGE_ID,
	BOOST_GLINT_FX,
	BOOST_HALO_FX,
	BOOST_KINDS,
	DEFAULT_BIOME_MATERIAL,
	ENEMY,
	boostId,
	decorFxId,
	parseDecorId,
	requiredBaseAnimations,
	type BiomeId,
} from "../../contract";
import { ThemeCore } from "../../core";
import type { SpriteSetAsset } from "../../types";
import { ThemePack, hexToColor3 } from "../../pack";
import { contains, deepClone, sortedKeys, startsWith } from "../../util";
import { contrastReport, juiceContrastReport, validateManifest } from "../../validate";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_AUDIO_FILES } from "./audioLayout";
import { VALE_FLOOR_HEX, VALE_IMAGE_LAYOUTS, VALE_SPRITE_LAYOUTS, VALE_WORLD_LAYOUTS } from "./layout";
import {
	VALE_BIOME_MATERIALS,
	VALE_DECOR_PIECES,
	VALE_MANIFEST,
	VALE_RETIRED_WORLD_ART,
	buildValeManifest,
} from "./manifest";

const quiet = () => undefined;

/** Every art/build file the layout names (outline sheets included), sorted. */
function allFiles(): Array<string> {
	const files = new Array<string>();
	for (const id of sortedKeys(VALE_SPRITE_LAYOUTS)) {
		for (const sheet of VALE_SPRITE_LAYOUTS[id].sheets) {
			files.push(sheet.file);
			if (sheet.outlineFile !== undefined) {
				files.push(sheet.outlineFile);
			}
		}
	}
	for (const id of sortedKeys(VALE_IMAGE_LAYOUTS)) {
		files.push(VALE_IMAGE_LAYOUTS[id].file);
	}
	// world art (docs/DECOR.md R5): pieces share their atlas, so each file once
	for (const name of sortedKeys(VALE_WORLD_LAYOUTS)) {
		const l = VALE_WORLD_LAYOUTS[name];
		for (const file of l.kind === "image" ? [l.file] : l.sheets.map((sheet) => sheet.file)) {
			if (!files.includes(file)) files.push(file);
		}
	}
	for (const file of sortedKeys(VALE_AUDIO_FILES)) {
		files.push(file);
	}
	files.sort();
	return files;
}

/** A fake uploaded ID for every file (test vectors; src/shared/theme is exempt from check-asset-ids). */
function fakeIds(...skip: Array<string>): Record<string, string> {
	const ids: Record<string, string> = {};
	allFiles().forEach((file, i) => {
		if (!skip.includes(file)) {
			ids[file] = `rbxassetid://${9000 + i}`;
		}
	});
	return ids;
}

describe("vale pack", () => {
	it("validates with zero problems as bundled", () => {
		expect(validateManifest(VALE_MANIFEST, { packId: "vale" })).toEqual([]);
	});

	it("with no uploaded IDs draws what the placeholder pack draws, plus the biome materials (no upload needed)", () => {
		const m = buildValeManifest({});
		expect(m.colors).toEqual(PLACEHOLDER_MANIFEST.colors);
		for (const id of sortedKeys(PLACEHOLDER_MANIFEST.biomes)) {
			const biome = deepClone(m.biomes[id]);
			expect([id, biome.materials]).toEqual([id, VALE_BIOME_MATERIALS[id as BiomeId]]);
			biome.materials = undefined;
			expect([id, biome]).toEqual([id, PLACEHOLDER_MANIFEST.biomes[id]]);
		}
		expect(m.strings).toEqual(PLACEHOLDER_MANIFEST.strings);
		for (const id of sortedKeys(PLACEHOLDER_MANIFEST.assets)) {
			expect([id, m.assets[id]]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
		}
		// the ui IDs the renderer asks for exist either way
		expect(m.assets["ui.ring.player"]).toEqual({ kind: "placeholder" });
		expect(m.assets["ui.marker.pedestal"]).toEqual({ kind: "placeholder" });
		expect(m.id).toBe("vale");
		expect(m.name).toBe("Vale");
	});

	it("every uploaded ID names a real art/build file", () => {
		const files = allFiles();
		for (const file of sortedKeys(VALE_ASSET_IDS)) {
			expect([file, files.includes(file)]).toEqual([file, true]);
		}
	});

	it("every enemy sprite set has an outline sheet per sheet; the player's sets have none", () => {
		// art/atlases.json: each enemy set needs `outline` (enemy outline plan O3), or its sprites draw without a rim
		let enemies = 0;
		for (const id of sortedKeys(VALE_SPRITE_LAYOUTS)) {
			const enemy = id.sub(1, 6) === "enemy.";
			if (enemy) {
				enemies += 1;
			}
			for (const sheet of VALE_SPRITE_LAYOUTS[id].sheets) {
				const expected = enemy ? `${sheet.file.sub(1, -5)}-outline.png` : undefined;
				expect([id, sheet.file, sheet.outlineFile]).toEqual([id, sheet.file, expected]);
			}
		}
		expect(enemies).toBeGreaterThan(0);
		expect(VALE_SPRITE_LAYOUTS["enemy.swarmer"].sheets[0].outlineFile).toBe("swarmer-move-outline.png");
		expect(VALE_SPRITE_LAYOUTS["enemy.swarmer"].sheets[1].outlineFile).toBe("swarmer-death-outline.png");
	});

	it("the bundled pack is built from assetIds.ts", () => {
		expect(VALE_MANIFEST).toEqual(buildValeManifest(VALE_ASSET_IDS));
	});

	it("as bundled, enemy.swarmer is its sprite set with a rim on every sheet (re-uploaded after the O3 pad change)", () => {
		// All four swarmer files (two atlases, two outline sheets) have IDs, so the skeleton draws with its baked rim.
		for (const file of [
			"swarmer-move.png",
			"swarmer-death.png",
			"swarmer-move-outline.png",
			"swarmer-death-outline.png",
		]) {
			expect([file, VALE_ASSET_IDS[file] !== undefined]).toEqual([file, true]);
		}
		expect(VALE_MANIFEST.assets["enemy.swarmer"].kind).toBe("sprites");
		const set = new ThemePack(VALE_MANIFEST, { warn: quiet }).sprites("enemy.swarmer")!;
		expect(set).never.toBe(undefined);
		expect(set.frame("move", 0, 0).outlineImage).toBe(VALE_ASSET_IDS["swarmer-move-outline.png"]);
		expect(set.frame("death", 0, 0).outlineImage).toBe(VALE_ASSET_IDS["swarmer-death-outline.png"]);
		expect(set.frame("move", 0, 0).image).toBe(VALE_ASSET_IDS["swarmer-move.png"]);
		expect(set.frame("death", 0, 0).image).toBe(VALE_ASSET_IDS["swarmer-death.png"]);
		// the player's set is unaffected and has no rim
		expect(VALE_MANIFEST.assets["class.vanguard"].kind).toBe("sprites");
	});

	it("maps each sheet's outline file to outlineAssetId when uploaded", () => {
		const ids = fakeIds();
		const set = buildValeManifest(ids).assets["enemy.swarmer"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(set.sheets).toEqual([
			{
				assetId: ids["swarmer-move.png"],
				w: 980,
				h: 962,
				outlineAssetId: ids["swarmer-move-outline.png"],
			},
			{
				assetId: ids["swarmer-death.png"],
				w: 980,
				h: 962,
				outlineAssetId: ids["swarmer-death-outline.png"],
			},
		]);
		// every frame carries its own sheet's outline
		const pack = new ThemePack(buildValeManifest(ids), { warn: quiet });
		const sprites = pack.sprites("enemy.swarmer")!;
		expect(sprites.frame("move", 3, 2).outlineImage).toBe(ids["swarmer-move-outline.png"]);
		expect(sprites.frame("death", 3, 2).outlineImage).toBe(ids["swarmer-death-outline.png"]);
		// the player's sheets have no outline file, so no outline
		const vanguard = buildValeManifest(ids).assets["class.vanguard"] as SpriteSetAsset;
		for (const sheet of vanguard.sheets) {
			expect(sheet.outlineAssetId).toBe(undefined);
		}
		expect(pack.sprites("class.vanguard")!.frame("run", 0, 0).outlineImage).toBe(undefined);
	});

	it("a set whose outline sheets are not uploaded still switches on, rimless", () => {
		const m = buildValeManifest(fakeIds("swarmer-move-outline.png", "swarmer-death-outline.png"));
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = m.assets["enemy.swarmer"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(set.sheets.size()).toBe(2);
		for (const sheet of set.sheets) {
			expect(sheet.outlineAssetId).toBe(undefined);
		}
		const sprites = new ThemePack(m, { warn: quiet }).sprites("enemy.swarmer")!;
		expect(sprites).never.toBe(undefined);
		expect(sprites.frame("move", 0, 0).outlineImage).toBe(undefined);
		expect(sprites.frame("death", 0, 0).outlineImage).toBe(undefined);
		// one outline uploaded: only its sheet has a rim
		const half = buildValeManifest(fakeIds("swarmer-death-outline.png"));
		expect(validateManifest(half, { packId: "vale" })).toEqual([]);
		const halfSet = new ThemePack(half, { warn: quiet }).sprites("enemy.swarmer")!;
		expect(halfSet.frame("move", 0, 0).outlineImage).toBe(fakeIds()["swarmer-move-outline.png"]);
		expect(halfSet.frame("death", 0, 0).outlineImage).toBe(undefined);
		// outline sheets alone never switch a set on: both outlines uploaded, neither atlas
		const outlinesOnlyIds = fakeIds("swarmer-move.png", "swarmer-death.png");
		expect(outlinesOnlyIds["swarmer-move-outline.png"]).never.toBe(undefined);
		expect(outlinesOnlyIds["swarmer-death-outline.png"]).never.toBe(undefined);
		const outlinesOnly = buildValeManifest(outlinesOnlyIds);
		expect(outlinesOnly.assets["enemy.swarmer"]).toEqual({ kind: "placeholder" });
	});

	it("with every file uploaded validates with zero problems (layout fits the contract v2 validator)", () => {
		const m = buildValeManifest(fakeIds());
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		expect(m.assets["class.vanguard"].kind).toBe("sprites");
		expect(m.assets["enemy.swarmer"].kind).toBe("sprites");
		expect(m.assets["tile.biome.1.floor"]).toEqual({
			kind: "image",
			assetId: fakeIds()["tile-biome1-floor.png"],
			w: 256,
			h: 256,
			tilesPerImage: 4,
		});
		expect(m.assets["ui.ring.player"].kind).toBe("image");
		expect(m.assets["ui.marker.pedestal"]).toEqual({
			kind: "image",
			assetId: fakeIds()["ui-marker-pedestal.png"],
			w: 8,
			h: 103,
			pivot: { x: 4, y: 100 },
		});
		// the pivot reaches the renderer through ThemePack.image
		const p = new ThemePack(m, { warn: quiet });
		expect(p.image("ui.marker.pedestal")!.pivot).toEqual({ x: 4, y: 100 });
		expect(p.image("ui.ring.player")!.pivot).toEqual({ x: 20.5, y: 15.5 });
		expect(p.image("tile.biome.1.floor")!.pivot).toBe(undefined);
	});

	it("is deterministic and never mutates the placeholder manifest", () => {
		expect(buildValeManifest(fakeIds())).toEqual(buildValeManifest(fakeIds()));
		expect(PLACEHOLDER_MANIFEST.id).toBe("placeholder");
		expect(PLACEHOLDER_MANIFEST.assets["class.vanguard"]).toEqual({ kind: "placeholder" });
		expect(PLACEHOLDER_MANIFEST.assets["ui.ring.player"]).toBe(undefined);
		expect(PLACEHOLDER_MANIFEST.biomes["biome.1"].floor).never.toBe(VALE_FLOOR_HEX);
	});

	it("a set missing a required sheet stays a placeholder; the others switch", () => {
		const m = buildValeManifest(fakeIds("vanguard-run.png"));
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		expect(m.assets["class.vanguard"]).toEqual({ kind: "placeholder" });
		expect(m.assets["enemy.swarmer"].kind).toBe("sprites");
		const pack = new ThemePack(m, { warn: quiet });
		expect(pack.sprites("class.vanguard")).toBe(undefined);
		expect(pack.sprites("enemy.swarmer")).never.toBe(undefined);

		const noRing = buildValeManifest(fakeIds("ui-ring-player.png"));
		expect(noRing.assets["ui.ring.player"]).toEqual({ kind: "placeholder" });
		expect(noRing.assets["ui.marker.pedestal"].kind).toBe("image");
	});

	it("an optional animation without its sheet is left out; the set still switches", () => {
		const m = buildValeManifest(fakeIds("vanguard-attack1.png", "vanguard-attack2.png", "vanguard-attack3.png"));
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = m.assets["class.vanguard"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(sortedKeys(set.animations)).toEqual(["death", "hit", "idle", "roll", "run"]);
		expect(set.sheets.size()).toBe(5);
		// every kept animation points at the sheet holding its own file's ID
		for (const name of sortedKeys(set.animations)) {
			const layoutSheet = VALE_SPRITE_LAYOUTS["class.vanguard"].animations[name].sheet;
			const file = VALE_SPRITE_LAYOUTS["class.vanguard"].sheets[layoutSheet].file;
			expect(set.sheets[set.animations[name].sheet].assetId).toBe(fakeIds()[file]);
		}
		const pack = new ThemePack(m, { warn: quiet });
		expect(pack.sprites("class.vanguard")!.has("attack.1")).toBe(false);
		expect(pack.sprites("class.vanguard")!.has("run")).toBe(true);
	});

	it("the floor colour follows the texture, and the contrast checks pass with it", () => {
		const m = buildValeManifest(fakeIds());
		expect(m.biomes["biome.1"].floor).toBe(VALE_FLOOR_HEX);
		for (const e of contrastReport(m)) {
			expect([e.biome, e.surface, e.ok]).toEqual([e.biome, e.surface, true]);
		}
		for (const e of juiceContrastReport(m)) {
			expect([e.check, e.role, e.against, e.ok]).toEqual([e.check, e.role, e.against, true]);
		}
		const noFloor = buildValeManifest(fakeIds("tile-biome1-floor.png"));
		expect(noFloor.biomes["biome.1"].floor).toBe(PLACEHOLDER_MANIFEST.biomes["biome.1"].floor);
	});
});

describe("vale biome materials (docs/DECOR.md R1)", () => {
	it("gives every biome a wall material distinct from its floor, and no glowing surface", () => {
		for (const b of BIOMES) {
			const mats = VALE_BIOME_MATERIALS[b.id];
			expect([b.id, mats.floor !== undefined, mats.wall !== undefined]).toEqual([b.id, true, true]);
			expect([b.id, mats.floor === mats.wall]).toEqual([b.id, false]);
			for (const s of BIOME_MATERIAL_SURFACES) {
				const name = mats[s];
				expect([b.id, s, name === undefined || BIOME_MATERIALS.includes(name)]).toEqual([b.id, s, true]);
			}
		}
	});

	it("a textured floor stays SmoothPlastic; walls and pools keep their materials", () => {
		// as bundled, biome.1's stone texture is uploaded
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect(pack.image("tile.biome.1.floor")?.tilesPerImage).never.toBe(undefined);
		expect(pack.biome("biome.1").materials).toEqual({
			floor: DEFAULT_BIOME_MATERIAL,
			wall: VALE_BIOME_MATERIALS["biome.1"].wall,
			pool: DEFAULT_BIOME_MATERIAL,
		});
		expect(pack.biome("biome.2").materials).toEqual({ floor: "Basalt", wall: "Rock", pool: "CrackedLava" });
		// without the texture, biome.1's floor gets its material
		const noFloor = new ThemePack(buildValeManifest(fakeIds("tile-biome1-floor.png")), { warn: quiet });
		expect(noFloor.biome("biome.1").materials.floor).toBe(VALE_BIOME_MATERIALS["biome.1"].floor);
		expect(validateManifest(buildValeManifest(fakeIds("tile-biome1-floor.png")), { packId: "vale" })).toEqual([]);
	});
});

describe("vale sprite cells (hand-computed from the generated layout)", () => {
	const ids = fakeIds();
	const core = new ThemeCore(buildValeManifest(ids), { warn: quiet });
	const pack = new ThemePack(buildValeManifest(ids), { warn: quiet });

	it("class.vanguard: 128 px cells, 8 per row, one animation per 1024 atlas", () => {
		const set = core.sprites("class.vanguard");
		expect(set).never.toBe(undefined);
		// run: sheet 1, facing 2 (screen up), frame 3 -> cell 2 * 8 + 3 = 19 -> column 3, row 2
		expect(set!.frame("run", 2, 3)).toEqual({
			sheet: 1,
			assetId: ids["vanguard-run.png"],
			x: 384,
			y: 256,
			w: 128,
			h: 128,
		});
		// attack.3: last facing, last frame -> cell 63, the bottom-right cell
		const last = set!.frame("attack.3", 7, 7);
		expect([last.sheet, last.assetId, last.x, last.y]).toEqual([7, ids["vanguard-attack3.png"], 896, 896]);
		// death holds its last frame
		expect(set!.frame("death", 0, 99)).toEqual(set!.frame("death", 0, 7));
		expect(set!.pivot).toEqual({ x: 67, y: 105 });
		expect(set!.facings).toEqual({ count: 8, zeroDeg: 0, ccw: true });
	});

	it("enemy.swarmer: 98x74 cells (pad 3 for the outline), 10 per row, move and death on two atlases", () => {
		const set = core.sprites("enemy.swarmer");
		expect(set).never.toBe(undefined);
		expect(VALE_SPRITE_LAYOUTS["enemy.swarmer"].sheets.map((s) => [s.w, s.h])).toEqual([
			[980, 962],
			[980, 962],
		]);
		// move: facing 5, frame 6 -> cell 46 -> column 6, row 4
		expect(set!.frame("move", 5, 6)).toEqual({
			sheet: 0,
			assetId: ids["swarmer-move.png"],
			outlineAssetId: ids["swarmer-move-outline.png"],
			x: 588,
			y: 296,
			w: 98,
			h: 74,
		});
		// idle = move frame 0 held (stride 8): facing 3 -> cell 24 -> column 4, row 2, every index
		const idle = set!.frame("idle", 3, 5);
		expect([idle.sheet, idle.x, idle.y]).toEqual([0, 392, 148]);
		// death: facing 15, frame 7 -> cell 127 -> column 7, row 12 of the second atlas
		const death = set!.frame("death", 15, 7);
		expect([death.sheet, death.assetId, death.outlineAssetId, death.x, death.y]).toEqual([
			1,
			ids["swarmer-death.png"],
			ids["swarmer-death-outline.png"],
			686,
			888,
		]);
		// the pad grew by 2 on each side, so the feet moved by (2, 2) in the cell (was (40, 49) at pad 1)
		expect(set!.pivot).toEqual({ x: 42, y: 51 });
		// facings wrap: 16 is 0, -1 is 15
		expect(set!.frame("move", 16, 0)).toEqual(set!.frame("move", 0, 0));
		expect(set!.frame("move", -1, 2)).toEqual(set!.frame("move", 15, 2));
	});

	it("ThemePack.sprites gives the same rects as Vector2s", () => {
		const set = pack.sprites("enemy.swarmer");
		expect(set).never.toBe(undefined);
		const f = set!.frame("move", 5, 6);
		expect(f.image).toBe(ids["swarmer-move.png"]);
		expect(f.outlineImage).toBe(ids["swarmer-move-outline.png"]);
		expect([f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual([588, 296, 98, 74]);
		expect(set!.resample).toBe("Default");
		expect(pack.texture("tile.biome.1.floor")).toBe(ids["tile-biome1-floor.png"]);
	});
});

describe("vale enemy.sniper (docs/SNIPER_ART.md SN5: the Lords of Pain subservient)", () => {
	const SHEET = "sniper-idle.png";
	const OUTLINE = "sniper-idle-outline.png";
	const layout = VALE_SPRITE_LAYOUTS["enemy.sniper"];

	it("the layout: one 1008x744 atlas of 126x93 cells, 16 facings, the skeleton's exact scale, an outline sheet", () => {
		expect(layout).never.toBe(undefined);
		expect([layout.frameW, layout.frameH]).toEqual([126, 93]);
		expect(layout.sheets).toEqual([{ file: SHEET, w: 1008, h: 744, outlineFile: OUTLINE }]);
		expect(layout.facings).toEqual({ count: 16, zeroDeg: 0, ccw: true });
		// pixelsPerTileFrom "enemy.swarmer" (D6): the two Lords of Pain enemies share one texel density
		expect(layout.pixelsPerTile).toBe(29.6);
		expect(layout.pixelsPerTile).toBe(VALE_SPRITE_LAYOUTS["enemy.swarmer"].pixelsPerTile);
		expect(layout.pivot).toEqual({ x: 56, y: 57 });
		// one real animation (worship 0, 2, 4, 6); every other one reuses its cells
		expect(layout.animations.idle).toEqual({ sheet: 0, start: 0, frames: 4, fps: 6, loop: true });
		expect(layout.animations.attack).toEqual({ sheet: 0, start: 0, frames: 4, fps: 6, loop: true });
		for (const name of ["move", "hit", "death"]) {
			const a = layout.animations[name];
			expect([name, a.sheet, a.start, a.frames, a.stride]).toEqual([name, 0, 0, 1, 4]);
		}
	});

	it("with no IDs it is the placeholder; an outline alone, or any other file, never switches it on", () => {
		expect(buildValeManifest({}).assets["enemy.sniper"]).toEqual({ kind: "placeholder" });
		expect(buildValeManifest({}).assets["enemy.sniper"]).toEqual(PLACEHOLDER_MANIFEST.assets["enemy.sniper"]);
		const noAtlas = buildValeManifest(fakeIds(SHEET));
		expect(validateManifest(noAtlas, { packId: "vale" })).toEqual([]);
		expect(noAtlas.assets["enemy.sniper"]).toEqual({ kind: "placeholder" });
		expect(fakeIds(SHEET)[OUTLINE]).never.toBe(undefined);
		// the other sets are unaffected
		expect(noAtlas.assets["enemy.swarmer"].kind).toBe("sprites");
		expect(new ThemePack(noAtlas, { warn: quiet }).sprites("enemy.sniper")).toBe(undefined);
	});

	it("with sniper-idle.png it switches to sprites: 16 facings, 29.6 px/tile, every required animation", () => {
		const ids = fakeIds();
		const m = buildValeManifest(ids);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = m.assets["enemy.sniper"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(set.pixelsPerTile).toBe(29.6);
		expect(set.facings.count).toBe(16);
		expect(set.sheets).toEqual([{ assetId: ids[SHEET], w: 1008, h: 744, outlineAssetId: ids[OUTLINE] }]);
		const sprites = new ThemeCore(m, { warn: quiet }).sprites("enemy.sniper");
		expect(sprites).never.toBe(undefined);
		const required = requiredBaseAnimations(ENEMY);
		expect(required).toEqual(["idle", "move", "attack", "hit", "death"]);
		for (const name of required) {
			expect([name, sprites!.has(name)]).toEqual([name, true]);
		}
		expect(sprites!.animationNames).toEqual(["attack", "death", "hit", "idle", "move"]);
	});

	it("the rim joins only with sniper-idle-outline.png and never holds the set back", () => {
		const m = buildValeManifest(fakeIds(OUTLINE));
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = m.assets["enemy.sniper"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(set.sheets.size()).toBe(1);
		expect(set.sheets[0].outlineAssetId).toBe(undefined);
		const sprites = new ThemePack(m, { warn: quiet }).sprites("enemy.sniper")!;
		expect(sprites).never.toBe(undefined);
		expect(sprites.frame("idle", 0, 0).outlineImage).toBe(undefined);
		expect(sprites.frame("attack", 12, 3).outlineImage).toBe(undefined);
		// with the outline uploaded the same frames carry it
		const ids = fakeIds();
		const rimmed = new ThemePack(buildValeManifest(ids), { warn: quiet }).sprites("enemy.sniper")!;
		expect(rimmed.frame("idle", 0, 0).outlineImage).toBe(ids[OUTLINE]);
	});

	it("every sniper frame (every animation, facing and frame) carries its sheet's outline", () => {
		const ids = fakeIds();
		const sprites = new ThemeCore(buildValeManifest(ids), { warn: quiet }).sprites("enemy.sniper")!;
		expect(sprites).never.toBe(undefined);
		let frames = 0;
		for (const name of sprites.animationNames) {
			const count = sprites.animation(name)!.frames;
			for (let d = 0; d < 16; d++) {
				for (let f = 0; f < count; f++) {
					const r = sprites.frame(name, d, f);
					expect([name, d, f, r.sheet, r.assetId, r.outlineAssetId]).toEqual([
						name,
						d,
						f,
						0,
						ids[SHEET],
						ids[OUTLINE],
					]);
					frames += 1;
				}
			}
		}
		// idle and attack 4 frames, move / hit / death 1, over 16 facings
		expect(frames).toBe(16 * (4 + 4 + 1 + 1 + 1));
	});

	it("cells (hand-computed): 8 per row; the stand-ins address idle's cells", () => {
		const ids = fakeIds();
		const sprites = new ThemeCore(buildValeManifest(ids), { warn: quiet }).sprites("enemy.sniper")!;
		// idle: facing 5, frame 3 -> cell 23 -> column 7, row 2
		expect(sprites.frame("idle", 5, 3)).toEqual({
			sheet: 0,
			assetId: ids[SHEET],
			outlineAssetId: ids[OUTLINE],
			x: 882,
			y: 186,
			w: 126,
			h: 93,
		});
		// the last cell: facing 15, frame 3 -> cell 63 -> column 7, row 7 (the atlas's bottom-right corner)
		const last = sprites.frame("idle", 15, 3);
		expect([last.x, last.y, last.x + last.w, last.y + last.h]).toEqual([882, 651, 1008, 744]);
		// move / hit / death = idle frame 0 held (stride 4): facing 3 -> cell 12 -> column 4, row 1, every index
		for (const name of ["move", "hit", "death"]) {
			const r = sprites.frame(name, 3, 2);
			expect([name, r.x, r.y]).toEqual([name, 504, 93]);
		}
		// attack plays idle's four cells
		for (let f = 0; f < 4; f++) {
			expect(sprites.frame("attack", 9, f)).toEqual(sprites.frame("idle", 9, f));
		}
		expect(sprites.pivot).toEqual({ x: 56, y: 57 });
	});
});

describe("vale boost drops (docs/BOOST_ART.md BA2: Lords of Pain gold coins and gemstones, the white beam)", () => {
	/** The decor atlas holds decor.fx.glow (the drops' halo) and decor.fx.glint. */
	const DECOR_ATLAS = "decor-atlas.png";
	const BEAM_FILE = "ui-marker-boost.png";
	const fileOf = (kind: (typeof BOOST_KINDS)[number]) => VALE_IMAGE_LAYOUTS[boostId(kind)].file;

	it("has an image layout for every boost kind (and no other boost.* image), at the props' scale", () => {
		for (const kind of BOOST_KINDS) {
			const layout = VALE_IMAGE_LAYOUTS[boostId(kind)];
			expect([kind, layout !== undefined]).toEqual([kind, true]);
			expect([kind, layout.file]).toEqual([kind, `boost-${kind}.png`]);
			// art/atlases.json pixelsPerTileFrom "enemy.swarmer": the decor props' and skeleton's texel density
			expect([kind, layout.pixelsPerTile]).toEqual([kind, VALE_SPRITE_LAYOUTS["enemy.swarmer"].pixelsPerTile]);
			expect([kind, layout.pivot]).toEqual([kind, { x: layout.w / 2, y: layout.h / 2 }]);
		}
		const boostLayouts = sortedKeys(VALE_IMAGE_LAYOUTS).filter((id) => id.sub(1, 6) === "boost.");
		expect(boostLayouts).toEqual(BOOST_KINDS.map((k) => boostId(k)).sort());
		expect(VALE_IMAGE_LAYOUTS[BOOST_BEAM_IMAGE_ID]).toEqual({
			file: BEAM_FILE,
			w: 8,
			h: 103,
			pivot: { x: 4, y: 100 },
		});
	});

	it("before their files have IDs: the placeholder gem and no beam, as in the placeholder pack", () => {
		const m = buildValeManifest(fakeIds(BEAM_FILE, ...BOOST_KINDS.map(fileOf)));
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		for (const kind of BOOST_KINDS) {
			expect([kind, m.assets[boostId(kind)]]).toEqual([kind, PLACEHOLDER_MANIFEST.assets[boostId(kind)]]);
			expect([kind, m.assets[boostId(kind)]]).toEqual([kind, { kind: "placeholder" }]);
		}
		expect(m.assets[BOOST_BEAM_IMAGE_ID]).toEqual({ kind: "placeholder" });
		const pack = new ThemePack(m, { warn: quiet });
		expect(pack.image(BOOST_BEAM_IMAGE_ID)).toBe(undefined);
		for (const kind of BOOST_KINDS) expect([kind, pack.boost(kind).art]).toEqual([kind, undefined]);
		expect(buildValeManifest({}).assets[BOOST_BEAM_IMAGE_ID]).toEqual({ kind: "placeholder" });
	});

	it("with their files uploaded: an image per kind that keeps its colour role, the halo and glint, the beam", () => {
		const ids = fakeIds();
		const m = buildValeManifest(ids);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		for (const kind of BOOST_KINDS) {
			const id = boostId(kind);
			const layout = VALE_IMAGE_LAYOUTS[id];
			expect([kind, m.assets[id]]).toEqual([
				kind,
				{
					kind: "image",
					assetId: ids[layout.file],
					w: layout.w,
					h: layout.h,
					pivot: { x: layout.pivot!.x, y: layout.pivot!.y },
					pixelsPerTile: 29.6,
				},
			]);
			const b = pack.boost(kind);
			expect([kind, b.art?.kind]).toEqual([kind, "image"]);
			expect(b.art).toMatchObject({ image: ids[layout.file], pixelsPerTile: 29.6, pivot: layout.pivot });
			// the colour role is the kind's own (HUD row, aura, halo / beam tint), unchanged by the art
			expect([kind, b.core.role]).toEqual([kind, id]);
			expect([kind, m.colors[id]]).toEqual([kind, PLACEHOLDER_MANIFEST.colors[id]]);
			expect(b.color).toEqual(hexToColor3(PLACEHOLDER_MANIFEST.colors[id]));
		}
		// the halo and the sparkle are the decor effects (BOOST_HALO_FX / BOOST_GLINT_FX), already in the decor atlas
		expect(pack.decor(decorFxId(BOOST_HALO_FX))).never.toBe(undefined);
		expect(pack.decor(decorFxId(BOOST_GLINT_FX))).never.toBe(undefined);
		const beam = pack.image(BOOST_BEAM_IMAGE_ID)!;
		expect([beam.assetId, beam.w, beam.h, beam.pivot]).toEqual([ids[BEAM_FILE], 8, 103, { x: 4, y: 100 }]);
	});

	it("boost art without the decor atlas (no halo) fails BA-P2, naming every boost", () => {
		const m = buildValeManifest(fakeIds(DECOR_ATLAS));
		expect(m.assets[decorFxId(BOOST_HALO_FX)]).toBe(undefined);
		const errors = validateManifest(m, { packId: "vale" });
		expect(errors.size()).toBe(BOOST_KINDS.size());
		BOOST_KINDS.forEach((kind, i) => {
			const prefix = `assets["${boostId(kind)}"]: boost art needs "decor.fx.glow" art too`;
			expect([kind, startsWith(errors[i], prefix)]).toEqual([kind, true]);
		});
	});

	it("as bundled, each boost kind is art exactly when its file has an ID in assetIds.ts", () => {
		for (const kind of BOOST_KINDS) {
			const uploaded = VALE_ASSET_IDS[fileOf(kind)] !== undefined;
			expect([kind, VALE_MANIFEST.assets[boostId(kind)].kind]).toEqual([
				kind,
				uploaded ? "image" : "placeholder",
			]);
		}
		// the halo is already uploaded (the decor atlas), so uploading the drops is enough
		expect(VALE_ASSET_IDS[DECOR_ATLAS]).never.toBe(undefined);
	});
});

describe("vale decor has no gemstones (docs/BOOST_ART.md decision 2)", () => {
	it("maps no decor ID onto gem art, in any biome, with every file uploaded", () => {
		for (const p of VALE_DECOR_PIECES) {
			expect([p.kind, p.art, p.art.sub(1, 5) === "gems-"]).toEqual([p.kind, p.art, false]);
		}
		const m = buildValeManifest(fakeIds());
		for (const id of sortedKeys(m.assets)) {
			const info = parseDecorId(id);
			if (info === undefined) continue;
			expect([id, contains(id, "gems")]).toEqual([id, false]);
		}
	});

	it("keeps the four gems-* pieces in the uploaded decor atlas until its next rebuild (unused)", () => {
		expect([...VALE_RETIRED_WORLD_ART]).toEqual(["gems-blue", "gems-green", "gems-red", "gems-white"]);
		for (const name of VALE_RETIRED_WORLD_ART) {
			expect([name, VALE_WORLD_LAYOUTS[name] !== undefined]).toEqual([name, true]);
		}
	});
});
