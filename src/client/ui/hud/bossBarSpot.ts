import { createBinding, type Binding } from "@rbxts/react";
import type { BossBarSpot } from "shared/view/hud";

/**
 * The boss bar's spot (shared/view/hud bossBarPlace.ts): BossBar binds its root frame's Position / AnchorPoint to
 * `bossBarSpotBinding` and registers that frame here; BossBarPlacementController reads the frame's AbsolutePosition /
 * AbsoluteSize and writes the spot. A binding update moves the frame without re-rendering the React tree.
 */
const [spotBinding, setSpotBinding] = createBinding<BossBarSpot>("top");
let lastSpot: BossBarSpot = "top";
let rootFrame: GuiObject | undefined;

export function bossBarSpotBinding(): Binding<BossBarSpot> {
	return spotBinding;
}

/** Writes the spot (no-op when unchanged). */
export function setBossBarSpot(spot: BossBarSpot): void {
	if (lastSpot === spot) return;
	lastSpot = spot;
	setSpotBinding(spot);
}

export function bossBarSpot(): BossBarSpot {
	return lastSpot;
}

/** BossBar's stable ref callback for its root frame. */
export function bossBarRef(frame: GuiObject | undefined): void {
	rootFrame = frame;
}

/** The mounted boss bar's root frame (undefined: no boss bar, or the slim touch bar). */
export function bossBarFrame(): GuiObject | undefined {
	return rootFrame !== undefined && rootFrame.Parent !== undefined ? rootFrame : undefined;
}
