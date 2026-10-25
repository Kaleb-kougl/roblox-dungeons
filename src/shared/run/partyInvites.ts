/**
 * Co-op consent (M4): a party run starts only once EVERY member accepted. The host's `partyInvite` names the others;
 * each of them gets the invite and answers `partyRespond(inviteId, accept)`; the invite is READY when everyone
 * accepted, and only then does the server create the run (RunSessionRegistry.start refuses a party without this
 * consent). Nobody can be pulled into a run, or have their client switched to one, without saying yes.
 *
 *   invite(host, request)     shape, party (members in this server, 2..maxPartySize), nobody `busy` (in a party run
 *                             that is not concluded: ctx.busyReason). Replaces the host's own pending invite. The host
 *                             counts as accepted.
 *   respond(user, id, yes)    a member's answer while the invite is pending and not expired: a decline cancels it
 *                             for everyone; an accept from a busy member is refused (`busy`, the invite stays open);
 *                             the last accept makes it `ready` (the caller starts the run, then `started`).
 *   expiry / leaving          sweep(now) expires invites past `ttlSeconds`; removePlayer cancels every invite naming
 *                             a player who left the server.
 *   started(id)               the run exists: other pending invites naming any of its members are cancelled (one
 *                             party run per player).
 *
 * Pure and Roblox-API-free: ids and the clock are injected (HttpService GUIDs / os.clock on the server).
 */
import { MAX_WORLD_KIND_CHARS, type RunSessionLimits } from "./limits";
import { resolveParty } from "./runSessions";
import { isFiniteValue } from "./validate";
import { isRunWorldKind, type RunWorldKind } from "./worlds";

/** `partyInvite` (shared/network): the host asks the named players to a co-op run. */
export interface PartyInviteRequest {
	/** Echoed in the host's first `partyInviteUpdate`. */
	requestId: number;
	/** A registered world kind (worlds.ts). */
	worldKind: string;
	/** The OTHER members' UserIds (the host is added first). */
	members: number[];
}

export type PartyInviteStatus = "pending" | "ready" | "started" | "declined" | "cancelled" | "expired";

export type PartyInviteRefusal = "bad_request" | "unknown_world" | "bad_party" | "busy" | "not_invited" | "closed";

export interface PartyInvite {
	readonly inviteId: string;
	readonly hostId: number;
	/** Host first, then the invited players in request order (the run's player index order). */
	readonly members: ReadonlyArray<number>;
	readonly worldKind: RunWorldKind;
	readonly createdAt: number;
	readonly expiresAt: number;
	/** Members who accepted (the host from the start), in acceptance order. */
	readonly accepted: number[];
	status: PartyInviteStatus;
	/** Why it closed (declined / cancelled / expired), for the members' notice. */
	reason?: string;
}

export interface PartyInviteContext {
	readonly now: number;
	/** The UserId is a player in this server. */
	readonly isInServer: (userId: number) => boolean;
	/** Why the player cannot join a party run now (in an unconcluded party run), or undefined. */
	readonly busyReason: (userId: number) => string | undefined;
}

export type PartyInviteResult =
	| { readonly ok: true; readonly invite: PartyInvite; readonly replaced?: PartyInvite }
	| { readonly ok: false; readonly code: PartyInviteRefusal; readonly reason: string };

export type PartyRespondResult =
	| { readonly ok: true; readonly invite: PartyInvite }
	| { readonly ok: false; readonly code: PartyInviteRefusal; readonly reason: string; readonly invite?: PartyInvite };

export interface PartyInvitesDeps {
	readonly newId: () => string;
	readonly ttlSeconds: number;
	readonly limits: Pick<RunSessionLimits, "maxPartySize">;
}

function requestShape(r: PartyInviteRequest): string | undefined {
	if (!typeIs(r, "table")) return "request is not an object";
	if (!isFiniteValue(r.requestId)) return "requestId must be a number";
	if (!typeIs(r.worldKind, "string") || r.worldKind.size() === 0 || r.worldKind.size() > MAX_WORLD_KIND_CHARS) {
		return "worldKind must be a short string";
	}
	if (!typeIs(r.members, "table")) return "members must be an array";
	return undefined;
}

/** Every pending invite of one server (see the file comment). */
export class PartyInvites {
	private readonly byId = new Map<string, PartyInvite>();

	constructor(private readonly deps: PartyInvitesDeps) {}

