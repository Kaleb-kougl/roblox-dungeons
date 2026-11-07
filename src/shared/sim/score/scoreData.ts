/**
 * Scoring tunables (M2, GDD "Scoring"). Data only: score.ts reads these, nothing is inline in the logic.
 *
 *   points per award = floor(base x combo x depth x curse), base x floor scaling for non-boss kills.
 *
 * Every multiplier is kept as an integer numerator over a fixed denominator so each award is integer arithmetic
 * (exact in a double, identical on every machine): combo in tenths (/COMBO_DENOMINATOR), curse in quarters
 * (/CURSE_DENOMINATOR), floor scaling in percent (/FLOOR_SCALE_DENOMINATOR).
 */

import { secondsToTicks } from "../playerData";
import { TILE_SIZE } from "../units";

// --- Kills ---------------------------------------------------------------------------------------------

/** Base kill points per archetype id. Bosses (data.boss) score into the "boss" source, everything else "kills". */
export const KILL_POINTS: ReadonlyMap<string, number> = new Map<string, number>([
	["swarmer", 50],
	["sniper", 100],
	["bruiser", 200],
	["turret.caster", 150],
	["turret.sniper", 150],
	["turret.sprayer", 150],
	["boss.act1", 5000],
	// Roblox port: the second endless boss (docs/BOSS_DEMONLORD.md), Mother Mayhem's budget and points.
	["boss.demonlord", 5000],
	// Roblox port: the endless room enemies (docs/ENEMY_VARIANTS.md EV1).
	["imp", 120],
	["slime", 150],
	["slime.small", 40],
	["summoner", 200],
	// Roblox port: the second set of endless room enemies (docs/NEW_ENEMIES.md NE1). A detonated Bomber scores nothing
	// (NE2); a shot one scores its row.
	["bomber", 80],
	["charger", 220],
	["stormcaller", 180],
	["warbanner", 160],
	["reaper", 200],
]);
/** Kill points of an archetype id not in the table (test archetypes). */
export const DEFAULT_KILL_POINTS = 50;
/** Extra boss points when the player took no landed hit during the boss's final phase. */
export const BOSS_NO_HIT_BONUS = 2500;
/** A boss's final phase (ActorState.phase), per archetype id: the no-hit bonus window. */
export const BOSS_FINAL_PHASE: ReadonlyMap<string, number> = new Map<string, number>([
	["boss.act1", 3],
	["boss.demonlord", 3],
]);

/** Non-boss kill floor scaling: x (1 + FLOOR_SCALE_PERCENT_PER_FLOOR / 100 x (floor - 1)) = 1 + 0.08 (floor - 1). */
export const FLOOR_SCALE_PERCENT_PER_FLOOR = 8;
export const FLOOR_SCALE_DENOMINATOR = 100;

// --- Bullets -------------------------------------------------------------------------------------------

/** Points per graze (an enemy bullet passing through the graze ring without ever entering the hit circle). */
export const GRAZE_POINTS = 5;
/** The graze ring reaches this far beyond the hit distance (PLAYER_RADIUS + ENEMY_BULLET_RADIUS), world units. */
export const GRAZE_MARGIN = 0.5 * TILE_SIZE;
/** Points per enemy bullet erased by the sword's guard. */
export const GUARD_CANCEL_POINTS = 10;

// --- Rooms and floors ------------------------------------------------------------------------------------

/** The last member of an encounter room died. */
export const ROOM_CLEAR_POINTS = 250;
/** ... and no hit landed on the player from the room's engagement to its clear. */
export const ROOM_PERFECT_POINTS = 500;
/** ... plus this many points per tick the clear beat the room's par time. */
export const FAST_POINTS_PER_TICK = 1;
/** Room par time = ROOM_PAR_BASE_TICKS + ROOM_PAR_TICKS_PER_COST x (sum of encounterCost over the room's spawns). */
export const ROOM_PAR_BASE_SECONDS = 6;
export const ROOM_PAR_SECONDS_PER_COST = 1.5;
export const ROOM_PAR_BASE_TICKS = secondsToTicks(ROOM_PAR_BASE_SECONDS); // 360
export const ROOM_PAR_TICKS_PER_COST = secondsToTicks(ROOM_PAR_SECONDS_PER_COST); // 90
/** Floor clear: FLOOR_CLEAR_POINTS x floor (awardFloorClear). */
export const FLOOR_CLEAR_POINTS = 1000;

