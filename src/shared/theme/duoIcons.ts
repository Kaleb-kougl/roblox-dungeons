/**
 * Roblox port (docs/BUILDS.md BU11, the duo part): the duo icons, optional free-form ui images (the UI slot's `ui.`
 * prefix, like boonIconId), one per duo: `ui.duo.<name>` for duo id `duo.<Name>`, lower-cased (asset ids are lowercase
 * dot-separated segments: "duo.fireArrows" -> "ui.duo.firearrows"). A pack may draw any of them; a duo without one
 * shows its two boons' icons (or their text labels) side by side, as before. The vale pack packs them into a sheet of
 * their own (packs/vale duoIconLayout.ts, scripts/art/gen-duo-icons.js), each an `image` of the sheet with its `rect`.
 * In its own module: contract.ts sits near Luau's 200-locals-per-function limit.
 */

/** Every duo icon id starts with this. */
export const DUO_ICON_PREFIX = "ui.duo.";

/** Duo ids start with this (shared/sim DUOS: "duo.fireArrows"). */
const DUO_ID_PREFIX = "duo.";

/**
 * The icon id of duo id `duoId` ("duo.fireArrows" -> "ui.duo.firearrows"); undefined for anything not a duo id.
 */
export function duoIconId(duoId: string): string | undefined {
	if (duoId.sub(1, DUO_ID_PREFIX.size()) !== DUO_ID_PREFIX || duoId.size() <= DUO_ID_PREFIX.size()) {
		return undefined;
	}
	return `${DUO_ICON_PREFIX}${duoId.sub(DUO_ID_PREFIX.size() + 1).lower()}`;
}
