import { keyDevice } from "shared/play";
import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectMenuScreen, selectTutorialOutroOpen } from "client/store";
import { useFocusScope } from "client/ui/focus";
import { str } from "client/ui/theme";
import { TUTORIAL_STRINGS } from "shared/tutorial";
import { SFX } from "shared/view/audio";
import { HUD_VIEW, LEADERBOARD_STRINGS, TUTORIAL_VIEW, tutorialLeaderboardHint } from "shared/view/hud";
import { useHudActions } from "./actions";
import { MenuFit } from "./MenuFit";
import { PadHintBar } from "./PadHintBar";
import { MenuButton, Panel, Text } from "./primitives";
import { ScreenDim } from "./ScreenDim";
import { screenSkin } from "shared/view/menu";

const BUTTON = new Vector2(TUTORIAL_VIEW.outroButtonSize.x, TUTORIAL_VIEW.outroButtonSize.y);

/**
 * The tutorial's outro card (menu layer; docs/TUTORIAL.md "Outro card"), a beat after the tutorial ended: what a real
 * run is (no respawns, harder floors, the leaderboard and where it opens: the bound key), then Start my first run
 * (the character screen, then a solo run: docs/ARCHER.md AR7) or Play the tutorial again. A menu like the pause overlay: the scene dimmed, gamepad
 * selection on its first button (an `overlay` focus scope, no memory; B does nothing: docs/GAMEPAD_MENUS.md GM2 / GM3;
 * HudController lets the pad's navigation keys through while it is open), mouse buttons read released after a click.
 */
export function TutorialOutro() {
	// docs/ARCHER.md AR7: Start my first run opens the character screen over the card, which hides (and gives up the
	// pad) until the screen's Back shows it again or its Confirm closes it.
	const outroOpen = useSelector(selectTutorialOutroOpen);
	const screen = useSelector(selectMenuScreen);
	const open = outroOpen && screen === "none";
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const actions = useHudActions();
	const startRef = useRef<TextButton>();
	const rootRef = useRef<Frame>();
	useFocusScope(rootRef, { id: "outro", layer: "overlay", surface: "outro", defaultRef: startRef, active: open });

	if (!open) return undefined;
	return (
		<frame
			key="TutorialOutro"
			ref={rootRef}
			Size={UDim2.fromScale(1, 1)}
			BackgroundTransparency={1}
			BorderSizePixel={0}
		>
			<ScreenDim key="Dim" name="TutorialOutroDim" transparency={HUD_VIEW.overlayTransparency} />
			<MenuFit
				render={() => (
					<Panel
						width={TUTORIAL_VIEW.outroWidth}
						align={Enum.HorizontalAlignment.Center}
						padding={HUD_VIEW.pad * 2}
						skin={screenSkin("tutorialOutro")}
					>
						<Text
							fill={true}
							order={1}
							size={HUD_VIEW.bigText}
							color="uiAccent"
							align={Enum.TextXAlignment.Center}
							text={str(TUTORIAL_STRINGS.outroTitle)}
						/>
						<Text
							order={2}
							size={HUD_VIEW.titleText}
							align={Enum.TextXAlignment.Center}
							wrap={true}
							text={str(TUTORIAL_STRINGS.outroBody, {
								// Touch: no key; the pause menu's Leaderboards item is the way there.
								key:
									device === "touch"
										? str(LEADERBOARD_STRINGS.open)
										: tutorialLeaderboardHint(bindings, str)[keyDevice(device)],
							})}
						/>
						<MenuButton
							ref={startRef}
							order={3}
							name="StartRun"
							size={BUTTON}
							text={str(TUTORIAL_STRINGS.outroStart)}
							onActivated={() => {
								actions.playUi(SFX.uiConfirm);
								actions.startFirstRun();
							}}
						/>
						<MenuButton
							order={4}
							name="Replay"
							size={BUTTON}
							text={str(TUTORIAL_STRINGS.outroReplay)}
							onActivated={() => {
								actions.playUi(SFX.uiClick);
								actions.playTutorial();
							}}
						/>
						<PadHintBar order={5} surface="outro" />
					</Panel>
				)}
			/>
		</frame>
	);
}
