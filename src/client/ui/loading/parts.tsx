import React from "@rbxts/react";
import { SlicedImage, useHudScale } from "client/ui/hud";
import { UI_IMAGES, role, uiImage, useUiArt } from "client/ui/theme";
import { UI_ART, pillBarHeight, pillBarSkin, skinHasOf } from "shared/view/hud";

const HIDDEN = 1;

/**
 * Pieces shared by the join loading screen (LoadingScreen) and the stage loader's cover (StageCard, docs/STAGE_LOADER.md
 * SD6: one look): the opaque full-screen `background` cover (Active, so clicks and taps under it go nowhere) and the
 * progress bar (track `uiTextDim`, fill `uiAccent`; the pill art when the pack has it, docs/UI_ART.md UA9; the
 * plan's candelabra ornaments are not in the icon atlas, so the cover has none). `transparency` is the fade (0 opaque,
 * 1 gone), a value or binding.
 */
export interface CoverProps {
	readonly transparency: number | React.Binding<number>;
}

/** The opaque cover over the whole screen (its ScreenGui sets IgnoreGuiInset, so it reaches under the top bar). */
export function Cover(props: CoverProps) {
	return (
		<frame
			key="Cover"
			Size={UDim2.fromScale(1, 1)}
			BackgroundColor3={role("background")}
			BackgroundTransparency={props.transparency}
			BorderSizePixel={0}
			Active={true}
		/>
	);
}

/**
 * `ProgressBar`'s props: its place in the column's layout, its size in reference px, how full it is and its
 * transparency (the cover's fade: 0 opaque, a binding while fading).
 */
export interface ProgressBarProps {
	readonly order: number;
	/** Reference px. */
	readonly width: number;
	readonly height: number;
	/** In [0, 1] (clamped). */
	readonly fraction: number;
	readonly transparency: number | React.Binding<number>;
}

/**
 * The progress bar. With the pill art (docs/UI_ART.md UA9: ui.bar.track and ui.bar.fill, pillBarSkin) it is the pill
 * (PillBar); without, exactly the flat bar: the `uiTextDim` track filled with `uiAccent` from the left.
 */
export function ProgressBar(props: ProgressBarProps) {
	useUiArt();
	const skin = pillBarSkin(skinHasOf(UI_IMAGES));
	if (skin !== undefined) return <PillBar bar={props} track={skin.track} fill={skin.fill} />;
	return (
		<frame
			key="Bar"
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, props.height)}
			BackgroundColor3={role("uiTextDim")}
			BackgroundTransparency={props.transparency}
			BorderSizePixel={0}
		>
			<frame
				key="Fill"
				Size={UDim2.fromScale(math.clamp(props.fraction, 0, 1), 1)}
				BackgroundColor3={role("uiAccent")}
				BackgroundTransparency={props.transparency}
				BorderSizePixel={0}
			/>
		</frame>
	);
}

/**
 * The pill bar: the track (ui.bar.track, 9-sliced horizontally, snapped at UI_ART.barRefPerArt) at the pill's own art
 * height (pillBarHeight: the 8 px round ends never squash; the bar is that tall instead of `height`), and the white fill
 * (ui.bar.fill) tinted `uiAccent`, drawn at the FULL track size inside a ClipsDescendants frame whose width is the
 * fraction, so a small fraction shows the pill's rounded left end cut off rather than a squashed pill.
 */
function PillBar(props: { bar: ProgressBarProps; track: string; fill: string }) {
	useUiArt();
	const bar = props.bar;
	const uiScale = useHudScale();
	const art = uiImage(props.track);
	const height = art !== undefined ? pillBarHeight(art.h, uiScale) : bar.height;
	return (
		<frame
			key="Bar"
			LayoutOrder={bar.order}
			Size={new UDim2(0, bar.width, 0, height)}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
		>
			<SlicedImage
				key="Track"
				name="Track"
				id={props.track}
				snap={true}
				refPerArt={UI_ART.barRefPerArt}
				transparency={bar.transparency}
			/>
			<frame
				key="Clip"
				Size={UDim2.fromScale(math.clamp(bar.fraction, 0, 1), 1)}
				ClipsDescendants={true}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
			>
				<SlicedImage
					key="Fill"
					name="Fill"
					id={props.fill}
					snap={true}
					refPerArt={UI_ART.barRefPerArt}
					size={new UDim2(0, bar.width, 1, 0)}
					color={role("uiAccent")}
					transparency={bar.transparency}
				/>
			</frame>
		</frame>
	);
}
