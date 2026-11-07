import { createBinding, type Binding } from "@rbxts/react";
import { HUD_FADE_SLOTS, type HudFadeSlot } from "shared/view/hud";

/**
 * The fading panels' registry (docs/HUD_LAYOUT.md H7), one slot per HUD_FADE_SLOTS entry: each corner `Panel` (and
 * every Panel given a `fade` slot: the toasts, the first-sighting card) registers its root frame here (by ref) and
 * binds its CanvasGroup's GroupTransparency to its slot's binding; HudOcclusionController reads the frames'
 * AbsolutePosition / AbsoluteSize and writes the bindings. A binding update changes the one property it is bound to and
 * never re-renders the React tree, so the per-frame fade costs no reconciliation.
 */

interface CornerSlot {
	readonly fade: Binding<number>;
	readonly setFade: (t: number) => void;
	/** A stable ref callback (a new function per render would detach and re-attach the ref every render). */
	readonly ref: (frame: GuiObject | undefined) => void;
	frame: GuiObject | undefined;
	/** The last value written (writes only on change). */
	last: number;
}

const slots = new Map<HudFadeSlot, CornerSlot>();
for (const corner of HUD_FADE_SLOTS) {
	const [fade, setFade] = createBinding(0);
	slots.set(corner, { fade, setFade, ref: (frame) => registerCornerFrame(corner, frame), frame: undefined, last: 0 });
}

function slot(corner: HudFadeSlot): CornerSlot {
	return slots.get(corner)!;
}

/** The GroupTransparency binding of `corner`'s panel. */
export function cornerFadeBinding(corner: HudFadeSlot): Binding<number> {
	return slot(corner).fade;
}

/** Sets `corner`'s panel transparency (no-op when unchanged). */
export function setCornerFade(corner: HudFadeSlot, transparency: number): void {
	const s = slot(corner);
	if (s.last === transparency) return;
	s.last = transparency;
	s.setFade(transparency);
}

/**
 * `corner`'s panel transparency as last written (0: opaque). The item tooltips' TooltipController reads it as
 * `panelFaded` (docs/ITEM_TOOLTIPS.md IT6: no live tooltip over a panel the action is under).
 */
export function cornerFadeValue(corner: HudCorner): number {
	return slot(corner).last;
}

/** A corner Panel's ref callback: its root frame while mounted, undefined after. */
export function registerCornerFrame(corner: HudFadeSlot, frame: GuiObject | undefined): void {
	slot(corner).frame = frame;
}

/** The stable ref callback a corner Panel passes to its root frame. */
export function cornerRef(corner: HudFadeSlot): (frame: GuiObject | undefined) => void {
	return slot(corner).ref;
}

/** The mounted panel's root frame in `corner` (undefined: none mounted, or not in the tree). */
export function cornerFrame(corner: HudFadeSlot): GuiObject | undefined {
	const f = slot(corner).frame;
	return f !== undefined && f.Parent !== undefined ? f : undefined;
}
