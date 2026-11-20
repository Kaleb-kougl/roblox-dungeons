/**
 * The theme contract's decor grammar (docs/CODEBASE_SCALE.md DX8: a pure move out of contract.ts): layers, kinds, biome keys, decor / void / fx IDs and the particle contract.
 *
 * @module
 */
import type { ColorRole, ParticleFlipbookMode } from "../types";
import { BIOMES, type BiomeId } from "./ids";

// ---------------------------------------------------------------------------------------------
// Decor (Roblox port, docs/DECOR.md R2 and Phase 2 part 2): the web build's DECOR slot
//
//   decor.delve.b<n>.<kind>[.<v>]   a decoration piece for biome n (b1..b5 = biome.1..5), optional variant v
//   decor.void.b<n>.<kind>[.<v>]    a void art piece for biome n (docs/VOID_DECOR.md VD7, VOID_DECOR kinds)
//   decor.fx.<torch|flame|glow|glint|zone>   biome-independent effects drawn on pieces / the stairwell
//   decor.fx.ambient.b<n>           biome n's ambient particle texture
//
// Every decor ID is optional; a pack draws exactly the pieces it has art for.

/**
 * How a decor piece is drawn and where the decor plan may put it: `flat` lies on the floor (a decal), `low` stands
 * but is short, `tall` stands tall (only on far-wall tops, under the footprint rule), `wall` hangs on a visible wall
 * face.
 */
export const DECOR_LAYERS = ["flat", "low", "tall", "wall"] as const;
/**
 * A decor layer's name (a DECOR_LAYERS entry): the `layer` a decor asset declares, and what the validator checks
 * against the layers its kind allows.
 */
export type DecorLayer = (typeof DECOR_LAYERS)[number];

const TALL_SPOT = ["tall", "low"] as const;
const FLAT_SPOT = ["flat"] as const;
const WALL_SPOT = ["wall"] as const;

/**
 * Decor piece kinds and the layers a pack may draw each in. The kinds are the Dungeon Forge pieces the web build's
 * decor plan draws (`PropKind`, plus `torch` from `Dungeon.torches`; `chest` and `arch` are never drawn), the far-wall
 * dressing (R6: `wall` / `wallBroken` segments, `column` / `columnBroken`) and the flat decals a broken barrel / crate
 * leaves (`brokenBarrel`, `brokenCrate`). No `gems` kind (docs/BOOST_ART.md decision 2: a gem cluster on the floor
 * always means a boost drop; no plan source ever placed one). Readability: a kind the plan places as a
 * tall piece (on far-wall tops) may be drawn tall or low; a flat kind (where the Forge put it, on open floor) only
 * flat, so no pack can stand art up where it could hide a bullet; torches and banners hang on walls.
 */
