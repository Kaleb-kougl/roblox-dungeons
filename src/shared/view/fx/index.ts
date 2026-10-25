/**
 * Barrel for the juice layer's pure logic (port of project-kaleb-vale src/fx @ 42897e2): the hit tracker and its
 * events, the shared juice rules (reduced motion, particle budget), the hitstop clock and freeze-frame rules, health
 * bar layout and state, the damage number pool, the death particle system and the render-side PRNG. No Roblox API:
 * every module is tested headlessly. The client controllers in src/client/controllers/fx draw them.
 */
export * from "./events";
export * from "./tracker";
export * from "./juiceRules";
export * from "./hitstop";
export * from "./freezeRules";
export * from "./bars";
export * from "./barState";
export * from "./numbers";
export * from "./particles";
export * from "./rng";
export * from "./config";
export * from "./scorePops";
