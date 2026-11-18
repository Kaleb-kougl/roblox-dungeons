// Content ids for preloading (docs/PRELOAD.md P1): ThemeCore.contentIds / assetIdList / biomeKeys / biomeContentIds
// walk the manifest's assets and biomes for every uploaded id, in a stable order, each once.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ThemeCore } from "./core";
import { ThemePack } from "./pack";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_ASSET_IDS, VALE_MANIFEST } from "./packs/vale";
import type { ContentRef } from "./types";
import { deepClone, describeValue, quote, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";

const quiet = () => undefined;

const ids = (refs: ReadonlyArray<ContentRef>) => refs.map((r) => r.contentId);

/** Every content id of a core (assets, then biomes), deduped, sorted. */
function union(core: ThemeCore): Array<string> {
	const seen = new Set<string>();
	const out = new Array<string>();
	const add = (refs: ReadonlyArray<ContentRef>) => {
		for (const r of refs) {
			if (seen.has(r.contentId)) continue;
			seen.add(r.contentId);
			out.push(r.contentId);
		}
	};
	for (const id of core.assetIdList()) add(core.contentIds(id));
	for (const b of core.biomeKeys()) add(core.biomeContentIds(b));
	// docs/COSMETICS.md: dye sheets are listed apart (dyeContentIds), never with their set.
	for (const id of core.assetIdList()) add(core.dyeContentIds(id));
	out.sort();
	return out;
}

/** No content id twice in one list. */
function expectUnique(label: string, refs: ReadonlyArray<ContentRef>): void {
	const seen = new Set<string>();
	for (const r of refs) {
		expect([label, r.contentId, seen.has(r.contentId)]).toEqual([label, r.contentId, false]);
		seen.add(r.contentId);
	}
}

describe("theme content ids (docs/PRELOAD.md P1)", () => {
	it("vale: every content id the manifest references is listed, nothing else, each once per list", () => {
		const core = new ThemeCore(VALE_MANIFEST, { warn: quiet });
		// independent of the walk: an uploaded id is referenced when its quoted string appears in the manifest's dump
		const dump = describeValue(VALE_MANIFEST);
		const referenced = new Array<string>();
		for (const file of sortedKeys(VALE_ASSET_IDS)) {
			const v = VALE_ASSET_IDS[file];
			if (dump.find(quote(v), 1, true)[0] !== undefined && !referenced.includes(v)) referenced.push(v);
		}
		referenced.sort();
		expect(referenced.size()).toBeGreaterThan(0);
		expect(union(core)).toEqual(referenced);
		for (const id of core.assetIdList()) expectUnique(id, core.contentIds(id));
		for (const b of core.biomeKeys()) expectUnique(b, core.biomeContentIds(b));
	});

	it("a sprite set returns its sheets and their outline sheets, in sheet order, as images", () => {
		const core = new ThemeCore(VALE_MANIFEST, { warn: quiet });
		expect(core.contentIds("enemy.swarmer")).toEqual([
			{ contentId: VALE_ASSET_IDS["swarmer-move.png"], media: "image" },
			{ contentId: VALE_ASSET_IDS["swarmer-move-outline.png"], media: "image" },
			{ contentId: VALE_ASSET_IDS["swarmer-death.png"], media: "image" },
			{ contentId: VALE_ASSET_IDS["swarmer-death-outline.png"], media: "image" },
		]);
		const knight = ids(core.contentIds("class.vanguard"));
		for (const file of ["vanguard-idle.png", "vanguard-run.png", "vanguard-roll.png", "vanguard-attack1.png"]) {
			expect([file, knight.includes(VALE_ASSET_IDS[file])]).toEqual([file, true]);
		}
	});

	it("docs/COSMETICS.md: a set's dye sheets are never in contentIds; dyeContentIds lists them in sheet order", () => {
		// `plain`: the vale manifest with every dye id removed (vale's own are uploaded, CS8)
		const bare = deepClone(VALE_MANIFEST) as unknown as Obj;
		for (const sheet of ((bare.assets as Obj)["class.vanguard"] as Obj).sheets as Array<Obj>)
			sheet.dyeAssetId = undefined;
		const plain = new ThemeCore(bare as unknown as typeof VALE_MANIFEST, { warn: quiet });
		const before = plain.contentIds("class.vanguard");
		const m = deepClone(VALE_MANIFEST) as unknown as Obj;
		const set = (m.assets as Obj)["class.vanguard"] as Obj;
		expect(set.kind).toBe("sprites");
		const sheets = set.sheets as Array<Obj>;
		const dyes = new Array<string>();
		for (let i = 0; i < sheets.size(); i++) {
			const dye = `rbxassetid://${9900000 + i}`; // check-asset-ids: allow (synthetic dye ids, never uploaded)
			sheets[i].dyeAssetId = dye;
			dyes.push(dye);
		}
		expect(validateManifest(m)).toEqual([]);
		const core = new ThemeCore(m, { warn: quiet });
		// exactly its sheets and their outline sheets, as before
		expect(core.contentIds("class.vanguard")).toEqual(before);
		for (const d of dyes)
			expect((ids(core.contentIds("class.vanguard")) as ReadonlyArray<string>).includes(d)).toBe(false);
		expect(ids(core.dyeContentIds("class.vanguard"))).toEqual(dyes);
		for (const r of core.dyeContentIds("class.vanguard")) expect(r.media).toBe("image");
		expect(new ThemePack(m, { warn: quiet }).dyeContentIds("class.vanguard")).toEqual(
			core.dyeContentIds("class.vanguard"),
		);
		// no dyes: empty (a set without them, another kind, a missing id)
		expect(plain.dyeContentIds("class.vanguard")).toEqual([]);
		expect(core.dyeContentIds("enemy.swarmer")).toEqual([]);
		expect(core.dyeContentIds("sfx.ui.click")).toEqual([]);
		expect(core.dyeContentIds("no.such.id")).toEqual([]);
		// the frames carry the dye next to the outline, same rect
		const f = new ThemePack(m, { warn: quiet }).sprites("class.vanguard")!.frame("idle", 0, 0);
		expect(f.dyeImage).toBe(dyes[core.sprites("class.vanguard")!.frame("idle", 0, 0).sheet]);
		// the vale pack's dye sheets are uploaded (docs/COSMETICS.md CS8): every Knight / Archer frame has one
		for (const setId of ["class.vanguard", "class.ranger"]) {
			const vale = new ThemePack(VALE_MANIFEST, { warn: quiet });
			expect(vale.sprites(setId)!.frame("idle", 0, 0).dyeImage).never.toBe(undefined);
			expect(vale.dyeContentIds(setId).size()).toBe(setId === "class.vanguard" ? 8 : 7);
		}
	});

	it("a sound returns its assetId then its variants, as sounds, each once", () => {
		const core = new ThemeCore(
			{
				id: "t",
				assets: {
					"sfx.player.swing": {
						kind: "sound",
						assetId: "rbxassetid://11",
						variants: ["rbxassetid://12", "rbxassetid://13", "rbxassetid://11"],
						pitch: [0.9, 1.1],
					},
					"sfx.ui.click": { kind: "silent" },
					"ui.ring.player": { kind: "image", assetId: "rbxassetid://14", w: 8, h: 8 },
				},
			},
			{ warn: quiet },
		);
		expect(core.contentIds("sfx.player.swing")).toEqual([
			{ contentId: "rbxassetid://11", media: "sound" },
			{ contentId: "rbxassetid://12", media: "sound" },
			{ contentId: "rbxassetid://13", media: "sound" },
		]);
		expect(core.contentIds("sfx.ui.click")).toEqual([]);
		expect(core.contentIds("ui.ring.player")).toEqual([{ contentId: "rbxassetid://14", media: "image" }]);
		expect(core.assetIdList()).toEqual(["sfx.player.swing", "ui.ring.player"]);
	});

	it("vale's uploaded sounds are sounds; a biome returns its tiles' uploads as images", () => {
		const core = new ThemeCore(VALE_MANIFEST, { warn: quiet });
		const click = core.contentIds("sfx.ui.click");
		expect(click).toEqual([{ contentId: VALE_ASSET_IDS["sfx-ui-click.ogg"], media: "sound" }]);
		const swing = core.contentIds("sfx.player.swing");
		expect(swing.size()).toBe(5);
		for (const r of swing) expect(r.media).toBe("sound");
		expect(core.biomeKeys()).toEqual(["biome.1", "biome.2", "biome.3", "biome.4", "biome.5"]);
		expect(core.biomeContentIds("biome.1")).toEqual([
			{ contentId: VALE_ASSET_IDS["tile-biome1-floor.png"], media: "image" },
		]);
		expect(core.biomeContentIds("biome.9")).toEqual([]);
	});

	it("the placeholder pack has no content ids", () => {
		const core = new ThemeCore(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(core.assetIdList()).toEqual([]);
		for (const id of sortedKeys(PLACEHOLDER_MANIFEST.assets)) {
			expect([id, core.contentIds(id)]).toEqual([id, []]);
		}
		for (const b of core.biomeKeys()) {
			expect([b, core.biomeContentIds(b)]).toEqual([b, []]);
		}
		expect(core.biomeKeys().size()).toBeGreaterThan(0);
		expect(core.contentIds("no.such.id")).toEqual([]);
	});

	it("the order is stable: two calls, and a second pack over the same manifest, agree", () => {
		const a = new ThemeCore(VALE_MANIFEST, { warn: quiet });
		const b = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect(b.assetIdList()).toEqual(a.assetIdList());
		expect(b.biomeKeys()).toEqual(a.biomeKeys());
		for (const id of a.assetIdList()) {
			const fresh = new ThemeCore(VALE_MANIFEST, { warn: quiet });
			expect([id, fresh.contentIds(id)]).toEqual([id, a.contentIds(id)]);
			expect([id, b.contentIds(id)]).toEqual([id, a.contentIds(id)]);
		}
		for (const k of a.biomeKeys()) expect([k, b.biomeContentIds(k)]).toEqual([k, a.biomeContentIds(k)]);
	});
});