export const DECOR_KIND_LAYERS = {
	// tall pieces, in the web plan's priority order
	brazier: TALL_SPOT,
	sarco: TALL_SPOT,
	pillar: TALL_SPOT,
	grave: TALL_SPOT,
	candle: TALL_SPOT,
	icicle: TALL_SPOT,
	shardIce: TALL_SPOT,
	// far-wall dressing (R6)
	wall: TALL_SPOT,
	wallBroken: TALL_SPOT,
	column: TALL_SPOT,
	columnBroken: TALL_SPOT,
	// flat pieces
	debris: FLAT_SPOT,
	bones: FLAT_SPOT,
	crack: FLAT_SPOT,
	moss: FLAT_SPOT,
	roots: FLAT_SPOT,
	ring: FLAT_SPOT,
	bossCrystal: FLAT_SPOT,
	shrineCrystal: FLAT_SPOT,
	brokenBarrel: FLAT_SPOT,
	brokenCrate: FLAT_SPOT,
	// wall pieces
	torch: WALL_SPOT,
	banner: WALL_SPOT,
	// void dressing (docs/VOID_DECOR.md VD7): the Lords of Pain `tiles` flagstone patch on shoulder tops near rooms. No
	// wall prop dresses the void (VDD10: the `curb` kind, wall1, was removed).
	flagstones: FLAT_SPOT,
	// scattered (docs/DECOR.md "3D kits"): no Forge piece; the decor plan lays at most one per room on open floor,
	// only when the pack has art for it (a fallen chandelier)
	chandelier: FLAT_SPOT,
	// solid decor (docs/DECOR.md "Solid decor"): standing on their own WALL cells in rooms (Dungeon.solidDecor), low
	// only; a tomb's variant 1 lies along X, 2 along Z
	tomb: ["low"] as const,
	candelabrum: ["low"] as const,
	// room themes (docs/DECOR.md "Room themes"): the boss room's throne on its dais and the statue on its base (solid,
	// low; variant 1 faces +X, 2 faces +Z), and the throne's carpet (flat, walkable; variants 1 / 2 a 2 x 2 segment
	// along X / Z, 3 / 4 the end along X / Z); a library's runner (1 wide, docs/KENNEY_DECOR.md KN9) takes variants 5 / 6
	// (a 2 x 1 segment along X / Z) and 7-10 (the end of a runner running toward +X / +Z / -X / -Z)
	throne: ["low"] as const,
	statue: ["low"] as const,
	carpet: FLAT_SPOT,
	// bookcases (docs/BOOKSHELVES.md): solid, 1 x 1, against far walls (library and hall rooms), low; variants in facing
	// pairs, the odd one facing +X, the even one +Z: 1 / 2 the primary art, 3 / 4 .. an alternative set picked per room
	// (docs/KENNEY_DECOR.md, decorPlan's bookcaseVariant)
	bookcase: ["low"] as const,
	// a library's reading area (docs/BOOKSHELVES.md): solid, free-standing on open floor, low; a table (2 x 1, variant 1
	// along X, 2 along Z) with a chair (1 x 1) at each end, variant 1 facing +X, 2 +Z, 3 -X, 4 -Z (toward the table)
	table: ["low"] as const,
	chair: ["low"] as const,
	// a wide bookcase (docs/KENNEY_DECOR.md KN3): two neighbouring bookcase cells of a run drawn as one case
	// (presentation only; the Forge's pieces stay 1 x 1), low; variants in facing pairs like the bookcase's (odd +X,
	// even +Z), 1 / 2 the full case, 3 / 4 .. the other looks (decorPlan's bookcasePairs / wideBookcaseVariant)
	bookcaseWide: ["low"] as const,
	// a floor patch (docs/KENNEY_DECOR.md KN4): planks or dirt worn into 2 x 2 tiles of open floor, flat, walkable;
	// laid by the decor plan itself (no Forge piece), its variants any look (picked per block by hash)
	patch: FLAT_SPOT,
	// Kenney solid pieces (docs/KENNEY_DECOR.md KN9), standing on their own WALL cells (Dungeon.solidDecor). Library: a
	// study table (2 x 2; variants in axis pairs, odd along X, even along Z: 1 / 2 with books, 3 / 4 plain, 5 / 6 with a
	// cloth), a display case (2 x 1; axis pairs: case, books, open, sword), a lectern (1 x 1; 1-4 the open book facing
	// +X / +Z / -X / -Z, 5-8 the same empty) and a toppled case (2 x 1, axis pair). Mess hall: a dining table (1 x 1;
	// 1-6 whole, 7 / 8 broken). Stores: a barrel stack (2 x 1, axis pair), crate stack, lumber pile and lying barrels
	// (1 x 1; 1 facing +-X, 2 facing +-Z) and the stockpile (2 x 2 under a scaffold, tall; 1 facing +-X, 2 +-Z). All
	// low but the stockpile. A library's candle stand (presentation only: the decor plan draws a library room's
	// `candelabrum` as this kind when the pack has it; low, any variant by hash)
	studyTable: ["low"] as const,
	display: ["low"] as const,
	lectern: ["low"] as const,
	fallenShelf: ["low"] as const,
	diningTable: ["low"] as const,
	barrelStack: ["low"] as const,
	crateStack: ["low"] as const,
	lumber: ["low"] as const,
	barrelHeap: ["low"] as const,
	stockpile: ["tall"] as const,
	libraryCandle: ["low"] as const,
} as const satisfies Record<string, ReadonlyArray<DecorLayer>>;
/**
 * A decor piece kind (a key of DECOR_KIND_LAYERS), spelled as the decor plan names it (camelCase). Its lowercase form
 * is the kind segment of `decor.delve.b<n>.<kind>`.
 */
