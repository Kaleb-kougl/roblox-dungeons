import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectJuice } from "client/store";
import { HUD_FONT, role, str } from "client/ui/theme";
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
import { HighlightRing } from "./TutorialFx";

const STROKE = 1;
const HIDDEN = 1;

/**
 * One running boost: an icon square in the kind's colour role with its `boost.<kind>.icon` label, and a bar beside it
 * draining with `fraction`. Under BOOST_VIEW.blinkSeconds left both blink (boostBlinkTransparency on the snapshot's
 * quantised secondsLeft, so the blink follows sim time and needs no frame connection; a steady dim under reduced
 * motion).
 */
function BoostEntry(props: { order: number; entry: BoostHudEntry; motion: number }) {
	const e = props.entry;
	const v = BOOST_VIEW;
	const color = boostColorRole(e.kind);
	const fade = boostBlinkTransparency(e.secondsLeft, props.motion);
	return (
		<frame
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
					Font={HUD_FONT}
					TextSize={v.iconTextSize}
					TextColor3={role(v.iconTextRole)}
					TextTransparency={fade}
					Text={str(boostIconKey(e.kind))}
				/>
			</frame>
			<frame
				LayoutOrder={2}
				Size={new UDim2(0, v.barWidth, 0, v.barHeight)}
				BackgroundColor3={role(v.barTrackRole)}
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
export function BoostRow(props: { order: number; boosts: ReadonlyArray<BoostHudEntry>; highlight?: boolean }) {
	const motion = motionScale(useSelector(selectJuice));
	if (props.boosts.size() === 0) return undefined;
	const entries = props.boosts.map((e, i) => (
		<BoostEntry key={`boost${e.kind}`} order={i + 1} entry={e} motion={motion} />
	));
	return (
		<GridRow
			order={props.order}
			count={entries.size()}
			cellW={BOOST_VIEW.iconSize + BOOST_VIEW.iconBarGap + BOOST_VIEW.barWidth}
			cellH={BOOST_VIEW.iconSize}
			maxWidth={statusRowMaxWidth()}
		>
			{entries}
			{props.highlight === true ? <HighlightRing /> : undefined}
		</GridRow>
	);
}
