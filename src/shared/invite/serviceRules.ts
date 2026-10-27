/**
 * The pure decisions server/services/InviteService.ts (docs/INVITES.md I4, I6, I7) and LobbyService's invite methods
 * make around `resolveArrival`, so they are specced headlessly:
 *
 *   inviteRecipientList    a reported recipient list (GameInvitePromptClosed or the client's `inviteRecipients`)
 *   parseFakeRecipients    Studio's KV_FakeInviteRecipients text
 *   partyAcceptOrder       `SocialService:GetPartyAsync` entries -> UserIds in accept order
 *   arrivalToastForRefusal an arrival's join Lobbies refused after all -> the arrival toast
 *   inviteArrivalOutcome   the InviteArrival analytics outcome of an arrival's actions
 *   partyOffers            mid-session party grouping (ID4: an offer, a party invite, never a move)
 *
 * Roblox-API-free.
 */
import { LOBBY, type InviteArrivalOutcome, type Lobby, type LobbyInvite, type LobbyRefusal } from "shared/lobby";
import { isFiniteValue } from "shared/run";
import { ARRIVAL_TOAST, type ArrivalAction, type ArrivalInput, type ArrivalToastKey } from "./arrival";
import { INVITE_STUDIO_ATTRIBUTES } from "./config";

/** What LobbyService gives InviteService to build an ArrivalInput (the lobby half of it, read now). */
export interface ArrivalLobbyFacts {
	readonly now: number;
	/** `Lobbies.invitesFor(userId, now)`. */
	readonly invitesFor: (userId: number) => ReadonlyArray<LobbyInvite>;
	readonly lobbyById: ArrivalInput["lobbyById"];
	readonly lobbyOfUser: ArrivalInput["lobbyOfUser"];
	readonly canAccess: ArrivalInput["canAccess"];
	readonly isBusy: ArrivalInput["isBusy"];
}

/** `LobbyService.applyArrival`'s answer. */
export interface ArrivalApplyResult {
	/** The lobby the arrival is in afterwards (undefined: not placed). */
	readonly lobbyId?: string;
	/**
	 * A join (or the party lobby's create) for the arrival that Lobbies refused after all; the arrival got the toast
	 * for it. Only a race could cause it: the facts are read and applied without yielding.
	 */
	readonly refusal?: LobbyRefusal;
}

function isUserId(v: unknown): v is number {
	return isFiniteValue(v) && v % 1 === 0;
}

/**
 * A reported list of invited UserIds: a plain array (no other keys) of at most `max` integers, repeats removed
 * (first kept); undefined when malformed. The same rule as `Lobbies.platformInvites`, checked before it because a
 * menu prompt (no lobby) never reaches Lobbies.
 */
