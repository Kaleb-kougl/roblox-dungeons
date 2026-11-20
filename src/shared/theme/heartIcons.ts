/**
 * Roblox port (docs/SILVER.md SV16, owner call OC18): the half-heart containers, optional free-form ui images (the UI
 * slot's `ui.` prefix, like the armor pips) for the status panel's hearts row and the touch strip. An ODD heart maximum
 * (the Archer's 1 1/2 hearts, Vigor I's 2 1/2) ends in half a container: holding its half (`halfmax`) or spent
 * (`halfmaxEmpty`), never the half-filled heart (`ui.heart.half`, which means hurt). A pack that has both draws them
 * (shared/view/hud heartArt); without them the HUD cuts its whole heart art in half, and without any heart art draws the
 * flat half container. The vale pack packs them into a sheet of their own (packs/vale heartIconLayout.ts,
 * scripts/art/gen-heart-halfmax.js), each an `image` of the sheet with its `rect`, both switched on by the sheet's one
 * ID. In its own module: contract.ts sits near Luau's 200-locals-per-function limit.
 *
 * @module
 */

/** Every half-heart container id starts with this. */
export const HEART_ICON_PREFIX = "ui.heart.halfmax";

/** The half-heart container ids. */
export const HEART_ICON_IDS = {
	/** The last heart of an odd maximum, holding its half heart. */
	halfmax: "ui.heart.halfmax",
	/** The same half container, spent (drawn as is, like the empty heart). */
	halfmaxEmpty: "ui.heart.halfmax.empty",
} as const;
