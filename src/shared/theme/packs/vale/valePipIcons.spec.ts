// The vale pack's armor pips (docs/UI_ART.md "As built: armor pips"): the generated sheet (pipIconLayout.ts,
// scripts/art/gen-pip-icons.js via art/atlases.json `pipIcons`) holds the three 16 x 15 pips under shared/theme
// PIP_ICON_IDS; every one switches on with the sheet's one ID (all or nothing, like the boon / item / boost icon
// sheets), validates, is one core-tier content id, and once in the pack the HUD's pipArt picks it over the chips.
import { describe, expect, it } from "@rbxts/jest-globals";
import { preloadPlan } from "shared/view";
import { HUD_SKIN, pipArt, skinHasOf } from "shared/view/hud";
import { ThemePack } from "../../pack";
import { PIP_ICON_IDS, PIP_ICON_PREFIX } from "../../pipIcons";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_PIP_ICONS, VALE_PIP_ICON_ATLAS, VALE_PIP_ICON_FILE } from "./pipIconLayout";
import { VALE_PIP_ICON_SOURCE, buildValeManifest } from "./manifest";

const quiet = () => undefined;
const SHEET_ID = "rbxassetid://7303";
const PIP_W = 16;
const PIP_H = 15;

/** The uploaded IDs without the pip sheet's, plus it when `sheet`. */
function idsWith(sheet: boolean): Record<string, string> {
	const ids: Record<string, string> = {};
	for (const file of sortedKeys(VALE_ASSET_IDS)) if (file !== VALE_PIP_ICON_FILE) ids[file] = VALE_ASSET_IDS[file];
	if (sheet) ids[VALE_PIP_ICON_FILE] = SHEET_ID;
	return ids;
}

function pipIds(): string[] {
	const out = [PIP_ICON_IDS.armor, PIP_ICON_IDS.armorEmpty, PIP_ICON_IDS.aegis] as string[];
	out.sort();
	return out;
}

describe("vale armor pips: the generated sheet", () => {
	it("has exactly the three pips, every one under the pip prefix", () => {
		expect(sortedKeys(VALE_PIP_ICONS)).toEqual(pipIds());
		for (const id of pipIds()) expect(id.sub(1, PIP_ICON_PREFIX.size())).toBe(PIP_ICON_PREFIX);
	});

	it("every pip is 16 x 15 (the hearts' height), inside the sheet, no two overlapping", () => {
		const ids = sortedKeys(VALE_PIP_ICONS);
		for (const id of ids) {
			const r = VALE_PIP_ICONS[id].rect;
			expect([id, r.w, r.h]).toEqual([id, PIP_W, PIP_H]);
			const inside =
				r.x >= 0 && r.y >= 0 && r.x + r.w <= VALE_PIP_ICON_ATLAS.w && r.y + r.h <= VALE_PIP_ICON_ATLAS.h;
			expect([id, inside]).toEqual([id, true]);
		}
		for (let i = 0; i < ids.size(); i++) {
			for (let j = i + 1; j < ids.size(); j++) {
				const a = VALE_PIP_ICONS[ids[i]].rect;
				const b = VALE_PIP_ICONS[ids[j]].rect;
				const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
				expect([ids[i], ids[j], overlap]).toEqual([ids[i], ids[j], false]);
			}
		}
	});
});

describe("vale armor pips: the manifest", () => {
	it("without the sheet's ID no pip is in the pack, and the armor row keeps the chips", () => {
		const m = buildValeManifest(idsWith(false));
		for (const id of pipIds()) expect([id, m.assets[id]]).toEqual([id, undefined]);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const has = skinHasOf(new ThemePack(m, { warn: quiet }));
		expect(pipArt(has, "armor", true)?.id).never.toBe(PIP_ICON_IDS.armor);
		expect(pipArt(has, "aegis", true)?.id).never.toBe(PIP_ICON_IDS.aegis);
	});

	it("with it every pip is an image of the sheet with its rect, the pack validates and the HUD draws them", () => {
		const m = buildValeManifest(idsWith(true));
		for (const id of pipIds()) {
			const r = VALE_PIP_ICON_SOURCE.icons[id].rect;
			expect([id, m.assets[id]]).toEqual([
				id,
				{
					kind: "image",
					assetId: SHEET_ID,
					w: VALE_PIP_ICON_ATLAS.w,
					h: VALE_PIP_ICON_ATLAS.h,
					rect: { x: r.x, y: r.y, w: r.w, h: r.h },
				},
			]);
		}
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const has = skinHasOf(new ThemePack(m, { warn: quiet }));
		expect(pipArt(has, "armor", true)?.id).toBe(PIP_ICON_IDS.armor);
		expect(pipArt(has, "armor", false)?.id).toBe(PIP_ICON_IDS.armorEmpty);
		expect(pipArt(has, "aegis", true)).toEqual({
			id: PIP_ICON_IDS.aegis,
			transparency: 0,
			tinted: false,
			box: HUD_SKIN.shieldPipBox,
		});
	});

	it("the sheet is one content id for every pip, in the core preload tier, and none before its upload", () => {
		const pack = new ThemePack(buildValeManifest(idsWith(true)), { warn: quiet });
		for (const id of pipIds()) {
			expect([id, pack.contentIds(id)]).toEqual([id, [{ contentId: SHEET_ID, media: "image" }]]);
		}
		const plan = preloadPlan(pack);
		expect(plan.core.filter((r) => (r.contentId as string) === SHEET_ID).size()).toBe(1);
		expect(plan.later.filter((r) => (r.contentId as string) === SHEET_ID).size()).toBe(0);
		const before = new ThemePack(buildValeManifest(idsWith(false)), { warn: quiet });
		for (const id of pipIds()) expect([id, before.contentIds(id).size()]).toEqual([id, 0]);
	});
});
