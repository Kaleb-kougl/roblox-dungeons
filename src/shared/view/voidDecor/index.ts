/**
 * Void decoration (docs/VOID_DECOR.md), the pure headless core: what the space around the dungeon is drawn as. Reads
 * the Dungeon, never the sim; deterministic (decorHash of the floor seed); presentation only. Not `void/`: `void` is a
 * TypeScript keyword.
 *
 *   config.ts  VOID (heights, widths, outcrop rules, rect budget, salts), VOID_DEPTH (per depth band knobs, VD4)
 *   field.ts   voidField: Chebyshev distance to the nearest wall / floor cell, enclosed void pockets
 *   plan.ts    planVoid / planVoidCached: per-cell layer (shoulder / ledge / outcrop / abyss) and top, greedy rects
 */
export * from "./config";
export * from "./field";
export * from "./plan";