export type DecorKind = keyof typeof DECOR_KIND_LAYERS;

/** DECOR_KIND_LAYERS' kinds in declaration order (Luau tables have no key order). */
export const DECOR_KINDS: ReadonlyArray<DecorKind> = [
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
	"torch",
	"banner",
	"flagstones",
	"chandelier",
	"tomb",
	"candelabrum",
	"throne",
	"statue",
	"carpet",
	"bookcase",
	"table",
	"chair",
	"bookcaseWide",
	"patch",
	"studyTable",
	"display",
	"lectern",
	"fallenShelf",
	"diningTable",
	"barrelStack",
	"crateStack",
	"lumber",
	"barrelHeap",
	"stockpile",
	"libraryCandle",
];

/**
 * Roblox port (docs/VOID_DECOR.md VD7, VDD3): optional per-biome void art, `decor.void.b<n>.<kind>[.<v>]`, drawn on the
 * void's shoulder (or rising from the abyss) only when a pack fills it, under the same footprint rule as every void
 * piece. No pack has to; any kind is accepted in any biome (the plan's biome wishes, frost spire / drift, molten vent /
 * crag, grim grave / deadtree, verdant root / bush, ancient statue, are art direction, not rules). Layers per kind
 * (`layers`): the standing tall shapes (spire, crag, deadtree, statue, grave) may be drawn tall or low, like the decor
 * plan's far-wall pieces; the short ones (vent, bush, root) low only; a snow drift lies flat. Trial 3D kit (docs/DECOR.md
 * "3D kits"): a `cage` stands low (the box of a column stump), lying `chains` are flat. One table (kinds in
 * declaration order, layers, ID prefix), so this module's compiled Luau gains one local (it sits near Luau's 200).
 */
export const VOID_DECOR = {
	prefix: "decor.void.",
	kinds: ["spire", "drift", "vent", "crag", "grave", "deadtree", "root", "bush", "statue", "cage", "chains"],
	layers: {
		spire: TALL_SPOT,
		drift: FLAT_SPOT,
		vent: ["low"],
		crag: TALL_SPOT,
		grave: TALL_SPOT,
		deadtree: TALL_SPOT,
		root: ["low"],
		bush: ["low"],
		statue: TALL_SPOT,
		cage: ["low"],
		chains: FLAT_SPOT,
	},
} as const satisfies {
	prefix: string;
	kinds: ReadonlyArray<string>;
	layers: Record<string, ReadonlyArray<DecorLayer>>;
};
/** A void art kind (a VOID_DECOR.kinds entry): the kind segment of `decor.void.b<n>.<kind>`. */
export type VoidDecorKind = (typeof VOID_DECOR.kinds)[number];

/**
 * A piece may have numbered variants `decor.delve.b<n>.<kind>.<v>`, v in 1..DECOR_MAX_VARIANTS (bones1..3, ...). 16 since
 * docs/KENNEY_DECOR.md: the bookcase's eight facing pairs (the kit case and seven Kenney cases).
 */
export const DECOR_MAX_VARIANTS = 16;

/** A piece's outline (ImageAsset.outline, SpriteSetAsset.outlines) is a polygon: at least this many points. */
export const DECOR_MIN_OUTLINE_POINTS = 3;