	invite(hostId: number, request: PartyInviteRequest, ctx: PartyInviteContext): PartyInviteResult {
		const shape = requestShape(request);
		if (shape !== undefined) return { ok: false, code: "bad_request", reason: `bad request: ${shape}` };
		if (!isRunWorldKind(request.worldKind)) {
			return { ok: false, code: "unknown_world", reason: `unknown world kind ${request.worldKind}` };
		}
		const party = resolveParty(hostId, request.members, ctx.isInServer, this.deps.limits.maxPartySize);
		if (typeIs(party, "string")) return { ok: false, code: "bad_party", reason: `bad party: ${party}` };
		if (party.size() < 2) return { ok: false, code: "bad_party", reason: "bad party: invite at least one player" };
		for (const id of party) {
			const busy = ctx.busyReason(id);
			if (busy !== undefined) return { ok: false, code: "busy", reason: busy };
		}
		const replaced = this.pendingHostedBy(hostId);
		if (replaced !== undefined) this.close(replaced, "cancelled", "the host sent a new invite");
		const invite: PartyInvite = {
			inviteId: this.deps.newId(),
			hostId,
			members: party,
			worldKind: request.worldKind,
			createdAt: ctx.now,
			expiresAt: ctx.now + this.deps.ttlSeconds,
			accepted: [hostId],
			status: "pending",
		};
		this.byId.set(invite.inviteId, invite);
		return { ok: true, invite, replaced };
	}

	respond(userId: number, inviteId: string, accept: boolean, ctx: PartyInviteContext): PartyRespondResult {
		const invite = typeIs(inviteId, "string") ? this.byId.get(inviteId) : undefined;
		if (invite === undefined || !invite.members.includes(userId) || userId === invite.hostId) {
			return { ok: false, code: "not_invited", reason: "no such invite for this player" };
		}
		if (invite.status === "pending" && ctx.now >= invite.expiresAt) this.close(invite, "expired", "invite expired");
		if (invite.status !== "pending") {
			return { ok: false, code: "closed", reason: `invite ${invite.status}`, invite };
		}
		if (accept !== true) {
			this.close(invite, "declined", `declined by ${userId}`);
			return { ok: true, invite };
		}
		const busy = ctx.busyReason(userId);
		if (busy !== undefined) return { ok: false, code: "busy", reason: busy, invite };
		if (!invite.accepted.includes(userId)) invite.accepted.push(userId);
		if (invite.accepted.size() === invite.members.size()) invite.status = "ready";
		return { ok: true, invite };
	}

	/**
	 * The ready invite's run was created: it is done, and every other pending invite naming one of its members is
	 * cancelled (returned, so the caller tells their members).
	 */
	started(inviteId: string): PartyInvite[] {
		const invite = this.byId.get(inviteId);
		const cancelled: PartyInvite[] = [];
		if (invite === undefined) return cancelled;
		invite.status = "started";
		this.byId.delete(inviteId);
		for (const [, other] of this.byId) {
			if (other.status !== "pending") continue;
			if (other.members.some((id) => invite.members.includes(id))) cancelled.push(other);
		}
		for (const other of cancelled) this.close(other, "cancelled", "a member joined another party run");
		return cancelled;
	}

	/** Closes an invite that will not start (the run could not be created, ...). */
	cancel(inviteId: string, reason: string): PartyInvite | undefined {
		const invite = this.byId.get(inviteId);
		if (invite !== undefined) this.close(invite, "cancelled", reason);
		return invite;
	}

	/** Expires pending invites at `now`; returns them. */
	sweep(now: number): PartyInvite[] {
		const out: PartyInvite[] = [];
		for (const [, invite] of this.byId)
			if (invite.status === "pending" && now >= invite.expiresAt) out.push(invite);
		for (const invite of out) this.close(invite, "expired", "invite expired");
		return out;
	}

	/** A player left the server: every invite naming them is cancelled; returns those. */
	removePlayer(userId: number): PartyInvite[] {
		const out: PartyInvite[] = [];
		for (const [, invite] of this.byId) if (invite.members.includes(userId)) out.push(invite);
		for (const invite of out) this.close(invite, "cancelled", `player ${userId} left`);
		return out;
	}

	get(inviteId: string): PartyInvite | undefined {
		return this.byId.get(inviteId);
	}

	/** Open invites (pending or ready). */
	size(): number {
		return this.byId.size();
	}

	private pendingHostedBy(hostId: number): PartyInvite | undefined {
		for (const [, invite] of this.byId) if (invite.hostId === hostId && invite.status === "pending") return invite;
		return undefined;
	}

	private close(invite: PartyInvite, status: PartyInviteStatus, reason: string): void {
		invite.status = status;
		invite.reason = reason;
		this.byId.delete(invite.inviteId);
	}
}
