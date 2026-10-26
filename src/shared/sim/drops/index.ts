/**
 * Barrel for boost drops in the sim (docs/BOOSTS.md): tunables (dropsData.ts), the opt-in state, kill / room hooks,
 * stepDrops, read helpers and hash (drops.ts), and the effect reads (boostMods.ts). Inside the sim, import the files
 * directly (a barrel import from inside would create require cycles).
 */
export * from "./dropsData";
export * from "./drops";
export * from "./boostMods";
