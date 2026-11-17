/**
 * Barrel for cosmetics (docs/COSMETICS.md): the one list of cosmetic items with their slots and tiers (items.ts; the
 * Armory's catalogue rows and the theme's colours are keyed by it) and a player's look, the item ids they wear
 * (look.ts). Plain TypeScript with no runtime import (headlessly tested); presentation only: never hashed or recorded.
 */
export * from "./items";
export * from "./look";
