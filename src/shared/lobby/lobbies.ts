/**
 * Same-server lobbies: the way players group up for a run (replaces the M4 co-op invite flow, removed
 * in task L7). One `Lobbies` holds every lobby and lobby invite of one server.
 *
 *   create / join / leave   a player is in at most one lobby; busy players (ctx.busyReason) cannot create or join.
 *                           Join only while `forming` and not full, with canAccess (visibility) OR a live invite;
 *                           joining consumes the invite and drops every other invite the player had received.
 *                           The host leaving hands the lobby to the longest-standing member (join order); the last
 *                           member leaving deletes it and its invites.
 *   invite / decline        ANY member invites a player who is not busy, not in a lobby, not already invited here
 *                           and not on this lobby's kick cooldown; at most maxInvitesPerMember live invites per
 *                           sender. An invite belongs to the lobby (it stays valid when its sender leaves) and
 *                           expires after inviteTimeoutSeconds.
 *   platformInvites         the same rules for the friends a member picked in Roblox's invite prompt (source
 *                           "platform", docs/INVITES.md): the invitees need not be in this server, the sender's
 *                           cap is maxPlatformInvitesPerMember (counted apart: `invite` counts server invites only),
 *                           TTL platformInviteTimeoutSeconds; one refusal per id skipped; a player who IS in this
 *                           server (`inServer`) is refused: they go through `invite` and its rules. On arrival
 *                           nothing converts: the player simply has a live invite (invitesFor / join as usual).
 *   partyInvite             the server's invite for a Roblox Party mate (source "party"): no cap, the platform
 *                           TTL, and the invitee may be busy (a mate in a run sees it afterwards).
 *   host only               kick (removes the member, drops their invites here, blocks re-invite and rejoin for
 *                           kickCooldownSeconds), setVisibility, setName (preset ids), setWorld (endless / daily,
 *                           while forming; a change clears every Ready: the members readied for the other world),
 *                           transferHost, start.
 *   ready / start / tick    start needs every member ready (one member is enough) and begins a countdown; a member
 *                           un-readying or leaving cancels it. tick(ctx) ends due countdowns: the lobby goes
 *                           `inRun` and the result says to start a solo or party run (members in join order) in the
 *                           lobby's world.
 *                           runEnded returns it to `forming` with Ready cleared.
 *   playerRemoving          leaves the lobby and drops the invites the player received (their sent ones stay).
 *   summariesFor            the browse list: lobbies the viewer canAccess (never closed), sorted.
 *
 * Pure and Roblox-API-free: ids, the clock, friendship and busy state are injected. The server passes client
 * values straight in, so every client-supplied argument is shape-checked (`badRequest`).
 */
import {
	DEFAULT_LOBBY_NAME,
	LOBBY,
	isLobbyNameId,
	isLobbyVisibility,
	isLobbyWorld,
	isWireUserId,
	type LobbyConfig,
	type LobbyInviteSource,
	type LobbyNameId,
	type LobbyPhase,
	type LobbyVisibility,
	type LobbyWorld,
} from "./config";

export type AreFriends = (a: number, b: number) => boolean;

export interface Lobby {
	readonly lobbyId: string;
	/** Creation order (the listing's last tie-break). */
	readonly seq: number;
	readonly createdAt: number;
	readonly hostId: number;
	readonly nameId: LobbyNameId;
	readonly visibility: LobbyVisibility;
	/** The world its run is played in (config.ts LobbyWorld). */
	readonly worldKind: LobbyWorld;
	readonly phase: LobbyPhase;
	/** Join order: the run's player order, and who becomes host next. */
	readonly members: ReadonlyArray<number>;
	/** Members who are ready (any order). */
	readonly ready: ReadonlyArray<number>;
	/** When the countdown ends (phase `countdown` only). */
	readonly countdownEndsAt?: number;
	/** Kicked UserId -> when their cooldown ends. */
	readonly kickedUntil: ReadonlyMap<number, number>;
}

interface MutableLobby {
	readonly lobbyId: string;
	readonly seq: number;
	readonly createdAt: number;
	hostId: number;
	nameId: LobbyNameId;
	visibility: LobbyVisibility;
	worldKind: LobbyWorld;
	phase: LobbyPhase;
	readonly members: number[];
	readonly ready: number[];
	countdownEndsAt?: number;
	readonly kickedUntil: Map<number, number>;
}

