import React from "@rbxts/react";
import { role, str, useHudFont, useNameFont } from "client/ui/theme";
import {
	CONTRIB,
	CONTRIB_PARTY_COLUMNS,
	CONTRIB_UI,
	HUD_VIEW,
	RECAP_TABS,
	contribBoxHeight,
	contribBoxWidth,
	contribCardHeight,
	contribCellMetrics,
	contribCellRows,
	contribHeaderText,
	contribPartyHeight,
	contribPartyTexts,
	contribShareBarShown,
	contribShareSegments,
	contribShareText,
	contribStandingLine,
	contribTabsSize,
	recapTabKey,
	type ContributionRow,
	type RecapHighlight,
	type RecapLayout,
	type RecapTab,
	type RunContribution,
} from "shared/view/hud";
import { useHudActions } from "./actions";
import { MenuButton } from "./primitives";
import { HighlightGrid, RecapCell } from "./RecapBlocks";
import { RECAP_BINDINGS } from "./recapBindings";

const HIDDEN = 1;
const FULL = 1;
const HALF = 0.5;

/** A one-line TextScaled label (the card's header, share label, standing line, the Party rows' cells). */
function Line(props: {
	name: string;
	order?: number;
	position?: UDim2;
	size: UDim2;
	text: string;
	textSize: number;
	minText: number;
	color?: "uiText" | "uiTextDim" | "uiAccent" | "background";
	align?: Enum.TextXAlignment;
	transparency?: number;
	font?: Enum.Font;
}) {
	const hudFont = useHudFont();
	const t = props.transparency ?? 0;
	return (
		<textlabel
			key={props.name}
			LayoutOrder={props.order ?? 0}
			Position={props.position ?? new UDim2()}
			Size={props.size}
			BackgroundTransparency={HIDDEN}
			Font={props.font ?? hudFont}
			TextScaled={true}
			TextSize={props.textSize}
			TextColor3={role(props.color ?? "uiText")}
			TextStrokeColor3={role("background")}
			TextTransparency={t}
			TextStrokeTransparency={math.max(t, HUD_VIEW.panelTransparency)}
			TextXAlignment={props.align ?? Enum.TextXAlignment.Left}
			Text={props.text}
		>
			<uitextsizeconstraint MaxTextSize={props.textSize} MinTextSize={props.minText} />
		</textlabel>
	);
}

/**
 * The `You | Team | Party` tab strip (docs/RUN_CONTRIBUTION.md CT5), party runs only: three buttons, the shown tab
 * `active`. Mouse and touch tap them (HudActions.setRecapTab); the pad steps them with LB / RB and never selects them
 * (`selectable` false: the pad's selection stays on the exits row, so Back to lobby is always one move away), the
 * keyboard with Q / E / Tab (RecapController).
 */
export function RecapTabStrip(props: { order: number; layout: RecapLayout; tab: RecapTab }) {
	const actions = useHudActions();
	const t = CONTRIB_UI.tabs[props.layout];
	const size = contribTabsSize(props.layout, HUD_VIEW.gap);
	return (
		<frame
			key="RecapTabs"
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(size.w, size.h)}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{RECAP_TABS.map((tab, i) => (
				<MenuButton
					key={`Tab_${tab}`}
					order={i + 1}
					name={`Tab_${tab}`}
					size={new Vector2(t.w, t.h)}
					textSize={t.text}
					selectable={false}
					active={tab === props.tab}
					text={str(recapTabKey(tab))}
					onActivated={() => actions.setRecapTab(tab)}
				/>
			))}
		</frame>
	);
}

