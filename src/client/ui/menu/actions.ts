import React, { useContext } from "@rbxts/react";
import type { LobbyVisibility, LobbyWorld } from "shared/lobby";

/**
 * What the menu shell and the lobby screens can do (tasks L3 / L5). HudController builds it from MenuController and
 * LobbyController (and the Tutorial entry from TutorialController) and provides it to the tree, so components never
 * import controllers.
 */
export interface MenuActions {
	/** Main menu. */
	readonly playSolo: () => void;
	/** The Daily (docs/DAILY.md): a ranked solo run in world "daily" on the server's seed of the day. */
	readonly playDaily: () => void;
	/**
	 * "Daily with friends" (docs/DAILY.md DS9): a lobby on the daily world. In a lobby: its room (the host's forming
	 * lobby switches to the Daily); else a new friends-visible lobby created on the daily world.
	 */
	readonly playDailyParty: () => void;
	/** Lobbies: the browser, or straight to the lobby room while in a lobby. */
	readonly openLobbies: () => void;
	readonly openLobbyRoom: () => void;
	/** The first-run tutorial again (a practice run; docs/TUTORIAL.md). */
	readonly playTutorial: () => void;
	readonly openOptions: () => void;
	readonly openLeaderboard: () => void;
	/** The Credits screen (shared/view/menu credits.ts). */
	readonly openCredits: () => void;
	/** Roblox's invite prompt without a lobby (docs/INVITES.md ID7). */
	readonly inviteFriends: () => void;
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
	/** Host, while forming: the lobby's world (endless / daily, shared/lobby LobbyWorld). */
	readonly setLobbyWorld: (worldKind: LobbyWorld) => void;
	/** Host: the next preset name. */
	readonly rename: () => void;
	readonly invite: (userId: number) => void;
	/** Roblox's invite prompt with this player's lobby attached. */
	readonly inviteFriendsToLobby: () => void;
	/** Invite toasts. */
	readonly answerInvite: (inviteId: string, accept: boolean) => void;
	/** A menu sound by theme ID (sfx.ui.click / sfx.ui.confirm). */
	readonly playUi: (id: string) => void;
}

const nothing = () => undefined;

const NOOP: MenuActions = {
	playSolo: nothing,
	playDaily: nothing,
	playDailyParty: nothing,
	openLobbies: nothing,
	openLobbyRoom: nothing,
	playTutorial: nothing,
	openOptions: nothing,
	openLeaderboard: nothing,
	openCredits: nothing,
	inviteFriends: nothing,
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
	setLobbyWorld: nothing,
	rename: nothing,
	invite: nothing,
	inviteFriendsToLobby: nothing,
	answerInvite: nothing,
	playUi: nothing,
};

export const MenuActionsContext = React.createContext<MenuActions>(NOOP);

export function useMenuActions(): MenuActions {
	return useContext(MenuActionsContext);
}
