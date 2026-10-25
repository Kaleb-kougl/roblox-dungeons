import React, { useContext } from "@rbxts/react";
import type { LobbyVisibility } from "shared/lobby";

/**
 * What the menu shell and the lobby screens can do (tasks L3 / L5). HudController builds it from MenuController and
 * LobbyController and provides it to the tree, so components never import controllers.
 */
export interface MenuActions {
	/** Main menu. */
	readonly playSolo: () => void;
	/** Lobbies: the browser, or straight to the lobby room while in a lobby. */
	readonly openLobbies: () => void;
	readonly openLobbyRoom: () => void;
	readonly openOptions: () => void;
	readonly openLeaderboard: () => void;
	/** One screen back (also pad B / Backspace). */
	readonly back: () => void;
	/** Lobby browser. */
	readonly refreshLobbies: () => void;
	readonly createLobby: (visibility: LobbyVisibility) => void;
	readonly joinLobby: (lobbyId: string) => void;
	/** Lobby room. */
	readonly leaveLobby: () => void;
	readonly setReady: (ready: boolean) => void;
	readonly startLobby: () => void;
	readonly kick: (userId: number) => void;
	readonly makeHost: (userId: number) => void;
	readonly setVisibility: (visibility: LobbyVisibility) => void;
	/** Host: the next preset name. */
	readonly rename: () => void;
	readonly invite: (userId: number) => void;
	/** Invite toasts. */
	readonly answerInvite: (inviteId: string, accept: boolean) => void;
	/** A menu sound by theme ID (sfx.ui.click / sfx.ui.confirm). */
	readonly playUi: (id: string) => void;
}

const nothing = () => undefined;

const NOOP: MenuActions = {
	playSolo: nothing,
	openLobbies: nothing,
	openLobbyRoom: nothing,
	openOptions: nothing,
	openLeaderboard: nothing,
	back: nothing,
	refreshLobbies: nothing,
	createLobby: nothing,
	joinLobby: nothing,
	leaveLobby: nothing,
	setReady: nothing,
	startLobby: nothing,
	kick: nothing,
	makeHost: nothing,
	setVisibility: nothing,
	rename: nothing,
	invite: nothing,
	answerInvite: nothing,
	playUi: nothing,
};

export const MenuActionsContext = React.createContext<MenuActions>(NOOP);

export function useMenuActions(): MenuActions {
	return useContext(MenuActionsContext);
}
