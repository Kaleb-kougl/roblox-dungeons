/**
 * Where a player who just joined the server goes (docs/INVITES.md §3 and "Roblox Party"): pure, so InviteService
 * (task I4) only gathers the facts and applies the actions. The first rule that matches wins:
 *
 *   1  a live invite (platform, party or server) to a lobby that can take them (forming, room, no kick cooldown):
 *      the LaunchData lobby's invite first, else the oldest -> `joinInvite` (ID1: tapping the notification was the
 *      answer; ID2: Closed lobbies included)
 *   2  the LaunchData lobby can take them and `canAccess` lets them in (Open, or the host's friend) -> `joinOpen`,
 *      exactly what the browser's Join would do (so a forged lobby id gains nothing)
 *   3  the LaunchData lobby could take them but is closed to them and they have no invite -> the `followed` notice
 *      to the sender (only if the sender is a member: a forged sender id notifies nobody); any member can invite
 *   4  Roblox Party (`party`, mates already in this server):
 *        a mate's lobby can take them -> `partyJoin` (the service makes a party invite from that mate, so Closed
 *          works, and joins with it); mates are tried in party order
 *        else a mate is in a lobby that cannot (full / starting / in a run / kicked) -> a toast
 *          (`lobby.err.partyFull` for a full one), nothing else
 *        else (no mate in a lobby) if anyone besides the arrival is here -> `makePartyLobby`: the free (not busy)
 *          party members in party order, the first `LOBBY.maxSize` of them in the lobby (host = the first: earliest
 *          `acceptOrder`, else server join order with the arrival last), the rest get `lobby.err.partyFull`; busy
 *          mates (in a run, the tutorial) get party invites they answer afterwards (or the partyFull toast when the
 *          lobby is already full). A lone arrival whose only mates are busy hosts it.
 *   5  LaunchData `game` (a menu invite) -> the `inviteArrived` notice to the sender
 *   6  the LaunchData lobby (else the oldest invite's) cannot take them -> a toast: gone / full / in a run (a
 *      starting countdown reads as in a run) / kick cooldown. A live invite stays live (joinable after the run).
 *   7  none
 *
 * A busy arrival (`isBusy`: a run or the tutorial already going, as for a late LaunchData) or one already in a lobby
 * is never moved: rules 1 and 2 become a `lobby.err.busy` / `lobby.err.alreadyInLobby` toast (none for the lobby they
 * are in), rule 4 is skipped; notices (3, 5) and toasts (6) still go out.
 *
 * Arrival only: a `PartyId` change mid-session, and later arrivals' effect on players already placed, are not this
 * function's job (ID4: mid-session grouping is only an offer, InviteService's toast). Notices name players who may
 * have left; the service drops those. Roblox-API-free; the lobby facts come in through `ArrivalInput`.
 */
import { LOBBY, type Lobby, type LobbyInvite } from "shared/lobby";
import type { InviteLaunch } from "./launchData";

/** Toast string ids (theme `lobby.err.*`, read like the refusal codes' strings). */
export const ARRIVAL_TOAST = {
	/** The lobby is full. */
	full: "lobby.err.full",
	/** The lobby the invite named is gone (deleted, or not in this server). */
	gone: "lobby.err.inviteGone",
	/** The lobby is in a run or starting one. */
	inRun: "lobby.err.inRun",
	/** The party's lobby has no room for this player. */
	partyFull: "lobby.err.partyFull",
	/** The kick cooldown keeps them out of that lobby for now. */
	kickCooldown: "lobby.err.kickCooldown",
	/** A busy arrival would have been moved into a lobby. */
	busy: "lobby.err.busy",
	/** An arrival already in a lobby (a late LaunchData) would have been moved into another. */
	alreadyInLobby: "lobby.err.alreadyInLobby",
} as const;
export type ArrivalToastKey = (typeof ARRIVAL_TOAST)[keyof typeof ARRIVAL_TOAST];

/** The notices an arrival sends (shared/network LobbyNotice kinds). */
export type ArrivalNotice = "inviteArrived" | "followed";

export interface ArrivalParty {
	/** The arriving player's Roblox Party mates who are in this server (never the player), in server join order. */
	readonly mates: ReadonlyArray<number>;
	/**
	 * The party's members in the order they accepted the party (`SocialService:GetPartyAsync`), or undefined when it
	 * failed (then: server join order, the arrival last). Ids missing from it rank after every listed one.
	 */
	readonly acceptOrder?: ReadonlyArray<number>;
}

export interface ArrivalInput {
	readonly userId: number;
	/** The lobby clock (kick cooldowns). */
	readonly now: number;
	/** The decoded LaunchData, if any (a hint: users can edit it). */
	readonly launch?: InviteLaunch;
	/** The player's live invites, oldest first (`Lobbies.invitesFor`). */
	readonly invites: ReadonlyArray<LobbyInvite>;
	/** `Lobbies.get`. */
	readonly lobbyById: (lobbyId: string) => Lobby | undefined;
	/** `Lobbies.lobbyOf`. */
	readonly lobbyOfUser: (userId: number) => Lobby | undefined;
	/** shared/lobby `canAccess` with the server's friend answers. */
	readonly canAccess: (lobby: Lobby, userId: number) => boolean;
	/** The lobby context's busyReason !== undefined (in an unconcluded run, the tutorial, ...). */
	readonly isBusy: (userId: number) => boolean;
	/** The player's Roblox Party, when they are in one. */
	readonly party?: ArrivalParty;
}

