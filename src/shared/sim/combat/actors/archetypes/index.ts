/**
 * Every archetype the game knows (source: `src/sim/actors/archetypes/index.ts`). Each file registers its ArchetypeDef
 * with registerArchetype() when imported; combat.ts imports this index so they are all registered before a run starts.
 * Add an archetype: one file in this folder plus ONE export line below (order does not matter: kinds come from the
 * sorted ids). The re-exports give tests and the renderer each archetype's states, slots and data.
 *
 * @module
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

// --- E1.8 bosses (the fight skeleton they share: ./boss/shared.ts, a Roblox-port module; bossArena / phaseFloor
// used to be act1's exports and are the skeleton's now)
export * from "./boss/shared";
export * from "./boss/act1";

// --- Roblox port: the tutorial (band PORT_BAND_TUTORIAL: numbered after every archetype above)
export * from "./dummy";

// --- Roblox port: endless bosses (band PORT_BAND_BOSSES: numbered after the tutorial's; docs/BOSS_DEMONLORD.md)
export * from "./boss/demonlord";
export * from "./boss/hp";

// --- Roblox port: endless room enemies (band PORT_BAND_ENEMIES: numbered after the port's bosses; docs/ENEMY_VARIANTS.md)
export * from "./imp";
export * from "./slime";
export * from "./summoner";

// --- Roblox port: the second set of endless room enemies (band PORT_BAND_ENEMIES_2: numbered after band 3;
// docs/NEW_ENEMIES.md)
export * from "./bomber";
export * from "./charger";
export * from "./reaper";
export * from "./stormcaller";
export * from "./warbanner";

// --- Roblox port: the Goldling (band PORT_BAND_FORTUNE: numbered after band 4; docs/FORTUNE.md)
export * from "./golden";

// --- Roblox port: the third set of endless room enemies and the Pyre-keeper's brazier (band PORT_BAND_ENEMIES_3:
// numbered after band 5; docs/NEW_ENEMIES_2.md)
export * from "./bulwark";
export * from "./chainhook";
export * from "./pyre";
export * from "./pyrekeeper";
export * from "./snatcher";
export * from "./snatcherField";

// --- Roblox port: the fourth set of endless room enemies (band PORT_BAND_ENEMIES_4: numbered after band 6;
// docs/NEW_ENEMIES_3.md)
export * from "./jackal";
export * from "./mender";
export * from "./mortar";
