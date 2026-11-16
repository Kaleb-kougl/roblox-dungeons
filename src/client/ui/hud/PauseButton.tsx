import React, { useEffect, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import {
	selectAnyPanelOpen,
	selectCoopOverlay,
	selectGameActive,
	selectInputDevice,
	selectMenuScreen,
	selectRobloxMenuOpen,
	selectRunInfo,
	selectSnapshot,
	selectTutorialEnded,
	selectTutorialPrompt,
} from "client/store";
import { role } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { UI_ART, pauseButtonRinged } from "shared/view/hud";
import { PAUSE_BUTTON_VIEW, pauseButtonShown, pauseButtonSlot } from "shared/view/menu";
import { useHudActions } from "./actions";
import { ArtImage } from "./primitives";
import { HighlightRing } from "./TutorialFx";

const HALF = 0.5;
const ROUND = new UDim(HALF, 0);
const BAR_OFFSET = (PAUSE_BUTTON_VIEW.barGap + PAUSE_BUTTON_VIEW.barWidth) / 2;
/** The button is in screen px (the top bar is not under the HUD's UIScale): its icon fits at UIScale 1. */
const SCREEN_PX = 1;

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

/** Today's code-drawn glyph: two bars (the fallback of the framed pause icon). */
function PauseBars() {
	return (
		<>
			<Bar x={-BAR_OFFSET} />
			<Bar x={BAR_OFFSET} />
		</>
	);
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
 * The on-screen pause button (mouse and touch; a pad pauses with Start): a round button in the Roblox top bar, right of
 * Roblox's own buttons (shared/view/menu pauseButtonSlot: on touch one Roblox button further right, for the voice
 * button TopbarInset leaves out), shown while a run is being played (shared/view/menu pauseButtonShown). A solo run
 * pauses (the pause overlay takes over, with Resume), a co-op run opens the party overlay. It acts on the PRESS, not
 * the release, so the click never reaches the game as an attack (HudActions.pause suppresses the mouse until released).
 * Its own ScreenGui without safe-area insets (GameHud): the top bar sits outside the HUD's safe area. Its glyph is the
 * framed pause icon when the pack has it (docs/UI_ART.md UA8; the one icon without a label: it has none today), else
 * the two code-drawn bars.
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
	const touch = useSelector(selectInputDevice) === "touch";
	// On touch the tutorial's map prompt ("Tap the pause button") rings this button (shared/view/hud touchTutorialRing).
	const ringed = pauseButtonRinged(useSelector(selectTutorialPrompt), touch);
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
	const slot = pauseButtonSlot({ x: inset.Min.X, y: inset.Min.Y, w: inset.Width, h: inset.Height }, touch);
	const size = slot.size;
	const position = UDim2.fromOffset(slot.x, slot.y);
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
			{ringed ? (
				<HighlightRing />
			) : (
				<uistroke
					ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
					Thickness={view.strokeThickness}
					Color={role(hover ? "uiAccent" : "uiTextDim")}
				/>
			)}
			<ArtImage
				name="Icon"
				id={UI_ART.ids.iconPause}
				box={{ w: size * view.iconFraction, h: size * view.iconFraction }}
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				uiScale={SCREEN_PX}
				fallback={<PauseBars />}
			/>
		</textbutton>
	);
}
