/**
 * Boost drop tunables (docs/BOOSTS.md; a Roblox-port feature, no web source). Data only: drops.ts and boostMods.ts
 * read it, nothing is inline in the logic. A LEAF: it imports only units.ts and playerData.ts, so input.ts can read
 * DEBUG_DROP_BUTTON from here without a require cycle.
 *
 * Index tables are APPEND ONLY: a Boost index is stored in DropsState (ground slots, per-player timers) and hashed.
 */
import { TILE_SIZE } from "../units";
import { secondsToTicks } from "../playerData";

/** Boost kind indices (BOOSTS order). Hashed. */
export const Boost = { FURY: 0, QUICKSTEP: 1, FRENZY: 2, AEGIS: 3 } as const;
export type BoostId = (typeof Boost)[keyof typeof Boost];

export interface BoostDef {
	/** Logical id (the theme's `boost.<name>` slot is the part after the dot). */
	readonly id: string;
	/** Weight in the kind pick of a random drop (weighted rngInt over the sum). */
	readonly weight: number;
	/** How long the boost runs once picked up. */
	readonly seconds: number;
}

/** Every boost, by Boost index. APPEND ONLY. */
export const BOOSTS: ReadonlyArray<BoostDef> = [
	{ id: "boost.fury", weight: 3, seconds: 10 },
	{ id: "boost.quickstep", weight: 3, seconds: 10 },
	{ id: "boost.frenzy", weight: 3, seconds: 10 },
	{ id: "boost.aegis", weight: 2, seconds: 15 },
];
export const BOOST_COUNT = BOOSTS.size();

/** A free ground slot's kind; also "no kind" in guards and events. */
export const NO_BOOST = -1;

/** Percents below are integers over this (the same scale as progressionData PERCENT; a spec checks they agree). */
export const BOOST_PERCENT = 100;
/** Fury: player damage (bullets and melee) x this / 100 when it hits, after Sharpened. */
export const FURY_DAMAGE_PERCENT = 150;
/** Quickstep: walk speed x this / 100 (the roll is unchanged). */
export const QUICKSTEP_WALK_PERCENT = 130;
/** Frenzy: sword swing / finisher recovery and the generic weapon cooldown (the bow's stream) x this / 100. */
export const FRENZY_ATTACK_TICKS_PERCENT = 70;
/** Aegis: extra armor pips over the maximum, taken before armor and hearts. */
export const AEGIS_PIPS = 1;

/** A random drop's roll: rngInt(0, DROP_ROLL_RANGE - 1) < the archetype's percent. */
export const DROP_ROLL_RANGE = 100;

/**
 * The game's drop tunables (DROPS_CONFIG in drops.ts is built from them; docs/BOOSTS.md P2 / P3).
 *   salt               the drop stream's seed is seedToState(seed) XOR salt ("KVDR")
 *   chancePercent      per eligible kill, for an archetype not in chanceByArchetype
 *   chanceByArchetype  per archetype id (like score's KILL_POINTS)
 *   pityKills          this many eligible kills without a drop -> the next eligible kill always drops (0 = off)
 *   groundSeconds      a drop lies on the floor this long, then fades
 *   pickupRadius       a living player's centre within this of a drop takes it
 *   maxOnGround        ground slots; a drop that finds none free is skipped (no draw; it counts as a dry kill)
 */
export const DROPS = {
	salt: 0x4b564452,
	chancePercent: 6,
	chanceByArchetype: new Map<string, number>([
		["swarmer", 3],
		["sniper", 8],
		["bruiser", 10],
	]) as ReadonlyMap<string, number>,
	pityKills: 20,
	groundSeconds: 10,
	pickupRadius: 0.6 * TILE_SIZE,
	maxOnGround: 4,
} as const;

/** A drop's ground life in ticks (DROPS.groundSeconds). */
export const DROP_GROUND_TICKS = secondsToTicks(DROPS.groundSeconds);

/** Archetype ids whose kills never roll and never count toward pity (outside a guarantee): the training dummy. */
export const DROP_INELIGIBLE_ARCHETYPES: ReadonlyArray<string> = ["dummy"];

/** The encounter room type whose kills never roll on a floor whose encounter spawns a boss (the boss, its summons, the arena). */
export const DROP_EXCLUDED_ROOM_TYPE = "boss";

/**
 * Debug input bit (KV_Debug only; key Semicolon, shared/play FIXED_INPUTS.debugDrop; M before docs/MINIMAP.md
 * MD11): drops the next boost kind (cycling by Boost index) in front of the player, DEBUG_DROP_AHEAD along their facing (so it lies on the floor instead of being collected at once; walk onto
 * it to take it). No rng draw. A Roblox-port bit beyond the web build's table, like DEBUG_FLOOR_BUTTON: it is in
 * PORT_BUTTONS / SIM_BUTTONS (input.ts), so the relay strips it and validation flags it like the other debug bits.
 */
export const DEBUG_DROP_BUTTON = 32768;
/** How far in front of the player (along the facing) a debug drop lands: beyond pickupRadius. */
export const DEBUG_DROP_AHEAD = 1.5 * TILE_SIZE;

/** A boost's full duration in ticks (BOOSTS[kind].seconds). */
export function boostTicks(kind: number): number {
	return secondsToTicks(BOOSTS[kind].seconds);
}

function totalWeight(): number {
	let w = 0;
	for (const b of BOOSTS) w += b.weight;
	return w;
}

/** The sum of every boost's weight (the kind pick's range). */
export const BOOST_TOTAL_WEIGHT = totalWeight();
