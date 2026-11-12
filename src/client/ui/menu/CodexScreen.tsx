import React, { useEffect, useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import { selectCodexDoc, selectCodexProgress, selectCodexStatus, selectInputDevice } from "client/store";
import { FocusScope } from "client/ui/focus";
import { CodexArt, MenuButton, MenuFit, PadHintBar, Panel, Row, Text, type MenuLayout } from "client/ui/hud";
import { role, str } from "client/ui/theme";
import { CODEX_TABS, type CodexDoc, type CodexTab } from "shared/codex";
import { keyDevice } from "shared/play";
import { SFX } from "shared/view/audio";
import {
	CODEX_SCREEN,
	CODEX_SCREEN_STRINGS,
	CodexViewDwell,
	codexCompletionPct,
	codexDetail,
	codexGridColumns,
	codexGridGroups,
	codexGridIds,
	codexGridWidth,
	codexTabLabel,
	codexTabRowWidth,
	codexTabRows,
	codexTabScrollX,
	codexTabWidth,
	codexTileNew,
	type CodexDetailModel,
	type CodexTileModel,
} from "shared/view/codex";
import { BUILD_DUO_ROLE, HUD_VIEW } from "shared/view/hud";
import { MENU_BACK_HINT, MENU_STRINGS, MENU_VIEW, screenSkin, stepTab, tabStep } from "shared/view/menu";
import { useMenuActions } from "./actions";

const HIDDEN = 1;
const HALF = 0.5;
const STROKE = 1;
const FOCUS_STROKE = 2;
/** The tile art's inset from the tile's edge. */
const TILE_INSET = 4;
const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);
/** Draw order inside a tile: the art, the NEW dot. */
const TILE_Z = { art: 1, dot: 2 } as const;
/** The tab row's drawn-to-reference scale never divides by less (a frame not laid out yet reads 0). */
const MIN_TAB_SCALE = 1e-6;

/** The layout's sizes (reference px): the panel, the grid's width and columns, the detail's width. */
interface CodexLayoutSizes {
	readonly width: number;
	readonly gridWidth: number;
	readonly columns: number;
	readonly detailWidth: number;
	readonly narrow: boolean;
}

function sizesOf(layout: MenuLayout): CodexLayoutSizes {
	const S = CODEX_SCREEN;
	if (layout.narrow) {
		const inner = S.narrowWidth - 2 * S.pad;
		return {
			width: S.narrowWidth,
			gridWidth: inner,
			columns: codexGridColumns(inner, 1),
			detailWidth: inner,
			narrow: true,
		};
	}
	const width = layout.compact ? S.compactWidth : S.width;
	const grid = layout.compact ? S.compactGridWidth : S.gridWidth;
	return {
		width,
		gridWidth: grid,
		columns: codexGridColumns(grid, 1),
		detailWidth: width - 2 * S.pad - grid - S.detailGap,
		narrow: false,
	};
}

/** A small uiAccent dot in a corner (a tile's or a tab's NEW). */
function NewDot(props: { zIndex?: number }) {
	const S = CODEX_SCREEN;
	return (
		<frame
			key="NewDot"
			AnchorPoint={new Vector2(1, 0)}
			Position={new UDim2(1, -S.dotInset, 0, S.dotInset)}
			Size={UDim2.fromOffset(S.dot, S.dot)}
			BackgroundColor3={role("uiAccent")}
			BorderSizePixel={0}
			Active={false}
			ZIndex={props.zIndex ?? TILE_Z.dot}
		>
			<uicorner CornerRadius={new UDim(HALF, 0)} />
		</frame>
	);
}

/** The grid's tile callbacks: focus (hover, pad selection; viewed after the dwell), blur, activation (viewed now). */
interface TileHandlers {
	readonly onFocus: (id: string) => void;
	readonly onBlur: (id: string) => void;
	readonly onActivate: (id: string) => void;
}