export interface LobbyInvite {
	readonly inviteId: string;
	readonly lobbyId: string;
	readonly toUserId: number;
	/** The member who sent it (the toast's "X invited you", and their invite cap). */
	readonly fromUserId: number;
	readonly createdAt: number;
	readonly expiresAt: number;
	/** How it was sent (config.ts LobbyInviteSource); each source has its own cap and TTL. */
	readonly source: LobbyInviteSource;
}

/** `platformInvites`: one recipient it skipped, and why. */
export interface LobbyInviteRefusal {
	readonly userId: number;
	readonly code: LobbyRefusal;
	readonly reason: string;
}

/** What the browse list shows of one lobby. */
export interface LobbySummary {
	readonly lobbyId: string;
	readonly nameId: LobbyNameId;
	readonly hostId: number;
	readonly count: number;
	readonly max: number;
	readonly visibility: LobbyVisibility;
	readonly worldKind: LobbyWorld;
	readonly phase: LobbyPhase;
	/** The viewer is friends with at least one member. */
	readonly hasFriend: boolean;
}

export interface LobbyContext {
	readonly now: number;
	/** Why the player cannot group up now (in an unconcluded run, ...), or undefined. */
	readonly busyReason: (userId: number) => string | undefined;
	readonly areFriends: AreFriends;
}

export type LobbyRefusal =
	| "badRequest"
	| "unknownLobby"
	| "notMember"
	| "notHost"
	| "noAccess"
	| "full"
	| "inRun"
	| "starting"
	| "busy"
	| "alreadyInLobby"
	| "alreadyInvited"
	| "inviteCap"
	| "kickCooldown"
	| "notInvited"
	| "badName"
	| "notReady"
	| "notInRun"
	/** Set by the server (LobbyService), never by Lobbies: the player's request budget is spent. */
	| "rateLimited";

export interface LobbyRefused {
	readonly ok: false;
	readonly code: LobbyRefusal;
	readonly reason: string;
}

export type LobbyOk<T> = { readonly ok: true } & T;
export type LobbyResult<T> = LobbyOk<T> | LobbyRefused;

/** What a member leaving (or being kicked) changed. */
export interface LobbyDeparture {
	readonly lobbyId: string;
	readonly userId: number;
	/** The lobby after the departure; undefined when it was deleted (the last member left). */
	readonly lobby?: Lobby;
	readonly deleted: boolean;
	/** The new host, when the host left and the lobby lives on. */
	readonly newHostId?: number;
	/** A running countdown was cancelled by this departure. */
	readonly countdownCancelled: boolean;
	/** Invites dropped with it: the deleted lobby's, or the kicked player's to this lobby. */
	readonly droppedInvites: ReadonlyArray<LobbyInvite>;
}

/** tick: start this run now, in the lobby's world. Party members are in join order. */
export type LobbyRunStart =
	| { readonly kind: "solo"; readonly lobbyId: string; readonly userId: number; readonly worldKind: LobbyWorld }
	| {
			readonly kind: "party";
			readonly lobbyId: string;
			readonly members: ReadonlyArray<number>;
			readonly worldKind: LobbyWorld;
	  };

export interface LobbyTickResult {
	readonly starts: ReadonlyArray<LobbyRunStart>;
	/** Due countdowns that could not start (a member became busy); the lobby is back to `forming`. */
	readonly cancelled: ReadonlyArray<{ readonly lobby: Lobby; readonly reason: string }>;
	readonly expiredInvites: ReadonlyArray<LobbyInvite>;
}

/** `lobbyCreate` options (all optional; validated). */
export interface LobbyCreateRequest {
	readonly visibility?: string;
	readonly nameId?: string;
	/** A LOBBY_WORLDS kind (default LOBBY.defaultWorld: endless). */
	readonly worldKind?: string;
}

export interface LobbiesDeps {
	readonly newId: () => string;
	/** Defaults to LOBBY. */
	readonly config?: LobbyConfig;
}

/**
 * THE visibility rule (listing and join both use it): open for everyone, friends for the host and the host's
 * friends, closed for nobody (invites bypass it in join).
 */
export function canAccess(lobby: Lobby, userId: number, areFriends: AreFriends): boolean {
	if (lobby.visibility === "open") return true;
	if (lobby.visibility === "friends") return userId === lobby.hostId || areFriends(lobby.hostId, userId);
	return false;
}

function refuse(code: LobbyRefusal, reason: string): LobbyRefused {
	return { ok: false, code, reason };
}

