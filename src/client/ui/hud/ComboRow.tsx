import React from "@rbxts/react";
import { HUD_FONT, role } from "client/ui/theme";
import { COMBO_DRAW, FOOTPRINT_ESTIMATE, HUD_VIEW, comboDropAt, comboShineOffset } from "shared/view/hud";
import { COMBO_ROW_Z, COMBO_UI } from "./comboUi";

const HIDDEN = 1;
const HALF = 0.5;
/** Inside the multiplier: the shine over the text. */
const SHINE_Z = 2;

/** The dark stroke never shows through more than the text it outlines (primitives Text's rule). */
function strokeOf(t: number): number {
	return math.max(HUD_VIEW.panelTransparency, t);
}

// Mapped once at load: the source bindings are module-level (comboUi.ts), so these are stable across renders.
const SHAKE = COMBO_UI.shakePx.binding.map((px) => UDim2.fromOffset(px, 0));
const SLOT_STROKE = COMBO_UI.slotTransparency.binding.map(strokeOf);
const SHINE_VISIBLE = COMBO_UI.shine.binding.map((u) => u >= 0);
const SHINE_OFFSET = COMBO_UI.shine.binding.map((u) => new Vector2(comboShineOffset(u), 0));
const DROP_VISIBLE = COMBO_UI.drop.binding.map((u) => u >= 0);
const DROP_POSITION = COMBO_UI.drop.binding.map((u) => new UDim2(1, 0, 1, comboDropAt(u).fallPx));
const DROP_TRANSPARENCY = COMBO_UI.drop.binding.map((u) => comboDropAt(u).transparency);
const DROP_STROKE = COMBO_UI.drop.binding.map((u) => strokeOf(comboDropAt(u).transparency));

/** The shine band: clear outside, bandTransparency at its centre (a white copy of the text shows through it). */
function shineBand(): NumberSequence {
	const half = COMBO_DRAW.shine.bandWidth / 2;
	return new NumberSequence([
		new NumberSequenceKeypoint(0, HIDDEN),
		new NumberSequenceKeypoint(HALF - half, HIDDEN),
		new NumberSequenceKeypoint(HALF, COMBO_DRAW.shine.bandTransparency),
		new NumberSequenceKeypoint(HALF + half, HIDDEN),
		new NumberSequenceKeypoint(1, HIDDEN),
	]);
}

/**
 * Score panel row 3 (docs/COMBO.md CB6, CD8): the combo row, one fixed-size frame the height of the old `x1.3` line, so
 * no row of the panel ever moves. Left: the tier slot (the tier name, COMBO LOST after a break, BEST xN.N after a
 * lapse; TextScaled up to COMBO_DRAW.slotMaxText, so a long name or translation shrinks to fit; it fades by the slot
 * alpha). Right, in a fixed COMBO_DRAW.multWidth slot: the multiplier (HUD_STRINGS.combo) in the tier colour (grey
 * on a break / lapse), struck through while broken (RichText `<s>`: the controller wraps the text, so the line is
 * exactly the text's width and colour), popped / slammed by a UIScale on the slot-sized label (anchored at its right
 * centre), with UNSTOPPABLE's shine (a white copy of the text seen through a swept UIGradient band).
 * The crack shakes the whole row by a position offset and drops a `-xN.N` from under the multiplier over the meter.
 * Every per-frame property is a COMBO_UI binding (ComboController writes them); this never re-renders per frame.
 */
export function ComboRow(props: { readonly order: number; readonly width: number }) {
	const h = HUD_VIEW.titleText + FOOTPRINT_ESTIMATE.lineSlack;
	const multW = COMBO_DRAW.multWidth;
	const slotW = math.max(0, props.width - multW - HUD_VIEW.gap);
	const stroke = role("background");
	const U = COMBO_UI;
	return (
		<frame
			key="ComboRow"
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, h)}
			BackgroundTransparency={HIDDEN}
			ZIndex={COMBO_ROW_Z}
		>
			<frame key="Content" Size={UDim2.fromScale(1, 1)} Position={SHAKE} BackgroundTransparency={HIDDEN}>
				<textlabel
					key="Slot"
					Size={new UDim2(0, slotW, 1, 0)}
					BackgroundTransparency={HIDDEN}
					Font={HUD_FONT}
					TextScaled={true}
					TextSize={COMBO_DRAW.slotMaxText}
					TextColor3={U.slotColor.binding}
					TextStrokeColor3={stroke}
					TextTransparency={U.slotTransparency.binding}
					TextStrokeTransparency={SLOT_STROKE}
					TextXAlignment={Enum.TextXAlignment.Left}
					TextYAlignment={Enum.TextYAlignment.Center}
					Text={U.slotText.binding}
				>
					<uitextsizeconstraint MaxTextSize={COMBO_DRAW.slotMaxText} />
				</textlabel>
				<frame
					key="MultSlot"
					AnchorPoint={new Vector2(1, HALF)}
					Position={UDim2.fromScale(1, HALF)}
					Size={new UDim2(0, multW, 1, 0)}
					BackgroundTransparency={HIDDEN}
				>
					<textlabel
						key="Mult"
						AnchorPoint={new Vector2(1, HALF)}
						Position={UDim2.fromScale(1, HALF)}
						Size={UDim2.fromScale(1, 1)}
						BackgroundTransparency={HIDDEN}
						Font={HUD_FONT}
						RichText={true}
						TextSize={HUD_VIEW.titleText}
						TextColor3={U.multColor.binding}
						TextStrokeColor3={stroke}
						TextStrokeTransparency={HUD_VIEW.panelTransparency}
						TextXAlignment={Enum.TextXAlignment.Right}
						Text={U.multText.binding}
					>
						<uiscale Scale={U.scale.binding} />
						<textlabel
							key="Shine"
							Size={UDim2.fromScale(1, 1)}
							BackgroundTransparency={HIDDEN}
							Font={HUD_FONT}
							TextSize={HUD_VIEW.titleText}
							RichText={true}
							TextColor3={role("uiText")}
							TextStrokeTransparency={HIDDEN}
							TextXAlignment={Enum.TextXAlignment.Right}
							Text={U.multText.binding}
							Visible={SHINE_VISIBLE}
							ZIndex={SHINE_Z}
						>
							<uigradient Transparency={shineBand()} Offset={SHINE_OFFSET} />
						</textlabel>
					</textlabel>
				</frame>
				<textlabel
					key="Drop"
					AnchorPoint={new Vector2(1, 0)}
					Position={DROP_POSITION}
					Size={UDim2.fromOffset(0, COMBO_DRAW.dropText + FOOTPRINT_ESTIMATE.lineSlack)}
					AutomaticSize={Enum.AutomaticSize.X}
					BackgroundTransparency={HIDDEN}
					Font={HUD_FONT}
					TextSize={COMBO_DRAW.dropText}
					TextColor3={role("uiHealth")}
					TextStrokeColor3={stroke}
					TextTransparency={DROP_TRANSPARENCY}
					TextStrokeTransparency={DROP_STROKE}
					TextXAlignment={Enum.TextXAlignment.Right}
					Text={U.dropText.binding}
					Visible={DROP_VISIBLE}
				/>
			</frame>
		</frame>
	);
}
