/**
 * Roblox port (docs/BUILDS.md BU11, the relic and curse part): the relic and curse icons, optional free-form ui images
 * (the UI slot's `ui.` prefix, like the boon icons, boonIcons.ts), one per relic and per curse: `ui.relic.<name>` for
 * relic id `relic.<Name>` and `ui.curse.<name>` for curse id `curse.<Name>`, lower-cased (asset ids are lowercase
 * dot-separated segments: "relic.mirrorCloak" -> "ui.relic.mirrorcloak"). A pack may draw any of them; an item without
 * one keeps its short text label (`<id>.icon`) everywhere it is shown. The vale pack packs them into a sheet of their
 * own (packs/vale itemIconLayout.ts, scripts/art/gen-item-icons.js), each an `image` of the sheet with its `rect`.
 * In its own module: contract.ts sits near Luau's 200-locals-per-function limit.
 */

/** Every relic icon id starts with this. */
export const RELIC_ICON_PREFIX = "ui.relic.";
/** Every curse icon id starts with this. */
export const CURSE_ICON_PREFIX = "ui.curse.";

/** Relic ids start with this (shared/sim RELICS: "relic.hourglass"). */
const RELIC_ID_PREFIX = "relic.";
/** Curse ids start with this (shared/sim CURSES: "curse.frailty"). */
const CURSE_ID_PREFIX = "curse.";

/** `iconPrefix` + the rest of `id` after `idPrefix`, lower-cased; undefined unless `id` is `idPrefix` + a name. */
function prefixedIconId(id: string, idPrefix: string, iconPrefix: string): string | undefined {
	if (id.sub(1, idPrefix.size()) !== idPrefix || id.size() <= idPrefix.size()) return undefined;
	return `${iconPrefix}${id.sub(idPrefix.size() + 1).lower()}`;
}

/**
 * The icon id of relic id `relicId` ("relic.hourglass" -> "ui.relic.hourglass", "relic.mirrorCloak" ->
 * "ui.relic.mirrorcloak"); undefined for anything not a relic id.
 */
export function relicIconId(relicId: string): string | undefined {
	return prefixedIconId(relicId, RELIC_ID_PREFIX, RELIC_ICON_PREFIX);
}

/**
 * The icon id of curse id `curseId` ("curse.frailty" -> "ui.curse.frailty", "curse.impatience" ->
 * "ui.curse.impatience"); undefined for anything not a curse id.
 */
export function curseIconId(curseId: string): string | undefined {
	return prefixedIconId(curseId, CURSE_ID_PREFIX, CURSE_ICON_PREFIX);
}
