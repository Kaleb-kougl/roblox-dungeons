/**
 * Theme pack data types. A pack is a manifest module (`packs/<id>/manifest.ts`) that maps logical
 * IDs to Roblox assets, colors and strings. Gameplay code only ever sees the logical IDs.
 *
 * Ported from project-kaleb-vale `src/theme/types.ts` @ 42897e2. Unchanged: COLOR_ROLES, pivots,
 * animation defs, biome defs, the manifest shape. Changed for Roblox: assets reference uploaded
 * Roblox content (`assetId: "rbxassetid://<n>"`) instead of pack-relative files, and the web's
 * `generated` kind (art drawn at load time) is replaced by `placeholder`: no art at all, the
 * renderer builds a primitive from `PLACEHOLDER_VISUALS` (placeholders.ts) instead.
 *
 * Rule: nothing in here carries gameplay values. Hitboxes, bullet radii, speeds and timings live
 * in gameplay data, so swapping a pack can never change difficulty (the validator enforces it).
 */

import type { BiomeMaterial, BiomeMaterialSurface, DecorLayer } from "./contract";

/** Current manifest format. Bump when the shape changes incompatibly. */
export const MANIFEST_FORMAT = 1;

// ---------------------------------------------------------------------------------------------
// Color roles

/**
 * Every color role a pack must fill. Code asks for a role ("enemyBullet"), never a color.
 * Biomes additionally carry their own floor/wall colors; the top-level floor/wall are defaults
 * for screens outside a biome (menus, hub).
 */
