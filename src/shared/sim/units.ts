/**
 * Shared units every system agrees on: the fixed tick rate and the tile size.
 *
 * Source: project-kaleb-vale `src/config.ts` (SIM_HZ, SIM_DT, TILE_SIZE) @ 42897e2. The camera / render numbers of that
 * file live in `shared/config` (view.ts); these are the ones the deterministic sim reads.
 *
 * @module
 */

/** World units per dungeon tile. Dungeon grid (gx, gy) maps to world (gx, 0, gy); Y is up, the floor is y = 0. */
export const TILE_SIZE = 1;

/** Fixed simulation rate (GDD: fixed 60 Hz timestep, separate from rendering). */
export const SIM_HZ = 60;
/** Seconds per sim tick (1 / 60). Per-second speeds are multiplied by this once per tick. */
export const SIM_DT = 1 / SIM_HZ;