/** The biome segment of decor IDs: b1..b5 = biome.1..biome.5 (BIOMES order). */
export const DECOR_BIOME_KEYS = ["b1", "b2", "b3", "b4", "b5"] as const;
/**
 * The biome segment of a decor or ambience ID (`b1` .. `b5`, a DECOR_BIOME_KEYS entry); `decorBiomeKey` maps a biome ID
 * to it.
 */
export type DecorBiomeKey = (typeof DECOR_BIOME_KEYS)[number];

/** Every decor ID starts with this (the DECOR slot's prefix). */
export const DECOR_PREFIX = "decor.";
/** Every decor piece ID starts with this; the biome key, the kind and an optional variant follow (`decorId`). */
export const DECOR_DELVE_PREFIX = "decor.delve.";
/**
 * Every decor effect ID starts with this: the biome-independent effects (`decor.fx.<name>`) and the ambient particle
 * textures (`decor.fx.ambient.b<n>`). The `decor.fx.*` colour roles share the spelling.
 */
export const DECOR_FX_PREFIX = "decor.fx.";
const DECOR_AMBIENT_NAME = "ambient";

/**
 * The biome-independent decor effects: `torch` the flame loop on a lit wall torch (Lords of Pain `vfx/flame`),
 * `flame` the bigger loop on a lit brazier (`vfx/flames`), `glow` the soft additive sprite under a glowing piece
 * (`vfx/glow`), `glint` the treasure sparkle (`vfx/glint`), `zone` the ring on an open stairwell (`vfx/zone`), `loot`
 * the twinkle on a loaded barrel or crate (docs/BREAKABLE_DROPS.md; the vale pack's is original art,
 * scripts/art/gen-loot-glint.js; a pack without it shows `glint` there instead).
 */
export const DECOR_FX_NAMES = ["torch", "flame", "glow", "glint", "zone", "loot"] as const;
/**
 * A biome-independent decor effect's name (a DECOR_FX_NAMES entry): the last segment of `decor.fx.<name>` and the key
 * of DECOR_FX_TINT.
 */
export type DecorFxName = (typeof DECOR_FX_NAMES)[number];

/** The colour role tinting each effect (and the lights / particles a renderer adds for it). */
export const DECOR_FX_TINT: Readonly<Record<DecorFxName, ColorRole>> = {
	torch: "decor.fx.flame",
	flame: "decor.fx.flame",
	glow: "decor.fx.glow",
	glint: "decor.fx.glint",
	zone: "decor.fx.zone",
	loot: "decor.fx.glint",
};

/**
 * Every `decor.fx.*` colour role (flame, glow, glint, zone, ambient.b1..b5). Required in every pack like every role;
 * the validator keeps each at least MIN_DECOR_FX_BULLET_DIFFERENCE from every ENEMY_BULLET_ROLES colour.
 */
export const DECOR_FX_ROLES: ReadonlyArray<ColorRole> = [
	"decor.fx.flame",
	"decor.fx.glow",
	"decor.fx.glint",
	"decor.fx.zone",
	"decor.fx.ambient.b1",
	"decor.fx.ambient.b2",
	"decor.fx.ambient.b3",
	"decor.fx.ambient.b4",
	"decor.fx.ambient.b5",
];

/**
 * Readability caps for ambient particles (docs/DECOR.md Phase 2 part 2), owned by the theme because a pack's ambient
 * texture may set its own look (`particle` on `decor.fx.ambient.*`) and the validator holds it to them: smaller and
 * more transparent than any bullet. Enemy bullets are drawn opaque (Neon) and 2 * BULLET_VIEW.enemyDrawRadius
 * (0.34 tiles = 1.36 studs) across; a particle stays under half that and at least 40 % transparent. Renderers clamp to
 * these too (ThemeCore.ambient), whatever a pack says.
 */