export const COLOR_ROLES = [
	// World
	"background",
	"floor",
	"wall",
	// Bullets (GDD palette rule: enemy = hot cores + dark outline, player = cool and desaturated)
	"enemyBullet",
	"enemyBulletOutline",
	"playerBullet",
	"playerBulletOutline",
	"ember",
	// UI
	"uiText",
	"uiTextDim",
	"uiPanel",
	"uiAccent",
	"uiHealth",
	"uiMana",
	// Loot rarity
	"rarity.normal",
	"rarity.magic",
	"rarity.rare",
	"rarity.unique",
	"rarity.set",
	"rarity.glyphword",
	// One flat identity color per class (placeholder art, minimap dots, UI accents)
	"class.vanguard",
	"class.ranger",
	"class.pyromancer",
	"class.tinkerer",
	"class.hexblade",
	// One flat identity color per enemy archetype
	"enemy.swarmer",
	"enemy.sprayer",
	"enemy.sniper",
	"enemy.bruiser",
	"enemy.caster",
	"enemy.summoner",
	// Roblox port: the tutorial's Training Dummy (contract.ts ENEMY_ARCHETYPES)
	"enemy.dummy",
	// Bosses share one accent
	"boss",
	// Enemy attack warnings (telegraph lines, slam shockwaves): hot like enemy bullets, but not a bullet
	"telegraph",
	// Juice (src/fx in the web build): enemy health bars, damage numbers, death particles. The validator checks
	// enemyHealth (and enemyHealthElite) against enemyHealthBack (>= 3:1) and every damage-number role against
	// every biome floor (>= 4.5:1).
	"enemyHealth",
	"enemyHealthChip",
	"enemyHealthBack",
	"enemyHealthElite",
	"damageNumber",
	"damageHeavy",
	"damageCapped",
	"particleSpark",
	// Roblox port (docs/DECOR.md Phase 2 part 2): decor effect tints (contract.ts DECOR_FX_ROLES). The validator keeps
	// each at least MIN_DECOR_FX_BULLET_DIFFERENCE (CIE76) from enemyBullet and enemyBulletOutline.
	"decor.fx.flame",
	"decor.fx.glow",
	"decor.fx.glint",
	"decor.fx.zone",
	// One ambient particle colour per biome (b1..b5 = biome.1..5; the Forge themes' particle colours)
	"decor.fx.ambient.b1",
	"decor.fx.ambient.b2",
	"decor.fx.ambient.b3",
	"decor.fx.ambient.b4",
	"decor.fx.ambient.b5",
	// Roblox port (docs/DECOR.md D4): one identity colour per breakable kind (contract.ts BREAKABLE_KINDS), held to
	// MIN_ENEMY_BULLET_CONTRAST against enemyBullet like the walls
	"breakable.barrel",
	"breakable.crate",
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

/** '#rrggbb' (the only color format packs may use; keeps the contrast check exact). */
export type HexColor = `#${string}`;

// ---------------------------------------------------------------------------------------------
// Assets

/** Roblox content IDs for uploaded images and sounds. Only `src/shared/theme/**` may contain one. */
export type RobloxAssetId = `rbxassetid://${string}`;

/** A single uploaded image. w/h are declared so the contract can be checked. */
export interface ImageAsset {
	kind: "image";
	assetId: RobloxAssetId;
	w: number;
	h: number;
	/** Tile slot only: the image is a repeating floor/wall texture spanning this many world tiles per side (any w/h). */
	tilesPerImage?: number;
	/**
	 * ui.* slot: the point placed on the image's anchor (a beam's foot, a ring's centre), pixels from the top-left,
	 * inside the image. Presentation only. Without it the renderer uses its own default (bottom centre / centre).
	 * decor.* / breakable.* slots: the point placed on the piece's ground spot, pixels from the top-left of `rect`
	 * (default: bottom centre; centre for flat pieces and effects).
	 */
	pivot?: Pivot;
	/** decor.* (except ambient textures) and breakable.* images, required: art pixels per world tile (sizes the art). */
	pixelsPerTile?: number;
	/** decor.* / breakable.* images: the region of the image to draw, pixels (default: all of it); an atlas cut. */
	rect?: PixelBox;
	/** decor.delve.* only, required: how and where the piece is drawn (contract.ts DECOR_KIND_LAYERS). */
	layer?: DecorLayer;
	/** decor.*: the piece glows (a light source: flames go on it, the glow sprite under it, the light pool may pick it). */
	glow?: boolean;
	/** decor.*, with `glow`: where the flame / glow attaches, pixels from the top-left of `rect` (default: the pivot). */
	glowAt?: Pivot;
	/** decor.*: self-lit art, drawn at full brightness (no world lighting, no depth-band dimming). */
	emissive?: boolean;
	/** decor.fx.ambient.* only: the particle's look, held to contract.ts DECOR_PARTICLE (smaller and fainter than bullets). */
	particle?: DecorParticle;
}

/** A pixel rectangle inside an image, top-left origin. */
export interface PixelBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** An ambient particle's look (decor.fx.ambient.*); each field optional, defaults in contract.ts DECOR_PARTICLE. */
export interface DecorParticle {
	/** ParticleEmitter.Size, studs: in (0, DECOR_PARTICLE.maxSizeStuds]. */
	sizeStuds?: number;
	/** ParticleEmitter.Transparency: in [DECOR_PARTICLE.minTransparency, 1]. */
	transparency?: number;
}

export interface AnimationDef {
	/** Row of the sheet (0 = top) holding this animation's frames, left to right. */
	row: number;
	frames: number;
	/** Presentation frame rate only. Gameplay timings (wind-ups, i-frames) live in gameplay data. */
	fps: number;
	loop: boolean;
}

export interface Pivot {
	/** Pixels from the cell's left edge. */
	x: number;
	/** Pixels from the cell's top edge. */
	y: number;
}

/**
 * An uploaded image holding a grid of equal cells. Each animation occupies one row. Directional
 * slots name their animations `<anim>.<facing>`, e.g. `run.left` (see contract.ts).
 */
export interface SpriteSheetAsset {
	kind: "spritesheet";
	assetId: RobloxAssetId;
	frameW: number;
	frameH: number;
	animations: Record<string, AnimationDef>;
	pivot: Pivot;
}

export interface SoundAsset {
	kind: "sound";
	assetId: RobloxAssetId;
	/** 0..1 mix level. */
	volume?: number;
}

/** An audio event the pack leaves silent (the placeholder pack ships no audio). */
export interface SilentAsset {
	kind: "silent";
}

/**
 * No art yet: the renderer builds the primitive described by `PLACEHOLDER_VISUALS[id]`
 * (placeholders.ts), tinted by a color role. Replaces the web build's `generated` kind.
 */
export interface PlaceholderAsset {
	kind: "placeholder";
}

/**
 * Sprite contract v2 (docs/ART.md task S2): pre-rendered directional sprites in large cells, spread over one or more
 * uploaded atlases. Accepted in the class / enemy / boss slots next to the 16 px `spritesheet` kind; the slot's cell
 * size, pivot, frame counts and facings do NOT apply (each set carries its own). Presentation only.
 *
 * Cells: in sheet `sheets[a.sheet]`, cells are laid row-major, `floor(sheet.w / frameW)` per row, from the top-left.
 * Frame `f` of facing `d` of animation `a` is cell `a.start + d * (a.stride ?? a.frames) + f`.
 * Facings are in SCREEN space: facing `d` points at `zeroDeg + d * 360 / count` degrees, counter-clockwise when `ccw`,
 * where 0 = screen right and 90 = screen up. The atlas pipeline always writes zeroDeg 0, ccw true.
 */
export interface SpriteSetAsset {
	kind: "sprites";
	frameW: number;
	frameH: number;
	/** The feet: pixels from the cell's top-left. Placed on the actor's ground position. */
	pivot: Pivot;
	/** Texel density: cell pixels per world tile (sizes the billboard: frameW / pixelsPerTile tiles wide). */
	pixelsPerTile: number;
	/** ImageLabel ResampleMode name. */
	resample: "Default" | "Pixelated";
	facings: SpriteFacings;
	sheets: Array<SpriteSheetImage>;
	/** Base animation names (no facing suffix): the slot's contract names (class: idle, run, roll, hit, death; enemy and
	 * boss: idle, move, attack, hit, death; decor and breakable: idle) are required with >= 1 frame; extra names
	 * (attack.1, run.back, lit, shatter, ...) allowed. */
	animations: Record<string, SpriteAnimationDef>;
	/** decor.delve.* only, required: see ImageAsset.layer. */
	layer?: DecorLayer;
	/** decor.* only: see ImageAsset.glow. */
	glow?: boolean;
	/** decor.* only, with `glow`: where the flame / glow attaches, pixels from the cell's top-left (default: the pivot). */
	glowAt?: Pivot;
	/** decor.* only: see ImageAsset.emissive. */
	emissive?: boolean;
}

export interface SpriteFacings {
	count: 1 | 4 | 8 | 16;
	zeroDeg: number;
	ccw: boolean;
}

export interface SpriteSheetImage {
	assetId: RobloxAssetId;
	w: number;
	h: number;
}

export interface SpriteAnimationDef {
	/** Index into `sheets`. */
	sheet: number;
	/** First cell (facing 0, frame 0). */
	start: number;
	frames: number;
	/** Cells between consecutive facings (default `frames`); lets a 1-frame stand-in reuse frame 0 of a longer animation. */
	stride?: number;
	/** Presentation frame rate; one-shots driven by a gameplay timer are stretched to it instead. */
	fps: number;
	loop: boolean;
}

export type VisualAsset = ImageAsset | SpriteSheetAsset | SpriteSetAsset | PlaceholderAsset;
export type AudioAsset = SoundAsset | SilentAsset;
export type AssetDef = VisualAsset | AudioAsset;
export type AssetKind = AssetDef["kind"];

// ---------------------------------------------------------------------------------------------
// Biomes

/** Tile asset IDs every biome provides. */
export const BIOME_TILE_KEYS = ["floor", "wall"] as const;
export type BiomeTileKey = (typeof BIOME_TILE_KEYS)[number];

/**
 * Roblox materials for a biome's surfaces (`BIOME_MATERIALS` names, contract.ts). Every surface is optional and
 * defaults to `DEFAULT_BIOME_MATERIAL` (SmoothPlastic). A floor whose tile is a repeating texture must stay
 * SmoothPlastic (the validator enforces it).
 */
export type BiomeMaterials = Partial<Record<BiomeMaterialSurface, BiomeMaterial>>;

export interface BiomeDef {
	/** String-table key for the place name. */
	name: string;
	floor: HexColor;
	wall: HexColor;
	/** Logical asset IDs for this biome's tiles, e.g. { floor: 'tile.biome.1.floor' }. */
	tiles: Record<BiomeTileKey, string>;
	/** Optional presentation: the Roblox material of the floor / wall / pool Parts (absent: SmoothPlastic). */
	materials?: BiomeMaterials;
}

// ---------------------------------------------------------------------------------------------
// Manifest

export interface ThemeManifest {
	format: number;
	/** Must match the pack's folder name. */
	id: string;
	/** Human-readable pack name (for a pack picker; not a string-table entry). */
	name: string;
	version: string;
	colors: Record<ColorRole, HexColor>;
	/** Keyed by biome ID (biome.1 .. biome.5). */
	biomes: Record<string, BiomeDef>;
	/** Logical asset ID -> asset. Sprites, tiles, bullets, items, UI, decor, breakables and audio events. */
	assets: Record<string, AssetDef>;
	/** Default-locale string table. Values may contain {name} placeholders. */
	strings: Record<string, string>;
	/** Optional partial string tables per locale (e.g. "fr"), falling back to `strings`. */
	locales?: Record<string, Record<string, string>>;
}
