import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectMyLobbyId } from "client/store";
import { MenuButton, Panel, Text } from "client/ui/hud";
import { str } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_STRINGS, HUD_VIEW } from "shared/view/hud";
import { TUTORIAL_STRINGS } from "shared/tutorial";
import { MENU_STRINGS, MENU_VIEW, mainMenuLobbyKey } from "shared/view/menu";
import { useMenuActions } from "./actions";
import { useGamepadFocus } from "./hooks";

const HALF = 0.5;

/**
 * The main menu (task L3), shown on join instead of a run: the game title, Play solo (a ranked solo run), Lobbies
 * (the browser; "Your lobby" goes straight to the room while in one), Tutorial (the first-run Practice Descent again,
 * docs/TUTORIAL.md), Options (the Options screen) and Leaderboard (the leaderboard panel). With a gamepad the
 * selection starts on Play solo.
 */
export function MainMenu() {
	const actions = useMenuActions();
	const myLobby = useSelector(selectMyLobbyId);
	const playRef = useRef<TextButton>();
	useGamepadFocus(playRef, "main");
	const inLobby = myLobby !== undefined;
	return (
		<Panel
			position={UDim2.fromScale(HALF, HALF)}
			anchor={new Vector2(HALF, HALF)}
			width={MENU_VIEW.mainWidth}
			align={Enum.HorizontalAlignment.Center}
			padding={HUD_VIEW.pad * 2}
			name="MainMenu"
		>
			<Text
				fill={true}
				order={1}
				size={HUD_VIEW.bigText}
				color="uiAccent"
				align={Enum.TextXAlignment.Center}
				text={str(HUD_STRINGS.title)}
			/>
			<MenuButton
				ref={playRef}
				order={2}
				name="PlaySolo"
				text={str(MENU_STRINGS.playSolo)}
				onActivated={() => {
					actions.playUi(SFX.uiConfirm);
					actions.playSolo();
				}}
			/>
			<MenuButton
				order={3}
				name="Lobbies"
				text={str(mainMenuLobbyKey(inLobby))}
				onActivated={() => {
					actions.playUi(SFX.uiClick);
					if (inLobby) actions.openLobbyRoom();
					else actions.openLobbies();
				}}
			/>
			<MenuButton
				order={4}
				name="Tutorial"
				text={str(TUTORIAL_STRINGS.menuOpen)}
				onActivated={() => {
					actions.playUi(SFX.uiConfirm);
					actions.playTutorial();
				}}
			/>
			<MenuButton
				order={5}
				name="Options"
				text={str(MENU_STRINGS.options)}
				onActivated={() => {
					actions.playUi(SFX.uiClick);
					actions.openOptions();
				}}
			/>
			<MenuButton
				order={6}
				name="Leaderboard"
				text={str(MENU_STRINGS.leaderboard)}
				onActivated={() => {
					actions.playUi(SFX.uiClick);
					actions.openLeaderboard();
				}}
			/>
		</Panel>
	);
}