/** A UserId as the wire carries it (config.ts isWireUserId: Studio test players are negative, |id| is bounded). */
function isUserId(v: unknown): v is number {
	return isWireUserId(v);
}

function removeValue(arr: number[], value: number): boolean {
	const i = arr.indexOf(value);
	if (i < 0) return false;
	arr.remove(i);
	return true;
}

/** Every lobby and lobby invite of one server (see the file comment). */
export class Lobbies {
	private readonly byId = new Map<string, MutableLobby>();
	private readonly byUser = new Map<number, MutableLobby>();
	/** Creation order. */
	private readonly invites: LobbyInvite[] = [];
	private readonly config: LobbyConfig;
	private seq = 0;

	constructor(private readonly deps: LobbiesDeps) {
		this.config = deps.config ?? LOBBY;
	}

	// ---------------------------------------------------------------------------------------------
	// Membership

	create(
		hostId: number,
		request: LobbyCreateRequest | undefined,
		ctx: LobbyContext,
	): LobbyResult<{ lobby: Lobby; droppedInvites: ReadonlyArray<LobbyInvite> }> {
		if (request !== undefined && !typeIs(request, "table")) return refuse("badRequest", "request is not an object");
		const visibility = request?.visibility ?? this.config.defaultVisibility;
		if (!isLobbyVisibility(visibility)) return refuse("badRequest", "unknown visibility");
		const nameId = request?.nameId ?? DEFAULT_LOBBY_NAME;
		if (!isLobbyNameId(nameId)) return refuse("badName", "unknown lobby name");
		const worldKind = request?.worldKind ?? this.config.defaultWorld;
		if (!isLobbyWorld(worldKind)) return refuse("badRequest", "unknown world");
		const busy = ctx.busyReason(hostId);
		if (busy !== undefined) return refuse("busy", busy);
		if (this.byUser.has(hostId)) return refuse("alreadyInLobby", "already in a lobby");
		this.seq += 1;
		const lobby: MutableLobby = {
			lobbyId: this.deps.newId(),
			seq: this.seq,
			createdAt: ctx.now,
			hostId,
			nameId,
			visibility,
			worldKind,
			phase: "forming",
			members: [hostId],
			ready: [],
			kickedUntil: new Map(),
		};
		this.byId.set(lobby.lobbyId, lobby);
		this.byUser.set(hostId, lobby);
		const droppedInvites = this.dropInvites((inv) => inv.toUserId === hostId);
		return { ok: true, lobby, droppedInvites };
	}

	join(
		userId: number,
		lobbyId: string,
		ctx: LobbyContext,
	): LobbyResult<{ lobby: Lobby; usedInvite?: LobbyInvite; droppedInvites: ReadonlyArray<LobbyInvite> }> {
		if (!this.isLobbyIdShape(lobbyId)) return refuse("badRequest", "lobbyId must be a short string");
		const busy = ctx.busyReason(userId);
		if (busy !== undefined) return refuse("busy", busy);
		if (this.byUser.has(userId)) return refuse("alreadyInLobby", "already in a lobby");
		const lobby = this.byId.get(lobbyId);
		if (lobby === undefined) return refuse("unknownLobby", "no such lobby");
		if (lobby.phase === "inRun") return refuse("inRun", "the lobby is in a run");
		if (lobby.phase === "countdown") return refuse("starting", "the lobby is starting");
		if (lobby.members.size() >= this.config.maxSize) return refuse("full", "the lobby is full");
		if (this.onKickCooldown(lobby, userId, ctx.now)) return refuse("kickCooldown", "kicked from this lobby");
		const invite = this.liveInvite(lobby.lobbyId, userId, ctx.now);
		if (invite === undefined && !canAccess(lobby, userId, ctx.areFriends)) {
			return refuse("noAccess", lobby.visibility === "closed" ? "invite only" : "friends of the host only");
		}
		lobby.members.push(userId);
		this.byUser.set(userId, lobby);
		const dropped = this.dropInvites((inv) => inv.toUserId === userId);
		const droppedInvites: LobbyInvite[] = [];
		for (const inv of dropped) if (inv !== invite) droppedInvites.push(inv);
		return { ok: true, lobby, usedInvite: invite, droppedInvites };
	}

	/** Leaves the player's lobby (allowed in any phase). */
	leave(userId: number): LobbyResult<{ departure: LobbyDeparture }> {
		const lobby = this.byUser.get(userId);
		if (lobby === undefined) return refuse("notMember", "not in a lobby");
		return { ok: true, departure: this.depart(lobby, userId, false) };
	}

