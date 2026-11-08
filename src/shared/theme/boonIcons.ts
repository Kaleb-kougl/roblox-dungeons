/**
 * Roblox port (docs/BUILDS.md BU11, the boons part): the boon icons, optional free-form ui images (the UI slot's
 * `ui.` prefix, like uiIconIds), one per boon: `ui.boon.<name>` for boon id `boon.<Name>`, lower-cased (asset ids are
 * lowercase dot-separated segments: "boon.swiftStrikes" -> "ui.boon.swiftstrikes"). A pack may draw any of them;
 * a boon without one keeps its short text label (`<id>.icon`) everywhere it is shown. The vale pack packs them into a
 * sheet of their own (packs/vale boonIconLayout.ts, scripts/art/gen-boon-icons.js), each an `image` of the sheet with
 * its `rect`. Rarity is never in the art: the cell or card around the icon carries it.
 * In its own module: contract.ts sits near Luau's 200-locals-per-function limit.
 */

/** Every boon icon id starts with this. */
export const BOON_ICON_PREFIX = "ui.boon.";

/** Boon ids start with this (shared/sim BOONS: "boon.sharpened"). */
const BOON_ID_PREFIX = "boon.";

/**
 * The icon id of boon id `boonId` ("boon.sharpened" -> "ui.boon.sharpened", "boon.swiftStrikes" ->
 * "ui.boon.swiftstrikes"); undefined for anything not a boon id.
 */
export function boonIconId(boonId: string): string | undefined {
	if (boonId.sub(1, BOON_ID_PREFIX.size()) !== BOON_ID_PREFIX || boonId.size() <= BOON_ID_PREFIX.size()) {
		return undefined;
	}
	return `${BOON_ICON_PREFIX}${boonId.sub(BOON_ID_PREFIX.size() + 1).lower()}`;
}
