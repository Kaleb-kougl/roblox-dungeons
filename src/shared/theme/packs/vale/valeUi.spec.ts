// The vale pack's UI skin wiring (docs/UI_ART.md UA4): the 9-sliced pieces (uiSkinIds, VALE_IMAGE_LAYOUTS) switch on
// one by one as their files get IDs; the icon atlas (uiIconIds, uiIconLayout.ts) all or nothing; the required ui ids
// take their art; contentIds / the preload plan pick it up. The generated layouts may not hold these pieces yet, so the
// specs feed synthetic layouts through buildValeManifest's `sources` and valeUiIconImages.
import { describe, expect, it } from "@rbxts/jest-globals";
import { preloadPlan } from "shared/view";
import { draftSkinIds, uiIconIds, uiSkinIds } from "../../contract";
import { ThemePack } from "../../pack";
import type { ImageAsset } from "../../types";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_IMAGE_LAYOUTS, type ValeImageLayout } from "./layout";
import {
	VALE_MANIFEST,
	VALE_UI_ICON_SOURCE,
	VALE_UI_REQUIRED_ART,
	buildValeManifest,
	valeUiIconImages,
	type ValeUiIconSource,
} from "./manifest";
import { VALE_UI_ICONS, VALE_UI_ICON_ATLAS, VALE_UI_ICON_FILE, type ValeUiIconLayout } from "./uiIconLayout";

const quiet = () => undefined;
const ATLAS_FILE = "ui-icons-test.png";
const ATLAS_ID = "rbxassetid://7100";
const ICON_PITCH = 20;

/** The generated image layouts plus a synthetic sliced PNG per uiSkinIds id. */
function slicedLayouts(): Record<string, ValeImageLayout> {
	const out: Record<string, ValeImageLayout> = {};
	for (const id of sortedKeys(VALE_IMAGE_LAYOUTS)) out[id] = VALE_IMAGE_LAYOUTS[id];
	uiSkinIds().forEach((id, i) => {
		out[id] = { file: `ui-skin-${i}.png`, w: 40 + i, h: 30, slice: { left: 6, top: 5, right: 7, bottom: 8 } };
	});
	return out;
}
const fileOf = (id: string) => slicedLayouts()[id].file;

/** A synthetic icon atlas: every uiIconIds piece 18 x 15 on a 20 px row, every third with a pivot. */
function iconSource(): ValeUiIconSource {
	const icons: Record<string, ValeUiIconLayout> = {};
	uiIconIds().forEach((id, i) => {
		const piece: ValeUiIconLayout =
			i % 3 === 0
				? { rect: { x: i * ICON_PITCH, y: 1, w: 18, h: 15 }, pivot: { x: 9, y: 15 } }
				: { rect: { x: i * ICON_PITCH, y: 1, w: 18, h: 15 } };
		icons[id] = piece;
	});
	return { file: ATLAS_FILE, atlas: { w: uiIconIds().size() * ICON_PITCH, h: 16 }, icons };
}

/** IDs for every synthetic sliced file (minus `skip`), plus the atlas when `atlas`. */
function uiIds(atlas: boolean, ...skip: Array<string>): Record<string, string> {
	const ids: Record<string, string> = {};
	uiSkinIds().forEach((id, i) => {
		const file = fileOf(id);
		if (!skip.includes(file)) ids[file] = `rbxassetid://${7000 + i}`;
	});
	if (atlas) ids[ATLAS_FILE] = ATLAS_ID;
	return ids;
}
const build = (ids: Record<string, string>) =>
	buildValeManifest(ids, { images: slicedLayouts(), uiIcons: iconSource() });

