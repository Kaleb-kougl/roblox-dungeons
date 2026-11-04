import React from "@rbxts/react";
import { role, str, useHudFont } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import {
	HUD_VIEW,
	RECAP_STRINGS,
	RECAP_UI,
	recapGridSize,
	type RecapButtonSize,
	type RecapHighlight,
} from "shared/view/hud";
import { useHudActions } from "./actions";
import { MenuButton } from "./primitives";
import { RECAP_BINDINGS } from "./recapBindings";

const HIDDEN = 1;
const FULL = 1;

/** A text fade's stroke: never more opaque than the HUD's text stroke. */
function strokeFor(t: number): number {
	return math.max(t, HUD_VIEW.panelTransparency);
}

/** A cell's tile fades with its text: RECAP_UI.cellTransparency when shown, hidden before. */
function tileFor(t: number): number {
	return 1 - (1 - RECAP_UI.cellTransparency) * (1 - t);
}

/**
 * The near-miss line (docs/RUN_RECAP.md RR5, "so close"): one TextScaled line in ember (warm, not alarm; RRD9: no new
 * role), its text and fade the RECAP_BINDINGS RecapController writes (the number counts up). `dim`: a record run's
 * sub-line under new best's rows, smaller (its fade includes RECAP_UI.dimTransparency). It replaces new best's dim
 * `Best ...` line while it shows (BestBlock `hideTarget`).
 */
export function NearMissLine(props: { order: number; dim: boolean; width?: number }) {
	const font = useHudFont();
	const N = RECAP_UI.nearMiss;
	const h = props.dim ? N.dimHeight : N.height;
	const fade = RECAP_BINDINGS.nearMissTransparency.binding;
	return (
		<textlabel
			key="NearMiss"
			LayoutOrder={props.order}
			Size={props.width !== undefined ? new UDim2(0, props.width, 0, h) : new UDim2(FULL, 0, 0, h)}
			BackgroundTransparency={HIDDEN}
			Font={font}
			TextScaled={true}
			TextSize={props.dim ? N.dimText : N.text}
			TextColor3={role("ember")}
			TextStrokeColor3={role("background")}
			TextTransparency={fade}
			TextStrokeTransparency={fade.map(strokeFor)}
			TextXAlignment={Enum.TextXAlignment.Center}
			Text={RECAP_BINDINGS.nearMissText.binding}
		>
			<uitextsizeconstraint
				MaxTextSize={props.dim ? N.dimText : N.text}
				MinTextSize={props.dim ? N.dimMinText : N.minText}
			/>
		</textlabel>
	);
}

/** The co-op scope chip (`Team` / `You`) at a cell label's right end. */
function ScopeChip(props: { scope: "team" | "you"; fade: React.Binding<number> }) {
	const font = useHudFont();
	const C = RECAP_UI.chip;
	return (
		<textlabel
			key="Scope"
			AnchorPoint={new Vector2(1, 0)}
			Position={UDim2.fromScale(1, 0)}
			Size={UDim2.fromOffset(C.w, C.h)}
			BackgroundColor3={role(props.scope === "you" ? "uiAccent" : "uiTextDim")}
			BackgroundTransparency={props.fade.map(tileFor)}
			BorderSizePixel={0}
			Font={font}
			TextScaled={true}
			TextSize={C.text}
			TextColor3={role("background")}
			TextTransparency={props.fade}
			TextXAlignment={Enum.TextXAlignment.Center}
			Text={str(props.scope === "you" ? RECAP_STRINGS.you : RECAP_STRINGS.team)}
		>
			<uitextsizeconstraint MaxTextSize={C.text} MinTextSize={C.minText} />
		</textlabel>
	);
}

