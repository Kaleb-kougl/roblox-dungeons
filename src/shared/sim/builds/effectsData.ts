/**
 * Build effect tunables (docs/BUILDS.md "The three on-kill boons", "Duo boons"; BU1 declares them, their rules are
 * BU3+): the on-kill boons per level and the effect bullets' BurstSpecs. Data only. Every burst shape is an arc-table
 * row: 16 @ FULL_RING and 1 @ 0 are the web build's, 8 and 12 @ FULL_RING port rows (combat/arcTablePort.ts); builds
 * v2 (docs/BUILDS_V2.md BV1) adds 6 / 10 @ FULL_RING and 6 / 10 @ BALLISTA_FAN_SPREAD (port rows too).
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

// --- Duos (docs/BUILDS.md "Duo boons", BU6; ./duos.ts) ---------------------------------------------------------

/**
 * A bow arrow (Fire Arrows, Storm Blade, Conductor) is a player bullet of kind PLAYER with the bow's payload source
 * whose squared speed is within this relative tolerance of a bow arrow's (the stream arrow's or the heavy arrow's,
 * BOW_DATA). It tells arrows from the bow-source Ember Wake ring (fired with the bow in hand, speed ROLL_RING_SPEED).
 */
export const ARROW_SPEED_TOLERANCE = 1e-6;
/** The weapon whose arrows the duos read (its payload source is its weapon index + 1). */
export const DUO_ARROW_WEAPON_ID = "weapon.bow";

/** Storm Blade (Chain Spark + Swift Strikes): every this many arrow hits spark as if the last of them killed. */
export const STORM_BLADE_ARROW_HITS = 5;

/** Conductor (Chain Spark + Piercing Arrows): an arrow passing through an enemy sparks once (one hop) for this. */
export const CONDUCTOR_DAMAGE = 1;
export const CONDUCTOR_RANGE = CHAIN_SPARK_RANGE;

/** Shrapnel (Volatile + Sharpened): burst bolts deal this and pierce SHRAPNEL_PIERCE (Cataclysm's pierce becomes 2). */
export const SHRAPNEL_DAMAGE = 2;
export const SHRAPNEL_PIERCE = 1;
export const SHRAPNEL_CATACLYSM_PIERCE = 2;
/** Per level: Volatile's ring with Shrapnel (VOLATILE_BURSTS' counts and shapes, Shrapnel's damage and pierce). */
export const SHRAPNEL_BURSTS: ReadonlyArray<BurstSpec> = [
	{ ...VOLATILE_BURSTS[0], damage: SHRAPNEL_DAMAGE, pierce: SHRAPNEL_PIERCE },
	{ ...VOLATILE_BURSTS[1], damage: SHRAPNEL_DAMAGE, pierce: SHRAPNEL_PIERCE },
	{ ...VOLATILE_BURSTS[2], damage: SHRAPNEL_DAMAGE, pierce: SHRAPNEL_CATACLYSM_PIERCE },
];

/** Close Call (Soul Shards + Daredevil): every this many grazes release one shard at the nearest enemy. */
export const CLOSE_CALL_GRAZES = 3;
export const CLOSE_CALL_SHARD = SOUL_SHARD;
export const CLOSE_CALL_RANGE = SOUL_SHARDS_RANGE;

// --- Overkill (legendary, docs/LEGENDARIES.md "Overkill"; LG1 declares these, the rule is LG2) ------------------

/** The streak reaches the nearest living enemy within this range of the corpse (each carry from its own corpse). */
export const OVERKILL_RANGE = 4 * TILE_SIZE;
/** A carry below this does nothing (no streak, no event). */
export const OVERKILL_MIN_CARRY = 1;
/**
 * A kill by the player's own hit (gen 0: a swing, an arrow, a ring, a reflected bullet; any hp left before it) carries
 * at least this (LGD2, revised by the owner 2026-11-06: was full-hp one-shots only). Streak and effect kills never.
 */
export const OVERKILL_OWN_HIT_MIN = 1;

// --- Bastion's brace (docs/LEGENDARIES.md "Bastion", LG3; its tunables are in progressionData.ts) -----------

/** BuildEvents.braceKind values: what a brace did. */
export const BraceKind = {
	/** An armor pip restored. */
	PIP: 0,
	/** Stone Heart (LG4): no pip missing, half a heart healed. */
	HEAL: 1,
	/**
	 * UNUSED since the owner's tuning (LGD6 revised, 2026-11-06): a brace with nothing to restore is not spent and
	 * pushes nothing. Kept (append only) so the view's handling of it stays valid.
	 */
	SPENT: 2,
} as const;

