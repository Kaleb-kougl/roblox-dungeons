import React, { useContext } from "@rbxts/react";
import type { CharacterId } from "shared/characters";
import type { LobbyVisibility, LobbyWorld } from "shared/lobby";

/**
 * What the menu shell and the lobby screens can do (tasks L3 / L5). HudController builds it from MenuController and
 * LobbyController (and the Tutorial entry from TutorialController) and provides it to the tree, so components never
 * import controllers.
 */
export interface MenuActions {
	/** Main menu: the character screen, then a solo run (docs/ARCHER.md AR7). */
	readonly playSolo: () => void;
	/**
	 * The Daily (docs/DAILY.md): the character screen, then a ranked solo run in world "daily" on the server's seed of
	 * the day.
	 */
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
	/** The Codex screen (claude/codex-plan.md CX7). */
	readonly openCodex: () => void;
	/**
	 * The Codex screen closed: the entries whose NEW dots its visit cleared (their tiles were focused). CodexController
	 * sendViewed: the store's copy now, `codexViewed` soon.
	 */
	readonly codexViewed: (ids: ReadonlyArray<string>) => void;
	/** Roblox's invite prompt without a lobby (docs/INVITES.md ID7). */
	readonly inviteFriends: () => void;
	/** One screen back (the Back buttons). */
	readonly back: () => void;
	/** Pad B on a menu screen (docs/GAMEPAD_MENUS.md GM3), as Backspace: back with sfx.ui.back (none at the root). */
	readonly screenBack: () => void;
	/** Lobby browser. */
	readonly refreshLobbies: () => void;
	readonly createLobby: (visibility: LobbyVisibility) => void;
	readonly joinLobby: (lobbyId: string) => void;
	/** Lobby room. */
	readonly leaveLobby: () => void;
	readonly setReady: (ready: boolean) => void;
	/**
	 * The lobby room's Ready toggle (docs/ARCHER.md AR8): ready -> un-ready at once; not ready -> the character screen,
	 * whose Confirm readies with the pick (Back: still not ready).
	 */
	readonly toggleReady: () => void;
	/** The character screen (docs/ARCHER.md AR7): focus a card (a tap, a click, the pad's selection). */
	readonly focusCharacter: (id: CharacterId) => void;
	/** Confirm with a card (the pad's A on it), or the focused one (Start). */
	readonly confirmCharacter: (id?: CharacterId) => void;
	/** Back: the screen under it, or the menu closes (the run-over panel, the outro, a dev run show again). */
	readonly characterBack: () => void;
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
	openCodex: nothing,
	codexViewed: nothing,
	inviteFriends: nothing,
	back: nothing,
	screenBack: nothing,
	refreshLobbies: nothing,
	createLobby: nothing,
	joinLobby: nothing,
	leaveLobby: nothing,
	setReady: nothing,
	toggleReady: nothing,
	focusCharacter: nothing,
	confirmCharacter: nothing,
	characterBack: nothing,
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
