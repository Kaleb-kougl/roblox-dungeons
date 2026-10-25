/**
 * Player gameplay data (E1.5, GDD "Combat"; source: `src/sim/playerData.ts`): hearts, armor, flask, Ember, dodge roll,
 * invulnerability.
 *
 * Rule 4 of the codebase: hitboxes, speeds and timings live here, never in art or theme packs. Durations are authored
 * in seconds and converted ONCE, at module load, to whole sim ticks (`Math.round(seconds * SIM_HZ)`). The sim only
 * ever counts integer ticks down, so no float timer drifts.
 */

import { jsRound } from "shared/jsmath";
import { SIM_HZ } from "./units";

/** Seconds -> whole ticks at SIM_HZ (60), with JS `Math.round`. Used at module load only. */
export function secondsToTicks(seconds: number): number {
	return jsRound(seconds * SIM_HZ);
}

// --- Body ---------------------------------------------------------------------------------------

/** Walk speed, world units (tiles) per second. */
export const PLAYER_SPEED = 6;
/** Collision radius, world units (the dungeon's circleMover uses it). */
export const PLAYER_RADIUS = 0.35;
/**
 * Longest single moveResolver call, world units. Faster movement (the roll) is split into equal sub-steps of at most
 * this length, well under the dungeon collision helper's exact limit of 0.5 per axis. A walk tick is exactly 0.1.
 */
export const MAX_MOVE_STEP = 0.1;

// --- Hearts and armor (all in HALF-heart units) ------------------------------------------------

/** Starting and maximum health: 3 hearts = 6 half hearts. */
export const START_HALF_HEARTS = 6;
/** A normal hit costs 1 half heart; heavy hits cost 2. The caller of damagePlayer() decides. */
export const HIT_NORMAL = 1;
export const HIT_HEAVY = 2;
/** Armor pips: each absorbs one whole hit, whatever its size. Start with none; armorMax is 0 until gear adds it. */
export const START_ARMOR = 0;
export const START_ARMOR_MAX = 0;
/** Post-hit invulnerability (Gungeon-style), so one burst can't delete every heart. */
export const HURT_INVULN_SECONDS = 0.75;
export const HURT_INVULN_TICKS = secondsToTicks(HURT_INVULN_SECONDS); // 45

// --- Flask ---------------------------------------------------------------------------------------

/** Charges per checkpoint. */
export const FLASK_CHARGES = 3;
/** Each charge heals one full heart, capped at the maximum. */
export const FLASK_HEAL_HALF_HEARTS = 2;
/** Drinking time: walking speed is multiplied by FLASK_MOVE_MULTIPLIER while it runs. The heal lands at once. */
export const FLASK_USE_SECONDS = 0.5;
export const FLASK_USE_TICKS = secondsToTicks(FLASK_USE_SECONDS); // 30
export const FLASK_MOVE_MULTIPLIER = 0.5;

// --- Ember (bullet clear) --------------------------------------------------------------------------

/** Embers per area (refilled at checkpoints). */
export const EMBERS_PER_AREA = 2;
/** I-frames granted when an Ember fires. */
export const EMBER_IFRAME_SECONDS = 0.25;
export const EMBER_IFRAME_TICKS = secondsToTicks(EMBER_IFRAME_SECONDS); // 15

// --- Dodge roll ------------------------------------------------------------------------------------

/** Whole roll. No cooldown (Gungeon), but a new roll can't start until this one ends. */
export const ROLL_SECONDS = 0.35;
export const ROLL_TICKS = secondsToTicks(ROLL_SECONDS); // 21
/** I-frames: the first ROLL_IFRAME_TICKS ticks of the roll. The tail is vulnerable. */
export const ROLL_IFRAME_SECONDS = 0.2;
export const ROLL_IFRAME_TICKS = secondsToTicks(ROLL_IFRAME_SECONDS); // 12
/** Dash phase (same window as the i-frames) at ROLL_SPEED, then a short recovery at ROLL_RECOVERY_SPEED. */
export const ROLL_DASH_TICKS = ROLL_IFRAME_TICKS;
/** Dash speed, units/s (~1.8x walk). 12 ticks x 11/60 = 2.2 units. */
export const ROLL_SPEED = 11;
/** Recovery speed, units/s. 9 ticks x 2/60 = 0.3 units. */
export const ROLL_RECOVERY_SPEED = 2;
/** Roll distance in open space: 2.5 tiles. */
export const ROLL_DISTANCE =
	(ROLL_DASH_TICKS * ROLL_SPEED + (ROLL_TICKS - ROLL_DASH_TICKS) * ROLL_RECOVERY_SPEED) / SIM_HZ;
