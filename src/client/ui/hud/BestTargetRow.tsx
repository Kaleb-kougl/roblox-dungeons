import React from "@rbxts/react";
import { useHudFont, role, str } from "client/ui/theme";
import {
	FOOTPRINT_ESTIMATE,
	HUD_STRINGS,
	HUD_VIEW,
	NEW_BEST_DRAW,
	NEW_BEST_ROLE,
	comboShineOffset,
} from "shared/view/hud";
import { shineBand } from "./ComboRow";
import { NEW_BEST_UI } from "./newBestUi";
import { ROOM_CLEAR_UI } from "./roomClearBindings";

const HIDDEN = 1;
const HALF = 0.5;
/** Inside the score number: the shine over the text. */
const SHINE_Z = 2;

// Mapped once at load: the source bindings are module-level (newBestUi.ts), so these are stable across renders. The
// colours resolve the theme when the binding changes (the pack is loaded before any HUD mounts).
const SCORE_COLOR = NEW_BEST_UI.scoreGold.binding.map((gold) =>
	gold > 0 ? role("uiText").Lerp(role(NEW_BEST_ROLE), math.clamp(gold, 0, 1)) : role("uiText"),
);
const SHINE_VISIBLE = NEW_BEST_UI.shine.binding.map((u) => u >= 0);
const SHINE_OFFSET = NEW_BEST_UI.shine.binding.map((u) => new Vector2(comboShineOffset(u), 0));
const COMPACT_VISIBLE = NEW_BEST_UI.compactText.binding.map((t) => t !== "");

/**
 * Score panel row 1 (docs/NEW_BEST.md NB6, "The target line"): the label row split into two slots on ONE line, so no
 * row is added (scoreEstimate stays 158 of HUD_FOOTPRINT.score's 160). Right: the `SCORE` label exactly as before
 * (uiTextDim, right-aligned, the row's full width). Left: the target slot, `width` - NEW_BEST_DRAW.labelSlotWidth -
 * HUD_VIEW.gap wide, TextScaled up to HUD_VIEW.smallText (a long number or translation shrinks to fit), text and colour
 * from NEW_BEST_UI (NewBestController: `12340 TO BEST` dim, ember pulsing within reach, `NEW BEST +3120` gold), the
 * crossing's slam by its own UIScale anchored at its left centre (it grows in place from the row's left edge; UIScale
 * never feeds the layout, so nothing moves). Empty on a run without a target (unranked, first record, unknown): the
 * row then looks exactly as it did.
 */
export function BestTargetRow(props: { readonly order: number; readonly width: number }) {
	const hudFont = useHudFont();
	const h = HUD_VIEW.smallText + FOOTPRINT_ESTIMATE.lineSlack;
	const slotW = math.max(0, props.width - NEW_BEST_DRAW.labelSlotWidth - HUD_VIEW.gap);
	const stroke = role("background");
	const U = NEW_BEST_UI;
	return (
		<frame key="LabelRow" LayoutOrder={props.order} Size={new UDim2(1, 0, 0, h)} BackgroundTransparency={HIDDEN}>
			<textlabel
				key="Label"
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				TextSize={HUD_VIEW.smallText}
				TextColor3={role("uiTextDim")}
				TextStrokeColor3={stroke}
				TextStrokeTransparency={HUD_VIEW.panelTransparency}
				TextXAlignment={Enum.TextXAlignment.Right}
				Text={str(HUD_STRINGS.score)}
			/>
			<textlabel
				key="Target"
				AnchorPoint={new Vector2(0, HALF)}
				Position={UDim2.fromScale(0, HALF)}
				Size={new UDim2(0, slotW, 1, 0)}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				TextScaled={true}
				TextSize={HUD_VIEW.smallText}
				TextColor3={U.rowColor.binding}
				TextStrokeColor3={stroke}
				TextStrokeTransparency={HUD_VIEW.panelTransparency}
				TextXAlignment={Enum.TextXAlignment.Left}
				TextYAlignment={Enum.TextYAlignment.Center}
				Text={U.rowText.binding}
			>
				<uiscale Scale={U.rowScale.binding} />
				<uitextsizeconstraint MaxTextSize={HUD_VIEW.smallText} />
			</textlabel>
		</frame>
	);
}

