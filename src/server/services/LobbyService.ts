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
	canAccess,
	inviteViewsOf,
	lobbyViewOf,
	type Lobby,
	type LobbyContext,
	type LobbyCreateRequest,
	type LobbyRefusal,
	type LobbyRefused,
	type LobbyResult,
	type LobbyRunStart,
} from "shared/lobby";
import {
	ARRIVAL_TOAST,
	INVITE,
	arrivalToastForRefusal,
	type ArrivalAction,
	type ArrivalApplyResult,
	type ArrivalLobbyFacts,
	type ArrivalToastKey,
} from "shared/invite";
import type { LobbyNotice, LobbyView } from "shared/network";
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
const PARTY_LOBBY_MOVED: LobbyRefused = { ok: false, code: "unknownLobby", reason: "the party mate left that lobby" };

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
 *
 * Roblox invites and parties (docs/INVITES.md I4 / I6): InviteService never touches `Lobbies`; it reads
 * `lobbyOf` / `arrivalFacts` / `fetchFriendship` and changes lobbies only through `platformInvites`, `applyArrival`,
 * `partyInviteOffer` and `notify`, which go through the same outbox and flush as every request.
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
			Events.lobbySetWorld.connect((player, worldKind) =>
				this.request(player, "lobbySetWorld", this.requestLimiter, () => {
					const r = this.lobbies.setWorld(player.UserId, worldKind);
					if (!r.ok) return this.outbox.refused(player.UserId, "lobbySetWorld", r);
					if (!r.changed) return;
					log.info("WORLD", `lobby ${r.lobby.lobbyId}: world ${r.lobby.worldKind}`);
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

	/**
	 * The lobby context now. `confirmed`: friendships of `userId` the caller has just confirmed (fetchFriendship),
	 * answered true even while the FriendCache does not know the pair yet.
	 */
	private context(confirmed?: { readonly userId: number; readonly friends: ReadonlyArray<number> }): LobbyContext {
		return {
			now: os.clock(),
			busyReason: (id) => this.runSessions.busyReason(id),
			areFriends: (a, b) => this.areFriends(a, b, confirmed),
		};
	}

	private areFriends(
		a: number,
		b: number,
		confirmed: { readonly userId: number; readonly friends: ReadonlyArray<number> } | undefined,
	): boolean {
		if (confirmed !== undefined) {
			if (a === confirmed.userId && confirmed.friends.includes(b)) return true;
			if (b === confirmed.userId && confirmed.friends.includes(a)) return true;
		}
		return this.friends.areFriends(a, b);
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
		const r = this.joinLobby(player.UserId, lobbyId);
		if (!r.ok) this.outbox.refused(player.UserId, requestKind, r);
	}

	/** A join and its pushes (no refusal notice: the caller decides how to tell the player). */
	private joinLobby(
		userId: number,
		lobbyId: string,
		ctx: LobbyContext = this.context(),
	): LobbyResult<{ lobby: Lobby }> {
		const r = this.lobbies.join(userId, lobbyId, ctx);
		if (!r.ok) return r;
		const lookup = (id: string) => this.lobbies.get(id);
		this.outbox.lobby(r.lobby);
		// Joining consumed the invite (if any) and dropped the others the player had: their own doing, no notice.
		if (r.usedInvite !== undefined) {
			this.outbox.droppedInvites([r.usedInvite], lookup);
			this.track(userId, analyticsForInviteAnswered("accept"));
		}
		this.outbox.droppedInvites(r.droppedInvites, lookup);
		return r;
	}

	private invite(player: Player, toUserId: number): void {
		// Lobbies checks the shape; an invite only makes sense to a player in this server.
		if (typeIs(toUserId, "number") && toUserId % 1 === 0 && Players.GetPlayerByUserId(toUserId) === undefined) {
			return this.outbox.refused(player.UserId, "lobbyInvite", NOT_IN_SERVER);
		}
		const r = this.lobbies.invite(player.UserId, toUserId, this.context());
		if (!r.ok) return this.outbox.refused(player.UserId, "lobbyInvite", r);
		this.outbox.invited(r.invite, r.lobby);
		this.track(player.UserId, analyticsForInviteSent("server", 1));
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

	// ---------------------------------------------------------------------------------------------
	// Roblox invites and parties (InviteService; docs/INVITES.md I4 / I6, docs/SERVER.md "Roblox invites and parties")

	/** The lobby `userId` is in, if any (read only: never mutate it). */
	lobbyOf(userId: number): Lobby | undefined {
		return this.lobbies.lobbyOf(userId);
	}

	/**
	 * The lobby half of an `ArrivalInput` (shared/invite resolveArrival), read now. Friendship is the FriendCache's,
	 * plus `knownFriends`: players the caller has just confirmed (fetchFriendship) are friends of `userId` (a cache
	 * miss answers false, which would refuse a joining friend of a `friends` lobby's host).
	 */
	arrivalFacts(userId: number, knownFriends: ReadonlyArray<number> = []): ArrivalLobbyFacts {
		const now = os.clock();
		const confirmed = { userId, friends: knownFriends };
		const areFriends = (a: number, b: number) => this.areFriends(a, b, confirmed);
		return {
			now,
			invitesFor: (id) => this.lobbies.invitesFor(id, now),
			lobbyById: (id) => this.lobbies.get(id),
			lobbyOfUser: (id) => this.lobbies.lobbyOf(id),
			canAccess: (lobby, id) => canAccess(lobby, id, areFriends),
			isBusy: (id) => this.runSessions.busyReason(id) !== undefined,
		};
	}

	/** YIELDS: a fresh Player:IsFriendsWithAsync answer for the pair (false when it fails); also warms the cache. */
	fetchFriendship(a: number, b: number): boolean {
		this.friends.prefetch(a, b);
		const [ok, friends] = pcall(() => isFriendsWith(a, b));
		return ok && friends === true;
	}

	/**
	 * The friends a member of a lobby picked in Roblox's invite prompt (`Lobbies.platformInvites`; the ids may be
	 * absent from this server). Each invite made reaches its invitee's `lobbyInvites` (when here) and the lobby's
	 * `invited`; one `LobbyInviteSent` (platform, value = invites made). Players IN this server are refused one by one
	 * (`badRequest`): they go through `lobbyInvite` and its cap / TTL. A whole-call refusal (no longer a member, the
	 * lobby in a run or full, a malformed list) is a `refused` notice with requestKind "inviteRecipients"; ids skipped
	 * one by one (already invited, in a lobby, kick cooldown, cap) are only logged: a prompt reported twice (server
	 * signal and client relay) makes nothing the second time. Returns the number of invites made.
	 */
	platformInvites(fromUserId: number, toUserIds: ReadonlyArray<number>): number {
		const r = this.lobbies.platformInvites(
			fromUserId,
			toUserIds,
			this.context(),
			(id) => Players.GetPlayerByUserId(id) !== undefined,
		);
		if (!r.ok) {
			log.info("PLATFORM_INVITES_REFUSED", `${fromUserId}: ${r.code} (${r.reason})`);
			this.outbox.refused(fromUserId, "inviteRecipients", r);
			this.flush();
			return 0;
		}
		for (const inv of r.invites) this.outbox.invited(inv, r.lobby);
		for (const skip of r.refusals) {
			log.info("PLATFORM_INVITE_SKIPPED", `${fromUserId} -> ${skip.userId}: ${skip.code}`);
		}
		const made = r.invites.size();
		if (made > 0) {
			log.info("PLATFORM_INVITES", `${fromUserId} invited ${made} to lobby ${r.lobby.lobbyId}`);
			this.track(fromUserId, analyticsForInviteSent("platform", made));
		}
		this.flush();
		return made;
	}

	/**
	 * Mid-session Roblox Party grouping (ID4: an offer, never a move): a party invite (source "party") from
	 * `fromUserId`'s lobby to `toUserId`, which reaches them as an ordinary `lobbyInvites` entry. False when Lobbies
	 * refused it (already invited, in a lobby, full, ...).
	 */
	partyInviteOffer(fromUserId: number, toUserId: number): boolean {
		const r = this.lobbies.partyInvite(fromUserId, toUserId, { now: os.clock() });
		if (!r.ok) {
			log.info("PARTY_OFFER_SKIPPED", `${fromUserId} -> ${toUserId}: ${r.code}`);
			return false;
		}
		log.info("PARTY_OFFER", `${fromUserId} -> ${toUserId} (lobby ${r.lobby.lobbyId})`);
		this.outbox.invited(r.invite, r.lobby);
		this.flush();
		return true;
	}

	/** One lobby notice (InviteService's refusals), pushed at once. */
	notify(userId: number, notice: LobbyNotice): void {
		this.outbox.notice(userId, notice);
		this.flush();
	}

	/**
	 * Applies `resolveArrival`'s actions for the arriving `userId`, in order, then flushes once. `knownFriends`: the
	 * friendships the caller confirmed for the resolve (`arrivalFacts`), so the join agrees with it:
	 *
	 *   joinInvite / joinOpen  join (the invite, if any, is consumed as usual); refused after all: an `arrival` toast
	 *   partyJoin              a party invite from the mate (still in that lobby), then the join; `partyLobby` notice
	 *                          `{ lobbyId, userId: mate }` to the arrival
	 *   makePartyLobby         the host creates a lobby (INVITE.partyLobbyVisibility); each joiner gets a party invite
	 *                          from the host and joins (`partyLobby { lobbyId, userId: host }`); each invitee only the
	 *                          party invite; the host hears `partyLobby { lobbyId, userId: <the arrival, or the first
	 *                          joiner / invitee when the host is the arrival> }`
	 *   notify                 `lobbyNotice { kind: followed | inviteArrived, userId: the arrival }` to the sender
	 *   toast                  `lobbyNotice { kind: "arrival", key }` to its player
	 *
	 * A refused party step toasts the player it concerns (`lobby.err.partyFull` for a full lobby).
	 */
	applyArrival(
		userId: number,
		actions: ReadonlyArray<ArrivalAction>,
		knownFriends: ReadonlyArray<number> = [],
	): ArrivalApplyResult {
		let refusal: LobbyRefusal | undefined;
		for (const a of actions) {
			if (a.kind === "joinInvite" || a.kind === "joinOpen") {
				const r = this.joinLobby(userId, a.lobbyId, this.context({ userId, friends: knownFriends }));
				if (r.ok) {
					log.info("ARRIVAL_JOINED", `${userId} -> lobby ${a.lobbyId} (${a.kind})`);
				} else {
					refusal = r.code;
					this.arrivalToast(userId, arrivalToastForRefusal(r.code));
				}
			} else if (a.kind === "partyJoin") {
				const r = this.partyJoin(a.fromUserId, userId, a.lobbyId);
				if (!r.ok) refusal = r.code;
			} else if (a.kind === "makePartyLobby") {
				const code = this.makePartyLobby(userId, a.hostId, a.joiners, a.invitees);
				if (code !== undefined) refusal = code;
			} else if (a.kind === "notify") {
				this.outbox.notice(a.toUserId, { kind: a.notice, userId });
			} else if (a.kind === "toast") {
				this.arrivalToast(a.toUserId, a.key);
			}
		}
		this.flush();
		return { lobbyId: this.lobbies.lobbyOf(userId)?.lobbyId, refusal };
	}

	private arrivalToast(userId: number, key: ArrivalToastKey): void {
		this.outbox.notice(userId, { kind: "arrival", key });
	}

	/**
	 * `toUserId` joins `fromUserId`'s lobby `lobbyId` through a party invite from them (an existing live invite to it
	 * does as well). Refused: the `arrival` toast to `toUserId`.
	 */
	private partyJoin(fromUserId: number, toUserId: number, lobbyId: string): LobbyResult<{ lobby: Lobby }> {
		let r: LobbyResult<{ lobby: Lobby }>;
		if (this.lobbies.lobbyOf(fromUserId)?.lobbyId !== lobbyId) {
			r = PARTY_LOBBY_MOVED;
		} else {
			const inv = this.lobbies.partyInvite(fromUserId, toUserId, { now: os.clock() });
			if (inv.ok) this.outbox.invited(inv.invite, inv.lobby);
			r = !inv.ok && inv.code !== "alreadyInvited" ? inv : this.joinLobby(toUserId, lobbyId);
		}
		if (!r.ok) {
			log.info("PARTY_JOIN_REFUSED", `${toUserId} -> lobby ${lobbyId}: ${r.code}`);
			this.arrivalToast(toUserId, arrivalToastForRefusal(r.code, ARRIVAL_TOAST.partyFull));
			return r;
		}
		log.info("PARTY_JOINED", `${toUserId} -> lobby ${lobbyId} (party of ${fromUserId})`);
		this.outbox.notice(toUserId, { kind: "partyLobby", lobbyId, userId: fromUserId });
		return r;
	}

	/** `makePartyLobby` (see applyArrival). Returns the refusal that concerned the arrival, if any. */
	private makePartyLobby(
		arrivalId: number,
		hostId: number,
		joiners: ReadonlyArray<number>,
		invitees: ReadonlyArray<number>,
	): LobbyRefusal | undefined {
		const created = this.lobbies.create(hostId, { visibility: INVITE.partyLobbyVisibility }, this.context());
		if (!created.ok) {
			log.info("PARTY_LOBBY_REFUSED", `host ${hostId}: ${created.code}`);
			this.arrivalToast(arrivalId, arrivalToastForRefusal(created.code, ARRIVAL_TOAST.partyFull));
			return created.code;
		}
		const lobby = created.lobby;
		log.info(
			"PARTY_LOBBY",
			`${hostId} lobby ${lobby.lobbyId} for ${joiners.size() + 1} (+${invitees.size()} invited)`,
		);
		this.outbox.lobby(lobby);
		this.outbox.droppedInvites(created.droppedInvites, (id) => this.lobbies.get(id));
		this.track(hostId, analyticsForLobbyCreated(lobby.visibility));
		let refusal: LobbyRefusal | undefined;
		for (const id of joiners) {
			const r = this.partyJoin(hostId, id, lobby.lobbyId);
			if (!r.ok && id === arrivalId) refusal = r.code;
		}
		for (const id of invitees) {
			const r = this.lobbies.partyInvite(hostId, id, { now: os.clock() });
			if (r.ok) this.outbox.invited(r.invite, r.lobby);
			else log.info("PARTY_INVITE_SKIPPED", `${hostId} -> ${id}: ${r.code}`);
		}
		const mate = hostId !== arrivalId ? arrivalId : joiners.size() > 0 ? joiners[0] : invitees[0];
		if (mate !== undefined)
			this.outbox.notice(hostId, { kind: "partyLobby", lobbyId: lobby.lobbyId, userId: mate });
		return refusal;
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
