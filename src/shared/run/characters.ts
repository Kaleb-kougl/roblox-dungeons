/**
 * Characters in run configs (docs/ARCHER.md "Run configs", AR4): a run's characters (one per player, index order)
 * become the sim's per-player loadouts and roll traits. Solo: `SimConfig.loadout` / `traits`; co-op:
 * `PartyConfig.loadouts` / `traits` (player 0 included). Missing entries are DEFAULT_CHARACTER's (the Knight). The sim
 * never sees a character id (ARD2). Pure and Roblox-API-free: the client and the server build the same config.
 */
import {
	DEFAULT_CHARACTER,
	characterLoadout,
	characterTraits,
	isCharacterId,
	type CharacterId,
} from "shared/characters";
import { DEFAULT_LOADOUT, DEFAULT_PARTY_SIZE, type SimConfig } from "shared/sim";

/**
 * Every player's character for a party of `partySize`: `characters[i]`, else DEFAULT_CHARACTER (a short or absent
 * list). Throws (`config_error` at a session start) on an entry that is not a character id; entries past the party are
 * ignored.
 */
export function partyCharacters(
	characters: ReadonlyArray<CharacterId> | undefined,
	partySize: number = DEFAULT_PARTY_SIZE,
): CharacterId[] {
	const out: CharacterId[] = [];
	for (let i = 0; i < partySize; i++) {
		const c = characters?.[i];
		if (c !== undefined && !isCharacterId(c)) error(`unknown character ${tostring(c)} for player ${i}`, 0);
		out.push(c ?? DEFAULT_CHARACTER);
	}
	return out;
}

/** Options of withCharacters (the dev world's "Both weapons"). */
export interface CharacterConfigOptions {
	/** Every player carries DEFAULT_LOADOUT (sword and bow) with their character's traits (dev testing only). */
	readonly bothWeapons?: boolean;
}

/**
 * `config` with `characters` (one per player of the config's party: partyCharacters already applied) as loadouts and
 * traits: a solo config (no party, or size 1) gets `loadout` / `traits`, a co-op one `party.loadouts` / `traits`.
 * Pure: returns a new config, `config` is not changed.
 */
export function withCharacters(
	config: SimConfig,
	characters: ReadonlyArray<CharacterId>,
	options: CharacterConfigOptions = {},
): SimConfig {
	const loadoutOf = (c: CharacterId) => (options.bothWeapons === true ? DEFAULT_LOADOUT : characterLoadout(c));
	const party = config.party;
	if (party === undefined || party.size <= DEFAULT_PARTY_SIZE) {
		const c = characters[0] ?? DEFAULT_CHARACTER;
		return { ...config, loadout: loadoutOf(c), traits: characterTraits(c) };
	}
	return {
		...config,
		party: { ...party, loadouts: characters.map(loadoutOf), traits: characters.map((c) => characterTraits(c)) },
	};
}
