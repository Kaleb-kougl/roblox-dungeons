/**
 * The Goldling's sim tunables (docs/FORTUNE.md "The Goldling", GE2 / GE3, decisions FD9-FD12; a Roblox-port feature, no
 * web source). Data only, a LEAF (units / playerData / jsnum only): golden.ts builds ENDLESS_GOLDEN_CONFIG from these,
 * score.ts and the archetype read the kind id and statuses from here without a require cycle. Where it runs is floor
 * data (shared/dungeon goldenData.ts GOLDEN_PLACE).
 */
import { SQRT1_2 } from "../jsnum";
import { secondsToTicks } from "../playerData";
import { TILE_SIZE } from "../units";

/** The Goldling's archetype id (combat/actors/archetypes/golden.ts; band PORT_BAND_FORTUNE, index 18). */
export const GOLDEN_KIND = "golden";

/** GoldenState.status. Append only (hashed). */
export const GoldenStatus = {
	/** No Goldling on this floor (or no endless floor). */
	NONE: 0,
	/** Its room rolled one; waiting for the room's record to engage + appearTicks. */
	WAITING: 1,
	/** Out and running (GoldenState.actorSlot / actorId). */
	RUNNING: 2,
	/** Killed: the jackpot paid. */
	CAUGHT: 3,
	/** Its time ran out: gone, coins kept. */
	ESCAPED: 4,
	/** It was due but the actor pool was full (MAX_ACTORS): it never appeared (docs/FORTUNE.md: a full pool skips it). */
	SKIPPED: 5,
} as const;

/** It appears this long after its room's record engages (FD10: 3 s). */
export const GOLDEN_APPEAR_TICKS = secondsToTicks(3);
/** It escapes this long after appearing (FD10: 10 s). */
export const GOLDEN_ESCAPE_TICKS = secondsToTicks(10);
/** The flee field's sources (living players' cells) are re-read every this many ticks. */
export const GOLDEN_FIELD_TICKS = 6;
/** A living player this close (centre to centre, world units) starts a jink when the cooldown is ready. */
export const GOLDEN_JINK_RANGE = 2.5 * TILE_SIZE;
/** Ticks between jinks (1.5 s), counted from a jink's start. */
export const GOLDEN_JINK_COOLDOWN_TICKS = secondsToTicks(1.5);
/** A jink's sidestep lasts this long (0.25 s). */
export const GOLDEN_JINK_TICKS = secondsToTicks(0.25);
/** The sidestep's speed (world units / s; the run is the archetype's data.speed). */
export const GOLDEN_JINK_SPEED = 9;
/** Base points per damaging hit (x the kills' floor scale, through combo / Depth / curses; never feeds the combo). */
export const GOLDEN_HIT_POINTS = 50;
/** Base points of the catch (x the kills' floor scale, like any kill; feeds the combo once). */
export const GOLDEN_KILL_POINTS = 1500;
/** A catch lands the party size + this many boosts (FD12). */
export const GOLDEN_EXTRA_BOOSTS = 1;
/** Distance of the catch's boost ring from the catch point (world units; past the drops' pickup radius 0.6). */
export const GOLDEN_BOOST_RING_RADIUS = 1 * TILE_SIZE;
/**
 * The catch's boosts land at the catch point plus these offsets (x GOLDEN_BOOST_RING_RADIUS), in this order: the four
 * straight directions, then the diagonals, then the point itself (MAX_PARTY_SIZE 8 + 1 = 9 boosts at most; the drops'
 * ground has 4 slots). An offset whose cell is not open floor of the room lands on the catch point instead.
 */
export const GOLDEN_BOOST_RING: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1],
	[SQRT1_2, SQRT1_2],
	[-SQRT1_2, SQRT1_2],
	[-SQRT1_2, -SQRT1_2],
	[SQRT1_2, -SQRT1_2],
	[0, 0],
];
/**
 * The Goldling's own sim rng stream: seedToState(run seed) XOR this, like the drops' stream (seedToState(seed) ^
 * DROPS.salt). A salt of its own, unused anywhere else in src/shared: not the dungeon roll's (shared/dungeon
 * GOLDEN_PLACE.salt 0x3d2f8b4d, mixed into the floor seed), so the floor roll and the sim stream share no word. Drawn
 * only for a jink's side and the catch's boost kinds.
 */
export const GOLDEN_SIM_SALT = 0x7a3c5e91;