/** One tile of the grid: a selectable square with the entry's art, focus ring and NEW dot. */
function Tile(props: {
	tile: CodexTileModel;
	order: number;
	focused: boolean;
	isNew: boolean;
	handlers: TileHandlers;
	tileRef?: React.Ref<TextButton>;
}) {
	const t = props.tile;
	const art = CODEX_SCREEN.tile - 2 * TILE_INSET;
	return (
		<textbutton
			ref={props.tileRef}
			key={t.id}
			LayoutOrder={props.order}
			AutoButtonColor={false}
			Selectable={true}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
			Text=""
			Event={{
				Activated: () => props.handlers.onActivate(t.id),
				MouseEnter: () => props.handlers.onFocus(t.id),
				MouseLeave: () => props.handlers.onBlur(t.id),
				SelectionGained: () => props.handlers.onFocus(t.id),
				SelectionLost: () => props.handlers.onBlur(t.id),
			}}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={props.focused ? FOCUS_STROKE : STROKE}
				Color={role(props.focused ? "uiAccent" : "uiTextDim")}
			/>
			<frame
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromOffset(art, art)}
				BackgroundTransparency={HIDDEN}
				Active={false}
			>
				<CodexArt id={t.id} state={t.state} box={art} zIndex={TILE_Z.art} />
			</frame>
			{props.isNew ? <NewDot /> : undefined}
		</textbutton>
	);
}

/** The grid of a tab: each group's sub-header (multi-group tabs) and its tiles in rows of `columns`. */
function Grid(props: {
	tab: CodexTab;
	doc: CodexDoc | undefined;
	viewed: ReadonlySet<string>;
	focusId: string | undefined;
	sizes: CodexLayoutSizes;
	height: number;
	handlers: TileHandlers;
	gridRef: React.Ref<ScrollingFrame>;
	firstRef: React.Ref<TextButton>;
	order: number;
}) {
	const S = CODEX_SCREEN;
	const groups = codexGridGroups(props.tab, props.doc, props.viewed);
	const width = codexGridWidth(props.sizes.columns);
	const parts = new Array<React.Element>();
	let first = true;
	groups.forEach((g, gi) => {
		if (g.headerKey !== undefined) {
			parts.push(
				<Text
					key={`h${gi}`}
					order={gi * 2 + 1}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					text={str(g.headerKey)}
				/>,
			);
		}
		const tiles = g.tiles.map((t, i) => {
			const ref = first ? props.firstRef : undefined;
			first = false;
			return (
				<Tile
					key={t.id}
					tile={t}
					order={i + 1}
					focused={props.focusId === t.id}
					isNew={t.isNew}
					handlers={props.handlers}
					tileRef={ref}
				/>
			);
		});
		parts.push(
			<frame
				key={`g${gi}`}
				LayoutOrder={gi * 2 + 2}
				Size={new UDim2(0, width, 0, 0)}
				AutomaticSize={Enum.AutomaticSize.Y}
				BackgroundTransparency={HIDDEN}
			>
				<uigridlayout
					CellSize={UDim2.fromOffset(S.tile, S.tile)}
					CellPadding={UDim2.fromOffset(S.tileGap, S.tileGap)}
					FillDirectionMaxCells={props.sizes.columns}
					SortOrder={Enum.SortOrder.LayoutOrder}
				/>
				{tiles}
			</frame>,
		);
	});
	return (
		<scrollingframe
			ref={props.gridRef}
			LayoutOrder={props.order}
			Size={new UDim2(0, props.sizes.gridWidth, 0, props.height)}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
			CanvasSize={new UDim2()}
			AutomaticCanvasSize={Enum.AutomaticSize.Y}
			ScrollingDirection={Enum.ScrollingDirection.Y}
			ScrollBarThickness={S.scrollBar}
			ScrollBarImageColor3={role("uiTextDim")}
			Selectable={false}
		>
			<uipadding PaddingTop={new UDim(0, FOCUS_STROKE)} PaddingLeft={new UDim(0, FOCUS_STROKE)} />
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{parts}
		</scrollingframe>
	);
}

/** A duo's boon in the detail: a chip with its name (`???` while unknown). */
function BoonChip(props: { order: number; name: string; known: boolean }) {
	const C = CODEX_SCREEN.chip;
	return (
		<frame
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(C.w, C.h)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role(props.known ? BUILD_DUO_ROLE : "uiTextDim")} />
			<Text
				fill={true}
				size={HUD_VIEW.smallText}
				color={props.known ? "uiText" : "uiTextDim"}
				align={Enum.TextXAlignment.Center}
				text={props.name}
			/>
		</frame>
	);
}

