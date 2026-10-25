import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectInputDevice, selectSnapshot, selectToasts } from "client/store";
import { str } from "client/ui/theme";
import { HUD_VIEW, PROGRESSION_STRINGS, PROGRESSION_VIEW, SHRINE_HINT } from "shared/view/hud";
import { Panel, Text } from "./primitives";

const HALF = 0.5;

/**
 * Top centre, M2 progression: the toasts of the last few seconds (boon taken, relic found, curse accepted, Second
 * Wind, Vampire Fang) and, while the player stands in an unused curse shrine's zone, the accept hint. Item names are
 * theme strings themselves (`<id>.name`).
 */
export function ToastPanel() {
	const toasts = useSelector(selectToasts);
	const s = useSelector(selectSnapshot);
	const device = useSelector(selectInputDevice);
	if (toasts.size() === 0 && !s.atShrine) return undefined;
	const lines = toasts.map((t, i) => (
		<Text
			key={`t${t.id}`}
			order={i + 1}
			color="uiAccent"
			align={Enum.TextXAlignment.Center}
			text={str(t.key, {
				name: t.nameKey !== undefined ? str(t.nameKey) : "",
				amount: t.amount ?? 0,
			})}
		/>
	));
	return (
		<Panel
			position={new UDim2(HALF, 0, 0, PROGRESSION_VIEW.toastTop)}
			anchor={new Vector2(HALF, 0)}
			width={PROGRESSION_VIEW.toastWidth}
			align={Enum.HorizontalAlignment.Center}
			name="Toasts"
		>
			{lines}
			{s.atShrine ? (
				<Text
					order={toasts.size() + 1}
					size={HUD_VIEW.smallText}
					color="uiMana"
					align={Enum.TextXAlignment.Center}
					text={str(PROGRESSION_STRINGS.shrineHint, { key: SHRINE_HINT[device] })}
				/>
			) : undefined}
		</Panel>
	);
}
