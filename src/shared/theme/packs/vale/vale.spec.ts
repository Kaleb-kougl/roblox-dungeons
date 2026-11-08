// The vale pack (docs/ART.md S5): the generated atlas layout must satisfy the contract v2 validator once uploaded, the
// runtime must address the cells the pipeline wrote, and entries without uploaded art must stay placeholders.
import { describe, expect, it } from "@rbxts/jest-globals";
import { preloadPlan } from "shared/view";
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
	draftSkinIds,
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
import { VALE_BOON_ICON_FILE } from "./boonIconLayout";
import { VALE_ITEM_ICON_FILE } from "./itemIconLayout";
import { VALE_BOOST_AURA_SHEET } from "./boostAuraLayout";
import { VALE_BULLET_SHEET } from "./bulletLayout";
import { VALE_FORTUNE_FX_SHEET, VALE_PACT_ALTAR_LAYOUT } from "./fortuneLayout";
import { VALE_AMBIENT_LAYOUTS, VALE_FX_SHEET } from "./fxLayout";
import { VALE_GOO_SHEET } from "./gooLayout";
import { VALE_HAZARD_SHEET } from "./hazardLayout";
import { VALE_TREASURE_CAGE_LAYOUT, VALE_TREASURE_FX_SHEET } from "./treasureLayout";
import { VALE_UI_ICON_FILE } from "./uiIconLayout";
import {
	VALE_FLOOR_HEX,
	VALE_IMAGE_LAYOUTS,
	VALE_SPRITE_LAYOUTS,
	VALE_WORLD_LAYOUTS,
	type ValeSpriteLayout,
} from "./layout";
import {
	VALE_BIOME_MATERIALS,
	VALE_DECOR_PIECES,
	VALE_MANIFEST,
	VALE_RETIRED_WORLD_ART,
	buildValeManifest,
	valeSpriteAsset,
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
	// the UI icon atlas (docs/UI_ART.md UA4): one file for every icon
	files.push(VALE_UI_ICON_FILE);
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
		// the effects atlas, the Ninja Adventure ambient flipbooks (fxLayout.ts) and the bullet atlas (bulletLayout.ts,
		// docs/PROJECTILE_ART.md), the goo sheet (gooLayout.ts, docs/GOO_ART.md) and the vault's cage and column sheets
		// (treasureLayout.ts, docs/TREASURE.md TR9), the boost aura sheet (boostAuraLayout.ts, docs/BOOST_ART.md BAD3)
		// the hazard sheet (hazardLayout.ts, docs/HAZARD_ART.md) and the pact altar and coin burst sheets (fortuneLayout.ts,
		// docs/FORTUNE.md FO10), the boon icon sheet (boonIconLayout.ts, docs/BUILDS.md BU11) and the relic and curse
		// icon sheet (itemIconLayout.ts, BU11) are art/build files too
		const files = allFiles();
		files.push(VALE_FX_SHEET.file);
		files.push(VALE_BULLET_SHEET.file);
		files.push(VALE_GOO_SHEET.file);
		files.push(VALE_TREASURE_CAGE_LAYOUT.sheets[0].file);
		files.push(VALE_TREASURE_FX_SHEET.file);
		files.push(VALE_BOOST_AURA_SHEET.file);
		files.push(VALE_HAZARD_SHEET.file);
		files.push(VALE_PACT_ALTAR_LAYOUT.sheets[0].file);
		files.push(VALE_FORTUNE_FX_SHEET.file);
		files.push(VALE_BOON_ICON_FILE);
		files.push(VALE_ITEM_ICON_FILE);
		for (const id of sortedKeys(VALE_AMBIENT_LAYOUTS)) files.push(VALE_AMBIENT_LAYOUTS[id].file);
		for (const file of sortedKeys(VALE_ASSET_IDS)) {
			expect([file, files.includes(file)]).toEqual([file, true]);
		}
	});

	it("every enemy, boss and player sprite set has an outline sheet per sheet; no other set has one", () => {
		// art/atlases.json: each enemy / boss set needs `outline` (enemy outline plan O3), or its sprites draw without a
		// rim (bosses take the enemy rim too: their placeholder has the outline role). The knight carries the player
		// outline's sheets (player outline: 1 px, clipAtCellEdge); the renderer tints each rim its own role.
		let enemies = 0;
		let bosses = 0;
		for (const id of sortedKeys(VALE_SPRITE_LAYOUTS)) {
			const enemy = id.sub(1, 6) === "enemy." || id.sub(1, 5) === "boss.";
			const outlined = enemy || id === "class.vanguard";
			if (enemy) {
				enemies += 1;
			}
			if (id.sub(1, 5) === "boss.") {
				bosses += 1;
			}
			for (const sheet of VALE_SPRITE_LAYOUTS[id].sheets) {
				const expected = outlined ? `${sheet.file.sub(1, -5)}-outline.png` : undefined;
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

	it("as bundled, boss.demonlord is its sprite set: all 14 files uploaded, every sheet with its rim", () => {
		for (const sheet of VALE_SPRITE_LAYOUTS["boss.demonlord"].sheets) {
			expect([sheet.file, VALE_ASSET_IDS[sheet.file] !== undefined]).toEqual([sheet.file, true]);
			expect([sheet.outlineFile, VALE_ASSET_IDS[sheet.outlineFile!] !== undefined]).toEqual([
				sheet.outlineFile,
				true,
			]);
		}
		expect(VALE_MANIFEST.assets["boss.demonlord"].kind).toBe("sprites");
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		const sprites = pack.sprites("boss.demonlord")!;
		expect(sprites).never.toBe(undefined);
		// idle facing 12 (S, towards the camera), frame 0: the uploaded sheet and its rim
		expect(sprites.frame("idle", 12, 0).image).toBe(VALE_ASSET_IDS["demonlord-idle.png"]);
		expect(sprites.frame("idle", 12, 0).outlineImage).toBe(VALE_ASSET_IDS["demonlord-idle-outline.png"]);
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
		// the player's sheets carry the player outline's sheets the same way (player outline)
		const vanguard = buildValeManifest(ids).assets["class.vanguard"] as SpriteSetAsset;
		for (const sheet of vanguard.sheets) {
			expect(sheet.outlineAssetId).never.toBe(undefined);
		}
		expect(pack.sprites("class.vanguard")!.frame("run", 0, 0).outlineImage).toBe(ids["vanguard-run-outline.png"]);
		// until its outline sheets are uploaded, the knight still draws (rimless): the body ids are unchanged
		const outlines = VALE_SPRITE_LAYOUTS["class.vanguard"].sheets.map((sheet) => sheet.outlineFile!);
		const rimless = buildValeManifest(fakeIds(...outlines)).assets["class.vanguard"] as SpriteSetAsset;
		expect(rimless.kind).toBe("sprites");
		for (const sheet of rimless.sheets) {
			expect(sheet.outlineAssetId).toBe(undefined);
		}
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

	it("gives every biome the void's shoulder and cliff materials (docs/VOID_DECOR.md VD1 biome table)", () => {
		const expected: Record<BiomeId, [string, string]> = {
			"biome.1": ["Brick", "Rock"],
			"biome.2": ["Basalt", "Basalt"],
			"biome.3": ["Glacier", "Ice"],
			"biome.4": ["Slate", "Rock"],
			"biome.5": ["Ground", "Mud"],
		};
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		for (const b of BIOMES) {
			const m = pack.biome(b.id).materials;
			expect([b.id, m.shoulder, m.cliff]).toEqual([b.id, ...expected[b.id]]);
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
			shoulder: "Brick",
			cliff: "Rock",
		});
		expect(pack.biome("biome.2").materials).toEqual({
			floor: "Basalt",
			wall: "Rock",
			pool: "CrackedLava",
			shoulder: "Basalt",
			cliff: "Basalt",
		});
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
			outlineAssetId: ids["vanguard-run-outline.png"],
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

describe("vale enemy.slime (docs/ENEMY_VARIANTS.md EV10: the Lords of Pain slime; slime.small draws it smaller)", () => {
	const SHEET = "slime-body.png";
	const OUTLINE = "slime-body-outline.png";
	const layout = VALE_SPRITE_LAYOUTS["enemy.slime"];

	it("the layout: one 980x988 atlas of 70x52 cells (idle 1, walk 8, death 7 x 16 facings), 23.4 px/tile, a rim", () => {
		expect(layout).never.toBe(undefined);
		expect([layout.frameW, layout.frameH]).toEqual([70, 52]);
		expect(layout.sheets).toEqual([{ file: SHEET, w: 980, h: 988, outlineFile: OUTLINE }]);
		expect(layout.facings).toEqual({ count: 16, zeroDeg: 0, ccw: true });
		// sized by width: ~25.6 px of dome / 23.4 = ~1.1 tiles for an r 0.55 body (art/atlases.json bodyTilesNote)
		expect(layout.pixelsPerTile).toBe(23.4);
		expect(layout.pivot).toEqual({ x: 35, y: 36 });
		expect(layout.animations.idle).toEqual({ sheet: 0, start: 0, frames: 1, fps: 1, loop: true });
		expect(layout.animations.move).toEqual({ sheet: 0, start: 16, frames: 8, fps: 10, loop: true });
		expect(layout.animations.death).toEqual({ sheet: 0, start: 144, frames: 7, fps: 10, loop: false });
		// stand-ins: hit = idle's cell (flash only), attack = the walk
		expect(layout.animations.hit).toEqual({ sheet: 0, start: 0, frames: 1, fps: 1, loop: false });
		expect(layout.animations.attack).toEqual({ sheet: 0, start: 16, frames: 8, fps: 10, loop: true });
	});

	it("with no IDs it is the placeholder; the outline alone never switches it on", () => {
		expect(buildValeManifest({}).assets["enemy.slime"]).toEqual(PLACEHOLDER_MANIFEST.assets["enemy.slime"]);
		const noAtlas = buildValeManifest(fakeIds(SHEET));
		expect(validateManifest(noAtlas, { packId: "vale" })).toEqual([]);
		expect(noAtlas.assets["enemy.slime"]).toEqual(PLACEHOLDER_MANIFEST.assets["enemy.slime"]);
		expect(new ThemePack(noAtlas, { warn: quiet }).sprites("enemy.slime")).toBe(undefined);
	});

	it("as bundled (uploaded 2026-10-31), enemy.slime is its sprite set with its rim", () => {
		for (const file of [SHEET, OUTLINE]) expect([file, VALE_ASSET_IDS[file] !== undefined]).toEqual([file, true]);
		expect(VALE_MANIFEST.assets["enemy.slime"].kind).toBe("sprites");
		const set = new ThemePack(VALE_MANIFEST, { warn: quiet }).sprites("enemy.slime")!;
		expect(set).never.toBe(undefined);
		expect(set.frame("move", 2, 5).image).toBe(VALE_ASSET_IDS[SHEET]);
		expect(set.frame("move", 2, 5).outlineImage).toBe(VALE_ASSET_IDS[OUTLINE]);
	});

	it("with slime-body.png it switches to sprites with every required animation; the rim joins with its outline", () => {
		const ids = fakeIds();
		const m = buildValeManifest(ids);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = m.assets["enemy.slime"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(set.sheets).toEqual([{ assetId: ids[SHEET], w: 980, h: 988, outlineAssetId: ids[OUTLINE] }]);
		const sprites = new ThemeCore(m, { warn: quiet }).sprites("enemy.slime")!;
		expect(sprites).never.toBe(undefined);
		for (const name of requiredBaseAnimations(ENEMY)) {
			expect([name, sprites.has(name)]).toEqual([name, true]);
		}
		const rimless = new ThemePack(buildValeManifest(fakeIds(OUTLINE)), { warn: quiet }).sprites("enemy.slime")!;
		expect(rimless).never.toBe(undefined);
		expect(rimless.frame("move", 4, 2).outlineImage).toBe(undefined);
	});

	it("cells (hand-computed): 14 per row; the stand-ins address idle's and the walk's cells", () => {
		const ids = fakeIds();
		const sprites = new ThemeCore(buildValeManifest(ids), { warn: quiet }).sprites("enemy.slime")!;
		// move: facing 2, frame 5 -> cell 16 + 2 * 8 + 5 = 37 -> column 9, row 2
		expect(sprites.frame("move", 2, 5)).toEqual({
			sheet: 0,
			assetId: ids[SHEET],
			outlineAssetId: ids[OUTLINE],
			x: 630,
			y: 104,
			w: 70,
			h: 52,
		});
		// the last cell: death facing 15, frame 6 -> cell 144 + 105 + 6 = 255 -> column 3, row 18 (the bottom row)
		const last = sprites.frame("death", 15, 6);
		expect([last.x, last.y, last.x + last.w, last.y + last.h]).toEqual([210, 936, 280, 988]);
		// idle / hit: facing 12 (towards the camera) -> cell 12 -> column 12, row 0
		for (const name of ["idle", "hit"]) {
			const r = sprites.frame(name, 12, 0);
			expect([name, r.x, r.y]).toEqual([name, 840, 0]);
		}
		for (let f = 0; f < 8; f++) {
			expect(sprites.frame("attack", 7, f)).toEqual(sprites.frame("move", 7, f));
		}
	});
});

describe("vale enemy.dummy (docs/DUMMY_ART.md: the tutorial's training dummy, one facing, pixel art)", () => {
	const SHEET = "dummy.png";
	const OUTLINE = "dummy-outline.png";
	const layout = VALE_SPRITE_LAYOUTS["enemy.dummy"];

	it("the layout: one 62x850 sheet of 62x50 cells (idle 1, hit 7, death 9; 1 facing), 27.9 px/tile, a rim", () => {
		expect(layout).never.toBe(undefined);
		expect([layout.frameW, layout.frameH]).toEqual([62, 50]);
		expect(layout.sheets).toEqual([{ file: SHEET, w: 62, h: 850, outlineFile: OUTLINE }]);
		expect(layout.facings).toEqual({ count: 1, zeroDeg: 0, ccw: true });
		// the 39 px idle body drawn 1.4 tiles tall (art/atlases.json bodyTilesNote); pixel art, never smoothed
		expect(layout.pixelsPerTile).toBe(27.9);
		expect(layout.resample).toBe("Pixelated");
		expect(layout.pivot).toEqual({ x: 39, y: 47 });
		expect(layout.animations.idle).toEqual({ sheet: 0, start: 0, frames: 1, fps: 1, loop: true });
		expect(layout.animations.hit).toEqual({ sheet: 0, start: 1, frames: 7, fps: 10, loop: false });
		expect(layout.animations.death).toEqual({ sheet: 0, start: 8, frames: 9, fps: 18, loop: false });
		// stand-ins: move and attack = idle's cell (it never moves or attacks)
		expect(layout.animations.move).toEqual({ sheet: 0, start: 0, frames: 1, fps: 1, loop: true });
		expect(layout.animations.attack).toEqual({ sheet: 0, start: 0, frames: 1, fps: 1, loop: true });
	});

	it("with no IDs it is the placeholder post; the outline alone never switches it on", () => {
		expect(buildValeManifest({}).assets["enemy.dummy"]).toEqual(PLACEHOLDER_MANIFEST.assets["enemy.dummy"]);
		const noAtlas = buildValeManifest(fakeIds(SHEET));
		expect(validateManifest(noAtlas, { packId: "vale" })).toEqual([]);
		expect(noAtlas.assets["enemy.dummy"]).toEqual(PLACEHOLDER_MANIFEST.assets["enemy.dummy"]);
		expect(new ThemePack(noAtlas, { warn: quiet }).sprites("enemy.dummy")).toBe(undefined);
	});

	it("as bundled, it is the sprite set once dummy.png has an ID (DA5), else the placeholder", () => {
		const uploaded = VALE_ASSET_IDS[SHEET] !== undefined;
		expect(VALE_MANIFEST.assets["enemy.dummy"].kind).toBe(
			uploaded ? "sprites" : PLACEHOLDER_MANIFEST.assets["enemy.dummy"].kind,
		);
	});

	it("with dummy.png it switches to sprites with every required animation; the rim joins with its outline", () => {
		const ids = fakeIds();
		const m = buildValeManifest(ids);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = m.assets["enemy.dummy"] as SpriteSetAsset;
		expect(set.kind).toBe("sprites");
		expect(set.sheets).toEqual([{ assetId: ids[SHEET], w: 62, h: 850, outlineAssetId: ids[OUTLINE] }]);
		const sprites = new ThemeCore(m, { warn: quiet }).sprites("enemy.dummy")!;
		expect(sprites).never.toBe(undefined);
		for (const name of requiredBaseAnimations(ENEMY)) {
			expect([name, sprites.has(name)]).toEqual([name, true]);
		}
		const rimless = new ThemePack(buildValeManifest(fakeIds(OUTLINE)), { warn: quiet }).sprites("enemy.dummy")!;
		expect(rimless).never.toBe(undefined);
		expect(rimless.frame("hit", 0, 2).outlineImage).toBe(undefined);
	});

	it("cells (hand-computed): one column; hit frame 2 is cell 3, the last break frame the bottom cell", () => {
		const ids = fakeIds();
		const sprites = new ThemeCore(buildValeManifest(ids), { warn: quiet }).sprites("enemy.dummy")!;
		expect(sprites.frame("hit", 0, 2)).toEqual({
			sheet: 0,
			assetId: ids[SHEET],
			outlineAssetId: ids[OUTLINE],
			x: 0,
			y: 150,
			w: 62,
			h: 50,
		});
		const last = sprites.frame("death", 0, 8);
		expect([last.x, last.y, last.x + last.w, last.y + last.h]).toEqual([0, 800, 62, 850]);
		// the stand-ins address idle's cell
		expect(sprites.frame("move", 0, 0).y).toBe(0);
		expect(sprites.frame("attack", 0, 0).y).toBe(0);
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

	it('only the `cells: "perSheet"` sets (enemy.bruiser, boss.act1, the turrets, the imp, the summoner, the NE9 five) give their sheets their own cells', () => {
		const perSheet = [
			"boss.act1",
			"enemy.bomber",
			"enemy.bruiser",
			"enemy.caster",
			"enemy.charger",
			"enemy.imp",
			"enemy.reaper",
			"enemy.sprayer",
			"enemy.stormcaller",
			"enemy.summoner",
			"enemy.warbanner",
		];
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
 * (Mother Mayhem, Demon Elite 3), per-sheet cells, a rim on every sheet. All 20 files were uploaded 2026-10-26
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

	it("the layouts: 8 facings; the bruiser at the knight's density, Mother Mayhem at bodyTiles 2.5; every sheet <= 1024", () => {
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
		// idle and attack.3 share Mother Mayhem's first sheet; hit is idle's cell held (BD3: the boss never flinches)
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

	it("Mother Mayhem's optional sheets join when uploaded and never hold the set back", () => {
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

/**
 * M1's turrets as 2D Demons sets (docs/DEMON_ART.md Phase 2, DA12): enemy.sprayer (Demon Spawn 8) and enemy.caster
 * (Demon Spawn 11, its recolour: identical boxes). Two per-sheet sheets each (body = idle + hit, death), a rim on
 * both; move and attack are idle's cells (the renderer never plays them on a turret). Uploaded 2026-10-30 (DA13): as
 * bundled both are their sets; the switching cases inject fake ids the way the bruiser's do.
 */
describe("vale enemy.sprayer and enemy.caster (2D Demons turrets, per-sheet cells)", () => {
	const TURRETS: ReadonlyArray<[string, string]> = [
		["enemy.sprayer", "sprayer"],
		["enemy.caster", "caster"],
	];
	const sheetsOf = (prefix: string) => [`${prefix}-body.png`, `${prefix}-death.png`];
	const outlineOf = (file: string) => `${file.sub(1, -5)}-outline.png`;
	const filesOf = (prefix: string) => {
		const files = new Array<string>();
		for (const file of sheetsOf(prefix)) {
			files.push(file);
			files.push(outlineOf(file));
		}
		return files;
	};

	it("the layouts: 8 facings at the knight's density; body 78x85 and death 116x97 cells; every sheet <= 1024", () => {
		for (const [id, prefix] of TURRETS) {
			const l = VALE_SPRITE_LAYOUTS[id];
			expect([id, l.frameW, l.frameH, l.pivot, l.pixelsPerTile]).toEqual([id, 116, 99, { x: 60, y: 60 }, 38]);
			expect([id, l.pixelsPerTile]).toEqual([id, VALE_SPRITE_LAYOUTS["class.vanguard"].pixelsPerTile]);
			expect([id, l.facings]).toEqual([id, { count: 8, zeroDeg: 0, ccw: true }]);
			expect([id, l.resample]).toEqual([id, "Default"]);
			expect(l.sheets).toEqual([
				{
					file: `${prefix}-body.png`,
					w: 624,
					h: 680,
					frameW: 78,
					frameH: 85,
					pivot: { x: 41, y: 60 },
					outlineFile: `${prefix}-body-outline.png`,
				},
				{
					file: `${prefix}-death.png`,
					w: 696,
					h: 776,
					frameW: 116,
					frameH: 97,
					pivot: { x: 60, y: 58 },
					outlineFile: `${prefix}-death-outline.png`,
				},
			]);
			for (const sheet of l.sheets) {
				const c = sheet as unknown as { frameW: number; frameH: number };
				expect([sheet.file, sheet.w <= 1024, sheet.h <= 1024, sheet.w % c.frameW, sheet.h % c.frameH]).toEqual([
					sheet.file,
					true,
					true,
					0,
					0,
				]);
			}
			// idle loop 4, hit 4 after idle's 32 cells on the body sheet, death 6 on its own; move / attack alias idle
			expect(l.animations).toEqual({
				attack: { sheet: 0, start: 0, frames: 4, fps: 6, loop: true },
				death: { sheet: 1, start: 0, frames: 6, fps: 10, loop: false },
				hit: { sheet: 0, start: 32, frames: 4, fps: 12, loop: false },
				idle: { sheet: 0, start: 0, frames: 4, fps: 6, loop: true },
				move: { sheet: 0, start: 0, frames: 4, fps: 6, loop: true },
			});
		}
		// Spawn 11 is a recolour of Spawn 8: one layout but for the file names
		const sprayer = VALE_SPRITE_LAYOUTS["enemy.sprayer"];
		const caster = VALE_SPRITE_LAYOUTS["enemy.caster"];
		expect([caster.frameW, caster.frameH, caster.pivot, caster.animations]).toEqual([
			sprayer.frameW,
			sprayer.frameH,
			sprayer.pivot,
			sprayer.animations,
		]);
	});

	it("as bundled both are their sprite sets, every sheet with its rim (uploaded 2026-10-30, DA13)", () => {
		for (const [id, prefix] of TURRETS) {
			for (const file of filesOf(prefix)) {
				expect([file, VALE_ASSET_IDS[file] !== undefined]).toEqual([file, true]);
			}
			expect([id, VALE_MANIFEST.assets[id].kind]).toEqual([id, "sprites"]);
			expect([id, new ThemePack(VALE_MANIFEST, { warn: quiet }).sprites(id) !== undefined]).toEqual([id, true]);
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

	it("each switches to sprites with both sheets; either sheet missing keeps it a placeholder; rims alone never do", () => {
		const theme = new ThemeCore(buildValeManifest(fakeIds()), { warn: quiet });
		for (const [id, prefix] of TURRETS) {
			// no optional animation: both sheets are required
			expect(sheetsOf(prefix)).toEqual(VALE_SPRITE_LAYOUTS[id].sheets.map((sheet) => sheet.file));
			const m = buildValeManifest(fakeIds());
			expect(validateManifest(m, { packId: "vale" })).toEqual([]);
			expect([id, m.assets[id].kind]).toEqual([id, "sprites"]);
			expect([id, theme.sprites(id)!.animationNames]).toEqual([id, ["attack", "death", "hit", "idle", "move"]]);
			for (const file of sheetsOf(prefix)) {
				const without = buildValeManifest(fakeIds(file));
				expect(validateManifest(without, { packId: "vale" })).toEqual([]);
				expect([id, file, without.assets[id]]).toEqual([id, file, { kind: "placeholder" }]);
			}
			const outlinesOnly = buildValeManifest(fakeIds(...sheetsOf(prefix)));
			expect([id, outlinesOnly.assets[id]]).toEqual([id, { kind: "placeholder" }]);
			// the other turret is independent of this one's files
			for (const [other] of TURRETS) {
				if (other !== id) expect([id, other, outlinesOnly.assets[other].kind]).toEqual([id, other, "sprites"]);
			}
		}
	});

	it("the rims join per sheet and never hold a set back", () => {
		for (const [id, prefix] of TURRETS) {
			const [body, death] = sheetsOf(prefix);
			const rimless = buildValeManifest(fakeIds(outlineOf(body), outlineOf(death)));
			expect(validateManifest(rimless, { packId: "vale" })).toEqual([]);
			const set = rimless.assets[id] as SpriteSetAsset;
			expect([id, set.kind, set.sheets.size()]).toEqual([id, "sprites", 2]);
			for (const sheet of set.sheets) expect([id, sheet.outlineAssetId]).toEqual([id, undefined]);
			// one rim uploaded: only its own sheet has it
			const ids = fakeIds(outlineOf(death));
			const half = new ThemePack(buildValeManifest(ids), { warn: quiet }).sprites(id)!;
			expect([id, half.frame("idle", 0, 0).outlineImage]).toEqual([id, ids[outlineOf(body)]]);
			expect([id, half.frame("death", 0, 0).outlineImage]).toEqual([id, undefined]);
			// with every file each sheet carries its own outline, on every frame
			const all = fakeIds();
			const sprites = new ThemeCore(buildValeManifest(all), { warn: quiet }).sprites(id)!;
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
							all[file],
							all[outlineOf(file)],
						]);
					}
				}
			}
		}
	});

	it("copies each sheet's own cell into the manifest and draws every frame in it (hand-computed rects)", () => {
		const ids = fakeIds();
		const m = buildValeManifest(ids);
		const pack = new ThemePack(m, { warn: quiet });
		for (const [id, prefix] of TURRETS) {
			const set = m.assets[id] as SpriteSetAsset;
			expect([id, set.frameW, set.frameH, set.pivot]).toEqual([id, 116, 99, { x: 60, y: 60 }]);
			expect([id, set.sheets[0].frameW, set.sheets[0].frameH, set.sheets[0].pivot]).toEqual([
				id,
				78,
				85,
				{ x: 41, y: 60 },
			]);
			expect([id, set.sheets[1].frameW, set.sheets[1].frameH, set.sheets[1].pivot]).toEqual([
				id,
				116,
				97,
				{ x: 60, y: 58 },
			]);
			const sprites = pack.sprites(id)!;
			// idle facing 5 frame 2: cell 22 of the body sheet (8 per row of 78x85) -> column 6, row 2
			const idle = sprites.frame("idle", 5, 2);
			expect([
				id,
				idle.image,
				idle.outlineImage,
				idle.offset.X,
				idle.offset.Y,
				idle.size.X,
				idle.size.Y,
				idle.pivot,
			]).toEqual([
				id,
				ids[`${prefix}-body.png`],
				ids[`${prefix}-body-outline.png`],
				468,
				170,
				78,
				85,
				{ x: 41, y: 60 },
			]);
			// hit facing 7 frame 3: cell 32 + 28 + 3 = 63, the body sheet's last -> column 7, row 7 (bottom edge 680)
			const hit = sprites.frame("hit", 7, 3);
			expect([id, hit.image, hit.offset.X, hit.offset.Y, hit.offset.Y + hit.size.Y]).toEqual([
				id,
				ids[`${prefix}-body.png`],
				546,
				595,
				680,
			]);
			// death facing 4 frame 5: cell 29 of the death sheet (6 per row of 116x97) -> column 5, row 4
			const fall = sprites.frame("death", 4, 5);
			expect([id, fall.image, fall.outlineImage, fall.offset.X, fall.offset.Y, fall.size.X, fall.size.Y]).toEqual(
				[id, ids[`${prefix}-death.png`], ids[`${prefix}-death-outline.png`], 580, 388, 116, 97],
			);
			expect([id, fall.pivot]).toEqual([id, { x: 60, y: 58 }]);
			// death facing 7 frame 5: cell 47, the sheet's last -> column 5, row 7 (bottom edge 776)
			const last = sprites.frame("death", 7, 5);
			expect([id, last.offset.X, last.offset.Y + last.size.Y]).toEqual([id, 580, 776]);
			// move and attack are idle's cells, frame for frame, in every facing
			for (let d = 0; d < 8; d++) {
				for (let f = 0; f < 4; f++) {
					expect([id, d, f, sprites.frame("move", d, f)]).toEqual([id, d, f, sprites.frame("idle", d, f)]);
					expect([id, d, f, sprites.frame("attack", d, f)]).toEqual([id, d, f, sprites.frame("idle", d, f)]);
				}
			}
		}
	});

	it("land in the preload core tier with their rims once uploaded (docs/PRELOAD.md: `enemy.` is core)", () => {
		const ids = fakeIds();
		const pack = new ThemePack(buildValeManifest(ids), { warn: quiet });
		const plan = preloadPlan(pack);
		const core = new Set(plan.core.map((r) => r.contentId as string));
		const later = new Set(plan.later.map((r) => r.contentId as string));
		for (const [id, prefix] of TURRETS) {
			const refs = pack.contentIds(id).map((r) => r.contentId as string);
			const want = filesOf(prefix).map((file) => ids[file]);
			want.sort();
			refs.sort();
			expect([id, refs]).toEqual([id, want]);
			for (const ref of refs) expect([id, ref, core.has(ref), later.has(ref)]).toEqual([id, ref, true, false]);
		}
	});
});

/**
 * The EV10 sets (docs/ENEMY_VARIANTS.md "EV10 imp / summoner (as built)"): enemy.imp (Imp 9) and enemy.summoner
 * (Demon Spawn 10, whose attack sheet also holds the optional `attack.2`, the summon cast), per-sheet cells, three
 * sheets and three rims each. Not uploaded yet: the bundled pack draws both as the placeholder until their 12 files
 * have IDs in assetIds.ts.
 */
describe("vale enemy.imp and enemy.summoner (EV10: Imp 9 / Demon Spawn 10, per-sheet cells)", () => {
	const SETS: ReadonlyArray<[string, string]> = [
		["enemy.imp", "imp"],
		["enemy.summoner", "summoner"],
	];
	const sheetsOf = (prefix: string) => [`${prefix}-attack.png`, `${prefix}-body.png`, `${prefix}-death.png`];
	const outlineOf = (file: string) => `${file.sub(1, -5)}-outline.png`;
	const filesOf = (prefix: string) => {
		const files = new Array<string>();
		for (const file of sheetsOf(prefix)) {
			files.push(file);
			files.push(outlineOf(file));
		}
		return files;
	};
	const sheet = (file: string, w: number, h: number, frameW: number, frameH: number, x: number, y: number) => ({
		file,
		w,
		h,
		frameW,
		frameH,
		pivot: { x, y },
		outlineFile: outlineOf(file),
	});

	it("the layouts: 8 facings at their own bodyTiles density; three sheets, each <= 1024 and a whole number of cells", () => {
		const imp = VALE_SPRITE_LAYOUTS["enemy.imp"];
		expect([imp.frameW, imp.frameH, imp.pivot, imp.pixelsPerTile]).toEqual([78, 81, { x: 44, y: 57 }, 28.3]);
		expect(imp.sheets).toEqual([
			sheet("imp-attack.png", 384, 888, 64, 74, 37, 57),
			sheet("imp-body.png", 496, 1024, 62, 64, 36, 48),
			sheet("imp-death.png", 312, 840, 78, 70, 44, 46),
		]);
		// Attack 5 (9 frames), then idle 4 / Run 8 / TakeDamage 4 on the body sheet, Die 6 on its own
		expect(imp.animations).toEqual({
			attack: { sheet: 0, start: 0, frames: 9, fps: 12, loop: false },
			death: { sheet: 2, start: 0, frames: 6, fps: 10, loop: false },
			hit: { sheet: 1, start: 96, frames: 4, fps: 12, loop: false },
			idle: { sheet: 1, start: 0, frames: 4, fps: 6, loop: true },
			move: { sheet: 1, start: 32, frames: 8, fps: 14, loop: true },
		});
		const summoner = VALE_SPRITE_LAYOUTS["enemy.summoner"];
		expect([summoner.frameW, summoner.frameH, summoner.pivot, summoner.pixelsPerTile]).toEqual([
			100,
			104,
			{ x: 52, y: 68 },
			31.3,
		]);
		expect(summoner.sheets).toEqual([
			sheet("summoner-attack.png", 960, 930, 80, 93, 42, 68),
			sheet("summoner-body.png", 700, 1001, 70, 77, 37, 55),
			sheet("summoner-death.png", 600, 696, 100, 87, 52, 51),
		]);
		// Attack 2 (the panic, 6) then Taunt (the cast, attack.2, 8) share the attack sheet
		expect(summoner.animations).toEqual({
			attack: { sheet: 0, start: 0, frames: 6, fps: 12, loop: false },
			"attack.2": { sheet: 0, start: 48, frames: 8, fps: 8, loop: false },
			death: { sheet: 2, start: 0, frames: 6, fps: 10, loop: false },
			hit: { sheet: 1, start: 96, frames: 4, fps: 12, loop: false },
			idle: { sheet: 1, start: 0, frames: 4, fps: 6, loop: true },
			move: { sheet: 1, start: 32, frames: 8, fps: 10, loop: true },
		});
		for (const [id] of SETS) {
			const l = VALE_SPRITE_LAYOUTS[id];
			expect([id, l.facings, l.resample]).toEqual([id, { count: 8, zeroDeg: 0, ccw: true }, "Default"]);
			for (const s of l.sheets) {
				const c = s as unknown as { frameW: number; frameH: number };
				expect([s.file, s.w <= 1024, s.h <= 1024, s.w % c.frameW, s.h % c.frameH]).toEqual([
					s.file,
					true,
					true,
					0,
					0,
				]);
			}
		}
	});

	it("as bundled (uploaded 2026-10-31) both are their sprite sets, every sheet with its rim", () => {
		for (const [id, prefix] of SETS) {
			for (const file of filesOf(prefix))
				expect([file, VALE_ASSET_IDS[file] !== undefined]).toEqual([file, true]);
			expect([id, VALE_MANIFEST.assets[id].kind]).toEqual([id, "sprites"]);
			const set = VALE_MANIFEST.assets[id] as SpriteSetAsset;
			for (const sheet of set.sheets) {
				expect([id, sheet.outlineAssetId !== undefined]).toEqual([id, true]);
			}
		}
	});

	it("each switches to sprites with all three sheets; any sheet missing keeps it a placeholder; rims alone never do", () => {
		const theme = new ThemeCore(buildValeManifest(fakeIds()), { warn: quiet });
		const names: Record<string, Array<string>> = {
			"enemy.imp": ["attack", "death", "hit", "idle", "move"],
			"enemy.summoner": ["attack", "attack.2", "death", "hit", "idle", "move"],
		};
		for (const [id, prefix] of SETS) {
			expect(sheetsOf(prefix)).toEqual(VALE_SPRITE_LAYOUTS[id].sheets.map((s) => s.file));
			const m = buildValeManifest(fakeIds());
			expect(validateManifest(m, { packId: "vale" })).toEqual([]);
			expect([id, m.assets[id].kind]).toEqual([id, "sprites"]);
			expect([id, theme.sprites(id)!.animationNames]).toEqual([id, names[id]]);
			for (const file of sheetsOf(prefix)) {
				const without = buildValeManifest(fakeIds(file));
				expect(validateManifest(without, { packId: "vale" })).toEqual([]);
				expect([id, file, without.assets[id]]).toEqual([id, file, { kind: "placeholder" }]);
			}
			const outlinesOnly = buildValeManifest(fakeIds(...sheetsOf(prefix)));
			expect([id, outlinesOnly.assets[id]]).toEqual([id, { kind: "placeholder" }]);
			for (const [other] of SETS) {
				if (other !== id) expect([id, other, outlinesOnly.assets[other].kind]).toEqual([id, other, "sprites"]);
			}
		}
	});

	it("the rims join per sheet and never hold a set back", () => {
		for (const [id, prefix] of SETS) {
			const [attack, body, death] = sheetsOf(prefix);
			const rimless = buildValeManifest(fakeIds(outlineOf(attack), outlineOf(body), outlineOf(death)));
			expect(validateManifest(rimless, { packId: "vale" })).toEqual([]);
			const set = rimless.assets[id] as SpriteSetAsset;
			expect([id, set.kind, set.sheets.size()]).toEqual([id, "sprites", 3]);
			for (const s of set.sheets) expect([id, s.outlineAssetId]).toEqual([id, undefined]);
			// one rim missing: only its own sheet goes without
			const ids = fakeIds(outlineOf(death));
			const part = new ThemePack(buildValeManifest(ids), { warn: quiet }).sprites(id)!;
			expect([id, part.frame("idle", 0, 0).outlineImage]).toEqual([id, ids[outlineOf(body)]]);
			expect([id, part.frame("attack", 0, 0).outlineImage]).toEqual([id, ids[outlineOf(attack)]]);
			expect([id, part.frame("death", 0, 0).outlineImage]).toEqual([id, undefined]);
			// with every file each sheet carries its own outline, on every frame
			const all = fakeIds();
			const sprites = new ThemeCore(buildValeManifest(all), { warn: quiet }).sprites(id)!;
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
							all[file],
							all[outlineOf(file)],
						]);
					}
				}
			}
		}
	});

	it("copies each sheet's own cell into the manifest and draws every frame in it (hand-computed rects)", () => {
		const ids = fakeIds();
		const m = buildValeManifest(ids);
		const pack = new ThemePack(m, { warn: quiet });
		/** [image, outline, x, y, w, h, pivot] of one frame. */
		const rect = (id: string, name: string, d: number, f: number) => {
			const r = pack.sprites(id)!.frame(name, d, f);
			return [r.image, r.outlineImage, r.offset.X, r.offset.Y, r.size.X, r.size.Y, r.pivot];
		};
		const at = (file: string, x: number, y: number, w: number, h: number, px: number, py: number) => [
			ids[file],
			ids[outlineOf(file)],
			x,
			y,
			w,
			h,
			{ x: px, y: py },
		];
		const imp = m.assets["enemy.imp"] as SpriteSetAsset;
		expect([imp.frameW, imp.frameH, imp.pivot, imp.pixelsPerTile]).toEqual([78, 81, { x: 44, y: 57 }, 28.3]);
		expect(imp.sheets.map((s) => [s.frameW, s.frameH, s.pivot])).toEqual([
			[64, 74, { x: 37, y: 57 }],
			[62, 64, { x: 36, y: 48 }],
			[78, 70, { x: 44, y: 46 }],
		]);
		// attack facing 5 frame 2: cell 47 of the attack sheet (6 per row of 64x74) -> column 5, row 7
		expect(rect("enemy.imp", "attack", 5, 2)).toEqual(at("imp-attack.png", 320, 518, 64, 74, 37, 57));
		// attack facing 7 frame 8: cell 71, the sheet's last -> column 5, row 11 (bottom edge 888)
		expect(rect("enemy.imp", "attack", 7, 8)).toEqual(at("imp-attack.png", 320, 814, 64, 74, 37, 57));
		// move facing 3 frame 5: cell 32 + 24 + 5 = 61 of the body sheet (8 per row of 62x64) -> column 5, row 7
		expect(rect("enemy.imp", "move", 3, 5)).toEqual(at("imp-body.png", 310, 448, 62, 64, 36, 48));
		// hit facing 7 frame 3: cell 96 + 28 + 3 = 127, the body sheet's last -> column 7, row 15 (bottom edge 1024)
		expect(rect("enemy.imp", "hit", 7, 3)).toEqual(at("imp-body.png", 434, 960, 62, 64, 36, 48));
		// death facing 4 frame 5: cell 29 of the death sheet (4 per row of 78x70) -> column 1, row 7
		expect(rect("enemy.imp", "death", 4, 5)).toEqual(at("imp-death.png", 78, 490, 78, 70, 44, 46));
		// death facing 7 frame 5: cell 47, the sheet's last -> column 3, row 11 (bottom edge 840)
		expect(rect("enemy.imp", "death", 7, 5)).toEqual(at("imp-death.png", 234, 770, 78, 70, 44, 46));

		const summoner = m.assets["enemy.summoner"] as SpriteSetAsset;
		expect([summoner.frameW, summoner.frameH, summoner.pivot, summoner.pixelsPerTile]).toEqual([
			100,
			104,
			{ x: 52, y: 68 },
			31.3,
		]);
		expect(summoner.sheets.map((s) => [s.frameW, s.frameH, s.pivot])).toEqual([
			[80, 93, { x: 42, y: 68 }],
			[70, 77, { x: 37, y: 55 }],
			[100, 87, { x: 52, y: 51 }],
		]);
		// attack facing 5 frame 2: cell 32 of the attack sheet (12 per row of 80x93) -> column 8, row 2
		expect(rect("enemy.summoner", "attack", 5, 2)).toEqual(at("summoner-attack.png", 640, 186, 80, 93, 42, 68));
		// attack.2 facing 0 frame 0: cell 48, after the panic's 6 x 8 -> column 0, row 4
		expect(rect("enemy.summoner", "attack.2", 0, 0)).toEqual(at("summoner-attack.png", 0, 372, 80, 93, 42, 68));
		// attack.2 facing 7 frame 7: cell 48 + 56 + 7 = 111, the sheet's last -> column 3, row 9 (bottom edge 930)
		expect(rect("enemy.summoner", "attack.2", 7, 7)).toEqual(at("summoner-attack.png", 240, 837, 80, 93, 42, 68));
		// move facing 3 frame 5: cell 61 of the body sheet (10 per row of 70x77) -> column 1, row 6
		expect(rect("enemy.summoner", "move", 3, 5)).toEqual(at("summoner-body.png", 70, 462, 70, 77, 37, 55));
		// hit facing 7 frame 3: cell 127, the body sheet's last -> column 7, row 12 (bottom edge 1001)
		expect(rect("enemy.summoner", "hit", 7, 3)).toEqual(at("summoner-body.png", 490, 924, 70, 77, 37, 55));
		// death facing 4 frame 5: cell 29 of the death sheet (6 per row of 100x87) -> column 5, row 4
		expect(rect("enemy.summoner", "death", 4, 5)).toEqual(at("summoner-death.png", 500, 348, 100, 87, 52, 51));
		// death facing 7 frame 5: cell 47, the sheet's last -> column 5, row 7 (bottom edge 696)
		expect(rect("enemy.summoner", "death", 7, 5)).toEqual(at("summoner-death.png", 500, 609, 100, 87, 52, 51));
	});

	it("land in the preload core tier with their rims once uploaded (docs/PRELOAD.md: `enemy.` is core)", () => {
		const ids = fakeIds();
		const pack = new ThemePack(buildValeManifest(ids), { warn: quiet });
		const plan = preloadPlan(pack);
		const core = new Set(plan.core.map((r) => r.contentId as string));
		const later = new Set(plan.later.map((r) => r.contentId as string));
		for (const [id, prefix] of SETS) {
			const refs = pack.contentIds(id).map((r) => r.contentId as string);
			const want = filesOf(prefix).map((file) => ids[file]);
			want.sort();
			refs.sort();
			expect([id, refs]).toEqual([id, want]);
			for (const ref of refs) expect([id, ref, core.has(ref), later.has(ref)]).toEqual([id, ref, true, false]);
		}
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

	it("drops the four gems-* pieces from the decor atlas (rebuilt for docs/VOID_DECOR.md VD6)", () => {
		// kept until the next rebuild: wall1 (docs/VOID_DECOR.md VDD10), bones1-sw (bones .4 is the trial kit's chains)
		expect([...VALE_RETIRED_WORLD_ART]).toEqual(["wall1", "bones1-sw"]);
		for (const name of ["gems-blue", "gems-green", "gems-red", "gems-white"]) {
			expect([name, VALE_WORLD_LAYOUTS[name] !== undefined]).toEqual([name, false]);
		}
	});
});

describe("vale draft skin (docs/DRAFT_REVEAL.md DR3: the ToffeeCraft Horror UI sheet's panels and skulls)", () => {
	const ids = draftSkinIds();
	const fileOf = (id: string) => VALE_IMAGE_LAYOUTS[id].file;

	it("has a layout per draft id: the sliced panels, the eyes registered on the back, the skulls with pivots", () => {
		expect(VALE_IMAGE_LAYOUTS["ui.draft.back"]).toEqual({
			file: "ui-draft-back.png",
			w: 93,
			h: 45,
			slice: { left: 46, top: 20, right: 46, bottom: 24 },
		});
		// the mask is the back's size and slice, so drawn over it with the same slice the sockets land on the back's
		const back = VALE_IMAGE_LAYOUTS["ui.draft.back"];
		expect(VALE_IMAGE_LAYOUTS["ui.draft.back.eyes"]).toEqual({ ...back, file: "ui-draft-back-eyes.png" });
		expect(VALE_IMAGE_LAYOUTS["ui.draft.card.common"]).toEqual({
			file: "ui-draft-card-common.png",
			w: 90,
			h: 44,
			slice: { left: 6, top: 6, right: 6, bottom: 6 },
		});
		expect(VALE_IMAGE_LAYOUTS["ui.draft.card.rare"]).toEqual({
			file: "ui-draft-card-rare.png",
			w: 87,
			h: 61,
			slice: { left: 43, top: 30, right: 43, bottom: 30 },
		});
		expect(VALE_IMAGE_LAYOUTS["ui.draft.skull.left"]).toEqual({
			file: "ui-draft-skull-left.png",
			w: 17,
			h: 18,
			pivot: { x: 3, y: 5 },
		});
		expect(VALE_IMAGE_LAYOUTS["ui.draft.skull.right"]).toEqual({
			file: "ui-draft-skull-right.png",
			w: 17,
			h: 18,
			pivot: { x: 14, y: 5 },
		});
		const draftLayouts = sortedKeys(VALE_IMAGE_LAYOUTS).filter((id) => startsWith(id, "ui.draft."));
		expect(draftLayouts).toEqual([...ids]);
	});

	it("before their files have IDs: absent (the overlay's flat card), never a placeholder", () => {
		for (const m of [buildValeManifest(fakeIds(...ids.map(fileOf))), buildValeManifest({})]) {
			expect(validateManifest(m, { packId: "vale" })).toEqual([]);
			const pack = new ThemePack(m, { warn: quiet });
			for (const id of ids) {
				expect([id, m.assets[id]]).toEqual([id, undefined]);
				expect([id, pack.image(id)]).toEqual([id, undefined]);
			}
		}
	});

	it("uploaded 2026-10-30 (DR9): the bundled vale pack draws every draft id as its image", () => {
		expect(validateManifest(VALE_MANIFEST, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		for (const id of ids) {
			const file = VALE_IMAGE_LAYOUTS[id].file;
			expect([id, VALE_ASSET_IDS[file] !== undefined, VALE_MANIFEST.assets[id]?.kind]).toEqual([
				id,
				true,
				"image",
			]);
			expect([id, pack.image(id)?.assetId]).toEqual([id, VALE_ASSET_IDS[file]]);
		}
	});

	it("each id becomes an image once its own file has an ID, with its slice / pivot", () => {
		const all = fakeIds();
		const m = buildValeManifest(all);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		for (const id of ids) {
			const layout = VALE_IMAGE_LAYOUTS[id];
			const want: Record<string, unknown> = {
				kind: "image",
				assetId: all[layout.file],
				w: layout.w,
				h: layout.h,
			};
			if (layout.slice !== undefined) want.slice = { ...layout.slice };
			if (layout.pivot !== undefined) want.pivot = { ...layout.pivot };
			expect([id, m.assets[id]]).toEqual([id, want]);
			const image = pack.image(id)!;
			expect([id, image.assetId, image.slice, image.pivot]).toEqual([
				id,
				all[layout.file],
				layout.slice,
				layout.pivot,
			]);
		}
		// one uploaded file turns on exactly its own id
		const one = buildValeManifest(fakeIds(...ids.filter((id) => id !== "ui.draft.card.rare").map(fileOf)));
		expect(validateManifest(one, { packId: "vale" })).toEqual([]);
		for (const id of ids) {
			expect([id, one.assets[id]?.kind]).toEqual([id, id === "ui.draft.card.rare" ? "image" : undefined]);
		}
	});
});

/**
 * The NE9 sets (docs/NEW_ENEMIES.md NE9, rigs NED2): enemy.bomber (Imp 5; its death sheet also holds `death.2`, the
 * detonation), enemy.charger (Demon Beast 1), enemy.stormcaller (Demon Spawn 7), enemy.warbanner (Imp 3; its body sheet
 * also holds `move.back`, the retreat) and enemy.reaper (Demon Spawn 5), per-sheet cells, three sheets and three rims
 * each. Not uploaded yet: the bundled pack draws all five as their placeholders until their 30 files have IDs.
 */
describe("vale new enemies (NE9: Imp 5 / Beast 1 / Spawn 7 / Imp 3 / Spawn 5, per-sheet cells)", () => {
	/** [id, sheet prefix, pixelsPerTile, the set it takes its density from (undefined: its own bodyTiles), animations]. */
	const SETS: ReadonlyArray<[string, string, number, string | undefined, Array<string>]> = [
		["enemy.bomber", "bomber", 35.6, undefined, ["attack", "death", "death.2", "hit", "idle", "move"]],
		["enemy.charger", "charger", 38, "class.vanguard", ["attack", "death", "hit", "idle", "move"]],
		["enemy.stormcaller", "stormcaller", 31.3, "enemy.summoner", ["attack", "death", "hit", "idle", "move"]],
		["enemy.warbanner", "warbanner", 28.3, "enemy.imp", ["attack", "death", "hit", "idle", "move", "move.back"]],
		["enemy.reaper", "reaper", 31.3, "enemy.summoner", ["attack", "death", "hit", "idle", "move"]],
	];
	const sheetsOf = (prefix: string) => [`${prefix}-attack.png`, `${prefix}-body.png`, `${prefix}-death.png`];
	const outlineOf = (file: string) => `${file.sub(1, -5)}-outline.png`;

	it("the layouts: 8 facings, three per-sheet cells each <= 1024 and a whole number of cells, the measured density", () => {
		for (const [id, prefix, ppt, from] of SETS) {
			const l = VALE_SPRITE_LAYOUTS[id];
			expect([id, l.facings, l.resample, l.pixelsPerTile]).toEqual([
				id,
				{ count: 8, zeroDeg: 0, ccw: true },
				"Default",
				ppt,
			]);
			if (from !== undefined)
				expect([id, from, VALE_SPRITE_LAYOUTS[from].pixelsPerTile]).toEqual([id, from, ppt]);
			expect([id, l.sheets.map((s) => s.file)]).toEqual([id, sheetsOf(prefix)]);
			for (const s of l.sheets) {
				const c = s as unknown as { frameW: number; frameH: number; pivot?: unknown };
				expect([s.file, s.outlineFile, c.pivot !== undefined]).toEqual([s.file, outlineOf(s.file), true]);
				expect([s.file, s.w <= 1024, s.h <= 1024, s.w % c.frameW, s.h % c.frameH]).toEqual([
					s.file,
					true,
					true,
					0,
					0,
				]);
			}
		}
		// the optional animations share a sheet: Explode after Die 1 (6 x 8 cells), Run Backwards after Walk
		expect(VALE_SPRITE_LAYOUTS["enemy.bomber"].animations["death.2"]).toEqual({
			sheet: 2,
			start: 48,
			frames: 9,
			fps: 12,
			loop: false,
		});
		expect(VALE_SPRITE_LAYOUTS["enemy.warbanner"].animations["move.back"]).toEqual({
			sheet: 1,
			start: 96,
			frames: 8,
			fps: 10,
			loop: true,
		});
	});

	it("as bundled: all five uploaded sets draw sprites", () => {
		const uploaded = ["enemy.bomber", "enemy.charger", "enemy.reaper", "enemy.stormcaller", "enemy.warbanner"];
		for (const [id, prefix] of SETS) {
			const on = uploaded.includes(id);
			for (const file of sheetsOf(prefix)) {
				expect([
					file,
					VALE_ASSET_IDS[file] !== undefined,
					VALE_ASSET_IDS[outlineOf(file)] !== undefined,
				]).toEqual([file, on, on]);
			}
			if (on) expect([id, VALE_MANIFEST.assets[id].kind]).toEqual([id, "sprites"]);
			else expect([id, VALE_MANIFEST.assets[id]]).toEqual([id, { kind: "placeholder" }]);
		}
	});

	it("each switches to sprites with all three sheets; any sheet missing keeps it a placeholder; rims alone never do", () => {
		const theme = new ThemeCore(buildValeManifest(fakeIds()), { warn: quiet });
		for (const [id, prefix, , , names] of SETS) {
			const m = buildValeManifest(fakeIds());
			expect(validateManifest(m, { packId: "vale" })).toEqual([]);
			expect([id, m.assets[id].kind]).toEqual([id, "sprites"]);
			expect([id, theme.sprites(id)!.animationNames]).toEqual([id, names]);
			for (const file of sheetsOf(prefix)) {
				const without = buildValeManifest(fakeIds(file));
				expect(validateManifest(without, { packId: "vale" })).toEqual([]);
				expect([id, file, without.assets[id]]).toEqual([id, file, { kind: "placeholder" }]);
			}
			const outlinesOnly = buildValeManifest(fakeIds(...sheetsOf(prefix)));
			expect([id, outlinesOnly.assets[id]]).toEqual([id, { kind: "placeholder" }]);
		}
	});
});

/**
 * The Goldling (docs/FORTUNE.md FO10 / FD14, docs/ART.md "Recolour"): enemy.golden is the swarmer's Lords of Pain
 * skeleton recoloured gold by the pipeline's `recolor`, so its cells, pivot, sheets' sizes and animations are the
 * swarmer's; only its density differs (bodyTiles 0.95 against 1.25: drawn smaller). Not uploaded yet: the bundled pack
 * draws its placeholder gold block until both sheets have IDs.
 */
describe("vale Goldling (FO10: the skeleton recoloured gold)", () => {
	const SHEETS = ["golden-move.png", "golden-death.png"];
	const RIMS = ["golden-move-outline.png", "golden-death-outline.png"];

	it("the layout: the swarmer's cells, pivot, sheet sizes and animations, its own files, a higher density", () => {
		const l = VALE_SPRITE_LAYOUTS["enemy.golden"];
		const s = VALE_SPRITE_LAYOUTS["enemy.swarmer"];
		expect([l.frameW, l.frameH, l.pivot, l.facings, l.resample]).toEqual([
			s.frameW,
			s.frameH,
			s.pivot,
			s.facings,
			s.resample,
		]);
		expect(l.animations).toEqual(s.animations);
		expect(l.sheets.map((sheet) => [sheet.file, sheet.w, sheet.h, sheet.outlineFile])).toEqual([
			["golden-move.png", s.sheets[0].w, s.sheets[0].h, "golden-move-outline.png"],
			["golden-death.png", s.sheets[1].w, s.sheets[1].h, "golden-death-outline.png"],
		]);
		// 37 px body / 0.95 tiles (the swarmer: / 1.25 = 29.6), so it draws at 29.6 / 38.9 = 76 % of a skeleton
		expect([l.pixelsPerTile, s.pixelsPerTile]).toEqual([38.9, 29.6]);
	});

	it("as bundled (uploaded 2026-11-04): the Goldling draws its sprites", () => {
		for (const file of [...SHEETS, ...RIMS])
			expect([file, VALE_ASSET_IDS[file] !== undefined]).toEqual([file, true]);
		expect(VALE_MANIFEST.assets["enemy.golden"].kind).toBe("sprites");
	});

	it("switches to sprites with both sheets; either missing keeps the placeholder; the rims alone never do", () => {
		const m = buildValeManifest(fakeIds());
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		expect(m.assets["enemy.golden"].kind).toBe("sprites");
		const theme = new ThemeCore(m, { warn: quiet });
		expect(theme.sprites("enemy.golden")!.animationNames).toEqual(["attack", "death", "hit", "idle", "move"]);
		for (const file of SHEETS) {
			const without = buildValeManifest(fakeIds(file));
			expect(validateManifest(without, { packId: "vale" })).toEqual([]);
			expect([file, without.assets["enemy.golden"]]).toEqual([file, { kind: "placeholder" }]);
		}
		expect(buildValeManifest(fakeIds(...SHEETS)).assets["enemy.golden"]).toEqual({ kind: "placeholder" });
	});
});