// --- Breakables (docs/DECOR.md D4, B5) ------------------------------------------------------------------

/**
 * Points per breakable a PLAYER breaks (sword or player bullet; enemy bullets and the boss's slam score nothing), by
 * kind (shared/sim BreakableKind order: barrel, crate), x the floor. Through the usual multipliers (combo, Depth,
 * curses) but it never feeds the combo and has nothing to do with rooms (clear, perfect, fast).
 */
export const BREAKABLE_POINTS: ReadonlyArray<number> = [10, 20];

// --- Builds (docs/BUILDS.md BU5) ------------------------------------------------------------------------

/**
 * Jackpot (Bounty III, sim/builds): every 15th kill by its owner pays JACKPOT_POINTS x the floor into the JACKPOT
 * source, through the usual multipliers (combo, Depth, curses); it never feeds the combo and touches no room record.
 */
export const JACKPOT_POINTS = 100;

// --- Multipliers -----------------------------------------------------------------------------------------

/** The combo is an integer of tenths: 10 = x1.0 .. 50 = x5.0. */
export const COMBO_DENOMINATOR = 10;

/**
 * Gold Rush (the Bounty + Lingering duo, docs/BUILDS.md BU6, builds runs only): a kill scored while the combo is at
 * least GOLD_RUSH_MIN_COMBO tenths (x3, before the kill's own +0.1) scores x GOLD_RUSH_PERCENT / 100 more, applied
 * after Bounty (and the affix bonus) as one more integer percent factor (awardPoints' extraPercent).
 */
export const GOLD_RUSH_PERCENT = 125;
export const GOLD_RUSH_MIN_COMBO_TIER = 3;
export const GOLD_RUSH_MIN_COMBO = GOLD_RUSH_MIN_COMBO_TIER * COMBO_DENOMINATOR;
export const COMBO_MIN = 10;
export const COMBO_MAX = 50;
/** Every kill or graze adds this many tenths (+0.1), capped at COMBO_MAX. */
export const COMBO_STEP = 1;
/** With no kill or graze for this long the combo resets to COMBO_MIN (port retune: 2x the web build's 3 s). */
export const COMBO_WINDOW_SECONDS = 6;
export const COMBO_WINDOW_TICKS = secondsToTicks(COMBO_WINDOW_SECONDS); // 360
/**
 * A landed hit cuts the combo by 1 / max(COMBO_CUT_MIN_DIVISOR, partySize), i.e. cut = min(1/2, 1/partySize):
 * combo = max(COMBO_MIN, floor(combo x (d - 1) / d)) in tenths (rounded DOWN to the tenth).
 */
export const COMBO_CUT_MIN_DIVISOR = 2;
/** Default party size (solo). */
export const DEFAULT_PARTY_SIZE = 1;

/** The curse multiplier is an integer of quarters: 4 = x1.0, +1 (+0.25) per curse. */
export const CURSE_DENOMINATOR = 4;
export const CURSE_BASE = 4;
export const CURSE_STEP = 1;

/** Depth / floor when endless mode is absent. */
export const DEFAULT_DEPTH = 1;
export const DEFAULT_FLOOR = 1;

// --- Sources (the results screen's breakdown) ----------------------------------------------------------------

