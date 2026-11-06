// Roblox port (docs/DECOR.md R2, R13 contract half, R9 fx roles): the decor slot, breakable clutter and the decor fx
// colour roles. Contract helpers, the validator's decor / breakable checks and the runtime lookups.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
import { BREAKABLE_KINDS as SIM_BREAKABLE_KINDS } from "shared/dungeon";
import { BULLET_VIEW } from "shared/view";
import { colorDifference, contrastRatio } from "./color";
import { PACT } from "./fortune";
import {
	BIOMES,
	BOOST,
	BREAKABLE,
	BREAKABLE_AUDIO_EVENTS,
	BREAKABLE_KINDS,
	BREAKABLE_ROLES,
	DECOR,
	DECOR_BIOME_KEYS,
	DECOR_FX_NAMES,
	DECOR_FX_ROLES,
	DECOR_FX_TINT,
	DECOR_KINDS,
	DECOR_KIND_LAYERS,
	DECOR_LAYERS,
	DECOR_MAX_VARIANTS,
	DECOR_PARTICLE,
	ENEMY_BULLET_ROLES,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	MIN_ENEMY_BULLET_CONTRAST,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	WORLD_ART_SLOTS,
	PELLET,
	TREASURE,
	breakableId,
	decorAmbientId,
	decorAmbientRole,
	decorBiomeKey,
	decorFxId,
	decorId,
	parseDecorId,
	requiredBaseAnimations,
	slotFor,
	type DecorKind,
} from "./contract";
import { MISSING_COLOR, ThemeCore } from "./core";
import { ThemePack, hexToColor3 } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { PLACEHOLDER_VISUALS } from "./placeholders";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { breakableContrastReport, decorFxReport, isAssetId, isGameplayKey, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const assetsOf = (m: Obj) => m.assets as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;

/** Validator errors for the placeholder pack plus `assets`. */
function withAssets(assets: Obj): Array<string> {
	const m = clone();
	for (const id of sortedKeys(assets)) {
		assetsOf(m)[id] = assets[id];
	}
	return validateManifest(m);
}

/** `out` with `overrides` applied and the `omit` keys removed (a nil in a table literal is no key at all). */
function edited(out: Obj, overrides: Obj, omit: ReadonlyArray<string>): Obj {
	for (const k of sortedKeys(overrides)) {
		out[k] = overrides[k];
	}
	for (const k of omit) {
		out[k] = undefined;
	}
	return out;
}

/** A valid decor image: a wall torch sconce, 111x81, glowing at its cup. */
function torchImage(overrides: Obj = {}, ...omit: Array<string>): Obj {
	const out: Obj = {
		kind: "image",
		assetId: "rbxassetid://5001",
		w: 111,
		h: 81,
		pixelsPerTile: 32,
		layer: "wall",
		glow: true,
		glowAt: { x: 55, y: 10 },
	};
	return edited(out, overrides, omit);
}

/** A valid decor sprite set: a 16-facing round piece in 64x64 cells, `idle` only (one 1024x256 sheet, 64 cells). */
function rockSprites(overrides: Obj = {}, ...omit: Array<string>): Obj {
	const out: Obj = {
		kind: "sprites",
		frameW: 64,
		frameH: 64,
		pivot: { x: 32, y: 40 },
		pixelsPerTile: 32,
		resample: "Default",
		facings: { count: 16, zeroDeg: 0, ccw: true },
		sheets: [{ assetId: "rbxassetid://5002", w: 1024, h: 256 }],
		animations: { idle: { sheet: 0, start: 0, frames: 1, fps: 1, loop: true } },
		layer: "flat",
	};
	return edited(out, overrides, omit);
}

const sink = () => {
	const messages = new Array<string>();
	return { messages, warn: (m: string) => messages.push(m) };
};

// The Forge's PropKind values (shared/dungeon/forge/types.ts) plus `torch` (Dungeon.torches) and `arch`
// (Dungeon.arches): every one the web decor plan draws is a decor kind; chest and arch are never drawn.
const FORGE_PIECES = [
	"ring",
	"bossCrystal",
	"brazier",
	"chest",
	"shrineCrystal",
	"pillar",
	"grave",
	"sarco",
	"candle",
	"debris",
	"icicle",
	"shardIce",
	"roots",
	"moss",
	"bones",
	"crack",
	"banner",
	"torch",
	"arch",
];
const NEVER_DRAWN = ["chest", "arch"];

describe("decor contract", () => {
	it("adds two world-art slots: optional decor (no placeholder kind) and required breakables", () => {
		expect([DECOR.prefix, DECOR.kinds, DECOR.cell, DECOR.facings]).toEqual([
			"decor.",
			["image", "sprites"],
			undefined,
			[],
		]);
		expect([BREAKABLE.prefix, BREAKABLE.kinds, BREAKABLE.cell]).toEqual([
			"breakable.",
			["image", "sprites", "placeholder"],
			undefined,
		]);
		// (and the treasure rooms' chest and cage, docs/TREASURE.md TR6: treasure.spec.ts)
		// (and the boost drops' slot, docs/BOOSTS.md B5: boosts.spec.ts; the pellets', docs/PELLETS.md PL6: pellets.spec.ts;
		// the pact altar's, docs/FORTUNE.md FO6: fortune.spec.ts)
		expect(WORLD_ART_SLOTS).toEqual([DECOR, BREAKABLE, BOOST, PELLET, TREASURE, PACT]);
		expect(slotFor("decor.delve.b1.pillar")).toBe(DECOR);
		expect(slotFor("decor.fx.torch")).toBe(DECOR);
		expect(slotFor("breakable.crate")).toBe(BREAKABLE);
		// sprite sets in either slot need an `idle`
		expect(requiredBaseAnimations(DECOR)).toEqual(["idle"]);
		expect(requiredBaseAnimations(BREAKABLE)).toEqual(["idle"]);
		// no decor ID is required
		for (const id of REQUIRED_ASSET_IDS) {
			expect([id, slotFor(id) === DECOR]).toEqual([id, false]);
		}
	});

	it("lists every kind once, each with layers from DECOR_LAYERS", () => {
		expect(DECOR_LAYERS).toEqual(["flat", "low", "tall", "wall"]);
		expect(new Set(DECOR_KINDS).size()).toBe(DECOR_KINDS.size());
		expect([...DECOR_KINDS].sort()).toEqual(sortedKeys(DECOR_KIND_LAYERS));
		for (const kind of DECOR_KINDS) {
			const layers = DECOR_KIND_LAYERS[kind] as ReadonlyArray<string>;
			expect([kind, layers.size() > 0]).toEqual([kind, true]);
			for (const l of layers) {
				expect([kind, (DECOR_LAYERS as ReadonlyArray<string>).includes(l)]).toEqual([kind, true]);
			}
		}
	});

	it("covers every Forge piece the web decor plan draws, with the plan's placement", () => {
		const kinds = new Set<string>(DECOR_KINDS);
		for (const piece of FORGE_PIECES) {
			expect([piece, kinds.has(piece)]).toEqual([piece, !NEVER_DRAWN.includes(piece)]);
		}
		const layersOf = (k: DecorKind) => DECOR_KIND_LAYERS[k] as ReadonlyArray<string>;
		// tall pieces (on far-wall tops) and the far-wall dressing: tall or low, never on the open floor
		for (const k of [
			"brazier",
			"sarco",
			"pillar",
			"grave",
			"candle",
			"icicle",
			"shardIce",
			"wall",
			"wallBroken",
			"column",
			"columnBroken",
		] as const) {
			expect([k, layersOf(k)]).toEqual([k, ["tall", "low"]]);
		}
		// flat pieces lie where the Forge put them: flat only, so nothing on open floor can hide a bullet
		for (const k of [
			"debris",
			"bones",
			"crack",
			"moss",
			"roots",
			"ring",
			"bossCrystal",
			"shrineCrystal",
			"brokenBarrel",
			"brokenCrate",
		] as const) {
			expect([k, layersOf(k)]).toEqual([k, ["flat"]]);
		}
		expect([layersOf("torch"), layersOf("banner")]).toEqual([["wall"], ["wall"]]);
		// void dressing (docs/VOID_DECOR.md VD7): the flagstone patch lies flat; so does the scattered chandelier
		expect(layersOf("flagstones")).toEqual(["flat"]);
		expect(layersOf("chandelier")).toEqual(["flat"]);
		// solid decor stands on its own cells, low only (docs/DECOR.md "Solid decor")
		expect([layersOf("tomb"), layersOf("candelabrum")]).toEqual([["low"], ["low"]]);
	});

	it("names pieces decor.delve.b<n>.<kind>[.<v>] with a lowercase kind segment, round-tripping through parseDecorId", () => {
		expect(decorId("biome.1", "pillar")).toBe("decor.delve.b1.pillar");
		expect(decorId("biome.3", "shardIce")).toBe("decor.delve.b3.shardice");
		expect(decorId("biome.5", "bones", 2)).toBe("decor.delve.b5.bones.2");
		expect(DECOR_BIOME_KEYS.size()).toBe(BIOMES.size());
		BIOMES.forEach((b, i) => expect(decorBiomeKey(b.id)).toBe(`b${i + 1}`));
		expect(decorBiomeKey("biome.9")).toBe(undefined);
		for (const b of BIOMES) {
			for (const kind of DECOR_KINDS) {
				for (let v = 0; v <= DECOR_MAX_VARIANTS; v++) {
					const variant = v === 0 ? undefined : v;
					const id = decorId(b.id, kind, variant);
					expect([id, isAssetId(id)]).toEqual([id, true]);
					expect([id, parseDecorId(id)]).toEqual([
						id,
						{ type: "piece", biome: b.id, kind, variant, layers: DECOR_KIND_LAYERS[kind] },
					]);
				}
			}
		}
	});

	it("names effects decor.fx.<name> and ambient textures decor.fx.ambient.b<n>, with their colour roles", () => {
		expect(DECOR_FX_NAMES).toEqual(["torch", "flame", "glow", "glint", "zone", "loot"]);
		expect(decorFxId("torch")).toBe("decor.fx.torch");
		for (const name of DECOR_FX_NAMES) {
			expect(parseDecorId(decorFxId(name))).toEqual({ type: "fx", name });
			expect([name, DECOR_FX_ROLES.includes(DECOR_FX_TINT[name])]).toEqual([name, true]);
		}
		expect(DECOR_FX_TINT.torch).toBe("decor.fx.flame");
		expect(DECOR_FX_TINT.loot).toBe("decor.fx.glint");
		expect(decorAmbientId("biome.2")).toBe("decor.fx.ambient.b2");
		for (const b of BIOMES) {
			expect(parseDecorId(decorAmbientId(b.id))).toEqual({ type: "ambient", biome: b.id });
			expect([b.id, DECOR_FX_ROLES.includes(decorAmbientRole(b.id))]).toEqual([b.id, true]);
		}
		expect(DECOR_FX_ROLES.size()).toBe(4 + BIOMES.size());
		const roles = new Set<string>(COLOR_ROLES);
		for (const r of [...DECOR_FX_ROLES, ...ENEMY_BULLET_ROLES, ...BREAKABLE_ROLES]) {
			expect([r, roles.has(r)]).toEqual([r, true]);
		}
		expect(ENEMY_BULLET_ROLES).toEqual(["enemyBullet", "enemyBulletOutline"]);
	});

	it("rejects IDs outside the grammars", () => {
		for (const bad of [
			"decor.delve.b6.pillar",
			"decor.delve.b0.pillar",
			"decor.delve.b1.shardIce",
			"decor.delve.b1.chest",
			"decor.delve.b1.arch",
			// docs/BOOST_ART.md decision 2: gems are boost drops, never decor
			"decor.delve.b1.gems",
			"decor.delve.b3.gems.2",
			"decor.delve.b1.pillar.0",
			"decor.delve.b1.pillar.17",
			"decor.delve.b1.pillar.01",
			"decor.delve.b1.pillar.x",
			"decor.delve.b1.pillar.1.2",
			"decor.delve.b1",
			"decor.delve.biome1.pillar",
			"decor.fx.fire",
			"decor.fx.torch.1",
			"decor.fx.ambient",
			"decor.fx.ambient.b0",
			"decor.fx.ambient.b1.x",
			"decor.room.b1.pillar",
			"enemy.swarmer",
		]) {
			expect([bad, parseDecorId(bad)]).toEqual([bad, undefined]);
		}
	});

	it("caps ambient particles below the drawn enemy bullet (smaller, and never opaque)", () => {
		const bulletDiameterStuds = 2 * BULLET_VIEW.enemyDrawRadius * STUDS_PER_TILE;
		expect(DECOR_PARTICLE.maxSizeStuds).toBeLessThanOrEqual(bulletDiameterStuds / 2);
		expect(DECOR_PARTICLE.minTransparency).toBeGreaterThan(0);
		expect(DECOR_PARTICLE.defaultSizeStuds).toBeLessThanOrEqual(DECOR_PARTICLE.maxSizeStuds);
		expect(DECOR_PARTICLE.defaultTransparency).toBeGreaterThanOrEqual(DECOR_PARTICLE.minTransparency);
		expect(DECOR_PARTICLE.defaultTransparency).toBeLessThan(1);
	});

	it("mirrors the sim's breakable kinds exactly, in kind index order (shared/dungeon is the source of truth)", () => {
		expect(BREAKABLE_KINDS.size()).toBe(SIM_BREAKABLE_KINDS.size());
		for (let i = 0; i < SIM_BREAKABLE_KINDS.size(); i++)
			expect([i, BREAKABLE_KINDS[i]]).toEqual([i, SIM_BREAKABLE_KINDS[i]]);
	});

	it("requires both breakables (asset, colour role, name) and their audio events, like enemy.dummy", () => {
		expect(BREAKABLE_KINDS).toEqual(["barrel", "crate"]);
		expect(BREAKABLE_AUDIO_EVENTS).toEqual(["sfx.breakable.hit", "sfx.breakable.break"]);
		for (const kind of BREAKABLE_KINDS) {
			const id = breakableId(kind);
			expect(id).toBe(`breakable.${kind}`);
			expect([id, REQUIRED_ASSET_IDS.includes(id)]).toEqual([id, true]);
			expect([id, REQUIRED_STRING_KEYS.includes(`${id}.name`)]).toEqual([id, true]);
			expect([id, BREAKABLE_ROLES.includes(id)]).toEqual([id, true]);
		}
		for (const id of BREAKABLE_AUDIO_EVENTS) {
			expect([id, REQUIRED_ASSET_IDS.includes(id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
		}
	});

	it("keeps the new fields out of the gameplay-key scan", () => {
		for (const k of [
			"layer",
			"glow",
			"glowAt",
			"emissive",
			"rect",
			"pixelsPerTile",
			"particle",
			"sizeStuds",
			"transparency",
		]) {
			expect([k, isGameplayKey(k)]).toEqual([k, false]);
		}
	});
});

describe("validateManifest: decor pieces and effects", () => {
	it("every bundled pack ships no decor it cannot draw and validates clean", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			expect([id, validateManifest(THEME_PACKS[id], { packId: id })]).toEqual([id, []]);
		}
		for (const id of sortedKeys(PLACEHOLDER_MANIFEST.assets)) {
			expect([id, slotFor(id) === DECOR]).toEqual([id, false]);
		}
	});

	it("accepts images and sprite sets for pieces, effects and ambient textures", () => {
		expect(
			withAssets({
				"decor.delve.b1.torch": torchImage(),
				"decor.delve.b1.pillar": torchImage(
					{
						layer: "tall",
						w: 245,
						h: 186,
						rect: { x: 0, y: 0, w: 30, h: 95 },
						pivot: { x: 15, y: 90 },
						emissive: false,
					},
					"glow",
					"glowAt",
				),
				"decor.delve.b2.columnbroken": torchImage({ layer: "low" }, "glow", "glowAt"),
				"decor.delve.b4.bones.3": rockSprites(),
				"decor.delve.b4.bones": rockSprites({ glow: true, glowAt: { x: 64, y: 64 }, emissive: true }),
				"decor.fx.torch": torchImage({ emissive: true }, "layer"),
				"decor.fx.zone": rockSprites({}, "layer"),
				"decor.fx.ambient.b2": {
					kind: "image",
					assetId: "rbxassetid://5003",
					w: 32,
					h: 32,
					emissive: true,
					particle: { sizeStuds: DECOR_PARTICLE.maxSizeStuds, transparency: DECOR_PARTICLE.minTransparency },
				},
				"decor.fx.ambient.b3": { kind: "image", assetId: "rbxassetid://5004", w: 16, h: 16 },
			}),
		).toEqual([]);
	});

	it("rejects IDs outside the decor grammars (and skips their shape checks)", () => {
		const forms =
			"decor.delve.b<1..5>.<kind>[.<1..16>], " +
			"decor.void.b<1..5>.<spire|drift|vent|crag|grave|deadtree|root|bush|statue|cage|chains>[.<1..16>], " +
			"decor.fx.<torch|flame|glow|glint|zone|loot>, decor.fx.ambient.b<1..5>; " +
			"kinds: contract.ts DECOR_KINDS, lowercase; VOID_DECOR.kinds";
		expect(withAssets({ "decor.delve.b1.chest": torchImage(), "decor.fx.fire": { kind: "silent" } })).toEqual([
			`assets["decor.delve.b1.chest"]: unknown decor ID (use ${forms})`,
			`assets["decor.fx.fire"]: unknown decor ID (use ${forms})`,
		]);
	});

	it("has no placeholder kind: a pack leaves decor out instead", () => {
		expect(withAssets({ "decor.delve.b1.pillar": { kind: "placeholder" } })).toEqual([
			'assets["decor.delve.b1.pillar"].kind: slot "decor" accepts kind "image" | "sprites", got "placeholder"',
		]);
	});

	it("requires a piece's layer, one its kind allows; effects take none", () => {
		const P = 'assets["decor.delve.b1.debris"]';
		expect(withAssets({ "decor.delve.b1.debris": torchImage({}, "layer", "glow", "glowAt") })).toEqual([
			`${P}.layer: missing: a decor piece needs a layer ("debris": "flat")`,
		]);
		expect(withAssets({ "decor.delve.b1.debris": torchImage({ layer: "tall" }, "glow", "glowAt") })).toEqual([
			`${P}.layer: "tall" is not allowed for "debris" (allowed: flat)`,
		]);
		expect(withAssets({ "decor.delve.b1.debris": torchImage({ layer: "floor" }, "glow", "glowAt") })).toEqual([
			`${P}.layer: must be "flat" | "low" | "tall" | "wall", got "floor"`,
		]);
		expect(withAssets({ "decor.delve.b1.pillar": rockSprites({ layer: "wall" }) })).toEqual([
			'assets["decor.delve.b1.pillar"].layer: "wall" is not allowed for "pillar" (allowed: tall, low)',
		]);
		expect(withAssets({ "decor.fx.glow": torchImage() })).toEqual([
			'assets["decor.fx.glow"].layer: unknown key (allowed: kind, assetId, w, h, rect, pivot, pixelsPerTile, glow, glowAt, emissive)',
		]);
	});

	it("checks the world-art fields: size, pixelsPerTile, rect, pivot", () => {
		const P = 'assets["decor.delve.b1.torch"]';
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ w: 2048 }, "pixelsPerTile") })).toEqual([
			`${P}.w: must be an integer in [1, 1024]`,
			`${P}.pixelsPerTile: must be a number > 0 (art pixels per world tile)`,
		]);
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ pixelsPerTile: 0 }) })).toEqual([
			`${P}.pixelsPerTile: must be a number > 0 (art pixels per world tile)`,
		]);
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ rect: { x: 100, y: 0, w: 20, h: 20 } }) })).toEqual([
			`${P}.rect: (100, 0) 20x20 reaches outside the 111x81 image`,
		]);
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ rect: { x: -1, y: 0, w: 20, h: 20 } }) })).toEqual([
			`${P}.rect: must be { "x": int >= 0, "y": int >= 0, "w": int >= 1, "h": int >= 1 } in pixels of the image`,
		]);
		expect(
			withAssets({
				"decor.delve.b1.torch": torchImage({ rect: { x: 0, y: 0, w: 20, h: 20, z: 1 } }, "glowAt", "glow"),
			}),
		).toEqual([`${P}.rect.z: unknown key (allowed: x, y, w, h)`]);
		// the pivot and glowAt are measured in the rect when there is one
		expect(
			withAssets({
				"decor.delve.b1.torch": torchImage({ rect: { x: 10, y: 10, w: 40, h: 40 }, pivot: { x: 41, y: 40 } }),
			}),
		).toEqual([
			`${P}.pivot: (41, 40) is outside the 40x40 rect`,
			`${P}.glowAt: (55, 10) is outside the 40x40 rect`,
		]);
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ pivot: { x: 1 } }) })).toEqual([
			`${P}.pivot: must be { "x": number, "y": number } in pixels from the image top-left`,
		]);
	});

	it("checks glow, glowAt and emissive", () => {
		const P = 'assets["decor.delve.b1.torch"]';
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ glow: false }) })).toEqual([
			`${P}.glowAt: only a glowing piece (glow: true) has a glowAt`,
		]);
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ glow: "yes", emissive: 1 }, "glowAt") })).toEqual([
			`${P}.glow: must be true or false`,
			`${P}.emissive: must be true or false`,
		]);
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ glowAt: { x: 200, y: 0 } }) })).toEqual([
			`${P}.glowAt: (200, 0) is outside the 111x81 image`,
		]);
		expect(withAssets({ "decor.delve.b4.bones": rockSprites({ glow: true, glowAt: { x: 65, y: 0 } }) })).toEqual([
			'assets["decor.delve.b4.bones"].glowAt: (65, 0) is outside the 64x64 cell',
		]);
	});

	it("holds sprite sets to the v2 checks plus an idle animation", () => {
		expect(
			withAssets({
				"decor.delve.b4.bones": rockSprites({
					animations: { lit: { sheet: 0, start: 0, frames: 1, fps: 1, loop: true } },
				}),
			}),
		).toEqual([
			'assets["decor.delve.b4.bones"].animations: sprite contract: missing animation "idle" (>= 1 frame)',
		]);
		expect(withAssets({ "decor.delve.b4.bones": rockSprites({ particle: {} }) })).toEqual([
			'assets["decor.delve.b4.bones"].particle: unknown key (allowed: kind, frameW, frameH, pivot, pixelsPerTile, ' +
				"resample, facings, sheets, animations, layer, glow, glowAt, emissive, outlines)",
		]);
	});

	it("checks piece outlines: >= 3 points inside the rect / cell, one per facing for sprite sets", () => {
		const P = 'assets["decor.delve.b1.torch"]';
		const tri = [
			{ x: 0, y: 81 },
			{ x: 111, y: 81 },
			{ x: 55, y: 0 },
		];
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ outline: tri }) })).toEqual([]);
		expect(withAssets({ "decor.delve.b1.torch": torchImage({ outline: [tri[0], tri[1]] }) })).toEqual([
			`${P}.outline: must be an array of at least 3 points { "x", "y" } in pixels of the image`,
		]);
		expect(
			withAssets({
				"decor.delve.b1.torch": torchImage({
					rect: { x: 0, y: 0, w: 60, h: 81 },
					glowAt: { x: 30, y: 10 },
					outline: tri,
				}),
			}),
		).toEqual([`${P}.outline[1]: (111, 81) is outside the 60x81 rect`]);
		expect(withAssets({ "decor.fx.glow": torchImage({ outline: tri }, "layer") })).toEqual([
			'assets["decor.fx.glow"].outline: unknown key (allowed: kind, assetId, w, h, rect, pivot, pixelsPerTile, glow, glowAt, emissive)',
		]);
		const B = 'assets["decor.delve.b4.bones"]';
		const square = [
			{ x: 0, y: 0 },
			{ x: 64, y: 0 },
			{ x: 64, y: 64 },
			{ x: 0, y: 64 },
		];
		const perFacing = new Array<typeof square>();
		for (let d = 0; d < 16; d++) perFacing.push(square);
		expect(withAssets({ "decor.delve.b4.bones": rockSprites({ outlines: perFacing }) })).toEqual([]);
		expect(withAssets({ "decor.delve.b4.bones": rockSprites({ outlines: [square] }) })).toEqual([
			`${B}.outlines: must be an array of one outline per facing (16)`,
		]);
		const bad = [...perFacing];
		bad[3] = [square[0], square[1], { x: 65, y: 1 }];
		expect(withAssets({ "decor.delve.b4.bones": rockSprites({ outlines: bad }) })).toEqual([
			`${B}.outlines[3][2]: (65, 1) is outside the 64x64 cell`,
		]);
		expect(withAssets({ "decor.delve.b4.bones": rockSprites({ outline: square }) })).toEqual([
			`${B}.outline: unknown key (allowed: kind, frameW, frameH, pivot, pixelsPerTile, resample, facings, sheets, ` +
				"animations, layer, glow, glowAt, emissive, outlines)",
		]);
	});

	it("holds ambient textures to DECOR_PARTICLE: images only, smaller and fainter than bullets", () => {
		const P = 'assets["decor.fx.ambient.b1"]';
		const ambient = (extra: Obj) => {
			const out: Obj = { kind: "image", assetId: "rbxassetid://5005", w: 32, h: 32 };
			for (const k of sortedKeys(extra)) out[k] = extra[k];
			return out;
		};
		expect(withAssets({ "decor.fx.ambient.b1": ambient({ particle: { sizeStuds: 2, transparency: 0 } }) })).toEqual(
			[
				`${P}.particle.sizeStuds: must be a number in (0, 0.6] (studs: ambient particles stay smaller than bullets)`,
				`${P}.particle.transparency: must be a number in [0.4, 1] (ambient particles stay fainter than bullets)`,
			],
		);
		expect(withAssets({ "decor.fx.ambient.b1": ambient({ particle: { size: 0.2 }, pixelsPerTile: 32 }) })).toEqual([
			`${P}.pixelsPerTile: unknown key (allowed: kind, assetId, w, h, particle, emissive)`,
			`${P}.particle.size: unknown key (allowed: sizeStuds, transparency, flipbook)`,
		]);
		expect(withAssets({ "decor.fx.ambient.b1": ambient({ particle: 0.2 }) })).toEqual([
			`${P}.particle: must be { "sizeStuds"?: number, "transparency"?: number, "flipbook"?: { grid, fps, mode } }`,
		]);
		expect(withAssets({ "decor.fx.ambient.b1": rockSprites({}, "layer") })).toEqual([
			`${P}.kind: decor.fx.ambient.* is a particle texture: kind "image", got "sprites"`,
		]);
	});
});

