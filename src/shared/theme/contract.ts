/**
 * The fixed sprite contract and slot list. Set once; every pack follows it.
 *
 * Ported from project-kaleb-vale `src/theme/contract.ts` @ 42897e2. IDs, cell sizes, frame counts,
 * pivots, facings, the digit font, required IDs/strings, contrast thresholds and gameplay key words
 * are UNCHANGED (plus the port's `enemy.dummy`, see ENEMY_ARCHETYPES), so art made for either build
 * fits both. Roblox changes: visual slots accept `placeholder` where the web accepted `generated`, and
 * audio slots name the SoundGroup they play through (SOUND_GROUPS).
 *
 * Cell sizes, frame counts per animation, pivots and facings live here (not in packs), so code
 * can rely on them and a new pack can't change how anything lines up. The validator checks every
 * pack against this file.
 *
 * Contract v2 (docs/ART.md task S2, a deviation from the web build): the class / enemy / boss slots also accept the
 * additive `sprites` kind (`SpriteSetAsset`), which carries its own cell size, pivot, facings and frame counts and
 * only has to define the slot's base animation names (`requiredBaseAnimations`). The 16 px `spritesheet` rules
 * below are unchanged.
 *
 * Roblox-port slots (docs/DECOR.md): DECOR (`decor.*`, optional room decoration: the web build's DECOR slot, rebuilt
 * from the plan) and BREAKABLE (`breakable.*`, required: breakable clutter is a gameplay object). Both take free-size
 * world art (`image` with `pixelsPerTile`, or `sprites`); see the Decor section at the end of this file.
 */

import type { AssetKind, ColorRole, Pivot } from "./types";
import { startsWith } from "./util";

/** Directional slots draw one animation row per facing, in this order. */
export const FACINGS = ["down", "up", "left", "right"] as const;
export type Facing = (typeof FACINGS)[number];

/** Roblox SoundGroups audio routes through, one per audio slot (SoundService.<name>). */
export const SOUND_GROUPS = ["sfx", "music"] as const;
export type SoundGroupName = (typeof SOUND_GROUPS)[number];

export interface SlotContract {
	/** Slot name, for messages. */
	readonly slot: string;
	/** Asset IDs starting with this prefix belong to the slot. */
	readonly prefix: string;
	/** Asset kinds the slot accepts. */
	readonly kinds: ReadonlyArray<AssetKind>;
	/** Fixed cell size in pixels; omitted for free-size slots (UI panels). */
	readonly cell?: { readonly w: number; readonly h: number };
	/** Fixed pivot in pixels from the cell's top-left. */
	readonly pivot?: Readonly<Pivot>;
	/** Animation name -> exact frame count, for spritesheets. */
	readonly animations?: Readonly<Record<string, number>>;
	/** Animation names in contract order (Luau tables have no key order). */
	readonly animationOrder?: ReadonlyArray<string>;
	/** Facings each animation is drawn in. Empty: animations are not directional. */
	readonly facings: ReadonlyArray<Facing>;
	/** Audio slots: the SoundGroup their sounds play through. */
	readonly soundGroup?: SoundGroupName;
	/**
	 * v2 `sprites` kind: the base animation names a set in this slot must define (>= 1 frame each). Defaults to
	 * `animationOrder`; set for slots without a 16 px spritesheet contract (decor, breakables: `idle`).
	 */
	readonly baseAnimations?: ReadonlyArray<string>;
}

const SPRITE: ReadonlyArray<AssetKind> = ["spritesheet", "placeholder"];
/** Actor slots also take the v2 `sprites` kind (SpriteSetAsset: free cells, facings and frame counts). */
const ACTOR: ReadonlyArray<AssetKind> = ["spritesheet", "sprites", "placeholder"];
const STILL: ReadonlyArray<AssetKind> = ["image", "placeholder"];
const AUDIO: ReadonlyArray<AssetKind> = ["sound", "silent"];

