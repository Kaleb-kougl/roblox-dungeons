/**
 * Who each player is on screen (docs/ARCHER.md AR9; presentation only): a player's character and its theme visual. The
 * run's own pick (shared/run RunSetup.characters, echoed by the run config builders) wins; a run built without one (M1,
 * tools, an older replay) falls back to the character the player's weapon sets are (shared/characters
 * characterOfWeapons), and anything else (M1's two weapons, test loadouts) draws ACTOR_VIEW.playerVisualId, the
 * Knight's visual, as before. Pure (the client's ActorRenderController and SimController read it).
 */
import { characterDef, characterOfWeapons, isCharacterId, type CharacterId } from "shared/characters";
import { partySize, weaponsAt, type SimState } from "shared/sim";
import { ACTOR_VIEW } from "./config";

/**
 * Player `index`'s character: `characters[index]` (the run's picks in player index order, RunSetup.characters) when it
 * is a character id, else the character the player's weapon sets are (characterOfWeapons on `state`), else undefined
 * (no state, an index outside the party, or a loadout that is no character's: M1's sword + bow).
 */
export function playerCharacterOf(
	characters: ReadonlyArray<string> | undefined,
	state: Readonly<SimState> | undefined,
	index: number,
): CharacterId | undefined {
	const picked = characters?.[index];
	if (isCharacterId(picked)) return picked;
	if (state === undefined || index < 0 || index >= partySize(state)) return undefined;
	return characterOfWeapons(weaponsAt(state, index));
}

/** The theme visual a character draws as (its CharacterDef.visualId); no character: ACTOR_VIEW.playerVisualId. */
export function characterVisualId(character: CharacterId | undefined): string {
	return character !== undefined ? characterDef(character).visualId : ACTOR_VIEW.playerVisualId;
}

/** Player `index`'s visual id (characterVisualId of playerCharacterOf). */
export function playerVisualIdOf(
	characters: ReadonlyArray<string> | undefined,
	state: Readonly<SimState> | undefined,
	index: number,
): string {
	return characterVisualId(playerCharacterOf(characters, state, index));
}

/**
 * The visuals a run's stage manifest loads for its players (docs/STAGE_ASSETS.md "characters", docs/ARCHER.md): each
 * picked character's visual once, in player order; no roster (M1, an older run): [ACTOR_VIEW.playerVisualId], the
 * Knight's, exactly shared/view STAGE_CHARACTERS.
 */
export function stageCharacters(characters: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
	const out: string[] = [];
	if (characters !== undefined) {
		for (const c of characters) {
			const id = isCharacterId(c) ? characterDef(c).visualId : ACTOR_VIEW.playerVisualId;
			if (!out.includes(id)) out.push(id);
		}
	}
	if (out.size() === 0) out.push(ACTOR_VIEW.playerVisualId);
	return out;
}
