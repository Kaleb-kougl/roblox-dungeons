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
	// Roblox port (docs/ENEMY_VARIANTS.md EV1): the endless Imp (flanker) and Ooze (zone-denier, `slime`)
	"enemy.imp",
	"enemy.slime",
	// Roblox port (docs/NEW_ENEMIES.md NE1): the second endless set (contract.ts ENEMY_ARCHETYPES)
	"enemy.bomber",
	"enemy.charger",
	"enemy.stormcaller",
	"enemy.warbanner",
	"enemy.reaper",
	// Roblox port (docs/FORTUNE.md FD9): the Goldling (contract.ts ENEMY_ARCHETYPES)
	"enemy.golden",
	// Bosses share one accent
	"boss",
	// Enemy attack warnings (telegraph lines, slam shockwaves): hot like enemy bullets, but not a bullet
	"telegraph",
	// Roblox port (enemy outline plan O1): the rim drawn around every living enemy and the boss (the placeholders'
	// shared Highlight; later the sprites' baked outline). The validator holds it to MIN_ENEMY_OUTLINE_CONTRAST against
	// every biome floor and wall and MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE (CIE76) from enemyBullet / enemyBulletOutline.
	"enemyOutline",
	// Roblox port (player outline, step 1): the rim drawn around the watched player's character (the knight sprite's
	// baked outline, the placeholder capsule's Highlight). The validator holds it to MIN_PLAYER_OUTLINE_CONTRAST against
	// every biome floor and wall and MIN_PLAYER_OUTLINE_DIFFERENCE (CIE76) from PLAYER_OUTLINE_DIFFERENCE_ROLES.
	"playerOutline",
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
	// Roblox port (docs/FX_AUDIO.md F1): sprite-effect tints with no existing role (contract.ts FX_ROLES): the flask's
	// heal and the curse shrine. Held to MIN_FX_BULLET_DIFFERENCE (CIE76) from the enemy-bullet roles like decor.fx.*.
	"fx.heal",
	"fx.curse",
	// Roblox port (docs/BOOSTS.md B5): one identity colour per boost kind (contract.ts BOOST_KINDS / BOOST_ROLES), held
	// to MIN_BOOST_CONTRAST on every biome floor and wall and MIN_BOOST_BULLET_DIFFERENCE (CIE76) from the enemy-bullet
	// roles, like enemyOutline.
	"boost.fury",
	"boost.quickstep",
	"boost.frenzy",
	"boost.aegis",
	// Roblox port (docs/ROOM_EDGES.md RE4): the dashed line where a corridor meets a room, one colour per room state
	// (contract.ts ROOM_EDGE_ROLES). waiting and live are held to MIN_ROOM_EDGE_CONTRAST on every biome floor, all three
	// to MIN_ROOM_EDGE_DIFFERENCE (CIE76) from the enemy-bullet roles and telegraph.
	"roomEdge.safe",
	"roomEdge.waiting",
	"roomEdge.live",
	// Roblox port (docs/MINIMAP.md M6): the minimap's tiles and markers (contract.ts MINIMAP_ROLES), UI colours over
	// uiPanel. The markers are held to MIN_MINIMAP_MARKER_CONTRAST on minimap.floor and uiPanel, minimap.enemy to
	// MIN_MINIMAP_ENEMY_DIFFERENCE (CIE76) from minimap.self, minimap.boost and every class.* role.
	"minimap.floor",
	"minimap.wall",
	"minimap.pool",
	"minimap.frontier",
	"minimap.self",
	"minimap.enemy",
	"minimap.boss",
	"minimap.stairs",
	"minimap.boost",
	// Roblox port (docs/COMBO.md CB3): the combo's tier colours (x2 rampage .. x5 unstoppable; below x2 the meter keeps
	// ember) and a broken streak's grey (contract.ts COMBO_ROLES). Held to COMBO_COLOR_RULES by comboReport: every tier
	// (ember too) >= 3:1 on uiPanel and apart step to step (CIE76), the named tiers (CIE76) from the enemy-bullet roles
	// and telegraph (the floor shout is drawn under bullets), combo.broken low-chroma and apart from every tier.
	"combo.rampage",
	"combo.carnage",
	"combo.dominating",
	"combo.unstoppable",
	"combo.broken",
	// Roblox port (docs/GRAZE_PARRY.md GP3): a graze's spark (white-cyan) and a parry's sparks and PARRY! floor text
	// (gold-white) (contract.ts NEAR_MISS_ROLES). Held to NEAR_MISS_COLOR_RULES by nearMissReport: >= 3:1 on every biome
	// floor and (CIE76) away from the enemy-bullet roles and telegraph (they are drawn among and under bullets).
	"nearMiss.graze",
	"nearMiss.parry",
	// Roblox port (docs/DRAFT_REVEAL.md DR3): the boon draft's rarity colours, bone / blood red / candle gold (contract.ts
	// BOON_RARITY_ROLES; the loot rarity.* roles above are separate). Held to BOON_RARITY_COLOR_RULES by
	// boonRarityReport: each >= 3:1 on uiPanel and apart from the rarity below it (CIE76).
	"boon.common",
	"boon.rare",
	"boon.legendary",
	// Roblox port (docs/ENEMY_VARIANTS.md EV1, EVD5): the Ooze's goo puddles (the flat `bullet.enemy.goo` decal). Held to
	// GOO_COLOR_RULES by gooReport (variantColors.ts): >= 3:1 on every biome floor and (CIE76) away from every decor fx
	// and boost colour, so a puddle reads as danger, never as decor or a pickup.
	"enemyGoo",
	// Roblox port (docs/ENEMY_VARIANTS.md EV1, EVD12): one colour per elite affix (variants.ts AFFIX_ROLES: the floor
	// ring, the sprite rim's tint, the name chip) and a Shielded enemy's shield segment. Held to AFFIX_COLOR_RULES by
	// affixReport (variantColors.ts): >= 3:1 on every biome floor and (CIE76) away from the enemy-bullet roles,
	// telegraph, enemyOutline and each other.
	"affix.hulking",
	"affix.swift",
	"affix.shielded",
	"affix.vengeful",
	"enemyShield",
	// Roblox port (docs/NEW_ENEMIES.md NE1, NED8): the Warbanner's aura (the ring under the banner, the faint rim tint on
	// every enemy it buffs; variants.ts ENEMY_AURA_ROLE). Held to AURA_COLOR_RULES by auraReport (variantColors.ts):
	// >= 3:1 on every biome floor and (CIE76) away from the enemy-bullet roles, telegraph, every boost and affix colour.
	"enemyAura",
	// Roblox port (docs/NEW_BEST.md NB4): the new-best gold (the passed target row, the gold score number, the NEW BEST!
	// floor shout, the confetti, NEW DEEPEST on the stairwell card, the run-over ribbon). Held to NEW_BEST_COLOR_RULES by
	// newBestReport (newBestColors.ts): >= 3:1 on uiPanel, (CIE76) apart from ember and every combo tier, and away from
	// the enemy-bullet roles and telegraph (the shout is drawn on the floor under bullets).
	"newBest",
	// Roblox port (docs/BUILDS.md BU1): the evolution and duo cards' frames (builds.ts BOON_BUILD_ROLES; with the rarity
	// ladder in boonRarityReport), then one colour per build effect (BUILD_EFFECT_ROLES: spark beams, Volatile's bolts,
	// Soul Shards, embers), held to BUILD_COLOR_RULES by buildReport (buildColors.ts): >= 3:1 on every biome floor and
	// (CIE76) away from the enemy-bullet roles, telegraph, enemyGoo, enemyOutline and every boost colour.
	"boon.evolved",
	"boon.duo",
	"build.spark",
	"build.burst",
	"build.shard",
	"build.ember",
	// Roblox port (docs/PELLETS.md PL6, PD3): one colour per pellet kind (pellets.ts PELLET_ROLES: the room's pellets,
	// the rare power pellet), the placeholder cube's colour and the vale art's tint. Held to PELLET_COLOR_RULES by
	// pelletReport (pelletColors.ts): >= 3:1 on every biome floor and (CIE76) away from the enemy-bullet roles,
	// telegraph, every boost and build effect colour and playerOutline.
	"pellet.normal",
	"pellet.power",
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

