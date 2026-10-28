import { useEffect, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, Workspace } from "@rbxts/services";
import { selectDisplay, selectInputDevice } from "client/store";
import { computeHudScale } from "shared/view/hud";

function currentScale(percent: number, touch: boolean): number {
	const camera = Workspace.CurrentCamera;
	if (camera === undefined) return computeHudScale(0, 0, false, percent, touch);
	const [ok, tenFoot] = pcall(() => GuiService.IsTenFootInterface());
	return computeHudScale(camera.ViewportSize.X, camera.ViewportSize.Y, ok && tenFoot === true, percent, touch);
}

/**
 * The HUD's UIScale (the user's carapace pattern, client/ui/hooks/useViewportScale): the layout is drawn for a
 * 1280x720 reference and scaled to the viewport (clamped; larger on a ten-foot console screen), so a phone and a PC
 * show the same layout at different sizes, times the player's HUD scale (Options > Display). Follows viewport
 * resizes, camera swaps and the setting. On touch the floor is HUD_VIEW.touchMinScale (docs/MOBILE.md MB10).
 */
export function useHudScale(): number {
	const percent = useSelector(selectDisplay).hudScale;
	const touch = useSelector(selectInputDevice) === "touch";
	const [scale, setScale] = useState(() => currentScale(percent, touch));
	useEffect(() => {
		let viewport: RBXScriptConnection | undefined;
		const bind = () => {
			viewport?.Disconnect();
			viewport = Workspace.CurrentCamera?.GetPropertyChangedSignal("ViewportSize").Connect(() =>
				setScale(currentScale(percent, touch)),
			);
			setScale(currentScale(percent, touch));
		};
		bind();
		const cameraSwap = Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(bind);
		return () => {
			viewport?.Disconnect();
			cameraSwap.Disconnect();
		};
	}, [percent, touch]);
	return scale;
}
