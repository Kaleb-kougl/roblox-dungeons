import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import type { LobbyVisibility } from "shared/lobby";
import type { LobbyNotice } from "shared/network";
import { MENU_VIEW, lobbyStartAccepted, nextLobbyName, noticeSpec } from "shared/view/menu";
import { SimController } from "../game/SimController";

/**
 * Lobbies, client side (task L5; the server owns the lobbies, shared/lobby the model). Wires the lobby remotes into
 * the Reflex `lobby` slice: `lobbyList` (the browse list), `lobbyState` (this player's lobby, with its arrival time
 * for the countdown), `lobbyInvites` (received invites, likewise) and `lobbyNotice` (a toast: refusal codes read
 * `lobby.err.*`, the rest `lobby.notice.*`, shared/view/menu noticeSpec). Keeps the players in this server for the
 * invite list and every display name (the Player in this server, no web lookups). Sends the lobby requests for the
 * menu screens.
 *
 * Run handoff (L6): `lobbyRunStart` (a one-player lobby's countdown ended) starts a ranked solo run for the lobby this
 * client is in; `partyRunStarted` is taken by SimController under the same rule (lobbyStartAccepted). Neither takes
 * over a tutorial run being played (SimController.inRunningTutorial).
 */
@Controller({})
export class LobbyController implements OnStart {
	private readonly janitor = new Janitor();
	private noticeSerial = 0;

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		this.janitor.Add(Events.lobbyList.connect((list) => clientStore.setLobbyList(list)));
		this.janitor.Add(Events.lobbyState.connect((u) => clientStore.setMyLobby(u.lobby, os.clock())));
		this.janitor.Add(Events.lobbyInvites.connect((list) => clientStore.setLobbyInvites(list, os.clock())));
		this.janitor.Add(Events.lobbyNotice.connect((notice) => this.showNotice(notice)));
		this.janitor.Add(
			Events.lobbyRunStart.connect((start) => {
				if (start.kind !== "solo") return;
				const mine = clientStore.getState().lobby.mine?.lobbyId;
				if (!lobbyStartAccepted(start.lobbyId, mine)) {
					warn(`[Lobby] ignored the solo start of lobby ${start.lobbyId}: not this client's lobby`);
					return;
				}
				if (this.sim.inRunningTutorial()) {
					// The server refuses lobby starts while this player is in the tutorial; a late one never takes it over
					// (the lobby goes back to forming when no ranked start comes).
					warn(`[Lobby] ignored the solo start of lobby ${start.lobbyId}: in the tutorial`);
					return;
				}
				print(`[Lobby] lobby ${start.lobbyId}: starting a ranked solo run`);
				this.sim.startSolo(start.lobbyId);
			}),
		);

		const refreshPlayers = () =>
			clientStore.setServerPlayers(Players.GetPlayers().map((p) => ({ userId: p.UserId, name: p.DisplayName })));
		refreshPlayers();
		this.janitor.Add(Players.PlayerAdded.Connect(refreshPlayers));
		this.janitor.Add(Players.PlayerRemoving.Connect(() => task.defer(refreshPlayers)));
		this.janitor.Add(
			RunService.Heartbeat.Connect(() => {
				if (clientStore.getState().lobby.notices.size() > 0) clientStore.expireLobbyNotices(os.clock());
			}),
		);
	}

	private showNotice(notice: LobbyNotice): void {
		const players = clientStore.getState().lobby.players;
		const nameOf = (id: number) => players.find((p) => p.userId === id)?.name ?? `#${id}`;
		const s = noticeSpec(notice, nameOf);
		this.noticeSerial++;
		clientStore.pushLobbyNotice(
			{ id: this.noticeSerial, key: s.key, vars: s.vars, until: os.clock() + MENU_VIEW.noticeSeconds },
			MENU_VIEW.maxNotices,
		);
		if (notice.kind === "refused") {
			warn(`[Lobby] ${notice.requestKind ?? "request"} refused (${notice.code ?? "?"}): ${notice.reason ?? ""}`);
		}
	}

	// --- requests (the menu screens) ------------------------------------------------------------

	requestList(): void {
		Events.lobbyRequestList.fire();
	}

	create(visibility: LobbyVisibility): void {
		Events.lobbyCreate.fire({ visibility });
	}

	join(lobbyId: string): void {
		Events.lobbyJoin.fire(lobbyId);
	}

	leave(): void {
		Events.lobbyLeave.fire();
	}

	kick(userId: number): void {
		Events.lobbyKick.fire(userId);
	}

	transferHost(userId: number): void {
		Events.lobbyTransferHost.fire(userId);
	}

	setVisibility(visibility: LobbyVisibility): void {
		Events.lobbySetVisibility.fire(visibility);
	}

	/** Host: the next preset name (LOBBY_NAMES order). */
	rename(): void {
		const mine = clientStore.getState().lobby.mine;
		if (mine !== undefined) Events.lobbySetName.fire(nextLobbyName(mine.nameId));
	}

	invite(userId: number): void {
		Events.lobbyInvite.fire(userId);
	}

	/** Answers an invite; its toast goes at once (the server's next `lobbyInvites` confirms). */
	answerInvite(inviteId: string, accept: boolean): void {
		Events.lobbyAnswerInvite.fire(inviteId, accept);
		const state = clientStore.getState().lobby;
		clientStore.setLobbyInvites(
			state.invites.filter((i) => i.inviteId !== inviteId),
			state.invitesAt,
		);
	}

	setReady(ready: boolean): void {
		Events.lobbySetReady.fire(ready);
	}

	start(): void {
		Events.lobbyStart.fire();
	}
}