/** The detail panel (beside the grid) or sheet (under it, upright): art, name, kind, text, duo boons, state. */
function Detail(props: {
	detail: CodexDetailModel | undefined;
	sizes: CodexLayoutSizes;
	height: number;
	order: number;
}) {
	const S = CODEX_SCREEN;
	const d = props.detail;
	const art = props.sizes.narrow ? S.sheetArtBox : S.artBox;
	const lines = new Array<React.Element>();
	if (d !== undefined) {
		lines.push(<CodexArt key="Art" order={1} id={d.id} state={d.state} box={art} />);
		lines.push(
			<Text key="Name" order={2} wrap={true} size={HUD_VIEW.titleText} color={d.nameRole} text={d.name} />,
		);
		if (d.kind !== undefined) {
			lines.push(
				<Text key="Kind" order={3} fill={true} size={HUD_VIEW.smallText} color="uiTextDim" text={d.kind} />,
			);
		}
		if (d.requires !== undefined) {
			lines.push(
				<Text
					key="Requires"
					order={4}
					fill={true}
					size={HUD_VIEW.smallText}
					color="uiAccent"
					text={d.requires}
				/>,
			);
		}
		lines.push(
			<Text
				key="Body"
				order={5}
				wrap={true}
				size={HUD_VIEW.smallText}
				color={d.bodyIsHint ? "uiTextDim" : "uiText"}
				text={d.body}
			/>,
		);
		if (d.duo !== undefined) {
			lines.push(
				<Row key="Duo" order={6}>
					{d.duo.map((b, i) => (
						<BoonChip key={`b${i}`} order={i + 1} name={b.name} known={b.known} />
					))}
				</Row>,
			);
		}
		if (d.status !== undefined) {
			lines.push(
				<Text key="Status" order={7} wrap={true} size={HUD_VIEW.smallText} color="uiTextDim" text={d.status} />,
			);
		}
	}
	return (
		<scrollingframe
			LayoutOrder={props.order}
			Size={new UDim2(0, props.sizes.detailWidth, 0, props.height)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
			CanvasSize={new UDim2()}
			AutomaticCanvasSize={Enum.AutomaticSize.Y}
			ScrollingDirection={Enum.ScrollingDirection.Y}
			ScrollBarThickness={S.scrollBar}
			ScrollBarImageColor3={role("uiTextDim")}
			Selectable={false}
		>
			<uipadding
				PaddingLeft={new UDim(0, HUD_VIEW.pad)}
				PaddingRight={new UDim(0, HUD_VIEW.pad)}
				PaddingTop={new UDim(0, HUD_VIEW.pad)}
				PaddingBottom={new UDim(0, HUD_VIEW.pad)}
			/>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Left}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{lines}
		</scrollingframe>
	);
}

/** The completion line beside the title: `41%` and its bar (or the unavailable line). */
function Completion(props: { order: number; found: number; total: number; unavailable: boolean }) {
	const B = CODEX_SCREEN.bar;
	if (props.unavailable) {
		return (
			<Text
				order={props.order}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				text={str(CODEX_SCREEN_STRINGS.unavailable)}
			/>
		);
	}
	const pct = codexCompletionPct(props.found, props.total);
	return (
		<Row order={props.order}>
			<Text
				order={1}
				size={HUD_VIEW.textSize}
				color="uiAccent"
				text={str(CODEX_SCREEN_STRINGS.completion, { pct })}
			/>
			<frame
				LayoutOrder={2}
				Size={UDim2.fromOffset(B.w, B.h)}
				BackgroundColor3={role("uiPanel")}
				BorderSizePixel={0}
			>
				<uistroke Thickness={STROKE} Color={role("uiTextDim")} />
				<frame
					Size={UDim2.fromScale(props.total > 0 ? props.found / props.total : 0, 1)}
					BackgroundColor3={role("uiAccent")}
					BorderSizePixel={0}
				/>
			</frame>
		</Row>
	);
}

/**
 * The Codex screen (main menu > Codex; claude/codex-plan.md "Main menu and the Codex screen", CX7; rules in
 * shared/view/codex screen.ts): the title with the completion % and bar, the tab row (each tab's `found / total` and a
 * NEW dot; it scrolls when the panel is narrower), the grid of the tab's tiles (sub-headers in the items tab and the
 * Bestiary; unknown `?` / silhouettes, seen faded, found in full; a NEW dot until the tile is viewed) and the detail
 * of the focused tile beside it (upright: a sheet under it), then Back and its key hint. Built like the Credits
 * screen: a `screen` focus scope (docs/GAMEPAD_MENUS.md GM2) whose pad starts on the first tile, LB / RB step the tabs
 * (clamped, silent at the ends), the right stick scrolls the grid, B goes back. A tap, a click, the mouse over a tile
 * or the pad's selection focuses it; a tile counts as viewed (its dot clears) on activation (click, tap, A) or once it
 * held the focus for CODEX_SCREEN.viewDwellSeconds (CodexViewDwell: the default selection on open included), never by
 * passing over it. Fitted into the safe area on touch (MenuFit: the grid is the flexible part).
 * Closing it sends the entries whose NEW dots this visit cleared (MenuActions.codexViewed), so the badge drops.
 */
