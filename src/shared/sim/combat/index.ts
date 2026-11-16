/**
 * Combat barrel (source: `src/sim/combat.ts`, `combatData.ts`, `patterns.ts`, `ctx.ts`, `actors/`, `weapons/`).
 * See ../README.md "Combat".
 */
export * from "./combatData";
export * from "./combat";
export * from "./patterns";
export * from "./bullets";
export { arcTrig, compose, definePayload, gen, mod, type PayloadLayout } from "./projectilePatterns";
export { ARC_SHAPES, type ArcShape } from "./arcTable";
export { PORT_ARC_SHAPES, PORT_ARC_SOURCES, arcAngle, type PortArcSource } from "./arcTablePort";
export * from "./stress";
export * from "./payload";
export { SimCtx } from "./ctx";
export * from "./shield";
export * from "./hookEvents";
export * from "./healEvents";
export * from "./actors";
export * from "./weapons";
export { compareIds, isValidRegistryId } from "./registryIds";
