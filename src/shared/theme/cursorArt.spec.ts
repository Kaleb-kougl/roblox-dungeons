// The gauntlet cursor's theme side (docs/CURSOR.md C2): cursorArt per state (undefined for a placeholder, the hover
// state falling back to ui.cursor), and the validator's rules for the optional ui.cursor.hover (the generic ui pivot
// check plus cursorArtProblems' registration with ui.cursor).
import { describe, expect, it } from "@rbxts/jest-globals";
import { ThemeCore } from "./core";
import { CURSOR_IMAGE_IDS, CURSOR_STATES, cursorArt, cursorArtProblems, cursorOptionalIds } from "./cursorArt";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { deepClone, sortedEntries, type Obj } from "./util";
import { validateManifest } from "./validate";

const quiet = () => undefined;
const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const image = (assetId: string, extra?: Obj): Obj => ({
	kind: "image",
	assetId,
	w: 29,
	h: 29,
	pivot: { x: 4, y: 4 },
	...extra,
});

/** The placeholder manifest with `assets` overridden. */
function withAssets(assets: Record<string, Obj>): Obj {
	const m = clone();
	const target = m.assets as Obj;
	for (const [id, def] of sortedEntries(assets)) target[id] = def;
	return m;
}

describe("cursorArt", () => {
	it("is undefined for the placeholder pack: the system pointer", () => {
		expect(cursorArt(new ThemeCore(PLACEHOLDER_MANIFEST, { warn: quiet }))).toBe(undefined);
	});

	it("draws ui.cursor's image, pivot and size; the hover state falls back to it", () => {
		const art = cursorArt(new ThemeCore(withAssets({ "ui.cursor": image("rbxassetid://5101") }), { warn: quiet }));
		expect(art).toEqual({
			normal: {
				id: "ui.cursor",
				assetId: "rbxassetid://5101",
				size: { w: 29, h: 29 },
				pivot: { x: 4, y: 4 },
				rect: undefined,
			},
			hover: {
				id: "ui.cursor",
				assetId: "rbxassetid://5101",
				size: { w: 29, h: 29 },
				pivot: { x: 4, y: 4 },
				rect: undefined,
			},
		});
	});

	it("draws ui.cursor.hover in the hover state when the pack has it", () => {
		const art = cursorArt(
			new ThemeCore(
				withAssets({ "ui.cursor": image("rbxassetid://5101"), "ui.cursor.hover": image("rbxassetid://5102") }),
				{ warn: quiet },
			),
		)!;
		expect(art.hover.id).toBe(CURSOR_IMAGE_IDS.hover);
		expect(art.hover.assetId).toBe("rbxassetid://5102");
		expect(art.normal.assetId).toBe("rbxassetid://5101");
	});

	it("ignores a hover image while ui.cursor is a placeholder", () => {
		expect(
			cursorArt(new ThemeCore(withAssets({ "ui.cursor.hover": image("rbxassetid://5102") }), { warn: quiet })),
		).toBe(undefined);
	});

	it("sizes an atlas cut by its rect and defaults a missing pivot to the top-left corner", () => {
		const art = cursorArt(
			new ThemeCore(
				withAssets({
					"ui.cursor": {
						kind: "image",
						assetId: "rbxassetid://5103",
						w: 64,
						h: 32,
						rect: { x: 30, y: 2, w: 20, h: 22 },
					},
				}),
				{ warn: quiet },
			),
		)!;
		expect(art.normal.size).toEqual({ w: 20, h: 22 });
		expect(art.normal.rect).toEqual({ x: 30, y: 2, w: 20, h: 22 });
		expect(art.normal.pivot).toEqual({ x: 0, y: 0 });
	});

	it("lists the states and the optional ids", () => {
		expect([...CURSOR_STATES]).toEqual(["normal", "hover"]);
		expect([...cursorOptionalIds()]).toEqual(["ui.cursor.hover"]);
	});
});

describe("validateManifest: the hover cursor (docs/CURSOR.md C2)", () => {
	it("accepts no hover image, and a hover image registered with ui.cursor", () => {
		expect(validateManifest(withAssets({ "ui.cursor": image("rbxassetid://5101") }))).toEqual([]);
		expect(
			validateManifest(
				withAssets({ "ui.cursor": image("rbxassetid://5101"), "ui.cursor.hover": image("rbxassetid://5102") }),
			),
		).toEqual([]);
	});

	it("checks the hover image's pivot inside it like ui.cursor's", () => {
		expect(
			validateManifest(
				withAssets({
					"ui.cursor": image("rbxassetid://5101", { pivot: { x: 30, y: 4 } }),
					"ui.cursor.hover": image("rbxassetid://5102", { pivot: { x: 30, y: 4 } }),
				}),
			),
		).toEqual([
			'assets["ui.cursor"].pivot: (30, 4) is outside the 29x29 image',
			'assets["ui.cursor.hover"].pivot: (30, 4) is outside the 29x29 image',
		]);
	});

	it("needs ui.cursor as an image with the same size and pivot", () => {
		expect(validateManifest(withAssets({ "ui.cursor.hover": image("rbxassetid://5102") }))).toEqual([
			'assets["ui.cursor.hover"]: a hover cursor needs "ui.cursor" as an image too: without it the system pointer is shown and the hover art is never drawn',
		]);
		expect(
			validateManifest(
				withAssets({
					"ui.cursor": image("rbxassetid://5101"),
					"ui.cursor.hover": image("rbxassetid://5102", { w: 30, pivot: { x: 5, y: 4 } }),
				}),
			),
		).toEqual([
			`assets["ui.cursor.hover"]: the hover cursor is drawn 30x29 but "ui.cursor" 29x29: the two states must be the same size (art:build's sameCropAs)`,
			`assets["ui.cursor.hover"].pivot: the hover cursor's pivot (5, 4) differs from "ui.cursor"'s (4, 4): the click point would move between the states`,
		]);
	});

	it("reports nothing for a manifest without assets", () => {
		expect(cursorArtProblems(undefined)).toEqual([]);
		expect(cursorArtProblems({ assets: {} })).toEqual([]);
	});
});
