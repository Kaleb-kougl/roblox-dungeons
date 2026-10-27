import { createProducer } from "@rbxts/reflex";
import type { ArrivalJoinIntent } from "shared/invite";
import type { LobbySummary } from "shared/lobby";
import type { LobbyInviteView, LobbyView } from "shared/network";
import type { StringVars } from "shared/theme";
import type { ServerPlayer, StringSpec } from "shared/view/menu";

/**
 * Client-local Reflex slice for lobbies (task L5), fed by LobbyController from the server's lobby remotes: the
 * browse list (`lobbyList`), the lobby this player is in (`lobbyState`), the invites they received (`lobbyInvites`),
 * the notice toasts (`lobbyNotice`) and the players in this server (the invite list and every display name); for
 * Roblox invites (docs/INVITES.md I5) whether this player may send them (`inviteEligible`) and how the server handled
 * their arrival (`joinIntent`, which the first-join choice waits for).
 * Countdown and invite expiry are durations, so the arrival time (os.clock) is kept with them.
 */
export interface LobbyNoticeToast {
	/** Serial, for React keys. */
	readonly id: number;
	readonly key: string;
	readonly vars?: StringVars;
	/** partyLobby: the lobby's title, resolved into the `{lobby}` var when drawn. */
	readonly lobby?: StringSpec;
	/** inviteArrived: the friend its Invite button invites (shown while shared/view/menu arrivedInviteShown). */
	readonly inviteUserId?: number;
	/** os.clock() at which it disappears. */
	readonly until: number;
}

export interface LobbyState {
	readonly list: ReadonlyArray<LobbySummary>;
	readonly mine: LobbyView | undefined;
	/** os.clock() when `mine` arrived (its countdownIn counts from here). */
	readonly mineAt: number;
	readonly invites: ReadonlyArray<LobbyInviteView>;
	/** os.clock() when `invites` arrived (each expiresIn counts from here). */
	readonly invitesAt: number;
	/** Newest last. */
	readonly notices: ReadonlyArray<LobbyNoticeToast>;
	/** Everyone in this server (this player too), join order. */
	readonly players: ReadonlyArray<ServerPlayer>;
	/** `inviteEligible.canSend`; undefined until the server answered (the Roblox invite buttons stay enabled). */
	readonly inviteEligible: boolean | undefined;
	/** The server's `joinIntent` for this join; undefined until it arrived. */
	readonly joinIntent: ArrivalJoinIntent | undefined;
}

const initialState: LobbyState = {
	list: [],
	mine: undefined,
	mineAt: 0,
	invites: [],
	invitesAt: 0,
	notices: [],
	players: [],
	inviteEligible: undefined,
	joinIntent: undefined,
};

export const lobbySlice = createProducer(initialState, {
	setLobbyList: (state, list: ReadonlyArray<LobbySummary>) => ({ ...state, list }),
	setMyLobby: (state, mine: LobbyView | undefined, at: number) => ({ ...state, mine, mineAt: at }),
	setLobbyInvites: (state, invites: ReadonlyArray<LobbyInviteView>, at: number) => ({
		...state,
		invites,
		invitesAt: at,
	}),
	pushLobbyNotice: (state, notice: LobbyNoticeToast, max: number) => {
		const notices = [...state.notices, notice];
		while (notices.size() > max) notices.remove(0);
		return { ...state, notices };
	},
	expireLobbyNotices: (state, now: number) =>
		state.notices.some((n) => n.until <= now)
			? { ...state, notices: state.notices.filter((n) => n.until > now) }
			: state,
	setServerPlayers: (state, players: ReadonlyArray<ServerPlayer>) => ({ ...state, players }),
	setInviteEligible: (state, inviteEligible: boolean) =>
		state.inviteEligible === inviteEligible ? state : { ...state, inviteEligible },
	setJoinIntent: (state, joinIntent: ArrivalJoinIntent) =>
		state.joinIntent === joinIntent ? state : { ...state, joinIntent },
});

export const selectLobby = (state: { lobby: LobbyState }) => state.lobby;
export const selectLobbyList = (state: { lobby: LobbyState }) => state.lobby.list;
export const selectMyLobby = (state: { lobby: LobbyState }) => state.lobby.mine;
export const selectMyLobbyId = (state: { lobby: LobbyState }) => state.lobby.mine?.lobbyId;
export const selectLobbyInvites = (state: { lobby: LobbyState }) => state.lobby.invites;
export const selectLobbyNotices = (state: { lobby: LobbyState }) => state.lobby.notices;
export const selectServerPlayers = (state: { lobby: LobbyState }) => state.lobby.players;
export const selectInviteEligible = (state: { lobby: LobbyState }) => state.lobby.inviteEligible;
