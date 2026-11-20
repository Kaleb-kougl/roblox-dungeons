/**
 * Combat gameplay data shared by every weapon, enemy and boss (E1.6, E1.8; source: `src/sim/combatData.ts`): bullet
 * hitboxes, lifetimes, pool sizes, actor pool limits, hit flash, the damage cap window and the stress emitter.
 * Per-archetype numbers live in the archetype's own file, per-weapon numbers in the weapon's file.
 *
 * Durations are authored in seconds and converted ONCE, at module load, to whole sim ticks (secondsToTicks).
 *
 * @module
 */

import { jsMax } from "shared/jsmath";
import { HIT_NORMAL, secondsToTicks } from "../playerData";

// --- Bullets (shared) --------------------------------------------------------------------------------

/** Height of every bullet above the floor, world units. Visual only: collision is 2D on the XZ plane. */
export const BULLET_Y = 0.5;

/** Enemy bullet hit radius, world units. Smaller than it is drawn (Gungeon-style forgiving hitboxes). */
export const ENEMY_BULLET_RADIUS = 0.12;
/**
 * Hit radius of a goo puddle (BulletKind.GOO, docs/ENEMY_VARIANTS.md EVD13), world units: a stationary floor puddle,
 * much wider than a flying bullet. Every other enemy bullet kind hits at ENEMY_BULLET_RADIUS (patterns.ts
 * enemyBulletHitRadius).
 */
export const GOO_BULLET_RADIUS = 0.35;
/**
 * Hit radius of a lightning strike (BulletKind.STRIKE, docs/NEW_ENEMIES.md NE1 / NE5), world units: the Stormcaller's
 * marked circle (its `strikeRow` hint radius), so the strike lands exactly where the ring was drawn.
 */
export const STRIKE_BULLET_RADIUS = 1.1;
/** Enemy bullet lifetime, seconds (walls cull almost all of them first). */
export const ENEMY_BULLET_LIFE = 6;
/** Enemy bullet damage, half hearts (a normal hit). */
export const ENEMY_BULLET_DAMAGE = HIT_NORMAL;

/** Player bullet hit radius against enemies, world units. */
export const PLAYER_BULLET_RADIUS = 0.15;

/** Slots in the enemy bullet simulation (fixed at creation; stress mode raises it, see enemyBulletCapacity). */
export const ENEMY_BULLET_CAPACITY = 2048;
/** Slots in the player bullet simulation. */
export const PLAYER_BULLET_CAPACITY = 512;
/**
 * Without a SimConfig.isBulletBlocked (greybox arena, unit tests) bullets are culled by the pool's bounds cube of this
 * half-extent around the world origin instead of by walls. With a blocker, bounds culling is off (Infinity).
 */
export const FALLBACK_BULLET_BOUNDS = 48;

/** Player bullets spawn this far in front of the player's center, world units (weapons use it as their muzzle). */
export const PLAYER_MUZZLE_OFFSET = 0.45;

// --- Actors (E1.8: enemies and bosses) -----------------------------------------------------------------

/**
 * Most actors alive or lingering at once (the pool's fixed size). Initial encounter spawns and runtime spawns
 * (ctx.spawnActor) share it; a spawn into a full pool returns undefined and counts in CombatState.actorsDropped.
 */
export const MAX_ACTORS = 64;
/** Hit flash length (render reads ActorState.flashTicks). */
export const HIT_FLASH_SECONDS = 0.1;
/** `HIT_FLASH_SECONDS` in ticks at 60 Hz (6): what a hit sets `ActorState.flashTicks` to. */
export const HIT_FLASH_TICKS = secondsToTicks(HIT_FLASH_SECONDS); // 6
/** Default time a dead actor keeps its slot (death animation) before it is freed. ArchetypeData.corpseTicks overrides. */
export const CORPSE_SECONDS = 0.5;
/** `CORPSE_SECONDS` in ticks at 60 Hz (30). */
export const CORPSE_TICKS = secondsToTicks(CORPSE_SECONDS); // 30
/**
 * Per-second damage cap (ArchetypeData.damageCapPerSecond, GDD: bosses): damage is booked into DAMAGE_CAP_BUCKETS
 * buckets of DAMAGE_CAP_BUCKET_TICKS ticks each; the window's budget is damageCapPerSecond x DAMAGE_CAP_WINDOW_SECONDS.
 */
export const DAMAGE_CAP_BUCKETS = 12;
/**
 * Ticks one damage-cap bucket covers (10 ticks = 1/6 s): a hit is booked into bucket `floor(tick /
 * DAMAGE_CAP_BUCKET_TICKS)`.
 */
export const DAMAGE_CAP_BUCKET_TICKS = 10;
/** Length of the damage-cap window in seconds (DAMAGE_CAP_BUCKETS x DAMAGE_CAP_BUCKET_TICKS at 60 Hz): 2. */
export const DAMAGE_CAP_WINDOW_SECONDS = (DAMAGE_CAP_BUCKETS * DAMAGE_CAP_BUCKET_TICKS) / 60;

/**
 * The fixed per-burst heading turn used by spirals (and to offset alternate sprayer rings): an exact rational
 * rotation, cos = 63/65, sin = 16/65 (a Pythagorean triple, about 14.25 degrees), so turning a direction is plain
 * multiply-add with no trig. The direction is re-normalized with sqrt after each turn (patterns.ts turnDir).
 */
export const TURN_COS = 63 / 65;
/** Sine of the fixed per-burst turn, exactly 16/65 (see `TURN_COS`). Positive turns from +Z toward +X. */
export const TURN_SIN = 16 / 65;

// --- Stress mode (?stress=N) ------------------------------------------------------------------------------

/** Bullets per stress ring. One ring at most per tick, only while fewer than the target are alive. */
export const STRESS_RING_COUNT = 48;
/** Stress bullet speed, world units per second (slow, so rings stay on screen). */
export const STRESS_BULLET_SPEED = 2.5;
/** Stress bullets deal no damage (damagePlayer ignores 0), so the player can stand in them while measuring. */
export const STRESS_BULLET_DAMAGE = 0;
/** Headroom above the stress target in the enemy simulation's capacity, for the actors' bullets. */
export const STRESS_CAPACITY_HEADROOM = 512;

/** Enemy bullet simulation capacity for a stress target (0 = off). */
export function enemyBulletCapacity(stressBullets: number): number {
	return jsMax(ENEMY_BULLET_CAPACITY, math.ceil(stressBullets) + STRESS_RING_COUNT + STRESS_CAPACITY_HEADROOM);
}
