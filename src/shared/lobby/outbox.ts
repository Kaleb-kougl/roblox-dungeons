/**
 * What LobbyService must tell whom after a lobby change: the wire views (`lobbyState`, `lobbyInvites`) and the
 * effects of each `Lobbies` result collected in a `LobbyOutbox`, which the service flushes after every request and
 * tick. Pure, so the "who hears what" rules are specced headlessly:
 *
 *   lobby changed       every member gets a fresh `lobbyState`; the browse lists are stale.
 *   departure           the leaver gets `lobbyState {}` (kicked: also a "kicked" notice); a new host hears
 *                       "hostChanged"; a cancelled countdown is a "countdownCancelled" notice to those left; invites
 *                       dropped with it are "inviteDropped" to their invitees.
 *   invite sent / gone  the invitee gets a fresh `lobbyInvites`; the lobby's members a fresh `lobbyState` (`invited`).
 *                       Expired ones are an "inviteExpired" notice; the ones a player dropped by joining or creating a
 *                       lobby themselves are silent.
 *   refusal             a "refused" notice (requestKind, code, reason) to the requester only.
 *
 * Users are flushed in ascending UserId order (deterministic, and each hears one update however many changes).
 */
import type { LobbyInviteView, LobbyNotice, LobbyView } from "shared/network";
import type { LobbyInviteSource } from "./config";
import type { Lobby, LobbyDeparture, LobbyInvite, LobbyRefused, LobbyTickResult } from "./lobbies";

/** Countdown-cancel reason when a member left or un-readied. */
export const COUNTDOWN_CANCELLED_MEMBER_LEFT = "a member left";
export const COUNTDOWN_CANCELLED_UNREADY = "a member is not ready";

/**
 * A member's view of their lobby. `invites`: the live invites to it (`Lobbies.invitesTo`); `invitedSources[i]` is
 * the source of `invited[i]` (the first invite's, if a player somehow has two).
 */
export function lobbyViewOf(lobby: Lobby, invites: ReadonlyArray<LobbyInvite>, now: number): LobbyView {
	const invited: number[] = [];
	const invitedSources: LobbyInviteSource[] = [];
	for (const inv of invites)
		if (inv.lobbyId === lobby.lobbyId && !invited.includes(inv.toUserId)) {
			invited.push(inv.toUserId);
			invitedSources.push(inv.source);
		}
	return {
		lobbyId: lobby.lobbyId,
		nameId: lobby.nameId,
		hostId: lobby.hostId,
		visibility: lobby.visibility,
		worldKind: lobby.worldKind,
		phase: lobby.phase,
		members: [...lobby.members],
		ready: [...lobby.ready],
		countdownIn:
			lobby.phase === "countdown" && lobby.countdownEndsAt !== undefined
				? math.max(0, lobby.countdownEndsAt - now)
				: undefined,
		invited,
		invitedSources,
	};
}

/** The invites a player received (`Lobbies.invitesFor`), as the wire carries them. Invites to gone lobbies are skipped. */
export function inviteViewsOf(
	invites: ReadonlyArray<LobbyInvite>,
	lobbyOf: (lobbyId: string) => Lobby | undefined,
	now: number,
): LobbyInviteView[] {
	const out: LobbyInviteView[] = [];
	for (const inv of invites) {
		const lobby = lobbyOf(inv.lobbyId);
		if (lobby === undefined) continue;
		out.push({
			inviteId: inv.inviteId,
			lobbyId: inv.lobbyId,
			nameId: lobby.nameId,
			hostId: lobby.hostId,
			fromUserId: inv.fromUserId,
			expiresIn: math.max(0, inv.expiresAt - now),
			source: inv.source,
		});
	}
	return out;
}

export interface LobbyNoticeFor {
	readonly userId: number;
	readonly notice: LobbyNotice;
}

export interface LobbyOutboxBatch {
	/** Players who need a fresh `lobbyState` (ascending). */
	readonly state: number[];
	/** Players who need a fresh `lobbyInvites` (ascending). */
	readonly invites: number[];
	/** Notices in the order they happened. */
	readonly notices: LobbyNoticeFor[];
}

function sortedIds(set: ReadonlySet<number>): number[] {
	const out: number[] = [];
	for (const id of set) out.push(id);
	out.sort((a, b) => a < b);
	return out;
}