describe("vale ui skin: sliced pieces", () => {
	it("without IDs none of them exists and the required ui ids stay placeholders", () => {
		const m = build({});
		for (const id of [...uiSkinIds(), ...uiIconIds(), ...draftSkinIds()]) {
			expect([id, m.assets[id]]).toEqual([id, undefined]);
		}
		for (const id of sortedKeys(VALE_UI_REQUIRED_ART)) {
			expect([id, m.assets[id]]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
		}
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
	});

	it("each one is an image with its slice once uploaded; ui.panel takes the in-run panel", () => {
		const ids = uiIds(false);
		const m = build(ids);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		uiSkinIds().forEach((id, i) => {
			expect([id, m.assets[id]]).toEqual([
				id,
				{
					kind: "image",
					assetId: ids[fileOf(id)],
					w: 40 + i,
					h: 30,
					slice: { left: 6, top: 5, right: 7, bottom: 8 },
				},
			]);
		});
		expect(m.assets["ui.panel"]).toEqual(m.assets["ui.panel.hud"]);
		expect(m.assets["ui.panel"]).never.toBe(m.assets["ui.panel.hud"]);
		// no atlas: the icons stay placeholders
		for (const id of ["ui.icon.health", "ui.icon.mana", "ui.icon.ember"]) {
			expect([id, m.assets[id]]).toEqual([id, { kind: "placeholder" }]);
		}
		const pack = new ThemePack(m, { warn: quiet });
		expect(pack.image("ui.panel")!.slice).toEqual({ left: 6, top: 5, right: 7, bottom: 8 });
	});

	it("a piece without its ID is simply absent; the others switch on", () => {
		for (const id of uiSkinIds()) {
			const m = build(uiIds(false, fileOf(id)));
			expect(validateManifest(m, { packId: "vale" })).toEqual([]);
			for (const other of uiSkinIds()) {
				expect([id, other, m.assets[other]?.kind]).toEqual([id, other, other === id ? undefined : "image"]);
			}
			const panel = id === "ui.panel.hud" ? { kind: "placeholder" } : m.assets["ui.panel.hud"];
			expect([id, m.assets["ui.panel"]]).toEqual([id, panel]);
		}
	});
});

describe("vale ui skin: the icon atlas", () => {
	it("valeUiIconImages: every piece an image of the whole atlas with its rect and pivot; none without the ID", () => {
		const src = iconSource();
		expect(valeUiIconImages(src.icons, src.atlas, undefined)).toEqual({});
		const images = valeUiIconImages(src.icons, src.atlas, ATLAS_ID);
		expect(sortedKeys(images)).toEqual(sortedKeys(src.icons));
		uiIconIds().forEach((id, i) => {
			const want: ImageAsset = {
				kind: "image",
				assetId: ATLAS_ID as ImageAsset["assetId"],
				w: src.atlas.w,
				h: src.atlas.h,
				rect: { x: i * ICON_PITCH, y: 1, w: 18, h: 15 },
			};
			if (i % 3 === 0) want.pivot = { x: 9, y: 15 };
			expect([id, images[id]]).toEqual([id, want]);
		});
		// copies, not the layout's objects
		expect(images["ui.chip"].rect).never.toBe(src.icons["ui.chip"].rect);
	});

	it("is all or nothing in the manifest, and the required icons take the heart, flask and candle", () => {
		const without = build(uiIds(false));
		for (const id of uiIconIds()) expect([id, without.assets[id]]).toEqual([id, undefined]);

		const m = build(uiIds(true));
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		for (const id of uiIconIds()) {
			const a = m.assets[id] as ImageAsset;
			expect([id, a.kind, a.assetId, a.rect !== undefined]).toEqual([id, "image", ATLAS_ID, true]);
		}
		expect(m.assets["ui.icon.health"]).toEqual(m.assets["ui.heart.full"]);
		expect(m.assets["ui.icon.mana"]).toEqual(m.assets["ui.flask.full"]);
		expect(m.assets["ui.icon.ember"]).toEqual(m.assets["ui.candle"]);
		const pack = new ThemePack(m, { warn: quiet });
		expect(pack.image("ui.icon.health")!.rect).toEqual(iconSource().icons["ui.heart.full"].rect);
		// the atlas alone (no sliced piece): icons yes, ui.panel stays the placeholder
		const atlasOnly = build(uiIds(true, ...uiSkinIds().map(fileOf)));
		expect(atlasOnly.assets["ui.heart.full"]?.kind).toBe("image");
		expect(atlasOnly.assets["ui.panel"]).toEqual({ kind: "placeholder" });
		expect(validateManifest(atlasOnly, { packId: "vale" })).toEqual([]);
	});

	it("the required ui ids never point at a missing optional id", () => {
		const optional = [...uiSkinIds(), ...uiIconIds()];
		for (const id of sortedKeys(VALE_UI_REQUIRED_ART)) {
			expect([id, optional.includes(VALE_UI_REQUIRED_ART[id])]).toEqual([id, true]);
		}
	});
});

describe("vale ui skin: content ids and preload", () => {
	it("the atlas is one content id for every icon, listed once in the core tier with each sliced piece", () => {
		const ids = uiIds(true);
		const pack = new ThemePack(build(ids), { warn: quiet });
		for (const id of uiIconIds()) {
			expect([id, pack.contentIds(id)]).toEqual([id, [{ contentId: ATLAS_ID, media: "image" }]]);
		}
		const plan = preloadPlan(pack);
		const core = plan.core.map((r) => r.contentId as string);
		const later = plan.later.map((r) => r.contentId as string);
		expect(core.filter((c) => c === ATLAS_ID).size()).toBe(1);
		expect(later.includes(ATLAS_ID)).toBe(false);
		for (const id of uiSkinIds()) {
			const c = ids[fileOf(id)];
			expect([id, core.filter((x) => x === c).size(), later.includes(c)]).toEqual([id, 1, false]);
		}
	});

	it("no ui id is preloaded before its upload", () => {
		const pack = new ThemePack(build({}), { warn: quiet });
		for (const id of [...uiSkinIds(), ...uiIconIds()]) {
			expect([id, pack.contentIds(id).size()]).toEqual([id, 0]);
		}
	});
});

describe("vale ui skin: the generated layouts", () => {
	it("the icon layout names only uiIconIds pieces, all of them once it names any, each inside the atlas", () => {
		const keys = sortedKeys(VALE_UI_ICONS);
		for (const id of keys) {
			const r = VALE_UI_ICONS[id].rect;
			expect([id, uiIconIds().includes(id)]).toEqual([id, true]);
			expect([id, r.x + r.w <= VALE_UI_ICON_ATLAS.w, r.y + r.h <= VALE_UI_ICON_ATLAS.h]).toEqual([
				id,
				true,
				true,
			]);
		}
		if (keys.size() > 0) expect(keys.size()).toBe(uiIconIds().size());
		expect(VALE_UI_ICON_SOURCE.file).toBe(VALE_UI_ICON_FILE);
	});

	it("every sliced piece the image layout has carries a slice", () => {
		for (const id of uiSkinIds()) {
			const layout = VALE_IMAGE_LAYOUTS[id];
			if (layout !== undefined) expect([id, layout.slice !== undefined]).toEqual([id, true]);
		}
	});
});

describe("vale ui skin: uploaded 2026-10-30 (UA4)", () => {
	it("the bundled vale pack draws every sliced piece and every icon as its uploaded image", () => {
		expect(validateManifest(VALE_MANIFEST, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		for (const id of uiSkinIds()) {
			const file = VALE_IMAGE_LAYOUTS[id].file;
			expect([id, VALE_ASSET_IDS[file] !== undefined, pack.image(id)?.assetId]).toEqual([
				id,
				true,
				VALE_ASSET_IDS[file],
			]);
			expect([id, pack.image(id)?.slice !== undefined]).toEqual([id, true]);
		}
		const atlas = VALE_ASSET_IDS[VALE_UI_ICON_FILE];
		expect(atlas).toBeDefined();
		for (const id of uiIconIds()) {
			const ref = pack.image(id);
			expect([id, ref?.assetId, ref?.rect]).toEqual([id, atlas, VALE_UI_ICONS[id].rect]);
		}
		for (const id of sortedKeys(VALE_UI_REQUIRED_ART)) {
			expect([id, VALE_MANIFEST.assets[id]?.kind]).toEqual([id, "image"]);
		}
	});
});
