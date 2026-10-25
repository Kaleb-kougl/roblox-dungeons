import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { role, str } from "client/ui/theme";
import { HUD_STRINGS, HUD_VIEW, comboFraction, formatCombo } from "shared/view/hud";
import { Panel, Text } from "./primitives";

const STROKE = 1;

/**
 * Top right, scored runs only (M2): the live score, the combo multiplier and its decay meter (the time left before
 * the combo resets, as a bar that drains over the combo window: COMBO_WINDOW_TICKS, or what M2 boons / curses make of
 * it). Reads only the ~10 Hz snapshot.
 */
export function ScorePanel() {
	const s = useSelector(selectSnapshot);
	if (!s.scoring) return undefined;
	const width = HUD_VIEW.scoreWidth;
	const inner = width - HUD_VIEW.pad * 2;
	const frac = comboFraction(s.comboTicks, s.comboWindowTicks);
	return (
		<Panel
			position={new UDim2(1, -HUD_VIEW.margin, 0, HUD_VIEW.margin)}
			anchor={new Vector2(1, 0)}
			width={width}
			align={Enum.HorizontalAlignment.Right}
			name="Score"
		>
			<Text
				order={1}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Right}
				text={str(HUD_STRINGS.score)}
			/>
			<Text order={2} size={HUD_VIEW.bigText} align={Enum.TextXAlignment.Right} text={tostring(s.score)} />
			<Text
				order={3}
				size={HUD_VIEW.titleText}
				color="ember"
				align={Enum.TextXAlignment.Right}
				text={str(HUD_STRINGS.combo, { combo: formatCombo(s.combo) })}
			/>
			<frame
				key="ComboMeter"
				LayoutOrder={4}
				Size={new UDim2(0, inner, 0, HUD_VIEW.comboBarHeight)}
				BackgroundColor3={role("uiPanel")}
				BorderSizePixel={0}
			>
				<uistroke Thickness={STROKE} Color={role("uiTextDim")} />
				<frame
					key="Fill"
					Size={UDim2.fromScale(frac, 1)}
					BackgroundColor3={role("ember")}
					BorderSizePixel={0}
				/>
			</frame>
		</Panel>
	);
}
