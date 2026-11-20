/**
 * The playable characters (docs/ARCHER.md "Characters", ARD1 / ARD2; a Roblox-port feature, no web source). A character
 * is a loadout (one weapon set, set 1 empty) plus a traits record (the roll, the hearts); the sim never sees a character id: the
 * run configs (shared/run, AR4) turn characters into `SimConfig.loadout` / `traits` and `PartyConfig.loadouts` /
 * `traits`, and the view and the server read this table. Pure data and helpers, Roblox-API-free.
 *
 * CHARACTERS is APPEND ONLY (a future character takes the next entry and the next theme `CLASS_IDS` slot).
 *
 * @module
 */
import {
	BOW_WEAPON_ID,
	NEUTRAL_TRAITS,
	NEUTRAL_TRAIT_DELTA,
	NO_WEAPON,
	SWORD_WEAPON_ID,
	WEAPON_SETS,
	weaponAt,
	type PlayerTraits,
	type WeaponsState,
} from "shared/sim";

/**
 * The id of a playable character. It is what a player's pick is sent and stored as (the lobby's Ready pick, a
 * leaderboard member's `classId`) and the key the view and the server look a character up by; the sim never sees it,
 * only the loadout and traits it stands for.
 */
export type CharacterId = "knight" | "archer";

/** The Archer's roll dash: 140 % of the dash step (2.5 -> 3.38 tiles; owner answer 9). */
export const ARCHER_ROLL_DASH_PERCENT = 140;
/** The Archer's roll i-frames: 125 % (12 -> 15 ticks; owner answer 9). */
export const ARCHER_ROLL_IFRAME_PERCENT = 125;
/**
 * The Knight's health (docs/SILVER.md SV16, SVD18): one heart under START_HALF_HEARTS (half hearts 6 -> 4: 2 hearts);
 * the Armory's Vigor buys it back. A trait, not a sim constant, so a run without traits (M1, every golden fixture)
 * keeps START_HALF_HEARTS.
 */
export const KNIGHT_HEARTS_MAX_DELTA = -2;
/**
 * The Archer's health: half a heart under the Knight (half hearts 6 -> 3: 1 1/2 hearts; docs/SILVER.md SV16, SVD18;
 * it was -2, one heart under the Knight's 3, owner 2026-11-09).
 */
export const ARCHER_HEARTS_MAX_DELTA = -3;

/**
 * One playable character: a row of `CHARACTERS`. It holds what a run needs to become that character (the weapon loadout
 * and the traits the run config hands to the sim) and the theme class the view draws it with.
 */
export interface CharacterDef {
	readonly id: CharacterId;
	/** The theme's class visual (`class.<id>` of theme CLASS_IDS: the Knight vanguard, the Archer ranger, ARD1). */
	readonly visualId: string;
	/** Weapon id per set (SimConfig.loadout): one weapon, set 1 empty (ARD2). */
	readonly loadout: ReadonlyArray<string | undefined>;
	/** Roll and health traits (SimConfig.traits). */
	readonly traits: PlayerTraits;
}

/** Every character, in pick order (the character screen's card order). Append only. */
export const CHARACTERS: ReadonlyArray<CharacterDef> = [
	{
		id: "knight",
		visualId: "class.vanguard",
		loadout: [SWORD_WEAPON_ID],
		// docs/SILVER.md SV16: the neutral roll with one heart less.
		traits: table.freeze({ ...NEUTRAL_TRAITS, heartsMaxDelta: KNIGHT_HEARTS_MAX_DELTA }),
	},
	{
		id: "archer",
		visualId: "class.ranger",
		loadout: [BOW_WEAPON_ID],
		traits: table.freeze({
			rollDashPercent: ARCHER_ROLL_DASH_PERCENT,
			rollIframePercent: ARCHER_ROLL_IFRAME_PERCENT,
			heartsMaxDelta: ARCHER_HEARTS_MAX_DELTA,
			armorMaxDelta: NEUTRAL_TRAIT_DELTA,
			flaskChargesDelta: NEUTRAL_TRAIT_DELTA,
		}),
	},
];

/** The character of a run nobody picked one for (a missing pick, an old client): the Knight. */
export const DEFAULT_CHARACTER: CharacterId = "knight";

/**
 * docs/SILVER.md SV17: the characters every account owns (the Knight). Any other is a Silver unlock: run starts and
 * lobby Readies check the wallet's ownership (shared/run SilverAccess), and an unknown wallet owns only these.
 */
export const STARTER_CHARACTERS: ReadonlyArray<CharacterId> = [DEFAULT_CHARACTER];

/** True for a character every account owns (STARTER_CHARACTERS). */
export function isStarterCharacter(id: CharacterId): boolean {
	return STARTER_CHARACTERS.includes(id);
}

/** Every character id, in CHARACTERS order. */
export const CHARACTER_IDS: ReadonlyArray<CharacterId> = CHARACTERS.map((c) => c.id);

/** True for a known character id (an untrusted value: a remote's argument, a stored pick). */
export function isCharacterId(x: unknown): x is CharacterId {
	if (!typeIs(x, "string")) return false;
	for (const c of CHARACTERS) if (c.id === x) return true;
	return false;
}

/** The character's def. Throws for an unknown id. */
export function characterDef(id: CharacterId): CharacterDef {
	for (const c of CHARACTERS) if (c.id === id) return c;
	return error(`unknown character ${tostring(id)}`, 0);
}

/** The character's loadout (SimConfig.loadout / PartyConfig.loadouts[i]). */
export function characterLoadout(id: CharacterId): ReadonlyArray<string | undefined> {
	return characterDef(id).loadout;
}

/** The character's traits (SimConfig.traits / PartyConfig.traits[i]). */
export function characterTraits(id: CharacterId): PlayerTraits {
	return characterDef(id).traits;
}

/** A loadout entry's weapon id, "" for an empty set (undefined, "" or past the end). */
function setId(loadout: ReadonlyArray<string | undefined>, i: number): string {
	return loadout[i] ?? "";
}

/**
 * The character whose loadout `loadout` is, set for set over WEAPON_SETS (an empty set is undefined or ""; missing sets
 * are empty; entries past WEAPON_SETS are ignored, as createWeaponsState cuts them), or undefined for any other loadout
 * (M1's two weapons, test loadouts).
 */
export function characterOfLoadout(loadout: ReadonlyArray<string | undefined>): CharacterId | undefined {
	for (const c of CHARACTERS) {
		let same = true;
		for (let i = 0; i < WEAPON_SETS; i++) {
			if (setId(c.loadout, i) !== setId(loadout, i)) {
				same = false;
				break;
			}
		}
		if (same) return c.id;
	}
	return undefined;
}

/** The character a player's weapon sets belong to (characterOfLoadout of their weapon ids), or undefined. */
export function characterOfWeapons(weapons: Readonly<WeaponsState>): CharacterId | undefined {
	const ids: string[] = [];
	for (const s of weapons.sets) ids.push(s.weapon !== NO_WEAPON ? weaponAt(s.weapon).id : "");
	return characterOfLoadout(ids);
}
