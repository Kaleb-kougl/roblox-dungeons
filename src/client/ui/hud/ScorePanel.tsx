import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { str } from "client/ui/theme";
import { HUD_STRINGS, HUD_VIEW } from "shared/view/hud";
import { ComboMeter } from "./ComboMeter";
import { ComboRow } from "./ComboRow";
import { Panel, Text } from "./primitives";
import { HighlightRing } from "./TutorialFx";

/**
 * Top right, scored runs only (M2): the live score, the combo multiplier and its decay meter (the time left before
 * the combo resets, as a bar that drains over the combo window: COMBO_WINDOW_TICKS, or what M2 boons / curses make of
 * it), and on endless floors the floor and Depth line under the meter (docs/HUD_LAYOUT.md H4; an unscored run keeps
 * it in the StatusPanel). `highlight`: the tutorial's ring (the score callout, the curse lesson).
 *
 * docs/COMBO.md CB6 (CD8: the same five rows, 158 of HUD_FOOTPRINT.score's 160 px): row 3 is the combo row (ComboRow:
 * the tier slot and the multiplier) and row 4 the combo meter (ComboMeter), both drawn per frame from COMBO_UI
 * bindings that ComboController writes (the fill drains smoothly, not at the snapshot's 10 Hz); the rest reads the
 * ~10 Hz snapshot as before, and an unscored run still shows no panel.
 */
export function ScorePanel(props: { readonly highlight?: boolean }) {
	const s = useSelector(selectSnapshot);
	if (!s.scoring) return undefined;
	const width = HUD_VIEW.scoreWidth;
	const inner = width - HUD_VIEW.pad * 2;
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
				text={tostring(s.score)}
			/>
			<ComboRow order={3} width={inner} />
			<ComboMeter order={4} width={inner} />
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