/**
 * The score panel's number (the rolling ROOM_CLEAR_UI.scoreText), sized exactly like the Text primitive it replaces
 * (`fill`: the parent's width; else sized to its text), drawn in uiText until the run's crossing, then lerped to the
 * newBest gold (NEW_BEST_UI.scoreGold: white flash -> gold, held for the rest of the run) with one shine sweep (a
 * uiText copy of the number seen through the combo's swept UIGradient band, NEW_BEST_UI.shine). `size`: the text size
 * (the panel's HUD_VIEW.bigText, the touch strip's own).
 */
export function ScoreNumber(props: {
	readonly order: number;
	readonly fill?: boolean;
	readonly size: number;
	readonly align?: Enum.TextXAlignment;
}) {
	const hudFont = useHudFont();
	const fill = props.fill === true;
	const align = props.align ?? Enum.TextXAlignment.Right;
	return (
		<textlabel
			key="ScoreNumber"
			LayoutOrder={props.order}
			Size={new UDim2(fill ? 1 : 0, 0, 0, props.size + FOOTPRINT_ESTIMATE.lineSlack)}
			AutomaticSize={fill ? Enum.AutomaticSize.None : Enum.AutomaticSize.X}
			BackgroundTransparency={HIDDEN}
			Font={hudFont}
			TextSize={props.size}
			TextColor3={SCORE_COLOR}
			TextStrokeColor3={role("background")}
			TextStrokeTransparency={HUD_VIEW.panelTransparency}
			TextXAlignment={align}
			Text={ROOM_CLEAR_UI.scoreText.binding}
		>
			<textlabel
				key="Shine"
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				TextSize={props.size}
				TextColor3={role("uiText")}
				TextStrokeTransparency={HIDDEN}
				TextXAlignment={align}
				Text={ROOM_CLEAR_UI.scoreText.binding}
				Visible={SHINE_VISIBLE}
				ZIndex={SHINE_Z}
			>
				<uigradient Transparency={shineBand()} Offset={SHINE_OFFSET} />
			</textlabel>
		</textlabel>
	);
}

/**
 * The touch strip's compact target line (docs/NEW_BEST.md NB6: `-12340` / `NEW BEST`, NEW_BEST_UI.compactText and
 * rowColor): a zero-height list item of the strip's score group whose label hangs NEW_BEST_DRAW.touchGap under the
 * combo line, `width` wide, right-aligned, TextScaled up to NEW_BEST_DRAW.touchText. It changes no size of the strip
 * (the score group's height is fixed; the label lies over the chips line's height, inside the strip's fade group).
 * Hidden while empty (a run without a target looks as before).
 */
export function BestCompactLine(props: { readonly order: number; readonly width: number }) {
	const hudFont = useHudFont();
	const U = NEW_BEST_UI;
	return (
		<frame
			key="BestLine"
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, 0)}
			BackgroundTransparency={HIDDEN}
			Visible={COMPACT_VISIBLE}
		>
			<textlabel
				key="Text"
				Position={UDim2.fromOffset(0, NEW_BEST_DRAW.touchGap)}
				Size={new UDim2(1, 0, 0, NEW_BEST_DRAW.touchText + FOOTPRINT_ESTIMATE.lineSlack)}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				TextScaled={true}
				TextSize={NEW_BEST_DRAW.touchText}
				TextColor3={U.rowColor.binding}
				TextStrokeColor3={role("background")}
				TextStrokeTransparency={HUD_VIEW.panelTransparency}
				TextXAlignment={Enum.TextXAlignment.Right}
				Text={U.compactText.binding}
			>
				<uitextsizeconstraint MaxTextSize={NEW_BEST_DRAW.touchText} />
			</textlabel>
		</frame>
	);
}
