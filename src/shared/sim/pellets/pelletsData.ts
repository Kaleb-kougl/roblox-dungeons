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