	/**
	 * The player left the server: they leave their lobby (a member of an `inRun` lobby is just removed) and the
	 * invites they received are dropped (the ones they sent belong to their lobby and stay).
	 */
	playerRemoving(userId: number): { departure?: LobbyDeparture; droppedInvites: ReadonlyArray<LobbyInvite> } {
		const lobby = this.byUser.get(userId);
		const departure = lobby !== undefined ? this.depart(lobby, userId, false) : undefined;
		const droppedInvites = this.dropInvites((inv) => inv.toUserId === userId);
		return { departure, droppedInvites };
	}

	// ---------------------------------------------------------------------------------------------
	// Invites

	invite(
		fromUserId: number,
		toUserId: number,
		ctx: LobbyContext,
	): LobbyResult<{ invite: LobbyInvite; lobby: Lobby }> {
		if (!isUserId(toUserId)) return refuse("badRequest", "toUserId must be an integer");
		const lobby = this.byUser.get(fromUserId);
		if (lobby === undefined) return refuse("notMember", "not in a lobby");
		if (toUserId === fromUserId) return refuse("badRequest", "cannot invite yourself");
		if (lobby.phase === "inRun") return refuse("inRun", "the lobby is in a run");
		const busy = ctx.busyReason(toUserId);
		if (busy !== undefined) return refuse("busy", busy);
		if (this.byUser.has(toUserId)) return refuse("alreadyInLobby", "that player is already in a lobby");
		if (lobby.members.size() >= this.config.maxSize) return refuse("full", "the lobby is full");
		const refused = this.inviteeRefusal(lobby, toUserId, ctx.now);
		if (refused !== undefined) return refused;
		if (this.liveSent(fromUserId, "server", ctx.now) >= this.config.maxInvitesPerMember) {
			return refuse("inviteCap", "too many pending invites");
		}
		const invite = this.addInvite(lobby, fromUserId, toUserId, "server", this.config.inviteTimeoutSeconds, ctx.now);
		return { ok: true, invite, lobby };
	}

	/**
	 * Invites from Roblox's invite prompt (source "platform"): `toUserIds` are the friends the member picked, as the
	 * client or the prompt reported them, so the list is shape-checked (an array of integers, at most
	 * maxPlatformInvitesPerMember long; a repeated id counts once). The invitees may be absent from this server. The
	 * sender rules are `invite`'s; per id: not the sender, not in this server (`inServer`: those must go through
	 * `invite`, with its cap and short TTL; `badRequest`), not busy, not in a lobby, not on the kick cooldown, not
	 * already invited here (by any source), and within the sender's own platform cap. Returns the invites made and a
	 * refusal per id skipped, both in list order.
	 */
	platformInvites(
		fromUserId: number,
		toUserIds: unknown,
		ctx: LobbyContext,
		inServer: (userId: number) => boolean = () => false,
	): LobbyResult<{
		lobby: Lobby;
		invites: ReadonlyArray<LobbyInvite>;
		refusals: ReadonlyArray<LobbyInviteRefusal>;
	}> {
		const ids = this.userIdList(toUserIds, this.config.maxPlatformInvitesPerMember);
		if (ids === undefined) {
			return refuse(
				"badRequest",
				`toUserIds must be a list of at most ${this.config.maxPlatformInvitesPerMember} integers`,
			);
		}
		const lobby = this.byUser.get(fromUserId);
		if (lobby === undefined) return refuse("notMember", "not in a lobby");
		if (lobby.phase === "inRun") return refuse("inRun", "the lobby is in a run");
		if (lobby.members.size() >= this.config.maxSize) return refuse("full", "the lobby is full");
		const invites: LobbyInvite[] = [];
		const refusals: LobbyInviteRefusal[] = [];
		let sent = this.liveSent(fromUserId, "platform", ctx.now);
		for (const toUserId of ids) {
			let refused: LobbyRefused | undefined;
			if (toUserId === fromUserId) refused = refuse("badRequest", "cannot invite yourself");
			if (refused === undefined && inServer(toUserId)) {
				refused = refuse("badRequest", "that player is in this server: use the lobby's invite list");
			}
			if (refused === undefined) {
				const busy = ctx.busyReason(toUserId);
				if (busy !== undefined) refused = refuse("busy", busy);
			}
			if (refused === undefined && this.byUser.has(toUserId)) {
				refused = refuse("alreadyInLobby", "that player is already in a lobby");
			}
			if (refused === undefined) refused = this.inviteeRefusal(lobby, toUserId, ctx.now);
			if (refused === undefined && sent >= this.config.maxPlatformInvitesPerMember) {
				refused = refuse("inviteCap", "too many pending invites");
			}
			if (refused !== undefined) {
				refusals.push({ userId: toUserId, code: refused.code, reason: refused.reason });
				continue;
			}
			const ttl = this.config.platformInviteTimeoutSeconds;
			invites.push(this.addInvite(lobby, fromUserId, toUserId, "platform", ttl, ctx.now));
			sent += 1;
		}
		return { ok: true, lobby, invites, refusals };
	}

