// InviteService's pure decisions (docs/INVITES.md I4, I6, I7): recipient lists, Studio's fake recipients, party
// accept order, refusal toasts, the InviteArrival outcome and mid-session party offers (against a real Lobbies).
import { describe, expect, it } from "@rbxts/jest-globals";
import { LOBBY, Lobbies, MAX_USER_ID_MAGNITUDE, type Lobby, type LobbyContext } from "shared/lobby";
import {
	ARRIVAL_TOAST,
	INVITE,
	arrivalPlacements,
	arrivalToastForRefusal,
	inviteArrivalOutcome,
	inviteRecipientList,
	joinIntentNow,
	parseFakeRecipients,
	partyAcceptOrder,
	partyOffers,
	shouldUpgradeJoinIntent,
	type ArrivalAction,
} from "shared/invite";

const HOST = 11;
const A = 22;
const B = 33;
const C = 44;
const ME = 77;
const MAX = 3;

function lobbies(): Lobbies {
	let ids = 0;
	return new Lobbies({ newId: () => `id-${++ids}` });
}

function ctx(now = 0): LobbyContext {
	return { now, busyReason: () => undefined, areFriends: () => false };
}

function create(l: Lobbies, host: number): Lobby {
	const r = l.create(host, { visibility: "closed" }, ctx());
	if (!r.ok) error(r.reason);
	return r.lobby;
}

function join(l: Lobbies, user: number, lobby: Lobby): void {
	const inv = l.partyInvite(lobby.hostId, user, ctx());
	if (!inv.ok && inv.code !== "alreadyInvited") error(inv.reason);
	const r = l.join(user, lobby.lobbyId, ctx());
	if (!r.ok) error(r.reason);
}

function facts(l: Lobbies, busy: ReadonlyArray<number> = [], now = 0) {
	return { now, lobbyOfUser: (id: number) => l.lobbyOf(id), isBusy: (id: number) => busy.includes(id) };
}

describe("inviteRecipientList", () => {
	it("takes a plain list of integers, repeats removed, negative (Studio) ids included", () => {
		expect(inviteRecipientList([5, 6, 5], MAX)).toEqual([5, 6]);
		expect(inviteRecipientList([-2], MAX)).toEqual([-2]);
		expect(inviteRecipientList([], MAX)).toEqual([]);
	});

	it("refuses anything else", () => {
		expect(inviteRecipientList(undefined, MAX)).toBe(undefined);
		expect(inviteRecipientList("5", MAX)).toBe(undefined);
		expect(inviteRecipientList([1, 2, 3, 4], MAX)).toBe(undefined); // over the cap
		expect(inviteRecipientList([1.5], MAX)).toBe(undefined);
		expect(inviteRecipientList(["1"], MAX)).toBe(undefined);
		expect(inviteRecipientList([0 / 0], MAX)).toBe(undefined);
		expect(inviteRecipientList(new Map<string, number>([["a", 1]]), MAX)).toBe(undefined);
	});

	it("bounds the ids: nonzero, |id| at most MAX_USER_ID_MAGNITUDE", () => {
		expect(inviteRecipientList([MAX_USER_ID_MAGNITUDE, -MAX_USER_ID_MAGNITUDE], MAX)).toEqual([
			MAX_USER_ID_MAGNITUDE,
			-MAX_USER_ID_MAGNITUDE,
		]);
		expect(inviteRecipientList([1e300], MAX)).toBe(undefined);
		expect(inviteRecipientList([-1e300], MAX)).toBe(undefined);
		expect(inviteRecipientList([MAX_USER_ID_MAGNITUDE + 2], MAX)).toBe(undefined);
		expect(inviteRecipientList([0], MAX)).toBe(undefined);
		expect(inviteRecipientList([1 / 0], MAX)).toBe(undefined);
		expect(parseFakeRecipients("0")).toBe(undefined);
		expect(partyAcceptOrder([{ UserId: 1e300 }])).toBe(undefined);
	});
});

describe("parseFakeRecipients", () => {
	it("reads ids joined by the separator, spaces and negative ids allowed", () => {
		expect(parseFakeRecipients("-2,-3")).toEqual([-2, -3]);
		expect(parseFakeRecipients(" 5 , 6,5")).toEqual([5, 6]);
	});

	it("refuses empty, malformed and non-string values", () => {
		expect(parseFakeRecipients("")).toBe(undefined);
		expect(parseFakeRecipients("1,x")).toBe(undefined);
		expect(parseFakeRecipients("1,,2")).toBe(undefined);
		expect(parseFakeRecipients("1.5")).toBe(undefined);
		expect(parseFakeRecipients(5)).toBe(undefined);
		expect(parseFakeRecipients(undefined)).toBe(undefined);
	});
});

