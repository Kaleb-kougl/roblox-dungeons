import React from "@rbxts/react";
import { HUD_FONT, role } from "client/ui/theme";
import { FOOTPRINT_ESTIMATE, HUD_TRANSIENT, HUD_VIEW, ROOM_CLEAR_VIEW } from "shared/view/hud";
import { ROOM_CLEAR_UI as UI } from "./roomClearBindings";

const HALF = 0.5;
const HIDDEN = 1;

/**
 * The co-op corner chips (docs/ROOM_CLEAR.md RC7): a far teammate's room clear, a small line under the score panel
 * (HUD_TRANSIENT.roomClearChip) that slides in and merges into the score. Up to ROOM_CLEAR_VIEW.maxChips rows, each
 * bound to its ROOM_CLEAR_UI slot; this component renders once per run.
 */
export function RoomClearChips() {
	const box = HUD_TRANSIENT.roomClearChip;
	const rowH = ROOM_CLEAR_VIEW.chipText + FOOTPRINT_ESTIMATE.lineSlack;
	const rows = new Array<React.Element>();
	for (let i = 0; i < ROOM_CLEAR_VIEW.maxChips; i++) {
		rows.push(
			<textlabel
				key={`Chip${i}`}
				AnchorPoint={new Vector2(1, 0)}
				Position={UI.chipOffset[i].binding.map((x) => new UDim2(1, x, 0, i * (rowH + HUD_VIEW.gap)))}
				Size={new UDim2(0, box.width, 0, rowH)}
				BackgroundTransparency={HIDDEN}
				Font={HUD_FONT}
				TextSize={ROOM_CLEAR_VIEW.chipText}
				TextColor3={UI.chipPerfect[i].binding.map((p) => role(p ? "ember" : "uiText"))}
				TextStrokeColor3={role("background")}
				TextTransparency={UI.chipTransparency[i].binding}
				TextStrokeTransparency={UI.chipTransparency[i].binding}
				TextXAlignment={Enum.TextXAlignment.Right}
				Text={UI.chipText[i].binding}
			/>,
		);
	}
	return (
		<frame
			key="RoomClearChips"
			AnchorPoint={new Vector2(1, 0)}
			Position={new UDim2(1, -HUD_VIEW.margin, 0, box.edge)}
			Size={new UDim2(0, box.width, 0, box.height)}
			BackgroundTransparency={HIDDEN}
		>
			{rows}
		</frame>
	);
}
