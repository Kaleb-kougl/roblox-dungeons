/**
 * The player's starting weapon sets (E1.8; source: `src/sim/weapons/loadout.ts`): one main weapon id per set, set 0
 * in hand at run start. SimConfig.loadout overrides it per run; live play and replays must use the same one.
 * An empty set is `undefined` (the source's `null`) or "".
 *
 * @module
 */

/** The sword's weapon id (defs/sword.ts SWORD.id): a loadout entry and a boon / relic's `requires` (docs/ARCHER.md). */
export const SWORD_WEAPON_ID = "weapon.sword";
/** The bow's weapon id (defs/bow.ts BOW.id). */
export const BOW_WEAPON_ID = "weapon.bow";

/** Default loadout: the sword in hand (set 0), the bow on SWAP (set 1). */
export const DEFAULT_LOADOUT: ReadonlyArray<string | undefined> = [SWORD_WEAPON_ID, BOW_WEAPON_ID];
