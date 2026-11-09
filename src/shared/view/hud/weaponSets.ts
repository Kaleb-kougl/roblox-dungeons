/**
 * The weapon sets on the HUD (docs/ARCHER.md AR9; presentation only). A Knight or an Archer carries one weapon (set 1
 * empty) and SWAP does nothing for them (shared/sim stepWeapons: a swap onto an empty set is refused), so the weapons
 * panel shows only the set that holds a weapon and every swap prompt (the panel's timed hint, the pause overlay's key
 * line, the touch Swap button) shows only while there is a set to swap to. A two-weapon player (M1, dev "Both
 * weapons") sees exactly what they saw before. Pure; `weapons` is the snapshot's weapon id per set ("" for an empty
 * set, shared/play GameSnapshot.weapons).
 */

/** True when at least two sets hold a weapon: SWAP has a set to switch to (always, for a two-weapon loadout). */
export function hasSwapTarget(weapons: ReadonlyArray<string>): boolean {
	let held = 0;
	for (const id of weapons) if (id !== "") held++;
	return held >= 2;
}

/**
 * The sets the weapons panel draws, in set order: every set while there is a swap target (or while no set holds a
 * weapon: today's "-" slots), else only the sets that hold one (a Knight's sword, an Archer's bow).
 */
export function shownWeaponSets(weapons: ReadonlyArray<string>): number[] {
	const out: number[] = [];
	let held = 0;
	for (const id of weapons) if (id !== "") held++;
	for (let i = 0; i < weapons.size(); i++) if (held !== 1 || weapons[i] !== "") out.push(i);
	return out;
}
