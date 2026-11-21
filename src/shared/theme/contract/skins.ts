/**
 * The theme contract's optional UI art IDs (docs/CODEBASE_SCALE.md DX8: a pure move out of contract.ts): the draft skin, the UI skin and the icon atlas.
 *
 * @module
 */

/**
 * Roblox port (docs/DRAFT_REVEAL.md DR3, DRD12): the boon draft's card art, optional free-form ui images (any pack may
 * leave any of them out; the overlay then draws today's flat card, and a missing skull leaves the legendary's corners
 * plain). Cut from the ToffeeCraft Horror UI sheet and 9-sliced (ImageAsset `slice`):
 *   - `ui.draft.back`: every card's back (the skull-and-chain panel);
 *   - `ui.draft.back.eyes`: a white mask of the back's skull eye sockets, the same size, registration and `slice` as
 *     the back, tinted red over it during a legendary's charge;
 *   - `ui.draft.card.common` / `ui.draft.card.rare`: the faces (plain panel; studded red-trimmed panel with a tab, which
 *     the legendary face reuses);
 *   - `ui.draft.skull.left` / `ui.draft.skull.right`: the red-eyed skulls on the legendary face's top corners, not
 *     sliced; their `pivot` sits on the face panel's outer frame corner.
 * A function, not a constant: this module's compiled Luau sits near the 200-locals-per-function limit.
 */
export function draftSkinIds(): ReadonlyArray<string> {
	return [
		"ui.draft.back",
		"ui.draft.back.eyes",
		"ui.draft.card.common",
		"ui.draft.card.rare",
		"ui.draft.skull.left",
		"ui.draft.skull.right",
	];
}

/**
 * Roblox port (docs/UI_ART.md UA4, Architecture 2): the UI skin's 9-sliced pieces, optional free-form ui images (a pack
 * may leave out any of them; the primitive then draws today's flat look, shared/view/hud skin.ts `skinFor`). Each is its
 * own image with a `slice`, cut from the ToffeeCraft Horror UI sheet:
 *   - `ui.panel.menu` / `.hud` / `.tall`: panel frames (menus: red-rimmed and tabbed; in a run: dark rounded; lists);
 *   - `ui.button` / `.focus` / `.disabled`: the menu button (normal; focused or active: red fill; disabled);
 *   - `ui.option.on` / `.off`: an Options value (the chosen one; the others);
 *   - `ui.bar.track` / `.fill`: a pill bar (the fill is white, tinted by a role);
 *   - `ui.slot.pair` / `ui.slot`: the weapon panel's two-slot frame and one slot.
 * A function, not a constant: this module's compiled Luau sits near the 200-locals-per-function limit.
 */
export function uiSkinIds(): ReadonlyArray<string> {
	return [
		"ui.panel.menu",
		"ui.panel.hud",
		"ui.panel.tall",
		"ui.button",
		"ui.button.focus",
		"ui.button.disabled",
		"ui.option.on",
		"ui.option.off",
		"ui.bar.track",
		"ui.bar.fill",
		"ui.slot.pair",
		"ui.slot",
	];
}

/**
 * Roblox port (docs/UI_ART.md UA4, UAD10): the UI skin's small fixed-size pieces, optional free-form ui images packed
 * into ONE icon atlas: each is an `image` of the whole atlas with a `rect` (the piece) and maybe a `pivot` (pixels from
 * the rect's top-left). A pack that has the atlas has all of them (all or nothing). The focus bracket, chips (`.white`:
 * tinted by a role), hearts, flasks, the candle, a caret, a divider, the touch ring and button, and the glyphs.
 * A function, not a constant: this module's compiled Luau sits near the 200-locals-per-function limit.
 */
export function uiIconIds(): ReadonlyArray<string> {
	return [
		"ui.ornament.bones",
		"ui.focus.corner",
		"ui.chip",
		"ui.chip.white",
		"ui.heart.full",
		"ui.heart.half",
		"ui.heart.empty",
		"ui.flask.full",
		"ui.flask.empty",
		"ui.candle",
		"ui.caret",
		"ui.divider",
		"ui.stick.ring",
		"ui.touch.button",
		"ui.icon.pause",
		"ui.icon.check",
		"ui.icon.cross",
		"ui.icon.help",
		"ui.icon.gear",
		"ui.icon.home",
		"ui.icon.speaker",
		"ui.icon.mute",
		"ui.icon.coin",
		"ui.icon.skull",
		"ui.icon.skull.curse",
		"ui.icon.ghost",
		"ui.icon.rip",
	];
}