describe("validateManifest: breakables", () => {
	const crateImage = (overrides: Obj = {}, ...omit: Array<string>): Obj =>
		edited({ kind: "image", assetId: "rbxassetid://6001", w: 41, h: 28, pixelsPerTile: 30 }, overrides, omit);

	it("requires both kinds, their names and sounds", () => {
		const m = clone();
		assetsOf(m)["breakable.crate"] = undefined;
		assetsOf(m)["sfx.breakable.break"] = undefined;
		(m.strings as Obj)["breakable.barrel.name"] = undefined;
		colorsOf(m)["breakable.barrel"] = undefined;
		expect(validateManifest(m)).toEqual([
			'strings: missing required string "breakable.barrel.name"',
			'colors: missing color role "breakable.barrel"',
			'assets: missing required asset "breakable.crate" (slot breakable)',
			'assets: missing required asset "sfx.breakable.break" (slot sfx)',
		]);
	});

	it("accepts a placeholder, an image with pixelsPerTile, or a sprite set with idle (and shatter)", () => {
		const shattering = rockSprites({}, "layer");
		(shattering.animations as Obj).shatter = { sheet: 0, start: 16, frames: 1, fps: 12, loop: false };
		expect(
			withAssets({
				"breakable.crate": crateImage({ pivot: { x: 20.5, y: 28 }, rect: { x: 0, y: 0, w: 41, h: 28 } }),
				"breakable.barrel": shattering,
			}),
		).toEqual([]);
	});

	it("rejects decor fields and a missing density", () => {
		expect(withAssets({ "breakable.crate": crateImage({ layer: "low" }, "pixelsPerTile") })).toEqual([
			'assets["breakable.crate"].layer: unknown key (allowed: kind, assetId, w, h, rect, pivot, pixelsPerTile)',
			'assets["breakable.crate"].pixelsPerTile: must be a number > 0 (art pixels per world tile)',
		]);
		expect(withAssets({ "breakable.crate": rockSprites() })).toEqual([
			'assets["breakable.crate"].layer: unknown key (allowed: kind, frameW, frameH, pivot, pixelsPerTile, resample, ' +
				"facings, sheets, animations)",
		]);
	});
});