// --- Legendary duos (docs/LEGENDARIES.md "Duos", LG4) --------------------------------------------------------

/** Supernova (Overkill + Volatile): a kill whose carry is at least this bursts one Volatile ring larger (LGD8). */
export const SUPERNOVA_CARRY = 2; // owner's tuning 2026-11-06 (LGD13): was 3
/** Supernova at Cataclysm (Volatile III): the 16-bolt ring pierces this many (Cataclysm's own pierces 1). */
export const SUPERNOVA_CATACLYSM_PIERCE = 2;
/**
 * Per level: Supernova's ring (I -> 12, II -> 16, III -> 16 that pierce SUPERNOVA_CATACLYSM_PIERCE). Only the existing
 * 12 / 16 @ FULL_RING arc rows: no new shape.
 */
export const SUPERNOVA_BURSTS: ReadonlyArray<BurstSpec> = [
	VOLATILE_BURSTS[1],
	{
		count: VOLATILE_BURSTS[2].count,
		spread: FULL_RING,
		speed: VOLATILE_SPEED,
		life: VOLATILE_LIFE,
		damage: VOLATILE_DAMAGE,
		kind: BulletKind.BURST,
	},
	{ ...VOLATILE_BURSTS[2], pierce: SUPERNOVA_CATACLYSM_PIERCE },
];
/**
 * Per level: Supernova's ring with Shrapnel too (the next level's count with this level's Shrapnel damage and pierce;
 * III: 16 at the larger of Shrapnel's Cataclysm pierce and Supernova's, 2).
 */
export const SUPERNOVA_SHRAPNEL_BURSTS: ReadonlyArray<BurstSpec> = [
	SHRAPNEL_BURSTS[1],
	{ ...SHRAPNEL_BURSTS[2], pierce: SHRAPNEL_PIERCE },
	{
		...SHRAPNEL_BURSTS[2],
		pierce:
			SHRAPNEL_CATACLYSM_PIERCE > SUPERNOVA_CATACLYSM_PIERCE
				? SHRAPNEL_CATACLYSM_PIERCE
				: SUPERNOVA_CATACLYSM_PIERCE,
	},
];
/** Skewer (Overkill + Piercing Arrows): the streak strikes every enemy its line passes within this distance of. */
export const SKEWER_RADIUS = 0.5 * TILE_SIZE;
/**
 * Citadel (Bastion + Warding): no once-per-room limit, but after a brace the next one waits this long (LGD14, owner
 * 2026-11-06; `braceCooldown`, ticks left, counted down by stepBuilds).
 */
export const CITADEL_BRACE_COOLDOWN_SECONDS = 5;
export const CITADEL_BRACE_COOLDOWN_TICKS = secondsToTicks(CITADEL_BRACE_COOLDOWN_SECONDS);
/** Stone Heart (Bastion + Hearty): a brace with no pip missing heals this many half hearts (up to the maximum). */
export const STONE_HEART_HEAL_HALF_HEARTS = 1;

/**
 * What dealt the damage being dealt now (SimCtx.procCause, set beside ctx.procGen): Chain Reaction (Volatile + Chain
 * Spark) cross-triggers on a kill by a spark (a Chain Spark hop or fork, a Storm Blade or Conductor spark) or by a
 * Volatile bolt. OVERKILL marks a streak's strike (docs/LEGENDARIES.md LG2).
 */
export const KillCause = {
	NONE: 0,
	SPARK: 1,
	BURST: 2,
	/** An Overkill streak (docs/LEGENDARIES.md LG2; Skewer's line strikes too). */
	OVERKILL: 3,
} as const;

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

// --- Builds v2, wave 1 (docs/BUILDS_V2.md "Design"; BV1 declares these, the rules are BV2-BV9) ---------------
// Numbers are the plan's starting points for BV12's tuning pass. Per-level tables by level - 1 (levelValue). Distances
// in world units (TILE_SIZE 1), speeds in world units per second, durations in ticks. Ballista's charge percent is in
// progression/progressionData.ts (a weapon mod, like Bastion's guard).

// Riposte (rare, offense; BV2: ./riposte.ts). The counter-wave is a hashed sweep (BuildWave), not bullets (BVD1).

