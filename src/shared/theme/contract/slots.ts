/** The theme contract's slots (docs/CODEBASE_SCALE.md DX8: a pure move out of contract.ts): what each ID prefix may hold and the sprite contracts. Import from "shared/theme" or "./contract", never from this file. */
import type { AssetKind, Pivot } from "../types";
import { startsWith } from "../util";

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
	/**
	 * v2 `sprites` kind (docs/PROJECTILE_ART.md PA3): the screen direction the art's frames point in, the direction of
	 * travel the renderer turns along the velocity. Bullets only ("up"); absent for slots whose art is not turned.
	 */
	readonly heading?: "up";
	/**
	 * v2 `sprites` kind (docs/GOO_ART.md GA2): per asset ID, the base animations a set with that ID defines INSTEAD of
	 * `baseAnimations` / `animationOrder` (the goo puddle's floor sprite: land, hold). Absent: every ID the slot's.
	 */
	readonly idBaseAnimations?: Readonly<Record<string, ReadonlyArray<string>>>;
}

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
 * gameplay timer (absent: the builder's fallback, Mother Mayhem's intro -> taunt, else what plays without them). The
 * Demon Lord uses attack.2 / intro / taunt; Mother Mayhem FAN `attack`, RINGs `attack.2`, SPIRAL `attack.3`, SLAM
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
	// docs/NEW_ENEMIES_2.md NX7: `block`, a loop in place of `idle` (falls back to `idle`): the Shieldwall guarding
	// (shared/view newEnemies2Config NEW_ENEMY_2_SPRITE_VIEW.anims). docs/NEW_ENEMIES_3.md NT7: `crouch` (falls back to
	// `attack`): the Jackal's wind-up; `hop` (no fallback: skipped): the Jackal's spooked hop back (shared/view
	// newEnemies3Config NEW_ENEMY_3_SPRITE_VIEW.anims; NT8 maps Crouch / BackFlip 1).
	// Inline, not a top-level constant: the compiled contract.luau sits near Luau's 200-locals limit.
	optionalAnimations: ["attack.2", "death.2", "move.back", "block", "crouch", "hop"],
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

/**
 * Roblox port (docs/PROJECTILE_ART.md PA3): the BULLET slot's `sprites` rules, one table (contract.luau sits near Luau's
 * 200-locals limit). `animation`: the one loop a flying bullet's set defines (the slot's base animation); `maxFrames`:
 * its largest frame count; `hitFx`: the optional player bullet impact effect (an FX_IDS entry, PA7, PAD11: never for
 * enemy bullets).
 * docs/GOO_ART.md GA2: `floorSpriteIds` (the goo puddle) may take a FLOOR sprite set instead: one facing, never turned
 * (the art is a 3/4 view, drawn screen-up), the animations `land` (`landFrames` cell: the drop hitting the floor) and
 * `hold` (1..`maxFrames` cells: variants picked per puddle, not a flipbook), a `meanColor` and the hold frame's lit
 * box `lit` ({ w, h }, art px), held to gooArt.ts `gooArtReport`. Declared before BULLET, whose per-ID animations
 * read it.
 * docs/HAZARD_ART.md HA3 (supersedes PAD3's `decalIds`): `hazardSpriteIds`, the floor hazards (the Stormcaller's strike,
 * the build embers), may take a HAZARD sprite set: one facing, greyscale (the renderer tints it with the hazard's own
 * colour role, so its `meanColor` must be a grey), at most `maxHazardFrames` cells per animation. The strike defines
 * `flash` (played over its life) and `scorch` (hot, then cold: what the view leaves after it) and its hit rim
 * `rimPx` (art px from the pivot); the ember defines `burn` (a loop) and its burning patch `lit` ({ w, h }, centred on
 * the pivot). Held to hazardArt.ts `hazardArtReport`; without art both keep their placeholder discs.
 */
export const BULLET_ART = {
	animation: "fly",
	maxFrames: 4,
	floorSpriteIds: ["bullet.enemy.goo"] as ReadonlyArray<string>,
	land: "land",
	hold: "hold",
	landFrames: 1,
	hazardSpriteIds: ["bullet.enemy.strike", "bullet.player.ember"] as ReadonlyArray<string>,
	flash: "flash",
	scorch: "scorch",
	burn: "burn",
	maxHazardFrames: 8,
	hitFx: "fx.bullet.hit",
} as const;

