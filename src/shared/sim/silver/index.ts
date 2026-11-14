/**
 * Barrel for Silver in crates in the sim (docs/SILVER.md SC2): the opt-in config, state, floor fill, the break hook,
 * events, clone, hash and the total's accessor (silver.ts). Inside the sim, import the file directly (a barrel import
 * from inside would create require cycles).
 */
export * from "./silver";
