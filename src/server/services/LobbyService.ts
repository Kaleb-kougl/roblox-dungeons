import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HttpService, Players, RunService } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import {
	COUNTDOWN_CANCELLED_UNREADY,
	FriendCache,
	LOBBY_INVITE_RATE,
	LOBBY_LIST_REQUEST_RATE,
	LOBBY_REQUEST_RATE,
	LOBBY_SERVICE,
	Lobbies,
	LobbyOutbox,
	analyticsForInviteAnswered,
	analyticsForInviteSent,
	analyticsForLobbyCreated,
	analyticsForLobbyStarted,
	inviteViewsOf,
	lobbyViewOf,
	type Lobby,
	type LobbyContext,
	type LobbyCreateRequest,
	type LobbyRefused,
	type LobbyRunStart,
} from "shared/lobby";
import type { LobbyView } from "shared/network";
import { SlidingWindowLimiter, type AnalyticsEventSpec } from "shared/run";
import { RunSessionService, type LobbyRunStartResult } from "./RunSessionService";
import { TelemetryService } from "./TelemetryService";

const log = serverLogger("Lobby");

const RATE_LIMITED: LobbyRefused = {
	ok: false,
	code: "rateLimited",
	reason: "too many lobby requests; try again later",
};
const NOT_IN_SERVER: LobbyRefused = { ok: false, code: "badRequest", reason: "that player is not in this server" };
const NOT_INVITED: LobbyRefused = { ok: false, code: "notInvited", reason: "no such invite for this player" };

/**
 * The engine takes a plain UserId; @rbxts/types declares the parameter as the newer `User` datatype (whose `fromId`
 * is for domain user ids only), so the number is passed through as is.
 */
function asUserParam(userId: number): User {
	return userId as unknown as User;
}

/**
 * Player:IsFriendsWithAsync (the current name of IsFriendsWith) from whichever of the two is in this server: a web
 * call, it yields and may throw.
 */
function isFriendsWith(a: number, b: number): boolean {
	const pa = Players.GetPlayerByUserId(a);
	if (pa !== undefined) return pa.IsFriendsWithAsync(asUserParam(b));
	const pb = Players.GetPlayerByUserId(b);
	if (pb !== undefined) return pb.IsFriendsWithAsync(asUserParam(a));
	error("neither player is in this server", 0);
}

/**
 * Same-server lobbies (task L2; pure model in shared/lobby, docs/SERVER.md "Lobbies"). Owns this server's one
 * `Lobbies`, wires every lobby remote (per-player rate limits LOBBY_REQUEST_RATE / LOBBY_INVITE_RATE /
 * LOBBY_LIST_REQUEST_RATE; over budget: a `rateLimited` refusal, list requests dropped quietly), runs `tick` every
 * LOBBY_SERVICE.tickSeconds on Heartbeat, and pushes what changed through a `LobbyOutbox`:
 *
 *   lobbyState    to every member of a changed lobby (and a leaver: `{}`), countdown as seconds left
 *   lobbyInvites  to each player whose received invites changed
 *   lobbyNotice   refusals (requestKind = the remote's name), kicks, host changes, countdown cancels, dropped /
 *                 expired invites
 *   lobbyList     to EVERY player (per-viewer `summariesFor`), coalesced to one round per LOBBY_SERVICE.listPushSeconds
 *                 while anything is dirty
 *
 * The current state (list, state, invites) goes to a player on PlayerAdded and on `lobbyRequestList`. Friendship comes
 * from a FriendCache (Player:IsFriendsWith in the background; a landed answer marks the lists dirty). Busy =
 * RunSessionService.busyReason (an unconcluded party run, or playing the first-run tutorial; solo runs are not
 * busy). A due countdown hands the run to
 * RunSessionService.startLobbyRun; the lobby returns to `forming` on its `onLobbyRunEnded` (or at once when the start
 * is refused, with a countdownCancelled notice carrying the reason).
 */
