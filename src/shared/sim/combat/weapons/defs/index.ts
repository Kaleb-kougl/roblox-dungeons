/**
 * Every weapon the game knows (source: `src/sim/weapons/defs/index.ts`). Each file registers its WeaponDef with
 * registerWeapon() when imported; combat.ts imports this index so they are all registered before a run starts.
 * Order does not matter: indices come from the sorted ids.
 *
 * @module
 */

// --- placeholders (E1.6 / E1.8 prep)
import "./test";
import "./testMelee";

// --- E1.8 weapons (ranged, melee)
import "./bow";
import "./sword";

export {};
