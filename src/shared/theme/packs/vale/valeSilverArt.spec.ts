// Silver's art in the vale pack (docs/SILVER.md SV7): original pixel art by scripts/art/gen-silver-art.js in two sheets of
// their own (silverLayout.ts, generated from art/atlases.json `silver`). The counter's icon `ui.icon.silver` (12 x 12,
// the counter's box) switches on with the icon sheet's ID; the crate burst's flying coin `fx.silver.coins` (a grey
// looping turn, tinted silver) with the coin sheet's. Neither is in the pack before its PNG has an ID (the counter draws
// its chip, the coin layer its discs); with both, the manifest validates and the pack hands the HUD what it expects.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SILVER_COUNTER } from "shared/view/silver";
import { FX_SPRITE_MAX_TILES } from "../../contract";
import { ThemePack } from "../../pack";
import { SILVER_COINS_FX_ID, SILVER_ICON_ID, SILVER_ROLE } from "../../silver";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_FX, VALE_FX_PENDING, valeFxSourceOf } from "./fx";
import { VALE_SILVER_ICON_SOURCE, buildValeManifest } from "./manifest";
import {
	VALE_SILVER_FX_LAYOUTS,
	VALE_SILVER_FX_SHEET,
	VALE_SILVER_ICONS,
	VALE_SILVER_ICON_ATLAS,
	VALE_SILVER_ICON_FILE,
} from "./silverLayout";

const quiet = () => undefined;
const ICON_SHEET_ID = "rbxassetid://7601";
const COIN_SHEET_ID = "rbxassetid://7602";

/** The uploaded IDs without Silver's two sheets, plus the ones asked for. */
function idsWith(icon: boolean, coin: boolean): Record<string, string> {
	const ids: Record<string, string> = {};
	for (const file of sortedKeys(VALE_ASSET_IDS)) {
		if (file !== VALE_SILVER_ICON_FILE && file !== VALE_SILVER_FX_SHEET.file) ids[file] = VALE_ASSET_IDS[file];
	}
	if (icon) ids[VALE_SILVER_ICON_FILE] = ICON_SHEET_ID;
	if (coin) ids[VALE_SILVER_FX_SHEET.file] = COIN_SHEET_ID;
	return ids;
}

describe("vale Silver art: the generated sheets", () => {
	it("the icon sheet holds only ui.icon.silver, the counter's box square, inside the sheet", () => {
		expect(sortedKeys(VALE_SILVER_ICONS)).toEqual([SILVER_ICON_ID]);
		const r = VALE_SILVER_ICONS[SILVER_ICON_ID].rect;
		expect([r.w, r.h]).toEqual([SILVER_COUNTER.iconPx, SILVER_COUNTER.iconPx]);
		expect(
			r.x >= 0 && r.y >= 0 && r.x + r.w <= VALE_SILVER_ICON_ATLAS.w && r.y + r.h <= VALE_SILVER_ICON_ATLAS.h,
		).toBe(true);
		expect(VALE_SILVER_ICON_FILE).never.toBe(VALE_SILVER_FX_SHEET.file);
	});

	it("the flying coin is a grey looping flipbook in its own sheet, tinted silver, solid, within the fx size cap", () => {
		const l = VALE_SILVER_FX_LAYOUTS[SILVER_COINS_FX_ID];
		expect([l.loop, l.grey, l.frames > 1, l.fps > 0]).toEqual([true, true, true, true]);
		expect(valeFxSourceOf(SILVER_COINS_FX_ID)?.sheet).toBe(VALE_SILVER_FX_SHEET);
		expect(VALE_FX_PENDING.includes(SILVER_COINS_FX_ID)).toBe(false);
		const look = VALE_FX[SILVER_COINS_FX_ID];
		expect([look.tint, look.additive]).toEqual([SILVER_ROLE, false]);
		expect(look.sizeTiles > 0 && look.sizeTiles <= FX_SPRITE_MAX_TILES).toBe(true);
	});
});

describe("vale Silver art: the manifest", () => {
	it("without the sheets' IDs neither is in the pack and the pack validates", () => {
		const m = buildValeManifest(idsWith(false, false));
		expect(m.assets[SILVER_ICON_ID]).toBe(undefined);
		expect(m.assets[SILVER_COINS_FX_ID]).toBe(undefined);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		expect(pack.fx(SILVER_COINS_FX_ID)).toBe(undefined);
	});

	it("with both the icon is an image of its sheet, the coin a tinted fx, and the pack validates", () => {
		const m = buildValeManifest(idsWith(true, true));
		const r = VALE_SILVER_ICON_SOURCE.icons[SILVER_ICON_ID].rect;
		expect(m.assets[SILVER_ICON_ID]).toEqual({
			kind: "image",
			assetId: ICON_SHEET_ID,
			w: VALE_SILVER_ICON_ATLAS.w,
			h: VALE_SILVER_ICON_ATLAS.h,
			rect: { x: r.x, y: r.y, w: r.w, h: r.h },
		});
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		const fx = pack.fx(SILVER_COINS_FX_ID);
		expect(fx !== undefined).toBe(true);
		if (fx !== undefined) {
			const l = VALE_SILVER_FX_LAYOUTS[SILVER_COINS_FX_ID];
			expect([fx.frames, fx.fps, fx.loop, fx.tint]).toEqual([l.frames, l.fps, true, SILVER_ROLE]);
			const f = fx.frame(1);
			expect([f.image, f.size.X, f.size.Y]).toEqual([COIN_SHEET_ID, l.frameW, l.frameH]);
		}
		expect(pack.contentIds(SILVER_ICON_ID)).toEqual([{ contentId: ICON_SHEET_ID, media: "image" }]);
	});

	it("each sheet switches on alone", () => {
		const iconOnly = buildValeManifest(idsWith(true, false));
		expect([iconOnly.assets[SILVER_ICON_ID] !== undefined, iconOnly.assets[SILVER_COINS_FX_ID]]).toEqual([
			true,
			undefined,
		]);
		const coinOnly = buildValeManifest(idsWith(false, true));
		expect([coinOnly.assets[SILVER_ICON_ID], coinOnly.assets[SILVER_COINS_FX_ID] !== undefined]).toEqual([
			undefined,
			true,
		]);
	});
});
