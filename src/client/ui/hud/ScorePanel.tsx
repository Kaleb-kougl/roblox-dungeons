import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { role, str } from "client/ui/theme";
import { HUD_STRINGS, HUD_VIEW, comboFraction, formatCombo } from "shared/view/hud";
import { ROOM_CLEAR_UI } from "./roomClearBindings";
import { Panel, Text } from "./primitives";
import { HighlightRing } from "./TutorialFx";

const STROKE = 1;

/**
 * Top right, scored runs only (M2): the live score, the combo multiplier and its decay meter (the time left before
 * the combo resets, as a bar that drains over the combo window: COMBO_WINDOW_TICKS, or what M2 boons / curses make of
 * it), and on endless floors the floor and Depth line under the meter (docs/HUD_LAYOUT.md H4; an unscored run keeps
 * it in the StatusPanel). Reads only the ~10 Hz snapshot. `highlight`: the tutorial's ring (the score callout, the
 * curse lesson). The score rolls up and waits for a room bonus to land (docs/ROOM_CLEAR.md RCD7): its number is the
 * ROOM_CLEAR_UI.scoreText binding, written every frame by RoomClearController.
 */
export function ScorePanel(props: { readonly highlight?: boolean }) {
	const s = useSelector(selectSnapshot);
	if (!s.scoring) return undefined;
	const width = HUD_VIEW.scoreWidth;
	const inner = width - HUD_VIEW.pad * 2;
	const frac = comboFraction(s.comboTicks, s.comboWindowTicks);
	return (
		<Panel
			corner="topRight"
			width={width}
			align={Enum.HorizontalAlignment.Right}
			name="Score"
			overlay={props.highlight === true ? <HighlightRing /> : undefined}
		>
			<Text
				fill={true}
				order={1}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Right}
				text={str(HUD_STRINGS.score)}
			/>
			<Text
				fill={true}
				order={2}
				size={HUD_VIEW.bigText}
				align={Enum.TextXAlignment.Right}
				text={ROOM_CLEAR_UI.scoreText.binding}
			/>
			<Text
				fill={true}
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
			{s.floor > 0 ? (
				<Text
					order={5}
					fill={true}
					size={HUD_VIEW.smallText}
					align={Enum.TextXAlignment.Right}
					text={str(HUD_STRINGS.floor, { floor: s.floor, depth: s.depth })}
				/>
			) : undefined}
		</Panel>
	);
}
