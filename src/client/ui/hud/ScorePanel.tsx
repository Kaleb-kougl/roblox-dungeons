import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { str, uiImage, useUiArt } from "client/ui/theme";
import { HUD_SKIN, HUD_STRINGS, HUD_VIEW } from "shared/view/hud";
import { BestTargetRow, ScoreNumber } from "./BestTargetRow";
import { ComboMeter } from "./ComboMeter";
import { ComboRow } from "./ComboRow";
import { ArtImage, Panel, Row, Text } from "./primitives";
import { HighlightRing } from "./TutorialFx";

/**
 * Top right, scored runs only (M2): the live score, the combo multiplier and its decay meter (the time left before
 * the combo resets, as a bar that drains over the combo window: COMBO_WINDOW_TICKS, or what M2 boons / curses make of
 * it), and on endless floors the floor and Depth line under the meter (docs/HUD_LAYOUT.md H4; an unscored run keeps
 * it in the StatusPanel). `highlight`: the tutorial's ring (the score callout, the curse lesson). The score rolls up
 * and waits for a room bonus to land (docs/ROOM_CLEAR.md RCD7): its number is the ROOM_CLEAR_UI.scoreText binding,
 * written every frame by RoomClearController.
 *
 * docs/COMBO.md CB6 (CD8: the same five rows, 158 of HUD_FOOTPRINT.score's 160 px): row 3 is the combo row (ComboRow:
 * the tier slot and the multiplier) and row 4 the combo meter (ComboMeter), both drawn per frame from COMBO_UI
 * bindings that ComboController writes (the fill drains smoothly, not at the snapshot's 10 Hz); the rest reads the
 * ~10 Hz snapshot, and an unscored run still shows no panel.
 *
 * docs/NEW_BEST.md NB6 (the same five rows, still 158 of 160): row 1 is BestTargetRow, the `SCORE` label on the right
 * and the points-to-best target on the left in one line; the number is ScoreNumber, gold with a shine after the run's
 * crossing. Both are drawn per frame from NEW_BEST_UI bindings that NewBestController writes; on a run without a target
 * (unranked, first record, records unknown) they look exactly as before.
 *
 * With the UI art (docs/UI_ART.md UA11) the score number has the coin (ui.icon.coin, fitted into HUD_SKIN.coinBox) on
 * its left: the two in a right-aligned Row, the number sized to its text; without the coin, the full-width line.
 */
export function ScorePanel(props: { readonly highlight?: boolean }) {
	useUiArt();
	const s = useSelector(selectSnapshot);
	if (!s.scoring) return undefined;
	const width = HUD_VIEW.scoreWidth;
	const inner = width - HUD_VIEW.pad * 2;
	const coin = uiImage(HUD_SKIN.ids.coin) !== undefined;
	return (
		<Panel
			corner="topRight"
			width={width}
			align={Enum.HorizontalAlignment.Right}
			name="Score"
			overlay={props.highlight === true ? <HighlightRing /> : undefined}
		>
			<BestTargetRow order={1} width={inner} />
			{coin ? (
				<Row order={2} align={Enum.HorizontalAlignment.Right}>
					<ArtImage id={HUD_SKIN.ids.coin} order={1} box={{ w: HUD_SKIN.coinBox, h: HUD_SKIN.coinBox }} />
					<ScoreNumber order={2} size={HUD_VIEW.bigText} />
				</Row>
			) : (
				<ScoreNumber fill={true} order={2} size={HUD_VIEW.bigText} />
			)}
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
