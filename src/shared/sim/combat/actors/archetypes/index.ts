/**
 * Every archetype the game knows (source: `src/sim/actors/archetypes/index.ts`). Each file registers its ArchetypeDef
 * with registerArchetype() when imported; combat.ts imports this index so they are all registered before a run starts.
 * Add an archetype: one file in this folder plus ONE export line below (order does not matter: kinds come from the
 * sorted ids). The re-exports give tests and the renderer each archetype's states, slots and data.
 */

// --- M1 sandbox turrets (E1.6)
export * from "./turretShared";
export * from "./turretSprayer";
export * from "./turretSniper";
export * from "./turretCaster";

// --- E1.8 enemies
export * from "./enemyShared";
export * from "./swarmer";
export * from "./sniper";
export * from "./bruiser";

// --- E1.8 bosses
export * from "./boss/act1";

// --- Roblox port: the tutorial (band PORT_BAND_TUTORIAL: numbered after every archetype above)
export * from "./dummy";
