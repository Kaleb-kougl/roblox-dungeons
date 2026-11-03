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
 * below are unchanged. Per-sheet cells (docs/DEMON_ART.md DD4: a sheet with its own `frameW` / `frameH` / `pivot`) are
 * accepted in those three slots only (`perSheetCells`).
 *
 * Roblox-port slots (docs/DECOR.md): DECOR (`decor.*`, optional room decoration: the web build's DECOR slot, rebuilt
 * from the plan) and BREAKABLE (`breakable.*`, required: breakable clutter is a gameplay object). Both take free-size
 * world art (`image` with `pixelsPerTile`, or `sprites`); see the Decor section at the end of this file.
 *
 * Roblox-port slots (docs/FX_AUDIO.md A2, F1): AMBIENCE (`amb.b<n>`, required biome ambience loops, sound or silent)
 * and FX (`fx.*`, optional one-shot sprite effects: one-facing `sprites` sets); the port's audio IDs
 * (PORT_AUDIO_EVENTS); sound variants, pitch jitter and per-clip minimum intervals. See the Effects and audio section
 * at the end of this file.
 *
 * Roblox-port slot (docs/BOOSTS.md B5): BOOST (`boost.<kind>`, required: a boost drop is a gameplay object), free-size
 * world art like BREAKABLE; its colour roles, strings, sounds and optional effects: the Boosts section below.
 *
 * Roblox-port slot (docs/PELLETS.md PL6): PELLET (`pellet.normal` / `pellet.power`, required: a pellet is a gameplay
 * object), free-size world art like BOOST; its roles, sounds and strings: pellets.ts (named inline here).
 */

import type { AssetKind, ColorRole, ParticleFlipbookMode, Pivot } from "./types";
import { DAILY_STRING_KEYS } from "./daily";
import { DAILY_RANK_STRING_KEYS } from "./dailyRank";
import { NEW_BEST_STRING_KEYS } from "./newBest";
import { ROSTER_STRING_KEYS } from "./roster";
import { INPUT_KEY_STRING_KEYS } from "./inputKeys";
import { startsWith } from "./util";
import { ENEMY_VARIANT_STRING_KEYS } from "./variants";

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
	/**
	 * v2 `sprites` kind: a set in this slot may give a sheet its own cell (SpriteSheetImage `frameW` / `frameH` /
	 * `pivot`, docs/DEMON_ART.md DD4), because its renderer (the actor SpriteView) re-sizes the billboard per sheet.
	 * Absent: the slot's renderers size every frame from the set-level cell, so the validator refuses per-sheet cells
	 * and ThemeCore.sprites rejects a set that has them.
	 */
	readonly perSheetCells?: boolean;
	/**
	 * v2 `sprites` kind: named OPTIONAL animations the game plays when a set defines them and falls back from when it
	 * does not (shared/view sprites.ts: a class's sword swings attack.1..3 -> attack; a boss's named attacks
	 * attack.2..4 -> attack, its specials intro / taunt -> the builder's fallback, else what plays without them).
	 * Validated like every animation when present; never required; listing them documents what the renderers ask for.
	 */
	readonly optionalAnimations?: ReadonlyArray<string>;
}

const SPRITE: ReadonlyArray<AssetKind> = ["spritesheet", "placeholder"];
/** Actor slots also take the v2 `sprites` kind (SpriteSetAsset: free cells, facings and frame counts). */
const ACTOR: ReadonlyArray<AssetKind> = ["spritesheet", "sprites", "placeholder"];
const STILL: ReadonlyArray<AssetKind> = ["image", "placeholder"];
const AUDIO: ReadonlyArray<AssetKind> = ["sound", "silent"];

/**
 * Optional `sprites` animations of the class slot: the sword's three swings (shared/view choosePlayerAnim falls back
 * to `attack`, then the base animations).
 */
export const CLASS_OPTIONAL_ANIMATIONS = ["attack.1", "attack.2", "attack.3"] as const;

/**
 * Roblox port (docs/BOSS_DEMONLORD.md D2, docs/BRAMBLE_ART.md BR2, one list for both bosses): optional `sprites`
 * animations of the boss slot. `attack.2` / `attack.3` / `attack.4` are named attacks (each falls back to `attack`);
 * `intro` (the engage roar) and `taunt` (a phase transition) are one-shot specials the renderer stretches over the
 * gameplay timer (absent: the builder's fallback, Mother Bramble's intro -> taunt, else what plays without them). The
 * Demon Lord uses attack.2 / intro / taunt; Mother Bramble FAN `attack`, RINGs `attack.2`, SPIRAL `attack.3`, SLAM
 * `attack.4`, intro / taunt. The required five (idle, move, attack, hit, death) are unchanged.
 */
export const BOSS_OPTIONAL_ANIMATIONS = ["attack.2", "attack.3", "attack.4", "intro", "taunt"] as const;

