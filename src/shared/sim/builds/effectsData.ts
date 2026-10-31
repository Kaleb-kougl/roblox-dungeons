/**
 * Build effect tunables (docs/BUILDS.md "The three on-kill boons", "Duo boons"; BU1 declares them, their rules are
 * BU3+): the on-kill boons per level and the effect bullets' BurstSpecs. Data only. Every burst shape is an arc-table
 * row: 16 @ FULL_RING and 1 @ 0 are the web build's, 8 and 12 @ FULL_RING port rows (combat/arcTablePort.ts).
 * Per-level tables are indexed by level - 1 (progressionData levelValue).
 */
import { TILE_SIZE } from "../units";
import { secondsToTicks } from "../playerData";
import { BulletKind, FULL_RING, type BurstSpec } from "../combat/patterns";

// --- Chain Spark (instant: no bullet) ---------------------------------------------------------------------

/** A spark reaches the nearest living enemy within this range of the corpse (each hop from the last target). */
export const CHAIN_SPARK_RANGE = 4.5 * TILE_SIZE;
/** Per level: hops (I / II / III Storm Crown) and the damage of each (before playerHitDamage). */
export const CHAIN_SPARK_HOPS: ReadonlyArray<number> = [1, 2, 4];
export const CHAIN_SPARK_DAMAGE: ReadonlyArray<number> = [2, 2, 3];
/** Storm Crown: each hop forks to a second target for damage / this (rounded down, at least CHAIN_SPARK_FORK_MIN). */
export const CHAIN_SPARK_FORK_DIVISOR = 2;
export const CHAIN_SPARK_FORK_MIN = 1;

// --- Volatile (a ring of bolts from the corpse) -------------------------------------------------------------

/**
 * The heading of every effect ring (Volatile, Thrill Seeker: the arc's first bullet flies this way) and of a shard
 * whose target stands exactly on the corpse: +Z, a unit vector (no trig).
 */
export const EFFECT_DIR_X = 0;
export const EFFECT_DIR_Z = 1;

export const VOLATILE_SPEED = 10;
export const VOLATILE_LIFE = 0.35;
export const VOLATILE_DAMAGE = 1;
/** Cataclysm (III): 16 bolts that pierce this many. */
export const CATACLYSM_PIERCE = 1;

/** Per level: Volatile's ring (8 / 12 / 16 bolts @ FULL_RING; III pierces). */
export const VOLATILE_BURSTS: ReadonlyArray<BurstSpec> = [
	{
		count: 8,
		spread: FULL_RING,
		speed: VOLATILE_SPEED,
		life: VOLATILE_LIFE,
		damage: VOLATILE_DAMAGE,
		kind: BulletKind.BURST,
	},
	{
		count: 12,
		spread: FULL_RING,
		speed: VOLATILE_SPEED,
		life: VOLATILE_LIFE,
		damage: VOLATILE_DAMAGE,
		kind: BulletKind.BURST,
	},
	{
		count: 16,
		spread: FULL_RING,
		speed: VOLATILE_SPEED,
		life: VOLATILE_LIFE,
		damage: VOLATILE_DAMAGE,
		kind: BulletKind.BURST,
		pierce: CATACLYSM_PIERCE,
	},
];

// --- Soul Shards (single aimed shards) ------------------------------------------------------------------------

/** Shards aim at the nearest living enemies within this range of the corpse (nearest first, ties by slot order). */
export const SOUL_SHARDS_RANGE = 8 * TILE_SIZE;
/** Per level: shards per kill (I / II / III Soul Swarm). */
export const SOUL_SHARDS_COUNTS: ReadonlyArray<number> = [2, 3, 4];
/** Soul Swarm (III): pierce, and the steering weight of the direction to the target per tick (BUD11). */
export const SOUL_SWARM_PIERCE = 1;
export const SOUL_SWARM_TURN = 0.25;

/** One shard (1 @ 0: a single bullet down the aim). */
export const SOUL_SHARD: BurstSpec = { count: 1, spread: 0, speed: 14, life: 0.8, damage: 2, kind: BulletKind.SHARD };
/** Soul Swarm's shard: the same, piercing. */
export const SOUL_SWARM_SHARD: BurstSpec = { ...SOUL_SHARD, pierce: SOUL_SWARM_PIERCE };
/** Per level: the shard fired (I / II straight; III Soul Swarm's piercing shard, which steers: ./evolutions.ts). */
export const SOUL_SHARD_SPECS: ReadonlyArray<BurstSpec> = [SOUL_SHARD, SOUL_SHARD, SOUL_SWARM_SHARD];
/** Soul Swarm: a shard steers toward the nearest living enemy within this range of the shard (BUD11). */
export const SOUL_SWARM_RANGE = SOUL_SHARDS_RANGE;

// --- Embers (Fire Arrows, Blazing Trail: stationary floor flames) -------------------------------------------

/** One ember: speed 0, 1 damage, 1.2 s, consumed by the first enemy it touches. */
export const EMBER_BURST: BurstSpec = { count: 1, spread: 0, speed: 0, life: 1.2, damage: 1, kind: BulletKind.EMBER };
/** Fire Arrows: an arrow drops an ember every this many ticks, at most FIRE_ARROWS_EMBERS_MAX per arrow. */
export const FIRE_ARROWS_EMBER_TICKS = 6;
export const FIRE_ARROWS_EMBERS_MAX = 4;
/** Blazing Trail: a roll drops an ember every this many ticks. */
export const BLAZING_TRAIL_EMBER_TICKS = 3;

// --- Other effect bullets (evolutions) ------------------------------------------------------------------------

