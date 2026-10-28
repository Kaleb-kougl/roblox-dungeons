import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectGameActive, selectInputDevice, selectRunInfo, selectSnapshot } from "client/store";
import { HUD_FONT, role, str, themePack } from "client/ui/theme";
import { swapHint, keyDevice } from "shared/play";
import { HUD_HINTS, HUD_STRINGS, HUD_VIEW } from "shared/view/hud";
import { Panel, Row, Text } from "./primitives";
import { useTimedHint } from "./useTimedHint";
import { HighlightRing } from "./TutorialFx";

const STROKE = 1;
const ACTIVE_STROKE = 2;
const NUMBER_WIDTH = 22;
const HALF = 0.5;

/** A weapon's display name: theme string `<id>.name`, its id without one, "-" for an empty set (web WeaponHud). */
function weaponName(id: string): string {
	if (id === "") return "-";
	const key = `${id}.name`;
	return themePack()?.hasString(key) === true ? str(key) : id;
}

/** One weapon set: its number and the weapon's name; the set in hand is highlighted (uiAccent ring, opaque). */
function WeaponSlot(props: { order: number; index: number; id: string; active: boolean }) {
	const size = HUD_VIEW.weaponSlotSize;
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, size.x, 0, size.y)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={props.active ? 0 : HUD_VIEW.weaponInactiveTransparency}
			BorderSizePixel={0}
		>
			<uistroke
				Thickness={props.active ? ACTIVE_STROKE : STROKE}
				Color={role(props.active ? "uiAccent" : "uiTextDim")}
			/>
			<textlabel
				Size={new UDim2(0, NUMBER_WIDTH, 1, 0)}
				BackgroundTransparency={1}
				Font={HUD_FONT}
				TextSize={HUD_VIEW.weaponTextSize}
				TextColor3={role(props.active ? "uiAccent" : "uiTextDim")}
				Text={tostring(props.index + 1)}
			/>
			<textlabel
				AnchorPoint={new Vector2(0, HALF)}
				Position={new UDim2(0, NUMBER_WIDTH, HALF, 0)}
				Size={new UDim2(1, -NUMBER_WIDTH, 1, 0)}
				BackgroundTransparency={1}
				Font={HUD_FONT}
				TextSize={HUD_VIEW.weaponTextSize}
				TextXAlignment={Enum.TextXAlignment.Left}
				TextColor3={role(props.active ? "uiText" : "uiTextDim")}
				Text={weaponName(props.id)}
			/>
		</frame>
	);
}

/**
 * The device-aware SWAP hint ("E swap" on keyboard, "Y swap" on a gamepad: game.inputDevice), timed so it never sits
 * over the playfield for long (docs/HUD_LAYOUT.md H5): shown for HUD_HINTS.swapHintSeconds after a run starts (the
 * run counter `game.run.run` changes or the game turns active) or the input device changes, then faded out over
 * HUD_HINTS.fadeSeconds (useTimedHint: hintVisible on a binding, Heartbeat only during the fade, reduced motion hides at once).
 * Hidden, it takes no layout space. `forced` (the tutorial's weapon lesson) keeps it on.
 */
function SwapHint(props: { order: number; text: string; forced: boolean }) {
	const run = useSelector(selectRunInfo).run;
	const active = useSelector(selectGameActive);
	const device = useSelector(selectInputDevice);
	const { hidden, fade } = useTimedHint(HUD_HINTS.swapHintSeconds, [run, active, device]);
	if (hidden && !props.forced) return undefined;
	return (
		<Text
			order={props.order}
			size={HUD_VIEW.smallText}
			color="uiTextDim"
			transparency={props.forced ? 0 : fade}
			text={props.text}
		/>
	);
}

/**
 * Bottom left (web WeaponHud): the two weapon sets (compact slots, docs/HUD_LAYOUT.md H5), the set in hand
 * highlighted, and the timed SWAP hint (SwapHint) ABOVE the slots, so the bottom-anchored slots never move when it
 * hides. `highlight`: the tutorial's ring (the bow lesson), which also keeps
 * the hint on. Not on touch (docs/MOBILE.md MBD8): the screen's Swap button does the job and the thumbs own the corner.
 */
export function WeaponPanel(props: { readonly highlight?: boolean }) {
	const s = useSelector(selectSnapshot);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	if (device === "touch") return undefined;
	if (s.weapons.size() === 0) return undefined;
	const slots = s.weapons.map((id, i) => (
		<WeaponSlot key={`w${i}`} order={i + 1} index={i} id={id} active={i === s.activeSet} />
	));
	return (
		<Panel corner="bottomLeft" name="Weapons" overlay={props.highlight === true ? <HighlightRing /> : undefined}>
			<SwapHint
				order={1}
				forced={props.highlight === true}
				text={str(HUD_STRINGS.weaponSwap, { key: swapHint(bindings)[keyDevice(device)] })}
			/>
			<Row order={2}>{slots}</Row>
		</Panel>
	);
}
