/**
 * Barrel for the Goldling in the sim (docs/FORTUNE.md "The Goldling"): tunables (goldenData.ts), the opt-in config,
 * state, floor fill, clone and hash (golden.ts), the flee field (goldenField.ts), the hit / catch hooks
 * (goldenHooks.ts) and the tick's appearance and escape (stepGolden.ts). The archetype is
 * combat/actors/archetypes/golden.ts. Inside the sim, import the files directly (a barrel import from inside would
 * create require cycles).
 */
export * from "./goldenData";
export * from "./golden";
export * from "./goldenField";
export * from "./goldenHooks";
export * from "./stepGolden";