/** A guard that ran its full length and erased at least this many enemy bullets fires the counter-wave. */
export const RIPOSTE_MIN_ERASED = 1;
/** The forward wave's half-angle cosine (a 120 degree crescent; melee's inCone test). A literal: no trig. */
export const RIPOSTE_WAVE_HALF_ANGLE_COS = 0.5;
/** The wave's radius grows this fast (24 tiles per second, x SIM_DT per tick) ... */
export const RIPOSTE_WAVE_SPEED = 24 * TILE_SIZE;
/** ... up to this radius, where it ends (an 18-tick life at 24 tiles / s, rounded up). */
export const RIPOSTE_WAVE_RANGE = 7 * TILE_SIZE;
/** Per level: the most damage a wave deals (its damage is min(riposteCount, this) before playerHitDamage). */
export const RIPOSTE_MAX_COUNT: ReadonlyArray<number> = [6, 10, 10];
/** At most this many waves live at once (state.builds.waves); one more is not spawned. */
export const RIPOSTE_WAVES_MAX = 8;
/** Counterstrike (Riposte III): a guard that erased at least this many sends the wave as a full ring, with returns. */
export const COUNTERSTRIKE_RING_ERASED = 5;
/** The full ring's half-angle cosine: the novas' (below -1, so the cone test always holds). */
export const COUNTERSTRIKE_RING_HALF_ANGLE_COS = NOVA_HALF_ANGLE_COS;
/**
 * Counterstrike's returns: min(riposteCount, RIPOSTE_MAX_COUNT) shards at the nearest enemies within
 * COUNTERSTRIKE_RANGE, nearest first (Soul Shards' aim and look, 1 damage; BuildEffect.RIPOSTE, gen 0).
 */
export const COUNTERSTRIKE_RETURN: BurstSpec = { ...SOUL_SHARD, damage: 1 };
export const COUNTERSTRIKE_RANGE = SOUL_SHARDS_RANGE;
/** BuildWave.kind and BuildEvents.waveKind: what sent a wave. Append only (hashed). */
export const WaveKind = {
	/** Riposte's crescent along the facing at the guard's end. */
	FORWARD: 0,
	/** Counterstrike's full ring (COUNTERSTRIKE_RING_ERASED or more erased). */
	RING: 1,
	/** Rebuke's full ring (Bastion + Riposte: a brace that restored something). */
	REBUKE: 2,
} as const;
/**
 * BuildPlayerState.rebukePending (docs/BUILDS_V2.md BV6, appended, hashed): what Rebuke's ring waits for. Append only.
 */
export const RebukePending = {
	/** Nothing: no brace that restored something in the current guard or roll. */
	NONE: 0,
	/** The current guard braced: its full-length end fires the REBUKE ring instead of the forward wave. */
	GUARD: 1,
	/** A roll braced this tick: stepBuilds (./riposte.ts stepWaves) fires the REBUKE ring at once. */
	ROLL: 2,
} as const;

// Ballista (rare, offense; BV3 the bursts, BV4 Siege Bolt: ./siege.ts).

/** Per level: bolts a heavy arrow bursts into when it is consumed (I / II / III Siege Bolt). */
export const BALLISTA_BOLT_COUNTS: ReadonlyArray<number> = [6, 10, 10];
/** The back fan's spread (radians) at a wall or a piece the arrow does not break, aimed back along its flight. */
export const BALLISTA_FAN_SPREAD = 1.6;
export const BALLISTA_BOLT_SPEED = 12;
export const BALLISTA_BOLT_LIFE = 0.35;
export const BALLISTA_BOLT_DAMAGE = 1;
/** One bolt (BulletKind.BURST, Volatile's look: BVD9); the bursts below are this at their counts and shapes. */
export const BALLISTA_BOLT: BurstSpec = {
	count: 1,
	spread: 0,
	speed: BALLISTA_BOLT_SPEED,
	life: BALLISTA_BOLT_LIFE,
	damage: BALLISTA_BOLT_DAMAGE,
	kind: BulletKind.BURST,
};
/** Per level: the last-pierce ring (6 / 10 / 10 @ FULL_RING; port arc rows, combat/arcTablePort.ts). */
export const BALLISTA_RINGS: ReadonlyArray<BurstSpec> = BALLISTA_BOLT_COUNTS.map((count) => ({
	...BALLISTA_BOLT,
	count,
	spread: FULL_RING,
}));
/** Per level: the back fan (6 / 10 / 10 @ BALLISTA_FAN_SPREAD; port arc rows). */
export const BALLISTA_FANS: ReadonlyArray<BurstSpec> = BALLISTA_BOLT_COUNTS.map((count) => ({
	...BALLISTA_BOLT,
	count,
	spread: BALLISTA_FAN_SPREAD,
}));
/** Siege Bolt: at most this many pins live at once (state.builds.pins); a further arrow plows only. */
export const SIEGE_PINS_MAX = 4;
/** A drag that leaves the pinned body more than this short of its arrow sets the pin's `slam` (it hit something). */
export const SIEGE_SLAM_SHORT = 0.25 * TILE_SIZE;
/** The slam: the pinned actor takes this percent of the heavy arrow's damage (through playerHitDamage). */
export const SIEGE_SLAM_DAMAGE_PERCENT = 300;
/** The slam's shockwave: every other living enemy within this of the pinned actor takes SIEGE_SHOCK_DAMAGE ... */
export const SIEGE_SHOCK_RADIUS = 2 * TILE_SIZE;
export const SIEGE_SHOCK_DAMAGE = 3;

