import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectDisplay, selectInputDevice, selectMapView, selectSnapshot, type MapView } from "client/store";
import { MINIMAP_PANEL } from "shared/view/hud";
import { minimapHostRef } from "./minimapHosts";
import { Panel } from "./primitives";

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

/**
 * The corner minimap's shell (docs/MINIMAP.md M8): an always-on corner `Panel` (bottom right, MINIMAP_PANEL, no
 * padding; the occlusion fade's CanvasGroup) around one empty host frame that MinimapController fills imperatively
 * (minimapHosts "corner"). The corner Panel's CanvasGroup is the clip: it renders its children into its own texture, so
 * the turned map image is cut at the panel's edge (ClipsDescendants would not clip a rotated child). Hidden, never
 * unmounted, so the controller's instances survive a toggle.
 */
export function MinimapPanel() {
	const map = useSelector(selectMapView);
	const display = useSelector(selectDisplay);
	const s = useSelector(selectSnapshot);
	const touch = useSelector(selectInputDevice) === "touch";
	return (
		<Panel
			corner="bottomRight"
			width={MINIMAP_PANEL.w}
			padding={0}
			name="Minimap"
			visible={cornerMapShown(map, display.minimap, s.outcome, touch)}
		>
			<frame
				key="MapHost"
				ref={minimapHostRef("corner")}
				Size={new UDim2(0, MINIMAP_PANEL.w, 0, MINIMAP_PANEL.h)}
				BackgroundTransparency={HIDDEN}
				ClipsDescendants={true}
			/>
		</Panel>
	);
}