/** The damage share bar itself: every player's share in index order, the local one bright (playerOutline), no names. */
function Bar(props: { layout: RecapLayout; c: RunContribution; position: UDim2; anchor: Vector2 }) {
	const L = CONTRIB_UI.card[props.layout];
	const segments = contribShareSegments(props.c.damageShares, props.c.local.index, L.barWidth, CONTRIB.shareTotal);
	return (
		<frame
			key="Bar"
			AnchorPoint={props.anchor}
			Position={props.position}
			Size={UDim2.fromOffset(L.barWidth, L.barHeight)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={CONTRIB_UI.barTrackTransparency}
			BorderSizePixel={0}
		>
			{segments.map((seg) => (
				<frame
					key={`Seg${seg.index}`}
					Position={UDim2.fromOffset(seg.x, 0)}
					Size={new UDim2(0, seg.w, FULL, 0)}
					BackgroundColor3={role(seg.local ? "playerOutline" : "uiTextDim")}
					BackgroundTransparency={seg.local ? 0 : CONTRIB_UI.barOtherTransparency}
					BorderSizePixel={0}
				/>
			))}
		</frame>
	);
}

/** The share row: the bar and its label (`41% of the team's damage`) beside it. */
function ShareRow(props: { layout: RecapLayout; c: RunContribution }) {
	const L = CONTRIB_UI.card[props.layout];
	const boxW = contribBoxWidth(props.layout);
	return (
		<frame key="Share" LayoutOrder={2} Size={UDim2.fromOffset(boxW, L.shareHeight)} BackgroundTransparency={HIDDEN}>
			<Bar layout={props.layout} c={props.c} position={UDim2.fromScale(0, HALF)} anchor={new Vector2(0, HALF)} />
			<Line
				name="ShareLabel"
				position={UDim2.fromOffset(L.barWidth + HUD_VIEW.gap, 0)}
				size={new UDim2(FULL, -(L.barWidth + HUD_VIEW.gap), FULL, 0)}
				text={contribShareText(props.c, str)}
				textSize={L.shareText}
				minText={L.shareMinText}
				color="uiTextDim"
			/>
		</frame>
	);
}

/**
 * The You card (docs/RUN_CONTRIBUTION.md You): `You · {title}`, the damage share bar (its own row with its label, or on
 * a landscape phone at the header row's right end), the cells (the highlight cell itself, four a row, on desktop; one
 * line, two a row, on a phone, a lone last one, the pickups line, as a full-width row) and the standing line. The cells'
 * counted values and fades are RECAP_BINDINGS.youValue / youTransparency (RecapController).
 */
export function YouCard(props: { order: number; layout: RecapLayout; c: RunContribution }) {
	const c = props.c;
	const L = CONTRIB_UI.card[props.layout];
	const M = contribCellMetrics(props.layout);
	const cells = c.youCells;
	const split = contribCellRows(cells.size(), props.layout);
	const boxW = contribBoxWidth(props.layout);
	const shareBar = contribShareBarShown(c);
	const gridRows = math.ceil(split.gridCells / split.columns);
	const gridH = gridRows > 0 ? gridRows * M.height + (gridRows - 1) * L.gap : 0;
	const barInHeader = shareBar && L.shareInHeader;
	const headerW = barInHeader ? boxW - L.barWidth - HUD_VIEW.gap : boxW;
	const cell = (i: number, width?: number) => (
		<RecapCell
			key={`Cell${i}`}
			index={i}
			labelKey={cells[i].labelKey}
			metrics={M}
			fade={RECAP_BINDINGS.youTransparency[i].binding}
			value={RECAP_BINDINGS.youValue[i].binding}
			width={width}
		/>
	);
	const grid = new Array<React.Element>();
	for (let i = 0; i < split.gridCells; i++) grid.push(cell(i));
	return (
		<frame
			key="YouCard"
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(boxW, contribCardHeight(cells.size(), shareBar, props.layout))}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, L.gap)}
			/>
			<frame
				key="HeaderRow"
				LayoutOrder={1}
				Size={UDim2.fromOffset(boxW, L.headerHeight)}
				BackgroundTransparency={HIDDEN}
			>
				<Line
					name="Header"
					size={UDim2.fromOffset(headerW, L.headerHeight)}
					text={contribHeaderText(c, str)}
					textSize={L.headerText}
					minText={L.headerMinText}
					color="uiAccent"
				/>
				{barInHeader ? (
					<Bar
						layout={props.layout}
						c={c}
						position={UDim2.fromScale(FULL, HALF)}
						anchor={new Vector2(FULL, HALF)}
					/>
				) : undefined}
			</frame>
			{shareBar && !L.shareInHeader ? <ShareRow layout={props.layout} c={c} /> : undefined}
			{split.gridCells > 0 ? (
				<frame key="Cells" LayoutOrder={3} Size={UDim2.fromOffset(boxW, gridH)} BackgroundTransparency={HIDDEN}>
					<uigridlayout
						CellSize={UDim2.fromOffset(M.width, M.height)}
						CellPadding={UDim2.fromOffset(HUD_VIEW.gap, L.gap)}
						FillDirection={Enum.FillDirection.Horizontal}
						FillDirectionMaxCells={split.columns}
						HorizontalAlignment={Enum.HorizontalAlignment.Left}
						SortOrder={Enum.SortOrder.LayoutOrder}
					/>
					{grid}
				</frame>
			) : undefined}
			{split.wideLast ? (
				<frame
					key="LastCell"
					LayoutOrder={4}
					Size={UDim2.fromOffset(boxW, M.height)}
					BackgroundTransparency={HIDDEN}
				>
					{cell(cells.size() - 1, boxW)}
				</frame>
			) : undefined}
			<Line
				name="Standing"
				order={5}
				size={UDim2.fromOffset(boxW, L.standingHeight)}
				text={contribStandingLine(c.local, str)}
				textSize={L.standingText}
				minText={L.standingMinText}
				color="uiTextDim"
			/>
		</frame>
	);
}

