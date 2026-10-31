import React from "@rbxts/react";
import { HUD_VIEW, wrapGrid } from "shared/view/hud";

const HIDDEN = 1;

/**
 * A row of equal cells that wraps into more rows at `maxWidth` (shared/view/hud wrapGrid; docs/HUD_LAYOUT.md H6
 * follow-up), sized explicitly so the auto-sized panel around it never grows past its footprint. Children are the
 * cells (LayoutOrder sorts them); a UIStroke child (the tutorial's highlight ring) is not a cell.
 */
export function GridRow(props: {
	order: number;
	count: number;
	cellW: number;
	cellH: number;
	maxWidth: number;
	/** Between cells (default HUD_VIEW.gap). */
	gap?: number;
	children?: React.ReactNode;
}) {
	const gap = props.gap ?? HUD_VIEW.gap;
	const grid = wrapGrid(props.count, props.cellW, props.cellH, gap, props.maxWidth);
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, grid.width, 0, grid.height)}
			BackgroundTransparency={HIDDEN}
		>
			<uigridlayout
				CellSize={new UDim2(0, props.cellW, 0, props.cellH)}
				CellPadding={new UDim2(0, gap, 0, gap)}
				FillDirection={Enum.FillDirection.Horizontal}
				FillDirectionMaxCells={grid.cols}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{props.children}
		</frame>
	);
}
