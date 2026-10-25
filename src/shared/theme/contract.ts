/**
 * The fixed sprite contract and slot list. Set once; every pack follows it.
 *
 * Ported from project-kaleb-vale `src/theme/contract.ts` @ 42897e2. IDs, cell sizes, frame counts,
 * pivots, facings, the digit font, required IDs/strings, contrast thresholds and gameplay key words
 * are UNCHANGED, so art made for either build fits both. Roblox changes: visual slots accept
 * `placeholder` where the web accepted `generated`, and audio slots name the SoundGroup they play
 * through (SOUND_GROUPS).
 *
 * Cell sizes, frame counts per animation, pivots and facings live here (not in packs), so code
 * can rely on them and a new pack can't change how anything lines up. The validator checks every
 * pack against this file.
 *
 * Contract v2 (docs/ART.md task S2, a deviation from the web build): the class / enemy / boss slots also accept the
 * additive `sprites` kind (`SpriteSetAsset`), which carries its own cell size, pivot, facings and frame counts and
 * only has to define the slot's base animation names (`requiredBaseAnimations`). The 16 px `spritesheet` rules
 * below are unchanged.
 */

import type { AssetKind, Pivot } from "./types";
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

export const SLOTS: ReadonlyArray<SlotContract> = [CHARACTER, ENEMY, BOSS, BULLET, TILE, ITEM, UI, SFX, MUSIC];

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
 * class: idle, run, roll, hit, death; enemy and boss: idle, move, attack, hit, death. Each needs >= 1 frame; the
 * contract's exact frame counts, cells, pivots and facings apply to the 16 px `spritesheet` kind only. Empty for a
 * slot without animations.
 */
export function requiredBaseAnimations(slot: SlotContract): Array<string> {
	const out = new Array<string>();
	for (const anim of slot.animationOrder ?? []) {
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

export const ENEMY_ARCHETYPES = ["swarmer", "sprayer", "sniper", "bruiser", "caster", "summoner"] as const;
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

/** Every asset ID a pack must define (biome tile IDs are required through the biome entries). */
export const REQUIRED_ASSET_IDS: ReadonlyArray<string> = [
	...CLASS_IDS.map((c) => `class.${c}`),
	...ENEMY_ARCHETYPES.map((e) => `enemy.${e}`),
	...BOSS_IDS,
	...BULLET_IDS,
	...ITEM_IDS,
	...UI_IDS,
	...AUDIO_EVENTS,
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
];

/**
 * Minimum WCAG contrast ratio between enemyBullet and every biome floor and wall
 * (GDD: enemy bullets must read against every floor). 3.0 is WCAG's bar for graphics.
 */
export const MIN_ENEMY_BULLET_CONTRAST = 3.0;

/** Juice: enemy health bar fill (enemyHealth, enemyHealthElite) vs its back plate, WCAG graphics bar. */
export const MIN_HEALTH_BAR_CONTRAST = 3.0;
/** Juice: every damage-number colour vs every biome floor (WCAG AA text; the digits are tiny). */
export const MIN_DAMAGE_NUMBER_CONTRAST = 4.5;
/** Bar fill roles checked against `enemyHealthBack`. */
export const HEALTH_BAR_FILL_ROLES = ["enemyHealth", "enemyHealthElite"] as const;
/** Damage-number roles checked against every biome floor. */
export const DAMAGE_NUMBER_ROLES = ["damageNumber", "damageHeavy", "damageCapped"] as const;

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
