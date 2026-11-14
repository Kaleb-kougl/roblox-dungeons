// The vale pack's Robux icon (docs/SILVER_SHOP.md "Robux icon"): ui.icon.robux (ui-robux.png, Roblox's own icon made a
// 14 x 14 white glyph by scripts/art/roblox/prep_robux_icon.py) is an image once its file has an ID, else absent, so the
// Get Silver prices read `55 Robux` until then.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ThemePack } from "../../pack";
import { ROBUX_ICON_ID } from "../../silverShop";
import type { ImageAsset } from "../../types";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_IMAGE_LAYOUTS } from "./layout";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";

const quiet = () => undefined;
const FILE = "ui-robux.png";

describe("vale Robux icon", () => {
	it("generates a 14 x 14 layout for ui-robux.png", () => {
		const l = VALE_IMAGE_LAYOUTS[ROBUX_ICON_ID];
		expect([l.file, l.w, l.h]).toEqual([FILE, 14, 14]);
		expect(l.pivot).toBe(undefined);
		expect(l.slice).toBe(undefined);
	});

	it("without its ID the icon is absent (not a placeholder) and the manifest validates", () => {
		const m = buildValeManifest({});
		expect(m.assets[ROBUX_ICON_ID]).toBe(undefined);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		expect(new ThemePack(m, { warn: quiet }).has(ROBUX_ICON_ID)).toBe(false);
	});

	it("with ui-robux.png's ID it is a plain image the pack serves", () => {
		const m = buildValeManifest({ [FILE]: "rbxassetid://5300" });
		expect(m.assets[ROBUX_ICON_ID]).toEqual({
			kind: "image",
			assetId: "rbxassetid://5300",
			w: 14,
			h: 14,
		} as ImageAsset);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
	});

	it("as bundled: drawn exactly when ui-robux.png has been uploaded", () => {
		const uploaded = VALE_ASSET_IDS[FILE] !== undefined;
		expect(VALE_MANIFEST.assets[ROBUX_ICON_ID] !== undefined).toBe(uploaded);
	});
});
