import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectInviteEligible, selectMyLobbyId, selectSoloBest } from "client/store";
import { MenuButton, MenuFit, Panel, Row, Text } from "client/ui/hud";
import { str } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_STRINGS, HUD_VIEW, NEW_BEST_STRINGS, UI_ART, bestText } from "shared/view/hud";
import { TUTORIAL_STRINGS } from "shared/tutorial";
import {
	DAILY_MENU,
	MENU_FIT,
	MENU_STRINGS,
	MENU_VIEW,
	mainMenuLobbyKey,
	platformInviteButton,
	screenOrnament,
	screenSkin,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { DailyCard, DailyPodiumStrip } from "./DailyCard";
import { useGamepadFocus } from "./hooks";

/**
 * The main menu (task L3), shown on join instead of a run: the game title, Play solo (a ranked solo run), Lobbies
 * (the browser; "Your lobby" goes straight to the room while in one), Invite friends (Roblox's invite prompt, no
 * lobby attached: docs/INVITES.md ID7; disabled with the reason when the server says this player cannot), Tutorial (the first-run Practice Descent again,
 * docs/TUTORIAL.md), Options (the Options screen) and Leaderboard (the leaderboard panel). With a gamepad the
 * selection starts on Play solo. Fitted into the safe area on touch (MenuFit); compact or narrow (a phone, landscape
 * or portrait): the buttons in two columns, the invite reason under them. Under Play solo (compact: under its row), once the server's records loaded
 * and the solo board has one, the player's solo best (`Best 48210 · floor 9`, docs/NEW_BEST.md NB9: menu.best).
 *
 * The Daily (docs/DAILY.md DS9): beside the button column (compact: under Play solo's row, before the other buttons)
 * the Daily card (DailyCard: label and date, roster and boss preview, best today, countdown, Play Daily, Daily with
 * friends) and under it yesterday's podium (DailyPodiumStrip, hidden when empty). Play solo keeps the pad's first
 * selection; the card never blocks it.
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
	const reason = (order: number) =>
		invite.reasonKey !== undefined ? (
			<Text
				key="InviteReason"
				order={order}
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
	// The menu's button column (desktop: beside the Daily column) and the Daily column (card, then the podium).
	const columnWidth = MENU_VIEW.mainWidth - HUD_VIEW.pad * 4;
	const compactInner = MENU_FIT.mainCompactWidth - HUD_VIEW.pad * 4;
	return (
		<MenuFit
			ornament={screenOrnament("mainMenu")}
			render={(layout) => {
				// A phone in either orientation: the stacked two-column layout (the Daily card under Play solo's row).
				const stacked = layout.compact || layout.narrow;
				return (
					<Panel
						width={
							stacked
								? MENU_FIT.mainCompactWidth
								: MENU_VIEW.mainWidth + HUD_VIEW.gap + DAILY_MENU.cardWidth
						}
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
						{stacked ? (
							<>
								<Row key="Row1" order={2}>
									{play}
									{lobbies}
								</Row>
								{best}
								<DailyCard key="Daily" order={4} width={compactInner} compact={true} />
								<DailyPodiumStrip key="Podium" order={5} width={compactInner} compact={true} />
								<Row key="Row2" order={6}>
									{inviteButton}
									{tutorial}
								</Row>
								<Row key="Row3" order={7}>
									{options}
									{leaderboard}
								</Row>
								{reason(8)}
							</>
						) : (
							<Columns key="Columns" order={2}>
								<Column key="Menu" order={1} width={columnWidth}>
									{play}
									{best}
									{lobbies}
									{inviteButton}
									{reason(6)}
									{tutorial}
									{options}
									{leaderboard}
								</Column>
								<Column key="Daily" order={2} width={DAILY_MENU.cardWidth}>
									<DailyCard key="Card" order={1} width={DAILY_MENU.cardWidth} compact={false} />
									<DailyPodiumStrip
										key="Podium"
										order={2}
										width={DAILY_MENU.cardWidth}
										compact={false}
									/>
								</Column>
							</Columns>
						)}
					</Panel>
				);
			}}
		/>
	);
}

/** Side-by-side columns, tops aligned. */
function Columns(props: { order: number; children?: React.ReactNode }) {
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2()}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundTransparency={1}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Top}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{props.children}
		</frame>
	);
}

/** A fixed-width, centred vertical column (fixed, so filling text resolves against it). */
function Column(props: { order: number; width: number; children?: React.ReactNode }) {
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={1}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{props.children}
		</frame>
	);
}