export type ArrivalAction =
	/** Join `lobbyId` with this live invite (`Lobbies.join`). */
	| { readonly kind: "joinInvite"; readonly inviteId: string; readonly lobbyId: string }
	/** Join `lobbyId` without an invite (`canAccess` lets them in). */
	| { readonly kind: "joinOpen"; readonly lobbyId: string }
	/** `Lobbies.partyInvite(fromUserId, arrival)` (fromUserId is a member of `lobbyId`), then join with it. */
	| { readonly kind: "partyJoin"; readonly lobbyId: string; readonly fromUserId: number }
	/**
	 * Create a lobby for `hostId` (visibility INVITE.partyLobbyVisibility), then for each joiner a party invite from
	 * the host and a join, then a party invite from the host to each invitee (they stay where they are).
	 */
	| {
			readonly kind: "makePartyLobby";
			readonly hostId: number;
			readonly joiners: ReadonlyArray<number>;
			readonly invitees: ReadonlyArray<number>;
	  }
	/** A lobby notice (shared/network LobbyNotice) to `toUserId` about the arrival (`userId` = the arrival). */
	| { readonly kind: "notify"; readonly toUserId: number; readonly notice: ArrivalNotice }
	| { readonly kind: "toast"; readonly toUserId: number; readonly key: ArrivalToastKey }
	| { readonly kind: "none" };

/** What the arrival's first-join flow should expect (shared/network `joinIntent`): no tutorial when grouped (ID6). */
export type ArrivalJoinIntent = "lobby" | "party" | "none";

function kickedFrom(lobby: Lobby, userId: number, now: number): boolean {
	const untilAt = lobby.kickedUntil.get(userId);
	return untilAt !== undefined && now < untilAt;
}

/** Why `lobby` cannot take `userId` now (a toast), or undefined when it can. `full`: the key for no room. */
function blockedKey(lobby: Lobby, userId: number, now: number, full: ArrivalToastKey): ArrivalToastKey | undefined {
	if (lobby.phase !== "forming") return ARRIVAL_TOAST.inRun;
	if (lobby.members.size() >= LOBBY.maxSize) return full;
	if (kickedFrom(lobby, userId, now)) return ARRIVAL_TOAST.kickCooldown;
	return undefined;
}

function canTake(lobby: Lobby, userId: number, now: number): boolean {
	return blockedKey(lobby, userId, now, ARRIVAL_TOAST.full) === undefined;
}

/** A join the arrival would get, or the toast that replaces it when they cannot be moved (busy / in a lobby). */
function joinOrToast(input: ArrivalInput, lobbyId: string, join: ArrivalAction): ArrivalAction[] {
	const own = input.lobbyOfUser(input.userId);
	if (own !== undefined) {
		return own.lobbyId === lobbyId ? [] : [toast(input.userId, ARRIVAL_TOAST.alreadyInLobby)];
	}
	if (input.isBusy(input.userId)) return [toast(input.userId, ARRIVAL_TOAST.busy)];
	return [join];
}

function toast(toUserId: number, key: ArrivalToastKey): ArrivalAction {
	return { kind: "toast", toUserId, key };
}

/** Party order: earliest accept first (unlisted after), else server join order (`joinIndex`). */
function partyRank(userId: number, joinIndex: number, acceptOrder: ReadonlyArray<number> | undefined): number {
	if (acceptOrder === undefined) return joinIndex;
	const i = acceptOrder.indexOf(userId);
	return i >= 0 ? i : acceptOrder.size() + joinIndex;
}

