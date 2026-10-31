import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectInviteEligible, selectMyLobbyId, selectSoloBest } from "client/store";
import { MenuButton, MenuFit, Panel, Row, Text } from "client/ui/hud";
import { str } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_STRINGS, HUD_VIEW, NEW_BEST_STRINGS, UI_ART, bestText } from "shared/view/hud";
import { TUTORIAL_STRINGS } from "shared/tutorial";
import {
	MENU_FIT,
	MENU_STRINGS,
	MENU_VIEW,
	mainMenuLobbyKey,
	platformInviteButton,
	screenOrnament,
	screenSkin,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { useGamepadFocus } from "./hooks";

/**
 * The main menu (task L3), shown on join instead of a run: the game title, Play solo (a ranked solo run), Lobbies
 * (the browser; "Your lobby" goes straight to the room while in one), Invite friends (Roblox's invite prompt, no
 * lobby attached: docs/INVITES.md ID7; disabled with the reason when the server says this player cannot), Tutorial (the first-run Practice Descent again,
 * docs/TUTORIAL.md), Options (the Options screen) and Leaderboard (the leaderboard panel). With a gamepad the
 * selection starts on Play solo. Fitted into the safe area on touch (MenuFit); compact (a phone): the buttons in two
 * columns, the invite reason under them. Under Play solo (compact: under its row), once the server's records loaded
 * and the solo board has one, the player's solo best (`Best 48210 · floor 9`, docs/NEW_BEST.md NB9: menu.best).
 */
export function MainMenu() {
	const actions = useMenuActions();
	const myLobby = useSelector(selectMyLobbyId);
	const eligible = useSelector(selectInviteEligible);
	const soloBest = useSelector(selectSoloBest);
	const invite = platformInviteButton(eligible);
	const playRef = useRef<TextButton>();
	useGamepadFocus(playRef, "main");
	const inLobby = myLobby !== undefined;
	const play = (
		<MenuButton
			key="PlaySolo"
			ref={playRef}
			order={2}
			name="PlaySolo"
			text={str(MENU_STRINGS.playSolo)}
			onActivated={() => {
				actions.playUi(SFX.uiConfirm);
				actions.playSolo();
			}}
		/>
	);
	const bestLine = bestText(soloBest, NEW_BEST_STRINGS.menu, str);
	const best =
		bestLine !== "" ? (
			<Text
				key="Best"
				order={3}
				fill={true}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={bestLine}
			/>
		) : undefined;
	const lobbies = (
		<MenuButton
			key="Lobbies"
			order={4}
			name="Lobbies"
			text={str(mainMenuLobbyKey(inLobby))}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				if (inLobby) actions.openLobbyRoom();
				else actions.openLobbies();
			}}
		/>
	);
	const inviteButton = (
		<MenuButton
			key="InviteFriends"
			order={5}
			name="InviteFriends"
			text={str(MENU_STRINGS.inviteFriends)}
			disabled={!invite.enabled}
			onActivated={() => {
				actions.playUi(SFX.uiConfirm);
				actions.inviteFriends();
			}}
		/>
	);
	const reason =
		invite.reasonKey !== undefined ? (
			<Text
				key="InviteReason"
				order={6}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				wrap={true}
				text={str(invite.reasonKey)}
			/>
		) : undefined;
	const tutorial = (
		<MenuButton
			key="Tutorial"
			order={7}
			name="Tutorial"
			text={str(TUTORIAL_STRINGS.menuOpen)}
			onActivated={() => {
				actions.playUi(SFX.uiConfirm);
				actions.playTutorial();
			}}
		/>
	);
	const options = (
		<MenuButton
			key="Options"
			order={8}
			name="Options"
			text={str(MENU_STRINGS.options)}
			icon={UI_ART.ids.iconGear}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				actions.openOptions();
			}}
		/>
	);
	const leaderboard = (
		<MenuButton
			key="Leaderboard"
			order={9}
			name="Leaderboard"
			text={str(MENU_STRINGS.leaderboard)}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				actions.openLeaderboard();
			}}
		/>
	);
	return (
		<MenuFit
			ornament={screenOrnament("mainMenu")}
			render={(layout) => (
				<Panel
					width={layout.compact ? MENU_FIT.mainCompactWidth : MENU_VIEW.mainWidth}
					align={Enum.HorizontalAlignment.Center}
					padding={HUD_VIEW.pad * 2}
					skin={screenSkin("mainMenu")}
					ornament={layout.ornament}
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
					{layout.compact ? (
						<>
							<Row key="Row1" order={2}>
								{play}
								{lobbies}
							</Row>
							{best}
							<Row key="Row2" order={4}>
								{inviteButton}
								{tutorial}
							</Row>
							<Row key="Row3" order={5}>
								{options}
								{leaderboard}
							</Row>
							{reason}
						</>
					) : (
						<>
							{play}
							{best}
							{lobbies}
							{inviteButton}
							{reason}
							{tutorial}
							{options}
							{leaderboard}
						</>
					)}
				</Panel>
			)}
		/>
	);
}
