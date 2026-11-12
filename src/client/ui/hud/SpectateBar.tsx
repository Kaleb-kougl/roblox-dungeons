import React, { useBinding, useEffect, useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import { selectBindings, selectInputDevice, selectJuice, selectSnapshot } from "client/store";
import { spectateHint, keyDevice } from "shared/play";
import { str, useUiArt } from "client/ui/theme";
import { motionScale } from "shared/view/fx";
import {
	HUD_VIEW,
	SPECTATE_BAR_VIEW,
	SPECTATE_HUD_STRINGS,
	TOUCH_STRINGS,
	UI_ART,
	spectateBarTransparency,
	spectateGhostBox,
	spectateHintShown,
	spectateWatchingKey,
} from "shared/view/hud";
import { screenSkin } from "shared/view/menu";
import { ArtImage, Panel, Text, panelArt, panelArtInsets } from "./primitives";
import { useArtScale } from "./useHudScale";

const HALF = 0.5;
const HIDDEN = 1;
/** The ghost draws over the bar's frame (ZIndexBehavior Sibling keeps it after the panel; explicit for Global too). */
const GHOST_Z = 2;

/**
 * Bottom centre, co-op spectating (docs/SPECTATE.md S5): while the local player is dead and watches a teammate,
 * "Spectating <name> · 2 / 3", the switch hint (the player's own Attack / Alt bindings on the last-used device; hidden
 * with fewer than two living teammates and during a hold) and "You're back on the next floor". Fades in when it appears (instant under
 * reduced motion). With the frame art (docs/UI_ART.md UA8), the ghost at the bar's left, beside the centred lines and
 * outside their layout (the canvas group has none), sized to the bar's measured height inside its frame rails
 * (spectateGhostBox), so it fits the bar on every screen size. Reads only the HUD snapshot (shared/play takeSnapshot's spectate fields).
 */
export function SpectateBar() {
	const s = useSelector(selectSnapshot);
	if (!s.spectating || s.outcome !== "playing") return undefined; // the run-over panel takes over
	return <SpectateBarBody name={s.spectateName} position={s.spectatePosition} count={s.spectateCount} />;
}

function SpectateBarBody(props: { name: string; position: number; count: number }) {
	useUiArt();
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const motion = motionScale(useSelector(selectJuice));
	const [transparency, setTransparency] = useBinding(spectateBarTransparency(0, motion));
	useEffect(() => {
		const start = os.clock();
		setTransparency(spectateBarTransparency(0, motion));
		if (motion <= 0) return undefined;
		// A holder, not a local: a Luau local is not in scope inside its own initializer (the callback disconnects it).
		const handle: { connection?: RBXScriptConnection } = {};
		handle.connection = RunService.Heartbeat.Connect(() => {
			const age = os.clock() - start;
			setTransparency(spectateBarTransparency(age, motion));
			if (age >= SPECTATE_BAR_VIEW.fadeSec * motion) handle.connection?.Disconnect();
		});
		return () => handle.connection?.Disconnect();
	}, [motion]);
	const keys = spectateHint(bindings, str)[keyDevice(device)];
	const skin = screenSkin("spectate");
	const uiScale = useArtScale();
	const barRef = useRef<CanvasGroup>();
	// The bar's height, reference px (AbsoluteSize is screen px, under the UIScale): two or three lines, and wrapping.
	const [barHeight, setBarHeight] = useState(0);
	useEffect(() => {
		const bar = barRef.current;
		if (bar === undefined) return undefined;
		const measure = () => setBarHeight(uiScale > 0 ? bar.AbsoluteSize.Y / uiScale : 0);
		measure();
		const connection = bar.GetPropertyChangedSignal("AbsoluteSize").Connect(measure);
		return () => connection.Disconnect();
	}, [uiScale]);
	const ghost = spectateGhostBox(barHeight, panelArtInsets(skin), uiScale);
	return (
		<canvasgroup
			key="SpectateBar"
			ref={barRef}
			Position={new UDim2(HALF, 0, 1, -SPECTATE_BAR_VIEW.bottom)}
			AnchorPoint={new Vector2(HALF, 1)}
			Size={new UDim2(0, SPECTATE_BAR_VIEW.width, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
			GroupTransparency={transparency}
		>
			<Panel
				position={new UDim2(0, 0, 0, 0)}
				anchor={new Vector2(0, 0)}
				width={SPECTATE_BAR_VIEW.width}
				align={Enum.HorizontalAlignment.Center}
				skin={skin}
				name="Spectate"
			>
				<Text
					fill={true}
					order={1}
					color={SPECTATE_BAR_VIEW.nameRole}
					align={Enum.TextXAlignment.Center}
					font="name"
					text={str(spectateWatchingKey(props.position), {
						name: props.name,
						pos: props.position,
						count: props.count,
					})}
				/>
				{spectateHintShown(props.position, props.count) ? (
					<Text
						fill={true}
						order={2}
						size={HUD_VIEW.smallText}
						color={SPECTATE_BAR_VIEW.hintRole}
						align={Enum.TextXAlignment.Center}
						text={
							device === "touch"
								? str(TOUCH_STRINGS.hintSpectate)
								: str(SPECTATE_HUD_STRINGS.hint, { next: keys.next, previous: keys.previous })
						}
					/>
				) : undefined}
				<Text
					fill={true}
					order={3}
					size={HUD_VIEW.smallText}
					color={SPECTATE_BAR_VIEW.backRole}
					align={Enum.TextXAlignment.Center}
					text={str(SPECTATE_HUD_STRINGS.back)}
				/>
			</Panel>
			{panelArt(skin) && ghost.h > 0 ? (
				<ArtImage
					key="Ghost"
					name="Ghost"
					id={UI_ART.ids.iconGhost}
					box={ghost}
					shrink={true}
					position={new UDim2(0, HUD_VIEW.pad, HALF, 0)}
					anchor={new Vector2(0, HALF)}
					zIndex={GHOST_Z}
				/>
			) : undefined}
		</canvasgroup>
	);
}
