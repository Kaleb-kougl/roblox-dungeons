/**
 * Barrel for the juice layer's pure logic (port of project-kaleb-vale src/fx @ 42897e2): the hit tracker and its
 * events, the shared juice rules (reduced motion, particle budget), the hitstop clock and freeze-frame rules, health
 * bar layout and state, the damage number pool, the death particle system, the render-side PRNG and the sprite-effect
 * cues (fxCues), the per-tick collectors the run views fill (roomClears, comboEvents, nearMissEvents, variantCueEvents) and the grazes and
 * parries rules (nearMissRules, nearMissConfig). No Roblox API: every module is tested headlessly. The client controllers in src/client/controllers/fx
 * draw them.
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
export * from "./fxCues";
export * from "./hurtConfig";
export * from "./hurtFlash";
export * from "./lowHealth";
export * from "./hitReactConfig";
export * from "./hitReact";
export * from "./motionFxConfig";
export * from "./squash";
export * from "./afterimage";
export * from "./roomClears";
export * from "./comboEvents";
export * from "./roomClearConfig";
export * from "./roomClearSequence";
export * from "./roomClearRules";
export * from "./nearMissEvents";
export * from "./nearMissConfig";
export * from "./nearMissRules";
export * from "./variantCueEvents";