export const CHARACTER: SlotContract = {
	slot: "class",
	prefix: "class.",
	kinds: ACTOR,
	cell: { w: 16, h: 24 },
	pivot: { x: 8, y: 23 },
	animations: { idle: 4, run: 6, roll: 4, hit: 2, death: 6 },
	animationOrder: ["idle", "run", "roll", "hit", "death"],
	facings: FACINGS,
};

export const ENEMY: SlotContract = {
	slot: "enemy",
	prefix: "enemy.",
	kinds: ACTOR,
	cell: { w: 16, h: 16 },
	pivot: { x: 8, y: 15 },
	animations: { idle: 4, move: 4, attack: 4, hit: 2, death: 4 },
	animationOrder: ["idle", "move", "attack", "hit", "death"],
	facings: FACINGS,
};

export const BOSS: SlotContract = {
	slot: "boss",
	prefix: "boss.",
	kinds: ACTOR,
	cell: { w: 48, h: 48 },
	pivot: { x: 24, y: 47 },
	animations: { idle: 4, move: 4, attack: 6, hit: 2, death: 8 },
	animationOrder: ["idle", "move", "attack", "hit", "death"],
	facings: [],
};

/** Bullets are drawn at one cell size; the renderer scales them to the gameplay radius. */
export const BULLET: SlotContract = {
	slot: "bullet",
	prefix: "bullet.",
	kinds: SPRITE,
	cell: { w: 8, h: 8 },
	pivot: { x: 4, y: 4 },
	animations: { fly: 2 },
	animationOrder: ["fly"],
	facings: [],
};

/** One tile = PIXELS_PER_TILE (16) pixels square. */
export const TILE: SlotContract = { slot: "tile", prefix: "tile.", kinds: STILL, cell: { w: 16, h: 16 }, facings: [] };
export const ITEM: SlotContract = { slot: "item", prefix: "item.", kinds: STILL, cell: { w: 16, h: 16 }, facings: [] };
export const UI: SlotContract = { slot: "ui", prefix: "ui.", kinds: STILL, facings: [] };
export const SFX: SlotContract = { slot: "sfx", prefix: "sfx.", kinds: AUDIO, facings: [], soundGroup: "sfx" };
export const MUSIC: SlotContract = { slot: "music", prefix: "music.", kinds: AUDIO, facings: [], soundGroup: "music" };

/**
 * Roblox port (docs/DECOR.md R2): room decoration, the web build's DECOR slot. Free-size world art (`image` or
 * `sprites`), all of it OPTIONAL: an ID a pack leaves out is simply not drawn, so there is no placeholder kind. IDs
 * follow `decor.<group>.<...>` (DECOR section below); every asset also carries the decor fields (`layer`, `pivot`,
 * `glow`, `emissive`, ...) that `validate.ts` checks per ID.
 */
export const DECOR: SlotContract = {
	slot: "decor",
	prefix: "decor.",
	kinds: ["image", "sprites"],
	facings: [],
	baseAnimations: ["idle"],
};

/**
 * Roblox port (docs/DECOR.md D4, R13): breakable clutter, a gameplay object (it blocks movement and bullets), so every
 * pack must draw it: `breakable.<kind>` is required for every BREAKABLE_KINDS entry, with a placeholder primitive (a
 * low box) until art exists. Free-size world art: `image` (with `pixelsPerTile`) or `sprites` (`idle`, plus an
 * optional one-shot `shatter`).
 */
export const BREAKABLE: SlotContract = {
	slot: "breakable",
	prefix: "breakable.",
	kinds: ["image", "sprites", "placeholder"],
	facings: [],
	baseAnimations: ["idle"],
};

export const SLOTS: ReadonlyArray<SlotContract> = [
	CHARACTER,
	ENEMY,
	BOSS,
	BULLET,
	TILE,
	ITEM,
	UI,
	SFX,
	MUSIC,
	DECOR,
	BREAKABLE,
];

/** Slots whose images are free-size world art drawn at `pixelsPerTile` (decor pieces, breakables). */
export const WORLD_ART_SLOTS: ReadonlyArray<SlotContract> = [DECOR, BREAKABLE];

