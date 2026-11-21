/**
 * Barrel for elite affixes in the sim (docs/ENEMY_VARIANTS.md EV7): rules (affixesData.ts), the opt-in state, hooks,
 * reads and hash (affixes.ts), and the affix phase (stepAffixes.ts). Inside the sim, import the files directly (a barrel
 * import from inside would create require cycles).
 *
 * @module
 */
export * from "./affixesData";
export * from "./affixes";
export * from "./stepAffixes";