describe("validateManifest: decor fx and breakable colours", () => {
	it("the bundled packs keep every fx role far from both enemy-bullet roles", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const report = decorFxReport(THEME_PACKS[id]);
			expect([id, report.size()]).toEqual([id, DECOR_FX_ROLES.size() * ENEMY_BULLET_ROLES.size()]);
			for (const e of report) {
				expect([id, e.role, e.against, e.ok]).toEqual([id, e.role, e.against, true]);
				expect(e.difference).toBe(colorDifference(e.color, e.againstColor));
				expect(e.min).toBe(MIN_DECOR_FX_BULLET_DIFFERENCE);
			}
		}
	});

	it("reports an fx colour too close to an enemy-bullet colour", () => {
		const m = clone();
		colorsOf(m)["decor.fx.glow"] = "#ff40a0";
		colorsOf(m)["decor.fx.ambient.b4"] = "#200812";
		const d1 = colorDifference("#ff40a0", "#ff3fa4");
		const d2 = colorDifference("#200812", "#1a0610");
		expect(validateManifest(m)).toEqual([
			`colors["decor.fx.glow"]: colour difference: decor.fx.glow #ff40a0 vs enemyBullet #ff3fa4 is ${"%.1f".format(
				d1,
			)} (CIE76), needs >= 40.0: decor fx must never read as an enemy bullet`,
			`colors["decor.fx.ambient.b4"]: colour difference: decor.fx.ambient.b4 #200812 vs enemyBulletOutline #1a0610 is ${"%.1f".format(
				d2,
			)} (CIE76), needs >= 40.0: decor fx must never read as an enemy bullet`,
		]);
	});

	it("keeps enemy bullets readable on every breakable colour", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const report = breakableContrastReport(THEME_PACKS[id]);
			expect(report.size()).toBe(BREAKABLE_ROLES.size());
			for (const e of report) {
				expect([id, e.role, e.ok]).toEqual([id, e.role, true]);
			}
		}
		const m = clone();
		colorsOf(m)["breakable.crate"] = "#c8a060";
		const ratio = contrastRatio("#ff3fa4", "#c8a060");
		expect(ratio).toBeLessThan(MIN_ENEMY_BULLET_CONTRAST);
		expect(validateManifest(m)).toEqual([
			`colors["breakable.crate"]: contrast: enemyBullet #ff3fa4 on breakable.crate #c8a060 is ${"%.2f".format(
				ratio,
			)}:1, needs >= 3.0:1`,
		]);
	});
});