@Service({})
export class LobbyService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly lobbies = new Lobbies({ newId: () => HttpService.GenerateGUID(false) });
	private readonly outbox = new LobbyOutbox();
	private readonly friends = new FriendCache({
		fetch: (a, b) => isFriendsWith(a, b),
		spawn: (job) => {
			task.spawn(job);
		},
		clock: () => os.clock(),
		onChanged: () => this.outbox.markList(),
	});
	private readonly requestLimiter = new SlidingWindowLimiter<Player>(
		LOBBY_REQUEST_RATE.count,
		LOBBY_REQUEST_RATE.windowSeconds,
	);
	private readonly inviteLimiter = new SlidingWindowLimiter<Player>(
		LOBBY_INVITE_RATE.count,
		LOBBY_INVITE_RATE.windowSeconds,
	);
	private readonly listLimiter = new SlidingWindowLimiter<Player>(
		LOBBY_LIST_REQUEST_RATE.count,
		LOBBY_LIST_REQUEST_RATE.windowSeconds,
	);
	private nextTickAt = 0;
	private nextListAt = 0;

	constructor(private readonly runSessions: RunSessionService, private readonly telemetry: TelemetryService) {}

	onStart(): void {
		const lookup = (lobbyId: string) => this.lobbies.get(lobbyId);
		this.janitor.Add(
			Events.lobbyCreate.connect((player, request) =>
				this.request(player, "lobbyCreate", this.requestLimiter, () => this.create(player, request)),
			),
		);
		this.janitor.Add(
			Events.lobbyJoin.connect((player, lobbyId) =>
				this.request(player, "lobbyJoin", this.requestLimiter, () => this.join(player, lobbyId, "lobbyJoin")),
			),
		);
		this.janitor.Add(
			Events.lobbyLeave.connect((player) =>
				this.request(player, "lobbyLeave", this.requestLimiter, () => {
					const r = this.lobbies.leave(player.UserId);
					if (!r.ok) return this.outbox.refused(player.UserId, "lobbyLeave", r);
					this.outbox.departure(r.departure, false, lookup);
				}),
			),
		);
		this.janitor.Add(
			Events.lobbyKick.connect((player, userId) =>
				this.request(player, "lobbyKick", this.requestLimiter, () => {
					const r = this.lobbies.kick(player.UserId, userId, { now: os.clock() });
					if (!r.ok) return this.outbox.refused(player.UserId, "lobbyKick", r);
					log.info("KICKED", `${player.UserId} kicked ${userId} from lobby ${r.departure.lobbyId}`);
					this.outbox.departure(r.departure, true, lookup);
				}),
			),
		);
		this.janitor.Add(
			Events.lobbySetVisibility.connect((player, visibility) =>
				this.request(player, "lobbySetVisibility", this.requestLimiter, () => {
					const r = this.lobbies.setVisibility(player.UserId, visibility);
					if (!r.ok) return this.outbox.refused(player.UserId, "lobbySetVisibility", r);
					this.outbox.lobby(r.lobby);
				}),
			),
		);
		this.janitor.Add(
			Events.lobbySetName.connect((player, nameId) =>
				this.request(player, "lobbySetName", this.requestLimiter, () => {
					const r = this.lobbies.setName(player.UserId, nameId);
					if (!r.ok) return this.outbox.refused(player.UserId, "lobbySetName", r);
					this.outbox.lobby(r.lobby);
				}),
			),
		);
		this.janitor.Add(
			Events.lobbyTransferHost.connect((player, userId) =>
				this.request(player, "lobbyTransferHost", this.requestLimiter, () => {
					const r = this.lobbies.transferHost(player.UserId, userId);
					if (!r.ok) return this.outbox.refused(player.UserId, "lobbyTransferHost", r);
					this.outbox.lobby(r.lobby);
					this.outbox.notice(r.lobby.hostId, { kind: "hostChanged", lobbyId: r.lobby.lobbyId });
				}),
			),
		);
		this.janitor.Add(
			Events.lobbyInvite.connect((player, userId) =>
				this.request(player, "lobbyInvite", this.inviteLimiter, () => this.invite(player, userId)),
			),
		);
		this.janitor.Add(
			Events.lobbyAnswerInvite.connect((player, inviteId, accept) =>
				this.request(player, "lobbyAnswerInvite", this.requestLimiter, () =>
					this.answerInvite(player, inviteId, accept),
				),
			),
		);
		this.janitor.Add(
			Events.lobbySetReady.connect((player, ready) =>
				this.request(player, "lobbySetReady", this.requestLimiter, () => {
					const r = this.lobbies.setReady(player.UserId, ready);
					if (!r.ok) return this.outbox.refused(player.UserId, "lobbySetReady", r);
					this.outbox.lobby(r.lobby);
					if (r.countdownCancelled) this.outbox.countdownCancelled(r.lobby, COUNTDOWN_CANCELLED_UNREADY);
				}),
			),
		);
		this.janitor.Add(
			Events.lobbyStart.connect((player) =>
				this.request(player, "lobbyStart", this.requestLimiter, () => {
					const r = this.lobbies.start(player.UserId, this.context());
					if (!r.ok) return this.outbox.refused(player.UserId, "lobbyStart", r);
					log.info("COUNTDOWN", `lobby ${r.lobby.lobbyId} (${r.lobby.members.size()}) starting`);
					this.outbox.lobby(r.lobby);
				}),
			),
		);
		this.janitor.Add(
			Events.lobbyRequestList.connect((player) => {
				if (player.Parent === undefined || !this.listLimiter.tryAcquire(player, os.clock())) return;
				this.sendCurrent(player);
			}),
		);
		this.janitor.Add(
			this.runSessions.onLobbyRunEnded((lobbyId, reason) => {
				const r = this.lobbies.runEnded(lobbyId);
				if (!r.ok) return; // deleted meanwhile (its last member left), or never in a run
				log.info("RUN_ENDED", `lobby ${lobbyId}: ${reason}`);
				this.outbox.lobby(r.lobby);
				this.flush();
			}),
		);
		this.janitor.Add(Players.PlayerAdded.Connect((player) => this.playerAdded(player)));
		for (const player of Players.GetPlayers()) this.playerAdded(player);
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.playerRemoving(player)));
		this.janitor.Add(RunService.Heartbeat.Connect(() => this.heartbeat()));
	}

	private context(): LobbyContext {
		return {
			now: os.clock(),
			busyReason: (id) => this.runSessions.busyReason(id),
			areFriends: (a, b) => this.friends.areFriends(a, b),
		};
	}

	/** One client request: rate limit, the handler, then the pushes it caused. */
	private request(player: Player, kind: string, limiter: SlidingWindowLimiter<Player>, handle: () => void): void {
		if (player.Parent === undefined) return;
		if (limiter.tryAcquire(player, os.clock())) handle();
		else this.outbox.refused(player.UserId, kind, RATE_LIMITED);
		this.flush();
	}

	private create(player: Player, request: LobbyCreateRequest): void {
		const r = this.lobbies.create(player.UserId, request, this.context());
		if (!r.ok) return this.outbox.refused(player.UserId, "lobbyCreate", r);
		log.info("CREATED", `${player.UserId} lobby ${r.lobby.lobbyId} (${r.lobby.visibility})`);
		this.outbox.lobby(r.lobby);
		this.outbox.droppedInvites(r.droppedInvites, (id) => this.lobbies.get(id));
		this.track(player.UserId, analyticsForLobbyCreated(r.lobby.visibility));
	}

	/** `lobbyJoin`, or an accepted invite (`requestKind` lobbyAnswerInvite). */
	private join(player: Player, lobbyId: string, requestKind: string): void {
		const r = this.lobbies.join(player.UserId, lobbyId, this.context());
		if (!r.ok) return this.outbox.refused(player.UserId, requestKind, r);
		const lookup = (id: string) => this.lobbies.get(id);
		this.outbox.lobby(r.lobby);
		// Joining consumed the invite (if any) and dropped the others the player had: their own doing, no notice.
		if (r.usedInvite !== undefined) {
			this.outbox.droppedInvites([r.usedInvite], lookup);
			this.track(player.UserId, analyticsForInviteAnswered("accept"));
		}
		this.outbox.droppedInvites(r.droppedInvites, lookup);
	}

	private invite(player: Player, toUserId: number): void {
		// Lobbies checks the shape; an invite only makes sense to a player in this server.
		if (typeIs(toUserId, "number") && toUserId % 1 === 0 && Players.GetPlayerByUserId(toUserId) === undefined) {
			return this.outbox.refused(player.UserId, "lobbyInvite", NOT_IN_SERVER);
		}
		const r = this.lobbies.invite(player.UserId, toUserId, this.context());
		if (!r.ok) return this.outbox.refused(player.UserId, "lobbyInvite", r);
		this.outbox.invited(r.invite, r.lobby);
		this.track(player.UserId, analyticsForInviteSent());
	}

	private answerInvite(player: Player, inviteId: string, accept: boolean): void {
		if (accept === true) {
			for (const inv of this.lobbies.invitesFor(player.UserId, os.clock())) {
				if (inv.inviteId === inviteId) return this.join(player, inv.lobbyId, "lobbyAnswerInvite");
			}
			return this.outbox.refused(player.UserId, "lobbyAnswerInvite", NOT_INVITED);
		}
		const r = this.lobbies.decline(player.UserId, inviteId);
		if (!r.ok) return this.outbox.refused(player.UserId, "lobbyAnswerInvite", r);
		this.outbox.droppedInvites([r.invite], (id) => this.lobbies.get(id));
		this.track(player.UserId, analyticsForInviteAnswered("decline"));
	}

	private playerAdded(player: Player): void {
		for (const other of Players.GetPlayers()) {
			if (other !== player) this.friends.prefetch(player.UserId, other.UserId);
		}
		this.sendCurrent(player);
	}

	private playerRemoving(player: Player): void {
		this.requestLimiter.forget(player);
		this.inviteLimiter.forget(player);
		this.listLimiter.forget(player);
		const lookup = (id: string) => this.lobbies.get(id);
		const r = this.lobbies.playerRemoving(player.UserId);
		if (r.departure !== undefined) this.outbox.departure(r.departure, false, lookup);
		this.outbox.droppedInvites(r.droppedInvites, lookup);
		this.friends.forget(player.UserId);
		this.flush();
	}

	/** Heartbeat: the lobby clock every tickSeconds, then the paced list push. */
	private heartbeat(): void {
		const now = os.clock();
		if (now >= this.nextTickAt) {
			this.nextTickAt = now + LOBBY_SERVICE.tickSeconds;
			const result = this.lobbies.tick({ now, busyReason: (id) => this.runSessions.busyReason(id) });
			this.outbox.tick(result, (id) => this.lobbies.get(id));
			for (const inv of result.expiredInvites) this.track(inv.toUserId, analyticsForInviteAnswered("expire"));
			for (const start of result.starts) this.startRun(start);
			this.flush();
		}
		if (now >= this.nextListAt && this.outbox.isListDirty()) {
			this.nextListAt = now + LOBBY_SERVICE.listPushSeconds;
			this.outbox.takeList();
			for (const player of Players.GetPlayers()) this.sendList(player);
		}
	}

	/** A due countdown: hand the run to RunSessionService; a refusal sends the lobby back to forming. */
	private startRun(start: LobbyRunStart): void {
		const lobby = this.lobbies.get(start.lobbyId);
		if (lobby === undefined) return;
		const size = start.kind === "solo" ? 1 : start.members.size();
		this.track(lobby.hostId, analyticsForLobbyStarted(size));
		const [ok, out] = pcall(() => this.runSessions.startLobbyRun(start));
		const r: LobbyRunStartResult = ok
			? (out as LobbyRunStartResult)
			: { ok: false, reason: `internal error: ${tostring(out)}` };
		if (r.ok) {
			log.info("STARTED", `lobby ${start.lobbyId}: ${start.kind} run of ${size}`);
			this.outbox.lobby(lobby);
			return;
		}
		log.warn("START_FAILED", `lobby ${start.lobbyId}: ${r.reason}`);
		const back = this.lobbies.runEnded(start.lobbyId);
		if (back.ok) this.outbox.countdownCancelled(back.lobby, r.reason);
	}

	/** Pushes the outbox: lobbyState / lobbyInvites per player (each once), then the notices in order. */
	private flush(): void {
		const batch = this.outbox.take();
		const now = os.clock();
		const views = new Map<Lobby, LobbyView>();
		for (const id of batch.state) {
			const player = Players.GetPlayerByUserId(id);
			if (player === undefined) continue;
			const lobby = this.lobbies.lobbyOf(id);
			let view: LobbyView | undefined;
			if (lobby !== undefined) {
				view = views.get(lobby);
				if (view === undefined) {
					view = lobbyViewOf(lobby, this.lobbies.invitesTo(lobby.lobbyId, now), now);
					views.set(lobby, view);
				}
			}
			Events.lobbyState.fire(player, { lobby: view });
		}
		for (const id of batch.invites) {
			const player = Players.GetPlayerByUserId(id);
			if (player !== undefined) Events.lobbyInvites.fire(player, this.inviteViews(id, now));
		}
		for (const { userId, notice } of batch.notices) {
			const player = Players.GetPlayerByUserId(userId);
			if (player !== undefined) Events.lobbyNotice.fire(player, notice);
		}
	}

	/** Everything a player needs to draw the lobby UI now (join, `lobbyRequestList`). */
	private sendCurrent(player: Player): void {
		this.sendList(player);
		this.outbox.member(player.UserId);
		this.outbox.invitee(player.UserId);
		this.flush();
	}

	private sendList(player: Player): void {
		if (player.Parent === undefined) return;
		Events.lobbyList.fire(
			player,
			this.lobbies.summariesFor(player.UserId, (a, b) => this.friends.areFriends(a, b)),
		);
	}

	private inviteViews(userId: number, now: number) {
		return inviteViewsOf(this.lobbies.invitesFor(userId, now), (id) => this.lobbies.get(id), now);
	}

	/** One analytics event for a player still in this server. */
	private track(userId: number, spec: AnalyticsEventSpec): void {
		const player = Players.GetPlayerByUserId(userId);
		if (player !== undefined) this.telemetry.logEvents(player, [spec]);
	}
}
