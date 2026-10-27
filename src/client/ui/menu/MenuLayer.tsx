import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectAwaitingFirstRun, selectGameActive, selectMenuScreen, selectTutorialActive } from "client/store";
import { useHudScale } from "client/ui/hud";
import { role } from "client/ui/theme";
import { MENU_VIEW } from "shared/view/menu";
import { LobbyBrowser } from "./LobbyBrowser";
import { LobbyRoom } from "./LobbyRoom";
import { MainMenu } from "./MainMenu";
import { InviteBadge, InviteToasts, NoticeToasts } from "./Toasts";

/**
 * The menu shell (tasks L3 / L5), its own ScreenGui between the HUD and the pause / settings layer
 * (MENU_VIEW.displayOrder): while a menu screen is up, a backdrop over the world and the screen (main menu, lobby
 * browser, lobby room) with the invite toasts; during a run, the invite badge; always, the lobby notices. (A run start
 * waiting for the server shows the stage loader's "Starting run..." cover: client/ui/loading StageCard,
 * docs/STAGE_LOADER.md SL3.) On join, until the first-run gate decided (a first-time player goes
 * straight into the tutorial), the backdrop alone. The invite badge is hidden during a tutorial run (nothing there can
 * take the player out of it). Same reference layout and UIScale as the HUD.
 */
export function MenuLayer() {
	const screen = useSelector(selectMenuScreen);
	const active = useSelector(selectGameActive);
	const awaitingFirstRun = useSelector(selectAwaitingFirstRun);
	const inTutorial = useSelector(selectTutorialActive);
	const scale = useHudScale();
	let body: React.Element | undefined;
	if (screen === "main") body = <MainMenu key="Main" />;
	else if (screen === "lobbies") body = <LobbyBrowser key="Lobbies" />;
	else if (screen === "lobby") body = <LobbyRoom key="Lobby" />;
	return (
		<screengui
			key="KV_MenuShell"
			ResetOnSpawn={false}
			DisplayOrder={MENU_VIEW.displayOrder}
			ScreenInsets={Enum.ScreenInsets.CoreUISafeInsets}
			ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
		>
			<uiscale Scale={scale} />
			{body !== undefined || (awaitingFirstRun && !active) ? (
				<frame
					key="Backdrop"
					Size={UDim2.fromScale(1, 1)}
					BackgroundColor3={role("background")}
					BackgroundTransparency={MENU_VIEW.backdropTransparency}
					BorderSizePixel={0}
				>
					{body}
					{body !== undefined ? <InviteToasts key="Invites" /> : undefined}
				</frame>
			) : undefined}
			{body === undefined && active && !inTutorial ? <InviteBadge key="InviteBadge" /> : undefined}
			<NoticeToasts key="Notices" />
		</screengui>
	);
}