describe("ThemeCore / ThemePack: decor lookups", () => {
	it("the placeholder pack draws no decor and never warns about it", () => {
		const w = sink();
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: w.warn });
		for (const b of BIOMES) {
			for (const kind of DECOR_KINDS) {
				expect(pack.decorVariants(b.id, kind)).toEqual([]);
			}
			expect(pack.ambient(b.id)).toBe(undefined);
		}
		for (const name of DECOR_FX_NAMES) {
			expect(pack.decor(decorFxId(name))).toBe(undefined);
		}
		expect(w.messages).toEqual([]);
	});

	function decorManifest(): Obj {
		const m = clone();
		const a = assetsOf(m);
		a["decor.delve.b1.torch"] = torchImage();
		a["decor.delve.b1.pillar"] = torchImage(
			{ layer: "tall", w: 245, h: 186, rect: { x: 4, y: 8, w: 30, h: 95 } },
			"glow",
			"glowAt",
		);
		a["decor.delve.b1.debris"] = torchImage({ layer: "flat" }, "glow", "glowAt");
		a["decor.delve.b1.debris.1"] = rockSprites();
		a["decor.delve.b1.debris.3"] = torchImage({ layer: "flat", pivot: { x: 1, y: 2 } }, "glow", "glowAt");
		a["decor.fx.flame"] = rockSprites({ glow: true, emissive: true }, "layer");
		a["decor.fx.ambient.b2"] = {
			kind: "image",
			assetId: "rbxassetid://5003",
			w: 32,
			h: 32,
			emissive: true,
			particle: { sizeStuds: 0.5 },
		};
		return m;
	}

	it("resolves image pieces with their layer, rect and defaulted pivot / glowAt", () => {
		const w = sink();
		const core = new ThemeCore(decorManifest(), { warn: w.warn });
		expect(core.decor("decor.delve.b1.torch")).toEqual({
			id: "decor.delve.b1.torch",
			layer: "wall",
			glow: true,
			glowAt: { x: 55, y: 10 },
			emissive: false,
			art: {
				kind: "image",
				assetId: "rbxassetid://5001",
				w: 111,
				h: 81,
				rect: { x: 0, y: 0, w: 111, h: 81 },
				pivot: { x: 55.5, y: 81 }, // standing art: bottom centre
				pixelsPerTile: 32,
			},
		});
		const pillar = core.decor("decor.delve.b1.pillar")!;
		expect([pillar.layer, pillar.glow, pillar.glowAt]).toEqual(["tall", false, { x: 15, y: 95 }]);
		expect(pillar.art).toMatchObject({
			kind: "image",
			rect: { x: 4, y: 8, w: 30, h: 95 },
			pivot: { x: 15, y: 95 },
		});
		// flat art defaults to its centre
		expect(core.decor("decor.delve.b1.debris")!.art).toMatchObject({ pivot: { x: 55.5, y: 40.5 } });
		expect(w.messages).toEqual([]);
	});

	it("lists a kind's variants in ID order and resolves sprite pieces through the sprite-set layout", () => {
		const core = new ThemeCore(decorManifest(), { warn: () => undefined });
		const variants = core.decorVariants("biome.1", "debris");
		expect(variants.map((v) => v.id)).toEqual([
			"decor.delve.b1.debris",
			"decor.delve.b1.debris.1",
			"decor.delve.b1.debris.3",
		]);
		const rock = variants[1];
		expect(rock.art.kind).toBe("sprites");
		if (rock.art.kind === "sprites") {
			expect(rock.art.set).toBe(core.sprites("decor.delve.b1.debris.1"));
			expect(rock.art.set.frame("idle", 3, 0)).toMatchObject({ x: 192, y: 0, w: 64, h: 64 });
		}
		expect(rock.glowAt).toEqual({ x: 32, y: 40 });
		expect(core.decorVariants("biome.2", "debris")).toEqual([]);
		// effects: no layer
		const flame = core.decor("decor.fx.flame")!;
		expect([flame.layer, flame.glow, flame.emissive, flame.glowAt]).toEqual([
			undefined,
			true,
			true,
			{ x: 32, y: 40 },
		]);
	});

	it("resolves outlines per facing (an image's one serves all); a malformed one falls back to the rectangle", () => {
		const m = decorManifest();
		const tri = [
			{ x: 0, y: 81 },
			{ x: 111, y: 81 },
			{ x: 55, y: 0 },
		];
		assetsOf(m)["decor.delve.b1.torch"] = torchImage({ outline: tri });
		const facings = new Array<typeof tri>();
		for (let d = 0; d < 16; d++) facings.push(d === 5 ? [tri[2], tri[1], tri[0]] : tri);
		assetsOf(m)["decor.delve.b1.debris.1"] = rockSprites({ outlines: facings });
		assetsOf(m)["decor.delve.b1.debris.3"] = rockSprites({ outlines: [tri] });
		const w = sink();
		const core = new ThemeCore(m, { warn: w.warn });
		expect(core.decor("decor.delve.b1.torch")!.outlines).toEqual([tri]);
		const rock = core.decor("decor.delve.b1.debris.1")!;
		expect(rock.outlines!.size()).toBe(16);
		expect(rock.outlines![5]).toEqual([tri[2], tri[1], tri[0]]);
		expect(core.decor("decor.delve.b1.debris.3")!.outlines).toBe(undefined);
		expect(core.decor("decor.delve.b1.pillar")!.outlines).toBe(undefined);
		expect(w.messages).toEqual([
			'[theme:placeholder] decor "decor.delve.b1.debris.3" has a malformed outline, held by its rectangle instead',
		]);
	});

	it("does not draw a piece too malformed to draw, warning once", () => {
		const m = decorManifest();
		assetsOf(m)["decor.delve.b1.debris"] = torchImage({ layer: "tall" });
		assetsOf(m)["decor.delve.b1.torch"] = torchImage({ rect: { x: 0, y: 0, w: 500, h: 10 } });
		assetsOf(m)["decor.fx.glint"] = { kind: "silent" };
		const w = sink();
		const core = new ThemeCore(m, { warn: w.warn });
		expect(core.decor("decor.delve.b1.debris")).toBe(undefined);
		expect(core.decor("decor.delve.b1.debris")).toBe(undefined);
		expect(core.decor("decor.delve.b1.torch")).toBe(undefined);
		expect(core.decor("decor.fx.glint")).toBe(undefined);
		expect(w.messages).toEqual([
			'[theme:placeholder] decor "decor.delve.b1.debris" has layer "tall", debris allows flat; not drawn',
			'[theme:placeholder] art "decor.delve.b1.torch" is malformed (rect outside the image), not drawn',
			'[theme:placeholder] decor "decor.fx.glint" is a silent, not an image or sprites; not drawn',
		]);
	});

	it("resolves ambient particles, defaulted and clamped to DECOR_PARTICLE", () => {
		const m = decorManifest();
		const core = new ThemeCore(m, { warn: () => undefined });
		expect(core.ambient("biome.2")).toEqual({
			id: "decor.fx.ambient.b2",
			assetId: "rbxassetid://5003",
			sizeStuds: 0.5,
			transparency: DECOR_PARTICLE.defaultTransparency,
			emissive: true,
			role: "decor.fx.ambient.b2",
		});
		expect(core.ambient("biome.1")).toBe(undefined);
		// a pack that failed validation still cannot draw a particle bigger or more opaque than the caps
		(assetsOf(m)["decor.fx.ambient.b2"] as Obj).particle = { sizeStuds: 9, transparency: 0 };
		const loose = new ThemeCore(m, { warn: () => undefined }).ambient("biome.2")!;
		expect([loose.sizeStuds, loose.transparency]).toEqual([
			DECOR_PARTICLE.maxSizeStuds,
			DECOR_PARTICLE.minTransparency,
		]);
	});

	it("ThemePack wraps decor with Roblox types, cached", () => {
		const pack = new ThemePack(decorManifest(), { warn: () => undefined });
		const pillar = pack.decor("decor.delve.b1.pillar")!;
		expect(pack.decor("decor.delve.b1.pillar")).toBe(pillar);
		expect(pillar.art.kind).toBe("image");
		if (pillar.art.kind === "image") {
			expect(pillar.art.image).toBe("rbxassetid://5001");
			expect([pillar.art.offset.X, pillar.art.offset.Y, pillar.art.size.X, pillar.art.size.Y]).toEqual([
				4, 8, 30, 95,
			]);
			expect(pillar.art.pixelsPerTile).toBe(32);
		}
		const rock = pack.decorVariants("biome.1", "debris")[1];
		expect(rock.art.kind).toBe("sprites");
		if (rock.art.kind === "sprites") {
			expect(rock.art.set).toBe(pack.sprites("decor.delve.b1.debris.1"));
		}
		expect(pack.decor("decor.delve.b5.pillar")).toBe(undefined);
		const ambient = pack.ambient("biome.2")!;
		expect(ambient.color).toBe(pack.color("decor.fx.ambient.b2"));
		expect(ambient.color).toEqual(hexToColor3(PLACEHOLDER_MANIFEST.colors["decor.fx.ambient.b2"]));
	});
});

