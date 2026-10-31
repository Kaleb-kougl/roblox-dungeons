import React, { createContext, useContext } from "@rbxts/react";
import { createPortal } from "@rbxts/react-roblox";
import { role } from "client/ui/theme";

/**
 * The full-screen ScreenGui the overlay dims draw into (GameHud's KV_GameMenuDim: ScreenInsets None, IgnoreGuiInset,
 * under KV_GameMenu). Undefined until it mounted.
 */
export const DimLayerContext = createContext<ScreenGui | undefined>(undefined);

/**
 * An overlay's dim over the whole screen (the pause overlay, Options, the leaderboards, the tutorial outro): the
 * `background` role at `transparency`, portalled into the full-screen dim layer, so it reaches under the Roblox top
 * bar and into a phone's notch insets like the loading covers do. The overlay's panel stays in its safe-area ScreenGui
 * (docs/UI_ART.md "Phones": a dim cut at the safe area read as a second, unfinished panel). Never takes input.
 */
export function ScreenDim(props: { transparency: number; name: string }) {
	const layer = useContext(DimLayerContext);
	if (layer === undefined) return undefined;
	return createPortal(
		<frame
			key={props.name}
			Size={UDim2.fromScale(1, 1)}
			BackgroundColor3={role("background")}
			BackgroundTransparency={props.transparency}
			BorderSizePixel={0}
			Active={false}
		/>,
		layer,
	);
}
