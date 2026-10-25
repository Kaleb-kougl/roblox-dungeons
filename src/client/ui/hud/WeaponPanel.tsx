import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectSnapshot } from "client/store";
import { HUD_FONT, role, str, themePack } from "client/ui/theme";
import { swapHint } from "shared/play";
import { HUD_STRINGS, HUD_VIEW } from "shared/view/hud";
import { Panel, Row, Text } from "./primitives";

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
			BackgroundTransparency={props.active ? 0 : HUD_VIEW.panelTransparency * 2}
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
				TextSize={HUD_VIEW.textSize}
				TextColor3={role(props.active ? "uiAccent" : "uiTextDim")}
				Text={tostring(props.index + 1)}
			/>
			<textlabel
				AnchorPoint={new Vector2(0, HALF)}
				Position={new UDim2(0, NUMBER_WIDTH, HALF, 0)}
				Size={new UDim2(1, -NUMBER_WIDTH, 1, 0)}
				BackgroundTransparency={1}
				Font={HUD_FONT}
				TextSize={HUD_VIEW.textSize}
				TextXAlignment={Enum.TextXAlignment.Left}
				TextColor3={role(props.active ? "uiText" : "uiTextDim")}
				Text={weaponName(props.id)}
			/>
		</frame>
	);
}

/**
 * Bottom left (web WeaponHud): the two weapon sets, the set in hand highlighted, and the device-aware SWAP hint
 * ("E swap" on keyboard, "Y swap" on a gamepad: game.inputDevice).
 */
export function WeaponPanel() {
	const s = useSelector(selectSnapshot);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	if (s.weapons.size() === 0) return undefined;
	const slots = s.weapons.map((id, i) => (
		<WeaponSlot key={`w${i}`} order={i + 1} index={i} id={id} active={i === s.activeSet} />
	));
	return (
		<Panel position={new UDim2(0, HUD_VIEW.margin, 1, -HUD_VIEW.margin)} anchor={new Vector2(0, 1)} name="Weapons">
			<Row order={1}>{slots}</Row>
			<Text
				order={2}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				text={str(HUD_STRINGS.weaponSwap, { key: swapHint(bindings)[device] })}
			/>
		</Panel>
	);
}