/** One highlight cell: the label (and the co-op chip) over the counted value. */
function HighlightCell(props: { index: number; cell: RecapHighlight }) {
	const font = useHudFont();
	const U = RECAP_UI;
	const fade = RECAP_BINDINGS.cellTransparency[props.index].binding;
	const value = RECAP_BINDINGS.cellValue[props.index].binding;
	const scope = props.cell.scope;
	const labelW = U.cellWidth - 2 * HUD_VIEW.gap - (scope !== undefined ? U.chip.w + HUD_VIEW.gap : 0);
	// The combo's tier name is tinted inside the RichText value (recapHighlightValue); its number stays uiText.
	const valueRole: ColorRole = "uiText";
	return (
		<frame
			key={`Cell${props.index}`}
			LayoutOrder={props.index + 1}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={fade.map(tileFor)}
			BorderSizePixel={0}
		>
			<uipadding
				PaddingLeft={new UDim(0, HUD_VIEW.gap)}
				PaddingRight={new UDim(0, HUD_VIEW.gap)}
				PaddingTop={new UDim(0, (U.cellHeight - U.labelHeight - U.valueHeight) / 2)}
			/>
			<textlabel
				key="Label"
				Size={UDim2.fromOffset(labelW, U.labelHeight)}
				BackgroundTransparency={HIDDEN}
				Font={font}
				TextScaled={true}
				TextSize={U.labelText}
				TextColor3={role("uiTextDim")}
				TextStrokeColor3={role("background")}
				TextTransparency={fade}
				TextStrokeTransparency={fade.map(strokeFor)}
				TextXAlignment={Enum.TextXAlignment.Left}
				Text={str(props.cell.key)}
			>
				<uitextsizeconstraint MaxTextSize={U.labelText} MinTextSize={U.labelMinText} />
			</textlabel>
			{scope !== undefined ? <ScopeChip scope={scope} fade={fade} /> : undefined}
			<textlabel
				key="Value"
				Position={UDim2.fromOffset(0, U.labelHeight)}
				Size={new UDim2(FULL, 0, 0, U.valueHeight)}
				BackgroundTransparency={HIDDEN}
				Font={font}
				RichText={true}
				TextScaled={true}
				TextSize={U.valueText}
				TextColor3={role(valueRole)}
				TextStrokeColor3={role("background")}
				TextTransparency={fade}
				TextStrokeTransparency={fade.map(strokeFor)}
				TextXAlignment={Enum.TextXAlignment.Left}
				Text={value}
			>
				<uitextsizeconstraint MaxTextSize={U.valueText} MinTextSize={U.valueMinText} />
			</textlabel>
		</frame>
	);
}

/**
 * The highlights (docs/RUN_RECAP.md RR5, RRD4): up to four cells, two a row (RECAP_UI: the score breakdown's width, so
 * the grid takes its place; Details swaps them), each a label (TextScaled with a minimum size, so a long translation
 * shrinks), the co-op `Team` / `You` chip and the counted value (the best combo's tier name in the tier's colour).
 * Cells fade up one by one as RecapController's timeline reaches them.
 */
export function HighlightGrid(props: { order: number; cells: ReadonlyArray<RecapHighlight> }) {
	const size = recapGridSize(props.cells.size(), HUD_VIEW.gap);
	return (
		<frame
			key="Highlights"
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(size.w, size.h)}
			BackgroundTransparency={HIDDEN}
		>
			<uigridlayout
				CellSize={UDim2.fromOffset(RECAP_UI.cellWidth, RECAP_UI.cellHeight)}
				CellPadding={UDim2.fromOffset(HUD_VIEW.gap, HUD_VIEW.gap)}
				FillDirection={Enum.FillDirection.Horizontal}
				FillDirectionMaxCells={RECAP_UI.columns}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{props.cells.map((cell, i) => (
				<HighlightCell key={`Cell${i}`} index={i} cell={cell} />
			))}
		</frame>
	);
}

/**
 * The Details toggle in the exits row (docs/RUN_RECAP.md RRD5): `Details` shows the score breakdown and the Build list
 * in the highlights' place, `Highlights` brings them back (HudActions.toggleRecapDetails).
 */
export function DetailsToggle(props: { order: number; details: boolean; size: RecapButtonSize; textSize: number }) {
	const actions = useHudActions();
	return (
		<MenuButton
			order={props.order}
			name="Details"
			size={new Vector2(props.size.x, props.size.y)}
			textSize={props.textSize}
			text={str(props.details ? RECAP_STRINGS.detailsHide : RECAP_STRINGS.details)}
			onActivated={() => actions.toggleRecapDetails()}
		/>
	);
}
