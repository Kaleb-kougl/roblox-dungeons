/**
 * The player's starting weapon sets (E1.8; source: `src/sim/weapons/loadout.ts`): one main weapon id per set, set 0
 * in hand at run start. SimConfig.loadout overrides it per run; live play and replays must use the same one.
 * An empty set is `undefined` (the source's `null`) or "".
 */

/** Default loadout: the sword in hand (set 0), the bow on SWAP (set 1). */
export const DEFAULT_LOADOUT: ReadonlyArray<string | undefined> = ["weapon.sword", "weapon.bow"];
