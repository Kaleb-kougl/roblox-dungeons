import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectDisplay, selectInputDevice, selectMapView, selectSnapshot, type MapView } from "client/store";
import { themePack } from "client/ui/theme";
import {
	HUD_SKIN,
	MINIMAP_PANEL,
	insetSize,
	skinFor,
	skinHasOf,
	skinRefPerArt,
	sliceBorder,
	snappedSliceScale,
	type ArtSlot,
} from "shared/view/hud";
import { minimapHostRef } from "./minimapHosts";
import { Panel } from "./primitives";
import { useHudScale } from "./useHudScale";

const HIDDEN = 1;

/**
 * The corner map's show rule (docs/MINIMAP.md §8): this floor has a map (a dungeon floor, never the greybox, and the
 * map image was created), Options > Display > Minimap is On, the full map is closed and the run is still being played
 * (the run-over panel hides it). MinimapController reads the same rule to skip a hidden corner's work. On touch
 * (`touch`, docs/MOBILE.md MBD8) the corner map never shows: the full map opens from the pause overlay instead.
 */
export function cornerMapShown(map: MapView, minimapSetting: boolean, outcome: string, touch = false): boolean {
	return !touch && map.available && minimapSetting && !map.open && outcome === "playing";
}

/** The map host's size, reference px: the whole panel, less the hud frame's border when the art draws it. */
function hostSize(uiScale: number): ArtSlot {
	const pack = themePack();
	const id = pack !== undefined && HUD_SKIN.minimapFramed ? skinFor(skinHasOf(pack), "panel", "hud") : undefined;
	const slice = id !== undefined ? pack?.image(id)?.slice : undefined;
	if (slice === undefined) return { w: MINIMAP_PANEL.w, h: MINIMAP_PANEL.h };
	const border = sliceBorder(slice, snappedSliceScale(uiScale, skinRefPerArt("hud")));
	return insetSize(MINIMAP_PANEL.w, MINIMAP_PANEL.h, border);
}

/**
 * The corner minimap's shell (docs/MINIMAP.md M8): an always-on corner `Panel` (bottom right, MINIMAP_PANEL, no
 * padding; the occlusion fade's CanvasGroup) around one empty host frame that MinimapController fills imperatively
 * (minimapHosts "corner"). The corner Panel's CanvasGroup is the clip: it renders its children into its own texture, so
 * the turned map image is cut at the panel's edge (ClipsDescendants would not clip a rotated child). Hidden, never
 * unmounted, so the controller's instances survive a toggle.
 *
 * With the in-run frame art (docs/UI_ART.md UA11, HUD_SKIN.minimapFramed) the Panel draws its hud skin and the host
 * shrinks by the frame's border (the same snapped SliceScale the Panel pads by), so the framed panel keeps
 * MINIMAP_PANEL's footprint; MinimapController sizes the map from the host's AbsoluteSize. Without the art (or with
 * minimapFramed off: skin "none"), exactly the flat panel.
 */
export function MinimapPanel() {
	const map = useSelector(selectMapView);
	const display = useSelector(selectDisplay);
	const s = useSelector(selectSnapshot);
	const touch = useSelector(selectInputDevice) === "touch";
	const uiScale = useHudScale();
	const host = hostSize(uiScale);
	return (
		<Panel
			corner="bottomRight"
			width={MINIMAP_PANEL.w}
			padding={0}
			name="Minimap"
			visible={cornerMapShown(map, display.minimap, s.outcome, touch)}
			skin={HUD_SKIN.minimapFramed ? "hud" : "none"}
		>
			<frame
				key="MapHost"
				ref={minimapHostRef("corner")}
				Size={new UDim2(0, host.w, 0, host.h)}
				BackgroundTransparency={HIDDEN}
				ClipsDescendants={true}
			/>
		</Panel>
	);
}