/** '#rrggbb' (the only color format packs may use; keeps the contrast check exact). */
export type HexColor = `#${string}`;

// ---------------------------------------------------------------------------------------------
// Assets

/** Roblox content IDs for uploaded images and sounds. Only `src/shared/theme/**` may contain one. */
export type RobloxAssetId = `rbxassetid://${string}`;

/** How a content id is fetched ahead of use (docs/PRELOAD.md): an image (ImageLabel) or a sound (Sound). */
export type PreloadMedia = "image" | "sound";

/** One uploaded content id a logical id (or a biome) draws or plays, for preloading (ThemeCore.contentIds). */
export interface ContentRef {
	readonly contentId: RobloxAssetId;
	readonly media: PreloadMedia;
}

/** A single uploaded image. w/h are declared so the contract can be checked. */
export interface ImageAsset {
	kind: "image";
	assetId: RobloxAssetId;
	w: number;
	h: number;
	/** Tile slot only: the image is a repeating floor/wall texture spanning this many world tiles per side (any w/h). */
	tilesPerImage?: number;
	/**
	 * ui.* slot: the point placed on the image's anchor (a beam's foot, a ring's centre), pixels from the top-left of
	 * `rect` (or of the image without one), inside it. Presentation only. Without it the renderer uses its own default (bottom centre / centre).
	 * decor.* / breakable.* slots: the point placed on the piece's ground spot, pixels from the top-left of `rect`
	 * (default: bottom centre; centre for flat pieces and effects).
	 */
	pivot?: Pivot;
	/**
	 * ui.* slot, optional (docs/DRAFT_REVEAL.md DR3): the image is a 9-sliced panel; insets in art pixels from each edge,
	 * inside the image with a centre of at least 1 x 1 pixel. Drawn as an ImageLabel with ScaleType Slice and
	 * SliceCenter Rect(left, top, w - right, h - bottom); the corners keep their size, the edges and centre stretch.
	 */
	slice?: SliceInsets;
	/** decor.* (except ambient textures) and breakable.* images, required: art pixels per world tile (sizes the art). */
	pixelsPerTile?: number;
	/**
	 * decor.* / breakable.* / boost.* and ui.* images: the region of the image to draw, pixels (default: all of it); an
	 * atlas cut (ui.*: docs/UI_ART.md UA4, the icon atlas), inside the image. A ui image's `pivot` is then from the
	 * rect's top-left and inside it. A sliced ui image (`slice`) is drawn whole: no rect.
	 */
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
	/**
	 * decor.delve.* only, optional: points (pixels from the top-left of `rect`, inside it) whose convex hull holds every
	 * visible pixel. A standing piece is then held inside its footprint box by this shape instead of its rectangle (a
	 * diagonal wall segment's rectangle is mostly empty corners). Presentation only.
	 */
	outline?: Array<Pivot>;
}