export const DECOR_PARTICLE = {
	/** Largest ambient particle, studs (ParticleEmitter.Size). */
	maxSizeStuds: 0.6,
	/** Most opaque an ambient particle may be (ParticleEmitter.Transparency; 0 = opaque, 1 = invisible). */
	minTransparency: 0.4,
	/** Size when the pack sets none, studs. */
	defaultSizeStuds: 0.35,
	/** Transparency when the pack sets none. */
	defaultTransparency: 0.6,
} as const;

/**
 * Roblox port (docs/FX_AUDIO.md F6): an ambient particle texture may be a ParticleEmitter flipbook (DecorParticle
 * `flipbook`): a square texture of `grid` x `grid` cells, grid one of these (FlipbookLayout Grid2x2 / Grid4x4 /
 * Grid8x8), played in one of PARTICLE_FLIPBOOK_MODES.
 */
export const PARTICLE_FLIPBOOK_GRIDS: ReadonlyArray<number> = [2, 4, 8];
/**
 * The flipbook modes an ambient particle texture may ask for (`ParticleEmitter.FlipbookMode` names). The validator
 * rejects any other, and ThemeCore ignores a flipbook whose mode is not one of them. Nothing reads the order beyond the
 * validator's message.
 */
export const PARTICLE_FLIPBOOK_MODES: ReadonlyArray<ParticleFlipbookMode> = ["Loop", "OneShot", "PingPong", "Random"];

/** What a decor ID names (`parseDecorId`). */
export type DecorIdInfo =
	| {
			readonly type: "piece";
			readonly biome: BiomeId;
			readonly kind: DecorKind;
			/** 1..DECOR_MAX_VARIANTS, or undefined for the base ID. */
			readonly variant: number | undefined;
			/** The layers the kind may be drawn in (DECOR_KIND_LAYERS[kind]). */
			readonly layers: ReadonlyArray<DecorLayer>;
	  }
	| {
			/** docs/VOID_DECOR.md VD7: optional per-biome void art, `decor.void.b<n>.<kind>[.<v>]`. */
			readonly type: "void";
			readonly biome: BiomeId;
			readonly kind: VoidDecorKind;
			/** 1..DECOR_MAX_VARIANTS, or undefined for the base ID. */
			readonly variant: number | undefined;
			/** The layers the kind may be drawn in (VOID_DECOR.layers[kind]). */
			readonly layers: ReadonlyArray<DecorLayer>;
	  }
	| { readonly type: "fx"; readonly name: DecorFxName }
	| { readonly type: "ambient"; readonly biome: BiomeId };

function decorSegmentMaps() {
	const kinds = new Map<string, DecorKind>();
	for (const k of DECOR_KINDS) {
		kinds.set(k.lower(), k);
	}
	const biomes = new Map<string, BiomeId>();
	DECOR_BIOME_KEYS.forEach((key, i) => biomes.set(key, BIOMES[i].id));
	// void kinds are lowercase already (VOID_DECOR.kinds)
	const voidKinds = new Map<string, VoidDecorKind>();
	for (const k of VOID_DECOR.kinds) {
		voidKinds.set(k, k);
	}
	return { kinds, biomes, voidKinds };
}
const DECOR_SEGMENTS = decorSegmentMaps();
const DECOR_KIND_BY_SEGMENT: ReadonlyMap<string, DecorKind> = DECOR_SEGMENTS.kinds;
const DECOR_BIOME_BY_KEY: ReadonlyMap<string, BiomeId> = DECOR_SEGMENTS.biomes;

/** The decor biome segment of a biome ID: "biome.3" -> "b3" (undefined for an unknown biome). */
export function decorBiomeKey(biome: string): DecorBiomeKey | undefined {
	const i = BIOMES.findIndex((b) => b.id === biome);
	return i >= 0 ? DECOR_BIOME_KEYS[i] : undefined;
}

/**
 * The decor ID of a piece: decorId("biome.1", "pillar") = "decor.delve.b1.pillar". The kind segment is the kind in
 * lowercase (asset ID segments are lowercase): "shardIce" -> "decor.delve.b3.shardice"; `variant` appends ".<v>".
 */
