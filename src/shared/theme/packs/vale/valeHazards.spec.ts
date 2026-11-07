// The vale pack's floor hazard sprites (docs/HAZARD_ART.md HA3): hazardLayout.ts becomes the strike's and the embers'
// hazard sprite sets once hazards.png has an ID (absent: the placeholder discs exactly as today), and the real layout
// passes the hazard rules (hazardArtReport) and the validator, with the generator's geometry (the strike's rim maps
// onto STRIKE_BULLET_RADIUS at the layout's density).
import { describe, expect, it } from "@rbxts/jest-globals";
import { BULLET_ART } from "../../contract";
import { hazardArtReport } from "../../hazardArt";
import { ThemePack } from "../../pack";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { sortedKeys, startsWith } from "../../util";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_HAZARD_SOURCE, valeHazardAssets } from "./hazards";
import { VALE_HAZARD_LAYOUTS, VALE_HAZARD_SHEET } from "./hazardLayout";
import { buildValeManifest } from "./manifest";

const SHEET_ID = "rbxassetid://7401";
/** shared/sim STRIKE_BULLET_RADIUS (tiles), written out: the theme does not import the sim. */
const STRIKE_RADIUS_TILES = 1.1;

describe("vale hazards (docs/HAZARD_ART.md HA3)", () => {
	it("without a hazards.png ID: no sets, the placeholder discs", () => {
		expect(valeHazardAssets({})).toEqual({});
		if (VALE_ASSET_IDS[VALE_HAZARD_SHEET.file] === undefined) {
			const m = buildValeManifest(VALE_ASSET_IDS);
			for (const id of BULLET_ART.hazardSpriteIds)
				expect([id, m.assets[id]]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
		}
	});

	it("the generated layout holds exactly the two hazards with the generator's geometry", () => {
		expect(sortedKeys(VALE_HAZARD_LAYOUTS)).toEqual([...BULLET_ART.hazardSpriteIds].sort());
		expect(VALE_HAZARD_SOURCE.layouts).toBe(VALE_HAZARD_LAYOUTS);
		const strike = VALE_HAZARD_LAYOUTS["bullet.enemy.strike"];
		expect([strike.frameW, strike.frameH, strike.pivot.x, strike.pivot.y, strike.rimPx]).toEqual([
			77, 77, 38.5, 38.5, 33,
		]);
		// the rim is the hit radius at the layout's density, within half a pixel
		expect(math.abs((strike.rimPx as number) - STRIKE_RADIUS_TILES * strike.pixelsPerTile) <= 0.5).toBe(true);
		const ember = VALE_HAZARD_LAYOUTS["bullet.player.ember"];
		expect([ember.frameW, ember.frameH, ember.lit, ember.animations.burn.frames]).toEqual([
			17,
			31,
			{ w: 15, h: 12 },
			6,
		]);
	});

	it("with an ID: both sets, Pixelated, one facing, the real layout validates with zero problems", () => {
		const m = buildValeManifest({ ...VALE_ASSET_IDS, [VALE_HAZARD_SHEET.file]: SHEET_ID });
		for (const id of BULLET_ART.hazardSpriteIds) {
			const set = m.assets[id] as unknown as { kind: string; resample: string; facings: { count: number } };
			expect([id, set.kind, set.resample, set.facings.count]).toEqual([id, "sprites", "Pixelated", 1]);
		}
		expect(hazardArtReport(m).filter((e) => !e.ok)).toEqual([]);
		const problems = validateManifest(m, { packId: "vale" }).filter(
			(e) => startsWith(e, 'assets["bullet.enemy.strike"]') || startsWith(e, 'assets["bullet.player.ember"]'),
		);
		expect(problems).toEqual([]);
		const pack = new ThemePack(m, { warn: () => undefined });
		const strike = pack.hazardSprite("bullet.enemy.strike")!;
		expect([strike.frames("flash"), strike.frames("scorch"), strike.rimPx]).toEqual([3, 2, 33]);
		expect(strike.frame("flash", 0).image).toBe(SHEET_ID);
		const ember = pack.hazardSprite("bullet.player.ember")!;
		expect([ember.frames("burn"), ember.litW, ember.litH]).toEqual([6, 15, 12]);
	});
});
