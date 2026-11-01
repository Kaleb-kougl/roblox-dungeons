/**
 * Void decoration (docs/VOID_DECOR.md), the pure headless core: what the space around the dungeon is drawn as. Reads
 * the Dungeon, never the sim; deterministic (decorHash of the floor seed); presentation only. Not `void/`: `void` is a
 * TypeScript keyword.
 *
 *   config.ts  VOID (heights, widths, outcrop rules, rect budget, salts), VOID_DEPTH (per depth band knobs, VD4),
 *              VOID_PIECES (the set pieces' caps, spacing and salts, VD5)
 *   layer.ts   VoidLayer (no imports: shared/view/decor's planDecor reads it without a require cycle)
 *   field.ts   voidField: Chebyshev distance to the nearest wall / floor cell, enclosed void pockets
 *   plan.ts    planVoid / planVoidCached: per-cell layer (shoulder / ledge / outcrop / abyss) and top, greedy rects
 *   viewConfig.ts  VOID_VIEW (VD3 / VD9): the VoidController's folder, debug attributes and palette, column sink
 *   parts.ts   voidRunInput (a run floor's plan input, as DecorController's), voidColumnOf (a rect's Part in studs),
 *              voidLayerStyle (colour / material / debug tint per layer)
 */
export * from "./config";
export * from "./field";
export * from "./layer";
export * from "./plan";
export * from "./viewConfig";
export * from "./parts";
