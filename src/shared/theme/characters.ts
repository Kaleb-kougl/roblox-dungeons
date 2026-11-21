/**
 * Roblox port (docs/ARCHER.md AR10 / AR11): the theme side of the playable characters. Character ids ("knight",
 * "archer": shared/characters CHARACTER_IDS, written out here because the theme never imports gameplay modules;
 * characters.spec.ts checks they agree) name three kinds of theme entries:
 *
 * - The character screen's strings (CHARACTER_SCREEN_STRINGS, characterLineKey; required, in REQUIRED_STRING_KEYS):
 *   its title, the Start button, the run-over Character button and two summary lines per character. A character's name
 *   is its visual's `class.<id>.name` (the Knight `class.vanguard.name`, the Archer `class.ranger.name`).
 * - Per-character string overrides (characterOverrideKey: `<key>.<characterId>`, optional): a progression string whose
 *   English names the other character's weapon reads `boon.bastion.desc.archer` before `boon.bastion.desc` for the
 *   local player's character (shared/view/hud characterText.ts). CHARACTER_OVERRIDE_KEYS lists the placeholder's.
 * - Optional character icons `ui.character.<id>` (free-form ui images like the boon icons, boonIcons.ts): the board,
 *   recap and contribution rows draw one beside a name, else a square in the visual's colour role.
 *
 * In its own module: contract.ts sits near Luau's 200-locals-per-function limit.
 *
 * The contract lists named above:
 * {@link shared/theme/contract/strings!REQUIRED_STRING_KEYS | REQUIRED_STRING_KEYS}.
 *
 * @module
 */

/** Every character icon id starts with this. */
export const CHARACTER_ICON_PREFIX = "ui.character.";

/** The icon id of character `characterId` ("archer" -> "ui.character.archer"). */
export function characterIconId(characterId: string): string {
	return `${CHARACTER_ICON_PREFIX}${characterId}`;
}

/** The per-character override of string `key` (`boon.bastion.desc` + "archer" -> `boon.bastion.desc.archer`). */
export function characterOverrideKey(key: string, characterId: string): string {
	return `${key}.${characterId}`;
}

/** The character screen's fixed strings and the run-over panel's Character button (docs/ARCHER.md "The character screen"). */
export const CHARACTER_SCREEN_STRINGS = {
	/** The screen's title: "Choose your character". */
	title: "character.title",
	/** The confirm button: "Start". */
	start: "character.start",
	/** The run-over panel's button beside Again that opens the screen: "Character". */
	runOverCharacter: "run.over.character",
} as const;

/** Summary lines a character card shows under the name. */
export const CHARACTER_SUMMARY_LINES = 2;

/** Summary line `line` (1 .. CHARACTER_SUMMARY_LINES) of character `characterId`: `character.<id>.line.<n>`. */
export function characterLineKey(characterId: string, line: number): string {
	return `character.${characterId}.line.${line}`;
}

/** The character ids the theme's strings are written for (shared/characters CHARACTER_IDS; the spec keeps them equal). */
export const THEME_CHARACTER_IDS: ReadonlyArray<string> = ["knight", "archer"];

/**
 * Every required character string (CHARACTER_SCREEN_STRINGS, then each character's summary lines), as written out in
 * contract.ts REQUIRED_STRING_KEYS (characters.spec.ts checks they agree).
 */
export function characterStringKeys(): string[] {
	const out: string[] = [
		CHARACTER_SCREEN_STRINGS.title,
		CHARACTER_SCREEN_STRINGS.start,
		CHARACTER_SCREEN_STRINGS.runOverCharacter,
	];
	for (const id of THEME_CHARACTER_IDS)
		for (let n = 1; n <= CHARACTER_SUMMARY_LINES; n++) out.push(characterLineKey(id, n));
	return out;
}

/**
 * The per-character overrides the placeholder pack ships (docs/ARCHER.md "Text per character": the mixed items whose
 * English names the other weapon). Optional: no pack has to define any; a missing one reads the base key.
 */
export const CHARACTER_OVERRIDE_KEYS: ReadonlyArray<string> = [
	"boon.swiftStrikes.evo.desc.archer",
	"boon.bastion.desc.archer",
	"duo.stormBlade.desc.knight",
	"duo.stormBlade.desc.archer",
	"duo.fullHeart.desc.knight",
	"duo.fullHeart.desc.archer",
	"duo.citadel.desc.archer",
	// docs/SECRET_ROOMS.md SR10 (SRD5): the first-knock card names the charged arrow, not the finishing blow
	"bestiary.secret.crack.archer",
];
