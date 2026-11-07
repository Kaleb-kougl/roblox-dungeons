/** Item tooltips' tunables (claude/item-tooltips-plan.md; presentation only). Reference px unless said. */
export const ITEM_TOOLTIP = {
	/** Pause / run-over lists: hover this long before the tooltip shows. */
	menuDwellSec: 0.12,
	/** Live HUD: hover this long with the pointer still. */
	hudDwellSec: 0.45,
	/** Live HUD: "still" = moved less than this (px) since the dwell began. */
	hudStillPx: 4,
	/** Live HUD: no tooltip for this long after an Attack / Alt press. */
	hudAfterPressSec: 0.5,
	/** Fade-in (none under Reduced motion); hiding is instant. */
	fadeSec: 0.08,
	/** The tooltip's widest, its padding, its gap to the anchor / panel. */
	maxWidth: 260,
	pad: 8,
	offset: 8,
	/** Its panel's transparency (flat look). */
	panelTransparency: 0.08,
	/** Its ScreenGui: over the pause / menu layer (20), under the loading / stage cover (30). */
	displayOrder: 25,
} as const;
