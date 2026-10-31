/**
 * In-run progression tunables (M2, GDD "Boons", "Relics", "Curse shrines"; a Roblox-port feature, no web source):
 * the boon draft after every endless floor, the 12 boons, the 4 relics (one per TREASURE room), the 4 curses (one
 * per SHRINE room). Data only: progression.ts / runMods.ts read these, nothing is inline in the logic.
 *
 * Index tables (BOONS, RELICS, CURSES) are APPEND ONLY: their indices are stored in the sim state and hashed.
 * Every multiplier that feeds the hash is an integer percent (or an exact binary fraction): see runMods.ts.
 */
import { SQRT1_2 } from "../jsnum";
import { secondsToTicks } from "../playerData";
import { TILE_SIZE } from "../units";
import { AXIS_MAX, Button } from "../input";
import { COMBO_WINDOW_SECONDS } from "../score/scoreData";

// --- Rarities ------------------------------------------------------------------------------------------

export const Rarity = {
	COMMON: 0,
	RARE: 1,
	LEGENDARY: 2,
} as const;
export type RarityId = (typeof Rarity)[keyof typeof Rarity];
/** Rarity names in index order (theme string keys `boon.rarity.<name>`). */
export const RARITY_NAMES = ["common", "rare", "legendary"] as const;

/** Per offered card: Common 70 %, Rare 25 %, Legendary 5 % (integer percent, summing to 100). */
export const RARITY_PERCENT_COMMON = 70;
export const RARITY_PERCENT_RARE = 25;
export const RARITY_PERCENT_LEGENDARY = 5;
/** Legendary +1 percentage point per floor cleared after the first, taken from Common ... */
export const LEGENDARY_PERCENT_PER_FLOOR = 1;
/** ... capped here. */
export const LEGENDARY_PERCENT_MAX = 15;
/** The roll is an integer in [0, RARITY_ROLL_RANGE). */
export const RARITY_ROLL_RANGE = 100;

// --- The draft -----------------------------------------------------------------------------------------

/** Cards per draft (fewer when fewer unowned boons are left; none -> no draft). */
export const DRAFT_OFFER_COUNT = 3;
/**
 * Selection: the move stick's SCREEN-horizontal component picks the card. The InputFrame's move vector is in world
 * space (the client rotates it by the camera yaw, shared/play screenToWorld); this unit vector is screen-right in
 * world space for the 45-degree iso camera (shared/config CAMERA_YAW_DEG; shared/play inputMapping.spec.ts checks it
 * against screenToWorld(1, 0)). right = moveX * x + moveZ * z, in AXIS units.
 */
export const DRAFT_SCREEN_RIGHT_X = SQRT1_2;
export const DRAFT_SCREEN_RIGHT_Z = -SQRT1_2;
/** |right| at or below this is the centre card (fraction of full stick deflection). */
export const DRAFT_SELECT_DEAD_ZONE = 0.5;
export const DRAFT_SELECT_DEAD_ZONE_AXIS = DRAFT_SELECT_DEAD_ZONE * AXIS_MAX;
/** Confirm: a press edge of this button (the attack button: mouse 1 / RT). */
export const DRAFT_CONFIRM_BUTTON = Button.FIRE;
/** A confirm before the draft has been open this long is ignored (no pick by a held / mashed attack). */
export const DRAFT_MIN_OPEN_SECONDS = 0.5;
export const DRAFT_MIN_OPEN_TICKS = secondsToTicks(DRAFT_MIN_OPEN_SECONDS); // 30
/** Card columns: left, centre, right. */
export const DRAFT_COLUMN_LEFT = 0;
export const DRAFT_COLUMN_CENTRE = 1;
export const DRAFT_COLUMN_RIGHT = 2;
/** draftSelected when no card is under the stick (two cards offered, stick centred). */
export const NO_SELECTION = -1;

// --- Boons -------------------------------------------------------------------------------------------

