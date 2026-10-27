import React from "@rbxts/react";
import { role } from "client/ui/theme";

/**
 * Pieces shared by the join loading screen (LoadingScreen) and the stage loader's cover (StageCard, docs/STAGE_LOADER.md
 * SD6: one look): the opaque full-screen `background` cover (Active, so clicks and taps under it go nowhere) and the
 * progress bar (track `uiTextDim`, fill `uiAccent`). `transparency` is the fade (0 opaque, 1 gone), a value or binding.
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

export interface ProgressBarProps {
	readonly order: number;
	/** Reference px. */
	readonly width: number;
	readonly height: number;
	/** In [0, 1] (clamped). */
	readonly fraction: number;
	readonly transparency: number | React.Binding<number>;
}

/** A flat progress bar: the `uiTextDim` track filled with `uiAccent` from the left. */
export function ProgressBar(props: ProgressBarProps) {
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
