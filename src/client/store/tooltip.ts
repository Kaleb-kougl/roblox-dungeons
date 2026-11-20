import { createProducer } from "@rbxts/reflex";
import type { HoverShown } from "shared/view/hud";

/**
 * Client-local Reflex slice for the item tooltips (docs/ITEM_TOOLTIPS.md IT4): what the HoverTracker shows (target,
 * pinned, when it began), or undefined. TooltipController dispatches only when the tracker hands back a different
 * object (a new target, rect, panel or pin), never on a quiet frame; ItemTooltip (client/ui/hud) reads it and builds the
 * text model from the snapshot. The objects are the tracker's own and never mutated.
 */
export interface TooltipState {
	readonly shown: HoverShown | undefined;
}

const initialState: TooltipState = { shown: undefined };

/**
 * The item tooltip's slice (state: `TooltipState`). TooltipController stores what the HoverTracker shows, and only when
 * the tracker hands back a different object; undefined hides the tooltip.
 */
export const tooltipSlice = createProducer(initialState, {
	setTooltip: (state, shown: HoverShown | undefined) => (state.shown === shown ? state : { shown }),
});

/**
 * What the item tooltip shows: the hovered target, whether it is pinned and when it began, as the HoverTracker's own
 * object (compared by identity). Undefined: no tooltip.
 */
export const selectTooltipShown = (state: { tooltip: TooltipState }) => state.tooltip.shown;