/**
 * Bullets. The 16 px `spritesheet` kind (the web build's) is drawn at one cell size, scaled to the gameplay radius.
 * Roblox port (docs/PROJECTILE_ART.md PA3): a bullet may also be a v2 `sprites` set like an effect (FX): its own cell,
 * ONE facing, the `fly` loop (BULLET_ART.animation, 1..BULLET_ART.maxFrames frames from the art), art pointing
 * screen-up (`heading`), plus a required `meanColor` held to the bullet colour rules (bulletArt.ts `bulletArtReport`).
 * The cell / pivot / `fly: 2` below are the spritesheet kind's, unchanged.
 * docs/GOO_ART.md GA2: a BULLET_ART.floorSpriteIds set (the goo puddle) defines `land` / `hold` instead of `fly`
 * (`idBaseAnimations`; the ID is written out: BULLET_ART.floorSpriteIds[0], pinned by gooArt.spec).
 * docs/HAZARD_ART.md HA3: likewise the hazards, the strike `flash` / `scorch`, the ember `burn` (IDs written out,
 * pinned by hazardArt.spec).
 */
export const BULLET: SlotContract = {
	slot: "bullet",
	prefix: "bullet.",
	kinds: ["spritesheet", "sprites", "placeholder"],
	cell: { w: 8, h: 8 },
	pivot: { x: 4, y: 4 },
	animations: { fly: 2 },
	animationOrder: ["fly"],
	facings: [],
	heading: "up",
	idBaseAnimations: {
		"bullet.enemy.goo": [BULLET_ART.land, BULLET_ART.hold],
		"bullet.enemy.strike": [BULLET_ART.flash, BULLET_ART.scorch],
		"bullet.player.ember": [BULLET_ART.burn],
	},
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

/**
 * Roblox port (docs/TREASURE.md TR6, Design §5): a vault's chest, closed and open, and the cage over it until the vault
 * unlocks (treasure.ts TREASURE_IDS: `treasure.chest`, `treasure.chestopen`, `treasure.cage`). A gameplay object (the
 * chest blocks movement and bullets), so every pack must draw all three, with placeholder primitives (a low box, a lid
 * wedge, a row of thin bars) until art exists. Free-size world art like PELLET: `image` (with `pixelsPerTile`) or
 * `sprites` (`idle`). Any other `treasure.` ID is an error. One top-level local here (contract.luau's 200 limit).
 */
export const TREASURE: SlotContract = {
	slot: "treasure",
	prefix: "treasure.",
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
	TREASURE,
	/**
	 * Roblox port (docs/FORTUNE.md FO6): PACT, a pact altar in the shrine room (fortune.ts PACT_ALTAR_ID: `pact.altar`).
	 * A gameplay object, so every pack must draw it, with a placeholder primitive (a stone plinth) until art exists.
	 * Free-size world art like PELLET: `image` (with `pixelsPerTile`) or `sprites` (`idle`). Any other `pact.` ID is an
	 * error. Written inline, not as a named constant: this module's compiled Luau sits near the 200-locals limit
	 * (fortune.ts exports it as `PACT`, found by its prefix).
	 */
	{
		slot: "pact",
		prefix: "pact.",
		kinds: ["image", "sprites", "placeholder"],
		facings: [],
		baseAnimations: ["idle"],
	},
	/**
	 * Roblox port (docs/SECRET_ROOMS.md SR10): SECRET, a secret room's crack overlay and the rubble left after the open
	 * (secrets.ts SECRET_ART_IDS: `secret.crack`, `secret.rubble`). OPTIONAL like decor: a pack without them draws the
	 * view's fallback, so there is no placeholder kind. Free-size world art like PACT: `image` (with `pixelsPerTile`) or
	 * a one-facing `sprites` set (`idle`; secretArt.ts holds the facing). Any other `secret.` ID is an error. Written
	 * inline, like PACT (contract.luau's 200-locals limit).
	 */
	{
		slot: "secret",
		prefix: "secret.",
		kinds: ["image", "sprites"],
		facings: [],
		baseAnimations: ["idle"],
	},
];

/**
 * Slots whose images are free-size world art drawn at `pixelsPerTile` (decor pieces, breakables, boost drops, pellets,
 * the vault's chest and cage, pact altars, a secret room's crack and rubble), in SLOTS order. Built inside a function:
 * the filter's Luau temporaries would be top-level locals.
 */
export const WORLD_ART_SLOTS: ReadonlyArray<SlotContract> = ((): SlotContract[] =>
	SLOTS.filter(
		(s) =>
			s === DECOR ||
			s === BREAKABLE ||
			s === BOOST ||
			s === PELLET ||
			s === TREASURE ||
			s.slot === "pact" ||
			s.slot === "secret",
	))();

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
 * slot without animations. `id`: the asset's ID, for a slot with per-ID animations (`idBaseAnimations`: the goo
 * puddle's land / hold, docs/GOO_ART.md GA2; the hazards', docs/HAZARD_ART.md HA3).
 */
export function requiredBaseAnimations(slot: SlotContract, id?: string): Array<string> {
	const out = new Array<string>();
	const perId = id !== undefined && slot.idBaseAnimations !== undefined ? slot.idBaseAnimations[id] : undefined;
	for (const anim of perId ?? slot.baseAnimations ?? slot.animationOrder ?? []) {
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