/** One Party row: name (the `name` font), title chip, damage share, kills, parries, hits; the local row outlined. */
function PartyRow(props: { layout: RecapLayout; row: ContributionRow }) {
	const P = CONTRIB_UI.party[props.layout];
	const nameFont = useNameFont();
	const hudFont = useHudFont();
	const r = props.row;
	const t = contribPartyTexts(r, str);
	const dim = r.left ? CONTRIB_UI.leftTransparency : 0;
	const gridW = contribBoxWidth(props.layout);
	const numbers = [t.damage, t.kills, t.parries, t.hits];
	return (
		<frame
			key={`Row${r.index}`}
			LayoutOrder={r.index + 1}
			Size={UDim2.fromOffset(gridW, P.rowHeight)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={r.local ? CONTRIB_UI.localTileTransparency : HIDDEN}
			BorderSizePixel={0}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, P.columnGap)}
			/>
			{r.local ? (
				<uistroke
					key="Local"
					ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
					Thickness={CONTRIB_UI.localStroke}
					Color={role("playerOutline")}
				/>
			) : undefined}
			<Line
				name="Name"
				order={1}
				size={UDim2.fromOffset(P.nameWidth, P.rowHeight)}
				text={t.name}
				textSize={P.text}
				minText={P.minText}
				transparency={dim}
				font={nameFont}
			/>
			<textlabel
				key="Title"
				LayoutOrder={2}
				Size={UDim2.fromOffset(P.titleWidth, P.rowHeight - 2 * P.gap)}
				BackgroundColor3={role("uiTextDim")}
				BackgroundTransparency={1 - (1 - CONTRIB_UI.chipTransparency) * (1 - dim)}
				BorderSizePixel={0}
				Font={hudFont}
				TextScaled={true}
				TextSize={P.headerText}
				TextColor3={role("background")}
				TextTransparency={dim}
				TextXAlignment={Enum.TextXAlignment.Center}
				Text={t.title}
			>
				<uitextsizeconstraint MaxTextSize={P.headerText} MinTextSize={P.headerMinText} />
			</textlabel>
			{numbers.map((text, i) => (
				<Line
					key={`N${i}`}
					name={`N${i}`}
					order={3 + i}
					size={UDim2.fromOffset(P.numberWidth, P.rowHeight)}
					text={text}
					textSize={P.text}
					minText={P.minText}
					align={Enum.TextXAlignment.Right}
					transparency={dim}
				/>
			))}
		</frame>
	);
}

/**
 * The Party tab (docs/RUN_CONTRIBUTION.md Party): a header row (the number columns' labels), then one row per player
 * in index order, never sorted (CTD4). The rows scroll inside the box (`height`) when they do not fit (5-8 players on
 * a phone): wheel, drag and the pad's right stick (`listRef` is the run-over scope's scrollRef).
 */
