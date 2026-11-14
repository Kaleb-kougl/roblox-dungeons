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

/** Starting and maximum health: 3 hearts = 6 half hearts (a character's trait may change it: PlayerTraits.heartsMaxDelta). */
export const START_HALF_HEARTS = 6;
/** The least maximum health a character's traits can leave a player with (playerStartHalfHearts): never start dead. */
export const MIN_START_HALF_HEARTS = 1;
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

// --- Player traits (docs/ARCHER.md "The Archer's dodge") -----------------------------------------

/**
 * Per-player traits a character brings to a run (SimConfig.traits for player 0, PartyConfig.traits per co-op player;
 * read through player.ts playerTraits): integer percents of the roll. Config, not state: the client and the server
 * build them from the same run setup, and they are not hashed (a mismatch shows in the hashed positions on the first
 * roll). The sim knows only these numbers, never a character id (shared/characters holds the characters).
 */
export interface PlayerTraits {
	/** The roll's dash step (the first ROLL_DASH_TICKS ticks) x this / 100; 100 = ROLL_DASH_STEP exactly. */
	readonly rollDashPercent: number;
	/** The roll's i-frames x this / 100, folded with Slippery's percent into one rounding (rollIframeTicks). */
	readonly rollIframePercent: number;
	/**
	 * Half hearts added to START_HALF_HEARTS for the player's starting and maximum health (0 = 3 hearts exactly; the
	 * Archer's -2 = 2 hearts). Applied once, when createSimState builds the player (playerStartHalfHearts).
	 */
	readonly heartsMaxDelta: number;
	/**
	 * Armor pips added to START_ARMOR_MAX for the player's armor maximum, and their starting armor (docs/SILVER.md SV5:
	 * the Plating upgrade; 0 = none, as today). Applied once in createSimState (playerStartArmorMax), never below 0.
	 */
	readonly armorMaxDelta: number;
	/**
	 * Flask charges added to FLASK_CHARGES for the player's flask maximum and starting charges (docs/SILVER.md SV5: the
	 * Deep Flask upgrade; 0 = 3 charges, as today). Applied once in createSimState (playerStartFlaskMax), never below 0.
	 */
	readonly flaskChargesDelta: number;
}

/** A trait delta that changes nothing. */
export const NEUTRAL_TRAIT_DELTA = 0;

/** A trait percent that changes nothing (progression's PERCENT; playerData cannot import it: a require cycle). */
export const NEUTRAL_TRAIT_PERCENT = 100;

/** No traits: today's roll exactly (what every player without SimConfig.traits / PartyConfig.traits gets). */
export const NEUTRAL_TRAITS: PlayerTraits = table.freeze({
	rollDashPercent: NEUTRAL_TRAIT_PERCENT,
	rollIframePercent: NEUTRAL_TRAIT_PERCENT,
	heartsMaxDelta: NEUTRAL_TRAIT_DELTA,
	armorMaxDelta: NEUTRAL_TRAIT_DELTA,
	flaskChargesDelta: NEUTRAL_TRAIT_DELTA,
});

/** A player's starting and maximum health in half hearts: START_HALF_HEARTS + the traits' delta, at least MIN_START_HALF_HEARTS. */
export function playerStartHalfHearts(traits: Readonly<PlayerTraits>): number {
	const n = START_HALF_HEARTS + traits.heartsMaxDelta;
	return n < MIN_START_HALF_HEARTS ? MIN_START_HALF_HEARTS : n;
}

/** The least armor or flask maximum a trait delta can leave (playerStartArmorMax / playerStartFlaskMax). */
export const MIN_TRAIT_MAXIMUM = 0;

/** A player's armor maximum (and starting armor): START_ARMOR_MAX + the traits' delta, at least MIN_TRAIT_MAXIMUM. */
export function playerStartArmorMax(traits: Readonly<PlayerTraits>): number {
	const n = START_ARMOR_MAX + traits.armorMaxDelta;
	return n < MIN_TRAIT_MAXIMUM ? MIN_TRAIT_MAXIMUM : n;
}

/** A player's flask maximum (and starting charges): FLASK_CHARGES + the traits' delta, at least MIN_TRAIT_MAXIMUM. */
export function playerStartFlaskMax(traits: Readonly<PlayerTraits>): number {
	const n = FLASK_CHARGES + traits.flaskChargesDelta;
	return n < MIN_TRAIT_MAXIMUM ? MIN_TRAIT_MAXIMUM : n;
}
