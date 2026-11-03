import React from "@rbxts/react";
import { SlicedImage, useArtScale } from "client/ui/hud";
import { alignFor, fontFor, role, textSizeFor, themePack, useUiFonts, type FontRole } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import {
	HUD_VIEW,
	UI_ART,
	contentInsetsOf,
	skinFor,
	skinHasOf,
	skinPadding,
	skinRefPerArt,
	snappedSliceScale,
} from "shared/view/hud";
import { MENU_VIEW } from "shared/view/menu";

/** The menu screens' building blocks on top of the HUD primitives: a scrolling list, a list row, a fixed-width cell. */

const HIDDEN = 1;

/**
 * A vertical scrolling list `height` reference px tall (rows grow its canvas). `selectable`: a gamepad can select the
 * list itself and scroll it with the stick (a list of text with no buttons in it, like the Credits).
 */
export function ScrollList(props: {
	order: number;
	height: number;
	width?: number;
	selectable?: boolean;
	children?: React.ReactNode;
}) {
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
			Selectable={props.selectable === true}
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

interface ListRowProps {
	order: number;
	dim?: boolean;
	children?: React.ReactNode;
}

/**
 * One list row: a fixed-height horizontal strip on the panel colour. With frame art in the pack (docs/UI_ART.md UA7)
 * the strip is the row's frame (SkinnedListRow); without, exactly the flat strip.
 */
export function ListRow(props: ListRowProps) {
	const pack = themePack();
	const skinId = pack !== undefined ? skinFor(skinHasOf(pack), "panel", UI_ART.rowContext) : undefined;
	if (skinId !== undefined) return <SkinnedListRow row={props} skinId={skinId} />;
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

/**
 * A list row on its frame art: UI_ART.rowContext's frame (ui.panel.hud: ui.panel.tall's borders do not fit a row,
 * skin.spec.ts) at that context's snapped density, ImageTransparency the flat row's transparency, its padding grown so
 * no cell sits on the border (left / right at least HUD_VIEW.pad as today, top / bottom the border). The image is the
 * container (a sibling image would be placed by the list layout). The border is the frame's visible one
 * (contentInsetsOf).
 */
function SkinnedListRow(props: { row: ListRowProps; skinId: string }) {
	const row = props.row;
	const uiScale = useArtScale();
	const sliceScale = snappedSliceScale(uiScale, skinRefPerArt(UI_ART.rowContext));
	const flat = { left: HUD_VIEW.pad, top: 0, right: HUD_VIEW.pad, bottom: 0 };
	const pad = skinPadding(flat, contentInsetsOf(props.skinId, themePack()?.image(props.skinId)?.slice), sliceScale);
	return (
		<SlicedImage
			id={props.skinId}
			order={row.order}
			sliceScale={sliceScale}
			size={new UDim2(1, -MENU_VIEW.scrollBarThickness * 2, 0, MENU_VIEW.rowHeight)}
			transparency={row.dim === true ? HUD_VIEW.overlayTransparency : HUD_VIEW.panelTransparency}
		>
			<uipadding
				PaddingLeft={new UDim(0, pad.left)}
				PaddingRight={new UDim(0, pad.right)}
				PaddingTop={new UDim(0, pad.top)}
				PaddingBottom={new UDim(0, pad.bottom)}
			/>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{row.children}
		</SlicedImage>
	);
}

/**
 * A single-line text cell of a fixed width (truncated, never wrapped), in the locale's font (`font` "name" for a player
 * display name or a lobby name a player typed, LD13), size scaled and left alignment flipped for right to left (L4).
 */
export function Cell(props: {
	order: number;
	width: number;
	text: string;
	color?: ColorRole;
	size?: number;
	align?: Enum.TextXAlignment;
	font?: FontRole;
}) {
	const fonts = useUiFonts();
	const size = textSizeFor(fonts, props.size ?? HUD_VIEW.smallText);
	return (
		<textlabel
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 1, 0)}
			BackgroundTransparency={HIDDEN}
			Font={fontFor(fonts, props.font)}
			TextSize={size}
			TextTruncate={Enum.TextTruncate.AtEnd}
			TextColor3={role(props.color ?? "uiText")}
			TextXAlignment={alignFor(fonts, props.align ?? Enum.TextXAlignment.Left)}
			Text={props.text}
		/>
	);
}
