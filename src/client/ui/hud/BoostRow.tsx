import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectJuice } from "client/store";
import { useHudFont, role, str } from "client/ui/theme";
import {
	BOOST_VIEW,
	boostBlinkTransparency,
	boostColorRole,
	boostIconKey,
	type BoostHudEntry,
} from "shared/view/boosts";
import { motionScale } from "shared/view/fx";
import { statusRowMaxWidth } from "shared/view/hud";
import { GridRow } from "./GridRow";
import { useTooltipTarget } from "./tooltipTargets";
import { HighlightRing } from "./TutorialFx";

const STROKE = 1;
const HIDDEN = 1;

/** A boost cell's sizes (reference px): BOOST_VIEW's in the status panel, the touch strip's chips smaller. */
export interface BoostLook {
	readonly iconSize: number;
	readonly iconTextSize: number;
	readonly iconBarGap: number;
	readonly barWidth: number;
	readonly barHeight: number;
}

const STATUS_LOOK: BoostLook = BOOST_VIEW;
/** The status panel's corner: a live tooltip goes under it, and its occlusion fade blocks the tooltip. */
const HOST_CORNER = "topLeft";

/** A boost cell's width: icon, gap, bar. */
export function boostCellWidth(look: BoostLook): number {
	return look.iconSize + look.iconBarGap + look.barWidth;
}

/**
 * One running boost: an icon square in the kind's colour role with its `boost.<kind>.icon` label, and a bar beside it
 * draining with `fraction`. Under BOOST_VIEW.blinkSeconds left both blink (boostBlinkTransparency on the snapshot's
 * quantised secondsLeft, so the blink follows sim time and needs no frame connection; a steady dim under reduced
 * motion).
 */
function BoostEntry(props: {
	order: number;
	entry: BoostHudEntry;
	motion: number;
	look: BoostLook;
	tooltips: boolean;
}) {
	const hudFont = useHudFont();
	const e = props.entry;
	const tipRef = useTooltipTarget({ kind: "boost", index: e.kind }, "hud", {
		panel: HOST_CORNER,
		enabled: props.tooltips,
	});
	const v = props.look;
	const tint = BOOST_VIEW;
	const color = boostColorRole(e.kind);
	const fade = boostBlinkTransparency(e.secondsLeft, props.motion);
	return (
		<frame
			ref={tipRef}
			LayoutOrder={props.order}
			Size={new UDim2(0, v.iconSize + v.iconBarGap + v.barWidth, 0, v.iconSize)}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, v.iconBarGap)}
			/>
			<frame
				LayoutOrder={1}
				Size={new UDim2(0, v.iconSize, 0, v.iconSize)}
				BackgroundColor3={role(color)}
				BackgroundTransparency={fade}
				BorderSizePixel={0}
			>
				<uistroke Thickness={STROKE} Color={role("background")} Transparency={fade} />
				<textlabel
					Size={UDim2.fromScale(1, 1)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextSize={v.iconTextSize}
					TextColor3={role(tint.iconTextRole)}
					TextTransparency={fade}
					Text={str(boostIconKey(e.kind))}
				/>
			</frame>
			<frame
				LayoutOrder={2}
				Size={new UDim2(0, v.barWidth, 0, v.barHeight)}
				BackgroundColor3={role(tint.barTrackRole)}
				BorderSizePixel={0}
			>
				<uistroke Thickness={STROKE} Color={role("background")} />
				<frame
					Size={UDim2.fromScale(e.fraction, 1)}
					BackgroundColor3={role(color)}
					BackgroundTransparency={fade}
					BorderSizePixel={0}
				/>
			</frame>
		</frame>
	);
}

/**
 * The running boosts of the shown player (docs/BOOSTS.md B7; snapshot `boosts`, Boost order), one icon + draining bar
 * each, as a row of the StatusPanel that wraps at its footprint width (GridRow, docs/HUD_LAYOUT.md; laid out at the
 * HUD's reference size under GameHud's UIScale, `useHudScale`).
 * `highlight`: the tutorial's pulsing ring on the row (TutorialView.highlight === "boosts"). Nothing when no boost runs.
 */
export function BoostRow(props: {
	order: number;
	boosts: ReadonlyArray<BoostHudEntry>;
	highlight?: boolean;
	/** Cell sizes, the row's widest and the gap (default: the status panel's; the touch strip's chips pass their own). */
	look?: BoostLook;
	maxWidth?: number;
	gap?: number;
	/**
	 * The status panel's row (docs/ITEM_TOOLTIPS.md IT6): each cell registers as a live `hud` tooltip target (the shown
	 * player's boosts: a spectated teammate's). Off (default) on the touch strip (ITD9).
	 */
	tooltips?: boolean;
}) {
	const motion = motionScale(useSelector(selectJuice));
	if (props.boosts.size() === 0) return undefined;
	const look = props.look ?? STATUS_LOOK;
	const entries = props.boosts.map((e, i) => (
		<BoostEntry
			key={`boost${e.kind}`}
			order={i + 1}
			entry={e}
			motion={motion}
			look={look}
			tooltips={props.tooltips === true}
		/>
	));
	return (
		<GridRow
			order={props.order}
			count={entries.size()}
			cellW={boostCellWidth(look)}
			cellH={look.iconSize}
			maxWidth={props.maxWidth ?? statusRowMaxWidth()}
			gap={props.gap}
		>
			{entries}
			{props.highlight === true ? <HighlightRing /> : undefined}
		</GridRow>
	);
}
