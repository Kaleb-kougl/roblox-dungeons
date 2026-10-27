import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import {
	selectAwaitingFirstRun,
	selectGameActive,
	selectMenuScreen,
	selectRunStarting,
	selectTutorialActive,
} from "client/store";
import { Panel, Text, useHudScale } from "client/ui/hud";
import { role, str } from "client/ui/theme";
import { MENU_STRINGS, MENU_VIEW } from "shared/view/menu";
import { LobbyBrowser } from "./LobbyBrowser";
import { LobbyRoom } from "./LobbyRoom";
import { MainMenu } from "./MainMenu";
import { InviteBadge, InviteToasts, NoticeToasts } from "./Toasts";

const HALF = 0.5;

/**
 * The menu shell (tasks L3 / L5), its own ScreenGui between the HUD and the pause / settings layer
 * (MENU_VIEW.displayOrder): while a menu screen is up, a backdrop over the world and the screen (main menu, lobby
 * browser, lobby room) with the invite toasts; during a run, the invite badge; always, the lobby notices; while a run
 * start waits for the server, "Starting run...". On join, until the first-run gate decided (a first-time player goes
 * straight into the tutorial), the backdrop alone. The invite badge is hidden during a tutorial run (nothing there can
 * take the player out of it). Same reference layout and UIScale as the HUD.
 */
export function MenuLayer() {
	const screen = useSelector(selectMenuScreen);
	const active = useSelector(selectGameActive);
	const starting = useSelector(selectRunStarting);
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
			{body === undefined && starting ? (
				<Panel position={UDim2.fromScale(HALF, HALF)} anchor={new Vector2(HALF, HALF)} name="Starting">
					<Text fill={true} order={1} color="uiAccent" text={str(MENU_STRINGS.starting)} />
				</Panel>
			) : undefined}
			<NoticeToasts key="Notices" />
		</screengui>
	);
}
