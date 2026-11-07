import React, { useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { Workspace } from "@rbxts/services";
import { selectInputDevice, selectSnapshot } from "client/store";
import { useHudFont, hudText, role, str } from "client/ui/theme";
import type { GameSnapshot } from "shared/play";
import { PORTRAIT } from "shared/view";
import {
	BUILD_HUD_VIEW,
	HUD_VIEW,
	OPTIONS_VIEW,
	PROGRESSION_STRINGS,
	buildListSections,
	pauseBuildWidth,
	type BuildListRow,
} from "shared/view/hud";
import { screenSkin } from "shared/view/menu";
import { Panel, Text } from "./primitives";
import { TooltipClipContext, useTooltipTarget } from "./tooltipTargets";
import { useHudScale } from "./useHudScale";

const HIDDEN = 1;
const HALF = 0.5;
/** A text row's box over its text size (primitives Text's line slack). */
const LINE_SLACK = 4;

/** One line of the list (a row or a section title), reference px. */
function lineHeight(): number {
	return HUD_VIEW.smallText + LINE_SLACK;
}

/**
 * One row: the name in its colour, the level, the line it has now (dim, truncated to the row; the tooltip has it
 * whole). A plain Frame registered as a `menu` tooltip target (hover, gamepad focus, tap; docs/ITEM_TOOLTIPS.md IT5)
 * and Selectable for the gamepad (never Active, never a button).
 */
function Row(props: { order: number; row: BuildListRow; width: number }) {
	const hudFont = useHudFont();
	const tipRef = useTooltipTarget(props.row.ref, "menu");
	const V = BUILD_HUD_VIEW;
	const h = lineHeight();
	const descW = math.max(0, props.width - V.listNameWidth - V.listLevelWidth - 2 * HUD_VIEW.gap);
	const label = (
		order: number,
		w: number,
		text: string,
		color: Color3,
		align: Enum.TextXAlignment = Enum.TextXAlignment.Left,
	) => (
		<textlabel
			LayoutOrder={order}
			Size={UDim2.fromOffset(w, h)}
			BackgroundTransparency={HIDDEN}
			Font={hudFont}
			TextSize={HUD_VIEW.smallText}
			TextColor3={color}
			TextStrokeColor3={role("background")}
			TextStrokeTransparency={HUD_VIEW.panelTransparency}
			TextXAlignment={align}
			TextTruncate={Enum.TextTruncate.AtEnd}
			Text={text}
		/>
	);
	return (
		<frame
			ref={tipRef}
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(props.width, h)}
			BackgroundTransparency={HIDDEN}
			Selectable={true}
			Active={false}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{label(1, V.listNameWidth, hudText(props.row.name), role(props.row.color))}
			{label(2, V.listLevelWidth, props.row.level, role("uiText"), Enum.TextXAlignment.Center)}
			{label(3, descW, hudText(props.row.desc), role("uiTextDim"))}
		</frame>
	);
}

/** Whether the local player owns anything the Build list shows (with `withBoosts`: a running boost counts too). */
export function hasBuildItems(s: GameSnapshot, withBoosts: boolean): boolean {
	return (
		s.boons.size() > 0 ||
		s.duos.size() > 0 ||
		s.relics.size() > 0 ||
		s.curses.size() > 0 ||
		(withBoosts && s.boosts.size() > 0)
	);
}

/**
 * The Build list (docs/BUILDS.md BU10; docs/ITEM_TOOLTIPS.md IT5 / IT7): "Build", then the run's whole inventory in
 * sections (shared/view/hud buildListSections: Boons, Duos, Relics, Curses and, with `withBoosts`, the running Boosts
 * with their seconds left; empty sections left out), the local player's, from the snapshot. At most `maxRows` lines
 * (rows and section titles) show; more scroll (ITD5: a ScrollingFrame, mouse wheel / touch drag, gamepad selection
 * scrolls a row into view) instead of the old "+N" line. Every row is a tooltip target (hover, focus, tap), clipped to
 * the scroll frame. Nothing when nothing is owned. A column of fixed `width` (reference px), no panel of its own.
 */
