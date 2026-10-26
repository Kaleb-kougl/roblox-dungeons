// The vale pack (docs/ART.md S5): the generated atlas layout must satisfy the contract v2 validator once uploaded, the
// runtime must address the cells the pipeline wrote, and entries without uploaded art must stay placeholders.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BIOMES, BIOME_MATERIALS, BIOME_MATERIAL_SURFACES, DEFAULT_BIOME_MATERIAL, type BiomeId } from "../../contract";
import { ThemeCore } from "../../core";
import type { SpriteSetAsset } from "../../types";
import { ThemePack } from "../../pack";
import { deepClone, sortedKeys } from "../../util";
import { contrastReport, juiceContrastReport, validateManifest } from "../../validate";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_AUDIO_FILES } from "./audioLayout";
import { VALE_FLOOR_HEX, VALE_IMAGE_LAYOUTS, VALE_SPRITE_LAYOUTS, VALE_WORLD_LAYOUTS } from "./layout";
import { VALE_BIOME_MATERIALS, VALE_MANIFEST, buildValeManifest } from "./manifest";

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
		// art/atlases.json: each enemy / boss set needs `outline` (enemy outline plan O3), or it draws without a rim
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

	it("as bundled, enemy.swarmer is its placeholder: its pre-O3 (94x70) IDs were removed until re-uploaded", () => {
		// The uploaded swarmer atlases had the old cell grid; the pad change (O3) moved every cell. Until the four
		// swarmer files (two atlases, two outline sheets) are re-uploaded, the swarmer draws its outlined ball.
		for (const file of ["swarmer-move.png", "swarmer-death.png"]) {
			expect([file, VALE_ASSET_IDS[file]]).toEqual([file, undefined]);
		}
		expect(VALE_MANIFEST.assets["enemy.swarmer"]).toEqual({ kind: "placeholder" });
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect(pack.sprites("enemy.swarmer")).toBe(undefined);
		expect(pack.placeholder("enemy.swarmer").outline).toBe("enemyOutline");
		// the player's set is unaffected
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