export function CodexScreen() {
	const actions = useMenuActions();
	const device = useSelector(selectInputDevice);
	const doc = useSelector(selectCodexDoc);
	const status = useSelector(selectCodexStatus);
	const progress = useSelector(selectCodexProgress);
	const [tab, setTab] = useState<CodexTab>(CODEX_TABS[0]);
	const [focusId, setFocusId] = useState<string | undefined>(undefined);
	const [, setViewedVersion] = useState(0);
	const viewedRef = useRef(new Set<string>());
	const docRef = useRef(doc);
	docRef.current = doc;
	const backRef = useRef<TextButton>();
	const firstRef = useRef<TextButton>();
	const gridRef = useRef<ScrollingFrame>();
	const tabRowRef = useRef<ScrollingFrame>();
	const tabViewRef = useRef(0);

	// Leaving the screen: the dots this visit cleared go to the server (and the store's copy, so the badge drops).
	useEffect(() => {
		return () => {
			const ids = new Array<string>();
			for (const id of viewedRef.current) ids.push(id);
			if (ids.size() > 0) actions.codexViewed(ids);
		};
	}, []);

	const dwellRef = useRef(new CodexViewDwell());
	const viewed = viewedRef.current;
	const markViewed = (id: string) => {
		if (codexTileNew(docRef.current, id, viewedRef.current)) {
			viewedRef.current.add(id);
			setViewedVersion((v) => v + 1);
		}
	};
	// A focused tile counts as viewed once it held the focus for the dwell (checked every frame).
	useEffect(() => {
		const connection = RunService.Heartbeat.Connect(() => {
			const id = dwellRef.current.due(os.clock());
			if (id !== undefined) markViewed(id);
		});
		return () => connection.Disconnect();
	}, []);
	const handlers: TileHandlers = {
		onFocus: (id) => {
			setFocusId(id);
			dwellRef.current.focus(id, os.clock());
		},
		onBlur: (id) => dwellRef.current.blur(id),
		onActivate: (id) => {
			setFocusId(id);
			markViewed(dwellRef.current.activate(id));
		},
	};
	const scrollTabsTo = (t: CodexTab) => {
		const row = tabRowRef.current;
		const view = tabViewRef.current;
		if (row === undefined || !(view > 0)) return;
		// Reference px -> the frame's own px (its UIScale and the fit factor), from the drawn window's width.
		const scale = row.AbsoluteWindowSize.X / view;
		const x = codexTabScrollX(t, HUD_VIEW.gap, view, row.CanvasPosition.X / math.max(scale, MIN_TAB_SCALE));
		row.CanvasPosition = new Vector2(x * scale, 0);
	};
	const showTab = (t: CodexTab) => {
		if (t === tab) return;
		actions.playUi(SFX.uiClick);
		setTab(t);
		setFocusId(undefined);
		dwellRef.current.blur();
		const grid = gridRef.current;
		if (grid !== undefined) grid.CanvasPosition = Vector2.zero;
		scrollTabsTo(t);
	};
	const padContext = { scrollList: true };
	const rows = codexTabRows(doc, viewed);
	const detailId = focusId ?? codexGridIds(tab)[0];
	const detail = detailId !== undefined ? codexDetail(detailId, doc, str) : undefined;
	const S = CODEX_SCREEN;
	return (
		<FocusScope
			name="CodexScope"
			id="codex"
			layer="screen"
			surface="codex"
			defaultRef={firstRef}
			padContext={padContext}
			scrollRef={gridRef}
			onPadAction={(action) => {
				if (action.kind === "back") {
					actions.screenBack();
					return;
				}
				// Clamped at the ends, silent there (padNav stepTab).
				const nextTab = stepTab(CODEX_TABS, tab, tabStep(action));
				if (nextTab !== undefined) showTab(nextTab);
			}}
		>
			<MenuFit
				flex={{ min: S.gridMin, max: S.gridHeight }}
				render={(layout) => {
					const sizes = sizesOf(layout);
					const inner = sizes.width - 2 * S.pad;
					tabViewRef.current = inner;
					const tabs = rows.map((r, i) => (
						<frame
							key={r.tab}
							LayoutOrder={i + 1}
							Size={UDim2.fromOffset(codexTabWidth(r.tab), S.tab.h)}
							BackgroundTransparency={HIDDEN}
						>
							<MenuButton
								order={1}
								name={`Tab_${r.tab}`}
								size={new Vector2(codexTabWidth(r.tab), S.tab.h)}
								textSize={HUD_VIEW.smallText}
								text={codexTabLabel(r, str)}
								active={r.tab === tab}
								onActivated={() => showTab(r.tab)}
							/>
							{r.isNew ? <NewDot zIndex={MENU_VIEW.buttonBadge.zIndex} /> : undefined}
						</frame>
					));
					const grid = (
						<Grid
							key="Grid"
							order={1}
							tab={tab}
							doc={doc}
							viewed={viewed}
							focusId={detailId}
							sizes={sizes}
							height={layout.flex}
							handlers={handlers}
							gridRef={gridRef}
							firstRef={firstRef}
						/>
					);
					return (
						<Panel width={sizes.width} padding={S.pad} skin={screenSkin("codex")} name="Codex">
							<Row key="Header" order={1}>
								<Text
									order={1}
									size={HUD_VIEW.titleText}
									color="uiAccent"
									text={str(CODEX_SCREEN_STRINGS.title)}
								/>
								<Completion
									order={2}
									found={progress.all.found}
									total={progress.all.total}
									unavailable={status === "unavailable"}
								/>
							</Row>
							<scrollingframe
								key="Tabs"
								ref={tabRowRef}
								LayoutOrder={2}
								Size={
									new UDim2(
										0,
										inner,
										0,
										S.tab.h + (codexTabRowWidth(HUD_VIEW.gap) > inner ? S.scrollBar : 0),
									)
								}
								BackgroundTransparency={HIDDEN}
								BorderSizePixel={0}
								CanvasSize={new UDim2()}
								AutomaticCanvasSize={Enum.AutomaticSize.X}
								ScrollingDirection={Enum.ScrollingDirection.X}
								ScrollBarThickness={S.scrollBar}
								ScrollBarImageColor3={role("uiTextDim")}
								Selectable={false}
							>
								<uilistlayout
									FillDirection={Enum.FillDirection.Horizontal}
									SortOrder={Enum.SortOrder.LayoutOrder}
									Padding={new UDim(0, HUD_VIEW.gap)}
								/>
								{tabs}
							</scrollingframe>
							{sizes.narrow ? (
								<frame
									key="Body"
									LayoutOrder={3}
									Size={new UDim2()}
									AutomaticSize={Enum.AutomaticSize.XY}
									BackgroundTransparency={HIDDEN}
								>
									<uilistlayout
										FillDirection={Enum.FillDirection.Vertical}
										SortOrder={Enum.SortOrder.LayoutOrder}
										Padding={new UDim(0, S.detailGap)}
									/>
									{grid}
									<Detail
										key="Detail"
										order={2}
										detail={detail}
										sizes={sizes}
										height={S.sheetHeight}
									/>
								</frame>
							) : (
								<frame
									key="Body"
									LayoutOrder={3}
									Size={new UDim2()}
									AutomaticSize={Enum.AutomaticSize.XY}
									BackgroundTransparency={HIDDEN}
								>
									<uilistlayout
										FillDirection={Enum.FillDirection.Horizontal}
										SortOrder={Enum.SortOrder.LayoutOrder}
										Padding={new UDim(0, S.detailGap)}
									/>
									{grid}
									<Detail key="Detail" order={2} detail={detail} sizes={sizes} height={layout.flex} />
								</frame>
							)}
							<Row key="Back" order={4} align={Enum.HorizontalAlignment.Center}>
								<MenuButton
									ref={backRef}
									order={1}
									name="Back"
									size={SMALL}
									textSize={HUD_VIEW.smallText}
									text={str(MENU_STRINGS.back)}
									onActivated={() => {
										actions.playUi(SFX.uiBack);
										actions.back();
									}}
								/>
							</Row>
							{device === "gamepad" ? (
								<PadHintBar key="PadHints" order={5} surface="codex" context={padContext} />
							) : device === "touch" ? undefined : (
								<Text
									key="BackHint"
									fill={true}
									order={5}
									size={HUD_VIEW.smallText}
									color="uiTextDim"
									align={Enum.TextXAlignment.Center}
									text={str(MENU_STRINGS.backHint, { key: MENU_BACK_HINT[keyDevice(device)] })}
								/>
							)}
						</Panel>
					);
				}}
			/>
		</FocusScope>
	);
}