describe("partyAcceptOrder", () => {
	it("keeps GetPartyAsync's order", () => {
		const entries = [
			{ UserId: B, PlaceId: 1, JobId: "j" },
			{ UserId: A, PlaceId: 1, JobId: "k" },
			{ UserId: B, PlaceId: 1, JobId: "j" },
		];
		expect(partyAcceptOrder(entries)).toEqual([B, A]);
		expect(partyAcceptOrder([])).toEqual([]);
	});

	it("undefined when an entry has no integer UserId (the caller falls back to join order)", () => {
		expect(partyAcceptOrder(undefined)).toBe(undefined);
		expect(partyAcceptOrder([{ UserId: A }, { PlaceId: 1 }])).toBe(undefined);
		expect(partyAcceptOrder([{ UserId: "22" }])).toBe(undefined);
		expect(partyAcceptOrder([5])).toBe(undefined);
	});
});

describe("arrivalToastForRefusal", () => {
	it("maps each refusal to its arrival toast", () => {
		expect(arrivalToastForRefusal("full")).toBe(ARRIVAL_TOAST.full);
		expect(arrivalToastForRefusal("full", ARRIVAL_TOAST.partyFull)).toBe(ARRIVAL_TOAST.partyFull);
		expect(arrivalToastForRefusal("inRun")).toBe(ARRIVAL_TOAST.inRun);
		expect(arrivalToastForRefusal("starting")).toBe(ARRIVAL_TOAST.inRun);
		expect(arrivalToastForRefusal("kickCooldown")).toBe(ARRIVAL_TOAST.kickCooldown);
		expect(arrivalToastForRefusal("busy")).toBe(ARRIVAL_TOAST.busy);
		expect(arrivalToastForRefusal("alreadyInLobby")).toBe(ARRIVAL_TOAST.alreadyInLobby);
		expect(arrivalToastForRefusal("unknownLobby")).toBe(ARRIVAL_TOAST.gone);
		expect(arrivalToastForRefusal("noAccess")).toBe(ARRIVAL_TOAST.gone);
	});
});

describe("inviteArrivalOutcome", () => {
	const join: ArrivalAction = { kind: "joinInvite", inviteId: "i", lobbyId: "l" };
	const open: ArrivalAction = { kind: "joinOpen", lobbyId: "l" };

	it("joins, notices and toasts", () => {
		expect(inviteArrivalOutcome(ME, [join])).toBe("joinedInvite");
		expect(inviteArrivalOutcome(ME, [open])).toBe("joinedOpen");
		expect(inviteArrivalOutcome(ME, [{ kind: "notify", toUserId: HOST, notice: "followed" }])).toBe(
			"followedClosed",
		);
		expect(inviteArrivalOutcome(ME, [{ kind: "notify", toUserId: HOST, notice: "inviteArrived" }])).toBe("arrived");
		const toast = (key: (typeof ARRIVAL_TOAST)[keyof typeof ARRIVAL_TOAST]): ArrivalAction[] => [
			{ kind: "toast", toUserId: ME, key },
		];
		expect(inviteArrivalOutcome(ME, toast(ARRIVAL_TOAST.full))).toBe("full");
		expect(inviteArrivalOutcome(ME, toast(ARRIVAL_TOAST.gone))).toBe("gone");
		expect(inviteArrivalOutcome(ME, toast(ARRIVAL_TOAST.inRun))).toBe("inRun");
		expect(inviteArrivalOutcome(ME, toast(ARRIVAL_TOAST.kickCooldown))).toBe("kickCooldown");
		expect(inviteArrivalOutcome(ME, toast(ARRIVAL_TOAST.busy))).toBe("busy");
		expect(inviteArrivalOutcome(ME, toast(ARRIVAL_TOAST.alreadyInLobby))).toBe("busy");
	});

	it("a join refused after all reads as its refusal", () => {
		expect(inviteArrivalOutcome(ME, [join], "full")).toBe("full");
		expect(inviteArrivalOutcome(ME, [open], "unknownLobby")).toBe("gone");
		expect(inviteArrivalOutcome(ME, [join], "starting")).toBe("inRun");
	});

	it("undefined for party grouping, none, and other players' toasts", () => {
		expect(inviteArrivalOutcome(ME, [{ kind: "none" }])).toBe(undefined);
		expect(inviteArrivalOutcome(ME, [{ kind: "partyJoin", lobbyId: "l", fromUserId: A }], "full")).toBe(undefined);
		expect(
			inviteArrivalOutcome(ME, [
				{ kind: "makePartyLobby", hostId: A, joiners: [ME], invitees: [] },
				{ kind: "toast", toUserId: B, key: ARRIVAL_TOAST.partyFull },
			]),
		).toBe(undefined);
		expect(inviteArrivalOutcome(ME, [{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.partyFull }])).toBe(
			undefined,
		);
	});
});

