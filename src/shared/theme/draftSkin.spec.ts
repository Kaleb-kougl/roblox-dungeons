// Roblox port (docs/DRAFT_REVEAL.md DR3, DRD12): the boon draft's optional card art ids and the ui image `slice`
// (9-slice insets: types, validator, ThemePack.image).
import { describe, expect, it } from "@rbxts/jest-globals";
import { REQUIRED_ASSET_IDS, UI, draftSkinIds, slotFor } from "./contract";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import type { ThemeManifest } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";

const quiet = () => undefined;
const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const withAsset = (id: string, def: Obj) => {
	const m = clone();
	(m.assets as Obj)[id] = def;
	return validateManifest(m);
};
const panel = (slice: unknown, w = 93, h = 45): Obj => ({ kind: "image", assetId: "rbxassetid://4010", w, h, slice });

describe("draft skin: ids", () => {
	it("are six optional ui images, none required, none in the placeholder pack", () => {
		expect([...draftSkinIds()]).toEqual([
			"ui.draft.back",
			"ui.draft.back.eyes",
			"ui.draft.card.common",
			"ui.draft.card.rare",
			"ui.draft.skull.left",
			"ui.draft.skull.right",
		]);
		const assets = PLACEHOLDER_MANIFEST.assets as unknown as Obj;
		for (const id of draftSkinIds()) {
			expect([id, slotFor(id) === UI, REQUIRED_ASSET_IDS.includes(id), assets[id]]).toEqual([
				id,
				true,
				false,
				undefined,
			]);
		}
		// a fresh list every call (the caller may not mutate the contract's)
		expect(draftSkinIds()).never.toBe(draftSkinIds());
	});

	it("a pack may give any subset of them (each one is independent)", () => {
		const m = clone();
		(m.assets as Obj)["ui.draft.card.rare"] = panel({ left: 43, top: 30, right: 43, bottom: 30 }, 87, 61);
		(m.assets as Obj)["ui.draft.skull.left"] = {
			kind: "image",
			assetId: "rbxassetid://4011",
			w: 17,
			h: 18,
			pivot: { x: 3, y: 5 },
		};
		expect(validateManifest(m)).toEqual([]);
		for (const id of sortedKeys(THEME_PACKS)) {
			expect([id, validateManifest(THEME_PACKS[id], { packId: id })]).toEqual([id, []]);
		}
	});
});

describe("validateManifest: ui image slice", () => {
	it("accepts insets inside the image with a centre of at least 1 x 1 pixel", () => {
		expect(withAsset("ui.draft.back", panel({ left: 46, top: 20, right: 46, bottom: 24 }))).toEqual([]);
		expect(withAsset("ui.draft.back", panel({ left: 0, top: 0, right: 0, bottom: 0 }))).toEqual([]);
		expect(withAsset("ui.panel", panel({ left: 6, top: 6, right: 6, bottom: 6 }, 90, 44))).toEqual([]);
	});

	it("rejects insets that leave no centre", () => {
		expect(withAsset("ui.draft.back", panel({ left: 47, top: 20, right: 46, bottom: 24 }))).toEqual([
			'assets["ui.draft.back"].slice: insets 47 20 46 24 leave no centre in the 93x45 image (left + right < w, top + bottom < h)',
		]);
		expect(withAsset("ui.draft.back", panel({ left: 1, top: 22, right: 1, bottom: 23 }))).toEqual([
			'assets["ui.draft.back"].slice: insets 1 22 1 23 leave no centre in the 93x45 image (left + right < w, top + bottom < h)',
		]);
	});

	it("rejects malformed insets and unknown keys", () => {
		expect(withAsset("ui.draft.back", panel({ left: -1, top: 2.5, right: 1, bottom: 1 }))).toEqual([
			'assets["ui.draft.back"].slice.left: must be an integer >= 0 (art pixels)',
			'assets["ui.draft.back"].slice.top: must be an integer >= 0 (art pixels)',
		]);
		expect(withAsset("ui.draft.back", panel({ left: 1, top: 1, right: 1 }))).toEqual([
			'assets["ui.draft.back"].slice.bottom: must be an integer >= 0 (art pixels)',
		]);
		expect(withAsset("ui.draft.back", panel({ left: 1, top: 1, right: 1, bottom: 1, centre: 1 }))).toEqual([
			'assets["ui.draft.back"].slice.centre: unknown key (allowed: left, top, right, bottom)',
		]);
		expect(withAsset("ui.draft.back", panel([1, 1, 1, 1]))).toEqual([
			'assets["ui.draft.back"].slice: must be { "left": int, "top": int, "right": int, "bottom": int } in art pixels',
		]);
	});

	it("is ui.* only", () => {
		expect(
			withAsset("item.gold", {
				kind: "image",
				assetId: "rbxassetid://4002",
				w: 16,
				h: 16,
				slice: { left: 1, top: 1, right: 1, bottom: 1 },
			}),
		).toEqual(['assets["item.gold"].slice: only ui.* images are 9-sliced']);
	});
});

describe("ThemePack.image: slice", () => {
	it("carries the insets (a copy), undefined for an unsliced image", () => {
		const m = clone();
		const insets = { left: 43, top: 30, right: 43, bottom: 30 };
		(m.assets as Obj)["ui.draft.card.rare"] = panel(insets, 87, 61);
		const pack = new ThemePack(m as unknown as ThemeManifest, { warn: quiet });
		const image = pack.image("ui.draft.card.rare");
		expect(image).toEqual({
			assetId: "rbxassetid://4010",
			w: 87,
			h: 61,
			tilesPerImage: undefined,
			pivot: undefined,
			slice: insets,
		});
		expect(image!.slice).never.toBe(insets);
		expect(pack.image("ui.draft.back")).toBe(undefined);
		expect(new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet }).image("ui.draft.card.common")).toBe(undefined);
	});
});
