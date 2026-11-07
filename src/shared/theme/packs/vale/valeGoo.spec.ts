// The vale pack's goo floor sprite (docs/GOO_ART.md GA2): gooLayout.ts becomes the `bullet.enemy.goo` floor sprite set
// once goo.png has an ID (absent: the placeholder disc exactly as today), the runtime addresses the cells the pipeline
// wrote, and the real layout passes the goo rules (gooArtReport) and the validator.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BULLET_ART } from "../../contract";
import { gooArtReport } from "../../gooArt";
import { ThemePack, hexToColor3 } from "../../pack";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { GOO_BULLET_ID } from "../../variants";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_GOO_SOURCE, valeGooAsset, type ValeGooSource } from "./goo";
import { VALE_GOO_LAYOUT, VALE_GOO_SHEET } from "./gooLayout";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";

const quiet = () => undefined;
/** A fake upload (test vector) for the goo sheet. */
const SHEET_ID = "rbxassetid://7400";

/** A synthetic sheet in gooLayout.ts's shape: 3 cells of 33 x 19 in one row (land, two hold variants). */
const FAKE: ValeGooSource = {
	sheet: { file: VALE_GOO_SHEET.file, w: 99, h: 19 },
	layout: {
		frameW: 33,
		frameH: 19,
		pivot: { x: 16.5, y: 9.5 },
		land: 0,
		hold: 1,
		holdFrames: 2,
		litW: 31,
		litH: 17,
		meanColor: "#e824e8",
		pixelsPerTile: 29.6,
	},
};

describe("vale goo (docs/GOO_ART.md GA2)", () => {
	it("reads the generated layout by default", () => {
		expect(VALE_GOO_SOURCE.sheet).toBe(VALE_GOO_SHEET);
		expect(VALE_GOO_SOURCE.layout).toBe(VALE_GOO_LAYOUT);
		expect(VALE_GOO_SHEET.file).toBe("goo.png");
	});

	it("without goo.png's ID the goo is the placeholder disc, exactly as the placeholder pack", () => {
		const manifests = [buildValeManifest({}), buildValeManifest({}, { goo: FAKE })];
		if (VALE_ASSET_IDS[VALE_GOO_SHEET.file] === undefined) manifests.push(VALE_MANIFEST);
		for (const m of manifests) {
			expect(m.assets[GOO_BULLET_ID]).toEqual(PLACEHOLDER_MANIFEST.assets[GOO_BULLET_ID]);
			expect(gooArtReport(m)).toEqual([]);
			expect(new ThemePack(m, { warn: quiet }).floorSprite(GOO_BULLET_ID)).toBe(undefined);
		}
		expect(valeGooAsset({})).toEqual({});
		expect(valeGooAsset({}, FAKE)).toEqual({});
	});

	it("with the ID the goo is a one-facing floor sprite set over the sheet: land, hold, lit box, mean", () => {
		const m = buildValeManifest({ [FAKE.sheet.file]: SHEET_ID }, { goo: FAKE });
		const set = m.assets[GOO_BULLET_ID] as SpriteSetAsset;
		expect([set.kind, set.facings.count, set.resample, set.frameW, set.frameH, set.pixelsPerTile]).toEqual([
			"sprites",
			1,
			"Pixelated",
			33,
			19,
			29.6,
		]);
		expect(set.sheets).toEqual([{ assetId: SHEET_ID, w: 99, h: 19 }]);
		expect(sortedKeys(set.animations)).toEqual([BULLET_ART.hold, BULLET_ART.land]);
		expect([set.animations.land.start, set.animations.land.frames]).toEqual([0, 1]);
		expect([set.animations.hold.start, set.animations.hold.frames]).toEqual([1, 2]);
		expect([set.meanColor, set.lit]).toEqual(["#e824e8", { w: 31, h: 17 }]);
		// strike and ember stay placeholders (no hazards.png id in this manifest)
		for (const id of BULLET_ART.hazardSpriteIds)
			expect([id, m.assets[id]]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
	});

	it("the real generated layout validates with zero problems and passes every goo rule", () => {
		const m = buildValeManifest({ [VALE_GOO_SHEET.file]: SHEET_ID });
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const report = gooArtReport(m);
		expect(report.size() > 0).toBe(true);
		for (const e of report) expect([e.check, e.against, e.ok]).toEqual([e.check, e.against, true]);
		const synthetic = buildValeManifest({ [FAKE.sheet.file]: SHEET_ID }, { goo: FAKE });
		expect(validateManifest(synthetic, { packId: "vale" })).toEqual([]);
	});

	it("pack.floorSprite addresses the pipeline's cells", () => {
		const warnings = new Array<string>();
		const pack = new ThemePack(buildValeManifest({ [FAKE.sheet.file]: SHEET_ID }, { goo: FAKE }), {
			warn: (w) => warnings.push(w),
		});
		const g = pack.floorSprite(GOO_BULLET_ID)!;
		expect([g.holdFrames, g.litW, g.litH]).toEqual([2, 31, 17]);
		expect(g.meanColor).toEqual(hexToColor3("#e824e8"));
		expect([g.land.offset.X, g.hold(0).offset.X, g.hold(1).offset.X]).toEqual([0, 33, 66]);
		expect([g.land.size.X, g.land.size.Y]).toEqual([33, 19]);
		const real = new ThemePack(buildValeManifest({ [VALE_GOO_SHEET.file]: SHEET_ID }), { warn: quiet });
		const r = real.floorSprite(GOO_BULLET_ID)!;
		const l = VALE_GOO_LAYOUT;
		const perRow = math.floor(VALE_GOO_SHEET.w / l.frameW);
		expect([r.land.offset.X, r.land.offset.Y]).toEqual([
			(l.land % perRow) * l.frameW,
			math.floor(l.land / perRow) * l.frameH,
		]);
		expect([r.hold(0).offset.X, r.hold(0).offset.Y]).toEqual([
			(l.hold % perRow) * l.frameW,
			math.floor(l.hold / perRow) * l.frameH,
		]);
		expect(warnings).toEqual([]);
	});
});