export function BuildList(props: { order: number; width: number; maxRows: number; withBoosts: boolean }) {
	const s = useSelector(selectSnapshot);
	const [scroll, setScroll] = useState<ScrollingFrame | undefined>(undefined);
	const sections = buildListSections(s, props.withBoosts);
	if (sections.size() === 0) return undefined;
	let lines = 0;
	for (const sec of sections) lines += 1 + sec.rows.size();
	const visible = math.max(1, math.min(lines, props.maxRows));
	const scrolls = lines > props.maxRows;
	const gap = HUD_VIEW.gap / 2;
	const h = lineHeight();
	const listH = visible * h + (visible - 1) * gap;
	const rowW = props.width - (scrolls ? OPTIONS_VIEW.scrollBar + gap : 0);
	const children = new Array<React.Element>();
	let order = 0;
	for (const sec of sections) {
		order += 1;
		children.push(
			<Text
				key={`t:${sec.kind}`}
				order={order}
				width={rowW}
				size={HUD_VIEW.smallText}
				color="uiAccent"
				text={hudText(sec.title)}
			/>,
		);
		for (const row of sec.rows) {
			order += 1;
			children.push(<Row key={row.key} order={order} row={row} width={rowW} />);
		}
	}
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, gap)}
			/>
			<Text
				order={1}
				width={props.width}
				size={HUD_VIEW.titleText}
				color="uiAccent"
				text={str(PROGRESSION_STRINGS.buildTitle)}
			/>
			<scrollingframe
				key="Rows"
				ref={setScroll}
				LayoutOrder={2}
				Size={UDim2.fromOffset(props.width, listH)}
				CanvasSize={new UDim2()}
				AutomaticCanvasSize={Enum.AutomaticSize.Y}
				ScrollingDirection={Enum.ScrollingDirection.Y}
				ScrollingEnabled={scrolls}
				ScrollBarThickness={scrolls ? OPTIONS_VIEW.scrollBar : 0}
				ScrollBarImageColor3={role("uiTextDim")}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
				Selectable={false}
			>
				<uilistlayout
					FillDirection={Enum.FillDirection.Vertical}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, gap)}
				/>
				<TooltipClipContext.Provider value={scroll}>{children}</TooltipClipContext.Provider>
			</scrollingframe>
		</frame>
	);
}

/**
 * The pause / party overlay's Build panel (docs/BUILDS.md BU10, docs/ITEM_TOOLTIPS.md IT5): the Build list (with the
 * running boosts) right of the pause menu (its panel is HUD_VIEW.panelWidth wide and centred; the solo map is on the
 * left, PauseMap), vertically centred, in the pause screen's frame. `top` (an upright phone's Build / Map toggle,
 * IT8): centred in the area the map takes otherwise (PORTRAIT.pauseMapShare of the safe area, the panel under it),
 * at the compact width and rows. Nothing when nothing is owned.
 */
export function PauseBuild(props: { top?: boolean }) {
	const s = useSelector(selectSnapshot);
	const touch = useSelector(selectInputDevice) === "touch";
	const uiScale = useHudScale();
	if (!hasBuildItems(s, true)) return undefined;
	const V = BUILD_HUD_VIEW;
	if (props.top === true) {
		const m = HUD_VIEW.margin;
		return (
			<frame
				key="PauseBuildArea"
				Position={new UDim2(0, m, 0, m)}
				Size={new UDim2(1, -2 * m, PORTRAIT.pauseMapShare, -m)}
				BackgroundTransparency={HIDDEN}
			>
				<Panel
					name="PauseBuild"
					position={UDim2.fromScale(HALF, HALF)}
					anchor={new Vector2(HALF, HALF)}
					skin={screenSkin("pause")}
				>
					<BuildList order={1} width={V.listCompactWidth} maxRows={V.listCompactRows} withBoosts={true} />
				</Panel>
			</frame>
		);
	}
	const side = HUD_VIEW.panelWidth / 2 + HUD_VIEW.gap;
	const viewW = Workspace.CurrentCamera?.ViewportSize.X ?? 0;
	const width = pauseBuildWidth(viewW, uiScale, HUD_VIEW.pad * 2);
	return (
		<Panel
			name="PauseBuild"
			position={new UDim2(HALF, side, HALF, 0)}
			anchor={new Vector2(0, HALF)}
			skin={screenSkin("pause")}
		>
			<BuildList order={1} width={width} maxRows={touch ? V.listCompactRows : V.listMaxRows} withBoosts={true} />
		</Panel>
	);
}
