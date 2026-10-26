import React, { useBinding, useEffect } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import { selectJuice } from "client/store";
import { role } from "client/ui/theme";
import { motionScale } from "shared/view/fx";
import { HUD_VIEW, TUTORIAL_VIEW, ghostHeartTransparency, highlightRingLook } from "shared/view/hud";

const HIDDEN = 1;
const HALF = 0.5;
const STROKE = 1;

/**
 * The tutorial's highlight ring: a UIStroke in TUTORIAL_VIEW.ringRole (`uiAccent`) on the HUD element being taught
 * (render it as a child of that element's frame; a UIStroke is no GuiObject, so list layouts ignore it). It pulses
 * (shared/view/hud highlightRingLook) on a binding, so the pulse never re-renders the tree; with the juice settings'
 * reduced motion (motionScale 0) it is a static ring and no per-frame connection exists.
 */
export function HighlightRing() {
	const motion = motionScale(useSelector(selectJuice));
	const [look, setLook] = useBinding(highlightRingLook(0, motion));
	useEffect(() => {
		const start = os.clock();
		setLook(highlightRingLook(0, motion));
		if (motion <= 0) return undefined;
		const connection = RunService.Heartbeat.Connect(() => setLook(highlightRingLook(os.clock() - start, motion)));
		return () => connection.Disconnect();
	}, [motion]);
	return (
		<uistroke
			key="TutorialHighlight"
			ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
			Color={role(TUTORIAL_VIEW.ringRole)}
			Thickness={look.map((l) => l.thickness)}
			Transparency={look.map((l) => l.transparency)}
		/>
	);
}

/**
 * A harmless hit's ghost half heart (the half heart a real run would have cost): a half-filled heart in
 * TUTORIAL_VIEW.ghostHeartRole that fades out over TUTORIAL_VIEW.ghostHeartSeconds from its mount. Mount it with a
 * key that changes per flash (the tutorial slice's ghostHeart token) to restart the fade.
 */
export function GhostHeart(props: { order: number }) {
	const [transparency, setTransparency] = useBinding(ghostHeartTransparency(0));
	useEffect(() => {
		const start = os.clock();
		// A holder, not a local: a Luau local is not in scope inside its own initializer (the callback disconnects it).
		const handle: { connection?: RBXScriptConnection } = {};
		handle.connection = RunService.Heartbeat.Connect(() => {
			const age = os.clock() - start;
			setTransparency(ghostHeartTransparency(age));
			if (age >= TUTORIAL_VIEW.ghostHeartSeconds) handle.connection?.Disconnect();
		});
		return () => handle.connection?.Disconnect();
	}, []);
	const size = HUD_VIEW.heartSize;
	return (
		<frame
			key="GhostHeart"
			LayoutOrder={props.order}
			Size={new UDim2(0, size, 0, size)}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role(TUTORIAL_VIEW.ghostHeartRole)} Transparency={transparency} />
			<frame
				Size={UDim2.fromScale(HALF, 1)}
				BackgroundColor3={role(TUTORIAL_VIEW.ghostHeartRole)}
				BackgroundTransparency={transparency}
				BorderSizePixel={0}
			/>
		</frame>
	);
}