/** Index of each score source in ScoreState.points / counts. Append only (hash order). */
export const ScoreSource = {
	KILLS: 0,
	GRAZES: 1,
	GUARD: 2,
	ROOMS: 3,
	PERFECT: 4,
	FAST: 5,
	FLOORS: 6,
	BOSS: 7,
	/** Breakables broken by a player (docs/DECOR.md D4): appended, so every earlier index stays put. */
	BREAKABLES: 8,
	/**
	 * Jackpot (docs/BUILDS.md BU5, Bounty III): appended after BREAKABLES, and ONLY in runs with SimConfig.builds
	 * (BUILD_SCORE_SOURCE_NAMES; createSimState appends its entry to points / counts there, addBuildScoreSources).
	 * Every other scored run keeps SCORE_SOURCE_COUNT sources, so its "score" hash group is unchanged.
	 */
	JACKPOT: 9,
	/**
	 * Pellets (docs/PELLETS.md PL2): every pellet taken and every enemy bullet the power pellet converts. Appended after
	 * JACKPOT, and ONLY in runs with SimConfig.pellets (PELLET_SCORE_SOURCE_NAMES; createSimState pads points / counts to
	 * them, JACKPOT included, addPelletScoreSources). Every other scored run's "score" hash group is unchanged.
	 */
	PELLETS: 10,
	/** The Sweep (docs/PELLETS.md): every pellet of a room taken before its clear. Pellet runs only, like PELLETS. */
	SWEEP: 11,
	/**
	 * Treasure (docs/TREASURE.md TR2): a vault's chest opened, once per open, combo-neutral (score.ts scoreTreasure).
	 * Appended after SWEEP, and ONLY in runs with SimConfig.treasure (TREASURE_SCORE_SOURCE_NAMES; createSimState pads
	 * points / counts to it, JACKPOT / PELLETS / SWEEP included, addTreasureScoreSources). Every other scored run's
	 * "score" hash group is unchanged.
	 */
	TREASURE: 12,
	/** Pacts' Horde (docs/FORTUNE.md): pacts runs only, after TREASURE (padding it in a pacts run without treasure). */
	HORDE: 13,
	/**
	 * The Goldling (docs/FORTUNE.md GE3): its coins per damaging hit and the jackpot of its catch. Appended after HORDE,
	 * and ONLY in runs with SimConfig.golden (GOLDEN_SCORE_SOURCE_NAMES; createSimState pads points / counts to it,
	 * every earlier gated source included, addGoldenScoreSources: JACKPOT, PELLETS, SWEEP, TREASURE and HORDE stay 0 in a
	 * run without builds / pellets / treasure / pacts). Every other scored run's "score" hash group is unchanged.
	 */
	GOLDEN: 14,
} as const;
export type ScoreSourceId = (typeof ScoreSource)[keyof typeof ScoreSource];
/** Source names in index order (dump names, results screen string keys `score.source.<name>`). */
export const SCORE_SOURCE_NAMES = [
	"kills",
	"grazes",
	"guard",
	"rooms",
	"perfect",
	"fast",
	"floors",
	"boss",
	"breakables",
] as const;
/** The sources every scored run has (points / counts length without builds). */
export const SCORE_SOURCE_COUNT = SCORE_SOURCE_NAMES.size();
/**
 * Sources only a builds run has, appended after SCORE_SOURCE_NAMES (ScoreSource.JACKPOT = SCORE_SOURCE_COUNT). A builds
 * run's points / counts hold SCORE_SOURCE_COUNT + BUILD_SCORE_SOURCE_NAMES.size() entries.
 */
export const BUILD_SCORE_SOURCE_NAMES = ["jackpot"] as const;
/**
 * Sources only a pellets run has (docs/PELLETS.md PL2), appended after BUILD_SCORE_SOURCE_NAMES (ScoreSource.PELLETS =
 * SCORE_SOURCE_COUNT + BUILD_SCORE_SOURCE_NAMES.size()). A pellets run's points / counts hold every source up to these
 * (a pellets run without builds pads JACKPOT, always 0 there).
 */
export const PELLET_SCORE_SOURCE_NAMES = ["pellets", "sweep"] as const;
/**
 * Sources only a treasure run has (docs/TREASURE.md TR2), appended after PELLET_SCORE_SOURCE_NAMES (ScoreSource.TREASURE
 * = SCORE_SOURCE_COUNT + BUILD_SCORE_SOURCE_NAMES.size() + PELLET_SCORE_SOURCE_NAMES.size()). A treasure run's points /
 * counts hold every source up to these (without builds or pellets the padded JACKPOT / PELLETS / SWEEP stay 0).
 */
export const TREASURE_SCORE_SOURCE_NAMES = ["treasure"] as const;
/**
 * Sources only a pacts run has (docs/FORTUNE.md PS4: the Horde's extra half, every x2 award's second half), appended
 * after TREASURE_SCORE_SOURCE_NAMES (ScoreSource.HORDE 13). A pacts run's points / counts hold every source up to these
 * (a pacts run without builds, pellets or treasure pads JACKPOT / PELLETS / SWEEP / TREASURE, always 0 there).
 */
export const PACT_SCORE_SOURCE_NAMES = ["horde"] as const;
/**
 * Sources only a Goldling run has (docs/FORTUNE.md GE3), at ScoreSource.GOLDEN (14): after the pellets', treasure's
 * (12) and Pacts' Horde (13). A Goldling run's points / counts hold every source up to it (padding the earlier gated
 * ones).
 */
export const GOLDEN_SCORE_SOURCE_NAMES = ["golden"] as const;
