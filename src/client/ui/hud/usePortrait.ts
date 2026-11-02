import { useEffect, useState } from "@rbxts/react";
import { Workspace } from "@rbxts/services";
import { isPortrait } from "shared/view";

function currentPortrait(): boolean {
	const vp = Workspace.CurrentCamera?.ViewportSize;
	return vp !== undefined && isPortrait(vp.X, vp.Y);
}

/**
 * Whether the screen is upright (taller than wide: shared/view isPortrait, docs/PORTRAIT.md), following viewport
 * resizes (a phone turning) and camera swaps, like useHudScale.
 */
export function usePortrait(): boolean {
	const [portrait, setPortrait] = useState(currentPortrait);
	useEffect(() => {
		let viewport: RBXScriptConnection | undefined;
		const bind = () => {
			viewport?.Disconnect();
			viewport = Workspace.CurrentCamera?.GetPropertyChangedSignal("ViewportSize").Connect(() =>
				setPortrait(currentPortrait()),
			);
			setPortrait(currentPortrait());
		};
		bind();
		const cameraSwap = Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(bind);
		return () => {
			viewport?.Disconnect();
			cameraSwap.Disconnect();
		};
	}, []);
	return portrait;
}
