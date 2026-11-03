/**
 * Barrel for pellets in the sim (docs/PELLETS.md): tunables (pelletsData.ts) and the opt-in state, floor fill, clone
 * and hash (pellets.ts). Inside the sim, import the files directly (a barrel import from inside would create require
 * cycles).
 */
export * from "./pelletsData";
export * from "./pellets";