/** Thrill Seeker: every THRILL_SEEKER_GRAZES grazes release a ring of 8 bolts around the player. */
export const THRILL_SEEKER_GRAZES = 8;
export const THRILL_SEEKER_RING: BurstSpec = {
	count: 8,
	spread: FULL_RING,
	speed: VOLATILE_SPEED,
	life: VOLATILE_LIFE,
	damage: VOLATILE_DAMAGE,
	kind: BulletKind.SPARK_BOLT,
};

// --- Evolutions (level III, docs/BUILDS.md "Evolutions (level III)", BU5; ./evolutions.ts, ./execute.ts) ------

// Storm Crown is CHAIN_SPARK_HOPS / CHAIN_SPARK_DAMAGE's III entry plus the fork (CHAIN_SPARK_FORK_*) above;
// Cataclysm is VOLATILE_BURSTS[2] (pierce CATACLYSM_PIERCE); Soul Swarm is SOUL_SHARD_SPECS[2] + SOUL_SWARM_TURN.

/** Executioner (Sharpened III): a hit that leaves a non-boss enemy at or below this percent of its max hp kills it. */
export const EXECUTIONER_HP_PERCENT = 20;

/** Flurry (Swift Strikes III): every sword finisher releases this crescent along the swing (5 @ 0.5, a web shape). */
export const FLURRY_SPEED = 12;
export const FLURRY_LIFE = 0.35;
export const FLURRY_DAMAGE = 1;
export const FLURRY_CRESCENT: BurstSpec = {
	count: 5,
	spread: 0.5,
	speed: FLURRY_SPEED,
	life: FLURRY_LIFE,
	damage: FLURRY_DAMAGE,
	kind: BulletKind.SPARK_BOLT,
};
/** Flurry: every FLURRY_ARROW_EVERY-th stream arrow of the bow is FLURRY_ARROW_COUNT arrows @ FLURRY_ARROW_SPREAD (3 @ 0.12, a web shape). */
export const FLURRY_ARROW_EVERY = 6;
export const FLURRY_ARROW_COUNT = 3;
export const FLURRY_ARROW_SPREAD = 0.12;

/**
 * Ricochet (Piercing Arrows III): a bow arrow whose last hit (no pierce left: the hit that ends it) kills splits into
 * RICOCHET_ARROWS arrows aimed at the nearest living enemies within RICOCHET_RANGE of the split (as Soul Shards aim).
 * The split arrows are effect bolts: the stream arrow's speed and damage, a shorter life.
 */
export const RICOCHET_ARROWS = 2;
/** The weapon whose arrows ricochet (its payload source is its weapon index + 1). */
export const RICOCHET_WEAPON_ID = "weapon.bow";
export const RICOCHET_RANGE = 8 * TILE_SIZE;
/** The bow's stream arrow speed (weapons/defs/bow.ts BOW_DATA.speed) and damage (BOW_DATA.damage). */
export const RICOCHET_SPEED = 16;
export const RICOCHET_DAMAGE = 1;
export const RICOCHET_LIFE = 0.5;
export const RICOCHET_ARROW: BurstSpec = {
	count: 1,
	spread: 0,
	speed: RICOCHET_SPEED,
	life: RICOCHET_LIFE,
	damage: RICOCHET_DAMAGE,
	kind: BulletKind.SPARK_BOLT,
};

/** Lionheart (Hearty III): a PERFECT room clear heals this many half hearts (up to the maximum). */
export const LIONHEART_HEAL_HALF_HEARTS = 1;

/**
 * Novas (Overflowing: Deep Flask III on a flask drink; Bulwark: Warding III when an armor pip breaks): a full-circle
 * sweep (melee.ts sweepArc with NOVA_HALF_ANGLE_COS) around the player erasing enemy bullets with the guard's goo rules
 * (goo erased quietly), no guard points and no parry feed.
 */
export const OVERFLOWING_NOVA_RADIUS = 3 * TILE_SIZE;
export const BULWARK_NOVA_RADIUS = 2.5 * TILE_SIZE;
/** sweepArc's half-angle cosine for a full circle: below -1, so the cone test (dot >= halfCos x dist) always holds. */
export const NOVA_HALF_ANGLE_COS = -2;
/** BuildEvents.novaKind values. */
export const NovaKind = {
	OVERFLOWING: 0,
	BULWARK: 1,
} as const;

/**
 * Momentum (Lingering III): each combo tier crossing upward (x2 .. x5: tenths MOMENTUM_TIER_FIRST x COMBO_DENOMINATOR
 * .. MOMENTUM_TIER_LAST x COMBO_DENOMINATOR) fires `tier` straight shards (SOUL_SHARD, gen 0) from the player at the
 * nearest living enemies within SOUL_SHARDS_RANGE (Soul Shards' aim; no Soul Shards needed).
 */
export const MOMENTUM_TIER_FIRST = 2;
export const MOMENTUM_TIER_LAST = 5;

/** Jackpot (Bounty III): every JACKPOT_KILLS-th kill by the player pays score/scoreData.ts JACKPOT_POINTS x the floor. */
export const JACKPOT_KILLS = 15;

/** BuildEvents.flurryKind values. */
export const FlurryKind = {
	/** A finisher's crescent of bolts. */
	CRESCENT: 0,
	/** A stream arrow fired as 3. */
	ARROWS: 1,
} as const;

/** The bullet kinds of build effects (BU3: the per-player effect budget counts live player bullets of these kinds). */
export const EFFECT_BULLET_KINDS: ReadonlyArray<number> = [
	BulletKind.BURST,
	BulletKind.SHARD,
	BulletKind.EMBER,
	BulletKind.SPARK_BOLT,
];

/** Spark beams stay on screen this long (presentation, BuildEvents). */
export const SPARK_BEAM_TICKS = secondsToTicks(0.12);