export const CHARACTER: SlotContract = {
	slot: "class",
	prefix: "class.",
	kinds: ACTOR,
	cell: { w: 16, h: 24 },
	pivot: { x: 8, y: 23 },
	animations: { idle: 4, run: 6, roll: 4, hit: 2, death: 6 },
	animationOrder: ["idle", "run", "roll", "hit", "death"],
	facings: FACINGS,
	optionalAnimations: CLASS_OPTIONAL_ANIMATIONS,
	perSheetCells: true,
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
	perSheetCells: true,
	// docs/ENEMY_VARIANTS.md EV10: `attack.2`, a second named attack (falls back to `attack`): the summoner's summon
	// cast (shared/view variantsConfig VARIANT_SPRITE_VIEW.summonerAnims). docs/NEW_ENEMIES.md NE8: `death.2`, a second
	// death (falls back to `death`): the Bomber's detonation (Explode); `move.back`, a second move loop (falls back to
	// `move`): the Warbanner backing away (Run Backwards) (shared/view newEnemiesConfig NEW_ENEMY_SPRITE_VIEW.anims).
	// Inline, not a top-level constant: the compiled contract.luau sits near Luau's 200-locals limit.
	optionalAnimations: ["attack.2", "death.2", "move.back"],
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
	perSheetCells: true,
	optionalAnimations: BOSS_OPTIONAL_ANIMATIONS,
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
 * Roblox port (docs/FX_AUDIO.md A2): biome ambience beds, `amb.b<n>` (AMBIENCE_IDS), looped quietly under the music.
 * Required like every audio event (silent in the placeholder pack), so the contract knows every ID the game plays
 * and a pack's typo is an error. Plays through the `sfx` SoundGroup (decision X5: no new volume slider).
 */
export const AMBIENCE: SlotContract = {
	slot: "ambience",
	prefix: "amb.",
	kinds: AUDIO,
	facings: [],
	soundGroup: "sfx",
};

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

/**
 * Roblox port (docs/BOOSTS.md B5): a boost drop, the pickup a killed enemy may leave (BOOST_KINDS). A gameplay object,
 * so every pack must draw it: `boost.<kind>` is required for every kind, with a placeholder primitive (a small gem)
 * until art exists. Free-size world art like BREAKABLE: `image` (with `pixelsPerTile`) or `sprites` (`idle`). Any other
 * `boost.` ID is an error.
 */
export const BOOST: SlotContract = {
	slot: "boost",
	prefix: "boost.",
	kinds: ["image", "sprites", "placeholder"],
	facings: [],
	baseAnimations: ["idle"],
};

/**
 * Roblox port (docs/PELLETS.md PL6, PD3): a pellet, the small cube a fight lays on its room's floor, and the rare power
 * pellet (pellets.ts PELLET_IDS: `pellet.normal`, `pellet.power`). A gameplay object, so every pack must draw both, with
 * a placeholder primitive (a small Block cube in its colour role) until art exists. Free-size world art like BOOST:
 * `image` (with `pixelsPerTile`) or `sprites` (`idle`). Any other `pellet.` ID is an error.
 */
export const PELLET: SlotContract = {
	slot: "pellet",
	prefix: "pellet.",
	kinds: ["image", "sprites", "placeholder"],
	facings: [],
	baseAnimations: ["idle"],
};

/** The one animation a sprite effect (fx.*) defines: its flipbook (`fps`, `loop` and `frames` live on it). */
export const FX_ANIMATION = "play";

/**
 * Roblox port (docs/FX_AUDIO.md F1): sprite effects, a one-shot flipbook at a world spot (a hit mark, a puff, a ring).
 * OPTIONAL like decor: an FX_IDS entry a pack leaves out draws nothing, so there is no placeholder kind. Each entry is
 * a v2 `sprites` set with ONE facing and a `play` animation, plus the fx fields (`sizeTiles`, `tint`, `additive`,
 * `meanColor`) that `validate.ts` checks.
 */
export const FX: SlotContract = {
	slot: "fx",
	prefix: "fx.",
	kinds: ["sprites"],
	facings: [],
	baseAnimations: [FX_ANIMATION],
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
	AMBIENCE,
	FX,
	BOOST,
	PELLET,
];

/** Slots whose images are free-size world art drawn at `pixelsPerTile` (decor pieces, breakables, boost drops, pellets). */
export const WORLD_ART_SLOTS: ReadonlyArray<SlotContract> = [DECOR, BREAKABLE, BOOST, PELLET];

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
 * class: idle, run, roll, hit, death; enemy and boss: idle, move, attack, hit, death; decor and breakable: idle; fx:
 * play (`baseAnimations`). Each needs >= 1 frame; the
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

/**
 * Named optional animations a `sprites` asset in this slot may define (`optionalAnimations`, in contract order): class
 * attack.1..3, enemy attack.2 / death.2 / move.back, boss attack.2 / attack.3 / attack.4 / intro / taunt; empty for the other slots. A copy. Never required
 * (requiredBaseAnimations is the required list); any other extra name stays allowed (the validator checks every
 * animation a set defines, required or not).
 */
export function optionalBaseAnimations(slot: SlotContract): Array<string> {
	const out = new Array<string>();
	for (const anim of slot.optionalAnimations ?? []) {
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
 * pack fills `enemy.dummy` (asset and colour role) and `enemy.dummy.name` like the others. Then the endless roster's
 * `imp` (the Imp, a flanker) and `slime` (the Ooze, a zone-denier; its slimelets `slime.small` draw `enemy.slime`
 * smaller) of docs/ENEMY_VARIANTS.md EV1: `enemy.imp` / `enemy.slime` and their `.name` the same way (placeholders: a
 * small cone and a low dome). The Summoner fills the web build's existing `summoner`. Then the second endless set of
 * docs/NEW_ENEMIES.md NE1: `bomber`, `charger`, `stormcaller`, `warbanner`, `reaper` (placeholders: a small cone, a
 * long wedge, a tall slim drum, a thin post, a flat disc).
 */
export const ENEMY_ARCHETYPES = [
	"swarmer",
	"sprayer",
	"sniper",
	"bruiser",
	"caster",
	"summoner",
	"dummy",
	"imp",
	"slime",
	"bomber",
	"charger",
	"stormcaller",
	"warbanner",
	"reaper",
] as const;
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

/**
 * The surfaces a biome can pick a material for: floor slabs, wall blocks, sunken pools, and (docs/VOID_DECOR.md VD1) the
 * void's rock shoulder along the walls (its top and body) and its cliffs (the lower ledges and the outcrops rising from
 * the abyss).
 */
export const BIOME_MATERIAL_SURFACES = ["floor", "wall", "pool", "shoulder", "cliff"] as const;
export type BiomeMaterialSurface = (typeof BIOME_MATERIAL_SURFACES)[number];

/**
 * The material of a surface whose biome names none (what every Part was drawn in before R1). Also the only material a
 * textured floor may use (a biome whose floor tile is a repeating `tilesPerImage` image): any other one draws its own
 * pattern under the image and fights it.
 */
export const DEFAULT_BIOME_MATERIAL: BiomeMaterial = "SmoothPlastic";

export const BOSS_IDS = ["boss.1", "boss.2", "boss.3", "boss.4", "boss.5"] as const;

/**
 * Roblox port: the endless bosses' sprite IDs (the sim archetype ids). `boss.act1` is Mother Bramble (the web build's
 * M1 boss); `boss.demonlord` the Demon Lord (docs/BOSS_DEMONLORD.md). Not in REQUIRED_ASSET_IDS (the web contract's
 * list stays as ported, and BOSS_IDS stays the GDD's five): every bundled pack fills both, with `<id>.name`, and
 * placeholder visuals exist for both (theme specs check it).
 */
export const ENDLESS_BOSS_IDS = ["boss.act1", "boss.demonlord"] as const;
export type EndlessBossId = (typeof ENDLESS_BOSS_IDS)[number];

export const BULLET_IDS = [
	"bullet.enemy.small",
	"bullet.enemy.medium",
	"bullet.enemy.large",
	"bullet.enemy.needle",
	"bullet.player.basic",
	"bullet.player.heavy",
	// Roblox port (docs/ENEMY_VARIANTS.md EV1, EVD5): the Ooze's goo puddle (variants.ts GOO_BULLET_ID), drawn flat on
	// the floor under every moving bullet, tinted `enemyGoo`
	"bullet.enemy.goo",
	// Roblox port (docs/NEW_ENEMIES.md NE1): the Stormcaller's lightning strike (variants.ts STRIKE_BULLET_ID,
	// BulletKind.STRIKE), a stationary bullet drawn as a short bolt flash on its marked circle (NE8)
	"bullet.enemy.strike",
	// Roblox port (docs/BUILDS.md BU1): the build effects' player bullets (builds.ts BUILD_BULLET_IDS, the same list):
	// Volatile's bolts, Soul Shards, embers (a flat floor flame), Flurry / Thrill Seeker bolts
	"bullet.player.burst",
	"bullet.player.shard",
	"bullet.player.ember",
	"bullet.player.bolt",
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

// ---------------------------------------------------------------------------------------------
// Boosts (Roblox port, docs/BOOSTS.md B5): the pickups killed enemies sometimes drop

/**
 * The boost kinds, in the sim's Boost index order (shared/sim drops: the kind index is the position here; a cross-check
 * spec asserts both lists are identical, like BREAKABLE_KINDS). Every pack fills, per kind: the asset `boost.<kind>`
 * (BOOST slot, a placeholder gem until art exists), the colour role `boost.<kind>` (BOOST_ROLES) and the strings
 * `boost.<kind>.name` / `.desc` / `.icon` (BOOST_STRING_FIELDS); plus `hud.toast.boost` and the four `sfx.boost.*`
 * IDs in PORT_AUDIO_EVENTS.
 */
export const BOOST_KINDS = ["fury", "quickstep", "frenzy", "aegis"] as const;
export type BoostKind = (typeof BOOST_KINDS)[number];

/** Asset (and colour role) ID of a boost kind: `boost.fury`. */
export function boostId(kind: BoostKind): `boost.${BoostKind}` {
	return `boost.${kind}`;
}

/** Is `id` a boost drop's asset ID (`boost.<kind>` for a BOOST_KINDS entry)? */
export function isBoostId(id: string): id is `boost.${BoostKind}` {
	return BOOST_KINDS.some((k) => boostId(k) === id);
}

/**
 * The strings every boost kind has: `name` ("Fury"), `desc` (what it does, e.g. "+50% damage for 30 s") and `icon`
 * (a short label the HUD's boost row draws until it has icon art, like the boons' `.icon`).
 */
export const BOOST_STRING_FIELDS = ["name", "desc", "icon"] as const;
export type BoostStringField = (typeof BOOST_STRING_FIELDS)[number];

/** String-table key of a boost kind's field: boostStringKey("fury", "desc") = "boost.fury.desc". */
export function boostStringKey(kind: BoostKind, field: BoostStringField): string {
	return `${boostId(kind)}.${field}`;
}

/** The toast shown when the local player picks a boost up: `{name}` and `{desc}` are the kind's strings. */
export const BOOST_TOAST_KEY = "hud.toast.boost";

/** Every boost string key a pack must define: each kind's BOOST_STRING_FIELDS (kind order), then BOOST_TOAST_KEY. */
function boostStringKeys(): Array<string> {
	const out = new Array<string>();
	for (const k of BOOST_KINDS) {
		for (const f of BOOST_STRING_FIELDS) {
			out.push(boostStringKey(k, f));
		}
	}
	out.push(BOOST_TOAST_KEY);
	return out;
}
export const BOOST_STRING_KEYS: ReadonlyArray<string> = boostStringKeys();

/**
 * The boost drops' optional sprite effects (fx.* rules: one-facing `sprites`, `play`, at most FX_SPRITE_MAX_TILES):
 * the pickup burst, then one aura per kind in BOOST_KINDS order (boostAuraFxId).
 */
export const BOOST_FX_IDS = [
	"fx.boost.collect",
	"fx.boost.aura.fury",
	"fx.boost.aura.quickstep",
	"fx.boost.aura.frenzy",
	"fx.boost.aura.aegis",
] as const;
export type BoostFxId = (typeof BOOST_FX_IDS)[number];

/** The pickup burst effect (optional). */
export const BOOST_COLLECT_FX_ID: BoostFxId = "fx.boost.collect";

/** A boost kind's aura effect (optional): boostAuraFxId("aegis") = "fx.boost.aura.aegis". */
export function boostAuraFxId(kind: BoostKind): BoostFxId {
	return `fx.boost.aura.${kind}` as BoostFxId;
}

/**
 * Boost drop art (docs/BOOST_ART.md BA2): the layers drawn with a boost's `image` / `sprites` art. They reuse the decor
 * effects rather than adding boost IDs: the halo under the drop is `decor.fx.<BOOST_HALO_FX>` (the soft glow disc),
 * the sparkle over it `decor.fx.<BOOST_GLINT_FX>` (the treasure glint), both tinted by the kind's colour role
 * `boost.<kind>`. The validator requires the halo whenever a pack gives any `boost.<kind>` art (BA-P2: the Lords of Pain
 * props alone are 1.7-3.6:1 on the floor, under MIN_BOOST_CONTRAST; the tinted halo carries the role). The glint is
 * optional. The beam is BOOST_BEAM_IMAGE_ID, an optional free-form ui image like `ui.marker.pedestal` (white, tinted
 * by the role; its `pivot` is its foot). The placeholder gem draws none of them.
 */
export const BOOST_HALO_FX: DecorFxName = "glow";
export const BOOST_GLINT_FX: DecorFxName = "glint";
export const BOOST_BEAM_IMAGE_ID = "ui.marker.boost";

/**
 * Roblox port (docs/FX_AUDIO.md A2): every other audio ID the port plays, required in every pack (silent in the
 * placeholder pack). Kept apart from AUDIO_EVENTS, which stays the web build's list, like BREAKABLE_AUDIO_EVENTS.
 * First the IDs the audio layer already played before A2 (shared/view/audio PORT_SFX, which only the placeholder pack
 * listed), then the A2 additions: menu back / focus move, the sword finisher, the bow's full charge, room clear, relic
 * and shrine, stairwell, new floor, depth up, the run-over jingle, and the tutorial / lobby tracks. Then the Demon
 * Lord's (docs/BOSS_DEMONLORD.md D6): sfx.boss.taunt, a taunting boss's phase change (the roar plays while it is
 * silent). Then the boost drops' four (docs/BOOSTS.md B5).
 * Then the room clear celebration's three (docs/ROOM_CLEAR.md RC4): PERFECT's jingle, a tally tick, a bonus landing
 * in the score. Then the combo's two (docs/COMBO.md CB3): the tier-up sting (one clip, pitched up per tier) and the
 * break's shatter. Then the near misses' two (docs/GRAZE_PARRY.md GP3): a graze's shimmer and a parry's ring-out.
 * Then the boon draft reveal's five (docs/DRAFT_REVEAL.md DR4): flip, rare chime, legendary charge, legendary flare,
 * pick stamp. Then the enemy variants' five (docs/ENEMY_VARIANTS.md EV1): an Imp's blink, a Summoner's call, an Ooze's
 * split, a Shielded enemy's shield breaking (the plan's `sfx.affix.shieldBreak`: asset ID segments are lowercase) and a
 * Vengeful corpse's ring. Then the new-best celebration's two (docs/NEW_BEST.md NB4): the in-run fanfare (falls back
 * to the PERFECT jingle while silent) and the run-over record fanfare (falls back to the game-over jingle). Then the
 * Daily's rank layer's two (docs/DAILY.md DS10): a rank threshold's sting and a friend passed. Then the breakable
 * drops' one (docs/BREAKABLE_DROPS.md BL5): a boost hops out of a broken barrel / crate (sfx.boost.drop plays while it
 * is silent). Then the new enemies' six (docs/NEW_ENEMIES.md NE1): a Bomber's fuse and blast, a Charger's charge and
 * stun, a Stormcaller's strike, a Reaper's spin. Then the pellets' three (docs/PELLETS.md PL6, pellets.ts
 * PELLET_AUDIO_IDS): a pellet eaten, a room swept, the power pellet taken.
 */
export const PORT_AUDIO_EVENTS = [
	"sfx.player.swing",
	"sfx.player.flask",
	"sfx.player.swap",
	"sfx.player.deflect",
	"sfx.enemy.telegraph",
	"sfx.boss.death",
	"sfx.victory",
	"sfx.ui.back",
	"sfx.ui.move",
	"sfx.player.finisher",
	"sfx.player.charged",
	"sfx.room.clear",
	"sfx.relic.take",
	"sfx.shrine.use",
	"sfx.stairwell.open",
	"sfx.floor.enter",
	"sfx.depth.up",
	"sfx.jingle.gameover",
	"music.tutorial",
	"music.lobby",
	"sfx.boss.taunt",
	// docs/BOOSTS.md B5: a boost drop lands, is collected, runs out; an Aegis pip absorbs a hit (the plan's
	// `sfx.boost.aegisBreak`: asset ID segments are lowercase, as decor kinds are)
	"sfx.boost.drop",
	"sfx.boost.collect",
	"sfx.boost.expire",
	"sfx.boost.aegisbreak",
	// docs/ROOM_CLEAR.md RC4: PERFECT's jingle, a tally tick, a bonus landing in the score
	"sfx.room.perfect",
	"sfx.score.tick",
	"sfx.score.land",
	// docs/COMBO.md CB3: the combo reaches a named tier (sfx.combo.tier, pitched per tier by the cue mapper); the combo
	// breaks during a fight (sfx.combo.break, the shatter; a lapse with no fight on plays nothing)
	"sfx.combo.tier",
	"sfx.combo.break",
	// docs/GRAZE_PARRY.md GP3: a graze's shimmer (pitched by the cue mapper's chain ladder); a guard that erased bullets (replaces the deflect)
	"sfx.player.graze",
	"sfx.player.parry",
	// docs/DRAFT_REVEAL.md DR4: the boon draft reveal, played by the client's reveal controller (not from sim events):
	// a card flips (pitched up per card), a rare face lands (the chime), a legendary's charge (one short hit played as a
	// rising ladder), the legendary flare (a jingle: it ducks the music), a boon is taken (the stamp)
	"sfx.draft.flip",
	"sfx.draft.rare",
	"sfx.draft.charge",
	"sfx.draft.legendary",
	"sfx.draft.pick",
	// docs/ENEMY_VARIANTS.md EV1: an Imp blinks to its ring, a Summoner calls its swarmers, an Ooze splits, a shield
	// breaks, a Vengeful corpse fires its ring
	"sfx.enemy.blink",
	"sfx.enemy.summon",
	"sfx.enemy.split",
	"sfx.affix.shieldbreak",
	"sfx.affix.vengeful",
	// docs/NEW_BEST.md NB4: the shown score passes the best / the first floor past the deepest (a jingle); a record
	// run's run over, in place of sfx.jingle.gameover (a jingle)
	"sfx.best.new",
	"sfx.jingle.record",
	// docs/BUILDS.md BU1 (builds.ts BUILD_AUDIO_IDS, the same list): a spark arcs, a burst, shards fly, an ember lights,
	// a nova, an execute, an evolution or a duo is taken, a Jackpot pays
	"sfx.build.spark",
	"sfx.build.burst",
	"sfx.build.shard",
	"sfx.build.ember",
	"sfx.build.nova",
	"sfx.build.execute",
	"sfx.build.evolve",
	"sfx.build.duo",
	"sfx.build.jackpot",
	// docs/DAILY.md DS10 / DS12: a daily run's predicted rank enters the top 100 / 10 / 3 / #1 (with the floor shout);
	// the shown score passes a friend's best today (with their toast)
	"sfx.rank.up",
	"sfx.friend.passed",
	// docs/BREAKABLE_DROPS.md BL5: a loaded barrel / crate breaks and its boost hops out (in place of sfx.boost.drop for
	// that landing, which plays while this one is silent)
	"sfx.breakable.loot",
	// docs/NEW_ENEMIES.md NE1: a Bomber's fuse starts / it blasts; a Charger charges / staggers on a wall; lightning
	// strikes a Stormcaller's row; a Reaper starts spinning
	"sfx.enemy.fuse",
	"sfx.enemy.blast",
	"sfx.enemy.charge",
	"sfx.enemy.stun",
	"sfx.enemy.strike",
	"sfx.enemy.spin",
	// docs/PELLETS.md PL6 (pellets.ts PELLET_AUDIO_IDS, the same list): a pellet eaten (the chomp, two alternating
	// pitches from the cue mapper), every pellet of a room taken before its last enemy died (the sweep sting), the power
	// pellet taken (every enemy bullet becomes points)
	"sfx.pellet.eat",
	"sfx.pellet.sweep",
	"sfx.pellet.power",
] as const;

/**
 * Roblox port (docs/FX_AUDIO.md A2): one ambience loop per biome, `amb.b<n>` (b1..b5 = biome.1..5, the decor biome
 * keys). Required, sound or silent (AMBIENCE slot); any other `amb.` ID is an error.
 */
export const AMBIENCE_IDS = ["amb.b1", "amb.b2", "amb.b3", "amb.b4", "amb.b5"] as const;
export type AmbienceId = (typeof AMBIENCE_IDS)[number];

/**
 * Every asset ID a pack must define (biome tile IDs are required through the biome entries). Built inside a function
 * like REQUIRED_STRING_KEYS: the spreads' Luau temporaries were about 25 of this module's top-level locals, which sit
 * near Luau's 200-per-function limit (docs/NEW_BEST.md NB4).
 */
export const REQUIRED_ASSET_IDS: ReadonlyArray<string> = ((): string[] => [
	...CLASS_IDS.map((c) => `class.${c}`),
	...ENEMY_ARCHETYPES.map((e) => `enemy.${e}`),
	...BOSS_IDS,
	...BULLET_IDS,
	...ITEM_IDS,
	...UI_IDS,
	...AUDIO_EVENTS,
	...BREAKABLE_KINDS.map((k) => breakableId(k)),
	...BREAKABLE_AUDIO_EVENTS,
	...PORT_AUDIO_EVENTS,
	...AMBIENCE_IDS,
	...BOOST_KINDS.map((k) => boostId(k)),
	// docs/PELLETS.md PL6: pellets.ts PELLET_IDS, written out (an import would be one more top-level local)
	"pellet.normal",
	"pellet.power",
])();

/**
 * Roblox port (docs/PRELOAD.md P4): the join loading screen's strings (shared/view LOADING_STRINGS): its title, the
 * count under the bar (`{done}` / `{total}`) and the Skip button.
 */
export const LOADING_STRING_KEYS = ["loading.title", "loading.progress", "loading.skip"] as const;

/**
 * Roblox port (docs/STAGE_LOADER.md SL2): the stage loader's cover strings (shared/view STAGE_STRINGS): a ranked run
 * start waiting for the server, floor `{floor}` being generated, the views being rebuilt, the floor-change card's title
 * (`{floor}`) and its boss-floor line. The card's biome line is the pack's `biome.<n>.name`.
 */
export const STAGE_STRING_KEYS = [
	"stage.starting",
	"stage.forging",
	"stage.building",
	"stage.floorCard",
	"stage.bossFloor",
] as const;

/**
 * Roblox port (docs/MOBILE.md MB7): the touch controls' strings (shared/view TOUCH_STRINGS, touchButtonLabelKey): the nine
 * button labels (`touch.<id>`) and the four hint lines that replace the key names on touch. The theme imports nothing
 * outside shared/theme, so the list is repeated here.
 */
export const TOUCH_STRING_KEYS = [
	"touch.attack",
	"touch.alt",
	"touch.roll",
	"touch.ember",
	"touch.flask",
	"touch.swap",
	"touch.shrine",
	"touch.spectateNext",
	"touch.spectatePrev",
	"touch.hint.draft",
	"touch.hint.shrine",
	"touch.hint.spectate",
	"touch.hint.mapClose",
] as const;

/**
 * Roblox port (docs/ROOM_CLEAR.md RC3): the room clear celebration's strings (shared/view ROOM_CLEAR_STRINGS): the
 * two stamps, the stamp for several rooms on one tick (`{stamp}`, `{rooms}`), the tally segments (`{points}`), the
 * running total, the corner chip (`{stamp}`, `{points}`) and the flying bonus (`{points}`). The theme imports nothing
 * outside shared/theme, so the list is repeated here. Then the pellets' two tally segments (docs/PELLETS.md PL6,
 * pellets.ts PELLET_ROOM_CLEAR_KEYS): the pellet points earned in the room and the Sweep bonus.
 */
export const ROOM_CLEAR_STRING_KEYS = [
	"room.clear.stamp.clear",
	"room.clear.stamp.perfect",
	"room.clear.stamp.multi",
	"room.clear.line.kills",
	"room.clear.line.clear",
	"room.clear.line.perfect",
	"room.clear.line.fast",
	"room.clear.total",
	"room.clear.chip",
	"room.clear.fly",
	"room.clear.line.pellets",
	"room.clear.line.sweep",
] as const;

/**
 * Roblox port (docs/COMBO.md CB3): the combo's strings (shared/view COMBO_STRINGS): the four tier names (x2 RAMPAGE, x3
 * CARNAGE, x4 DOMINATING, x5 UNSTOPPABLE; the tier below x2 has no name), the tier slot's COMBO LOST after a break and
 * its BEST x3.4 after a lapse (`{combo}`, the streak's peak, formatted like `hud.score.combo`), the floor shout around
 * a tier's name (`{name}`, "RAMPAGE!") and the run-over best combo with its tier (`{combo}` `{name}`; docs/LOCALIZATION.md
 * L1). The theme imports nothing outside shared/theme, so the list is repeated here.
 */
export const COMBO_STRING_KEYS = [
	"hud.combo.rampage",
	"hud.combo.carnage",
	"hud.combo.dominating",
	"hud.combo.unstoppable",
	"hud.combo.lost",
	"hud.combo.best",
	"hud.combo.shout",
	"hud.combo.bestNamed",
] as const;

/**
 * Roblox port (docs/GRAZE_PARRY.md GP3): the parry flash's strings (shared/view, GP7): PARRY! and the counted form a
 * guard that erased 3 or more bullets shows (`{text}` PARRY!, `{n}` the guard's erase count: "PARRY! x5"). The theme imports
 * nothing outside shared/theme, so the list is repeated here.
 */
export const NEAR_MISS_STRING_KEYS = ["fx.parry.text", "fx.parry.count"] as const;

/**
 * Every string key a pack must define. Code may rely on these existing. Built inside a function: the spreads' Luau
 * temporaries would otherwise be top-level locals, and this module's compiled Luau sits near the 200-locals-per-function
 * limit (docs/ROOM_CLEAR.md RC3).
 */
export const REQUIRED_STRING_KEYS: ReadonlyArray<string> = ((): string[] => [
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
	...BOOST_STRING_KEYS,
	...LOADING_STRING_KEYS,
	...STAGE_STRING_KEYS,
	...TOUCH_STRING_KEYS,
	...ROOM_CLEAR_STRING_KEYS,
	...COMBO_STRING_KEYS,
	...NEAR_MISS_STRING_KEYS,
	...ENEMY_VARIANT_STRING_KEYS,
	// docs/NEW_BEST.md NB4: the target row, the floor shout, the stairwell line, the run-over panel, the menu line
	...NEW_BEST_STRING_KEYS,
	// docs/BUILDS.md BU1: builds.ts BUILD_STRING_KEYS, written out (an import would be one more top-level local)
	"hud.draft.level",
	"hud.draft.evolve",
	"hud.draft.duo",
	"hud.draft.again",
	"hud.toast.evolved",
	"hud.toast.duo",
	"hud.build.title",
	// docs/DAILY.md DS9 / DS11: the main menu's Daily card and podium, the leaderboard tabs, the run-over daily block
	...DAILY_STRING_KEYS,
	// docs/DAILY.md DS2: the stage card's roster line (floor 1's kinds, a floor's new kinds)
	...ROSTER_STRING_KEYS,
	// docs/DAILY.md DS10: new best's "best today" wording, the rank layer's target row, toasts, shouts, run-over row
	...DAILY_RANK_STRING_KEYS,
	// docs/LOCALIZATION.md L1: named keys' labels (`input.key.<name>`) and the key list joiner
	...INPUT_KEY_STRING_KEYS,
])();

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

/**
 * Roblox port (docs/BOOSTS.md B5): one identity colour per boost kind (BOOST_KINDS order), the placeholder gem's tint
 * and the HUD row's / aura's colour. A pickup lies on the floor among bullets, so the validator holds every one to
 * MIN_BOOST_CONTRAST against every biome floor and wall and to MIN_BOOST_BULLET_DIFFERENCE (CIE76) from every
 * ENEMY_BULLET_ROLES colour (`boostColorReport`), exactly as it holds `enemyOutline`.
 */
export const BOOST_ROLES: ReadonlyArray<ColorRole> = BOOST_KINDS.map((k) => boostId(k));

/** Minimum WCAG contrast of every BOOST_ROLES colour on every biome floor and wall (enemyOutline's bar). */
export const MIN_BOOST_CONTRAST = 3.0;

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
	// void dressing (docs/VOID_DECOR.md VD7): the Lords of Pain `tiles` flagstone patch on shoulder tops near rooms, the
	// `wall1` low curb along shoulder edges (low only: a curb is never a tall piece). Inline arrays: this module's
	// compiled Luau sits near the 200-locals limit.
	flagstones: FLAT_SPOT,
	curb: ["low"] as const,
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
	"brokenBarrel",
	"brokenCrate",
	"torch",
	"banner",
	"flagstones",
	"curb",
];

/**
 * Roblox port (docs/VOID_DECOR.md VD7, VDD3): optional per-biome void art, `decor.void.b<n>.<kind>[.<v>]`, drawn on the
 * void's shoulder (or rising from the abyss) only when a pack fills it, under the same footprint rule as every void
 * piece. No pack has to; any kind is accepted in any biome (the plan's biome wishes, frost spire / drift, molten vent /
 * crag, grim grave / deadtree, verdant root / bush, ancient statue, are art direction, not rules). Layers per kind
 * (`layers`): the standing tall shapes (spire, crag, deadtree, statue, grave) may be drawn tall or low, like the decor
 * plan's far-wall pieces; the short ones (vent, bush, root) low only; a snow drift lies flat. One table (kinds in
 * declaration order, layers, ID prefix), so this module's compiled Luau gains one local (it sits near Luau's 200).
 */
export const VOID_DECOR = {
	prefix: "decor.void.",
	kinds: ["spire", "drift", "vent", "crag", "grave", "deadtree", "root", "bush", "statue"],
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
	},
} as const satisfies {
	prefix: string;
	kinds: ReadonlyArray<string>;
	layers: Record<string, ReadonlyArray<DecorLayer>>;
};
export type VoidDecorKind = (typeof VOID_DECOR.kinds)[number];

/** A piece may have numbered variants `decor.delve.b<n>.<kind>.<v>`, v in 1..DECOR_MAX_VARIANTS (bones1..3, ...). */
export const DECOR_MAX_VARIANTS = 4;

/** A piece's outline (ImageAsset.outline, SpriteSetAsset.outlines) is a polygon: at least this many points. */
export const DECOR_MIN_OUTLINE_POINTS = 3;

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
 * (`vfx/glow`), `glint` the treasure sparkle (`vfx/glint`), `zone` the ring on an open stairwell (`vfx/zone`), `loot`
 * the twinkle on a loaded barrel or crate (docs/BREAKABLE_DROPS.md; the vale pack's is original art,
 * scripts/art/gen-loot-glint.js; a pack without it shows `glint` there instead).
 */
export const DECOR_FX_NAMES = ["torch", "flame", "glow", "glint", "zone", "loot"] as const;
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
 * Roblox port (docs/BOOSTS.md B5): minimum CIE76 colour difference between every BOOST_ROLES colour and every
 * ENEMY_BULLET_ROLES colour, so a pickup never reads as a bullet: the decor fx / enemy outline bar.
 */
export const MIN_BOOST_BULLET_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (player outline, step 1): minimum WCAG contrast ratio between `playerOutline` and every biome floor and
 * wall, at full light and (shared/view decorBandContrastReport, run by its spec for every bundled pack) at the darkest
 * decor band. The rim is what finds your own character in a crowded room, so it takes the enemy outline's graphics bar.
 */
export const MIN_PLAYER_OUTLINE_CONTRAST = MIN_ENEMY_OUTLINE_CONTRAST;

/**
 * The colours the player outline must never be mistaken for (player outline, step 1): the threats (the enemy bullets,
 * `telegraph`, the `enemyOutline` rim, so the player never reads as an enemy) and every boost colour (a boost's aura is
 * drawn on the player, around the rim).
 */
export const PLAYER_OUTLINE_DIFFERENCE_ROLES: ReadonlyArray<ColorRole> = [
	...ENEMY_BULLET_ROLES,
	"telegraph",
	"enemyOutline",
	...BOOST_ROLES,
];

/**
 * Minimum CIE76 colour difference between `playerOutline` and every PLAYER_OUTLINE_DIFFERENCE_ROLES colour: the decor
 * fx / enemy outline bar. The placeholder rim #f4f1ea (minimap.self, the map's "you") is >= 49 from all of them.
 */
export const MIN_PLAYER_OUTLINE_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (docs/ROOM_EDGES.md RE4): the dashed line on the floor where a corridor meets a room, one colour per
 * room state, in RoomEdgeState order (index = shared/view RoomEdgeState: SAFE 0, WAITING 1, LIVE 2). Required in every
 * pack like every role. A value ramp (dim -> grey -> near-white), not hues: the validator (`roomEdgeReport`) holds
 * waiting and live to MIN_ROOM_EDGE_CONTRAST on every biome floor and all three to MIN_ROOM_EDGE_DIFFERENCE (CIE76)
 * from ROOM_EDGE_DIFFERENCE_ROLES.
 */
export const ROOM_EDGE_ROLES: ReadonlyArray<ColorRole> = ["roomEdge.safe", "roomEdge.waiting", "roomEdge.live"];

/**
 * The room-edge roles held to MIN_ROOM_EDGE_CONTRAST on every biome floor (docs/ROOM_EDGES.md RE4). The lines lie on
 * floors, never on walls, so walls are not checked; `roomEdge.safe` is meant to recede and has no contrast floor.
 */
export const ROOM_EDGE_CONTRAST_ROLES: ReadonlyArray<ColorRole> = ["roomEdge.waiting", "roomEdge.live"];

/**
 * Roblox port (docs/ROOM_EDGES.md RE4): minimum WCAG contrast ratio between every ROOM_EDGE_CONTRAST_ROLES colour and
 * every biome floor. WCAG's bar for graphics, like the enemy outline's (MIN_ENEMY_OUTLINE_CONTRAST).
 */
export const MIN_ROOM_EDGE_CONTRAST = 3.0;

/**
 * The colours a room edge must never be mistaken for (docs/ROOM_EDGES.md RE4): the enemy bullets and `telegraph`, the
 * other dashed floor lines that mean danger.
 */
export const ROOM_EDGE_DIFFERENCE_ROLES: ReadonlyArray<ColorRole> = [...ENEMY_BULLET_ROLES, "telegraph"];

/**
 * Roblox port (docs/ROOM_EDGES.md RE4): minimum CIE76 colour difference between every ROOM_EDGE_ROLES colour and every
 * ROOM_EDGE_DIFFERENCE_ROLES colour: the decor fx / enemy outline bar. A red "live" line fails it (#ff6a6a is 35 from
 * the placeholder telegraph #ff8a3d).
 */
export const MIN_ROOM_EDGE_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (docs/MINIMAP.md M6): the minimap's colours (shared/view/minimap paint and markers). Required in every
 * pack like every role. UI colours, drawn over `uiPanel` (the unknown fog), never on a biome floor: the tiles (floor,
 * wall, pool, frontier) and the markers (self, enemy, boss, stairs, boost). The validator (`minimapReport`) holds the
 * markers to MIN_MINIMAP_MARKER_CONTRAST on `minimap.floor`, on `uiPanel` and on every tinted room floor
 * (MINIMAP_TINT_ROLES mixed into `minimap.floor` at MINIMAP_ROOM_TINT_MIX), and `minimap.enemy` to
 * MIN_MINIMAP_ENEMY_DIFFERENCE (CIE76) from MINIMAP_ENEMY_DIFFERENCE_ROLES.
 */
export const MINIMAP_ROLES: ReadonlyArray<ColorRole> = [
	"minimap.floor",
	"minimap.wall",
	"minimap.pool",
	"minimap.frontier",
	"minimap.self",
	"minimap.enemy",
	"minimap.boss",
	"minimap.stairs",
	"minimap.boost",
];

/** The minimap markers (docs/MINIMAP.md M6): held to MIN_MINIMAP_MARKER_CONTRAST on MINIMAP_MARKER_BACKGROUNDS. */
export const MINIMAP_MARKER_ROLES: ReadonlyArray<ColorRole> = [
	"minimap.self",
	"minimap.enemy",
	"minimap.boss",
	"minimap.stairs",
	"minimap.boost",
];

/** What a minimap marker is drawn over: a seen floor tile and the panel itself (the unknown fog). */
export const MINIMAP_MARKER_BACKGROUNDS: ReadonlyArray<ColorRole> = ["minimap.floor", "uiPanel"];

/**
 * Roblox port (docs/MINIMAP.md M5, review fix): how far a seen room's floor moves toward its room-edge state colour
 * (MINIMAP_TINT_ROLES) on the map, 0..1. Owned here, not in shared/view/minimap MINIMAP_VIEW (which reads it as
 * `roomTintMix`), because the validator checks the markers on the tinted floors it makes. 0.1 (was 0.35): the live
 * tint is the near-white roomEdge.live, so at 0.35 the enemy dot fell to 1.2:1 on a live room's floor.
 */
export const MINIMAP_ROOM_TINT_MIX = 0.1;

/** The colours a seen room's floor is tinted toward (one per room-edge state, docs/ROOM_EDGES.md). */
export const MINIMAP_TINT_ROLES: ReadonlyArray<ColorRole> = ROOM_EDGE_ROLES;

/**
 * Roblox port (docs/MINIMAP.md M6): minimum WCAG contrast ratio between every MINIMAP_MARKER_ROLES colour and every
 * MINIMAP_MARKER_BACKGROUNDS colour. WCAG's bar for graphics, like the enemy outline's and the room edges'.
 */
export const MIN_MINIMAP_MARKER_CONTRAST = 3.0;

/**
 * The colours an enemy dot must never be mistaken for (docs/MINIMAP.md M6): the watched player's arrow, a boost glint
 * and every teammate dot (the `class.*` roles), so a hostile dot never reads as a friend or a pickup.
 */
export const MINIMAP_ENEMY_DIFFERENCE_ROLES: ReadonlyArray<ColorRole> = [
	"minimap.self",
	"minimap.boost",
	...CLASS_IDS.map((c) => `class.${c}` as ColorRole),
];

/**
 * Roblox port (docs/MINIMAP.md M6): minimum CIE76 colour difference between `minimap.enemy` and every
 * MINIMAP_ENEMY_DIFFERENCE_ROLES colour: the decor fx / enemy outline bar. An enemy dot in `class.ranger` green fails
 * (0), and a warm red like the outline's #ff3b30 does too (39 from the placeholder `class.pyromancer` #d9784a).
 */
export const MIN_MINIMAP_ENEMY_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (docs/COMBO.md CB3, CD10): the combo's colours (shared/view/hud COMBO_TIERS, the meter, the multiplier,
 * the tier name and the floor shout). Required in every pack like every role. One per named tier (x2 rampage, x3
 * carnage, x4 dominating, x5 unstoppable; the tier below x2 keeps `ember`), then `combo.broken`, the grey of a broken
 * streak. The validator (`comboReport`) holds them to COMBO_COLOR_RULES.
 */
export const COMBO_ROLES: ReadonlyArray<ColorRole> = [
	"combo.rampage",
	"combo.carnage",
	"combo.dominating",
	"combo.unstoppable",
	"combo.broken",
];

/**
 * The combo's ladder, one colour per tier in tier order (index = shared/view/hud comboTier: 0 none, 1 rampage .. 4
 * unstoppable): `ember` (today's meter gold) below x2, then the four named tiers. Each is drawn on `uiPanel` (the score
 * panel), and each step up must read as a new colour.
 */
export const COMBO_TIER_ROLES: ReadonlyArray<ColorRole> = [
	"ember",
	"combo.rampage",
	"combo.carnage",
	"combo.dominating",
	"combo.unstoppable",
];

/** What `comboReport` checks against what, and the bars (COMBO_COLOR_RULES). */
export interface ComboColorRules {
	/** The ladder (COMBO_TIER_ROLES), each held to `minPanelContrast` on `panel` and `minStepDifference` from the one below. */
	readonly tiers: ReadonlyArray<ColorRole>;
	/** What the meter, multiplier and tier name are drawn over: the score panel. */
	readonly panel: ColorRole;
	/** The named tiers (`tiers` without `ember`): the floor shout is drawn in these, in the world. */
	readonly shouted: ReadonlyArray<ColorRole>;
	/**
	 * The colours a shout must never be mistaken for (docs/COMBO.md CD9): the enemy bullets and `telegraph`. The shout is
	 * painted on the floor under them, so a bullet crossing it must still read as a bullet.
	 */
	readonly shoutAgainst: ReadonlyArray<ColorRole>;
	/** The broken streak's grey (the meter and multiplier after a break). */
	readonly broken: ColorRole;
	/** WCAG contrast of every tier on `panel`: the graphics bar, like the room edges' and the minimap markers'. */
	readonly minPanelContrast: number;
	/**
	 * CIE76 between consecutive tiers (ember -> rampage -> ... -> unstoppable), so every tier-up is a visible colour
	 * change (the tier name carries the meaning too; the colour is its twin).
	 */
	readonly minStepDifference: number;
	/**
	 * CIE76 between every `shouted` colour and every `shoutAgainst` colour: the decor fx / enemy outline bar. The plan's
	 * starting coral #ff7a59 failed it (19.5 from the placeholder telegraph #ff8a3d), as did its crimson #ff3b6b (31.1)
	 * and magenta #e04bd6 (32.1) against the pink bullet #ff3fa4.
	 */
	readonly minShoutDifference: number;
	/** CIE LCh chroma C* (sqrt(a*^2 + b*^2), `labChroma`) of `broken`, at most: it reads as grey, not as another tier. */
	readonly maxBrokenChroma: number;
	/** CIE76 between `broken` and every tier. */
	readonly minBrokenDifference: number;
}

/**
 * Roblox port (docs/COMBO.md CB3): the combo colour rules (`comboReport`). One object, so the validator imports one
 * name: its compiled Luau module sits at the 200-locals-per-function limit.
 */
export const COMBO_COLOR_RULES: ComboColorRules = {
	tiers: COMBO_TIER_ROLES,
	panel: "uiPanel",
	shouted: ["combo.rampage", "combo.carnage", "combo.dominating", "combo.unstoppable"],
	shoutAgainst: [...ENEMY_BULLET_ROLES, "telegraph"],
	broken: "combo.broken",
	minPanelContrast: 3.0,
	minStepDifference: 25,
	minShoutDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
	maxBrokenChroma: 10,
	minBrokenDifference: 40,
};

/**
 * Roblox port (docs/GRAZE_PARRY.md GP3): the near misses' colours (shared/view/fx, GP5 / GP7). Required in every pack
 * like every role: `nearMiss.graze`, the white-cyan spark where a bullet skimmed past, and `nearMiss.parry`, the
 * gold-white burst at every bullet a guard erased and the PARRY! floor text. Both are drawn in the world, on the floor
 * and among bullets, so the validator (`nearMissReport`) holds them to NEAR_MISS_COLOR_RULES.
 */
export const NEAR_MISS_ROLES: ReadonlyArray<ColorRole> = ["nearMiss.graze", "nearMiss.parry"];

/** What `nearMissReport` checks against what, and the bars (NEAR_MISS_COLOR_RULES). */
export interface NearMissColorRules {
	/** The roles checked (NEAR_MISS_ROLES). */
	readonly roles: ReadonlyArray<ColorRole>;
	/** WCAG contrast of every role on every biome floor (walls are not checked: sparks and text lie on floors). */
	readonly minFloorContrast: number;
	/**
	 * The colours a spark or the PARRY! text must never be mistaken for: the enemy bullets and `telegraph`. Sparks fly
	 * among bullets and the text is painted on the floor under them (the combo shout's construction, docs/COMBO.md CD9).
	 */
	readonly against: ReadonlyArray<ColorRole>;
	/** CIE76 between every role and every `against` colour: the decor fx / enemy outline bar. */
	readonly minDifference: number;
}

/**
 * Roblox port (docs/GRAZE_PARRY.md GP3): the near-miss colour rules (`nearMissReport`). One object holding the roles
 * too, so the validator imports one name: its compiled Luau module sits at the 200-locals-per-function limit, as this
 * one nearly does (so no spread here: `against` is the room edges' list, the enemy bullets and `telegraph`, whose
 * temporaries would be top-level locals).
 */
export const NEAR_MISS_COLOR_RULES: NearMissColorRules = {
	roles: NEAR_MISS_ROLES,
	minFloorContrast: 3.0,
	against: ROOM_EDGE_DIFFERENCE_ROLES,
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/**
 * Roblox port (docs/DRAFT_REVEAL.md DR3, DRD3): the boon draft's rarity colours in rarity order (common, rare,
 * legendary; shared/view/hud RARITY_COLOR_ROLES): the card names, the rarity stroke and the owned-boon icons. Bone,
 * blood red and candle gold from the ToffeeCraft Horror UI sheet, so legendary is the brightest colour on the card.
 * Required in every pack like every role; the loot `rarity.*` roles are separate. Held to BOON_RARITY_COLOR_RULES by
 * `boonRarityReport`.
 */
export const BOON_RARITY_ROLES: ReadonlyArray<ColorRole> = ["boon.common", "boon.rare", "boon.legendary"];

/**
 * The boon rarity rules (`boonRarityReport`): every `roles` colour >= `minPanelContrast` (WCAG, the graphics bar) on
 * `panel` (the draft card is drawn over the HUD's panel colour) and >= `minStepDifference` (CIE76) from the rarity below
 * it, so each step up the ladder reads as a new colour. One object, so the validator imports one name (its compiled
 * Luau sits near the 200-locals-per-function limit).
 */
export const BOON_RARITY_COLOR_RULES = {
	// The rarity ladder (BOON_RARITY_ROLES), then docs/BUILDS.md's evolution and duo card frames (builds.ts
	// BOON_BUILD_ROLES) on top of it, written out (a spread here would be top-level Luau temporaries).
	roles: ["boon.common", "boon.rare", "boon.legendary", "boon.evolved", "boon.duo"] as ReadonlyArray<ColorRole>,
	panel: "uiPanel" as ColorRole,
	minPanelContrast: 3.0,
	minStepDifference: 25,
} as const;

/**
 * Roblox port (docs/DRAFT_REVEAL.md DR3, DRD12): the boon draft's card art, optional free-form ui images (any pack may
 * leave any of them out; the overlay then draws today's flat card, and a missing skull leaves the legendary's corners
 * plain). Cut from the ToffeeCraft Horror UI sheet and 9-sliced (ImageAsset `slice`):
 *   - `ui.draft.back`: every card's back (the skull-and-chain panel);
 *   - `ui.draft.back.eyes`: a white mask of the back's skull eye sockets, the same size, registration and `slice` as
 *     the back, tinted red over it during a legendary's charge;
 *   - `ui.draft.card.common` / `ui.draft.card.rare`: the faces (plain panel; studded red-trimmed panel with a tab, which
 *     the legendary face reuses);
 *   - `ui.draft.skull.left` / `ui.draft.skull.right`: the red-eyed skulls on the legendary face's top corners, not
 *     sliced; their `pivot` sits on the face panel's outer frame corner.
 * A function, not a constant: this module's compiled Luau sits near the 200-locals-per-function limit.
 */
export function draftSkinIds(): ReadonlyArray<string> {
	return [
		"ui.draft.back",
		"ui.draft.back.eyes",
		"ui.draft.card.common",
		"ui.draft.card.rare",
		"ui.draft.skull.left",
		"ui.draft.skull.right",
	];
}

/**
 * Roblox port (docs/UI_ART.md UA4, Architecture 2): the UI skin's 9-sliced pieces, optional free-form ui images (a pack
 * may leave out any of them; the primitive then draws today's flat look, shared/view/hud skin.ts `skinFor`). Each is its
 * own image with a `slice`, cut from the ToffeeCraft Horror UI sheet:
 *   - `ui.panel.menu` / `.hud` / `.tall`: panel frames (menus: red-rimmed and tabbed; in a run: dark rounded; lists);
 *   - `ui.button` / `.focus` / `.disabled`: the menu button (normal; focused or active: red fill; disabled);
 *   - `ui.option.on` / `.off`: an Options value (the chosen one; the others);
 *   - `ui.bar.track` / `.fill`: a pill bar (the fill is white, tinted by a role);
 *   - `ui.slot.pair` / `ui.slot`: the weapon panel's two-slot frame and one slot.
 * A function, not a constant: this module's compiled Luau sits near the 200-locals-per-function limit.
 */
export function uiSkinIds(): ReadonlyArray<string> {
	return [
		"ui.panel.menu",
		"ui.panel.hud",
		"ui.panel.tall",
		"ui.button",
		"ui.button.focus",
		"ui.button.disabled",
		"ui.option.on",
		"ui.option.off",
		"ui.bar.track",
		"ui.bar.fill",
		"ui.slot.pair",
		"ui.slot",
	];
}

/**
 * Roblox port (docs/UI_ART.md UA4, UAD10): the UI skin's small fixed-size pieces, optional free-form ui images packed
 * into ONE icon atlas: each is an `image` of the whole atlas with a `rect` (the piece) and maybe a `pivot` (pixels from
 * the rect's top-left). A pack that has the atlas has all of them (all or nothing). The focus bracket, chips (`.white`:
 * tinted by a role), hearts, flasks, the candle, a caret, a divider, the touch ring and button, and the glyphs.
 * A function, not a constant: this module's compiled Luau sits near the 200-locals-per-function limit.
 */
export function uiIconIds(): ReadonlyArray<string> {
	return [
		"ui.ornament.bones",
		"ui.focus.corner",
		"ui.chip",
		"ui.chip.white",
		"ui.heart.full",
		"ui.heart.half",
		"ui.heart.empty",
		"ui.flask.full",
		"ui.flask.empty",
		"ui.candle",
		"ui.caret",
		"ui.divider",
		"ui.stick.ring",
		"ui.touch.button",
		"ui.icon.pause",
		"ui.icon.check",
		"ui.icon.cross",
		"ui.icon.help",
		"ui.icon.gear",
		"ui.icon.home",
		"ui.icon.speaker",
		"ui.icon.mute",
		"ui.icon.coin",
		"ui.icon.skull",
		"ui.icon.skull.curse",
		"ui.icon.ghost",
		"ui.icon.rip",
	];
}

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

// ---------------------------------------------------------------------------------------------
// Effects and audio (Roblox port, docs/FX_AUDIO.md A2, F1)

/** Biome `biome`'s ambience loop: ambienceId("biome.2") = "amb.b2". */
export function ambienceId(biome: BiomeId): AmbienceId {
	return `amb.${decorBiomeKey(biome)}` as AmbienceId;
}

/** Is `id` one of AMBIENCE_IDS? */
export function isAmbienceId(id: string): id is AmbienceId {
	return (AMBIENCE_IDS as ReadonlyArray<string>).includes(id);
}

/**
 * The PlaybackSpeed range a sound's `pitch` jitter may span (SoundAsset.pitch): half to double speed. Beyond it a clip
 * stops sounding like itself. Renderers clamp to it too (ThemeCore.sound).
 */
export const SOUND_PITCH_LIMITS = { min: 0.5, max: 2 } as const;

/**
 * The sprite effects (fx.*), each optional. Hit marks (`hit.light` / `hit.heavy`), the sword's swing trails (`swing.1`
 * .. `swing.3`, the 3rd is the finisher), the kill puff, roll dust, the guard shield, the Ember ring, the flask, the
 * boss's phase change / slam / death, relic and shrine, the open-stairwell loop and a breakable's splinters; then the
 * boost drops' pickup burst and per-kind aura (BOOST_FX_IDS, docs/BOOSTS.md B5).
 */
export const FX_IDS = [
	"fx.hit.light",
	"fx.hit.heavy",
	"fx.swing.1",
	"fx.swing.2",
	"fx.swing.3",
	"fx.death.puff",
	"fx.roll.dust",
	"fx.guard.shield",
	"fx.ember.ring",
	"fx.flask",
	"fx.boss.phase",
	"fx.boss.slam",
	"fx.boss.death",
	"fx.relic.take",
	"fx.shrine.use",
	"fx.stairwell",
	"fx.breakable.splinter",
	...BOOST_FX_IDS,
] as const;
export type FxId = (typeof FX_IDS)[number];

/** Is `id` one of FX_IDS? */
export function isFxId(id: string): id is FxId {
	return (FX_IDS as ReadonlyArray<string>).includes(id);
}

/**
 * Largest drawn sprite effect, world tiles on the cell's longer side (SpriteSetAsset.sizeTiles, or the cell's own
 * size / pixelsPerTile). Readability: effects stay small next to bullets and telegraphs. ThemeCore.fx clamps to it.
 */
export const FX_SPRITE_MAX_TILES = 3;

/**
 * The port's effect colour roles with no other use (`fx.heal` for `fx.flask`, `fx.curse` for the shrine). Required in
 * every pack like every role; held to MIN_FX_BULLET_DIFFERENCE from every ENEMY_BULLET_ROLES colour.
 */
export const FX_ROLES: ReadonlyArray<ColorRole> = ["fx.heal", "fx.curse"];

/**
 * Minimum CIE76 difference between an effect colour and every enemy-bullet colour: FX_ROLES, every fx entry's `tint`
 * role, and an untinted entry's `meanColor`. The decor fx rule (MIN_DECOR_FX_BULLET_DIFFERENCE), applied to effects.
 */
export const MIN_FX_BULLET_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

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

/**
 * Sound-asset keys that contain a gameplay word but are presentation (docs/FX_AUDIO.md A2): `minInterval` throttles
 * how often a clip may restart, it changes no difficulty. The gameplay-key scan skips exactly these keys on a
 * `sound` asset; anywhere else they are still flagged.
 */
export const SOUND_PRESENTATION_KEYS: ReadonlyArray<string> = ["minInterval"];
