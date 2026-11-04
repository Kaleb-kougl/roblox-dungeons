import React, { useMemo } from "@rbxts/react";
import { useHudFont, role } from "client/ui/theme";
import { smoothstep01 } from "shared/view/fx";
import { FOOTPRINT_ESTIMATE, HUD_TRANSIENT, HUD_VIEW, ROOM_CLEAR_VIEW } from "shared/view/hud";
import { ROOM_CLEAR_UI as UI } from "./roomClearBindings";
import { useTouchStrip } from "./touchStripContext";

const HALF = 0.5;
const HIDDEN = 1;
/** UIGradient multiplies TextColor3: white text lets the gradient carry the colour. */
const WHITE = new Color3(1, 1, 1);

/**
 * The room clear stamp and its tally row (docs/ROOM_CLEAR.md RC7), top centre in the boss bar's slot
 * (HUD_TRANSIENT.roomClear), and the bonus chip flying to the score panel. Every changing property is a
 * ROOM_CLEAR_UI binding written by RoomClearController; this component renders once per run. The tally is RichText
 * (every part escaped by roomClearTallyText; docs/FORTUNE.md FO7: a Horde room's last segment in `pact.horde`, the row
 * scaled by its slam). On touch (docs/UI_ART.md
 * "Phones") it hangs in the touch strip's boss slot and the chip flies to the strip's score.
 */
export function RoomClearStamp() {
	const hudFont = useHudFont();
	const strip = useTouchStrip();
	const box = HUD_TRANSIENT.roomClear;
	const edge = strip?.bossTop ?? box.edge;
	const flyX = strip !== undefined ? (strip.scoreAt.x - strip.hudOrigin.x) / strip.hudScale : 0;
	const flyY = strip !== undefined ? (strip.scoreAt.y - strip.hudOrigin.y) / strip.hudScale : 0;
	const touch = strip !== undefined;
	const slack = FOOTPRINT_ESTIMATE.lineSlack;
	const stampH = ROOM_CLEAR_VIEW.stampText + slack;
	const tallyH = ROOM_CLEAR_VIEW.tallyText + slack;
	const look = useMemo(() => {
		const gold = role("ember");
		const shine = role("uiText");
		const w = ROOM_CLEAR_VIEW.shineHalfWidth;
		return {
			clear: new ColorSequence(role("uiText")),
			perfect: new ColorSequence([
				new ColorSequenceKeypoint(0, gold),
				new ColorSequenceKeypoint(HALF - w, gold),
				new ColorSequenceKeypoint(HALF, shine),
				new ColorSequenceKeypoint(HALF + w, gold),
				new ColorSequenceKeypoint(1, gold),
			]),
			flyFrom: new UDim2(HALF, 0, 0, edge + box.height),
			flyTo: touch
				? UDim2.fromOffset(flyX, flyY)
				: new UDim2(
						1,
						-(HUD_VIEW.margin + HUD_VIEW.scoreWidth * HALF),
						0,
						HUD_VIEW.margin + ROOM_CLEAR_VIEW.flyTargetY,
				  ),
		};
	}, [box, edge, touch, flyX, flyY]);
	return (
		<>
			<frame
				key="RoomClear"
				AnchorPoint={new Vector2(HALF, 0)}
				Position={new UDim2(HALF, 0, 0, edge)}
				Size={new UDim2(0, box.width, 0, box.height)}
				BackgroundTransparency={HIDDEN}
				Visible={UI.visible.binding}
			>
				<textlabel
					key="Stamp"
					AnchorPoint={new Vector2(HALF, HALF)}
					Position={new UDim2(HALF, 0, 0, stampH * HALF)}
					Size={new UDim2(1, 0, 0, stampH)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextScaled={true}
					TextColor3={WHITE}
					TextStrokeColor3={role("background")}
					TextTransparency={UI.stampTransparency.binding}
					TextStrokeTransparency={UI.stampTransparency.binding}
					Text={UI.stampText.binding}
				>
					{/* docs/RUN_RECAP.md CM2: "TEAM PERFECT x3" (or a long translation) shrinks to the row, never past it. */}
					<uitextsizeconstraint MaxTextSize={ROOM_CLEAR_VIEW.stampText} />
					<uiscale Scale={UI.stampScale.binding} />
					<uigradient
						Color={UI.perfect.binding.map((p) => (p ? look.perfect : look.clear))}
						Offset={UI.shineOffset.binding.map((x) => new Vector2(x, 0))}
					/>
				</textlabel>
				<textlabel
					key="Tally"
					Position={new UDim2(0, 0, 0, stampH + ROOM_CLEAR_VIEW.rowGap)}
					Size={new UDim2(1, 0, 0, tallyH)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextScaled={true}
					TextColor3={role("uiText")}
					TextStrokeColor3={role("background")}
					TextTransparency={UI.tallyTransparency.binding}
					TextStrokeTransparency={UI.tallyTransparency.binding}
					RichText={true}
					Text={UI.tallyText.binding}
				>
					<uitextsizeconstraint MaxTextSize={ROOM_CLEAR_VIEW.tallyText} />
					<uiscale Scale={UI.tallyScale.binding} />
				</textlabel>
			</frame>
			<textlabel
				key="RoomClearFly"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UI.flyProgress.binding.map((p) => look.flyFrom.Lerp(look.flyTo, smoothstep01(p)))}
				Size={new UDim2(0, ROOM_CLEAR_VIEW.flyWidth, 0, ROOM_CLEAR_VIEW.flyText + slack)}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				TextSize={ROOM_CLEAR_VIEW.flyText}
				TextColor3={role("uiAccent")}
				TextStrokeColor3={role("background")}
				TextStrokeTransparency={0}
				Visible={UI.flyProgress.binding.map((p) => p >= 0)}
				Text={UI.flyText.binding}
			/>
		</>
	);
}
