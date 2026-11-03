/**
 * Barrel for pellets in the sim (docs/PELLETS.md): tunables (pelletsData.ts), the opt-in state, floor fill, clone
 * and hash (pellets.ts), the room hooks stepScore calls (pelletRooms.ts) and the tick's pickups and power pellet
 * (stepPellets.ts). Inside the sim, import the files directly (a barrel import from inside would create require
 * cycles).
 */
export * from "./pelletsData";
export * from "./pellets";
export * from "./pelletRooms";
export * from "./stepPellets";