// Wrecker (common, offense; BV5). Roll smash: PLAYER_RADIUS + BREAKABLE_HIT_RADIUS swept along the roll's step.

/** Per level: splinters every piece the owner breaks fires (I / II / III Demolition). */
export const WRECKER_SPLINTERS: ReadonlyArray<number> = [3, 5, 5];
/** One splinter (Soul Shards' aim and look, BulletKind.SHARD; BuildEffect.WRECKER). */
export const WRECKER_SPLINTER: BurstSpec = {
	count: 1,
	spread: 0,
	speed: 14,
	life: 0.6,
	damage: 1,
	kind: BulletKind.SHARD,
};
/** Splinters aim at the nearest living enemies within this of the piece (nearest first). */
export const WRECKER_RANGE = SOUL_SHARDS_RANGE;
/** Demolition (III): every piece the owner breaks explodes for this to every enemy within DEMOLITION_RADIUS ... */
export const DEMOLITION_DAMAGE = 2;
/** ... and breaks every intact piece in it (BreakableSource.BUILD), each its own smash one generation on (BVD10). */
export const DEMOLITION_RADIUS = 1.5 * TILE_SIZE;

// Wave 1 duos (BV6 / BV7).

/** Thunder Guard (Riposte + Chain Spark): each erased bullet sparks to the nearest enemy within this, for this ... */
export const THUNDER_GUARD_RANGE = CHAIN_SPARK_RANGE;
export const THUNDER_GUARD_DAMAGE = 1;
/** ... at most this many sparks per guard tick. */
export const THUNDER_GUARD_MAX = 8;
/** BuildEvents.sparkFork values: 0 a hop, 1 a Storm Crown fork, 2 a Thunder Guard spark (from an erased bullet). */
export const SparkFork = {
	HOP: 0,
	FORK: 1,
	THUNDER: 2,
} as const;
/** Stillwater (Composure + Riposte): a cut combo can be given back by an owner's erasing guard within this long. */
export const STILLWATER_SECONDS = 3;
export const STILLWATER_TICKS = secondsToTicks(STILLWATER_SECONDS); // 180
/** BuildsState.stillTick when no cut combo is recorded. */
export const STILL_NONE = -1;
/** Dragon Bolt (Ballista + Ember Wake): a heavy arrow drops an ember every this many ticks of its whole flight. */
export const DRAGON_BOLT_EMBER_TICKS = 3;
/** Full Heart (Hearty + Sharpened): at full hearts the beam strikes every enemy within FULL_HEART_RADIUS of ... */
export const FULL_HEART_RADIUS = SKEWER_RADIUS;
/** ... the line from the player along the facing to this length, for the finisher's damage. */
export const FULL_HEART_RANGE = 4 * TILE_SIZE;
/** Happy Hour (Deep Flask + Bounty): a flask drink sets `happyHourTicks` to this ... */
export const HAPPY_HOUR_SECONDS = 5;
export const HAPPY_HOUR_TICKS = secondsToTicks(HAPPY_HOUR_SECONDS); // 300
/** ... and the owner's kill points are x this percent while it runs (folded into Bounty's bonusPercent). */
export const HAPPY_HOUR_KILL_PERCENT = 200;

/** Spark beams stay on screen this long (presentation, BuildEvents). */
export const SPARK_BEAM_TICKS = secondsToTicks(0.12);
