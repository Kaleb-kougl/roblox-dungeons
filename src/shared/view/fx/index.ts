/**
 * Barrel for the juice layer's pure logic (port of project-kaleb-vale src/fx @ 42897e2): the hit tracker and its
 * events, the shared juice rules (reduced motion, particle budget), the hitstop clock and freeze-frame rules, health
 * bar layout and state, the damage number pool, the death particle system, the render-side PRNG and the sprite-effect
 * cues (fxCues), the per-tick collectors the run views fill (roomClears, comboEvents, nearMissEvents, variantCueEvents, buildFxEvents; the run-long recapTally), the grazes and
 * parries rules (nearMissRules, nearMissConfig), the co-op moments (teamMoments, teamMomentsConfig, teamMomentsView, syncCallout) and the build effects' rules (buildFxRules, buildFxConfig) and Bastion's brace feedback (braceFx, braceFxConfig; docs/LEGENDARIES.md LG6), and builds v2, wave 1's planners (docs/BUILDS_V2.md BV11: buildsV2FxConfig, buildsV2Fx, counterWaveFx, siegeFx, wreckerFx, heartBeamFx, overcapFx). No Roblox API: every module is tested headlessly. The client controllers in src/client/controllers/fx
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
export * from "./recapTally";
export * from "./teamMomentsConfig";
export * from "./teamMoments";
export * from "./teamMomentsView";
export * from "./syncCallout";
export * from "./variantCueEvents";
export * from "./buildFxConfig";
export * from "./buildFxEvents";
export * from "./buildFxRules";
export * from "./braceFxConfig";
export * from "./braceFx";
// docs/BUILDS_V2.md BV11: builds v2, wave 1's pure view core.
export * from "./buildsV2FxConfig";
export * from "./buildsV2Fx";
export * from "./counterWaveFx";
export * from "./siegeFx";
export * from "./wreckerFx";
export * from "./heartBeamFx";
export * from "./overcapFx";
