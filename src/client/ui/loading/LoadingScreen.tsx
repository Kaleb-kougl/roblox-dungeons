import React, { useBinding, useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, RunService, TextChatService, UserInputService } from "@rbxts/services";
import { selectJuice, selectLoading } from "client/store";
import { useFocusScope } from "client/ui/focus";
import { MenuButton, Text, useHudScale } from "client/ui/hud";
import { str } from "client/ui/theme";
import { LOADING_STRINGS, LOADING_VIEW, PRELOAD } from "shared/view";
import { HUD_VIEW } from "shared/view/hud";
import { Cover, ProgressBar } from "./parts";

const HALF = 0.5;
const HIDDEN = 1;
const OPAQUE = 0;

/** A TextBox or the TextChatService chat bar has focus: Enter there is typing, not Skip. */
function typing(): boolean {
	if (UserInputService.GetFocusedTextBox() !== undefined) return true;
	const bar = TextChatService.FindFirstChildOfClass("ChatInputBarConfiguration");
	return bar !== undefined && bar.IsFocused;
}

export interface LoadingScreenProps {
	/** The Skip button (click, tap, Enter, pad A): PreloadController.skip, with the click sound. */
	readonly onSkip: () => void;
	/** The fade-out after the release finished (at once under reduced motion): unmount the screen. */
	readonly onFaded: () => void;
}

/**
 * The join loading screen (docs/PRELOAD.md P4), its own ScreenGui above every other layer of ours
 * (LOADING_VIEW.displayOrder; IgnoreGuiInset, so the opaque `background` cover reaches under the top bar). Centre
 * column under the HUD's UIScale (useHudScale): the title (`loading.title`), the core tier's progress bar (track
 * `uiTextDim`, fill `uiAccent`), `loading.progress` ("Loading {done} / {total}") and, once the Reflex `loading`
 * slice says so (after PRELOAD.skipAfterSec), the Skip button (`loading.skip`): a click or tap, Enter, or pad A
 * (with a gamepad it takes the GUI selection; HudController hands the pad to the GUI while the screen is up). Its
 * slot is reserved from the start, so nothing moves when it shows. On the release everything fades out over
 * PRELOAD.fadeSec (instant under reduced motion), then `onFaded`.
 */
export function LoadingScreen(props: LoadingScreenProps) {
	const loading = useSelector(selectLoading);
	const reducedMotion = useSelector(selectJuice).reducedMotion;
	const scale = useHudScale();
	const [fade, setFade] = useBinding(OPAQUE);
	const skipRef = useRef<TextButton>();
	const columnRef = useRef<Frame>();
	const showSkip = loading.skipVisible && !loading.released;
	// With a gamepad the selection starts (and stays) on Skip once it shows (a `loading` scope: above every other
	// layer, the stage cover included, until the release; docs/GAMEPAD_MENUS.md GM2).
	useFocusScope(columnRef, {
		id: "loading",
		layer: "loading",
		surface: "loading",
		defaultRef: skipRef,
		active: !loading.released,
	});

	// The fade-out, once released.
	useEffect(() => {
		if (!loading.released) return;
		if (reducedMotion || PRELOAD.fadeSec <= 0) {
			props.onFaded();
			return;
		}
		let t = 0;
		const conn = RunService.Heartbeat.Connect((dt) => {
			t += dt;
			const a = math.min(HIDDEN, t / PRELOAD.fadeSec);
			setFade(a);
			if (a >= HIDDEN) {
				conn.Disconnect();
				props.onFaded();
			}
		});
		return () => conn.Disconnect();
	}, [loading.released]);

	// Enter (and pad A when the GUI selection is elsewhere: on the button, the GUI's own press handles it).
	useEffect(() => {
		if (!showSkip) return;
		const conn = UserInputService.InputBegan.Connect((input) => {
			if (!LOADING_VIEW.skipKeys.includes(input.KeyCode.Name)) return;
			if (typing()) return;
			const button = skipRef.current;
			if (button !== undefined && GuiService.SelectedObject === button) return;
			props.onSkip();
		});
		return () => conn.Disconnect();
	}, [showSkip]);

	const width = LOADING_VIEW.width;
	const skip = LOADING_VIEW.skipButton;
	return (
		<screengui
			key="KV_Loading"
			ResetOnSpawn={false}
			AutoLocalize={false}
			DisplayOrder={LOADING_VIEW.displayOrder}
			IgnoreGuiInset={true}
			ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
		>
			<Cover transparency={fade} />
			<frame
				key="Column"
				ref={columnRef}
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={new UDim2(0, width, 0, 0)}
				AutomaticSize={Enum.AutomaticSize.Y}
				BackgroundTransparency={HIDDEN}
			>
				<uiscale Scale={scale} />
				<uilistlayout
					FillDirection={Enum.FillDirection.Vertical}
					HorizontalAlignment={Enum.HorizontalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, LOADING_VIEW.gap)}
				/>
				<Text
					order={1}
					width={width}
					size={HUD_VIEW.bigText}
					color="uiAccent"
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(LOADING_STRINGS.title)}
				/>
				<ProgressBar
					order={2}
					width={width}
					height={LOADING_VIEW.barHeight}
					fraction={loading.fraction}
					transparency={fade}
				/>
				<Text
					order={3}
					width={width}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(LOADING_STRINGS.progress, { done: loading.done, total: loading.total })}
				/>
				<frame
					key="SkipSlot"
					LayoutOrder={4}
					Size={new UDim2(0, skip.x, 0, skip.y)}
					BackgroundTransparency={HIDDEN}
				>
					{showSkip ? (
						<MenuButton
							ref={skipRef}
							order={1}
							name="Skip"
							size={new Vector2(skip.x, skip.y)}
							text={str(LOADING_STRINGS.skip)}
							onActivated={() => props.onSkip()}
						/>
					) : undefined}
				</frame>
			</frame>
		</screengui>
	);
}
