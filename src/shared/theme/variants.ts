/**
 * Roblox port (docs/ENEMY_VARIANTS.md EV1): the theme's enemy-variant keys: the elite affixes' colour roles and
 * strings and the first-sighting (bestiary) toast lines. Pure data with no runtime import, so contract.ts can take its
 * one combined key list (ENEMY_VARIANT_STRING_KEYS) without adding more than one top-level local to its compiled Luau,
 * which sits near Luau's 200-locals-per-function limit (docs/ENEMY_VARIANTS.md plan change 10). The colour rules and
 * their reports (`affixReport`, `gooReport`) are in variantColors.ts.
 *
 * The rest of the enemy-variant contract lives where its kind already does: `imp` / `slime` in ENEMY_ARCHETYPES
 * (`enemy.imp` / `enemy.slime` assets, colour roles and `.name` strings), `bullet.enemy.goo` in BULLET_IDS, the five
 * sounds in PORT_AUDIO_EVENTS, every colour role in types.ts COLOR_ROLES.
 */

import type { ColorRole } from "./types";

/** The elite affixes (docs/ENEMY_VARIANTS.md EVD6), in unlock order. Each has a colour role and a name string. */
export const AFFIX_IDS = ["hulking", "swift", "shielded", "vengeful"] as const;
export type AffixId = (typeof AFFIX_IDS)[number];

/**
 * One colour per affix (AFFIX_IDS order): the floor ring under an affixed enemy, the sprite rim's tint and the name
 * chip (EVD12). Required in every pack like every role; held to AFFIX_COLOR_RULES by `affixReport`.
 */
export const AFFIX_ROLES: ReadonlyArray<ColorRole> = [
	"affix.hulking",
	"affix.swift",
	"affix.shielded",
	"affix.vengeful",
];

/** A Shielded enemy's shield segment on its health bar (and its shield-hit flash), held to AFFIX_COLOR_RULES too. */
export const ENEMY_SHIELD_ROLE: ColorRole = "enemyShield";

/** The goo puddles' colour (EVD5, the `bullet.enemy.goo` decal's tint), held to GOO_COLOR_RULES by `gooReport`. */
export const ENEMY_GOO_ROLE: ColorRole = "enemyGoo";

/** The goo puddle's bullet visual (EVD5): a flat floor decal, drawn from the renderer's second enemy-bullet pool. */
export const GOO_BULLET_ID = "bullet.enemy.goo";

/** The affix names on the health bar's chip (`affix.<id>.name`, AFFIX_IDS order): "Hulking", "Swift", ... */
export const AFFIX_STRING_KEYS: ReadonlyArray<string> = [
	"affix.hulking.name",
	"affix.swift.name",
	"affix.shielded.name",
	"affix.vengeful.name",
];

/** The new archetypes a first sighting announces (EVD10): the Imp, the Ooze and the Summoner. */
export const BESTIARY_ARCHETYPES = ["imp", "slime", "summoner"] as const;

/**
 * The first-sighting toast lines (EVD10, EV12): one short tell per new archetype (`bestiary.<archetype>`,
 * BESTIARY_ARCHETYPES order), then one per affix (`bestiary.affix.<id>`, AFFIX_IDS order).
 */
export const BESTIARY_STRING_KEYS: ReadonlyArray<string> = [
	"bestiary.imp",
	"bestiary.slime",
	"bestiary.summoner",
	"bestiary.affix.hulking",
	"bestiary.affix.swift",
	"bestiary.affix.shielded",
	"bestiary.affix.vengeful",
];

/** Every enemy-variant string key a pack must define (AFFIX_STRING_KEYS then BESTIARY_STRING_KEYS), for contract.ts. */
export const ENEMY_VARIANT_STRING_KEYS: ReadonlyArray<string> = [...AFFIX_STRING_KEYS, ...BESTIARY_STRING_KEYS];

/** The affix name key (`affix.<id>.name`). */
export function affixNameKey(id: AffixId): string {
	return `affix.${id}.name`;
}

/** The affix colour role (`affix.<id>`). */
export function affixRole(id: AffixId): ColorRole {
	return `affix.${id}`;
}

/** The first-sighting line of a new archetype (`bestiary.<archetype>`). */
export function bestiaryArchetypeKey(archetype: (typeof BESTIARY_ARCHETYPES)[number]): string {
	return `bestiary.${archetype}`;
}

/** The first-sighting line of an affix (`bestiary.affix.<id>`). */
export function bestiaryAffixKey(id: AffixId): string {
	return `bestiary.affix.${id}`;
}
