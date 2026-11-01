import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { Workspace } from "@rbxts/services";
import { selectInputDevice, selectSnapshot } from "client/store";
import { HUD_FONT, hudText, role, str } from "client/ui/theme";
import {
	BUILD_HUD_VIEW,
	HUD_STRINGS,
	HUD_VIEW,
	PROGRESSION_STRINGS,
	buildListRows,
	capBuildList,
	pauseBuildWidth,
	type BuildListRow,
} from "shared/view/hud";
import { screenSkin } from "shared/view/menu";
import { Panel, Text } from "./primitives";
import { useHudScale } from "./useHudScale";

const HIDDEN = 1;
const HALF = 0.5;
/** A text row's box over its text size (primitives Text's line slack). */
const LINE_SLACK = 4;

/** One row: the name in its colour, the level, the line it has now (dim, truncated to the row). */
function Row(props: { order: number; row: BuildListRow; width: number }) {
	const V = BUILD_HUD_VIEW;
	const h = HUD_VIEW.smallText + LINE_SLACK;
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
			Font={HUD_FONT}
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
		<frame LayoutOrder={props.order} Size={UDim2.fromOffset(props.width, h)} BackgroundTransparency={HIDDEN}>
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

/**
 * The Build list (docs/BUILDS.md BU10): "Build", then one row per boon (name, level, its line now; an evolved boon by
 * its evolution's name in boon.evolved) and per duo (boon.duo), the local player's, from the snapshot
 * (shared/view/hud buildListRows); at most `maxRows` rows, the last a "+N" line. Nothing without boons. A column of
 * fixed `width` (reference px), no panel of its own.
 */
export function BuildList(props: { order: number; width: number; maxRows: number }) {
	const s = useSelector(selectSnapshot);
	const rows = buildListRows(s.boons, s.boonLevels, s.duos);
	if (rows.size() === 0) return undefined;
	const cap = capBuildList(rows.size(), props.maxRows);
	const children = new Array<React.Element>();
	for (let i = 0; i < cap.shown; i++) {
		children.push(<Row key={rows[i].key} order={i + 2} row={rows[i]} width={props.width} />);
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
				Padding={new UDim(0, HUD_VIEW.gap / 2)}
			/>
			<Text
				order={1}
				width={props.width}
				size={HUD_VIEW.titleText}
				color="uiAccent"
				text={str(PROGRESSION_STRINGS.buildTitle)}
			/>
			{children}
			{cap.more > 0 ? (
				<Text
					order={cap.shown + 2}
					width={props.width}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					text={str(HUD_STRINGS.itemsMore, { count: cap.more })}
				/>
			) : undefined}
		</frame>
	);
}

/**
 * The pause / party overlay's Build panel (docs/BUILDS.md BU10): the Build list right of the pause menu (its panel is
 * HUD_VIEW.panelWidth wide and centred; the solo map is on the left, PauseMap), vertically centred, in the pause
 * screen's frame. Nothing without boons.
 */
export function PauseBuild() {
	const s = useSelector(selectSnapshot);
	const touch = useSelector(selectInputDevice) === "touch";
	const uiScale = useHudScale();
	if (s.boons.size() === 0 && s.duos.size() === 0) return undefined;
	const side = HUD_VIEW.panelWidth / 2 + HUD_VIEW.gap;
	const V = BUILD_HUD_VIEW;
	const viewW = Workspace.CurrentCamera?.ViewportSize.X ?? 0;
	const width = pauseBuildWidth(viewW, uiScale, HUD_VIEW.pad * 2);
	return (
		<Panel
			name="PauseBuild"
			position={new UDim2(HALF, side, HALF, 0)}
			anchor={new Vector2(0, HALF)}
			skin={screenSkin("pause")}
		>
			<BuildList order={1} width={width} maxRows={touch ? V.listCompactRows : V.listMaxRows} />
		</Panel>
	);
}