export function PartyRows(props: {
	order: number;
	layout: RecapLayout;
	c: RunContribution;
	height: number;
	listRef: React.Ref<ScrollingFrame>;
}) {
	const P = CONTRIB_UI.party[props.layout];
	const gridW = contribBoxWidth(props.layout);
	const listH = math.max(0, props.height - P.headerHeight - P.gap);
	const full = contribPartyHeight(props.c.rows.size(), props.layout) - P.headerHeight;
	return (
		<frame
			key="Party"
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(gridW, props.height)}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, P.gap)}
			/>
			<frame
				key="Header"
				LayoutOrder={1}
				Size={UDim2.fromOffset(gridW, P.headerHeight)}
				BackgroundTransparency={HIDDEN}
			>
				<uilistlayout
					FillDirection={Enum.FillDirection.Horizontal}
					HorizontalAlignment={Enum.HorizontalAlignment.Right}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, P.columnGap)}
				/>
				{CONTRIB_PARTY_COLUMNS.map((key, i) => (
					<Line
						key={`H${i}`}
						name={`H${i}`}
						order={i + 1}
						size={UDim2.fromOffset(P.numberWidth, P.headerHeight)}
						text={str(key)}
						textSize={P.headerText}
						minText={P.headerMinText}
						color="uiTextDim"
						align={Enum.TextXAlignment.Right}
					/>
				))}
			</frame>
			<scrollingframe
				key="Rows"
				ref={props.listRef}
				LayoutOrder={2}
				Size={UDim2.fromOffset(gridW, listH)}
				CanvasSize={new UDim2(0, 0, 0, 0)}
				AutomaticCanvasSize={Enum.AutomaticSize.Y}
				ScrollingDirection={Enum.ScrollingDirection.Y}
				ScrollBarThickness={full > listH ? CONTRIB_UI.scrollBarThickness : 0}
				ScrollBarImageColor3={role("uiTextDim")}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
				Selectable={false}
			>
				<uilistlayout
					FillDirection={Enum.FillDirection.Vertical}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, P.gap)}
				/>
				{props.c.rows.map((row) => (
					<PartyRow key={`Row${row.index}`} layout={props.layout} row={row} />
				))}
			</scrollingframe>
		</frame>
	);
}

/**
 * A party run's tab body (docs/RUN_CONTRIBUTION.md CT5) in the highlights' slot: the tab strip, then a box as tall as
 * the taller of the You card and the Team grid (contribBoxHeight: a tab switch never resizes the panel) holding the
 * shown tab: You (YouCard), Team (today's HighlightGrid) or Party (PartyRows, scrolling inside the box).
 */
export function RecapTabBody(props: {
	order: number;
	layout: RecapLayout;
	tab: RecapTab;
	c: RunContribution;
	highlights: ReadonlyArray<RecapHighlight>;
	gap: number;
	listRef: React.Ref<ScrollingFrame>;
}) {
	const gridW = contribBoxWidth(props.layout);
	const boxH = contribBoxHeight(props.c, props.highlights.size(), props.layout);
	const tabs = contribTabsSize(props.layout, HUD_VIEW.gap);
	const body =
		props.tab === "you" ? (
			<YouCard key="You" order={1} layout={props.layout} c={props.c} />
		) : props.tab === "team" ? (
			<HighlightGrid key="Highlights" order={1} cells={props.highlights} />
		) : (
			<PartyRows key="Party" order={1} layout={props.layout} c={props.c} height={boxH} listRef={props.listRef} />
		);
	return (
		<frame
			key="RecapTabBody"
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(gridW, tabs.h + props.gap + boxH)}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, props.gap)}
			/>
			<RecapTabStrip order={1} layout={props.layout} tab={props.tab} />
			<frame key="Box" LayoutOrder={2} Size={UDim2.fromOffset(gridW, boxH)} BackgroundTransparency={HIDDEN}>
				<uilistlayout
					FillDirection={Enum.FillDirection.Vertical}
					HorizontalAlignment={Enum.HorizontalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
				/>
				{body}
			</frame>
		</frame>
	);
}
