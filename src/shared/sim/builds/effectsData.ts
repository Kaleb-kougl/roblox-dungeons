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

/** Spark beams stay on screen this long (presentation, BuildEvents). */
export const SPARK_BEAM_TICKS = secondsToTicks(0.12);
