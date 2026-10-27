// The vale pack (docs/ART.md S5): the generated atlas layout must satisfy the contract v2 validator once uploaded, the
// runtime must address the cells the pipeline wrote, and entries without uploaded art must stay placeholders.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BIOMES,
	BIOME_MATERIALS,
	BIOME_MATERIAL_SURFACES,
	DEFAULT_BIOME_MATERIAL,
	ENEMY,
	requiredBaseAnimations,
	type BiomeId,
} from "../../contract";
import { ThemeCore } from "../../core";
import type { SpriteSetAsset } from "../../types";
import { ThemePack } from "../../pack";
import { deepClone, sortedKeys } from "../../util";
import { contrastReport, juiceContrastReport, validateManifest } from "../../validate";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_AUDIO_FILES } from "./audioLayout";
import {
	VALE_FLOOR_HEX,
	VALE_IMAGE_LAYOUTS,
	VALE_SPRITE_LAYOUTS,
	VALE_WORLD_LAYOUTS,
	type ValeSpriteLayout,
} from "./layout";
import { VALE_BIOME_MATERIALS, VALE_MANIFEST, buildValeManifest, valeSpriteAsset } from "./manifest";

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

	it("every enemy and boss sprite set has an outline sheet per sheet; the player's sets have none", () => {
		// art/atlases.json: each enemy / boss set needs `outline` (enemy outline plan O3), or its sprites draw without a
		// rim (bosses take the enemy rim too: their placeholder has the outline role)
		let enemies = 0;
		let bosses = 0;
		for (const id of sortedKeys(VALE_SPRITE_LAYOUTS)) {
			const enemy = id.sub(1, 6) === "enemy." || id.sub(1, 5) === "boss.";
			if (enemy) {
				enemies += 1;
			}
			if (id.sub(1, 5) === "boss.") {
				bosses += 1;
			}
			for (const sheet of VALE_SPRITE_LAYOUTS[id].sheets) {
				const expected = enemy ? `${sheet.file.sub(1, -5)}-outline.png` : undefined;
				expect([id, sheet.file, sheet.outlineFile]).toEqual([id, sheet.file, expected]);
			}
		}
		expect(enemies).toBeGreaterThan(0);
		expect(bosses).toBeGreaterThan(0);
		expect(VALE_SPRITE_LAYOUTS["boss.demonlord"].sheets.map((sheet) => sheet.outlineFile)).toEqual([
			"demonlord-idle-outline.png",
			"demonlord-move-outline.png",
			"demonlord-attack-outline.png",
			"demonlord-attack2-outline.png",
			"demonlord-intro-outline.png",
			"demonlord-taunt-outline.png",
			"demonlord-death-outline.png",
		]);
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

	it("as bundled, boss.demonlord is its placeholder: none of its 14 files has an ID yet", () => {
		for (const sheet of VALE_SPRITE_LAYOUTS["boss.demonlord"].sheets) {
			expect([sheet.file, VALE_ASSET_IDS[sheet.file]]).toEqual([sheet.file, undefined]);
			expect([sheet.outlineFile, VALE_ASSET_IDS[sheet.outlineFile!]]).toEqual([sheet.outlineFile, undefined]);
		}
		expect(VALE_MANIFEST.assets["boss.demonlord"]).toEqual({ kind: "placeholder" });
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect(pack.sprites("boss.demonlord")).toBe(undefined);
		expect(pack.placeholder("boss.demonlord").outline).toBe("enemyOutline");
		expect(pack.str("boss.demonlord.name")).toBe("The Demon Lord");
	});

	it("boss.demonlord switches on with its required sheets; optional ones join when uploaded; outlines never gate", () => {
		const optional = ["demonlord-attack2.png", "demonlord-intro.png", "demonlord-taunt.png"];
		const outlines = VALE_SPRITE_LAYOUTS["boss.demonlord"].sheets.map((sheet) => sheet.outlineFile!);
		// required: idle (hit reuses its cells), move, attack, death. Without the optional sheets and every outline:
		const skipped = [...optional];
		for (const file of outlines) skipped.push(file);
		const core = buildValeManifest(fakeIds(...skipped));
		expect(validateManifest(core, { packId: "vale" })).toEqual([]);
		const set = core.assets["boss.demonlord"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(sortedKeys(set.animations)).toEqual(["attack", "death", "hit", "idle", "move"]);
		expect(set.sheets.map((sheet) => sheet.assetId)).toEqual(
			["demonlord-idle.png", "demonlord-move.png", "demonlord-attack.png", "demonlord-death.png"].map(
				(file) => fakeIds()[file],
			),
		);
		for (const sheet of set.sheets) {
			expect(sheet.outlineAssetId).toBe(undefined);
		}
		// hit = idle frame 0 held: the idle sheet, one frame, stride 8
		expect(set.animations.hit).toEqual({ sheet: 0, start: 0, frames: 1, fps: 1, loop: false, stride: 8 });
		expect(set.animations.death.sheet).toBe(3);
		// one optional sheet uploaded: only that animation joins
		const withJab = buildValeManifest(fakeIds("demonlord-intro.png", "demonlord-taunt.png"));
		expect(validateManifest(withJab, { packId: "vale" })).toEqual([]);
		const jab = new ThemePack(withJab, { warn: quiet }).sprites("boss.demonlord")!;
		expect([jab.has("attack.2"), jab.has("intro"), jab.has("taunt")]).toEqual([true, false, false]);
		expect(jab.frame("attack.2", 0, 0).image).toBe(fakeIds()["demonlord-attack2.png"]);
		// any required sheet missing: the placeholder, whatever else is uploaded
		for (const file of [
			"demonlord-idle.png",
			"demonlord-move.png",
			"demonlord-attack.png",
			"demonlord-death.png",
		]) {
			expect([file, buildValeManifest(fakeIds(file)).assets["boss.demonlord"]]).toEqual([
				file,
				{ kind: "placeholder" },
			]);
		}
		// outline sheets alone never switch it on
		const sheetsOnly = VALE_SPRITE_LAYOUTS["boss.demonlord"].sheets.map((sheet) => sheet.file);
		expect(buildValeManifest(fakeIds(...sheetsOnly)).assets["boss.demonlord"]).toEqual({ kind: "placeholder" });
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
		expect(m.assets["boss.demonlord"].kind).toBe("sprites");
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

	it("boss.demonlord: 98x78 half-res cells, 10 per row, one 980x1014 atlas (+ outline) per animation", () => {
		const set = core.sprites("boss.demonlord");
		expect(set).never.toBe(undefined);
		const layout = VALE_SPRITE_LAYOUTS["boss.demonlord"];
		expect(layout.sheets.map((s) => [s.w, s.h])).toEqual([
			[980, 1014],
			[980, 1014],
			[980, 1014],
			[980, 1014],
			[980, 1014],
			[980, 1014],
			[980, 1014],
		]);
		expect([layout.frameW, layout.frameH, layout.pixelsPerTile]).toEqual([98, 78, 10.5]);
		expect(set!.pivot).toEqual({ x: 39, y: 56 });
		expect(set!.facings).toEqual({ count: 16, zeroDeg: 0, ccw: true });
		// idle: facing 12 (S, towards the camera), frame 0 -> cell 96 -> column 6, row 9
		expect(set!.frame("idle", 12, 0)).toEqual({
			sheet: 0,
			assetId: ids["demonlord-idle.png"],
			outlineAssetId: ids["demonlord-idle-outline.png"],
			x: 588,
			y: 702,
			w: 98,
			h: 78,
		});
		// hit is idle frame 0 held, every index
		const hit = set!.frame("hit", 12, 5);
		expect([hit.sheet, hit.x, hit.y]).toEqual([0, 588, 702]);
		// attack.2: last facing, last frame -> cell 127 -> column 7, row 12 (the last row: 12 * 78 = 936, + 78 = 1014)
		const jab = set!.frame("attack.2", 15, 7);
		expect([jab.assetId, jab.outlineAssetId, jab.x, jab.y]).toEqual([
			ids["demonlord-attack2.png"],
			ids["demonlord-attack2-outline.png"],
			686,
			936,
		]);
		// the specials are one-shots that hold their last frame; idle and move loop
		for (const name of ["attack", "attack.2", "intro", "taunt", "death"]) {
			expect([name, set!.animation(name)!.loop]).toEqual([name, false]);
			expect([name, set!.frame(name, 3, 99)]).toEqual([name, set!.frame(name, 3, 7)]);
		}
		expect([set!.animation("idle")!.loop, set!.animation("move")!.loop]).toEqual([true, true]);
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

describe("vale per-sheet cells (docs/DEMON_ART.md DA2 / DD4)", () => {
	/**
	 * A layout as art:build writes it for a `cells: "perSheet"` set: idle trimmed to 44x78 (pivot 24, 67), move and
	 * death in the set's 99x113 cell (pivot 51, 89) but stated per sheet too. The layout.ts type declares the per-sheet
	 * fields only once a real set uses them, so this one is built as a wider object.
	 */
	const layout = {
		frameW: 99,
		frameH: 113,
		pivot: { x: 51, y: 89 },
		pixelsPerTile: 38,
		resample: "Default",
		facings: { count: 8, zeroDeg: 0, ccw: true },
		sheets: [
			{
				file: "b-idle.png",
				w: 176,
				h: 624,
				frameW: 44,
				frameH: 78,
				pivot: { x: 24, y: 67 },
				outlineFile: "b-idle-outline.png",
			},
			{ file: "b-move.png", w: 792, h: 904, frameW: 99, frameH: 113, pivot: { x: 51, y: 89 } },
		],
		animations: {
			idle: { sheet: 0, start: 0, frames: 4, fps: 6, loop: true },
			move: { sheet: 1, start: 0, frames: 8, fps: 10, loop: true },
			attack: { sheet: 1, start: 0, frames: 8, fps: 12, loop: false },
			hit: { sheet: 0, start: 0, frames: 1, stride: 4, fps: 1, loop: false },
			death: { sheet: 1, start: 0, frames: 8, fps: 10, loop: false },
		},
	} as unknown as ValeSpriteLayout;
	const ids = {
		"b-idle.png": "rbxassetid://9101",
		"b-idle-outline.png": "rbxassetid://9102",
		"b-move.png": "rbxassetid://9103",
	};

	it("copies each sheet's own frameW / frameH / pivot into the manifest; the set-level cell stays the union", () => {
		const set = valeSpriteAsset("enemy.bruiser", layout, ids)!;
		expect(set).never.toBe(undefined);
		expect([set.frameW, set.frameH, set.pivot, set.pixelsPerTile]).toEqual([99, 113, { x: 51, y: 89 }, 38]);
		expect(set.sheets).toEqual([
			{
				assetId: "rbxassetid://9101",
				w: 176,
				h: 624,
				frameW: 44,
				frameH: 78,
				pivot: { x: 24, y: 67 },
				outlineAssetId: "rbxassetid://9102",
			},
			{ assetId: "rbxassetid://9103", w: 792, h: 904, frameW: 99, frameH: 113, pivot: { x: 51, y: 89 } },
		]);
		// a copy: the manifest never aliases the layout's pivot
		expect(set.sheets[0].pivot).never.toBe((layout.sheets[0] as unknown as { pivot: unknown }).pivot);
	});

	it("validates and draws through the theme: idle frames in the idle cell with its pivot", () => {
		const m = buildValeManifest(fakeIds());
		m.assets["enemy.bruiser"] = valeSpriteAsset("enemy.bruiser", layout, ids)!;
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = new ThemePack(m, { warn: quiet }).sprites("enemy.bruiser")!;
		expect(set).never.toBe(undefined);
		// idle facing 5 frame 2: cell 22 of 4 per row -> column 2, row 5 of 44x78
		const f = set.frame("idle", 5, 2);
		expect([f.image, f.outlineImage, f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual([
			"rbxassetid://9101",
			"rbxassetid://9102",
			88,
			390,
			44,
			78,
		]);
		expect(f.pivot).toEqual({ x: 24, y: 67 });
		const g = set.frame("move", 7, 7);
		expect([g.offset.X, g.offset.Y, g.size.X, g.size.Y, g.pivot]).toEqual([693, 791, 99, 113, { x: 51, y: 89 }]);
	});

	it('only the `cells: "perSheet"` sets (enemy.bruiser, boss.act1) give their sheets their own cells', () => {
		const perSheet = ["boss.act1", "enemy.bruiser"];
		for (const id of sortedKeys(VALE_SPRITE_LAYOUTS)) {
			const own = perSheet.includes(id);
			for (const sheet of VALE_SPRITE_LAYOUTS[id].sheets) {
				const cells = sheet as unknown as { frameW?: number; frameH?: number; pivot?: unknown };
				const has = [cells.frameW !== undefined, cells.frameH !== undefined, cells.pivot !== undefined];
				expect([id, sheet.file, ...has]).toEqual([id, sheet.file, own, own, own]);
			}
		}
		const assets = buildValeManifest(fakeIds()).assets;
		for (const id of sortedKeys(assets)) {
			const asset = assets[id];
			if (asset.kind === "sprites") {
				const own = perSheet.includes(id);
				for (const sheet of (asset as SpriteSetAsset).sheets) {
					expect([id, sheet.frameW !== undefined, sheet.pivot !== undefined]).toEqual([id, own, own]);
				}
			}
		}
	});
});

/**
 * The 2D Demons sets (docs/DEMON_ART.md DA5, docs/BRAMBLE_ART.md BR6): enemy.bruiser (Demon Beast 3) and boss.act1
 * (Mother Bramble, Demon Elite 3), per-sheet cells, a rim on every sheet. All 20 files were uploaded 2026-10-26
 * (assetIds.ts), so the bundled pack draws both as sprite sets with their rims.
 */
describe("vale enemy.bruiser and boss.act1 (2D Demons, per-sheet cells)", () => {
	const BRUISER_SHEETS = ["bruiser-attack.png", "bruiser-body.png", "bruiser-death.png"];
	const BRAMBLE_REQUIRED = ["bramble-idle.png", "bramble-move.png", "bramble-attack1.png", "bramble-death.png"];
	const BRAMBLE_OPTIONAL = ["bramble-taunt.png", "bramble-attack2.png", "bramble-attack4.png"];
	const outlineOf = (file: string) => `${file.sub(1, -5)}-outline.png`;
	const filesOf = (id: string) => {
		const files = new Array<string>();
		for (const sheet of VALE_SPRITE_LAYOUTS[id].sheets) {
			files.push(sheet.file);
			files.push(outlineOf(sheet.file));
		}
		return files;
	};
	const cellOf = (id: string, i: number) =>
		VALE_SPRITE_LAYOUTS[id].sheets[i] as unknown as {
			frameW: number;
			frameH: number;
			pivot: { x: number; y: number };
		};

	it("the layouts: 8 facings; the bruiser at the knight's density, Mother Bramble at bodyTiles 2.5; every sheet <= 1024", () => {
		const b = VALE_SPRITE_LAYOUTS["enemy.bruiser"];
		expect([b.frameW, b.frameH, b.pivot, b.pixelsPerTile]).toEqual([99, 118, { x: 51, y: 89 }, 38]);
		expect(b.pixelsPerTile).toBe(VALE_SPRITE_LAYOUTS["class.vanguard"].pixelsPerTile);
		expect(b.facings).toEqual({ count: 8, zeroDeg: 0, ccw: true });
		expect(b.sheets).toEqual([
			{
				file: "bruiser-attack.png",
				w: 624,
				h: 944,
				frameW: 78,
				frameH: 118,
				pivot: { x: 41, y: 89 },
				outlineFile: "bruiser-attack-outline.png",
			},
			{
				file: "bruiser-body.png",
				w: 910,
				h: 810,
				frameW: 70,
				frameH: 81,
				pivot: { x: 37, y: 67 },
				outlineFile: "bruiser-body-outline.png",
			},
			{
				file: "bruiser-death.png",
				w: 594,
				h: 712,
				frameW: 99,
				frameH: 89,
				pivot: { x: 51, y: 65 },
				outlineFile: "bruiser-death-outline.png",
			},
		]);
		const e = VALE_SPRITE_LAYOUTS["boss.act1"];
		expect([e.frameW, e.frameH, e.pivot, e.pixelsPerTile]).toEqual([124, 134, { x: 63, y: 88 }, 24.4]);
		expect(e.facings).toEqual({ count: 8, zeroDeg: 0, ccw: true });
		expect(e.sheets.map((sheet) => sheet.file)).toEqual([
			"bramble-idle.png",
			"bramble-move.png",
			"bramble-taunt.png",
			"bramble-attack1.png",
			"bramble-attack2.png",
			"bramble-attack4.png",
			"bramble-death.png",
		]);
		for (const id of ["enemy.bruiser", "boss.act1"]) {
			const l = VALE_SPRITE_LAYOUTS[id];
			for (let i = 0; i < l.sheets.size(); i++) {
				const sheet = l.sheets[i];
				const c = cellOf(id, i);
				expect([sheet.file, sheet.w <= 1024, sheet.h <= 1024, sheet.w % c.frameW, sheet.h % c.frameH]).toEqual([
					sheet.file,
					true,
					true,
					0,
					0,
				]);
				// the set's pivot point, the same source pixel in every sheet: the sheet's pivot minus the set's is the
				// same offset as its cell's origin minus the set's (so the feet stay planted when the animation changes)
				expect([
					sheet.file,
					c.pivot.x > 0 && c.pivot.x < c.frameW,
					c.pivot.y > 0 && c.pivot.y < c.frameH,
				]).toEqual([sheet.file, true, true]);
				expect(sheet.outlineFile).toBe(outlineOf(sheet.file));
			}
		}
		// idle and attack.3 share Mother Bramble's first sheet; hit is idle's cell held (BD3: the boss never flinches)
		expect(e.animations["attack.3"]).toEqual({ sheet: 0, start: 32, frames: 6, fps: 10, loop: false });
		expect(e.animations.hit).toEqual({ sheet: 0, start: 0, frames: 1, stride: 4, fps: 1, loop: false });
	});

	it("as bundled both are their sprite sets, every sheet with its rim (uploaded 2026-10-26)", () => {
		for (const id of ["enemy.bruiser", "boss.act1"]) {
			for (const file of filesOf(id)) {
				expect([file, VALE_ASSET_IDS[file] !== undefined]).toEqual([file, true]);
			}
			expect([id, VALE_MANIFEST.assets[id].kind]).toEqual([id, "sprites"]);
			const set = new ThemePack(VALE_MANIFEST, { warn: quiet }).sprites(id)!;
			expect(set).never.toBe(undefined);
			const sheets = (VALE_MANIFEST.assets[id] as SpriteSetAsset).sheets;
			const layout = VALE_SPRITE_LAYOUTS[id].sheets;
			expect(sheets.size()).toBe(layout.size());
			for (let i = 0; i < layout.size(); i++) {
				expect([layout[i].file, sheets[i].assetId]).toEqual([layout[i].file, VALE_ASSET_IDS[layout[i].file]]);
				expect([layout[i].file, sheets[i].outlineAssetId]).toEqual([
					layout[i].file,
					VALE_ASSET_IDS[outlineOf(layout[i].file)],
				]);
			}
			// without the IDs (a fresh pack) both are still the placeholder
			expect([id, buildValeManifest({}).assets[id]]).toEqual([id, { kind: "placeholder" }]);
		}
	});

	it("each switches to sprites with every required sheet; any required sheet missing keeps it a placeholder", () => {
		const cases: Array<[string, Array<string>]> = [
			["enemy.bruiser", BRUISER_SHEETS],
			["boss.act1", BRAMBLE_REQUIRED],
		];
		for (const [id, required] of cases) {
			const m = buildValeManifest(fakeIds());
			expect(validateManifest(m, { packId: "vale" })).toEqual([]);
			expect([id, m.assets[id].kind]).toEqual([id, "sprites"]);
			for (const file of required) {
				const without = buildValeManifest(fakeIds(file));
				expect(validateManifest(without, { packId: "vale" })).toEqual([]);
				expect([id, file, without.assets[id]]).toEqual([id, file, { kind: "placeholder" }]);
			}
			// outline sheets alone never switch a set on
			const outlinesOnly = buildValeManifest(fakeIds(...required));
			expect([id, outlinesOnly.assets[id]]).toEqual([id, { kind: "placeholder" }]);
		}
		// only those sheets: the bruiser has no optional animation, so all three sheets are required
		expect(BRUISER_SHEETS).toEqual(VALE_SPRITE_LAYOUTS["enemy.bruiser"].sheets.map((sheet) => sheet.file));
		const theme = new ThemeCore(buildValeManifest(fakeIds()), { warn: quiet });
		expect(theme.sprites("enemy.bruiser")!.animationNames).toEqual(["attack", "death", "hit", "idle", "move"]);
		expect(theme.sprites("boss.act1")!.animationNames).toEqual([
			"attack",
			"attack.2",
			"attack.3",
			"attack.4",
			"death",
			"hit",
			"idle",
			"move",
			"taunt",
		]);
	});

	it("Mother Bramble's optional sheets join when uploaded and never hold the set back", () => {
		const m = buildValeManifest(fakeIds(...BRAMBLE_OPTIONAL));
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = m.assets["boss.act1"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(set.sheets.size()).toBe(4);
		// attack.3 rides on idle's sheet, so it stays
		expect(sortedKeys(set.animations)).toEqual(["attack", "attack.3", "death", "hit", "idle", "move"]);
		const ids = fakeIds(...BRAMBLE_OPTIONAL);
		for (const name of sortedKeys(set.animations)) {
			const layoutSheet = VALE_SPRITE_LAYOUTS["boss.act1"].animations[name].sheet;
			const file = VALE_SPRITE_LAYOUTS["boss.act1"].sheets[layoutSheet].file;
			expect([name, set.sheets[set.animations[name].sheet].assetId]).toEqual([name, ids[file]]);
		}
	});

	it("the rims join only with their outline sheets and never hold a set back", () => {
		for (const id of ["enemy.bruiser", "boss.act1"]) {
			const outlines = VALE_SPRITE_LAYOUTS[id].sheets.map((sheet) => outlineOf(sheet.file));
			const rimless = buildValeManifest(fakeIds(...outlines));
			expect(validateManifest(rimless, { packId: "vale" })).toEqual([]);
			const set = rimless.assets[id] as SpriteSetAsset;
			expect([id, set.kind, set.sheets.size()]).toEqual([id, "sprites", outlines.size()]);
			for (const sheet of set.sheets) expect([id, sheet.outlineAssetId]).toEqual([id, undefined]);
			// with every file each sheet carries its own outline, on every frame
			const ids = fakeIds();
			const sprites = new ThemeCore(buildValeManifest(ids), { warn: quiet }).sprites(id)!;
			for (const name of sprites.animationNames) {
				const count = sprites.animation(name)!.frames;
				for (let d = 0; d < 8; d++) {
					for (let f = 0; f < count; f++) {
						const r = sprites.frame(name, d, f);
						const file = VALE_SPRITE_LAYOUTS[id].sheets[r.sheet].file;
						expect([name, d, f, r.assetId, r.outlineAssetId]).toEqual([
							name,
							d,
							f,
							ids[file],
							ids[outlineOf(file)],
						]);
					}
				}
			}
		}
	});

	it("copies each sheet's own cell into the manifest and draws every frame in it (hand-computed rects)", () => {
		const ids = fakeIds();
		const m = buildValeManifest(ids);
		for (const id of ["enemy.bruiser", "boss.act1"]) {
			const set = m.assets[id] as SpriteSetAsset;
			const l = VALE_SPRITE_LAYOUTS[id];
			expect([set.frameW, set.frameH, set.pivot]).toEqual([l.frameW, l.frameH, l.pivot]);
			for (let i = 0; i < l.sheets.size(); i++) {
				const c = cellOf(id, i);
				expect([id, set.sheets[i].frameW, set.sheets[i].frameH, set.sheets[i].pivot]).toEqual([
					id,
					c.frameW,
					c.frameH,
					c.pivot,
				]);
			}
		}
		const pack = new ThemePack(m, { warn: quiet });
		const bruiser = pack.sprites("enemy.bruiser")!;
		// idle facing 5 frame 2: cell 22 of bruiser-body (13 per row of 70x81) -> column 9, row 1
		const idle = bruiser.frame("idle", 5, 2);
		expect([
			idle.image,
			idle.outlineImage,
			idle.offset.X,
			idle.offset.Y,
			idle.size.X,
			idle.size.Y,
			idle.pivot,
		]).toEqual([ids["bruiser-body.png"], ids["bruiser-body-outline.png"], 630, 81, 70, 81, { x: 37, y: 67 }]);
		// hit facing 7 frame 3: cell 96 + 28 + 3 = 127, the sheet's last -> column 10, row 9 (bottom edge 810)
		const hit = bruiser.frame("hit", 7, 3);
		expect([hit.offset.X, hit.offset.Y, hit.offset.Y + hit.size.Y]).toEqual([700, 729, 810]);
		// attack facing 0 frame 6 (the impact): bruiser-attack, 8 per row of 78x118 -> column 6, row 0
		const slam = bruiser.frame("attack", 0, 6);
		expect([slam.image, slam.offset.X, slam.offset.Y, slam.size.X, slam.size.Y, slam.pivot]).toEqual([
			ids["bruiser-attack.png"],
			468,
			0,
			78,
			118,
			{ x: 41, y: 89 },
		]);
		const bramble = pack.sprites("boss.act1")!;
		// attack.3 facing 7 frame 5: cell 32 + 42 + 5 = 79 of bramble-idle (9 per row of 107x113) -> column 7, row 8
		const spin = bramble.frame("attack.3", 7, 5);
		expect([spin.image, spin.offset.X, spin.offset.Y, spin.size.X, spin.size.Y, spin.pivot]).toEqual([
			ids["bramble-idle.png"],
			749,
			904,
			107,
			113,
			{ x: 54, y: 78 },
		]);
		// hit = idle frame 0 held: facing 3 -> cell 12 -> column 3, row 1, every frame index
		const held = bramble.frame("hit", 3, 0);
		expect([held.offset.X, held.offset.Y]).toEqual([321, 113]);
		expect(held).toEqual(bramble.frame("idle", 3, 0));
	});
});