export function inviteRecipientList(v: unknown, max: number): number[] | undefined {
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

/**
 * Studio's KV_FakeInviteRecipients: UserIds joined by INVITE_STUDIO_ATTRIBUTES.fakeRecipientsSeparator, spaces
 * allowed, negative ids allowed (Studio test players); undefined for anything else (an empty string included).
 */
export function parseFakeRecipients(text: unknown): number[] | undefined {
	if (!typeIs(text, "string")) return undefined;
	const out: number[] = [];
	for (const part of text.split(INVITE_STUDIO_ATTRIBUTES.fakeRecipientsSeparator)) {
		const trimmed = string.match(part, "^%s*(-?%d+)%s*$")[0];
		if (trimmed === undefined) return undefined;
		const id = tonumber(trimmed);
		if (id === undefined || !isUserId(id)) return undefined;
		if (!out.includes(id)) out.push(id);
	}
	return out.size() > 0 ? out : undefined;
}

/**
 * `SocialService:GetPartyAsync` entries (members in the order they accepted the party) -> their UserIds in that
 * order, repeats removed; undefined when it is not a list or an entry has no integer `UserId` (then the arrival
 * falls back to server join order).
 */
export function partyAcceptOrder(entries: unknown): number[] | undefined {
	if (!typeIs(entries, "table")) return undefined;
	const arr = entries as unknown[];
	const out: number[] = [];
	for (let i = 0; i < arr.size(); i++) {
		const entry = arr[i];
		if (!typeIs(entry, "table")) return undefined;
		const id = (entry as { UserId?: unknown }).UserId;
		if (!isUserId(id)) return undefined;
		if (!out.includes(id)) out.push(id);
	}
	return out;
}

/**
 * The toast for an arrival's join that Lobbies refused (the lobby changed between the resolve and the join). `full`:
 * the key for no room (`lobby.err.partyFull` for a party join).
 */
export function arrivalToastForRefusal(
	code: LobbyRefusal,
	full: ArrivalToastKey = ARRIVAL_TOAST.full,
): ArrivalToastKey {
	if (code === "full") return full;
	if (code === "inRun" || code === "starting") return ARRIVAL_TOAST.inRun;
	if (code === "kickCooldown") return ARRIVAL_TOAST.kickCooldown;
	if (code === "busy") return ARRIVAL_TOAST.busy;
	if (code === "alreadyInLobby") return ARRIVAL_TOAST.alreadyInLobby;
	return ARRIVAL_TOAST.gone; // unknownLobby, noAccess, ...: the lobby they were sent to is not theirs to join
}

function outcomeForRefusal(code: LobbyRefusal): InviteArrivalOutcome {
	if (code === "full") return "full";
	if (code === "inRun" || code === "starting") return "inRun";
	if (code === "kickCooldown") return "kickCooldown";
	if (code === "busy" || code === "alreadyInLobby") return "busy";
	return "gone";
}

function outcomeForToast(key: ArrivalToastKey): InviteArrivalOutcome | undefined {
	if (key === ARRIVAL_TOAST.full) return "full";
	if (key === ARRIVAL_TOAST.gone) return "gone";
	if (key === ARRIVAL_TOAST.inRun) return "inRun";
	if (key === ARRIVAL_TOAST.kickCooldown) return "kickCooldown";
	if (key === ARRIVAL_TOAST.busy || key === ARRIVAL_TOAST.alreadyInLobby) return "busy";
	return undefined; // partyFull: a party outcome, not an invite one
}

/**
 * The InviteArrival outcome (shared/lobby analytics.ts) of an arrival's actions for `userId`, or undefined when no
 * action is about an invite (party grouping, none). `refusal`: LobbyService.applyArrival's, when the invite join was
 * refused after all.
 */
export function inviteArrivalOutcome(
	userId: number,
	actions: ReadonlyArray<ArrivalAction>,
	refusal?: LobbyRefusal,
): InviteArrivalOutcome | undefined {
	for (const a of actions) {
		if (a.kind === "joinInvite" || a.kind === "joinOpen") {
			if (refusal !== undefined) return outcomeForRefusal(refusal);
			return a.kind === "joinInvite" ? "joinedInvite" : "joinedOpen";
		}
		if (a.kind === "notify") return a.notice === "followed" ? "followedClosed" : "arrived";
		if (a.kind === "toast" && a.toUserId === userId) {
			const outcome = outcomeForToast(a.key);
			if (outcome !== undefined) return outcome;
		}
	}
	return undefined;
}

/** One mid-session party offer: a party invite from `fromUserId` (a member of `lobbyId`) to `toUserId`. */
export interface PartyOffer {
	readonly fromUserId: number;
	readonly toUserId: number;
	readonly lobbyId: string;
}

/** Forming, with room, and `userId` is not on its kick cooldown. */
function canOffer(lobby: Lobby, userId: number, now: number): boolean {
	if (lobby.phase !== "forming" || lobby.members.size() >= LOBBY.maxSize) return false;
	const untilAt = lobby.kickedUntil.get(userId);
	return untilAt === undefined || now >= untilAt;
}

/**
 * Mid-session Roblox Party grouping for `userId` (their PartyId changed, or a mate joined their party, while both are
 * here; ID4: no automatic move). `mates`: their party mates in this server, in server join order.
 *
 *   free (not busy, not in a lobby): one offer from the first mate whose lobby is forming with room for them
 *   in a forming lobby with room: one offer from them to each free mate, as long as the lobby has room
 *   otherwise (busy, or a lobby that is full / starting / in a run): none
 *
 * Lobbies still applies its own invite rules (already invited, ...) when the service makes each one.
 */
export function partyOffers(
	userId: number,
	mates: ReadonlyArray<number>,
	facts: Pick<ArrivalLobbyFacts, "now" | "lobbyOfUser" | "isBusy">,
): PartyOffer[] {
	const out: PartyOffer[] = [];
	const own = facts.lobbyOfUser(userId);
	if (own === undefined) {
		if (facts.isBusy(userId)) return out;
		for (const mate of mates) {
			if (mate === userId) continue;
			const lobby = facts.lobbyOfUser(mate);
			if (lobby !== undefined && canOffer(lobby, userId, facts.now)) {
				out.push({ fromUserId: mate, toUserId: userId, lobbyId: lobby.lobbyId });
				return out;
			}
		}
		return out;
	}
	if (own.phase !== "forming") return out;
	let room = LOBBY.maxSize - own.members.size();
	for (const mate of mates) {
		if (room <= 0) break;
		if (mate === userId || facts.lobbyOfUser(mate) !== undefined || facts.isBusy(mate)) continue;
		if (!canOffer(own, mate, facts.now)) continue;
		out.push({ fromUserId: userId, toUserId: mate, lobbyId: own.lobbyId });
		room -= 1;
	}
	return out;
}
