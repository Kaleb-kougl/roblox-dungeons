/**
 * Pellet tunables in the sim (docs/PELLETS.md PL2, decisions PD1 / PD6 / PD7 / PD8; a Roblox-port feature, no web
 * source). Data only, a LEAF: pellets.ts builds PELLETS_CONFIG from these; score.ts reads the run's config through
 * state.pellets. Where the pellets lie is floor data (shared/dungeon pelletsData.ts PELLETS).
 */
import { TILE_SIZE } from "../units";

/** A living player's centre within this of a live pellet takes it (PD7: under half a tile, so the lookup stays 3 x 3). */
export const PELLET_PICKUP_RADIUS = 0.45 * TILE_SIZE;
/** Base points per pellet, at the kills' floor scale (score floorScalePercent), through combo / Depth / curses. */
export const PELLET_POINTS = 5;
/** The Sweep: every pellet of a room taken before its clear. Flat (like ROOM_CLEAR_POINTS), through the multipliers. */
export const SWEEP_POINTS = 250;
/** Per enemy bullet the power pellet converts. Flat, through the multipliers. */
export const POWER_BULLET_POINTS = 5;
/** The power pellet pays at most this many bullets (every non-goo enemy bullet is still erased). */
export const POWER_MAX_BULLETS = 100;

/** PelletRoom.phase (a leaf constant: pellets.ts, pelletRooms.ts and stepPellets.ts read it). */
export const PelletPhase = {
	/** Not engaged yet: its pellets lie there but cannot be taken (and the view hides them). */
	DORMANT: 0,
	/** Engaged, not cleared: its pellets can be taken. */
	LIVE: 1,
	/** Cleared: what was left is gone. */
	GONE: 2,
} as const;

/**
 * PelletsState.taken values the Snatcher writes (docs/NEW_ENEMIES_2.md NX4; today's 0 = on the floor and 1 = taken by a
 * player stay as they are). Every reader treats any value but 0 as "not on the floor" (NX0's reader list), and neither
 * value ever touches PelletRoom.left: a STOLEN pellet is carried in a Snatcher's belly (back to 0 in place at its
 * death: collectable again), a DIGESTED one is gone for good (swallowed: the room's Sweep can no longer pay, NXD11).
 * Without a Snatcher no pellet ever holds either value, so every pellets hash is unchanged.
 */
export const PELLET_STOLEN = 2;
export const PELLET_DIGESTED = 3;

/**
 * The pellet thief's archetype id (combat/actors/archetypes/snatcher.ts registers it; a leaf constant so pacts' Horde,
 * which never buys one for its second wave (NXD9), reads it without importing the archetype).
 */
export const SNATCHER_KIND = "snatcher";
