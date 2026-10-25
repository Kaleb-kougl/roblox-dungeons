import React from "@rbxts/react";
import { HUD_FONT, role } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import { HUD_VIEW } from "shared/view/hud";
import { MENU_VIEW } from "shared/view/menu";

/** The menu screens' building blocks on top of the HUD primitives: a scrolling list, a list row, a fixed-width cell. */

const HIDDEN = 1;

/** A vertical scrolling list `height` reference px tall (rows grow its canvas). */
export function ScrollList(props: { order: number; height: number; width?: number; children?: React.ReactNode }) {
	return (
		<scrollingframe
			LayoutOrder={props.order}
			Size={
				props.width !== undefined
					? new UDim2(0, props.width, 0, props.height)
					: new UDim2(1, 0, 0, props.height)
			}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
			CanvasSize={new UDim2()}
			AutomaticCanvasSize={Enum.AutomaticSize.Y}
			ScrollingDirection={Enum.ScrollingDirection.Y}
			ScrollBarThickness={MENU_VIEW.scrollBarThickness}
			ScrollBarImageColor3={role("uiTextDim")}
			Selectable={false}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{props.children}
		</scrollingframe>
	);
}

/** One list row: a fixed-height horizontal strip on the panel colour. */
export function ListRow(props: { order: number; dim?: boolean; children?: React.ReactNode }) {
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(1, -MENU_VIEW.scrollBarThickness * 2, 0, MENU_VIEW.rowHeight)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={props.dim === true ? HUD_VIEW.overlayTransparency : HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
		>
			<uipadding PaddingLeft={new UDim(0, HUD_VIEW.pad)} PaddingRight={new UDim(0, HUD_VIEW.pad)} />
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{props.children}
		</frame>
	);
}

/** A single-line text cell of a fixed width (truncated, never wrapped). */
export function Cell(props: {
	order: number;
	width: number;
	text: string;
	color?: ColorRole;
	size?: number;
	align?: Enum.TextXAlignment;
}) {
	const size = props.size ?? HUD_VIEW.smallText;
	return (
		<textlabel
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 1, 0)}
			BackgroundTransparency={HIDDEN}
			Font={HUD_FONT}
			TextSize={size}
			TextTruncate={Enum.TextTruncate.AtEnd}
			TextColor3={role(props.color ?? "uiText")}
			TextXAlignment={props.align ?? Enum.TextXAlignment.Left}
			Text={props.text}
		/>
	);
}
