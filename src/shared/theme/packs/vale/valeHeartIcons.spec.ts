// The vale pack's half-heart containers (docs/SILVER.md SV16, OC18): the generated sheet (heartIconLayout.ts,
// scripts/art/gen-heart-halfmax.js via art/atlases.json `heartIcons`) holds the two 18 x 15 containers under shared/theme
// HEART_ICON_IDS; both switch on with the sheet's one ID (all or nothing, like the armor pips), validate, are one
// content id, and once in the pack the HUD's heartArt picks them over the cut whole heart. Uploaded 2026-11-14: the bundled
// pack draws both.
import { describe, expect, it } from "@rbxts/jest-globals";
import { HEART_FILL, heartArt, skinHasOf } from "shared/view/hud";
import { HEART_ICON_IDS, HEART_ICON_PREFIX } from "../../heartIcons";
import { ThemePack } from "../../pack";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_HEART_ICONS, VALE_HEART_ICON_ATLAS, VALE_HEART_ICON_FILE } from "./heartIconLayout";
import { VALE_HEART_ICON_SOURCE, buildValeManifest } from "./manifest";

const quiet = () => undefined;
const SHEET_ID = "rbxassetid://7304";
const HEART_W = 18;
const HEART_H = 15;

/** The uploaded IDs without the heart sheet's, plus it when `sheet`. */
function idsWith(sheet: boolean): Record<string, string> {
	const ids: Record<string, string> = {};
	for (const file of sortedKeys(VALE_ASSET_IDS)) if (file !== VALE_HEART_ICON_FILE) ids[file] = VALE_ASSET_IDS[file];
	if (sheet) ids[VALE_HEART_ICON_FILE] = SHEET_ID;
	return ids;
}

function heartIds(): string[] {
	const out = [HEART_ICON_IDS.halfmax, HEART_ICON_IDS.halfmaxEmpty] as string[];
	out.sort();
	return out;
}

describe("vale half-heart containers: the generated sheet", () => {
	it("has exactly the two containers, under the prefix, 18 x 15 (the hearts' size), inside the sheet, apart", () => {
		expect(sortedKeys(VALE_HEART_ICONS)).toEqual(heartIds());
		for (const id of heartIds()) {
			expect(id.sub(1, HEART_ICON_PREFIX.size())).toBe(HEART_ICON_PREFIX);
			const r = VALE_HEART_ICONS[id].rect;
			expect([id, r.w, r.h]).toEqual([id, HEART_W, HEART_H]);
			const inside =
				r.x >= 0 && r.y >= 0 && r.x + r.w <= VALE_HEART_ICON_ATLAS.w && r.y + r.h <= VALE_HEART_ICON_ATLAS.h;
			expect([id, inside]).toEqual([id, true]);
		}
		const [a, b] = heartIds().map((id) => VALE_HEART_ICONS[id].rect);
		expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
	});

	it("is uploaded: the bundled pack has both containers on the sheet's one ID", () => {
		const id = VALE_ASSET_IDS[VALE_HEART_ICON_FILE];
		expect(id).toBe("rbxassetid://133175128335720");
		const m = buildValeManifest(VALE_ASSET_IDS);
		for (const h of heartIds()) {
			const a = m.assets[h];
			expect([h, a !== undefined && a.kind === "image" ? a.assetId : undefined]).toEqual([h, id]);
		}
	});
});

describe("vale half-heart containers: the manifest", () => {
	it("without the sheet's ID neither container is in the pack, and the HUD cuts the whole heart", () => {
		const m = buildValeManifest(idsWith(false));
		for (const id of heartIds()) expect([id, m.assets[id]]).toEqual([id, undefined]);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const art = heartArt(skinHasOf(new ThemePack(m, { warn: quiet })), HEART_FILL.HALF_MAX_FULL);
		if (art !== undefined) expect(art.leftHalf).toBe(true);
	});

	it("with it both are images of the sheet with their rects, the pack validates and the HUD draws them", () => {
		const m = buildValeManifest(idsWith(true));
		for (const id of heartIds()) {
			const r = VALE_HEART_ICON_SOURCE.icons[id].rect;
			expect([id, m.assets[id]]).toEqual([
				id,
				{
					kind: "image",
					assetId: SHEET_ID,
					w: VALE_HEART_ICON_ATLAS.w,
					h: VALE_HEART_ICON_ATLAS.h,
					rect: { x: r.x, y: r.y, w: r.w, h: r.h },
				},
			]);
		}
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		const has = skinHasOf(pack);
		if (has("ui.heart.full")) {
			expect(heartArt(has, HEART_FILL.HALF_MAX_FULL)).toEqual({ id: HEART_ICON_IDS.halfmax, leftHalf: false });
			expect(heartArt(has, HEART_FILL.HALF_MAX_EMPTY)).toEqual({
				id: HEART_ICON_IDS.halfmaxEmpty,
				leftHalf: false,
			});
		}
		for (const id of heartIds()) {
			expect([id, pack.contentIds(id)]).toEqual([id, [{ contentId: SHEET_ID, media: "image" }]]);
		}
	});
});
