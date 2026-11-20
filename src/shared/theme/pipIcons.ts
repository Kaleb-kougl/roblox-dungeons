/**
 * Roblox port (docs/UI_ART.md "As built: armor pips"): the armor pip art, optional free-form ui images (the UI slot's
 * `ui.` prefix, like the boon / relic / curse / boost icons) for the status panel's armor row and the touch strip:
 * a full armor pip, a spent one and the Aegis pip. A pack that has both armor ids draws them instead of the UI sheet's
 * grey chip (shared/view/hud pipArt); one with the Aegis id draws it untinted instead of the tinted white chip. Without
 * them nothing changes. The vale pack packs them into a sheet of their own (packs/vale pipIconLayout.ts,
 * scripts/art/gen-pip-icons.js), each an `image` of the sheet with its `rect`.
 * In its own module: contract.ts sits near Luau's 200-locals-per-function limit.
 *
 * @module
 */

/** Every pip icon id starts with this. */
export const PIP_ICON_PREFIX = "ui.pip.";

/** The pip icon ids. */
export const PIP_ICON_IDS = {
	/** A full armor pip. */
	armor: "ui.pip.armor",
	/** A spent armor pip (drawn as is: not the full pip dimmed). */
	armorEmpty: "ui.pip.armor.empty",
	/** The Aegis pip (docs/BOOSTS.md B7), drawn in its own colours (never tinted). */
	aegis: "ui.pip.aegis",
} as const;
