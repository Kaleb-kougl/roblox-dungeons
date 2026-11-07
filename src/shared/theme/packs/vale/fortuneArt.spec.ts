// The pact altar and the Goldling's coin burst in the vale pack (docs/FORTUNE.md FO10): original pixel art in sheets of
// their own (fortuneLayout.ts, generated from art/atlases.json `fortune`). The altar is a one-facing world sprite set
// (round), drawn at its own scale under the view's cap with the flame on its coal bed; the coin burst a tinted one-shot
// fx flipbook. Neither switches on before its PNG has an ID, and with both uploaded the manifest validates and the pack
// hands the renderers what they expect.
import { describe, expect, it } from "@rbxts/jest-globals";
import { altarArtFit, PACTS_VIEW } from "shared/view/pacts";
import { FX_ANIMATION, FX_SPRITE_MAX_TILES } from "../../contract";
import { GOLDEN_COIN_FX_ID, GOLDEN_COIN_ROLE, PACT_ALTAR_ID } from "../../fortune";
import { ThemePack } from "../../pack";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import type { SpriteSetAsset } from "../../types";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_FX, VALE_FX_PENDING, valeFxSourceOf } from "./fx";
import { VALE_FORTUNE_FX_LAYOUTS, VALE_FORTUNE_FX_SHEET, VALE_PACT_ALTAR_LAYOUT } from "./fortuneLayout";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";

const quiet = () => undefined;
const ALTAR_FILE = VALE_PACT_ALTAR_LAYOUT.sheets[0].file;
const COIN_FILE = VALE_FORTUNE_FX_SHEET.file;
/** Fake uploaded IDs (test vectors) for the two sheets. */
const IDS: Record<string, string> = { [ALTAR_FILE]: "rbxassetid://7501", [COIN_FILE]: "rbxassetid://7502" };

describe("vale Fortune art (pact.altar, fx.golden.coin)", () => {
	it("the altar is one round facing, one idle frame, Pixelated, at the pack's scale and under the view's cap", () => {
		const a = VALE_PACT_ALTAR_LAYOUT;
		expect(a.facings.count).toBe(1);
		expect(a.animations).toEqual({ idle: { sheet: 0, start: 0, frames: 1, fps: 1, loop: true } });
		expect([a.resample, a.pixelsPerTile]).toEqual(["Pixelated", 29.6]);
		expect([a.sheets.size(), a.sheets[0].w, a.sheets[0].h]).toEqual([1, a.frameW, a.frameH]);
		// its pivot (the footprint centre on the floor) inside the cell, the near half of the foot below it
		expect(a.pivot.x > 0 && a.pivot.x < a.frameW && a.pivot.y > 0 && a.pivot.y < a.frameH).toBe(true);
		// drawn at its own scale (not capped), so the flame stands exactly on its coal bed
		const fit = altarArtFit(a);
		expect(fit.layout.pixelsPerTile).toBe(a.pixelsPerTile);
		expect(fit.topTiles).toBe(PACTS_VIEW.artTopTiles);
		// the coal bed lies inside the drawn art: below the top of the cell
		expect(PACTS_VIEW.artTopTiles < a.pivot.y / a.pixelsPerTile).toBe(true);
	});

	it("the coin burst is a grey one-shot flipbook in its own sheet, tinted golden.coin, within the fx size cap", () => {
		const l = VALE_FORTUNE_FX_LAYOUTS[GOLDEN_COIN_FX_ID];
		expect([l.loop, l.grey, l.frames > 1, l.fps > 0]).toEqual([false, true, true, true]);
		expect(valeFxSourceOf(GOLDEN_COIN_FX_ID)?.sheet).toBe(VALE_FORTUNE_FX_SHEET);
		expect(VALE_FX_PENDING.includes(GOLDEN_COIN_FX_ID)).toBe(false);
		const look = VALE_FX[GOLDEN_COIN_FX_ID];
		expect([look.tint, look.additive]).toEqual([GOLDEN_COIN_ROLE, false]);
		expect(look.sizeTiles > 0 && look.sizeTiles <= FX_SPRITE_MAX_TILES).toBe(true);
	});

	it("without IDs the altar keeps its placeholder plinth and there is no coin burst", () => {
		const m = buildValeManifest({});
		expect(m.assets[PACT_ALTAR_ID]).toEqual(PLACEHOLDER_MANIFEST.assets[PACT_ALTAR_ID]);
		expect(m.assets[GOLDEN_COIN_FX_ID]).toBe(undefined);
	});

	it("as bundled, each switches on exactly when its sheet has an ID", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect(pack.pactAltar().art?.kind).toBe(VALE_ASSET_IDS[ALTAR_FILE] !== undefined ? "sprites" : undefined);
		expect(pack.fx(GOLDEN_COIN_FX_ID) !== undefined).toBe(VALE_ASSET_IDS[COIN_FILE] !== undefined);
	});

	it("with both sheets uploaded validates with zero problems and draws the altar and the coin burst", () => {
		const m = buildValeManifest(IDS);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const altar = m.assets[PACT_ALTAR_ID] as SpriteSetAsset;
		expect([altar.kind, altar.sheets[0].assetId, altar.facings.count, altar.resample]).toEqual([
			"sprites",
			IDS[ALTAR_FILE],
			1,
			"Pixelated",
		]);
		const pack = new ThemePack(m, { warn: quiet });
		const art = pack.pactAltar().art;
		expect(art?.kind).toBe("sprites");
		if (art?.kind === "sprites") {
			const f = art.set.frame("idle", 0, 0);
			expect([f.image, f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual([
				IDS[ALTAR_FILE],
				0,
				0,
				VALE_PACT_ALTAR_LAYOUT.frameW,
				VALE_PACT_ALTAR_LAYOUT.frameH,
			]);
		}
		const fx = pack.fx(GOLDEN_COIN_FX_ID);
		expect(fx !== undefined).toBe(true);
		if (fx === undefined) return;
		const l = VALE_FORTUNE_FX_LAYOUTS[GOLDEN_COIN_FX_ID];
		expect([fx.frames, fx.fps, fx.loop, fx.tint]).toEqual([l.frames, l.fps, false, GOLDEN_COIN_ROLE]);
		// frame f's cell through the SpriteSetAsset formula
		const perRow = math.floor(VALE_FORTUNE_FX_SHEET.w / l.frameW);
		for (let f = 0; f < l.frames; f++) {
			const r = fx.frame(f);
			const c = l.start + f;
			expect([f, r.offset.X, r.offset.Y]).toEqual([
				f,
				(c % perRow) * l.frameW,
				math.floor(c / perRow) * l.frameH,
			]);
		}
		expect(fx.set.animationNames.includes(FX_ANIMATION)).toBe(true);
	});
});