/** 9-slice insets of a ui image (ImageAsset.slice), art pixels from the left, top, right and bottom edges. */
export interface SliceInsets {
	left: number;
	top: number;
	right: number;
	bottom: number;
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
	/**
	 * Roblox port (docs/FX_AUDIO.md F6): the texture is a square ParticleEmitter flipbook of `grid` x `grid` cells
	 * (contract.ts PARTICLE_FLIPBOOK_GRIDS: Grid2x2 / Grid4x4 / Grid8x8). Absent: one still frame.
	 */
	flipbook?: ParticleFlipbook;
}

/** ParticleEmitter.FlipbookMode names (OneShot plays once over each particle's life; fps is then unused). */
export type ParticleFlipbookMode = "Loop" | "OneShot" | "PingPong" | "Random";

/** An ambient particle texture's flipbook (DecorParticle.flipbook). Presentation only. */
export interface ParticleFlipbook {
	/** Cells per side: 2, 4 or 8 (FlipbookLayout Grid2x2 / Grid4x4 / Grid8x8). */
	grid: number;
	/** FlipbookFramerate, in (0, MAX_ANIMATION_FPS]. */
	fps: number;
	mode: ParticleFlipbookMode;
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
	/**
	 * Roblox port (docs/FX_AUDIO.md A2): more uploaded clips of the same event (Hit1..Hit9). The player picks among
	 * `[assetId, ...variants]` (round-robin, so specs stay deterministic). Absent or empty: `assetId` only.
	 */
	variants?: Array<RobloxAssetId>;
	/**
	 * PlaybackSpeed jitter per start, `[min, max]` with SOUND_PITCH_LIMITS.min <= min <= max <= SOUND_PITCH_LIMITS.max
	 * (contract.ts). Absent: no jitter (1).
	 */
	pitch?: PitchRange;
	/**
	 * Shortest gap between two starts of this sound, seconds (>= 0), tuned per clip; overrides the audio layer's
	 * default (shared/view/audio SFX_MIN_INTERVAL). Presentation only: exempt from the gameplay-key scan on sounds.
	 */
	minInterval?: number;
}

/** A PlaybackSpeed range: each start plays at a speed in [min, max]. */
export type PitchRange = [min: number, max: number];

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
 * Frame `f` of facing `d` of animation `a` is cell `a.start + d * (a.stride ?? a.frames) + f`. A sheet may carry its
 * own cell (`SpriteSheetImage.frameW` / `frameH` / `pivot`, per-sheet cells; actor slots only, `perSheetCells` in
 * contract.ts): its cells, rects and pivot then use those, and the set-level fields are the defaults.
 * Facings are in SCREEN space: facing `d` points at `zeroDeg + d * 360 / count` degrees, counter-clockwise when `ccw`,
 * where 0 = screen right and 90 = screen up. The atlas pipeline always writes zeroDeg 0, ccw true.
 */
