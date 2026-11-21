/**
 * Eligibility (docs/ARCHER.md "Eligibility", AR1; a Roblox-port feature, no web source): what a player may be dealt,
 * derived from the weapons they carry. A boon or relic with `requires` (a weapon id: BoonDef / RelicDef in
 * ./progressionData.ts) is eligible only for a player whose weapon sets hold that weapon; a duo is eligible when both
 * its boons are. The pools apply it where they are built (builds/cards.ts drawCardOffers / legendaryPool /
 * drawLegendaryOffers, ./progression.ts drawBoonOffers / unownedRelics, pacts' classic Greed pool), never after a draw.
 *
 * No state of its own and nothing hashed: a pure function of the hashed weapon sets. A player carrying both weapons (M1,
 * DEFAULT_LOADOUT, every spec without a loadout) gets everything: the same pools, the same rng draws.
 *
 * @module
 */
import type { SimState } from "../state";
import { weaponsAt } from "../party";
import { NO_WEAPON, type WeaponsState } from "../combat/weapons/types";
import { weaponAt } from "../combat/weapons/registry";
import { DUOS } from "../builds/buildsData";
import { BOONS, BOON_COUNT, RELICS } from "./progressionData";

/** True when any of `weapons`' sets holds the weapon `id`. */
export function carriesWeapon(weapons: Readonly<WeaponsState>, id: string): boolean {
	for (const s of weapons.sets) if (s.weapon !== NO_WEAPON && weaponAt(s.weapon).id === id) return true;
	return false;
}

/** True when player `playerIndex` may be dealt boon `boon` (no `requires`, or they carry it). False for no boon. */
export function boonEligible(state: Readonly<SimState>, playerIndex: number, boon: number): boolean {
	const def = BOONS[boon];
	if (def === undefined) return false;
	return def.requires === undefined || carriesWeapon(weaponsAt(state, playerIndex), def.requires);
}

/** True when player `playerIndex` may be offered relic `relic` (RelicDef.requires). False for no relic. */
export function relicEligible(state: Readonly<SimState>, playerIndex: number, relic: number): boolean {
	const def = RELICS[relic];
	if (def === undefined) return false;
	return def.requires === undefined || carriesWeapon(weaponsAt(state, playerIndex), def.requires);
}

/**
 * Fills `out` (reused by the caller: entries 0 .. BOON_COUNT - 1 overwritten, nothing else touched) with player
 * `playerIndex`'s per-boon eligibility (boonEligible) and returns it.
 */
export function eligibleBoonMask(state: Readonly<SimState>, playerIndex: number, out: boolean[]): boolean[] {
	const weapons = weaponsAt(state, playerIndex);
	for (let b = 0; b < BOON_COUNT; b++) {
		const req = BOONS[b].requires;
		out[b] = req === undefined || carriesWeapon(weapons, req);
	}
	return out;
}

/** A pool's mask test: boon `boon` is in (no mask: every boon is). */
export function maskAllows(eligible: ReadonlyArray<boolean> | undefined, boon: number): boolean {
	return eligible === undefined || eligible[boon] === true;
}

/** Duo `duo` is eligible under `eligible`: both its boons are (no mask: every duo is; false for no duo). */
export function duoEligible(eligible: ReadonlyArray<boolean> | undefined, duo: number): boolean {
	const def = DUOS[duo];
	if (def === undefined) return false;
	return maskAllows(eligible, def.a) && maskAllows(eligible, def.b);
}
