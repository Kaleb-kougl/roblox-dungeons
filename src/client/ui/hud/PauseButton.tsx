import React, { useEffect, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import {
	selectAnyPanelOpen,
	selectCoopOverlay,
	selectGameActive,
	selectMenuScreen,
	selectRobloxMenuOpen,
	selectRunInfo,
	selectSnapshot,
	selectTutorialEnded,
} from "client/store";
import { role } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { PAUSE_BUTTON_VIEW, pauseButtonShown } from "shared/view/menu";
import { useHudActions } from "./actions";

const HALF = 0.5;
const ROUND = new UDim(HALF, 0);
const BAR_OFFSET = (PAUSE_BUTTON_VIEW.barGap + PAUSE_BUTTON_VIEW.barWidth) / 2;

/** The free part of the Roblox top bar (right of its own buttons); follows top bar changes. */
function useTopbarInset(): Rect {
	const [inset, setInset] = useState(() => GuiService.TopbarInset);
	useEffect(() => {
		const changed = GuiService.GetPropertyChangedSignal("TopbarInset").Connect(() =>
			setInset(GuiService.TopbarInset),
		);
		return () => changed.Disconnect();
	}, []);
	return inset;
}

function Bar(props: { x: number }) {
	return (
		<frame
			AnchorPoint={new Vector2(HALF, HALF)}
			Position={UDim2.fromScale(HALF + props.x, HALF)}
			Size={UDim2.fromScale(PAUSE_BUTTON_VIEW.barWidth, PAUSE_BUTTON_VIEW.barHeight)}
			BackgroundColor3={role("uiText")}
			BorderSizePixel={0}
		/>
	);
}

/**
 * The on-screen pause button (mouse and touch; a pad pauses with Start): a round button in the Roblox top bar, right
 * of Roblox's own buttons, shown while a run is being played (shared/view/menu pauseButtonShown). A solo run pauses
 * (the pause overlay takes over, with Resume), a co-op run opens the party overlay. It acts on the PRESS, not the
 * release, so the click never reaches the game as an attack (HudActions.pause suppresses the mouse until released).
 * Its own ScreenGui without safe-area insets (GameHud): the top bar sits outside the HUD's safe area.
 */
export function PauseButton() {
	const active = useSelector(selectGameActive);
	const s = useSelector(selectSnapshot);
	const info = useSelector(selectRunInfo);
	const coopOverlay = useSelector(selectCoopOverlay);
	const panelOpen = useSelector(selectAnyPanelOpen);
	const screen = useSelector(selectMenuScreen);
	const robloxMenuOpen = useSelector(selectRobloxMenuOpen);
	const tutorialEnded = useSelector(selectTutorialEnded);
	const actions = useHudActions();
	const inset = useTopbarInset();
	const [hover, setHover] = useState(false);

	const shown = pauseButtonShown({
		active,
		coop: info.coop,
		playing: s.outcome === "playing",
		paused: s.paused,
		coopOverlay,
		panelOpen,
		menuScreen: screen !== "none",
		robloxMenuOpen,
		tutorialEnded,
	});
	useEffect(() => {
		if (!shown) setHover(false);
	}, [shown]);
	if (!shown) return undefined;

	const view = PAUSE_BUTTON_VIEW;
	const inBar = inset.Width > 0 && inset.Height > 0;
	const size = inBar ? math.min(view.size, inset.Height) : view.size;
	const position = inBar
		? UDim2.fromOffset(inset.Min.X + view.gap, inset.Min.Y + (inset.Height - size) / 2)
		: UDim2.fromOffset(view.fallbackMargin, view.fallbackMargin);
	return (
		<textbutton
			key="PauseButton"
			Position={position}
			Size={UDim2.fromOffset(size, size)}
			AutoButtonColor={false}
			Selectable={false}
			Text=""
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={hover ? 0 : view.backgroundTransparency}
			BorderSizePixel={0}
			Event={{
				InputBegan: (_rbx, input) => {
					const t = input.UserInputType;
					if (t !== Enum.UserInputType.MouseButton1 && t !== Enum.UserInputType.Touch) return;
					actions.playUi(SFX.uiClick);
					actions.pause();
				},
				MouseEnter: () => setHover(true),
				MouseLeave: () => setHover(false),
			}}
		>
			<uicorner CornerRadius={ROUND} />
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={view.strokeThickness}
				Color={role(hover ? "uiAccent" : "uiTextDim")}
			/>
			<Bar x={-BAR_OFFSET} />
			<Bar x={BAR_OFFSET} />
		</textbutton>
	);
}
