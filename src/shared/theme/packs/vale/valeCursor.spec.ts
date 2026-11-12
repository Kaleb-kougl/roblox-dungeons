// The vale pack's gauntlet cursor (docs/CURSOR.md C1 / C2): ui.cursor (ui-cursor.png) becomes an image with the
// generated fingertip pivot once its file has an ID, else stays the placeholder (the system pointer); ui.cursor.hover
// (ui-cursor-hover.png) is an image once uploaded, else absent; the facing pip, which borrows ui.cursor, keeps the
// placeholder diamond either way.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ACTOR_VIEW } from "shared/view";
import { cursorArt } from "../../cursorArt";
import { ThemePack } from "../../pack";
import type { ImageAsset } from "../../types";
import { validateManifest } from "../../validate";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_IMAGE_LAYOUTS } from "./layout";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";

const quiet = () => undefined;
const CURSOR_FILE = "ui-cursor.png";
const HOVER_FILE = "ui-cursor-hover.png";
const ids = (...files: Array<string>): Record<string, string> => {
	const out: Record<string, string> = {};
	files.forEach((f, i) => {
		out[f] = `rbxassetid://${5200 + i}`;
	});
	return out;
};

describe("vale gauntlet cursor", () => {
	it("generates both layouts with the fingertip pivot inside the image, the same for both states", () => {
		const n = VALE_IMAGE_LAYOUTS["ui.cursor"];
		const h = VALE_IMAGE_LAYOUTS["ui.cursor.hover"];
		expect([n.file, h.file]).toEqual([CURSOR_FILE, HOVER_FILE]);
		expect(n.pivot).toEqual({ x: 4, y: 4 });
		expect([h.w, h.h, h.pivot]).toEqual([n.w, n.h, n.pivot]);
		const p = n.pivot!;
		expect(p.x >= 0 && p.x <= n.w && p.y >= 0 && p.y <= n.h).toBe(true);
	});

	it("without IDs: ui.cursor is the placeholder, ui.cursor.hover absent, no cursor art", () => {
		const m = buildValeManifest({});
		expect(m.assets["ui.cursor"]).toEqual({ kind: "placeholder" });
		expect(m.assets["ui.cursor.hover"]).toBe(undefined);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		expect(cursorArt(new ThemePack(m, { warn: quiet }))).toBe(undefined);
	});

	it("with ui-cursor.png's ID: ui.cursor is an image with the layout's pivot; the hover state falls back to it", () => {
		const m = buildValeManifest(ids(CURSOR_FILE));
		const layout = VALE_IMAGE_LAYOUTS["ui.cursor"];
		expect(m.assets["ui.cursor"]).toEqual({
			kind: "image",
			assetId: "rbxassetid://5200",
			w: layout.w,
			h: layout.h,
			pivot: { x: 4, y: 4 },
		} as ImageAsset);
		expect(m.assets["ui.cursor.hover"]).toBe(undefined);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const art = cursorArt(new ThemePack(m, { warn: quiet }))!;
		expect(art.normal.assetId).toBe("rbxassetid://5200");
		expect(art.normal.pivot).toEqual({ x: 4, y: 4 });
		expect(art.normal.size).toEqual({ w: layout.w, h: layout.h });
		expect(art.hover).toEqual(art.normal);
	});

	it("with both IDs: the hover state draws ui-cursor-hover.png at the same pivot", () => {
		const m = buildValeManifest(ids(CURSOR_FILE, HOVER_FILE));
		const hover = m.assets["ui.cursor.hover"] as ImageAsset | undefined;
		expect(hover !== undefined ? hover.kind : undefined).toBe("image");
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const art = cursorArt(new ThemePack(m, { warn: quiet }))!;
		expect(art.hover.id).toBe("ui.cursor.hover");
		expect(art.hover.assetId).toBe("rbxassetid://5201");
		expect(art.hover.pivot).toEqual(art.normal.pivot);
		expect(art.hover.size).toEqual(art.normal.size);
	});

	it("keeps the facing pip the placeholder diamond when ui.cursor is an image", () => {
		const art = new ThemePack(buildValeManifest(ids(CURSOR_FILE, HOVER_FILE)), { warn: quiet });
		const plain = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(art.image(ACTOR_VIEW.facingPipVisualId)).never.toBe(undefined);
		expect(art.placeholder(ACTOR_VIEW.facingPipVisualId)).toEqual(plain.placeholder(ACTOR_VIEW.facingPipVisualId));
		expect(art.placeholder(ACTOR_VIEW.facingPipVisualId).shape).toBe(
			plain.placeholder(ACTOR_VIEW.facingPipVisualId).shape,
		);
	});

	it("as bundled: each state is art exactly when its file has an ID", () => {
		const cursor = VALE_MANIFEST.assets["ui.cursor"];
		expect(cursor.kind).toBe(VALE_ASSET_IDS[CURSOR_FILE] !== undefined ? "image" : "placeholder");
		const hover = VALE_MANIFEST.assets["ui.cursor.hover"] as ImageAsset | undefined;
		expect(hover !== undefined ? hover.kind : undefined).toBe(
			VALE_ASSET_IDS[HOVER_FILE] !== undefined ? "image" : undefined,
		);
	});
});
