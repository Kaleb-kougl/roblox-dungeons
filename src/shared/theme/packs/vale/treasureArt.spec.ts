// The vault's cage and light column in the vale pack (docs/TREASURE.md TR9): original pixel art in sheets of their own
// (treasureLayout.ts, generated from art/atlases.json `treasure`). The cage is a four-facing sprite set like the chest
// (so it turns with it), the column a tinted fx flipbook; neither switches on before its PNG has an ID, and with both
// uploaded the manifest validates and the pack hands the renderer what it expects.
import { describe, expect, it } from "@rbxts/jest-globals";
import { FX_ANIMATION } from "../../contract";
import { ThemePack } from "../../pack";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { TREASURE_CAGE_ID, TREASURE_CHEST_ID, TREASURE_COLUMN_FX_ID } from "../../treasure";
import type { SpriteSetAsset } from "../../types";
import { validateManifest } from "../../validate";
import { VALE_FX, valeFxSourceOf } from "./fx";
import { VALE_WORLD_LAYOUTS } from "./layout";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";
import { VALE_TREASURE_CAGE_LAYOUT, VALE_TREASURE_FX_LAYOUTS, VALE_TREASURE_FX_SHEET } from "./treasureLayout";

const quiet = () => undefined;
const CAGE_FILE = VALE_TREASURE_CAGE_LAYOUT.sheets[0].file;
const COLUMN_FILE = VALE_TREASURE_FX_SHEET.file;
/** Fake uploaded IDs (test vectors) for the two sheets. */
const IDS: Record<string, string> = { [CAGE_FILE]: "rbxassetid://7401", [COLUMN_FILE]: "rbxassetid://7402" };

describe("vale vault art (treasure.cage, fx.treasure.column)", () => {
	it("the cage turns like the chest: four facings from 45 degrees, one idle frame each, at the pack's scale", () => {
		const cage = VALE_TREASURE_CAGE_LAYOUT;
		const chest = VALE_WORLD_LAYOUTS["kit-chest"];
		expect(chest.kind).toBe("sprites");
		if (chest.kind !== "sprites") return;
		expect(cage.facings).toEqual(chest.facings);
		expect(cage.pixelsPerTile).toBe(chest.pixelsPerTile);
		expect(cage.animations.idle).toEqual({ sheet: 0, start: 0, frames: 1, fps: 1, loop: true });
		expect(cage.resample).toBe("Pixelated");
		// one row of four cells; the pivot (the footprint centre on the floor) inside the cell
		expect([cage.sheets[0].w, cage.sheets[0].h]).toEqual([cage.frameW * 4, cage.frameH]);
		expect(cage.pivot.x > 0 && cage.pivot.x < cage.frameW && cage.pivot.y > 0 && cage.pivot.y < cage.frameH).toBe(
			true,
		);
		// it stands round the chest: wider and taller than the chest's cell above the pivot
		expect(cage.frameW > chest.frameW).toBe(true);
		expect(cage.pivot.y > chest.pivot.y).toBe(true);
	});

	it("the column is a looping grey flipbook in its own sheet, tinted, within the fx size cap", () => {
		const l = VALE_TREASURE_FX_LAYOUTS[TREASURE_COLUMN_FX_ID];
		expect([l.loop, l.grey, l.frames > 1, l.fps > 0]).toEqual([true, true, true, true]);
		expect(valeFxSourceOf(TREASURE_COLUMN_FX_ID)?.sheet).toBe(VALE_TREASURE_FX_SHEET);
		// a tall, narrow beam (drawn upright at TREASURE_VIEW.open.column's size)
		expect(l.frameH > 4 * l.frameW).toBe(true);
		expect(VALE_FX[TREASURE_COLUMN_FX_ID].tint).toBe("treasure.legendary");
	});

	it("as bundled (both sheets uploaded 2026-11-06) draws the cage and the column", () => {
		expect([VALE_ASSET_IDS[CAGE_FILE] !== undefined, VALE_ASSET_IDS[COLUMN_FILE] !== undefined]).toEqual([
			true,
			true,
		]);
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect(pack.treasurePiece(TREASURE_CAGE_ID).art?.kind).toBe("sprites");
		expect(pack.fx(TREASURE_COLUMN_FX_ID) !== undefined).toBe(true);
	});

	it("without IDs the cage keeps its placeholder bars and there is no column", () => {
		const m = buildValeManifest({});
		expect(m.assets[TREASURE_CAGE_ID]).toEqual(PLACEHOLDER_MANIFEST.assets[TREASURE_CAGE_ID]);
		expect(m.assets[TREASURE_COLUMN_FX_ID]).toBe(undefined);
	});

	it("with both sheets uploaded validates with zero problems and draws the cage and column", () => {
		const m = buildValeManifest(IDS);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const cage = m.assets[TREASURE_CAGE_ID] as SpriteSetAsset;
		expect([cage.kind, cage.sheets[0].assetId, cage.facings.count]).toEqual(["sprites", IDS[CAGE_FILE], 4]);
		// the chest is untouched by the cage's sheet (its own IDs, not given here: the placeholder)
		expect(m.assets[TREASURE_CHEST_ID]).toEqual(PLACEHOLDER_MANIFEST.assets[TREASURE_CHEST_ID]);
		const pack = new ThemePack(m, { warn: quiet });
		expect(pack.treasurePiece(TREASURE_CAGE_ID).art?.kind).toBe("sprites");
		const fx = pack.fx(TREASURE_COLUMN_FX_ID);
		expect(fx !== undefined).toBe(true);
		if (fx === undefined) return;
		const l = VALE_TREASURE_FX_LAYOUTS[TREASURE_COLUMN_FX_ID];
		expect([fx.frames, fx.fps, fx.loop, fx.tint]).toEqual([l.frames, l.fps, true, "treasure.legendary"]);
		// frame f's cell through the SpriteSetAsset formula
		const perRow = math.floor(VALE_TREASURE_FX_SHEET.w / l.frameW);
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