describe("ThemeCore / ThemePack: breakables", () => {
	it("draws the placeholder pack's breakables as low boxes in their roles, with names, without warnings", () => {
		const w = sink();
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: w.warn });
		for (const kind of BREAKABLE_KINDS) {
			const b = pack.breakable(kind);
			expect(pack.breakable(kind)).toBe(b);
			expect([b.id, b.nameKey, b.art]).toEqual([`breakable.${kind}`, `breakable.${kind}.name`, undefined]);
			expect(b.placeholder).toBe(PLACEHOLDER_VISUALS[b.id]);
			expect(b.placeholder.color).toEqual({ kind: "role", role: b.id });
			expect(b.color).toEqual(hexToColor3(PLACEHOLDER_MANIFEST.colors[b.core.role]));
			expect(pack.str(b.nameKey)).never.toBe(b.nameKey);
		}
		expect(pack.str("breakable.crate.name")).toBe("Crate");
		for (const id of BREAKABLE_AUDIO_EVENTS) {
			expect(pack.sound(id)).toEqual({ assetId: undefined, volume: 0, group: "sfx", variants: [] });
		}
		expect(w.messages).toEqual([]);
	});

	it("draws uploaded art when there is some, and warns once (magenta) when the pack lacks the ID", () => {
		const m = clone();
		assetsOf(m)["breakable.crate"] = {
			kind: "image",
			assetId: "rbxassetid://6001",
			w: 41,
			h: 28,
			pixelsPerTile: 30,
		};
		assetsOf(m)["breakable.barrel"] = undefined;
		const w = sink();
		const pack = new ThemePack(m, { warn: w.warn });
		const crate = pack.breakable("crate");
		expect(crate.art).toMatchObject({
			kind: "image",
			image: "rbxassetid://6001",
			pixelsPerTile: 30,
			pivot: { x: 20.5, y: 28 },
		});
		const barrel = pack.breakable("barrel");
		expect(barrel.art).toBe(undefined);
		expect(barrel.placeholder.color).toEqual({ kind: "missing" });
		expect(pack.visualHex(barrel.placeholder.color)).toBe(MISSING_COLOR);
		expect(w.messages).toEqual(['[theme:placeholder] missing asset "breakable.barrel", using the placeholder']);
	});
});