/** Rule 4 (see the file comment); undefined when it does not apply. */
function resolveParty(input: ArrivalInput, party: ArrivalParty): ArrivalAction[] | undefined {
	const me = input.userId;
	// Everyone in party order; the arrival joined last.
	const order: { userId: number; rank: number }[] = [];
	for (let i = 0; i < party.mates.size(); i++) {
		const id = party.mates[i];
		if (id !== me) order.push({ userId: id, rank: partyRank(id, i, party.acceptOrder) });
	}
	if (order.size() === 0) return undefined;
	order.push({ userId: me, rank: partyRank(me, party.mates.size(), party.acceptOrder) });
	order.sort((a, b) => (a.rank !== b.rank ? a.rank < b.rank : a.userId < b.userId));

	let blocked: ArrivalToastKey | undefined;
	for (const m of order) {
		if (m.userId === me) continue;
		const lobby = input.lobbyOfUser(m.userId);
		if (lobby === undefined) continue;
		const key = blockedKey(lobby, me, input.now, ARRIVAL_TOAST.partyFull);
		if (key === undefined) return [{ kind: "partyJoin", lobbyId: lobby.lobbyId, fromUserId: m.userId }];
		if (blocked === undefined || key === ARRIVAL_TOAST.partyFull) blocked = key;
	}
	if (blocked !== undefined) return [toast(me, blocked)];

	const free: number[] = [];
	const busy: number[] = [];
	for (const m of order) {
		if (m.userId === me || !input.isBusy(m.userId)) free.push(m.userId);
		else busy.push(m.userId);
	}
	const joiners: number[] = [];
	const left: number[] = [];
	for (let i = 1; i < free.size(); i++) {
		if (i < LOBBY.maxSize) joiners.push(free[i]);
		else left.push(free[i]);
	}
	const room = free.size() < LOBBY.maxSize;
	const invitees: number[] = [];
	for (const id of busy) {
		if (room) invitees.push(id);
		else left.push(id);
	}
	const out: ArrivalAction[] = [{ kind: "makePartyLobby", hostId: free[0], joiners, invitees }];
	for (const id of left) out.push(toast(id, ARRIVAL_TOAST.partyFull));
	return out;
}

/** The actions for one arrival, in order (see the file comment). Never empty: `[{ kind: "none" }]` at worst. */
export function resolveArrival(input: ArrivalInput): ReadonlyArray<ArrivalAction> {
	const me = input.userId;
	const launch = input.launch;
	const launchLobbyId = launch !== undefined && launch.kind === "lobby" ? launch.lobbyId : undefined;
	const launchLobby = launchLobbyId !== undefined ? input.lobbyById(launchLobbyId) : undefined;
	const sender = launch !== undefined && launch.fromUserId !== me ? launch.fromUserId : undefined;
	const settled = input.lobbyOfUser(me) !== undefined || input.isBusy(me);

	// 1: a live invite to a lobby that can take them (the LaunchData lobby's first).
	let chosen: LobbyInvite | undefined;
	for (const inv of input.invites) {
		const lobby = input.lobbyById(inv.lobbyId);
		if (lobby === undefined || !canTake(lobby, me, input.now)) continue;
		if (inv.lobbyId === launchLobbyId) {
			chosen = inv;
			break;
		}
		if (chosen === undefined) chosen = inv;
	}
	if (chosen !== undefined) {
		const join: ArrivalAction = { kind: "joinInvite", inviteId: chosen.inviteId, lobbyId: chosen.lobbyId };
		return orNone(joinOrToast(input, chosen.lobbyId, join));
	}

	// 2 and 3: the LaunchData lobby can take them.
	if (launchLobby !== undefined && canTake(launchLobby, me, input.now)) {
		if (input.canAccess(launchLobby, me)) {
			return orNone(joinOrToast(input, launchLobby.lobbyId, { kind: "joinOpen", lobbyId: launchLobby.lobbyId }));
		}
		if (sender !== undefined && launchLobby.members.includes(sender)) {
			return [{ kind: "notify", toUserId: sender, notice: "followed" }];
		}
	}

	// 4: Roblox Party.
	if (!settled && input.party !== undefined) {
		const party = resolveParty(input, input.party);
		if (party !== undefined) return party;
	}

	// 5: a menu invite.
	if (launch !== undefined && launch.kind === "game" && sender !== undefined) {
		return [{ kind: "notify", toUserId: sender, notice: "inviteArrived" }];
	}

	// 6: the lobby they were invited to cannot take them.
	if (launchLobbyId !== undefined) {
		if (launchLobby === undefined) return [toast(me, ARRIVAL_TOAST.gone)];
		const key = blockedKey(launchLobby, me, input.now, ARRIVAL_TOAST.full);
		if (key !== undefined && input.lobbyOfUser(me) !== launchLobby) return [toast(me, key)];
	} else {
		for (const inv of input.invites) {
			const lobby = input.lobbyById(inv.lobbyId);
			if (lobby === undefined) continue;
			const key = blockedKey(lobby, me, input.now, ARRIVAL_TOAST.full);
			if (key !== undefined) return [toast(me, key)];
		}
	}
	return [{ kind: "none" }];
}

function orNone(actions: ArrivalAction[]): ReadonlyArray<ArrivalAction> {
	return actions.size() > 0 ? actions : [{ kind: "none" }];
}

/**
 * The `joinIntent` for the arrival's client: "lobby" when an action moves them into a lobby by invite or LaunchData,
 * "party" when party grouping does (they host or join), else "none" (the normal first-join flow).
 */
export function arrivalJoinIntent(userId: number, actions: ReadonlyArray<ArrivalAction>): ArrivalJoinIntent {
	for (const a of actions) {
		if (a.kind === "joinInvite" || a.kind === "joinOpen") return "lobby";
		if (a.kind === "partyJoin") return "party";
		if (a.kind === "makePartyLobby" && (a.hostId === userId || a.joiners.includes(userId))) return "party";
	}
	return "none";
}
