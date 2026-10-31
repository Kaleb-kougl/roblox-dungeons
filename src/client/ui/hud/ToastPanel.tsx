import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectSnapshot, selectToasts, type ToastView } from "client/store";
import { shrineHint, keyDevice } from "shared/play";
import { role, str } from "client/ui/theme";
import { DAILY_RANK, HUD_VIEW, PROGRESSION_STRINGS, PROGRESSION_VIEW, TOUCH_STRINGS } from "shared/view/hud";
import { useHeadshot } from "./headshots";
import { Panel, Row, Text } from "./primitives";
import { screenSkin } from "shared/view/menu";

const HALF = 0.5;
const FULL_ROUND = new UDim(1, 0);

/** A toast's line text: its key with the looked-up name / desc / amount, and its literal args over them. */
function toastText(t: ToastView): string {
	const vars = {
		name: t.nameKey !== undefined ? str(t.nameKey) : "",
		desc: t.descKey !== undefined ? str(t.descKey) : "",
		amount: t.amount ?? 0,
	};
	return str(t.key, t.args !== undefined ? { ...vars, ...t.args } : vars);
}

/** A toast led by a player's headshot (docs/DAILY.md DS10: a friend passed): the image (blank until loaded), the line. */
function HeadshotToast(props: { readonly order: number; readonly userId: number; readonly text: string }) {
	const image = useHeadshot(props.userId);
	const px = DAILY_RANK.toastHeadshotPx;
	return (
		<Row order={props.order} align={Enum.HorizontalAlignment.Center}>
			<imagelabel
				key="Headshot"
				LayoutOrder={1}
				Size={UDim2.fromOffset(px, px)}
				BackgroundTransparency={HUD_VIEW.panelTransparency}
				BackgroundColor3={role("background")}
				BorderSizePixel={0}
				Image={image}
			>
				<uicorner CornerRadius={FULL_ROUND} />
			</imagelabel>
			<Text key="Line" order={2} color="uiAccent" text={props.text} />
		</Row>
	);
}

/**
 * Top centre, M2 progression: the toasts of the last few seconds (boon taken, relic found, curse accepted, Second
 * Wind, Vampire Fang, a boost picked up (`{name}: {desc}`); the tutorial's callouts; a Daily friend passed, led by
 * their headshot: docs/DAILY.md DS10) and, while the player stands in an unused curse shrine's zone, the accept hint.
 * Item names are theme strings themselves (`<id>.name`); a player's name comes in the toast's literal `args`.
 */
export function ToastPanel() {
	const toasts = useSelector(selectToasts);
	const s = useSelector(selectSnapshot);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	if (toasts.size() === 0 && !s.atShrine) return undefined;
	const lines = toasts.map((t, i) =>
		t.headshotUserId !== undefined ? (
			<HeadshotToast key={`t${t.id}`} order={i + 1} userId={t.headshotUserId} text={toastText(t)} />
		) : (
			<Text
				key={`t${t.id}`}
				order={i + 1}
				color="uiAccent"
				align={Enum.TextXAlignment.Center}
				wrap={true}
				text={toastText(t)}
			/>
		),
	);
	return (
		<Panel
			position={new UDim2(HALF, 0, 0, PROGRESSION_VIEW.toastTop)}
			anchor={new Vector2(HALF, 0)}
			width={PROGRESSION_VIEW.toastWidth}
			align={Enum.HorizontalAlignment.Center}
			skin={screenSkin("toast")}
			name="Toasts"
		>
			{lines}
			{s.atShrine ? (
				<Text
					fill={true}
					order={toasts.size() + 1}
					size={HUD_VIEW.smallText}
					color="uiMana"
					align={Enum.TextXAlignment.Center}
					text={
						device === "touch"
							? str(TOUCH_STRINGS.hintShrine)
							: str(PROGRESSION_STRINGS.shrineHint, { key: shrineHint(bindings)[keyDevice(device)] })
					}
				/>
			) : undefined}
		</Panel>
	);
}