	/**
	 * The server's invite for a Roblox Party mate (source "party", shared/invite arrival.ts): from a member of a
	 * forming-or-countdown lobby with room to a player who is not in a lobby, not on its kick cooldown and not
	 * already invited here. Unlike `invite` the invitee MAY be busy (a mate in a run answers it on return) and no cap
	 * applies; it lasts platformInviteTimeoutSeconds.
	 */
	partyInvite(
		fromUserId: number,
		toUserId: number,
		ctx: Pick<LobbyContext, "now">,
	): LobbyResult<{ invite: LobbyInvite; lobby: Lobby }> {
		if (!isUserId(toUserId)) return refuse("badRequest", "toUserId must be an integer");
		const lobby = this.byUser.get(fromUserId);
		if (lobby === undefined) return refuse("notMember", "not in a lobby");
		if (toUserId === fromUserId) return refuse("badRequest", "cannot invite yourself");
		if (lobby.phase === "inRun") return refuse("inRun", "the lobby is in a run");
		if (this.byUser.has(toUserId)) return refuse("alreadyInLobby", "that player is already in a lobby");
		if (lobby.members.size() >= this.config.maxSize) return refuse("full", "the lobby is full");
		const refused = this.inviteeRefusal(lobby, toUserId, ctx.now);
		if (refused !== undefined) return refused;
		const ttl = this.config.platformInviteTimeoutSeconds;
		const invite = this.addInvite(lobby, fromUserId, toUserId, "party", ttl, ctx.now);
		return { ok: true, invite, lobby };
	}

	/** The invitee says no: the invite is dropped. */
	decline(userId: number, inviteId: string): LobbyResult<{ invite: LobbyInvite }> {
		if (!this.isLobbyIdShape(inviteId)) return refuse("badRequest", "inviteId must be a short string");
		const dropped = this.dropInvites((inv) => inv.inviteId === inviteId && inv.toUserId === userId);
		if (dropped.size() === 0) return refuse("notInvited", "no such invite for this player");
		return { ok: true, invite: dropped[0] };
	}

	// ---------------------------------------------------------------------------------------------
	// Host only

	kick(hostId: number, targetId: number, ctx: Pick<LobbyContext, "now">): LobbyResult<{ departure: LobbyDeparture }> {
		if (!isUserId(targetId)) return refuse("badRequest", "userId must be an integer");
		const hosted = this.hostedBy(hostId);
		if (!hosted.ok) return hosted;
		const lobby = hosted.lobby;
		if (targetId === hostId) return refuse("badRequest", "cannot kick yourself");
		if (this.byUser.get(targetId) !== lobby) return refuse("notMember", "that player is not in this lobby");
		if (lobby.phase === "inRun") return refuse("inRun", "the lobby is in a run");
		lobby.kickedUntil.set(targetId, ctx.now + this.config.kickCooldownSeconds);
		return { ok: true, departure: this.depart(lobby, targetId, true) };
	}

	/** Never removes members; pending invites stay valid. */
	setVisibility(hostId: number, visibility: string): LobbyResult<{ lobby: Lobby }> {
		if (!isLobbyVisibility(visibility)) return refuse("badRequest", "unknown visibility");
		const hosted = this.hostedBy(hostId);
		if (!hosted.ok) return hosted;
		const lobby = hosted.lobby;
		lobby.visibility = visibility;
		return { ok: true, lobby };
	}

	setName(hostId: number, nameId: string): LobbyResult<{ lobby: Lobby }> {
		if (!isLobbyNameId(nameId)) return refuse("badName", "unknown lobby name");
		const hosted = this.hostedBy(hostId);
		if (!hosted.ok) return hosted;
		const lobby = hosted.lobby;
		lobby.nameId = nameId;
		return { ok: true, lobby };
	}