describe("partyOffers", () => {
	it("a free player gets one offer from the first mate (join order) whose lobby has room", () => {
		const l = lobbies();
		const full = create(l, A);
		for (let id = 1; full.members.size() < LOBBY.maxSize; id++) join(l, 500 + id, full);
		const room = create(l, B);
		create(l, C);
		expect(partyOffers(ME, [A, B, C], facts(l))).toEqual([{ fromUserId: B, toUserId: ME, lobbyId: room.lobbyId }]);
	});

	it("nothing for a busy player, or when no mate's lobby can take them (in a run, kick cooldown)", () => {
		const l = lobbies();
		const lobby = create(l, A);
		expect(partyOffers(ME, [A], facts(l, [ME]))).toEqual([]);
		join(l, ME, lobby);
		expect(l.kick(A, ME, ctx(0)).ok).toBe(true);
		expect(partyOffers(ME, [A], facts(l, [], 1))).toEqual([]);
		expect(partyOffers(ME, [A], facts(l, [], LOBBY.kickCooldownSeconds)).size()).toBe(1);
		const other = lobbies();
		const running = create(other, A);
		other.setReady(A, true);
		other.start(A, ctx(0));
		other.tick(ctx(LOBBY.countdownSeconds));
		expect(running.phase).toBe("inRun");
		expect(partyOffers(ME, [A], facts(other))).toEqual([]);
	});

	it("a player in a forming lobby offers it to each free mate while it has room", () => {
		const l = lobbies();
		const lobby = create(l, ME);
		create(l, B); // B is in a lobby: skipped
		for (let id = 1; lobby.members.size() < LOBBY.maxSize - 1; id++) join(l, 500 + id, lobby);
		expect(partyOffers(ME, [A, B, C], facts(l))).toEqual([{ fromUserId: ME, toUserId: A, lobbyId: lobby.lobbyId }]);
		expect(partyOffers(ME, [A, B, C], facts(l, [A]))).toEqual([
			{ fromUserId: ME, toUserId: C, lobbyId: lobby.lobbyId },
		]);
	});

	it("nothing from a lobby that is starting", () => {
		const l = lobbies();
		create(l, ME);
		l.setReady(ME, true);
		l.start(ME, ctx(0));
		expect(partyOffers(ME, [A], facts(l))).toEqual([]);
	});
});

describe("arrivalPlacements / joinIntentNow / shouldUpgradeJoinIntent", () => {
	it("who an arrival moves into a lobby, and how", () => {
		const placed = (actions: ArrivalAction[]) => {
			const out: [number, string][] = [];
			for (const [id, how] of arrivalPlacements(ME, actions)) out.push([id, how]);
			out.sort((a, b) => a[0] < b[0]);
			return out;
		};
		expect(placed([{ kind: "joinInvite", inviteId: "i", lobbyId: "l" }])).toEqual([[ME, "lobby"]]);
		expect(placed([{ kind: "joinOpen", lobbyId: "l" }])).toEqual([[ME, "lobby"]]);
		expect(placed([{ kind: "partyJoin", lobbyId: "l", fromUserId: A }])).toEqual([[ME, "party"]]);
		expect(placed([{ kind: "makePartyLobby", hostId: A, joiners: [B, ME], invitees: [C] }])).toEqual([
			[A, "party"],
			[B, "party"],
			[ME, "party"],
		]);
		expect(placed([{ kind: "notify", toUserId: HOST, notice: "followed" }, { kind: "none" }])).toEqual([]);
	});

	it("the intent follows the state after applying", () => {
		expect(joinIntentNow(false, "party")).toBe("none"); // the join was refused after all
		expect(joinIntentNow(true, "party")).toBe("party");
		expect(joinIntentNow(true, "lobby")).toBe("lobby");
		expect(joinIntentNow(true, undefined)).toBe("lobby");
	});

	it("upgrades none -> lobby / party within the window only, never downgrades or repeats", () => {
		const window = INVITE.launchDataWaitSeconds + INVITE.intentUpgradeMarginSeconds;
		expect(shouldUpgradeJoinIntent("none", "party", 1)).toBe(true);
		expect(shouldUpgradeJoinIntent("none", "lobby", window)).toBe(true);
		expect(shouldUpgradeJoinIntent("none", "lobby", window + 1)).toBe(false);
		expect(shouldUpgradeJoinIntent("none", "none", 1)).toBe(false);
		expect(shouldUpgradeJoinIntent("lobby", "party", 1)).toBe(false);
		expect(shouldUpgradeJoinIntent("party", "none", 1)).toBe(false);
		expect(shouldUpgradeJoinIntent(undefined, "party", 1)).toBe(false); // the first one is still to come
	});
});
