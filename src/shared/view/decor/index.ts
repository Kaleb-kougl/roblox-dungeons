/**
 * Barrel for the decor plan and its renderers' pure half (docs/DECOR.md R3, R4, R6, R8, R9, R10): deterministic,
 * headless-tested view logic. The plan reads the Dungeon; the director reads the sim state; neither ever writes it.
 *
 *   decorPlan.ts  planDecor: which Forge pieces are drawn, as what (layer, kind) and where; R6 far-wall dressing
 *   profile.ts    decorProfile: the depth band's thinning / swaps / weights, the darkest-band contrast check
 *   decor.ts      the renderer's pure parts: fade selection, glow points
 *   scene.ts      decorScene: a floor's plan + boss ring (flat fire pits), stairwell, shrine, pedestals (R4 / R10)
 *   director.ts   DecorDirector: the decoration reacting to the run, a reused DecorView (R10)
 *   lights.ts     the light pool (DecorLightPool, nearestDecorLights) and seeded flicker (R9)
 *   render.ts     renderer helpers: facings, fade bodies / tween, loop frames, footprints, the ambient emitter (R4 / R9)
 *   screen.ts     the game camera's on-screen projection and convex-polygon helpers
 *   hash.ts       decorHash(floorSeed, cell, salt)
 *   config.ts     DECOR_DEPTH, DECOR_CLEAR, DECOR_DRESSING, DECOR_PLACE, DECOR_SALT
 *   reactConfig.ts DECOR_REACT (the director)
 *   fxConfig.ts   DECOR_RENDER_ORDER, DECOR_VIEW, DECOR_LIGHTS, DECOR_FX (the client renderers)
 */
export * from "./config";
export * from "./hash";
export * from "./screen";
export * from "./profile";
export * from "./decorPlan";
export * from "./decor";
export * from "./reactConfig";
export * from "./fxConfig";
export * from "./scene";
export * from "./director";
export * from "./lights";
export * from "./render";
