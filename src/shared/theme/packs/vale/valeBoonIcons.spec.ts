// The vale pack's boon icons (docs/BUILDS.md BU11): the generated sheet (boonIconLayout.ts, scripts/art/gen-boon-icons.js
// via art/atlases.json `boonIcons`) holds one 16 x 16 icon per boon under shared/theme boonIconId; every one switches on
// with the sheet's one ID (all or nothing, like the UI icon atlas), validates, and is one core-tier content id.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOONS } from "shared/sim";
import { preloadPlan } from "shared/view";
import { BOON_ICON_PREFIX, boonIconId } from "../../boonIcons";
import { ThemePack } from "../../pack";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_BOON_ICONS, VALE_BOON_ICON_ATLAS, VALE_BOON_ICON_FILE } from "./boonIconLayout";
import { VALE_BOON_ICON_SOURCE, buildValeManifest } from "./manifest";

const quiet = () => undefined;
const SHEET_ID = "rbxassetid://7300";
const ICON_PX = 16;

/** The uploaded IDs without the boon sheet's, plus it when `sheet`. */
function idsWith(sheet: boolean): Record<string, string> {
	const ids: Record<string, string> = {};
	for (const file of sortedKeys(VALE_ASSET_IDS)) if (file !== VALE_BOON_ICON_FILE) ids[file] = VALE_ASSET_IDS[file];
	if (sheet) ids[VALE_BOON_ICON_FILE] = SHEET_ID;
	return ids;
}

function boonIconIds(): string[] {
	return BOONS.map((b) => boonIconId(b.id) as string);
}

describe("boonIconId", () => {
	it("maps a boon id under the ui prefix, and nothing else", () => {
		expect(boonIconId("boon.sharpened")).toBe("ui.boon.sharpened");
		expect(boonIconId("boon.swiftStrikes")).toBe("ui.boon.swiftstrikes");
		expect(boonIconId("relic.hourglass")).toBe(undefined);
		expect(boonIconId("boon.")).toBe(undefined);
		expect(boonIconId("")).toBe(undefined);
		expect(BOON_ICON_PREFIX.sub(1, 3)).toBe("ui.");
	});
});

describe("vale boon icons: the generated sheet", () => {
	it("has exactly one icon per boon", () => {
		const want = boonIconIds();
		want.sort();
		expect(sortedKeys(VALE_BOON_ICONS)).toEqual(want);
	});

	it("every icon is 16 x 16, inside the sheet, no two overlapping", () => {
		const ids = sortedKeys(VALE_BOON_ICONS);
		for (const id of ids) {
			const r = VALE_BOON_ICONS[id].rect;
			expect([id, r.w, r.h]).toEqual([id, ICON_PX, ICON_PX]);
			const inside =
				r.x >= 0 && r.y >= 0 && r.x + r.w <= VALE_BOON_ICON_ATLAS.w && r.y + r.h <= VALE_BOON_ICON_ATLAS.h;
			expect([id, inside]).toEqual([id, true]);
		}
		for (let i = 0; i < ids.size(); i++) {
			for (let j = i + 1; j < ids.size(); j++) {
				const a = VALE_BOON_ICONS[ids[i]].rect;
				const b = VALE_BOON_ICONS[ids[j]].rect;
				const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
				expect([ids[i], ids[j], overlap]).toEqual([ids[i], ids[j], false]);
			}
		}
	});
});

describe("vale boon icons: the manifest", () => {
	it("without the sheet's ID no boon icon is in the pack", () => {
		const m = buildValeManifest(idsWith(false));
		for (const id of boonIconIds()) expect([id, m.assets[id]]).toEqual([id, undefined]);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
	});

	it("with it every boon icon is an image of the sheet with its rect, and the pack validates", () => {
		const m = buildValeManifest(idsWith(true));
		for (const id of boonIconIds()) {
			const r = VALE_BOON_ICON_SOURCE.icons[id].rect;
			expect([id, m.assets[id]]).toEqual([
				id,
				{
					kind: "image",
					assetId: SHEET_ID,
					w: VALE_BOON_ICON_ATLAS.w,
					h: VALE_BOON_ICON_ATLAS.h,
					rect: { x: r.x, y: r.y, w: r.w, h: r.h },
				},
			]);
		}
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
	});

	it("the sheet is one content id for every icon, in the core preload tier, and none before its upload", () => {
		const pack = new ThemePack(buildValeManifest(idsWith(true)), { warn: quiet });
		for (const id of boonIconIds()) {
			expect([id, pack.contentIds(id)]).toEqual([id, [{ contentId: SHEET_ID, media: "image" }]]);
		}
		const plan = preloadPlan(pack);
		expect(plan.core.filter((r) => (r.contentId as string) === SHEET_ID).size()).toBe(1);
		expect(plan.later.filter((r) => (r.contentId as string) === SHEET_ID).size()).toBe(0);
		const before = new ThemePack(buildValeManifest(idsWith(false)), { warn: quiet });
		for (const id of boonIconIds()) expect([id, before.contentIds(id).size()]).toEqual([id, 0]);
	});
});
