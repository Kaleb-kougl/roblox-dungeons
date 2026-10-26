/**
 * Barrel for the decor plan (docs/DECOR.md R3, R6, R8): pure, deterministic, headless-tested view logic. It reads the
 * Dungeon, never the sim.
 *
 *   decorPlan.ts  planDecor: which Forge pieces are drawn, as what (layer, kind) and where; R6 far-wall dressing
 *   profile.ts    decorProfile: the depth band's thinning / swaps / weights, the darkest-band contrast check
 *   decor.ts      the renderer's pure parts: fade selection, glow points
 *   screen.ts     the game camera's on-screen projection and convex-polygon helpers
 *   hash.ts       decorHash(floorSeed, cell, salt)
 *   config.ts     DECOR_DEPTH, DECOR_CLEAR, DECOR_DRESSING, DECOR_PLACE, DECOR_SALT
 */
export * from "./config";
export * from "./hash";
export * from "./screen";
export * from "./profile";
export * from "./decorPlan";
export * from "./decor";