export class LobbyOutbox {
	private readonly state = new Set<number>();
	private readonly invites = new Set<number>();
	private notices: LobbyNoticeFor[] = [];
	/** The browse lists are stale (starts true: the first push goes out). */
	private listDirty = true;

	/** `lobby` changed (membership, phase, settings): its members' state, and the lists. */
	lobby(lobby: Lobby | undefined): void {
		if (lobby === undefined) return;
		for (const id of lobby.members) this.state.add(id);
		this.listDirty = true;
	}

	/** Only the lobby's `invited` list changed: its members' state (the lists do not show invites). */
	lobbyInvited(lobby: Lobby | undefined): void {
		if (lobby === undefined) return;
		for (const id of lobby.members) this.state.add(id);
	}

	/** `userId`'s own lobby state changed (joined, left). */
	member(userId: number): void {
		this.state.add(userId);
	}

	/** `userId`'s received invites changed. */
	invitee(userId: number): void {
		this.invites.add(userId);
	}

	notice(userId: number, notice: LobbyNotice): void {
		this.notices.push({ userId, notice });
	}

	refused(userId: number, requestKind: string, r: LobbyRefused): void {
		this.notice(userId, { kind: "refused", requestKind, code: r.code, reason: r.reason });
	}

	/** Friend answers changed, or a player joined / left the server: every list is stale. */
	markList(): void {
		this.listDirty = true;
	}

	/** A new invite: the invitee's list and the lobby's `invited`. */
	invited(invite: LobbyInvite, lobby: Lobby): void {
		this.invitee(invite.toUserId);
		this.lobbyInvited(lobby);
	}

	/**
	 * Invites gone: each invitee's list and its lobby's `invited` (if the lobby still exists). `notice`: tell the
	 * invitee (`inviteExpired` / `inviteDropped`); omitted when the invitee dropped them themselves.
	 */
	droppedInvites(
		invites: ReadonlyArray<LobbyInvite>,
		lobbyOf: (lobbyId: string) => Lobby | undefined,
		notice?: "inviteExpired" | "inviteDropped",
	): void {
		for (const inv of invites) {
			this.invitee(inv.toUserId);
			this.lobbyInvited(lobbyOf(inv.lobbyId));
			if (notice !== undefined) this.notice(inv.toUserId, { kind: notice, lobbyId: inv.lobbyId });
		}
	}

	/** A member left or was kicked (see the file comment). */
	departure(dep: LobbyDeparture, kicked: boolean, lobbyOf: (lobbyId: string) => Lobby | undefined): void {
		this.member(dep.userId);
		this.listDirty = true;
		if (kicked) this.notice(dep.userId, { kind: "kicked", lobbyId: dep.lobbyId });
		const lobby = dep.lobby;
		if (lobby !== undefined) {
			this.lobby(lobby);
			if (dep.newHostId !== undefined) this.notice(dep.newHostId, { kind: "hostChanged", lobbyId: dep.lobbyId });
			if (dep.countdownCancelled) this.countdownCancelled(lobby, COUNTDOWN_CANCELLED_MEMBER_LEFT);
		}
		this.droppedInvites(dep.droppedInvites, lobbyOf, "inviteDropped");
	}

	/** A start countdown stopped: every member hears why. */
	countdownCancelled(lobby: Lobby, reason: string): void {
		this.lobby(lobby);
		for (const id of lobby.members) this.notice(id, { kind: "countdownCancelled", lobbyId: lobby.lobbyId, reason });
	}

	/** `Lobbies.tick`'s cancellations and expiries (its starts are the service's: they need the run sessions). */
	tick(result: LobbyTickResult, lobbyOf: (lobbyId: string) => Lobby | undefined): void {
		for (const c of result.cancelled) this.countdownCancelled(c.lobby, c.reason);
		this.droppedInvites(result.expiredInvites, lobbyOf, "inviteExpired");
	}

	/** Takes (and clears) the pending state / invite pushes and notices. */
	take(): LobbyOutboxBatch {
		const batch: LobbyOutboxBatch = {
			state: sortedIds(this.state),
			invites: sortedIds(this.invites),
			notices: this.notices,
		};
		this.state.clear();
		this.invites.clear();
		this.notices = [];
		return batch;
	}

	/** True once per change: the lists must be pushed (the service paces the push). */
	takeList(): boolean {
		const dirty = this.listDirty;
		this.listDirty = false;
		return dirty;
	}

	isListDirty(): boolean {
		return this.listDirty;
	}
}
