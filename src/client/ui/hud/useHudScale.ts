import { useEffect, useState } from "@rbxts/react";
import { GuiService, Workspace } from "@rbxts/services";
import { computeHudScale } from "shared/view/hud";

function currentScale(): number {
	const camera = Workspace.CurrentCamera;
	if (camera === undefined) return 1;
	const [ok, tenFoot] = pcall(() => GuiService.IsTenFootInterface());
	return computeHudScale(camera.ViewportSize.X, camera.ViewportSize.Y, ok && tenFoot === true);
}

/**
 * The HUD's UIScale (the user's carapace pattern, client/ui/hooks/useViewportScale): the layout is drawn for a
 * 1280x720 reference and scaled to the viewport (clamped; larger on a ten-foot console screen), so a phone and a PC
 * show the same layout at different sizes. Follows viewport resizes and camera swaps.
 */
export function useHudScale(): number {
	const [scale, setScale] = useState(currentScale);
	useEffect(() => {
		let viewport: RBXScriptConnection | undefined;
		const bind = () => {
			viewport?.Disconnect();
			viewport = Workspace.CurrentCamera?.GetPropertyChangedSignal("ViewportSize").Connect(() =>
				setScale(currentScale()),
			);
			setScale(currentScale());
		};
		bind();
		const cameraSwap = Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(bind);
		return () => {
			viewport?.Disconnect();
			cameraSwap.Disconnect();
		};
	}, []);
	return scale;
}
