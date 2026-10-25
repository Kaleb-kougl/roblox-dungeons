/**
 * Barrel for the Dungeon Forge generator, tile collision and encounter placement (PLAN.md task 5). Deterministic
 * like the sim: plain TypeScript, no Roblox APIs, because the sim's move resolver calls into it.
 *
 * Dungeon Forge is MIT (c) 2026 Majid Manzarpour; see THIRD_PARTY_NOTICES.md.
 */
export * from "./forge";
export * from "./collision";
export * from "./spawn";
export * from "./encounterTypes";
export * from "./encounter";
export * from "./enemyRooms";
export * from "./encounterCost";
export * from "./endlessData";
export * from "./endless";