/** The slot an asset ID belongs to, by prefix. */
export function slotFor(id: string): SlotContract | undefined {
	return SLOTS.find((s) => startsWith(id, s.prefix));
}

export interface RequiredAnimation {
	readonly name: string;
	readonly frames: number;
}

/**
 * Animation names a spritesheet in this slot must define, in contract order: `run.left` for
 * directional slots (every facing of `idle`, then every facing of `run`, ...), else `run`.
 */
export function requiredAnimationList(slot: SlotContract): Array<RequiredAnimation> {
	const out = new Array<RequiredAnimation>();
	const animations = slot.animations;
	if (animations === undefined) {
		return out;
	}
	for (const anim of slot.animationOrder ?? []) {
		const frames = animations[anim];
		if (slot.facings.size() === 0) {
			out.push({ name: anim, frames });
		} else {
			for (const f of slot.facings) {
				out.push({ name: `${anim}.${f}`, frames });
			}
		}
	}
	return out;
}

/** Animation names a spritesheet in this slot must define: `run.left` for directional slots, else `run`. */
export function requiredAnimations(slot: SlotContract): Record<string, number> {
	const out: Record<string, number> = {};
	for (const a of requiredAnimationList(slot)) {
		out[a.name] = a.frames;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Sprite contract v2: the `sprites` kind (SpriteSetAsset, docs/ART.md task S2)

/**
 * Base animation names (no facing suffix) a `sprites` asset in this slot must define, in contract order:
 * class: idle, run, roll, hit, death; enemy and boss: idle, move, attack, hit, death; decor and breakable: idle
 * (`baseAnimations`). Each needs >= 1 frame; the
 * contract's exact frame counts, cells, pivots and facings apply to the 16 px `spritesheet` kind only. Empty for a
 * slot without animations.
 */
export function requiredBaseAnimations(slot: SlotContract): Array<string> {
	const out = new Array<string>();
	for (const anim of slot.baseAnimations ?? slot.animationOrder ?? []) {
		out.push(anim);
	}
	return out;
}

/** Roblox stores uploaded images at most this many pixels on a side (sheets, cells and free-size tile images). */
export const MAX_IMAGE_SIDE = 1024;
/** Highest presentation frame rate an animation may ask for (spritesheet and sprites kinds). */
export const MAX_ANIMATION_FPS = 60;
/** Facing counts a sprite set may be drawn in (1 = not directional). */
export const SPRITE_FACING_COUNTS = [1, 4, 8, 16] as const;
/** ImageLabel ResampleMode names a sprite set may ask for. */
export const SPRITE_RESAMPLE_MODES = ["Default", "Pixelated"] as const;

// ---------------------------------------------------------------------------------------------
// Slot roster (GDD: what every pack fills)

export const CLASS_IDS = ["vanguard", "ranger", "pyromancer", "tinkerer", "hexblade"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/**
 * The web build's six, then the Roblox port's `dummy` (the tutorial's Training Dummy, sim archetype 'dummy'): every
 * pack fills `enemy.dummy` (asset and colour role) and `enemy.dummy.name` like the others.
 */
export const ENEMY_ARCHETYPES = ["swarmer", "sprayer", "sniper", "bruiser", "caster", "summoner", "dummy"] as const;
export type EnemyArchetype = (typeof ENEMY_ARCHETYPES)[number];

export const RARITIES = ["normal", "magic", "rare", "unique", "set", "glyphword"] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * The five biomes, each tied to a Dungeon Forge theme slot. biome.1..4 are Acts I-IV,
 * biome.5 is the endgame.
 */
export const BIOMES = [
	{ id: "biome.1", forgeTheme: "ancient", act: "1" },
	{ id: "biome.2", forgeTheme: "molten", act: "2" },
	{ id: "biome.3", forgeTheme: "frost", act: "3" },
	{ id: "biome.4", forgeTheme: "grim", act: "4" },
	{ id: "biome.5", forgeTheme: "verdant", act: "endgame" },
] as const;
export type BiomeId = (typeof BIOMES)[number]["id"];
export type ForgeTheme = (typeof BIOMES)[number]["forgeTheme"];

/**
 * Roblox built-in materials (`Enum.Material` names) a biome may give its surfaces (`BiomeDef.materials`, docs/DECOR.md
 * R1): stone for halls and vaults, volcanic rock for molten, ice and snow for frost, earth and grass for verdant, plus
 * pool liquids. Presentation only: a material adds texture and a little lighting variation, `Part.Color` stays the
 * biome hex. **Neon is left out on purpose**: it is the bullets' material (they must glow on every floor), and a
 * glowing floor, wall or pool would compete with them.
 */
export const BIOME_MATERIALS = [
	"SmoothPlastic",
	"Slate",
	"Brick",
	"Cobblestone",
	"Basalt",
	"Limestone",
	"Granite",
	"Rock",
	"Pavement",
	"Concrete",
	"Sandstone",
	"CrackedLava",
	"Ice",
	"Glacier",
	"Snow",
	"Grass",
	"LeafyGrass",
	"Mud",
	"Ground",
	"Glass",
] as const;
export type BiomeMaterial = (typeof BIOME_MATERIALS)[number];

/** The surfaces a biome can pick a material for: floor slabs, wall blocks, sunken pools. */
export const BIOME_MATERIAL_SURFACES = ["floor", "wall", "pool"] as const;
export type BiomeMaterialSurface = (typeof BIOME_MATERIAL_SURFACES)[number];

/**
 * The material of a surface whose biome names none (what every Part was drawn in before R1). Also the only material a
 * textured floor may use (a biome whose floor tile is a repeating `tilesPerImage` image): any other one draws its own
 * pattern under the image and fights it.
 */
export const DEFAULT_BIOME_MATERIAL: BiomeMaterial = "SmoothPlastic";

export const BOSS_IDS = ["boss.1", "boss.2", "boss.3", "boss.4", "boss.5"] as const;

export const BULLET_IDS = [
	"bullet.enemy.small",
	"bullet.enemy.medium",
	"bullet.enemy.large",
	"bullet.enemy.needle",
	"bullet.player.basic",
	"bullet.player.heavy",
] as const;

export const ITEM_IDS = [
	"item.weapon",
	"item.offhand",
	"item.helm",
	"item.armor",
	"item.gloves",
	"item.boots",
	"item.belt",
	"item.ring",
	"item.amulet",
	"item.potion",
	"item.gold",
	"item.glyph",
] as const;

export const UI_IDS = [
	"ui.cursor",
	"ui.panel",
	"ui.icon.health",
	"ui.icon.mana",
	"ui.icon.ember",
	"ui.font.digits",
] as const;

/**
 * The pixel digit font (juice: damage numbers, "CAP"). A horizontal strip of equal cells, one per glyph in
 * `glyphs` order, left to right. Each cell is the glyphW x glyphH glyph with `pad` pixels around it (room for a 1 px
 * outline), so a cell is cellW x cellH and the strip is (glyphs.length * cellW) x cellH. Text advances `advance`
 * pixels per glyph (glyph width + 1 px gap; neighbouring outlines overlap by design).
 *   placeholder: { kind: "placeholder" } (the HUD draws the digits as text until a strip is uploaded)
 *   image:       a cellW * glyphs.length x cellH image in the same layout (w: 80, h: 7), glyphs drawn white
 *                so the renderer can tint them per number
 */
export const DIGIT_FONT = {
	id: "ui.font.digits",
	glyphs: "0123456789+-CAP!",
	glyphW: 3,
	glyphH: 5,
	pad: 1,
	cellW: 5,
	cellH: 7,
	advance: 4,
} as const;

/** Asset ID prefix of pixel fonts. */
export const FONT_PREFIX = "ui.font.";

/** Audio event IDs. A pack maps each to a sound or leaves it silent. */
export const AUDIO_EVENTS = [
	"sfx.player.shoot",
	"sfx.player.roll",
	"sfx.player.hurt",
	"sfx.player.death",
	"sfx.enemy.shoot",
	"sfx.enemy.hurt",
	"sfx.enemy.death",
	"sfx.boss.roar",
	"sfx.ember",
	"sfx.loot.drop",
	"sfx.loot.rare",
	"sfx.ui.click",
	"sfx.ui.confirm",
	"music.menu",
	"music.biome.1",
	"music.biome.2",
	"music.biome.3",
	"music.biome.4",
	"music.biome.5",
	"music.boss",
] as const;

/**
 * Roblox port (docs/DECOR.md D4): the breakable clutter kinds (the sim's breakable `kind`). Every pack fills
 * `breakable.<kind>` (asset, a placeholder until art exists), the colour role `breakable.<kind>` and the string
 * `breakable.<kind>.name`, like `enemy.dummy`: a gameplay object must always be drawn.
 *
 * A mirror of shared/dungeon BREAKABLE_KINDS, the source of truth (the sim's kind index is its order; renderers index
 * that list, not this one). The theme imports nothing outside shared/theme, so the list is repeated here and
 * decor.spec.ts asserts both are identical, in order.
 */
export const BREAKABLE_KINDS = ["barrel", "crate"] as const;
export type BreakableKind = (typeof BREAKABLE_KINDS)[number];

/** Asset (and colour role) ID of a breakable kind: `breakable.crate`. */
export function breakableId(kind: BreakableKind): `breakable.${BreakableKind}` {
	return `breakable.${kind}`;
}

/**
 * Roblox port (docs/DECOR.md R13): breakable audio events, required in every pack (silent in the placeholder pack).
 * Kept apart from AUDIO_EVENTS, which stays the web build's list.
 */
export const BREAKABLE_AUDIO_EVENTS = ["sfx.breakable.hit", "sfx.breakable.break"] as const;

/** Sprite-set animation a breakable plays once when it breaks (optional; `idle` is required). */
export const BREAKABLE_SHATTER_ANIMATION = "shatter";

/** Every asset ID a pack must define (biome tile IDs are required through the biome entries). */
export const REQUIRED_ASSET_IDS: ReadonlyArray<string> = [
	...CLASS_IDS.map((c) => `class.${c}`),
	...ENEMY_ARCHETYPES.map((e) => `enemy.${e}`),
	...BOSS_IDS,
	...BULLET_IDS,
	...ITEM_IDS,
	...UI_IDS,
	...AUDIO_EVENTS,
	...BREAKABLE_KINDS.map((k) => breakableId(k)),
	...BREAKABLE_AUDIO_EVENTS,
];

/** Every string key a pack must define. Code may rely on these existing. */
export const REQUIRED_STRING_KEYS: ReadonlyArray<string> = [
	"game.title",
	"ember.name",
	...CLASS_IDS.map((c) => `class.${c}.name`),
	...ENEMY_ARCHETYPES.map((e) => `enemy.${e}.name`),
	...BOSS_IDS.map((b) => `${b}.name`),
	...RARITIES.map((r) => `rarity.${r}.name`),
	"act.1.name",
	"act.2.name",
	"act.3.name",
	"act.4.name",
	"act.endgame.name",
	"hud.health",
	"hud.mana",
	"hud.ember",
	"hud.level",
	"hud.gold",
	"hud.paused",
	"hud.armor",
	"hud.flask",
	"hud.dead",
	"menu.play",
	"menu.options",
	"menu.quit",
	...BREAKABLE_KINDS.map((k) => `${breakableId(k)}.name`),
];

/**
 * Minimum WCAG contrast ratio between enemyBullet and every biome floor and wall
 * (GDD: enemy bullets must read against every floor). 3.0 is WCAG's bar for graphics.
 */
export const MIN_ENEMY_BULLET_CONTRAST = 3.0;

/**
 * Roblox port (enemy outline plan O1): minimum WCAG contrast ratio between `enemyOutline` and every biome floor and
 * wall, at full light and (shared/view decorBandContrastReport, run by its spec for every bundled pack) at the darkest
 * decor band. The rim is what makes an enemy read on a floor of its own colour, so it takes the bullets' graphics bar.
 */
export const MIN_ENEMY_OUTLINE_CONTRAST = 3.0;

/** Juice: enemy health bar fill (enemyHealth, enemyHealthElite) vs its back plate, WCAG graphics bar. */
export const MIN_HEALTH_BAR_CONTRAST = 3.0;
/** Juice: every damage-number colour vs every biome floor (WCAG AA text; the digits are tiny). */
export const MIN_DAMAGE_NUMBER_CONTRAST = 4.5;
/** Bar fill roles checked against `enemyHealthBack`. */
export const HEALTH_BAR_FILL_ROLES = ["enemyHealth", "enemyHealthElite"] as const;
/** Damage-number roles checked against every biome floor. */
export const DAMAGE_NUMBER_ROLES = ["damageNumber", "damageHeavy", "damageCapped"] as const;

/**
 * Roblox port (docs/DECOR.md D4): enemy bullets are drawn over breakables just as over walls, so every breakable
 * colour role is held to MIN_ENEMY_BULLET_CONTRAST against `enemyBullet` too.
 */
export const BREAKABLE_ROLES: ReadonlyArray<ColorRole> = ["breakable.barrel", "breakable.crate"];

// ---------------------------------------------------------------------------------------------
// Decor (Roblox port, docs/DECOR.md R2 and Phase 2 part 2): the web build's DECOR slot
//
//   decor.delve.b<n>.<kind>[.<v>]   a decoration piece for biome n (b1..b5 = biome.1..5), optional variant v
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
export type DecorLayer = (typeof DECOR_LAYERS)[number];

const TALL_SPOT = ["tall", "low"] as const;
const FLAT_SPOT = ["flat"] as const;
const WALL_SPOT = ["wall"] as const;

/**
 * Decor piece kinds and the layers a pack may draw each in. The kinds are the Dungeon Forge pieces the web build's
 * decor plan draws (`PropKind`, plus `torch` from `Dungeon.torches`; `chest` and `arch` are never drawn), the far-wall
 * dressing (R6: `wall` / `wallBroken` segments, `column` / `columnBroken`), the treasure-room `gems` and the flat
 * decals a broken barrel / crate leaves (`brokenBarrel`, `brokenCrate`). Readability: a kind the plan places as a
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
	gems: FLAT_SPOT,
	brokenBarrel: FLAT_SPOT,
	brokenCrate: FLAT_SPOT,
	// wall pieces
	torch: WALL_SPOT,
	banner: WALL_SPOT,
} as const satisfies Record<string, ReadonlyArray<DecorLayer>>;
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
	"gems",
	"brokenBarrel",
	"brokenCrate",
	"torch",
	"banner",
];

/** A piece may have numbered variants `decor.delve.b<n>.<kind>.<v>`, v in 1..DECOR_MAX_VARIANTS (bones1..3, ...). */
export const DECOR_MAX_VARIANTS = 4;

/** The biome segment of decor IDs: b1..b5 = biome.1..biome.5 (BIOMES order). */
export const DECOR_BIOME_KEYS = ["b1", "b2", "b3", "b4", "b5"] as const;
export type DecorBiomeKey = (typeof DECOR_BIOME_KEYS)[number];

export const DECOR_PREFIX = "decor.";
export const DECOR_DELVE_PREFIX = "decor.delve.";
export const DECOR_FX_PREFIX = "decor.fx.";
const DECOR_AMBIENT_NAME = "ambient";

/**
 * The biome-independent decor effects: `torch` the flame loop on a lit wall torch (Lords of Pain `vfx/flame`),
 * `flame` the bigger loop on a lit brazier (`vfx/flames`), `glow` the soft additive sprite under a glowing piece
 * (`vfx/glow`), `glint` the treasure sparkle (`vfx/glint`), `zone` the ring on an open stairwell (`vfx/zone`).
 */
export const DECOR_FX_NAMES = ["torch", "flame", "glow", "glint", "zone"] as const;
export type DecorFxName = (typeof DECOR_FX_NAMES)[number];

/** The colour role tinting each effect (and the lights / particles a renderer adds for it). */
export const DECOR_FX_TINT: Readonly<Record<DecorFxName, ColorRole>> = {
	torch: "decor.fx.flame",
	flame: "decor.fx.flame",
	glow: "decor.fx.glow",
	glint: "decor.fx.glint",
	zone: "decor.fx.zone",
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

/** The colours an enemy bullet is drawn in (core and outline): decor fx must never be mistaken for them. */
export const ENEMY_BULLET_ROLES: ReadonlyArray<ColorRole> = ["enemyBullet", "enemyBulletOutline"];

/**
 * Minimum CIE76 colour difference (Delta E*ab, CIELAB under D65; `colorDifference` in color.ts) between every
 * DECOR_FX_ROLES colour and every ENEMY_BULLET_ROLES colour. A luminance contrast ratio is the wrong test here (a
 * flame and a bullet can share a luminance and still never be confused; a darker pink can pass a ratio and still read
 * as a bullet), so this measures hue, chroma and lightness together. 40 rules out the bullet's own hue family
 * (#ff40a0 is 2, #e03090 is 9, #ff2a6a is 30 from the placeholder bullet #ff3fa4) while every flame, glow, glint,
 * zone and biome particle colour the Forge themes use sits at 77 or more.
 */
export const MIN_DECOR_FX_BULLET_DIFFERENCE = 40;

/**
 * Roblox port (enemy outline plan O1): minimum CIE76 colour difference between `enemyOutline` and every
 * ENEMY_BULLET_ROLES colour, so the rim around an enemy never reads as a bullet. The same bar as decor fx
 * (MIN_DECOR_FX_BULLET_DIFFERENCE, for the same reason); the placeholder rim #ff3b30 is 63 from enemyBullet #ff3fa4.
 */
export const MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE = 40;

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

/** What a decor ID names (`parseDecorId`). */
export type DecorIdInfo =
	| {
			readonly type: "piece";
			readonly biome: BiomeId;
			readonly kind: DecorKind;
			/** 1..DECOR_MAX_VARIANTS, or undefined for the base ID. */
			readonly variant: number | undefined;
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
	return { kinds, biomes };
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
	if (segs[1] === "delve" && (segs.size() === 4 || segs.size() === 5)) {
		const biome = DECOR_BIOME_BY_KEY.get(segs[2]);
		const kind = DECOR_KIND_BY_SEGMENT.get(segs[3]);
		if (biome === undefined || kind === undefined) {
			return undefined;
		}
		if (segs.size() === 4) {
			return { type: "piece", biome, kind, variant: undefined };
		}
		const variant = tonumber(segs[4]);
		if (variant === undefined || `${variant}` !== segs[4] || variant < 1 || variant > DECOR_MAX_VARIANTS) {
			return undefined;
		}
		return { type: "piece", biome, kind, variant };
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
	`decor.fx.<${DECOR_FX_NAMES.join("|")}>, decor.fx.ambient.b<1..${DECOR_BIOME_KEYS.size()}>`;

/** Manifest keys that smell like gameplay data. Packs carry art, never numbers that change difficulty. */
export const GAMEPLAY_KEY_WORDS = [
	"hitbox",
	"hurtbox",
	"collider",
	"collision",
	"speed",
	"velocity",
	"damage",
	"dmg",
	"dps",
	"radius",
	"cooldown",
	"health",
	"hp",
	"range",
	"duration",
	"lifetime",
	"ttl",
	"knockback",
	"mass",
	"rate",
	"delay",
	"interval",
	"windup",
	"iframes",
	"invulnerable",
	"stats",
] as const;