export interface SpriteSetAsset {
	kind: "sprites";
	frameW: number;
	frameH: number;
	/** The feet: pixels from the cell's top-left. Placed on the actor's ground position. */
	pivot: Pivot;
	/** Texel density: cell pixels per world tile (sizes the billboard: frameW / pixelsPerTile tiles wide). Per set. */
	pixelsPerTile: number;
	/** ImageLabel ResampleMode name. */
	resample: "Default" | "Pixelated";
	facings: SpriteFacings;
	sheets: Array<SpriteSheetImage>;
	/** Base animation names (no facing suffix): the slot's contract names (class: idle, run, roll, hit, death; enemy and
	 * boss: idle, move, attack, hit, death; decor and breakable: idle; fx: play) are required with >= 1 frame; extra
	 * names (attack.1, run.back, lit, shatter, ...) allowed. */
	animations: Record<string, SpriteAnimationDef>;
	/** decor.delve.* only, required: see ImageAsset.layer. */
	layer?: DecorLayer;
	/** decor.* only: see ImageAsset.glow. */
	glow?: boolean;
	/** decor.* only, with `glow`: where the flame / glow attaches, pixels from the cell's top-left (default: the pivot). */
	glowAt?: Pivot;
	/** decor.* only: see ImageAsset.emissive. */
	emissive?: boolean;
	/**
	 * decor.delve.* only, optional: one outline per facing (`facings.count` of them; see ImageAsset.outline), pixels
	 * from the cell's top-left, holding every visible pixel of every frame drawn in that facing.
	 */
	outlines?: Array<Array<Pivot>>;
	// --- fx.* only (Roblox port, docs/FX_AUDIO.md F1): a one-facing flipbook drawn once at a world spot ------------
	/**
	 * Drawn size of the cell's longer side, world tiles, in (0, FX_SPRITE_MAX_TILES] (contract.ts). Absent: that side
	 * / pixelsPerTile (the sprite-set default), held to the same cap.
	 */
	sizeTiles?: number;
	/** The colour role multiplied in (ImageLabel.ImageColor3; the pipeline greys the sheet first). Absent: own colours. */
	tint?: ColorRole;
	/** A brighter, self-lit blend (LightInfluence 0) for glows, rings and sparks. */
	additive?: boolean;
	/**
	 * The untinted sheet's mean colour (written by the FX pipeline): an untinted effect is held to the enemy-bullet
	 * rule by it. Ignored (not checked) when `tint` is set: the tint is checked instead.
	 */
	meanColor?: HexColor;
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
	/**
	 * Optional baked outline of this sheet (enemy outline plan O4; the atlas pipeline's `<sheet>-outline.png`): same
	 * size and cell grid, white, alpha only where the rim goes. The renderer draws it under each frame with the same
	 * rect, tinted the `enemyOutline` role. Absent: the sheet's frames draw without a rim.
	 */
	outlineAssetId?: RobloxAssetId;
	/**
	 * Per-sheet cells (docs/DEMON_ART.md DD4; the atlas pipeline's `cells: "perSheet"`): this sheet's own cell width,
	 * height and pivot (pixels from its cell's top-left), each defaulting to the set's `frameW` / `frameH` / `pivot`.
	 * The pivot marks the same point of the art as the set's, so the feet stay planted when the drawn sheet changes;
	 * the renderer sizes and offsets the billboard per sheet at the set's `pixelsPerTile`. Actor slots only
	 * (SlotContract.perSheetCells): decor, breakable and fx sets are drawn from the set-level cell.
	 */
	frameW?: number;
	frameH?: number;
	pivot?: Pivot;
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
	/**
	 * Roblox port (docs/VOID_DECOR.md VD1): the void's rock shoulder along every wall and corridor, its top colour. Must
	 * read as wall mass, never as floor (voidColors.ts `voidReport`).
	 */
	shoulder: HexColor;
	/**
	 * Roblox port (docs/VOID_DECOR.md VD1): the deep void (the backdrop under the shoulder, and past the grid), darkest
	 * of the void colours. The ledge between them is derived (`voidLedgeColor(shoulder, abyss)`).
	 */
	abyss: HexColor;
	/** Logical asset IDs for this biome's tiles, e.g. { floor: 'tile.biome.1.floor' }. */
	tiles: Record<BiomeTileKey, string>;
	/**
	 * Optional presentation: the Roblox material of the floor / wall / pool Parts and the void's shoulder / cliff Parts
	 * (absent: SmoothPlastic).
	 */
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
