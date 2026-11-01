// The vale pack's world art (docs/DECOR.md R5): the Lords of Pain props, effects and breakables in VALE_WORLD_LAYOUTS
// must satisfy the validator once uploaded (fake IDs for every file), map onto every decor / fx / ambient / breakable ID
// the manifest promises, and stay absent (decor) or placeholders (breakables) until their files have IDs.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BIOMES,
	BREAKABLE_KINDS,
	BREAKABLE_SHATTER_ANIMATION,
	DECOR_FX_NAMES,
	DECOR_KIND_LAYERS,
	DECOR_PARTICLE,
	breakableId,
	decorAmbientId,
	decorFxId,
	decorId,
	parseDecorId,
} from "../../contract";
import { ThemeCore } from "../../core";
import type { ImageAsset, SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { breakableContrastReport, decorFxReport, validateManifest } from "../../validate";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { VALE_WORLD_LAYOUTS } from "./layout";
import {
	VALE_AMBIENT_ART,
	VALE_BREAKABLE_ART,
	VALE_DECOR_FX,
	VALE_DECOR_PIECES,
	VALE_RETIRED_WORLD_ART,
	VALE_VOID_DECOR_PIECES,
	buildValeManifest,
} from "./manifest";

const quiet = () => undefined;

/** Every art/build file the world layouts name, sorted. */
function worldFiles(): Array<string> {
	const files = new Set<string>();
	for (const name of sortedKeys(VALE_WORLD_LAYOUTS)) {
		const l = VALE_WORLD_LAYOUTS[name];
		if (l.kind === "image") files.add(l.file);
		else for (const s of l.sheets) files.add(s.file);
	}
	const out = new Array<string>();
	for (const f of files) out.push(f);
	out.sort();
	return out;
}

/** A fake uploaded ID for every world file (test vectors; src/shared/theme is exempt from check-asset-ids). */
function worldIds(...skip: Array<string>): Record<string, string> {
	const ids: Record<string, string> = {};
	worldFiles().forEach((file, i) => {
		if (!skip.includes(file)) ids[file] = `rbxassetid://${8000 + i}`;
	});
	return ids;
}

/** Every decor ID the manifest maps, for every biome. */
function decorIds(): Array<string> {
	const out = new Array<string>();
	for (const b of BIOMES) {
		for (const p of VALE_DECOR_PIECES) out.push(decorId(b.id, p.kind, p.variant));
		out.push(decorAmbientId(b.id));
	}
	for (const name of DECOR_FX_NAMES) out.push(decorFxId(name));
	return out;
}

describe("vale world art (docs/DECOR.md R5)", () => {
	it("names real layouts, and every layout is used", () => {
		const used = new Set<string>([VALE_AMBIENT_ART.art]);
		for (const p of VALE_DECOR_PIECES) used.add(p.art);
		for (const p of VALE_VOID_DECOR_PIECES) used.add(p.art);
		for (const name of DECOR_FX_NAMES) used.add(VALE_DECOR_FX[name]);
		for (const kind of BREAKABLE_KINDS) used.add(VALE_BREAKABLE_ART[kind]);
		// the void pieces' art may still be missing from the built atlas (docs/VOID_DECOR.md VD6): dormant until built
		const pending = new Set<string>();
		for (const p of VALE_VOID_DECOR_PIECES) if (VALE_WORLD_LAYOUTS[p.art] === undefined) pending.add(p.art);
		for (const art of used)
			if (!pending.has(art)) expect([art, VALE_WORLD_LAYOUTS[art] !== undefined]).toEqual([art, true]);
		// every layout is used, except the retired gems (docs/BOOST_ART.md decision 2), which nothing may use
		for (const name of sortedKeys(VALE_WORLD_LAYOUTS)) {
			expect([name, used.has(name)]).toEqual([name, !VALE_RETIRED_WORLD_ART.includes(name)]);
		}
		// decor pieces: a kind's layer is one it allows, its variant in range, no ID twice
		const seen = new Set<string>();
		for (const p of [...VALE_DECOR_PIECES, ...VALE_VOID_DECOR_PIECES]) {
			const id = decorId("biome.1", p.kind, p.variant);
			expect([id, seen.has(id)]).toEqual([id, false]);
			seen.add(id);
			expect([id, (DECOR_KIND_LAYERS[p.kind] as ReadonlyArray<string>).includes(p.layer)]).toEqual([id, true]);
			expect(parseDecorId(id)).toBeDefined();
		}
		// one shared atlas, the particle texture and the loot twinkle's own sheet (docs/BREAKABLE_DROPS.md): three uploads
		expect(worldFiles()).toEqual(["decor-atlas.png", "decor-mote.png", "loot-glint.png"]);
	});

	it("with every world file uploaded validates with zero problems, every ID mapped", () => {
		const m = buildValeManifest(worldIds());
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		for (const id of decorIds()) expect([id, m.assets[id] !== undefined]).toEqual([id, true]);
		for (const kind of BREAKABLE_KINDS) expect(m.assets[breakableId(kind)].kind).toBe("sprites");
		// colour rules still hold (the art changes no role): decor fx never read as enemy bullets, bullets read on
		// breakables
		for (const e of decorFxReport(m)) expect([e.role, e.against, e.ok]).toEqual([e.role, e.against, true]);
		for (const e of breakableContrastReport(m)) expect([e.role, e.ok]).toEqual([e.role, true]);
	});

	it("without IDs adds no decor and keeps the breakables' placeholder boxes; the atlas alone draws all but particles", () => {
		const none = buildValeManifest({});
		for (const id of decorIds()) expect([id, none.assets[id]]).toEqual([id, undefined]);
		for (const kind of BREAKABLE_KINDS) {
			expect(none.assets[breakableId(kind)]).toEqual(PLACEHOLDER_MANIFEST.assets[breakableId(kind)]);
		}
		const atlasOnly = buildValeManifest(worldIds("decor-mote.png"));
		expect(validateManifest(atlasOnly, { packId: "vale" })).toEqual([]);
		for (const b of BIOMES) {
			expect(atlasOnly.assets[decorAmbientId(b.id)]).toBe(undefined);
			expect(atlasOnly.assets[decorId(b.id, "wall")]).toBeDefined();
		}
		const moteOnly = buildValeManifest(worldIds("decor-atlas.png"));
		expect(moteOnly.assets[decorId("biome.1", "pillar")]).toBe(undefined);
		expect(moteOnly.assets[breakableId("crate")]).toEqual(PLACEHOLDER_MANIFEST.assets[breakableId("crate")]);
		expect(moteOnly.assets[decorAmbientId("biome.2")]).toBeDefined();
	});

	it("draws the same art in every biome, with its layer, glow and outline", () => {
		const m = buildValeManifest(worldIds());
		const core = new ThemeCore(m, { warn: quiet });
		for (const p of VALE_DECOR_PIECES) {
			const first = m.assets[decorId("biome.1", p.kind, p.variant)];
			for (const b of BIOMES) {
				const id = decorId(b.id, p.kind, p.variant);
				expect([id, m.assets[id]]).toEqual([id, first]);
				const art = core.decor(id);
				expect([id, art !== undefined]).toEqual([id, true]);
				expect([id, art!.layer, art!.glow]).toEqual([id, p.layer, p.glow === true]);
				// standing pieces carry an outline per facing (the footprint fit holds the shape, not the cell)
				const standing = p.layer === "tall" || p.layer === "low";
				const facings = art!.art.kind === "sprites" ? art!.art.set.facings.count : 1;
				expect([id, standing ? art!.outlines?.size() : art!.outlines]).toEqual([
					id,
					standing ? facings : undefined,
				]);
			}
		}
		// variants by cell hash: debris (bricks, rocks), bones1-3, mushrooms for moss and roots
		for (const kind of ["debris", "bones", "moss", "roots"] as const) {
			expect([kind, core.decorVariants("biome.3", kind).size()]).toEqual([kind, 4]);
		}
		expect(core.decorVariants("biome.4", "grave").size()).toBe(0); // no Lords of Pain art: not drawn
	});

	it("void pieces (docs/VOID_DECOR.md VD6): flagstones / curb map once the atlas has their art, every biome alike", () => {
		const m = buildValeManifest(worldIds());
		const core = new ThemeCore(m, { warn: quiet });
		for (const p of VALE_VOID_DECOR_PIECES) {
			const built = VALE_WORLD_LAYOUTS[p.art] !== undefined;
			for (const b of BIOMES) {
				const id = decorId(b.id, p.kind, p.variant);
				expect([id, m.assets[id] !== undefined]).toEqual([id, built]);
				if (built) expect([id, core.decor(id)?.layer]).toEqual([id, p.layer]);
			}
		}
		// the void's other pieces reuse the decor kinds' art: ruin runs, columns, stumps, debris
		for (const kind of ["wall", "wallBroken", "column", "columnBroken", "debris"] as const)
			expect([kind, core.decorVariants("biome.2", kind).size() > 0]).toEqual([kind, true]);
	});

	it("grid pieces face the camera's wall normals; the brazier lights, the torch's glow is its cup", () => {
		const m = buildValeManifest(worldIds());
		for (const kind of ["wall", "wallBroken", "torch"] as const) {
			const set = m.assets[decorId("biome.1", kind)] as SpriteSetAsset;
			expect([kind, set.kind]).toEqual([kind, "sprites"]);
			// the pack's diagonal renders (NE, NW, SW, SE): the plan's normals (1, 0) / (0, 1) land at 320.7 / 219.3
			expect([kind, set.facings]).toEqual([kind, { count: 4, zeroDeg: 45, ccw: true }]);
		}
		const brazier = m.assets[decorId("biome.2", "brazier")] as SpriteSetAsset;
		expect(sortedKeys(brazier.animations)).toEqual(["idle", "lit"]);
		expect(brazier.animations.lit.frames).toBe(8);
		expect(brazier.animations.lit.loop).toBe(true);
		expect(brazier.glow).toBe(true);
		expect(brazier.glowAt!.y < brazier.pivot.y).toBe(true); // above its feet, on the embers
		const torch = m.assets[decorId("biome.2", "torch")] as SpriteSetAsset;
		expect(torch.glowAt!.y < torch.pivot.y).toBe(true); // the cup, above the centre it hangs by
		// single pieces: columns stand on their bottom edge (nothing below a wall-top pivot)
		for (const kind of ["pillar", "column", "columnBroken"] as const) {
			const img = m.assets[decorId("biome.5", kind)] as ImageAsset;
			expect([kind, img.kind, img.rect !== undefined]).toEqual([kind, "image", true]);
			expect([kind, img.pivot!.y >= img.rect!.h - 2]).toEqual([kind, true]);
		}
	});

	it("effects are self-lit loops; the ambient texture is a bare particle image, emissive where the Forge's glow", () => {
		const m = buildValeManifest(worldIds());
		const core = new ThemeCore(m, { warn: quiet });
		for (const name of DECOR_FX_NAMES) {
			const fx = core.decor(decorFxId(name));
			expect([name, fx !== undefined, fx?.layer, fx?.emissive]).toEqual([name, true, undefined, true]);
		}
		for (const name of ["torch", "flame", "glint"] as const) {
			const set = m.assets[decorFxId(name)] as SpriteSetAsset;
			expect([name, set.kind, set.animations.idle.frames, set.animations.idle.loop]).toEqual([
				name,
				"sprites",
				8,
				true,
			]);
		}
		for (const b of BIOMES) {
			const a = core.ambient(b.id);
			expect([b.id, a !== undefined]).toEqual([b.id, true]);
			expect([b.id, a!.emissive]).toEqual([b.id, VALE_AMBIENT_ART.emissive[b.id]]);
			expect(a!.sizeStuds).toBe(DECOR_PARTICLE.defaultSizeStuds);
			const def = m.assets[decorAmbientId(b.id)] as ImageAsset;
			expect(sortedKeys(def).filter((k) => k !== "emissive")).toEqual(["assetId", "h", "kind", "w"]);
		}
	});

	it("breakables: idle plus a one-shot shatter, standing on their base", () => {
		const core = new ThemeCore(buildValeManifest(worldIds()), { warn: quiet });
		for (const kind of BREAKABLE_KINDS) {
			const t = core.breakable(kind);
			expect([kind, t.art?.kind]).toEqual([kind, "sprites"]);
			if (t.art === undefined || t.art.kind !== "sprites") continue;
			const set = t.art.set;
			expect([kind, set.has("idle"), set.animation("idle")!.frames]).toEqual([kind, true, 1]);
			const shatter = set.animation(BREAKABLE_SHATTER_ANIMATION)!;
			expect([kind, shatter.frames, shatter.loop]).toEqual([kind, 8, false]);
			expect([kind, set.facings.count]).toEqual([kind, 1]);
			// the broken decal it leaves is decor, flat, in every biome
			for (const b of BIOMES) {
				const debris = core.decorVariants(b.id, kind === "barrel" ? "brokenBarrel" : "brokenCrate");
				expect([kind, b.id, debris.size(), debris[0]?.layer]).toEqual([kind, b.id, 1, "flat"]);
			}
		}
	});
});
