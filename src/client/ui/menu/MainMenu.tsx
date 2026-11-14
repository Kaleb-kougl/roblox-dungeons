import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import {
	selectCodexNewCount,
	selectCodexStatus,
	selectInviteEligible,
	selectMyLobbyId,
	selectSoloBest,
	selectWallet,
	selectWalletState,
} from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, MenuFit, PadHintBar, Panel, Row, SilverAmount, Text } from "client/ui/hud";
import { str } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_STRINGS, HUD_VIEW, NEW_BEST_STRINGS, UI_ART, bestText } from "shared/view/hud";
import { TUTORIAL_STRINGS } from "shared/tutorial";
import { CODEX_SCREEN_STRINGS, codexBadgeText } from "shared/view/codex";
import { SILVER } from "shared/silver";
import { ARMORY_KEYS } from "shared/theme";
import { statusBalance, walletShown } from "shared/view/silver";
import {
	CREDIT_STRINGS,
	DAILY_MENU,
	MENU_FIT,
	MENU_STRINGS,
	MENU_VIEW,
	armoryBadge,
	mainMenuLobbyKey,
	platformInviteButton,
	screenOrnament,
	screenSkin,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { DailyCard, DailyPodiumStrip } from "./DailyCard";

const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);

/**
 * The main menu (task L3), shown on join instead of a run: the game title, Play solo (a ranked solo run), Lobbies
 * (the browser; "Your lobby" goes straight to the room while in one), Invite friends (Roblox's invite prompt, no
 * lobby attached: docs/INVITES.md ID7; disabled with the reason when the server says this player cannot), Tutorial (the first-run Practice Descent again,
 * docs/TUTORIAL.md), Options (the Options screen), Leaderboard (the leaderboard panel), the Codex (its screen and the
 * NEW badge, claude/codex-plan.md CX7) and Credits (the Credits screen, shared/view/menu credits.ts). With a gamepad the
 * selection starts on Play solo. Fitted into the safe area on touch (MenuFit); compact or narrow (a phone, landscape
 * or portrait): the buttons in two columns, the invite reason under them. Under Play solo (compact: under its row), once the server's records loaded
 * and the solo board has one, the player's solo best (`Best 48210 · floor 9`, docs/NEW_BEST.md NB9: menu.best).
 *
 * The Daily (docs/DAILY.md DS9): beside the button column (compact: under Play solo's row, before the other buttons)
 * the Daily card (DailyCard: label and date, roster and boss preview, best today, countdown, Play Daily, Daily with
 * friends) and under it yesterday's podium (DailyPodiumStrip, hidden when empty). Play solo keeps the pad's first
 * selection; the card never blocks it. A `screen` focus scope with memory (docs/GAMEPAD_MENUS.md GM2): back from
 * Lobbies or Credits, or a panel closing, lands on the button that opened it. B does nothing at the root; Y jumps to
 * the newest invite toast while one is pending (GM6); on a gamepad the hint bar sits at the panel's bottom (GM7).
 *
 * Silver (docs/SILVER.md SV9): under the title the Silver balance and `First run today: +50` until today's first paying
 * run (a phone: the Armory's small button at the line's end; the desktop column has the Armory as a full button after
 * the Codex), its badge a dot while a next level the balance covers is unseen in the Armory.
 */