/** Boon indices (state and hash). Append only. */
export const Boon = {
	SHARPENED: 0,
	SWIFT_STRIKES: 1,
	PIERCING_ARROWS: 2,
	EMBER_WAKE: 3,
	HEARTY: 4,
	SLIPPERY: 5,
	DEEP_FLASK: 6,
	WARDING: 7,
	LINGERING: 8,
	DAREDEVIL: 9,
	BOUNTY: 10,
	COMPOSURE: 11,
	// Builds (docs/BUILDS.md BU1): the on-kill boons. Offered only in runs with SimConfig.builds (drawCardOffers);
	// drawBoonOffers (no builds: the tutorial) never sees them (CLASSIC_BOON_COUNT).
	CHAIN_SPARK: 12,
	VOLATILE: 13,
	SOUL_SHARDS: 14,
} as const;
export type BoonId = (typeof Boon)[keyof typeof Boon];

export type BoonCategory = "offense" | "defense" | "score";

export interface BoonDef {
	/** Theme string keys: `<id>.name`, `<id>.desc`, `<id>.icon` (a short HUD label). */
	readonly id: string;
	readonly rarity: RarityId;
	readonly category: BoonCategory;
}

/** Every boon, by Boon index. */
export const BOONS: ReadonlyArray<BoonDef> = [
	{ id: "boon.sharpened", rarity: Rarity.RARE, category: "offense" },
	{ id: "boon.swiftStrikes", rarity: Rarity.COMMON, category: "offense" },
	{ id: "boon.piercingArrows", rarity: Rarity.COMMON, category: "offense" },
	{ id: "boon.emberWake", rarity: Rarity.LEGENDARY, category: "offense" },
	{ id: "boon.hearty", rarity: Rarity.RARE, category: "defense" },
	{ id: "boon.slippery", rarity: Rarity.COMMON, category: "defense" },
	{ id: "boon.deepFlask", rarity: Rarity.COMMON, category: "defense" },
	{ id: "boon.warding", rarity: Rarity.RARE, category: "defense" },
	{ id: "boon.lingering", rarity: Rarity.COMMON, category: "score" },
	{ id: "boon.daredevil", rarity: Rarity.COMMON, category: "score" },
	{ id: "boon.bounty", rarity: Rarity.COMMON, category: "score" },
	{ id: "boon.composure", rarity: Rarity.LEGENDARY, category: "score" },
	{ id: "boon.chainSpark", rarity: Rarity.RARE, category: "offense" },
	{ id: "boon.volatile", rarity: Rarity.COMMON, category: "offense" },
	{ id: "boon.soulShards", rarity: Rarity.RARE, category: "offense" },
];
export const BOON_COUNT = BOONS.size();
/**
 * The boons a draft without builds offers (drawBoonOffers: the tutorial, hand-built endless configs): the first 12,
 * Boon.SHARPENED .. Boon.COMPOSURE. The on-kill boons appended after them (docs/BUILDS.md) are builds-only, so a run
 * without SimConfig.builds draws exactly as before they existed.
 */
export const CLASSIC_BOON_COUNT = 12;

// --- Boon levels (docs/BUILDS.md BUD1; builds runs only) -------------------------------------------------

/** A common or rare boon's highest level (III: the evolution). */
export const BOON_MAX_LEVEL = 3;
/** A legendary boon's only level (BUD1: legendaries are the anchors duos are built on). */
export const LEGENDARY_MAX_LEVEL = 1;

/** The highest level `boon` can reach (0 for an index that is not a boon). */
export function boonMaxLevel(boon: number): number {
	const def = BOONS[boon];
	if (def === undefined) return 0;
	return def.rarity === Rarity.LEGENDARY ? LEGENDARY_MAX_LEVEL : BOON_MAX_LEVEL;
}

/** Entry `level - 1` of a per-level table (level 1..its length; clamped into it). */
export function levelValue(values: ReadonlyArray<number>, level: number): number {
	const i = level < 1 ? 0 : level > values.size() ? values.size() - 1 : level - 1;
	return values[i];
}