	/**
	 * The lobby's world (LOBBY_WORLDS), while forming only (a countdown or a run plays the world it started with). A
	 * change clears every Ready (the members readied for the other world); the same world changes nothing.
	 */
	setWorld(hostId: number, worldKind: string): LobbyResult<{ lobby: Lobby; changed: boolean }> {
		if (!isLobbyWorld(worldKind)) return refuse("badRequest", "unknown world");
		const hosted = this.hostedBy(hostId);
		if (!hosted.ok) return hosted;
		const lobby = hosted.lobby;
		if (lobby.phase === "inRun") return refuse("inRun", "the lobby is in a run");
		if (lobby.phase === "countdown") return refuse("starting", "the lobby is starting");
		if (lobby.worldKind === worldKind) return { ok: true, lobby, changed: false };
		lobby.worldKind = worldKind;
		lobby.ready.clear();
		return { ok: true, lobby, changed: true };
	}

	transferHost(hostId: number, toUserId: number): LobbyResult<{ lobby: Lobby }> {
		if (!isUserId(toUserId)) return refuse("badRequest", "userId must be an integer");
		const hosted = this.hostedBy(hostId);
		if (!hosted.ok) return hosted;
		const lobby = hosted.lobby;
		if (toUserId === hostId) return refuse("badRequest", "already the host");
		if (this.byUser.get(toUserId) !== lobby) return refuse("notMember", "that player is not in this lobby");
		lobby.hostId = toUserId;
		return { ok: true, lobby };
	}

	/** Every member ready (one member is enough): the countdown begins (`countdownEndsAt`). */
	start(hostId: number, ctx: LobbyContext): LobbyResult<{ lobby: Lobby }> {
		const hosted = this.hostedBy(hostId);
		if (!hosted.ok) return hosted;
		const lobby = hosted.lobby;
		if (lobby.phase === "inRun") return refuse("inRun", "the lobby is in a run");
		if (lobby.phase === "countdown") return refuse("starting", "the lobby is already starting");
		for (const id of lobby.members) {
			if (!lobby.ready.includes(id)) return refuse("notReady", `player ${id} is not ready`);
		}
		for (const id of lobby.members) {
			const busy = ctx.busyReason(id);
			if (busy !== undefined) return refuse("busy", busy);
		}
		lobby.phase = "countdown";
		lobby.countdownEndsAt = ctx.now + this.config.countdownSeconds;
		return { ok: true, lobby };
	}

	// ---------------------------------------------------------------------------------------------
	// Ready, countdown, run

	/** A member's Ready toggle (forming or countdown). Un-readying during the countdown cancels it. */
	setReady(userId: number, ready: boolean): LobbyResult<{ lobby: Lobby; countdownCancelled: boolean }> {
		if (!typeIs(ready, "boolean")) return refuse("badRequest", "ready must be a boolean");
		const lobby = this.byUser.get(userId);
		if (lobby === undefined) return refuse("notMember", "not in a lobby");
		if (lobby.phase === "inRun") return refuse("inRun", "the lobby is in a run");
		let countdownCancelled = false;
		if (ready) {
			if (!lobby.ready.includes(userId)) lobby.ready.push(userId);
		} else if (removeValue(lobby.ready, userId) && lobby.phase === "countdown") {
			this.cancelCountdown(lobby);
			countdownCancelled = true;
		}
		return { ok: true, lobby, countdownCancelled };
	}

	/**
	 * Call often (every second or so): ends due countdowns (each starts a run, or is cancelled when a member is busy)
	 * and drops expired invites and kick cooldowns. Results are in creation order.
	 */
	tick(ctx: Pick<LobbyContext, "now" | "busyReason">): LobbyTickResult {
		const due: MutableLobby[] = [];
		for (const [, lobby] of this.byId) {
			for (const [userId, endsAt] of lobby.kickedUntil) if (ctx.now >= endsAt) lobby.kickedUntil.delete(userId);
			if (
				lobby.phase === "countdown" &&
				lobby.countdownEndsAt !== undefined &&
				ctx.now >= lobby.countdownEndsAt
			) {
				due.push(lobby);
			}
		}
		due.sort((a, b) => a.seq < b.seq);
		const starts: LobbyRunStart[] = [];
		const cancelled: { lobby: Lobby; reason: string }[] = [];
		for (const lobby of due) {
			let busy: string | undefined;
			for (const id of lobby.members) {
				busy = ctx.busyReason(id);
				if (busy !== undefined) break;
			}
			if (busy !== undefined) {
				this.cancelCountdown(lobby);
				cancelled.push({ lobby, reason: busy });
				continue;
			}
			lobby.phase = "inRun";
			lobby.countdownEndsAt = undefined;
			const members = [...lobby.members];
			const worldKind = lobby.worldKind;
			starts.push(
				members.size() === 1
					? { kind: "solo", lobbyId: lobby.lobbyId, userId: members[0], worldKind }
					: { kind: "party", lobbyId: lobby.lobbyId, members, worldKind },
			);
		}
		const expiredInvites = this.dropInvites((inv) => ctx.now >= inv.expiresAt);
		return { starts, cancelled, expiredInvites };
	}