export function MainMenu(props: {
	/** An invite toast is on screen (the pad's Y jumps to it, docs/GAMEPAD_MENUS.md GM6). */
	invitePending: boolean;
	/** Y: hand the pad to the invite toasts (MenuLayer). */
	onJumpToInvites: () => void;
}) {
	const actions = useMenuActions();
	const padContext = { invitePending: props.invitePending };
	const myLobby = useSelector(selectMyLobbyId);
	const eligible = useSelector(selectInviteEligible);
	const soloBest = useSelector(selectSoloBest);
	const codexNew = useSelector(selectCodexNewCount);
	const codexUnavailable = useSelector(selectCodexStatus) === "unavailable";
	const invite = platformInviteButton(eligible);
	// docs/SILVER.md SV9: the Silver balance, today's first-run bonus while open, the Armory button and its dot.
	const wallet = useSelector(selectWallet);
	const walletState = useSelector(selectWalletState);
	const walletStatus = walletShown(wallet);
	const armoryDot = armoryBadge(wallet, walletState.seenAffordable);
	const playRef = useRef<TextButton>();
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
	// claude/codex-plan.md CX7 (R10): the Codex right after Leaderboard, its badge the count of NEW dots (`9+` above 9),
	// greyed while the Codex is unavailable this session (desktop: `Codex unavailable`; the phone's small button keeps
	// its name). Like Credits: a full button in the desktop column, a small one beside the invite reason on a phone.
	const codex = (small: boolean, order: number) => (
		<MenuButton
			key="Codex"
			order={order}
			name="Codex"
			size={small ? SMALL : undefined}
			textSize={small ? HUD_VIEW.smallText : undefined}
			text={str(codexUnavailable && !small ? CODEX_SCREEN_STRINGS.unavailable : CODEX_SCREEN_STRINGS.menu)}
			disabled={codexUnavailable}
			badge={codexUnavailable ? undefined : codexBadgeText(codexNew, str)}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				actions.openCodex();
			}}
		/>
	);
	// docs/SILVER.md SV9: the Armory after the Codex (desktop: a full button; a phone: a small one in the Silver line
	// under the title), its badge a dot while a next level the balance covers is unseen; greyed (desktop: `Armory
	// unavailable`) when the wallet could not be loaded this session.
	const armoryUnavailable = walletStatus === "unavailable";
	const armory = (small: boolean, order: number) => (
		<MenuButton
			key="Armory"
			order={order}
			name="Armory"
			size={small ? SMALL : undefined}
			textSize={small ? HUD_VIEW.smallText : undefined}
			text={str(armoryUnavailable && !small ? ARMORY_KEYS.unavailable : ARMORY_KEYS.menu)}
			disabled={armoryUnavailable}
			badge={!armoryUnavailable && armoryDot ? " " : undefined}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				actions.openArmory();
			}}
		/>
	);
	// The Silver line under the title: the balance and, until today's first paying run, `First run today: +50`
	// (a phone: the Armory's small button at its end). Nothing while the wallet is not loaded.
	const silverLine = (stacked: boolean) =>
		walletStatus === "loaded" || stacked ? (
			<Row key="Silver" order={1} align={Enum.HorizontalAlignment.Center}>
				{walletStatus === "loaded" ? (
					<SilverAmount
						order={1}
						size={HUD_VIEW.smallText}
						text={str(ARMORY_KEYS.balance, { silver: statusBalance(wallet) })}
					/>
				) : undefined}
				{walletStatus === "loaded" && wallet?.firstRunBonusOpen === true ? (
					<Text
						order={2}
						size={HUD_VIEW.smallText}
						color="uiTextDim"
						text={str(ARMORY_KEYS.firstRunOpen, { silver: SILVER.firstRunBonus })}
					/>
				) : undefined}
				{stacked ? armory(true, 3) : undefined}
			</Row>
		) : undefined;
	// Credits: a full button in the desktop column; on a phone a small one beside the invite reason (its own row
	// would cost the smallest phone the ornament, fit.spec.ts).
	const credits = (small: boolean, order: number) => (
		<MenuButton
			key="Credits"
			order={order}
			name="Credits"
			size={small ? SMALL : undefined}
			textSize={small ? HUD_VIEW.smallText : undefined}
			text={str(CREDIT_STRINGS.open)}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				actions.openCredits();
			}}
		/>
	);
	// The menu's button column (desktop: beside the Daily column) and the Daily column (card, then the podium).
	const columnWidth = MENU_VIEW.mainWidth - HUD_VIEW.pad * 4;
	const compactInner = MENU_FIT.mainCompactWidth - HUD_VIEW.pad * 4;
	return (
		<FocusScope
			name="MainMenuScope"
			id="main"
			layer="screen"
			surface="main"
			defaultRef={playRef}
			memoryKey="main"
			padContext={padContext}
			onPadAction={(action) => {
				if (action.kind !== "shortcutY" || action.meaning !== "invites" || !props.invitePending) return;
				actions.playUi(SFX.uiClick);
				props.onJumpToInvites();
			}}
		>
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
								order={0}
								size={HUD_VIEW.bigText}
								color="uiAccent"
								align={Enum.TextXAlignment.Center}
								text={str(HUD_STRINGS.title)}
							/>
							{silverLine(stacked)}
							{stacked ? (
								<>
									<Row key="Row1" order={2}>
										{play}
										{lobbies}
									</Row>
									{best}
									<DailyCard key="Daily" order={5} width={compactInner} compact={true} />
									<DailyPodiumStrip key="Podium" order={6} width={compactInner} compact={true} />
									<Row key="Row2" order={7}>
										{inviteButton}
										{tutorial}
									</Row>
									<Row key="Row3" order={8}>
										{options}
										{leaderboard}
									</Row>
									<Row key="Row4" order={9}>
										{invite.reasonKey !== undefined ? (
											<Text
												key="InviteReason"
												order={1}
												width={compactInner - 2 * (MENU_VIEW.smallButton.x + HUD_VIEW.gap)}
												size={HUD_VIEW.smallText}
												color="uiTextDim"
												align={Enum.TextXAlignment.Center}
												wrap={true}
												text={str(invite.reasonKey)}
											/>
										) : undefined}
										{codex(true, 2)}
										{credits(true, 3)}
									</Row>
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
										{codex(false, 10)}
										{armory(false, 11)}
										{credits(false, 12)}
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
							<PadHintBar order={10} surface="main" context={padContext} />
						</Panel>
					);
				}}
			/>
		</FocusScope>
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
