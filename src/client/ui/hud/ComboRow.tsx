import React from "@rbxts/react";
import { useHudFont, role } from "client/ui/theme";
import { COMBO_DRAW, FOOTPRINT_ESTIMATE, HUD_VIEW, comboShineOffset } from "shared/view/hud";
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
const DROP_POSITION = COMBO_UI.dropFallPx.binding.map((px) => new UDim2(1, 0, 1, px));
const DROP_STROKE = COMBO_UI.dropTransparency.binding.map(strokeOf);

/**
 * The shine band: clear outside, bandTransparency at its centre (a white copy of the text shows through it). Also the
 * new-best gold number's shine (BestTargetRow ScoreNumber, docs/NEW_BEST.md NB6).
 */
export function shineBand(): NumberSequence {
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
 * alpha), SLAMMED in on a tier up by its own UIScale (COMBO_UI.slotScale, 1.6 -> 1; anchored at its left centre, so
 * it grows in place from the row's left edge and moves nothing). Right, in a fixed COMBO_DRAW.multWidth slot: the
 * multiplier (HUD_STRINGS.combo) in the tier colour (grey on a break / lapse), struck through while broken (RichText
 * `<s>`: the controller wraps the text, so the line is exactly the text's width and colour), POPPED on every feed by
 * its own UIScale on the slot-sized label (COMBO_UI.multScale, anchored at its right centre), with UNSTOPPABLE's shine
 * (a white copy of the text seen through a swept UIGradient band). UIScale never feeds the layout, so neither moves a
 * row. The crack shakes the whole row by a position offset and drops a `-xN.N` from under the multiplier over the meter
 * (it falls while it fades; under reduced motion it fades in place: ComboController writes both, comboDropAt).
 * Every per-frame property is a COMBO_UI binding (ComboController writes them); this never re-renders per frame.
 */
export function ComboRow(props: { readonly order: number; readonly width: number }) {
	const hudFont = useHudFont();
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
					AnchorPoint={new Vector2(0, HALF)}
					Position={UDim2.fromScale(0, HALF)}
					Size={new UDim2(0, slotW, 1, 0)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
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
					<uiscale Scale={U.slotScale.binding} />
					<uitextsizeconstraint MaxTextSize={COMBO_DRAW.slotMaxText} />
				</textlabel>
				<ComboMultiplier key="MultSlot" width={multW} textSize={HUD_VIEW.titleText} placed={true} />
				<textlabel
					key="Drop"
					AnchorPoint={new Vector2(1, 0)}
					Position={DROP_POSITION}
					Size={UDim2.fromOffset(0, COMBO_DRAW.dropText + FOOTPRINT_ESTIMATE.lineSlack)}
					AutomaticSize={Enum.AutomaticSize.X}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextSize={COMBO_DRAW.dropText}
					TextColor3={role("uiHealth")}
					TextStrokeColor3={stroke}
					TextTransparency={U.dropTransparency.binding}
					TextStrokeTransparency={DROP_STROKE}
					TextXAlignment={Enum.TextXAlignment.Right}
					Text={U.dropText.binding}
					Visible={DROP_VISIBLE}
				/>
			</frame>
		</frame>
	);
}

/**
 * The combo multiplier (docs/COMBO.md CB6): HUD_STRINGS.combo in the tier colour, struck through while broken, popped
 * on every feed by its own UIScale, UNSTOPPABLE's shine over it; every property a COMBO_UI binding. `placed`: the
 * score panel's combo row hangs it at its right centre, a `width` wide slot as tall as the row; otherwise (the touch
 * strip, in a list layout) it is a `width` x `height` slot.
 */
export function ComboMultiplier(props: {
	readonly width: number;
	readonly textSize: number;
	readonly placed?: boolean;
	readonly height?: number;
	readonly order?: number;
}) {
	const hudFont = useHudFont();
	const placed = props.placed === true;
	const stroke = role("background");
	const U = COMBO_UI;
	return (
		<frame
			key="MultSlot"
			LayoutOrder={props.order ?? 0}
			AnchorPoint={placed ? new Vector2(1, HALF) : new Vector2()}
			Position={placed ? UDim2.fromScale(1, HALF) : new UDim2()}
			Size={placed ? new UDim2(0, props.width, 1, 0) : new UDim2(0, props.width, 0, props.height ?? 0)}
			BackgroundTransparency={HIDDEN}
		>
			<textlabel
				key="Mult"
				AnchorPoint={new Vector2(1, HALF)}
				Position={UDim2.fromScale(1, HALF)}
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				RichText={true}
				TextSize={props.textSize}
				TextColor3={U.multColor.binding}
				TextStrokeColor3={stroke}
				TextStrokeTransparency={HUD_VIEW.panelTransparency}
				TextXAlignment={Enum.TextXAlignment.Right}
				Text={U.multText.binding}
			>
				<uiscale Scale={U.multScale.binding} />
				<textlabel
					key="Shine"
					Size={UDim2.fromScale(1, 1)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextSize={props.textSize}
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
	);
}
