/**
 * Barrel for breakable barrels and crates in the sim (docs/DECOR.md D4): tunables (breakablesData.ts) and the opt-in
 * state, damage, collision lookup and hash (breakables.ts). Inside the sim, import the files directly (a barrel
 * import from inside would create require cycles).
 */
export * from "./breakablesData";
export * from "./breakables";
export * from "./cells";
