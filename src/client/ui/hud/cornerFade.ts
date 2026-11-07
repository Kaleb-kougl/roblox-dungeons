import { createBinding, type Binding } from "@rbxts/react";
import { HUD_CORNERS, type HudCorner } from "shared/view/hud";

/**
 * The corner panels' registry (docs/HUD_LAYOUT.md H7): each corner `Panel` registers its root frame here (by ref) and
 * binds its CanvasGroup's GroupTransparency to its corner's binding; HudOcclusionController reads the frames'
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

const slots = new Map<HudCorner, CornerSlot>();
for (const corner of HUD_CORNERS) {
	const [fade, setFade] = createBinding(0);
	slots.set(corner, { fade, setFade, ref: (frame) => registerCornerFrame(corner, frame), frame: undefined, last: 0 });
}

function slot(corner: HudCorner): CornerSlot {
	return slots.get(corner)!;
}

/** The GroupTransparency binding of `corner`'s panel. */
export function cornerFadeBinding(corner: HudCorner): Binding<number> {
	return slot(corner).fade;
}

/** Sets `corner`'s panel transparency (no-op when unchanged). */
export function setCornerFade(corner: HudCorner, transparency: number): void {
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
export function registerCornerFrame(corner: HudCorner, frame: GuiObject | undefined): void {
	slot(corner).frame = frame;
}

/** The stable ref callback a corner Panel passes to its root frame. */
export function cornerRef(corner: HudCorner): (frame: GuiObject | undefined) => void {
	return slot(corner).ref;
}

/** The mounted panel's root frame in `corner` (undefined: none mounted, or not in the tree). */
export function cornerFrame(corner: HudCorner): GuiObject | undefined {
	const f = slot(corner).frame;
	return f !== undefined && f.Parent !== undefined ? f : undefined;
}
