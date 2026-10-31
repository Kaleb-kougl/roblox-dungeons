// Roblox port (docs/UI_ART.md UA4): the UI skin's optional ui ids (uiSkinIds: 9-sliced pieces; uiIconIds: the icon
// atlas) and the ui image `rect` (an atlas cut: types, validator, ThemePack.image).
import { describe, expect, it } from "@rbxts/jest-globals";
import { REQUIRED_ASSET_IDS, UI, draftSkinIds, slotFor, uiIconIds, uiSkinIds } from "./contract";
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
/** A piece of a 64 x 32 icon atlas. */
const icon = (rect: unknown, extra: Obj = {}): Obj => ({
	kind: "image",
	assetId: "rbxassetid://4020",
	w: 64,
	h: 32,
	rect,
	...extra,
});

describe("ui skin: ids", () => {
	it("are optional ui images: none required, none in the placeholder pack, a fresh list every call", () => {
		const assets = PLACEHOLDER_MANIFEST.assets as unknown as Obj;
		for (const id of [...uiSkinIds(), ...uiIconIds()]) {
			expect([id, slotFor(id) === UI, REQUIRED_ASSET_IDS.includes(id), assets[id]]).toEqual([
				id,
				true,
				false,
				undefined,
			]);
		}
		expect(uiSkinIds()).never.toBe(uiSkinIds());
		expect(uiIconIds()).never.toBe(uiIconIds());
		expect(uiSkinIds().size()).toBe(12);
		expect(uiIconIds().size()).toBe(27);
	});

	it("have no duplicates and overlap neither each other nor the draft skin", () => {
		const seen = new Map<string, string>();
		const lists: Array<[string, ReadonlyArray<string>]> = [
			["uiSkinIds", uiSkinIds()],
			["uiIconIds", uiIconIds()],
			["draftSkinIds", draftSkinIds()],
		];
		for (const [name, ids] of lists) {
			for (const id of ids) {
				expect([id, seen.get(id)]).toEqual([id, undefined]);
				seen.set(id, name);
			}
		}
	});

	it("every bundled pack still validates (none of them needs the optional ids)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			expect([id, validateManifest(THEME_PACKS[id], { packId: id })]).toEqual([id, []]);
		}
	});
});

describe("validateManifest: ui image rect", () => {
	it("accepts a rect inside the image, and a pivot inside the rect", () => {
		expect(withAsset("ui.heart.full", icon({ x: 0, y: 0, w: 18, h: 15 }))).toEqual([]);
		expect(withAsset("ui.heart.full", icon({ x: 46, y: 17, w: 18, h: 15 }))).toEqual([]);
		expect(withAsset("ui.heart.full", icon({ x: 0, y: 0, w: 64, h: 32 }))).toEqual([]);
		expect(withAsset("ui.caret", icon({ x: 20, y: 4, w: 8, h: 12 }, { pivot: { x: 8, y: 6 } }))).toEqual([]);
		// a required ui id may be an atlas cut too
		expect(withAsset("ui.icon.health", icon({ x: 20, y: 4, w: 18, h: 15 }))).toEqual([]);
	});

	it("rejects a rect reaching outside the image", () => {
		expect(withAsset("ui.heart.full", icon({ x: 47, y: 0, w: 18, h: 15 }))).toEqual([
			'assets["ui.heart.full"].rect: (47, 0) 18x15 reaches outside the 64x32 image',
		]);
		expect(withAsset("ui.heart.full", icon({ x: 0, y: 18, w: 18, h: 15 }))).toEqual([
			'assets["ui.heart.full"].rect: (0, 18) 18x15 reaches outside the 64x32 image',
		]);
	});

	it("rejects a malformed rect and unknown keys", () => {
		const shape =
			'assets["ui.chip"].rect: must be { "x": int >= 0, "y": int >= 0, "w": int >= 1, "h": int >= 1 } in pixels of the image';
		expect(withAsset("ui.chip", icon({ x: -1, y: 0, w: 10, h: 10 }))).toEqual([shape]);
		expect(withAsset("ui.chip", icon({ x: 0, y: 0, w: 0, h: 10 }))).toEqual([shape]);
		expect(withAsset("ui.chip", icon({ x: 0.5, y: 0, w: 10, h: 10 }))).toEqual([shape]);
		expect(withAsset("ui.chip", icon([0, 0, 10, 10]))).toEqual([shape]);
		expect(withAsset("ui.chip", icon({ x: 0, y: 0, w: 10, h: 10, z: 1 }))).toEqual([
			'assets["ui.chip"].rect.z: unknown key (allowed: x, y, w, h)',
		]);
	});

	it("checks the pivot against the rect, not the whole image", () => {
		expect(withAsset("ui.caret", icon({ x: 20, y: 4, w: 8, h: 12 }, { pivot: { x: 9, y: 6 } }))).toEqual([
			'assets["ui.caret"].pivot: (9, 6) is outside the 8x12 rect',
		]);
		expect(withAsset("ui.caret", icon({ x: 20, y: 4, w: 8, h: 12 }, { pivot: { x: 4 } }))).toEqual([
			'assets["ui.caret"].pivot: must be { "x": number, "y": number } in pixels from the rect top-left',
		]);
	});

	it("a sliced image takes no rect", () => {
		expect(
			withAsset(
				"ui.button",
				icon({ x: 0, y: 0, w: 30, h: 14 }, { slice: { left: 4, top: 4, right: 4, bottom: 4 } }),
			),
		).toEqual(['assets["ui.button"].rect: a sliced image is drawn whole: give it no rect']);
	});

	it("is ui.* only among the non-world slots (other slots keep their keys)", () => {
		expect(
			withAsset("item.gold", {
				kind: "image",
				assetId: "rbxassetid://4002",
				w: 16,
				h: 16,
				rect: { x: 0, y: 0, w: 8, h: 8 },
			}),
		).toEqual([
			'assets["item.gold"].rect: unknown key (allowed: kind, assetId, w, h, tilesPerImage, pivot, slice)',
		]);
	});
});

describe("ThemePack.image: rect", () => {
	it("carries the rect (a copy), undefined for an image drawn whole", () => {
		const m = clone();
		const rect = { x: 46, y: 17, w: 18, h: 15 };
		(m.assets as Obj)["ui.heart.full"] = icon(rect, { pivot: { x: 9, y: 7.5 } });
		(m.assets as Obj)["ui.panel.hud"] = {
			kind: "image",
			assetId: "rbxassetid://4021",
			w: 91,
			h: 46,
			slice: { left: 8, top: 8, right: 8, bottom: 8 },
		};
		const pack = new ThemePack(m as unknown as ThemeManifest, { warn: quiet });
		const heart = pack.image("ui.heart.full")!;
		expect(heart).toEqual({
			assetId: "rbxassetid://4020",
			w: 64,
			h: 32,
			tilesPerImage: undefined,
			pivot: { x: 9, y: 7.5 },
			slice: undefined,
			rect,
		});
		expect(heart.rect).never.toBe(rect);
		expect(pack.image("ui.panel.hud")!.rect).toBe(undefined);
		expect(pack.image("ui.heart.half")).toBe(undefined);
		const placeholder = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		for (const id of [...uiSkinIds(), ...uiIconIds()]) {
			expect([id, placeholder.image(id)]).toEqual([id, undefined]);
		}
	});
});
