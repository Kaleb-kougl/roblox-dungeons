import React, { useEffect, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import {
	selectAwaitingFirstRun,
	selectGameActive,
	selectMenuPointerSink,
	selectMenuScreen,
	selectTutorialActive,
} from "client/store";
import { useHudScale } from "client/ui/hud";
import { role } from "client/ui/theme";
import { MENU_VIEW } from "shared/view/menu";
import { CharacterScreen } from "./CharacterScreen";
import { CreditsScreen } from "./CreditsScreen";
import { LobbyBrowser } from "./LobbyBrowser";
import { LobbyRoom } from "./LobbyRoom";
import { MainMenu } from "./MainMenu";
import { InviteBadge, InviteToasts, NoticeToasts, useInviteToasts } from "./Toasts";

/**
 * The menu shell (tasks L3 / L5), its own ScreenGui between the HUD and the pause / settings layer
 * (MENU_VIEW.displayOrder): while a menu screen is up, the screen (main menu, lobby browser, lobby room, credits, the
 * character screen: docs/ARCHER.md AR7, also over a finished run, the tutorial outro or a paused dev run) with the
 * invite toasts, over a backdrop that covers the whole screen (its own ScreenGui KV_MenuBackdrop just under the shell,
 * ScreenInsets None: under the Roblox top bar and into a phone's notch insets, docs/UI_ART.md "Phones"); during a
 * run, the invite badge; always, the lobby notices. (A run start waiting for the server shows the stage loader's
 * "Starting run..." cover: client/ui/loading StageCard, docs/STAGE_LOADER.md SL3.) On join, until the first-run gate decided (a first-time player goes
 * straight into the tutorial), the backdrop alone. The invite badge is hidden during a tutorial run (nothing there can
 * take the player out of it). Same reference layout and UIScale as the HUD. The main menu's Y hands the pad to the
 * invite toasts (docs/GAMEPAD_MENUS.md GM6) while one is pending; B there hands it back. While a panel (Options,
 * leaderboards) is open over a screen, an invisible Active button covers it (PointerSink, shared/view/menu pointer.ts):
 * the panel's dim lets clicks through, and the main menu under Options stayed clickable.
 */
export function MenuLayer() {
	const screen = useSelector(selectMenuScreen);
	const active = useSelector(selectGameActive);
	const awaitingFirstRun = useSelector(selectAwaitingFirstRun);
	const inTutorial = useSelector(selectTutorialActive);
	const pointerSink = useSelector(selectMenuPointerSink);
	const scale = useHudScale();
	// docs/GAMEPAD_MENUS.md GM6: the invite toasts take the pad only once the main menu's Y jumps to them, and give it
	// back on B, when the last toast goes, or when the screen changes.
	const invites = useInviteToasts();
	const [invitesFocused, setInvitesFocused] = useState(false);
	const pending = invites.size() > 0;
	useEffect(() => {
		if (invitesFocused && (!pending || screen !== "main")) setInvitesFocused(false);
	}, [invitesFocused, pending, screen]);
	let body: React.Element | undefined;
	if (screen === "main") {
		body = <MainMenu key="Main" invitePending={pending} onJumpToInvites={() => setInvitesFocused(true)} />;
	} else if (screen === "lobbies") body = <LobbyBrowser key="Lobbies" />;
	else if (screen === "lobby") body = <LobbyRoom key="Lobby" />;
	else if (screen === "credits") body = <CreditsScreen key="Credits" />;
	else if (screen === "character") body = <CharacterScreen key="Character" />;
	const backdrop = body !== undefined || (awaitingFirstRun && !active);
	return (
		<>
			<screengui
				key="KV_MenuBackdrop"
				ResetOnSpawn={false}
				AutoLocalize={false}
				DisplayOrder={MENU_VIEW.backdropDisplayOrder}
				IgnoreGuiInset={true}
				ScreenInsets={Enum.ScreenInsets.None}
				Enabled={backdrop}
			>
				<frame
					key="Backdrop"
					Size={UDim2.fromScale(1, 1)}
					BackgroundColor3={role("background")}
					BackgroundTransparency={MENU_VIEW.backdropTransparency}
					BorderSizePixel={0}
				/>
			</screengui>
			<screengui
				key="KV_MenuShell"
				ResetOnSpawn={false}
				AutoLocalize={false}
				DisplayOrder={MENU_VIEW.displayOrder}
				ScreenInsets={Enum.ScreenInsets.CoreUISafeInsets}
				ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
			>
				<uiscale Scale={scale} />
				{backdrop ? (
					<frame key="Screen" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={1} BorderSizePixel={0}>
						{body}
						{body !== undefined ? (
							<InviteToasts
								key="Invites"
								invites={invites}
								focused={invitesFocused && screen === "main"}
								onLeave={() => setInvitesFocused(false)}
							/>
						) : undefined}
						{body !== undefined && pointerSink ? (
							// A panel (Options, leaderboards) is open over the screen: its dim is not Active, so this
							// invisible Active button takes mouse / touch instead of the screen's buttons (pointer.ts).
							<textbutton
								key="PointerSink"
								Size={UDim2.fromScale(1, 1)}
								ZIndex={MENU_VIEW.pointerSinkZIndex}
								BackgroundTransparency={1}
								BorderSizePixel={0}
								AutoButtonColor={false}
								Selectable={false}
								Active={true}
								Text=""
							/>
						) : undefined}
					</frame>
				) : undefined}
				{body === undefined && active && !inTutorial ? <InviteBadge key="InviteBadge" /> : undefined}
				<NoticeToasts key="Notices" />
			</screengui>
		</>
	);
}
