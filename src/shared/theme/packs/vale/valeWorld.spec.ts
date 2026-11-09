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
	voidDecorId,
	VOID_DECOR,
} from "../../contract";
import { ThemeCore } from "../../core";
import type { ImageAsset, SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { breakableContrastReport, decorFxReport, validateManifest } from "../../validate";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import { PELLET_KINDS, pelletId } from "../../pellets";
import { pelletReport } from "../../pelletColors";
import { TREASURE_IDS } from "../../treasure";
import { VALE_KENNEY_LAYOUTS, VALE_KENNEY_SHEETS } from "./kenneyLayout";
import { VALE_WORLD_LAYOUTS } from "./layout";
import {
	VALE_AMBIENT_ART,
	VALE_ANCIENT_PATCH_ART,
	VALE_BREAKABLE_ART,
	VALE_DECOR_FX,
	VALE_DECOR_PIECES,
	VALE_KENNEY_PIECES,
	VALE_PATCH_LOOKS,
	VALE_PELLET_ART,
	VALE_RETIRED_WORLD_ART,
	VALE_TREASURE_ART,
	VALE_VOID_DECOR_PIECES,
	VALE_VOID_KIND_PIECES,
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
	// the Kenney decor sheet (docs/KENNEY_DECOR.md KN9)
	for (const name of sortedKeys(VALE_KENNEY_LAYOUTS)) files.add(VALE_KENNEY_LAYOUTS[name].file);
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
		for (const p of VALE_DECOR_PIECES)
			if (p.biome === undefined || p.biome === b.id) out.push(decorId(b.id, p.kind, p.variant));
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
		for (const p of VALE_VOID_KIND_PIECES) used.add(p.art);
		for (const name of DECOR_FX_NAMES) used.add(VALE_DECOR_FX[name]);
		for (const kind of BREAKABLE_KINDS) used.add(VALE_BREAKABLE_ART[kind]);
		for (const kind of PELLET_KINDS) used.add(VALE_PELLET_ART[kind]);
		for (const id of TREASURE_IDS) if (VALE_TREASURE_ART[id] !== undefined) used.add(VALE_TREASURE_ART[id]);
		// the void pieces' art may still be missing from the built atlas (docs/VOID_DECOR.md VD6): dormant until built
		const pending = new Set<string>();
		for (const p of VALE_VOID_DECOR_PIECES) if (VALE_WORLD_LAYOUTS[p.art] === undefined) pending.add(p.art);
		for (const art of used)
			if (!pending.has(art))
				expect([art, (VALE_WORLD_LAYOUTS[art] ?? VALE_KENNEY_LAYOUTS[art]) !== undefined]).toEqual([art, true]);
		// the Kenney sheet's pieces (docs/KENNEY_DECOR.md KN9): every one used, none also in layout.ts, all in its sheet(s)
		for (const name of sortedKeys(VALE_KENNEY_LAYOUTS)) {
			expect([name, used.has(name), VALE_WORLD_LAYOUTS[name] === undefined]).toEqual([name, true, true]);
			expect([name, VALE_KENNEY_SHEETS.includes(VALE_KENNEY_LAYOUTS[name].file)]).toEqual([name, true]);
		}
		// every layout is used, except the retired gems (docs/BOOST_ART.md decision 2), which nothing may use
		for (const name of sortedKeys(VALE_WORLD_LAYOUTS)) {
			expect([name, used.has(name)]).toEqual([name, !VALE_RETIRED_WORLD_ART.includes(name)]);
		}
		// decor pieces: a kind's layer is one it allows, its variant in range, no ID twice
		const seen = new Set<string>();
		for (const p of [...VALE_DECOR_PIECES, ...VALE_VOID_DECOR_PIECES]) {
			const id = decorId(p.biome ?? "biome.1", p.kind, p.variant);
			expect([id, seen.has(id)]).toEqual([id, false]);
			seen.add(id);
			expect([id, (DECOR_KIND_LAYERS[p.kind] as ReadonlyArray<string>).includes(p.layer)]).toEqual([id, true]);
			expect(parseDecorId(id)).toBeDefined();
		}
		// biome void kinds: a layer the kind allows, variants in range, no ID twice
		const seenVoid = new Set<string>();
		for (const p of VALE_VOID_KIND_PIECES) {
			const id = voidDecorId("biome.1", p.voidKind, p.variant);
			expect([id, seenVoid.has(id)]).toEqual([id, false]);
			seenVoid.add(id);
			expect([id, (VOID_DECOR.layers[p.voidKind] as ReadonlyArray<string>).includes(p.layer)]).toEqual([
				id,
				true,
			]);
			expect(parseDecorId(id)).toBeDefined();
		}
		// one shared atlas, the particle texture, the loot twinkle's own sheet (docs/BREAKABLE_DROPS.md) and the trial
		// 3D kit's own PNGs (docs/DECOR.md "3D kits") and the
		// two pellet cubes (docs/PELLETS.md PL8) and the vault chest's two sheets (docs/TREASURE.md TR9) and Kenney's
		// bookcases, the bookcase's alternative set and its wide cases, and the floor patches baked per biome
		// (docs/KENNEY_DECOR.md), and the one Kenney decor sheet of the solid pieces and the runner (KN9), and the five
		// gravestones (docs/DECOR.md "Graves")
		expect(worldFiles()).toEqual([
			"decor-atlas.png",
			"decor-mote.png",
			"grave-cracked.png",
			"grave-cross.png",
			"grave-obelisk.png",
			"grave-rounded.png",
			"grave-skull.png",
			"kenney-bookcase-books-x.png",
			"kenney-bookcase-books-z.png",
			"kenney-bookcase-destroyed-x.png",
			"kenney-bookcase-destroyed-z.png",
			"kenney-bookcase-empty-x.png",
			"kenney-bookcase-empty-z.png",
			"kenney-bookcase-glass-x.png",
			"kenney-bookcase-glass-z.png",
			"kenney-bookcase-half-x.png",
			"kenney-bookcase-half-z.png",
			"kenney-bookcase-halfempty-x.png",
			"kenney-bookcase-halfempty-z.png",
			"kenney-bookcase-halfwide-x.png",
			"kenney-bookcase-halfwide-z.png",
			"kenney-bookcase-halfwideempty-x.png",
			"kenney-bookcase-halfwideempty-z.png",
			"kenney-bookcase-ladder-x.png",
			"kenney-bookcase-ladder-z.png",
			"kenney-bookcase-wide-x.png",
			"kenney-bookcase-wide-z.png",
			"kenney-bookcase-wideempty-x.png",
			"kenney-bookcase-wideempty-z.png",
			"kenney-bookcase-wideemptyladder-x.png",
			"kenney-bookcase-wideemptyladder-z.png",
			"kenney-bookcase-wideladder-x.png",
			"kenney-bookcase-wideladder-z.png",
			"kenney-decor.png",
			"kenney-patch-dirt-b1.png",
			"kenney-patch-dirt-b2.png",
			"kenney-patch-dirt-b3.png",
			"kenney-patch-dirt-b4.png",
			"kenney-patch-dirt-b5.png",
			"kenney-patch-planks-a-b1.png",
			"kenney-patch-planks-a-b2.png",
			"kenney-patch-planks-a-b3.png",
			"kenney-patch-planks-a-b4.png",
			"kenney-patch-planks-a-b5.png",
			"kenney-patch-planks-b-b1.png",
			"kenney-patch-planks-b-b2.png",
			"kenney-patch-planks-b-b3.png",
			"kenney-patch-planks-b-b4.png",
			"kenney-patch-planks-b-b5.png",
			"kenney-patch-planksbroken-a-b1.png",
			"kenney-patch-planksbroken-a-b2.png",
			"kenney-patch-planksbroken-a-b3.png",
			"kenney-patch-planksbroken-a-b4.png",
			"kenney-patch-planksbroken-a-b5.png",
			"kenney-patch-planksbroken-b-b1.png",
			"kenney-patch-planksbroken-b-b2.png",
			"kenney-patch-planksbroken-b-b3.png",
			"kenney-patch-planksbroken-b-b4.png",
			"kenney-patch-planksbroken-b-b5.png",
			"kit-banner.png",
			"kit-bookcase-x.png",
			"kit-bookcase-z.png",
			"kit-cage-1.png",
			"kit-cage-2.png",
			"kit-candle-stand.png",
			"kit-carpet-end-x.png",
			"kit-carpet-end-z.png",
			"kit-carpet-x.png",
			"kit-carpet-z.png",
			"kit-chains-1.png",
			"kit-chains-2.png",
			"kit-chair-nx.png",
			"kit-chair-nz.png",
			"kit-chair-px.png",
			"kit-chair-pz.png",
			"kit-chandelier-1.png",
			"kit-chest-open.png",
			"kit-chest.png",
			"kit-sarcophagus.png",
			"kit-statue-x.png",
			"kit-statue-z.png",
			"kit-table-x.png",
			"kit-table-z.png",
			"kit-throne-x.png",
			"kit-throne-z.png",
			"kit-tomb-x.png",
			"kit-tomb-z.png",
			"loot-glint.png",
			"lop-patch-blotch1.png",
			"lop-patch-blotch2.png",
			"pellet-power.png",
			"pellet.png",
		]);
	});

	it("with every world file uploaded validates with zero problems, every ID mapped", () => {
		const m = buildValeManifest(worldIds());
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		for (const id of decorIds()) expect([id, m.assets[id] !== undefined]).toEqual([id, true]);
		for (const kind of BREAKABLE_KINDS) expect(m.assets[breakableId(kind)].kind).toBe("sprites");
		// the vault chest (docs/TREASURE.md TR9): four-facing sprite sets, closed and open; the cage keeps its bars
		for (const [id, art] of [
			["treasure.chest", "kit-chest"],
			["treasure.chestopen", "kit-chest-open"],
		]) {
			const asset = m.assets[id];
			const l = VALE_WORLD_LAYOUTS[art];
			expect([id, asset.kind, l.kind === "sprites" ? l.facings.count : 0]).toEqual([id, "sprites", 4]);
		}
		// the pellets (docs/PELLETS.md PL8): images of their own PNGs at the pack's scale, tinted by their roles
		for (const kind of PELLET_KINDS) {
			const a = m.assets[pelletId(kind)] as ImageAsset;
			const l = VALE_WORLD_LAYOUTS[VALE_PELLET_ART[kind]];
			expect([kind, a.kind, l.kind === "image" ? a.assetId === worldIds()[l.file] : false]).toEqual([
				kind,
				"image",
				true,
			]);
			expect([kind, a.pixelsPerTile, a.rect]).toEqual([kind, 29.6, undefined]);
		}
		for (const e of pelletReport(m))
			expect([e.role, e.check, e.against, e.ok]).toEqual([e.role, e.check, e.against, true]);
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
		// a pellet keeps its placeholder cube until its own PNG has an ID (each kind on its own)
		for (const kind of PELLET_KINDS) expect(none.assets[pelletId(kind)]).toEqual({ kind: "placeholder" });
		const normalOnly = buildValeManifest(worldIds("pellet-power.png"));
		expect([normalOnly.assets["pellet.normal"].kind, normalOnly.assets["pellet.power"].kind]).toEqual([
			"image",
			"placeholder",
		]);
		expect(validateManifest(normalOnly, { packId: "vale" })).toEqual([]);
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

	it("draws the same art in every biome (a biome piece: its own biome's), with its layer, glow and outline", () => {
		const m = buildValeManifest(worldIds());
		const core = new ThemeCore(m, { warn: quiet });
		for (const p of VALE_DECOR_PIECES) {
			if (p.biome !== undefined) continue; // the floor patches: below
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
		// graves (docs/DECOR.md "Graves"): five original looks, in every biome (the Forge places them in grim graveyards)
		for (const b of BIOMES) expect([b.id, core.decorVariants(b.id, "grave").size()]).toEqual([b.id, 5]);
		// the floor patches (docs/KENNEY_DECOR.md KN4): five looks in every biome, each biome its own bake, flat; the
		// ancient biome adds the two Lords of Pain blotches ("LoP floor blotches")
		const ids = worldIds();
		BIOMES.forEach((b, i) => {
			const extra = i === 0 ? VALE_ANCIENT_PATCH_ART.size() : 0;
			expect([b.id, core.decorVariants(b.id, "patch").size()]).toEqual([b.id, VALE_PATCH_LOOKS.size() + extra]);
			VALE_PATCH_LOOKS.forEach((look, v) => {
				const id = decorId(b.id, "patch", v + 1);
				const a = m.assets[id] as ImageAsset;
				expect([id, a.kind, a.layer, a.assetId]).toEqual([
					id,
					"image",
					"flat",
					ids[`kenney-patch-${look}-b${i + 1}.png`],
				]);
			});
		});
		VALE_ANCIENT_PATCH_ART.forEach((art, k) => {
			const id = decorId("biome.1", "patch", VALE_PATCH_LOOKS.size() + k + 1);
			const a = m.assets[id] as ImageAsset;
			expect([id, a.kind, a.layer, a.assetId]).toEqual([id, "image", "flat", ids[`${art}.png`]]);
		});
		// without their PNGs' IDs the ancient biome keeps its five looks (the plan's variant picks unchanged)
		const before = new ThemeCore(buildValeManifest(worldIds("lop-patch-blotch1.png", "lop-patch-blotch2.png")), {
			warn: quiet,
		});
		expect(before.decorVariants("biome.1", "patch").size()).toBe(VALE_PATCH_LOOKS.size());
	});

	it("the Kenney solid pieces and the runner (docs/KENNEY_DECOR.md KN9): rect cuts of one sheet, all or nothing", () => {
		const m = buildValeManifest(worldIds());
		const core = new ThemeCore(m, { warn: quiet });
		const ids = worldIds();
		for (const k of VALE_KENNEY_PIECES) {
			k.art.forEach((art, i) => {
				const id = decorId("biome.3", k.kind, k.first + i);
				const a = m.assets[id] as ImageAsset;
				const l = VALE_KENNEY_LAYOUTS[art];
				expect([id, a.kind, a.layer, a.assetId, a.rect]).toEqual([id, "image", k.layer, ids[l.file], l.rect]);
				expect([id, a.w, a.h, a.pivot, a.pixelsPerTile]).toEqual([id, l.w, l.h, l.pivot, 29.6]);
			});
			// every variant listed in order after the kit's (the runner after the throne carpet's four)
			expect([k.kind, core.decorVariants("biome.5", k.kind).size()]).toEqual([
				k.kind,
				k.first - 1 + k.art.size(),
			]);
		}
		// without the sheet's ID: none of them, the kit's carpet kept
		const without = buildValeManifest(worldIds(...VALE_KENNEY_SHEETS));
		expect(validateManifest(without, { packId: "vale" })).toEqual([]);
		const bare = new ThemeCore(without, { warn: quiet });
		for (const k of VALE_KENNEY_PIECES)
			expect([k.kind, bare.decorVariants("biome.1", k.kind).size()]).toEqual([k.kind, k.first - 1]);
	});

	it("void pieces (docs/VOID_DECOR.md VD6): flagstones map once the atlas has their art, every biome alike", () => {
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
		// the trial 3D kit (docs/DECOR.md "3D kits"): cages stand low and chains lie flat on the shoulder, two turns each,
		// every biome; absent until their PNGs have IDs
		const none = buildValeManifest(
			worldIds("kit-cage-1.png", "kit-cage-2.png", "kit-chains-1.png", "kit-chains-2.png"),
		);
		for (const b of BIOMES) {
			for (const p of VALE_VOID_KIND_PIECES) {
				const id = voidDecorId(b.id, p.voidKind, p.variant);
				expect([id, core.decor(id)?.layer]).toEqual([id, p.layer]);
				expect([id, none.assets[id]]).toEqual([id, undefined]);
			}
			expect(core.voidDecorVariants(b.id, "cage").size()).toBe(2);
			expect(core.voidDecorVariants(b.id, "chains").size()).toBe(2);
		}
		// the void's other pieces reuse the decor kinds' art: columns, stumps, debris (no wall props: VDD10)
		for (const kind of ["column", "columnBroken", "debris"] as const)
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
