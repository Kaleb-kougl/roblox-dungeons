import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectGameActive, selectInputDevice, selectRunInfo, selectSnapshot } from "client/store";
import { role, str, themePack, uiImage, useHudFont, useUiArt } from "client/ui/theme";
import { swapHint, keyDevice } from "shared/play";
import { HUD_HINTS, HUD_SKIN, HUD_STRINGS, HUD_VIEW } from "shared/view/hud";
import { Panel, Row, SlicedImage, Text } from "./primitives";
import { useTimedHint } from "./useTimedHint";
import { HighlightRing } from "./TutorialFx";

const STROKE = 1;
const ACTIVE_STROKE = 2;
const NUMBER_WIDTH = 22;
const HALF = 0.5;
const HIDDEN = 1;
/** Inside a slot: the frame art, the labels over it. */
const SLOT_Z = { art: 1, label: 2 } as const;

/** A weapon's display name: theme string `<id>.name`, its id without one, "-" for an empty set (web WeaponHud). */
function weaponName(id: string): string {
	if (id === "") return "-";
	const key = `${id}.name`;
	return themePack()?.hasString(key) === true ? str(key) : id;
}

/**
 * One weapon set: its number and the weapon's name; the set in hand is highlighted (uiAccent ring, opaque). With the
 * slot art (docs/UI_ART.md UA11) the slot is the ui.slot frame (9-sliced at the in-run density, snapped to whole screen
 * px) behind the labels, the inactive one at HUD_VIEW.weaponInactiveTransparency and without a ring; without the art,
 * the flat slot.
 */
function WeaponSlot(props: { order: number; index: number; id: string; active: boolean }) {
	useUiArt();
	const hudFont = useHudFont();
	const size = HUD_VIEW.weaponSlotSize;
	const slotT = props.active ? 0 : HUD_VIEW.weaponInactiveTransparency;
	const art = uiImage(HUD_SKIN.ids.slot) !== undefined;
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, size.x, 0, size.y)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={art ? HIDDEN : slotT}
			BorderSizePixel={0}
		>
			{art ? (
				<SlicedImage
					key="Skin"
					name="Skin"
					id={HUD_SKIN.ids.slot}
					snap={true}
					refPerArt={HUD_SKIN.slotRefPerArt}
					transparency={slotT}
					zIndex={SLOT_Z.art}
				/>
			) : undefined}
			{!art || props.active ? (
				<uistroke
					Thickness={props.active ? ACTIVE_STROKE : STROKE}
					Color={role(props.active ? "uiAccent" : "uiTextDim")}
				/>
			) : undefined}
			<textlabel
				Size={new UDim2(0, NUMBER_WIDTH, 1, 0)}
				BackgroundTransparency={1}
				Font={hudFont}
				TextSize={HUD_VIEW.weaponTextSize}
				TextColor3={role(props.active ? "uiAccent" : "uiTextDim")}
				Text={tostring(props.index + 1)}
				ZIndex={SLOT_Z.label}
			/>
			<textlabel
				AnchorPoint={new Vector2(0, HALF)}
				Position={new UDim2(0, NUMBER_WIDTH, HALF, 0)}
				Size={new UDim2(1, -NUMBER_WIDTH, 1, 0)}
				BackgroundTransparency={1}
				Font={hudFont}
				TextSize={HUD_VIEW.weaponTextSize}
				TextXAlignment={Enum.TextXAlignment.Left}
				TextColor3={role(props.active ? "uiText" : "uiTextDim")}
				Text={weaponName(props.id)}
				ZIndex={SLOT_Z.label}
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
				text={str(HUD_STRINGS.weaponSwap, { key: swapHint(bindings, str)[keyDevice(device)] })}
			/>
			<Row order={2}>{slots}</Row>
		</Panel>
	);
}
