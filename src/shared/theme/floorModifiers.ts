/**
 * Roblox port (docs/FLOOR_MODIFIERS.md FM7): the theme's floor modifier keys, for the floor card's banner (FM5), the
 * status chip and the pause line (FM6) and the cue mapper: the five kinds' strings, colour roles, stings and optional
 * icons. Data only, like fortune.ts: contract.ts and validate.ts sit near Luau's 200-locals-per-function limit, so
 * neither imports this module: contract.ts names the same IDs inline inside its existing lists (PORT_AUDIO_EVENTS,
 * REQUIRED_STRING_KEYS) and types.ts COLOR_ROLES the roles; floorModifiers.spec.ts checks they agree. The colour rules
 * and `floorModifierReport` are in floorModifierColors.ts, folded into variantColors.ts' problems (validate.ts takes no
 * new name).
 *
 * A kind is named by its string key (shared/dungeon MODIFIERS.kinds `key`, same order: gilded, hoard, feast, plunder,
 * bloodMoon; the theme imports nothing outside shared/theme, so the list is repeated here and the spec checks it).
 * Colour roles are `floorMod.<key>` (`floorMod.bloodMoon`); a string key's first segment must be lowercase
 * (validate.ts isStringKey), so the strings are `floormod.<key>.*` (`floormod.bloodMoon.name`); asset IDs are lowercase
 * dot-separated segments, so the sounds and icons lower-case the key too (`sfx.floor.modifier.bloodmoon`,
 * `ui.floormod.bloodmoon`).
 */

import type { ColorRole } from "./types";

/** Every floor modifier kind's key (shared/dungeon MODIFIERS.kinds order): four boons, then the twist. */
export const FLOOR_MODIFIER_KEYS: ReadonlyArray<string> = ["gilded", "hoard", "feast", "plunder", "bloodMoon"];

/** The twists among FLOOR_MODIFIER_KEYS (shared/dungeon FloorModifierClass.TWIST): their banner is blood red. */
export const FLOOR_MODIFIER_TWIST_KEYS: ReadonlyArray<string> = ["bloodMoon"];

/** The banner's big name (`floormod.<key>.name`: "Gilded"), also the chip's text. */
export function floorModifierNameKey(key: string): string {
	return `floormod.${key}.name`;
}

/** The banner's line under the name (`floormod.<key>.line`: "A Goldling is certain"), also the pause line's. */
export function floorModifierLineKey(key: string): string {
	return `floormod.${key}.line`;
}

/**
 * The pause overlay's one line under the floor info: `{name}` the kind's name string, `{line}` its line string, both
 * already looked up ("Gilded · A Goldling is certain").
 */
export const FLOOR_MODIFIER_PAUSE_KEY = "hud.pause.floorMod";

/**
 * Every floor modifier string a pack must define (in REQUIRED_STRING_KEYS, written out there, in this order): per kind
 * (FLOOR_MODIFIER_KEYS order) its name and its line, then the pause line's template.
 */
export const FLOOR_MODIFIER_STRING_KEYS: ReadonlyArray<string> = [
	"floormod.gilded.name",
	"floormod.gilded.line",
	"floormod.hoard.name",
	"floormod.hoard.line",
	"floormod.feast.name",
	"floormod.feast.line",
	"floormod.plunder.name",
	"floormod.plunder.line",
	"floormod.bloodMoon.name",
	"floormod.bloodMoon.line",
	"hud.pause.floorMod",
];

/**
 * One colour per kind (FLOOR_MODIFIER_KEYS order, COLOR_ROLES' last five): the banner's name, the chip's text and rim,
 * the pause line's name. Held to FLOOR_MODIFIER_COLOR_RULES by floorModifierReport (floorModifierColors.ts).
 */
export const FLOOR_MODIFIER_ROLES: ReadonlyArray<ColorRole> = [
	"floorMod.gilded",
	"floorMod.hoard",
	"floorMod.feast",
	"floorMod.plunder",
	"floorMod.bloodMoon",
];

/** The boons' roles (FLOOR_MODIFIER_ROLES but the twists'): the twist red must read apart from every one. */
export const FLOOR_MODIFIER_BOON_ROLES: ReadonlyArray<ColorRole> = [
	"floorMod.gilded",
	"floorMod.hoard",
	"floorMod.feast",
	"floorMod.plunder",
];

/** The twists' roles (FLOOR_MODIFIER_TWIST_KEYS order). */
export const FLOOR_MODIFIER_TWIST_ROLES: ReadonlyArray<ColorRole> = ["floorMod.bloodMoon"];

/** The colour role of kind `key` (`floorMod.<key>`), undefined for a key that is not a kind. */
export function floorModifierRole(key: string): ColorRole | undefined {
	const i = FLOOR_MODIFIER_KEYS.indexOf(key);
	return i >= 0 ? FLOOR_MODIFIER_ROLES[i] : undefined;
}

/** Every floor modifier sting starts with this. */
export const FLOOR_MODIFIER_AUDIO_PREFIX = "sfx.floor.modifier.";

/** The sting of kind `key`, played on the banner's stamp (`sfx.floor.modifier.<key>`, lowercase: `.bloodmoon`). */
export function floorModifierAudioId(key: string): string {
	return `${FLOOR_MODIFIER_AUDIO_PREFIX}${key.lower()}`;
}

/**
 * The five stings (port audio IDs in PORT_AUDIO_EVENTS, required, SILENT in every bundled pack until FM10 picks them):
 * a boon's bright, the twist's ominous. While one is silent it falls back to an existing clip (shared/view/audio
 * SFX_FALLBACK: a boon sfx.jingle.treasure, the twist sfx.horde.horn).
 */
export const FLOOR_MODIFIER_AUDIO_IDS: ReadonlyArray<string> = [
	"sfx.floor.modifier.gilded",
	"sfx.floor.modifier.hoard",
	"sfx.floor.modifier.feast",
	"sfx.floor.modifier.plunder",
	"sfx.floor.modifier.bloodmoon",
];

/**
 * Every floor modifier icon id starts with this: optional free-form ui images (the UI slot's `ui.` prefix, like the
 * boost icons, boostIcons.ts), drawn left of the banner's name and on the chip. All or nothing: a pack draws every kind's
 * icon or none (FM11's sheet); without them the banner and chip are text only.
 */
export const FLOOR_MODIFIER_ICON_PREFIX = "ui.floormod.";

/** The icon id of kind `key` (`ui.floormod.<key>`, lowercase: "bloodMoon" -> "ui.floormod.bloodmoon"). */
export function floorModifierIconId(key: string): string {
	return `${FLOOR_MODIFIER_ICON_PREFIX}${key.lower()}`;
}