	/** The lobby's run is over (or could not be created): back to `forming`, every Ready cleared. */
	runEnded(lobbyId: string): LobbyResult<{ lobby: Lobby }> {
		const lobby = this.byId.get(lobbyId);
		if (lobby === undefined) return refuse("unknownLobby", "no such lobby");
		if (lobby.phase !== "inRun") return refuse("notInRun", "the lobby is not in a run");
		lobby.phase = "forming";
		lobby.ready.clear();
		return { ok: true, lobby };
	}

	// ---------------------------------------------------------------------------------------------
	// Queries

	/** The browse list for one viewer: lobbies they canAccess (never closed), sorted (see the file comment). */
	summariesFor(viewerId: number, areFriends: AreFriends): LobbySummary[] {
		const rows: { summary: LobbySummary; seq: number }[] = [];
		for (const [, lobby] of this.byId) {
			if (lobby.visibility === "closed" || !canAccess(lobby, viewerId, areFriends)) continue;
			let hasFriend = false;
			for (const id of lobby.members) {
				if (id !== viewerId && areFriends(viewerId, id)) {
					hasFriend = true;
					break;
				}
			}
			rows.push({
				seq: lobby.seq,
				summary: {
					lobbyId: lobby.lobbyId,
					nameId: lobby.nameId,
					hostId: lobby.hostId,
					count: lobby.members.size(),
					max: this.config.maxSize,
					visibility: lobby.visibility,
					worldKind: lobby.worldKind,
					phase: lobby.phase,
					hasFriend,
				},
			});
		}
		rows.sort((a, b) => {
			const af = a.summary.visibility === "friends";
			const bf = b.summary.visibility === "friends";
			if (af !== bf) return af;
			if (a.summary.hasFriend !== b.summary.hasFriend) return a.summary.hasFriend;
			if (a.summary.count !== b.summary.count) return a.summary.count > b.summary.count;
			return a.seq < b.seq;
		});
		const out: LobbySummary[] = [];
		for (const row of rows) out.push(row.summary);
		return out;
	}

	get(lobbyId: string): Lobby | undefined {
		return this.byId.get(lobbyId);
	}

	lobbyOf(userId: number): Lobby | undefined {
		return this.byUser.get(userId);
	}

	/** Live invites the player received, oldest first. */
	invitesFor(userId: number, now: number): LobbyInvite[] {
		const out: LobbyInvite[] = [];
		for (const inv of this.invites) if (inv.toUserId === userId && now < inv.expiresAt) out.push(inv);
		return out;
	}

	/** Live invites to a lobby, oldest first. */
	invitesTo(lobbyId: string, now: number): LobbyInvite[] {
		const out: LobbyInvite[] = [];
		for (const inv of this.invites) if (inv.lobbyId === lobbyId && now < inv.expiresAt) out.push(inv);
		return out;
	}

	/** Lobbies in this server. */
	size(): number {
		return this.byId.size();
	}

	// ---------------------------------------------------------------------------------------------

	private isLobbyIdShape(id: unknown): id is string {
		return typeIs(id, "string") && id.size() > 0 && id.size() <= this.config.maxIdChars;
	}

	/** The lobby this player hosts, or the refusal. */
	private hostedBy(hostId: number): LobbyResult<{ lobby: MutableLobby }> {
		const lobby = this.byUser.get(hostId);
		if (lobby === undefined) return refuse("notMember", "not in a lobby");
		if (lobby.hostId !== hostId) return refuse("notHost", "only the host can do that");
		return { ok: true, lobby };
	}

	private onKickCooldown(lobby: MutableLobby, userId: number, now: number): boolean {
		const untilAt = lobby.kickedUntil.get(userId);
		return untilAt !== undefined && now < untilAt;
	}