/** Sharpened: player damage (bullets and melee) x DAMAGE_BOON_PERCENT / 100 when it hits. */
export const DAMAGE_BOON_PERCENT = 125;
/** Per level (builds runs): I / II / III. x Fury 150 stays a multiple of 1/8 (runMods.ts playerHitDamage). */
export const DAMAGE_BOON_PERCENTS: ReadonlyArray<number> = [DAMAGE_BOON_PERCENT, 150, 175];
/** Swift Strikes: sword swing / finisher recovery and the bow's stream cooldown x ATTACK_TICKS_BOON_PERCENT / 100. */
export const ATTACK_TICKS_BOON_PERCENT = 80;
/** Per level. x Frenzy 70 = 56 / 49 / 42: integer percents (combinedPercent). */
export const ATTACK_TICKS_BOON_PERCENTS: ReadonlyArray<number> = [ATTACK_TICKS_BOON_PERCENT, 70, 60];
/** Piercing Arrows: every bow arrow passes through this many more actors. */
export const BOW_PIERCE_BOON = 1;
/** Per level (III is the evolution, Ricochet, at II's pierce). */
export const BOW_PIERCE_BOONS: ReadonlyArray<number> = [BOW_PIERCE_BOON, 2, 2];
/** Ember Wake: a ring of player bullets on every roll start. 16 / FULL_RING is an arc-table shape (turret rings). */
export const ROLL_RING_COUNT = 16;
export const ROLL_RING_SPEED = 12;
export const ROLL_RING_LIFE = 0.3;
export const ROLL_RING_DAMAGE = 1;
/** Hearty: +1 heart (max and current, in half hearts). */
export const HEART_BOON_HALF_HEARTS = 2;
/** Per level: the hearts Hearty has added in all (half hearts, +1 / +2 / +3 hearts); each level gained adds the step. */
export const HEART_BOON_HALF_HEARTS_TOTAL: ReadonlyArray<number> = [HEART_BOON_HALF_HEARTS, 4, 6];
/** Slippery: roll i-frames x ROLL_IFRAME_BOON_PERCENT / 100. */
export const ROLL_IFRAME_BOON_PERCENT = 150;
/** Per level. */
export const ROLL_IFRAME_BOON_PERCENTS: ReadonlyArray<number> = [ROLL_IFRAME_BOON_PERCENT, 175, 200];
/** Deep Flask: +1 flask charge (max and current). */
export const FLASK_BOON_CHARGES = 1;
/** Per level: the charges Deep Flask has added in all (III is the evolution, Overflowing, at II's charges). */
export const FLASK_BOON_CHARGES_TOTAL: ReadonlyArray<number> = [FLASK_BOON_CHARGES, 2, 2];
/** Warding: +1 armor pip (max and current), refilled each time a room's enemies spawn. */
export const ARMOR_BOON_PIPS = 1;
/** Per level: the pips Warding has added in all (III is the evolution, Bulwark, at II's pips). */
export const ARMOR_BOON_PIPS_TOTAL: ReadonlyArray<number> = [ARMOR_BOON_PIPS, 2, 2];
/** Lingering: the combo lasts this long without a kill or graze (instead of COMBO_WINDOW_SECONDS). */
export const COMBO_WINDOW_BOON_SECONDS = 9;
export const COMBO_WINDOW_BOON_BONUS_TICKS =
	secondsToTicks(COMBO_WINDOW_BOON_SECONDS) - secondsToTicks(COMBO_WINDOW_SECONDS); // 180
/** Per level: the window in seconds (9 / 11 / 12) and the ticks it adds to COMBO_WINDOW_SECONDS (180 / 300 / 360). */
export const COMBO_WINDOW_BOON_SECONDS_BY_LEVEL: ReadonlyArray<number> = [COMBO_WINDOW_BOON_SECONDS, 11, 12];
export const COMBO_WINDOW_BOON_BONUS_TICKS_BY_LEVEL: ReadonlyArray<number> = COMBO_WINDOW_BOON_SECONDS_BY_LEVEL.map(
	(s) => secondsToTicks(s) - secondsToTicks(COMBO_WINDOW_SECONDS),
);
/** Daredevil: the graze ring reaches this far beyond the hit distance (instead of GRAZE_MARGIN). */
export const GRAZE_MARGIN_BOON = 0.75 * TILE_SIZE;
/** Per level (exact binary fractions of a tile). */
export const GRAZE_MARGIN_BOONS: ReadonlyArray<number> = [GRAZE_MARGIN_BOON, 0.875 * TILE_SIZE, 1.0 * TILE_SIZE];
/** Bounty: kill points (kills and boss kills, not the no-hit bonus) x KILL_POINTS_BOON_PERCENT / 100. */
export const KILL_POINTS_BOON_PERCENT = 110;
/** Per level. */
export const KILL_POINTS_BOON_PERCENTS: ReadonlyArray<number> = [KILL_POINTS_BOON_PERCENT, 120, 130];
/** Composure: a landed hit cuts the combo by half as much (the cut's divisor x 2). */
export const COMBO_CUT_BOON_DIVISOR_MULTIPLIER = 2;

