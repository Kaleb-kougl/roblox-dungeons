import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectMapView, selectRunInfo, selectSnapshot } from "client/store";
import { role, str, themePack } from "client/ui/theme";
import { mapHint, keyDevice } from "shared/play";
import {
	HUD_SKIN,
	HUD_STRINGS,
	HUD_VIEW,
	TOUCH_STRINGS,
	skinFor,
	skinHasOf,
	contentInsetsOf,
	sliceBorder,
	snappedSliceScale,
} from "shared/view/hud";
import { PORTRAIT } from "shared/view";
import { MINIMAP_VIEW } from "shared/view/minimap";
import { useHudActions } from "./actions";
import { minimapHostRef, type MinimapHost } from "./minimapHosts";
import { Panel, SlicedImage, Text } from "./primitives";
import { useHudScale } from "./useHudScale";

const HALF = 0.5;
const HIDDEN = 1;
/** The frame art under the map layer (MinimapController's root sits at the default ZIndex 1). */
const FRAME_Z = 0;

/**
 * The full map's host (docs/MINIMAP.md M9): an empty frame with the map backdrop (uiPanel at
 * MINIMAP_VIEW.fullMap.transparency) that MinimapController fills (the shared EditableImage in a second ImageLabel,
 * fitted to this frame, turned like the corner map, markers on top). With the in-run frame art (docs/UI_ART.md UA11)
 * the backdrop is the hud panel skin instead (snapped, at the same transparency), grown outward by its border so the
 * frame rings the map and the map image (fitted to the host) never covers it; without the art, the flat backdrop.
 */
function MapHost(props: { host: MinimapHost; position: UDim2; anchor: Vector2; size: UDim2; square?: boolean }) {
	const uiScale = useHudScale();
	const pack = themePack();
	const skinId = pack !== undefined ? skinFor(skinHasOf(pack), "panel", "hud") : undefined;
	const slice = skinId !== undefined ? pack?.image(skinId)?.slice : undefined;
	const sliceScale = snappedSliceScale(uiScale, HUD_SKIN.fullMapRefPerArt);
	const border = sliceBorder(skinId !== undefined ? contentInsetsOf(skinId, slice) : slice, sliceScale);
	return (
		<frame
			key="MapHost"
			ref={minimapHostRef(props.host)}
			Position={props.position}
			AnchorPoint={props.anchor}
			Size={props.size}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={skinId !== undefined ? HIDDEN : MINIMAP_VIEW.fullMap.transparency}
			BorderSizePixel={0}
		>
			{props.square === true ? <uiaspectratioconstraint key="Square" AspectRatio={1} /> : undefined}
			{skinId !== undefined ? (
				<SlicedImage
					key="Frame"
					name="Frame"
					id={skinId}
					sliceScale={sliceScale}
					position={new UDim2(0, -border.left, 0, -border.top)}
					size={new UDim2(1, border.left + border.right, 1, border.top + border.bottom)}
					transparency={MINIMAP_VIEW.fullMap.transparency}
					zIndex={FRAME_Z}
				/>
			) : undefined}
		</frame>
	);
}

/**
 * The full map toggle overlay (docs/MINIMAP.md M9, MD5): the whole floor in the middle of the screen, see-through, over
 * the running game (co-op cannot pause), its host `MINIMAP_VIEW.fullMap.heightShare` of the safe area's width and
 * height, the title above (`hud.map.title`) and the toggle hint below (`hud.map.hint`, shared/play mapHint; on touch
 * a tap anywhere closes it, docs/MOBILE.md MB10: a see-through button behind the map takes the tap). Shown while
 * the map is open on a floor with a map and the run is being played; a paused solo run shows the map in its pause
 * overlay instead (PauseMap), so this one steps aside there. MinimapController opens / closes it (Reflex `game.map`).
 */
export function FullMapOverlay() {
	const map = useSelector(selectMapView);
	const s = useSelector(selectSnapshot);
	const info = useSelector(selectRunInfo);
	const bindings = useSelector(selectBindings);
	const device = useSelector(selectInputDevice);
	const actions = useHudActions();
	const touch = device === "touch";
	const pausedSolo = s.paused && !info.coop;
	if (!map.available || !map.open || s.outcome !== "playing" || pausedSolo) return undefined;
	const share = MINIMAP_VIEW.fullMap.heightShare;
	const edge = HALF - share / 2;
	return (
		<frame key="FullMap" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={HIDDEN}>
			{touch ? (
				<textbutton
					key="TouchClose"
					Size={UDim2.fromScale(1, 1)}
					BackgroundTransparency={HIDDEN}
					AutoButtonColor={false}
					Selectable={false}
					Text=""
					Event={{ Activated: () => actions.toggleMap() }}
				/>
			) : undefined}
			<MapHost
				host="full"
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				size={UDim2.fromScale(share, share)}
			/>
			<Panel
				name="Title"
				position={new UDim2(HALF, 0, edge, -HUD_VIEW.gap)}
				anchor={new Vector2(HALF, 1)}
				transparency={HIDDEN}
				align={Enum.HorizontalAlignment.Center}
			>
				<Text order={1} size={HUD_VIEW.titleText} color="uiAccent" text={str(HUD_STRINGS.mapTitle)} />
			</Panel>
			<Panel
				name="Hint"
				position={new UDim2(HALF, 0, 1 - edge, HUD_VIEW.gap)}
				anchor={new Vector2(HALF, 0)}
				transparency={HIDDEN}
				align={Enum.HorizontalAlignment.Center}
			>
				<Text
					order={1}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					text={
						touch
							? str(TOUCH_STRINGS.hintMapClose)
							: str(HUD_STRINGS.mapHint, { key: mapHint(bindings, str)[keyDevice(device)] })
					}
				/>
			</Panel>
		</frame>
	);
}

/**
 * The solo pause overlay's map (MD5): the same full map, left of the pause menu (its panel is HUD_VIEW.panelWidth wide
 * and centred), `fullMap.heightShare` of the safe area high. Upright (`portrait`, docs/PORTRAIT.md PT6) it is a square
 * at the top instead, PORTRAIT.pauseMapShare of the safe area high inside the width (the panel fits under it,
 * PauseOverlay). Nothing on a floor without a map.
 */
export function PauseMap(props: { portrait?: boolean }) {
	const map = useSelector(selectMapView);
	if (!map.available) return undefined;
	if (props.portrait === true) {
		const m = HUD_VIEW.margin;
		return (
			<MapHost
				host="pause"
				position={new UDim2(HALF, 0, 0, m)}
				anchor={new Vector2(HALF, 0)}
				size={new UDim2(1, -2 * m, PORTRAIT.pauseMapShare, -m)}
				square={true}
			/>
		);
	}
	const side = HUD_VIEW.panelWidth / 2 + HUD_VIEW.gap;
	return (
		<MapHost
			host="pause"
			position={new UDim2(HALF, -side, HALF, 0)}
			anchor={new Vector2(1, HALF)}
			size={new UDim2(HALF, -(side + HUD_VIEW.margin), MINIMAP_VIEW.fullMap.heightShare, 0)}
		/>
	);
}