export function decorId(biome: BiomeId, kind: DecorKind, variant?: number): string {
	const base = `${DECOR_DELVE_PREFIX}${decorBiomeKey(biome)}.${kind.lower()}`;
	return variant !== undefined ? `${base}.${variant}` : base;
}

/**
 * docs/VOID_DECOR.md VD7: the ID of a void art piece: voidDecorId("biome.3", "spire") = "decor.void.b3.spire";
 * `variant` appends ".<v>".
 */
export function voidDecorId(biome: BiomeId, kind: VoidDecorKind, variant?: number): string {
	const base = `${VOID_DECOR.prefix}${decorBiomeKey(biome)}.${kind}`;
	return variant !== undefined ? `${base}.${variant}` : base;
}

/** The decor ID of an effect: "decor.fx.torch". */
export function decorFxId(name: DecorFxName): string {
	return `${DECOR_FX_PREFIX}${name}`;
}

/** Biome `biome`'s ambient particle texture ID: "decor.fx.ambient.b2". */
export function decorAmbientId(biome: BiomeId): string {
	return `${DECOR_FX_PREFIX}${DECOR_AMBIENT_NAME}.${decorBiomeKey(biome)}`;
}

/** Biome `biome`'s ambient particle colour role: "decor.fx.ambient.b2". */
export function decorAmbientRole(biome: BiomeId): ColorRole {
	return `${DECOR_FX_PREFIX}${DECOR_AMBIENT_NAME}.${decorBiomeKey(biome)}` as ColorRole;
}

/** What a decor ID names, or undefined when it follows none of the decor grammars (the validator rejects it). */
export function parseDecorId(id: string): DecorIdInfo | undefined {
	const segs = id.split(".");
	if (segs[0] !== "decor") {
		return undefined;
	}
	if ((segs[1] === "delve" || segs[1] === "void") && (segs.size() === 4 || segs.size() === 5)) {
		const biome = DECOR_BIOME_BY_KEY.get(segs[2]);
		let variant: number | undefined;
		if (segs.size() === 5) {
			variant = tonumber(segs[4]);
			if (variant === undefined || `${variant}` !== segs[4] || variant < 1 || variant > DECOR_MAX_VARIANTS) {
				return undefined;
			}
		}
		if (biome === undefined) {
			return undefined;
		}
		if (segs[1] === "void") {
			const voidKind = DECOR_SEGMENTS.voidKinds.get(segs[3]);
			return voidKind !== undefined
				? { type: "void", biome, kind: voidKind, variant, layers: VOID_DECOR.layers[voidKind] }
				: undefined;
		}
		const kind = DECOR_KIND_BY_SEGMENT.get(segs[3]);
		return kind !== undefined
			? { type: "piece", biome, kind, variant, layers: DECOR_KIND_LAYERS[kind] }
			: undefined;
	}
	if (segs[1] === "fx" && segs.size() === 3) {
		const name = DECOR_FX_NAMES.find((n) => n === segs[2]);
		return name !== undefined ? { type: "fx", name } : undefined;
	}
	if (segs[1] === "fx" && segs.size() === 4 && segs[2] === DECOR_AMBIENT_NAME) {
		const biome = DECOR_BIOME_BY_KEY.get(segs[3]);
		return biome !== undefined ? { type: "ambient", biome } : undefined;
	}
	return undefined;
}

/** For messages: the decor ID grammars. */
export const DECOR_ID_FORMS =
	`decor.delve.b<1..${DECOR_BIOME_KEYS.size()}>.<kind>[.<1..${DECOR_MAX_VARIANTS}>], ` +
	`decor.void.b<1..${DECOR_BIOME_KEYS.size()}>.<${VOID_DECOR.kinds.join("|")}>[.<1..${DECOR_MAX_VARIANTS}>], ` +
	`decor.fx.<${DECOR_FX_NAMES.join("|")}>, decor.fx.ambient.b<1..${DECOR_BIOME_KEYS.size()}>`;
