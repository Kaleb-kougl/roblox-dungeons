/**
 * Character icons beside a player's name (docs/ARCHER.md AR9, owner answer 4: "each entry shows its character";
 * presentation only): the leaderboard's rows, the run-over contribution's You card and Party rows. The pack's optional
 * `ui.character.<id>` image (theme characterIconId) when it has one, else a flat square in the character's visual's
 * colour role (`class.vanguard` / `class.ranger`). An entry without a character (an older board entry, a run built
 * without one) or with a value that is no character id shows nothing. Pure.
 */
import { characterDef, isCharacterId, type CharacterId } from "shared/characters";
import { characterIconId, type ColorRole } from "shared/theme";

/** An icon to draw: the image id when the pack has it (else undefined: the square), and the fallback square's role. */
export interface CharacterIconModel {
	readonly character: CharacterId;
	readonly art: string | undefined;
	readonly role: ColorRole;
}

/** Sizes (reference px) and look of the icon. */
export const CHARACTER_ICON_VIEW = {
	/** The square's side as a share of its row's height (the text beside it keeps the rest). */
	rowShare: 0.6,
	/** Between the icon and the name, reference px. */
	gap: 4,
	/** The fallback square's outline (uiTextDim), reference px. */
	stroke: 1,
} as const;

/** The icon's side (reference px, whole) in a row `rowHeight` tall. */
export function characterIconSize(rowHeight: number): number {
	return math.max(1, math.floor(rowHeight * CHARACTER_ICON_VIEW.rowShare));
}

/**
 * The icon of `character` (an untrusted value: a board entry's `classId`, a recap row's), or undefined when it is not a
 * character id. `has`: whether the pack has an image id (ThemePack.image(id) !== undefined).
 */
export function characterIcon(character: unknown, has: (id: string) => boolean): CharacterIconModel | undefined {
	if (!isCharacterId(character)) return undefined;
	const id = characterIconId(character);
	return { character, art: has(id) ? id : undefined, role: characterDef(character).visualId as ColorRole };
}

/** Something with an optional character id (a leaderboard row's `classId`), read by characterOfEntry. */
export interface CharacterTagged {
	readonly userId: number;
	readonly classId?: unknown;
}

/** An entry's character id when its `classId` is one, else undefined. */
export function characterOfEntry(entry: CharacterTagged): CharacterId | undefined {
	return isCharacterId(entry.classId) ? entry.classId : undefined;
}
