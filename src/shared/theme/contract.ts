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
 */

import type { AssetKind, ColorRole, ParticleFlipbookMode, Pivot } from "./types";
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
];

/** Slots whose images are free-size world art drawn at `pixelsPerTile` (decor pieces, breakables, boost drops). */
export const WORLD_ART_SLOTS: ReadonlyArray<SlotContract> = [DECOR, BREAKABLE, BOOST];

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
 * attack.1..3, boss attack.2 / attack.3 / attack.4 / intro / taunt; empty for the other slots. A copy. Never required
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
 * The strings every boost kind has: `name` ("Fury"), `desc` (what it does, e.g. "+50% damage for 10 s") and `icon`
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
 * Roblox port (docs/FX_AUDIO.md A2): every other audio ID the port plays, required in every pack (silent in the
 * placeholder pack). Kept apart from AUDIO_EVENTS, which stays the web build's list, like BREAKABLE_AUDIO_EVENTS.
 * First the IDs the audio layer already played before A2 (shared/view/audio PORT_SFX, which only the placeholder pack
 * listed), then the A2 additions: menu back / focus move, the sword finisher, the bow's full charge, room clear, relic
 * and shrine, stairwell, new floor, depth up, the run-over jingle, and the tutorial / lobby tracks. Then the Demon
 * Lord's (docs/BOSS_DEMONLORD.md D6): sfx.boss.taunt, a taunting boss's phase change (the roar plays while it is
 * silent). Then the boost drops' four (docs/BOOSTS.md B5).
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
] as const;

/**
 * Roblox port (docs/FX_AUDIO.md A2): one ambience loop per biome, `amb.b<n>` (b1..b5 = biome.1..5, the decor biome
 * keys). Required, sound or silent (AMBIENCE slot); any other `amb.` ID is an error.
 */
export const AMBIENCE_IDS = ["amb.b1", "amb.b2", "amb.b3", "amb.b4", "amb.b5"] as const;
export type AmbienceId = (typeof AMBIENCE_IDS)[number];

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
	...PORT_AUDIO_EVENTS,
	...AMBIENCE_IDS,
	...BOOST_KINDS.map((k) => boostId(k)),
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
	...BOOST_STRING_KEYS,
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
 * Roblox port (docs/BOOSTS.md B5): minimum CIE76 colour difference between every BOOST_ROLES colour and every
 * ENEMY_BULLET_ROLES colour, so a pickup never reads as a bullet: the decor fx / enemy outline bar.
 */
export const MIN_BOOST_BULLET_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

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