	/** The checks every invite source shares about the invitee and this lobby: kick cooldown, already invited. */
	private inviteeRefusal(lobby: MutableLobby, toUserId: number, now: number): LobbyRefused | undefined {
		if (this.onKickCooldown(lobby, toUserId, now)) {
			return refuse("kickCooldown", "that player was kicked from this lobby");
		}
		if (this.liveInvite(lobby.lobbyId, toUserId, now) !== undefined) {
			return refuse("alreadyInvited", "that player is already invited");
		}
		return undefined;
	}

	/** Live invites of one source the player has sent (across lobbies): that source's cap. */
	private liveSent(fromUserId: number, source: LobbyInviteSource, now: number): number {
		let sent = 0;
		for (const inv of this.invites) {
			if (inv.fromUserId === fromUserId && inv.source === source && now < inv.expiresAt) sent += 1;
		}
		return sent;
	}

	private addInvite(
		lobby: MutableLobby,
		fromUserId: number,
		toUserId: number,
		source: LobbyInviteSource,
		ttlSeconds: number,
		now: number,
	): LobbyInvite {
		// An expired invite to the same player may still be stored (tick drops it): replace it.
		this.dropInvites((inv) => inv.lobbyId === lobby.lobbyId && inv.toUserId === toUserId);
		const invite: LobbyInvite = {
			inviteId: this.deps.newId(),
			lobbyId: lobby.lobbyId,
			toUserId,
			fromUserId,
			createdAt: now,
			expiresAt: now + ttlSeconds,
			source,
		};
		this.invites.push(invite);
		return invite;
	}

	/**
	 * A client-supplied UserId list: a plain array (no other keys) of at most `max` integers, repeats removed (first
	 * kept); undefined when malformed.
	 */
	private userIdList(v: unknown, max: number): number[] | undefined {
		if (!typeIs(v, "table")) return undefined;
		const arr = v as unknown[];
		const n = arr.size();
		if (n > max) return undefined;
		let keys = 0;
		for (const [key] of pairs(v as Map<unknown, unknown>)) {
			if (!typeIs(key, "number")) return undefined;
			keys += 1;
		}
		if (keys !== n) return undefined;
		const out: number[] = [];
		for (let i = 0; i < n; i++) {
			const id = arr[i];
			if (!isUserId(id)) return undefined;
			if (!out.includes(id)) out.push(id);
		}
		return out;
	}

	private liveInvite(lobbyId: string, userId: number, now: number): LobbyInvite | undefined {
		for (const inv of this.invites) {
			if (inv.lobbyId === lobbyId && inv.toUserId === userId && now < inv.expiresAt) return inv;
		}
		return undefined;
	}

	/** Removes (in order) and returns every invite matching `pred`. */
	private dropInvites(pred: (inv: LobbyInvite) => boolean): LobbyInvite[] {
		const dropped: LobbyInvite[] = [];
		let i = 0;
		while (i < this.invites.size()) {
			const inv = this.invites[i];
			if (pred(inv)) {
				dropped.push(inv);
				this.invites.remove(i);
			} else {
				i += 1;
			}
		}
		return dropped;
	}

	private cancelCountdown(lobby: MutableLobby): void {
		lobby.phase = "forming";
		lobby.countdownEndsAt = undefined;
	}

	private depart(lobby: MutableLobby, userId: number, kicked: boolean): LobbyDeparture {
		removeValue(lobby.members, userId);
		removeValue(lobby.ready, userId);
		this.byUser.delete(userId);
		let countdownCancelled = false;
		if (lobby.phase === "countdown") {
			this.cancelCountdown(lobby);
			countdownCancelled = true;
		}
		const lobbyId = lobby.lobbyId;
		if (lobby.members.size() === 0) {
			this.byId.delete(lobbyId);
			const droppedInvites = this.dropInvites((inv) => inv.lobbyId === lobbyId);
			return { lobbyId, userId, deleted: true, countdownCancelled, droppedInvites };
		}
		let newHostId: number | undefined;
		if (lobby.hostId === userId) {
			newHostId = lobby.members[0];
			lobby.hostId = newHostId;
		}
		const droppedInvites = kicked
			? this.dropInvites((inv) => inv.lobbyId === lobbyId && inv.toUserId === userId)
			: [];
		return { lobbyId, userId, lobby, deleted: false, newHostId, countdownCancelled, droppedInvites };
	}
}