// --- Relics ------------------------------------------------------------------------------------------

/** Relic indices (state and hash). Append only. */
export const Relic = {
	MIRROR_CLOAK: 0,
	HOURGLASS: 1,
	VAMPIRE_FANG: 2,
	SECOND_WIND: 3,
} as const;
export type RelicId = (typeof Relic)[keyof typeof Relic];

export interface RelicDef {
	/** Theme string keys `<id>.name`, `<id>.desc`, `<id>.icon`. */
	readonly id: string;
}

export const RELICS: ReadonlyArray<RelicDef> = [
	{ id: "relic.mirrorCloak" },
	{ id: "relic.hourglass" },
	{ id: "relic.vampireFang" },
	{ id: "relic.secondWind" },
];
export const RELIC_COUNT = RELICS.size();

/** A TREASURE room's pedestal: its centre floor tile; walking within this distance of it collects the relic. */
export const PEDESTAL_RADIUS = 0.5 * TILE_SIZE;
/** Mirror Cloak: each enemy bullet the sword's guard erases comes back as a player bullet (its own speed). */
export const MIRROR_BULLET_DAMAGE = 2;
export const MIRROR_BULLET_LIFE = 0.75;
/** Hourglass: enemy bullets move at HOURGLASS_TIME_SCALE speed for this long after a hit lands on the player. */
export const HOURGLASS_SECONDS = 1;
export const HOURGLASS_TICKS = secondsToTicks(HOURGLASS_SECONDS); // 60
export const HOURGLASS_TIME_SCALE = 0.7;
/** Vampire Fang: every FANG_KILLS kills heal FANG_HEAL_HALF_HEARTS (up to the maximum). */
export const FANG_KILLS = 25;
export const FANG_HEAL_HALF_HEARTS = 1;
/** Second Wind: once per floor, a lethal hit leaves the player at this many half hearts. */
export const SECOND_WIND_HALF_HEARTS = 1;

// --- Curses ------------------------------------------------------------------------------------------

/** Curse indices (state and hash). Append only. */
export const Curse = {
	FRAILTY: 0,
	HASTE: 1,
	IMPATIENCE: 2,
	THIRST: 3,
} as const;
export type CurseId = (typeof Curse)[keyof typeof Curse];

export interface CurseDef {
	/** Theme string keys `<id>.name`, `<id>.desc`, `<id>.icon`. */
	readonly id: string;
}

export const CURSES: ReadonlyArray<CurseDef> = [
	{ id: "curse.frailty" },
	{ id: "curse.haste" },
	{ id: "curse.impatience" },
	{ id: "curse.thirst" },
];
export const CURSE_COUNT = CURSES.size();

/** The SHRINE room's zone: within this distance of its centre floor tile. */
export const SHRINE_RADIUS = TILE_SIZE;
/** Accepting: a press edge of SKILL1 (key 1 / gamepad A), which does nothing else anywhere in the sim. */
export const SHRINE_BUTTON = Button.SKILL1;
/** Frailty: -1 heart of maximum (half hearts), never below CURSE_MIN_HEARTS_MAX; current hearts capped to it. */
export const CURSE_HEART_LOSS = 2;
export const CURSE_MIN_HEARTS_MAX = 2;
/** Haste: enemy bullet speed x this (with the floor scaling, still capped at BULLET_SPEED_MAX_MULTIPLIER). */
export const CURSE_BULLET_SPEED_MULTIPLIER = 1.15;
/** Impatience: the combo window is this much shorter (never below CURSE_MIN_COMBO_WINDOW_TICKS). */
export const CURSE_COMBO_WINDOW_LOSS_SECONDS = 2;
export const CURSE_COMBO_WINDOW_LOSS_TICKS = secondsToTicks(CURSE_COMBO_WINDOW_LOSS_SECONDS); // 120
export const CURSE_MIN_COMBO_WINDOW_TICKS = secondsToTicks(1);
/** Thirst: -1 flask charge of maximum, never below CURSE_MIN_FLASK_MAX; current charges capped to it. */
export const CURSE_FLASK_LOSS = 1;
export const CURSE_MIN_FLASK_MAX = 1;

// --- Integer percent arithmetic ---------------------------------------------------------------------------

/** The denominator of every *_PERCENT tunable. */
export const PERCENT = 100;
