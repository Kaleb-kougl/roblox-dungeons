/**
 * The combo's HUD strings (docs/COMBO.md CB3): the four tier names, the tier slot's COMBO LOST after a break and its
 * BEST x3.4 after a lapse (`{combo}`, the streak's peak, formatted like `hud.score.combo`, HUD_STRINGS.combo).
 * All REQUIRED (theme contract COMBO_STRING_KEYS, same order), so the tier slot never shows a raw key. The tier below
 * x2 has no name.
 */
export const COMBO_STRINGS = {
	rampage: "hud.combo.rampage",
	carnage: "hud.combo.carnage",
	dominating: "hud.combo.dominating",
	unstoppable: "hud.combo.unstoppable",
	lost: "hud.combo.lost",
	best: "hud.combo.best",
} as const;
