import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectCodexRunSummary } from "client/store";
import { str } from "client/ui/theme";
import { CODEX_RECAP, codexRecapRow, codexRecapRowLines } from "shared/view/codex";
import { HUD_VIEW, type RecapLayout } from "shared/view/hud";
import { CodexArt } from "./CodexArt";
import { Row, Text } from "./primitives";

const HIDDEN = 1;

/**
 * The run-over panel's Codex row (claude/codex-plan.md "Run over", CX9, R12; shared/view/codex codexRecapRow): `3 new
 * in the Codex`, up to CODEX.recapIcons tile icons of this run's first-ever finds (found order, rarest first on one
 * frame), `+N`, then `Codex 41%`. Read from the store's frozen run summary (CodexController at run over / leave);
 * nothing when the run found nothing new, the Codex is not loaded or the run could not claim. One line on the wide
 * panel and a landscape phone's left column; upright the count and the total, the icons under them. Silent; no timing of its own.
 */
export function CodexRunRow(props: { order: number; layout: RecapLayout; gap: number }) {
	const summary = useSelector(selectCodexRunSummary);
	const row = codexRecapRow(summary, str);
	if (row === undefined) return undefined;
	const R = CODEX_RECAP;
	const count = <Text key="Count" order={1} size={HUD_VIEW.smallText} color="uiAccent" text={row.countText} />;
	const total = <Text key="Total" order={4} size={HUD_VIEW.smallText} color="uiTextDim" text={row.totalText} />;
	const icons = (
		<frame
			key="Icons"
			LayoutOrder={2}
			Size={new UDim2()}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, R.iconGap)}
			/>
			{row.icons.map((id, i) => (
				<CodexArt key={id} order={i + 1} id={id} state="found" box={R.iconBox} />
			))}
		</frame>
	);
	const more =
		row.moreText !== undefined ? (
			<Text key="More" order={3} size={HUD_VIEW.smallText} color="uiTextDim" text={row.moreText} />
		) : undefined;
	if (codexRecapRowLines(props.layout) === 1) {
		return (
			<Row key="CodexRow" order={props.order} align={Enum.HorizontalAlignment.Center}>
				{count}
				{icons}
				{more}
				{total}
			</Row>
		);
	}
	return (
		<frame
			key="CodexRow"
			LayoutOrder={props.order}
			Size={new UDim2()}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, props.gap)}
			/>
			<Row key="Text" order={1} align={Enum.HorizontalAlignment.Center}>
				{count}
				{total}
			</Row>
			<Row key="Strip" order={2} align={Enum.HorizontalAlignment.Center}>
				{icons}
				{more}
			</Row>
		</frame>
	);
}
