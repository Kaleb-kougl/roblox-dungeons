// The arrival resolver against a real Lobbies: one spec per priority row (docs/INVITES.md §3), busy arrivals, a
// forged LaunchData lobby id, and the Roblox Party rules (mate's lobby, create, mate in a run, full).
import { describe, expect, it } from "@rbxts/jest-globals";
import { LOBBY, Lobbies, canAccess, type AreFriends, type Lobby, type LobbyContext } from "shared/lobby";
import {
	ARRIVAL_TOAST,
	arrivalJoinIntent,
	resolveArrival,
	type ArrivalAction,
	type ArrivalInput,
	type ArrivalParty,
	type InviteLaunch,
} from "shared/invite";

const HOST = 11;
const A = 22;
const B = 33;
const C = 44;
/** The arriving player. */
const ME = 77;

const NONE: ArrivalAction[] = [{ kind: "none" }];

function lobbies(): Lobbies {
	let ids = 0;
	return new Lobbies({ newId: () => `id-${++ids}` });
}

function ctx(now = 0): LobbyContext {
	return { now, busyReason: () => undefined, areFriends: () => false };
}

function create(l: Lobbies, host: number, visibility: Lobby["visibility"] = "open"): Lobby {
	const r = l.create(host, { visibility }, ctx());
	if (!r.ok) error(r.reason);
	return r.lobby;
}

function join(l: Lobbies, user: number, lobby: Lobby): void {
	const inv = l.partyInvite(lobby.hostId, user, ctx());
	if (!inv.ok && inv.code !== "alreadyInvited") error(inv.reason);
	const r = l.join(user, lobby.lobbyId, ctx());
	if (!r.ok) error(r.reason);
}

function fill(l: Lobbies, lobby: Lobby): void {
	for (let id = 1; lobby.members.size() < LOBBY.maxSize; id++) join(l, 500 + id, lobby);
}

function startRun(l: Lobbies, lobby: Lobby): void {
	for (const id of lobby.members) l.setReady(id, true);
	l.start(lobby.hostId, ctx(0));
	l.tick(ctx(LOBBY.countdownSeconds));
	if (lobby.phase !== "inRun") error("run did not start");
}

interface Opts {
	readonly launch?: InviteLaunch;
	readonly busy?: ReadonlyArray<number>;
	readonly friends?: AreFriends;
	readonly party?: ArrivalParty;
	readonly now?: number;
	readonly userId?: number;
}

function input(l: Lobbies, opts: Opts = {}): ArrivalInput {
	const now = opts.now ?? 0;
	const busy = opts.busy ?? [];
	const friends = opts.friends ?? (() => false);
	const userId = opts.userId ?? ME;
	return {
		userId,
		now,
		launch: opts.launch,
		invites: l.invitesFor(userId, now),
		lobbyById: (id) => l.get(id),
		lobbyOfUser: (id) => l.lobbyOf(id),
		canAccess: (lobby, id) => canAccess(lobby, id, friends),
		isBusy: (id) => busy.includes(id),
		party: opts.party,
	};
}

function lobbyLaunch(lobby: Lobby, from: number): InviteLaunch {
	return { kind: "lobby", lobbyId: lobby.lobbyId, fromUserId: from };
}

function resolve(l: Lobbies, opts: Opts = {}): ReadonlyArray<ArrivalAction> {
	return resolveArrival(input(l, opts));
}

describe("arrival: 1, a live invite", () => {
	it("joins the LaunchData lobby through its platform invite, Closed included", () => {
		const l = lobbies();
		const lobby = create(l, HOST, "closed");
		const r = l.platformInvites(HOST, [ME], ctx());
		if (!r.ok) error(r.reason);
		expect(resolve(l, { launch: lobbyLaunch(lobby, HOST) })).toEqual([
			{ kind: "joinInvite", inviteId: r.invites[0].inviteId, lobbyId: lobby.lobbyId },
		]);
		// Before the LaunchData arrives (PlayerAdded): the same invite.
		expect(resolve(l)).toEqual([{ kind: "joinInvite", inviteId: r.invites[0].inviteId, lobbyId: lobby.lobbyId }]);
	});

	it("the LaunchData lobby's invite first, else the oldest; lobbies that cannot take them are skipped", () => {
		const l = lobbies();
		const one = create(l, HOST, "closed");
		const two = create(l, A, "closed");
		const three = create(l, B, "closed");
		l.platformInvites(HOST, [ME], ctx());
		l.platformInvites(A, [ME], ctx());
		l.platformInvites(B, [ME], ctx());
		const [i1, i2, i3] = l.invitesFor(ME, 0);
		const joinOf = (inv: typeof i1): ArrivalAction[] => [
			{ kind: "joinInvite", inviteId: inv.inviteId, lobbyId: inv.lobbyId },
		];
		expect(resolve(l, { launch: lobbyLaunch(two, A) })).toEqual(joinOf(i2));
		expect(resolve(l)).toEqual(joinOf(i1));
		fill(l, one);
		expect(resolve(l)).toEqual(joinOf(i2)); // the oldest is full
		expect(resolve(l, { launch: lobbyLaunch(one, HOST) })).toEqual(joinOf(i2)); // named lobby full: another invite
		startRun(l, two);
		expect(resolve(l)).toEqual(joinOf(i3));
		expect(three.members).toEqual([B]);
	});

	it("an invite beats an Open LaunchData lobby without one (first match wins)", () => {
		const l = lobbies();
		const open = create(l, HOST, "open");
		const closed = create(l, A, "closed");
		l.platformInvites(A, [ME], ctx());
		const [inv] = l.invitesFor(ME, 0);
		expect(resolve(l, { launch: lobbyLaunch(open, HOST) })).toEqual([
			{ kind: "joinInvite", inviteId: inv.inviteId, lobbyId: closed.lobbyId },
		]);
	});
});

describe("arrival: 2, the LaunchData lobby lets them in", () => {
	it("Open: joins like the browser would", () => {
		const l = lobbies();
		const open = create(l, HOST, "open");
		expect(resolve(l, { launch: lobbyLaunch(open, HOST) })).toEqual([{ kind: "joinOpen", lobbyId: open.lobbyId }]);
	});

	it("Friends: only the host's friend joins; anyone else is a `followed` notice", () => {
		const l = lobbies();
		const friends = create(l, HOST, "friends");
		const hostFriendsMe: AreFriends = (x, y) => (x === HOST && y === ME) || (x === ME && y === HOST);
		expect(resolve(l, { launch: lobbyLaunch(friends, HOST), friends: hostFriendsMe })).toEqual([
			{ kind: "joinOpen", lobbyId: friends.lobbyId },
		]);
		expect(resolve(l, { launch: lobbyLaunch(friends, HOST) })).toEqual([
			{ kind: "notify", toUserId: HOST, notice: "followed" },
		]);
	});
});

describe("arrival: 3, Closed without an invite", () => {
	it("only the `followed` notice to the sender (a member); the arrival stays on the menu", () => {
		const l = lobbies();
		const closed = create(l, HOST, "closed");
		join(l, A, closed);
		expect(resolve(l, { launch: lobbyLaunch(closed, A) })).toEqual([
			{ kind: "notify", toUserId: A, notice: "followed" },
		]);
	});
});

describe("arrival: a forged LaunchData lobby id", () => {
	it("Open lobby: joins exactly as the browser would; Closed without an invite: `followed` only", () => {
		const l = lobbies();
		const open = create(l, HOST, "open");
		const closed = create(l, A, "closed");
		// Nobody invited ME; the strings were typed by hand.
		expect(resolve(l, { launch: { kind: "lobby", lobbyId: open.lobbyId, fromUserId: HOST } })).toEqual([
			{ kind: "joinOpen", lobbyId: open.lobbyId },
		]);
		expect(resolve(l, { launch: { kind: "lobby", lobbyId: closed.lobbyId, fromUserId: A } })).toEqual([
			{ kind: "notify", toUserId: A, notice: "followed" },
		]);
	});

	it("a forged sender who is not a member, or the arrival themself, is notified of nothing", () => {
		const l = lobbies();
		const closed = create(l, A, "closed");
		create(l, HOST);
		expect(resolve(l, { launch: lobbyLaunch(closed, HOST) })).toEqual(NONE);
		expect(resolve(l, { launch: lobbyLaunch(closed, ME) })).toEqual(NONE);
		expect(resolve(l, { launch: { kind: "game", fromUserId: ME } })).toEqual(NONE);
	});

	it("an unknown lobby id is the `gone` toast", () => {
		const l = lobbies();
		expect(resolve(l, { launch: { kind: "lobby", lobbyId: "no-such-lobby", fromUserId: HOST } })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.gone },
		]);
	});
});

describe("arrival: 4, Roblox Party", () => {
	it("a mate's forming lobby with room: partyJoin through that mate (Closed works)", () => {
		const l = lobbies();
		const lobby = create(l, HOST, "closed");
		join(l, A, lobby);
		expect(resolve(l, { party: { mates: [A, B] } })).toEqual([
			{ kind: "partyJoin", lobbyId: lobby.lobbyId, fromUserId: A },
		]);
		expect(arrivalJoinIntent(ME, resolve(l, { party: { mates: [A] } }))).toBe("party");
	});

	it("mates in two lobbies: the earliest-accepted mate's lobby", () => {
		const l = lobbies();
		const one = create(l, A, "closed");
		const two = create(l, B, "closed");
		expect(resolve(l, { party: { mates: [A, B], acceptOrder: [B, ME, A] } })).toEqual([
			{ kind: "partyJoin", lobbyId: two.lobbyId, fromUserId: B },
		]);
		expect(resolve(l, { party: { mates: [A, B] } })).toEqual([
			{ kind: "partyJoin", lobbyId: one.lobbyId, fromUserId: A },
		]);
		// A full one is skipped for one with room.
		fill(l, two);
		expect(resolve(l, { party: { mates: [A, B], acceptOrder: [B, A, ME] } })).toEqual([
			{ kind: "partyJoin", lobbyId: one.lobbyId, fromUserId: A },
		]);
	});

	it("the party's lobby is full: the arrival lands on the menu with partyFull; nothing else", () => {
		const l = lobbies();
		const lobby = create(l, A, "closed");
		fill(l, lobby);
		expect(resolve(l, { party: { mates: [A, B] } })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.partyFull },
		]);
	});

	it("the party's lobby is in a run or starting: the inRun toast, no second lobby", () => {
		const l = lobbies();
		const lobby = create(l, A, "closed");
		startRun(l, lobby);
		expect(resolve(l, { party: { mates: [A, B] } })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.inRun },
		]);
		const l2 = lobbies();
		const starting = create(l2, A);
		l2.setReady(A, true);
		l2.start(A, ctx(0));
		expect(resolve(l2, { party: { mates: [A] } })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.inRun },
		]);
		expect(starting.phase).toBe("countdown");
	});

	it("two or more free and none in a lobby: makePartyLobby hosted by the earliest accept", () => {
		const l = lobbies();
		expect(resolve(l, { party: { mates: [A, B], acceptOrder: [B, ME, A] } })).toEqual([
			{ kind: "makePartyLobby", hostId: B, joiners: [ME, A], invitees: [] },
		]);
		// The arrival accepted first: they host.
		expect(resolve(l, { party: { mates: [A], acceptOrder: [ME, A] } })).toEqual([
			{ kind: "makePartyLobby", hostId: ME, joiners: [A], invitees: [] },
		]);
		// Ids GetPartyAsync did not list rank after the listed ones (then join order).
		expect(resolve(l, { party: { mates: [A, B], acceptOrder: [B] } })).toEqual([
			{ kind: "makePartyLobby", hostId: B, joiners: [A, ME], invitees: [] },
		]);
	});

	it("GetPartyAsync failed: server join order (the arrival joined last)", () => {
		const l = lobbies();
		const actions = resolve(l, { party: { mates: [B, A] } });
		expect(actions).toEqual([{ kind: "makePartyLobby", hostId: B, joiners: [A, ME], invitees: [] }]);
		expect(arrivalJoinIntent(ME, actions)).toBe("party");
	});

	it("a mate in a run: the arrival hosts and the busy mate gets an invite", () => {
		const l = lobbies();
		expect(resolve(l, { party: { mates: [A], acceptOrder: [A, ME] }, busy: [A] })).toEqual([
			{ kind: "makePartyLobby", hostId: ME, joiners: [], invitees: [A] },
		]);
		expect(resolve(l, { party: { mates: [A, B, C] }, busy: [B] })).toEqual([
			{ kind: "makePartyLobby", hostId: A, joiners: [C, ME], invitees: [B] },
		]);
	});

	it("a party bigger than the lobby: the first maxSize are grouped, the rest get partyFull", () => {
		const l = lobbies();
		const mates: number[] = [];
		for (let i = 1; i <= LOBBY.maxSize + 1; i++) mates.push(1000 + i);
		// maxSize + 2 people (the arrival last in join order), one busy.
		const busyMate = mates[0];
		const actions = resolve(l, { party: { mates }, busy: [busyMate] });
		const free = [...mates];
		free.remove(0);
		free.push(ME);
		const joiners: number[] = [];
		for (let i = 1; i < LOBBY.maxSize; i++) joiners.push(free[i]);
		expect(actions[0]).toEqual({ kind: "makePartyLobby", hostId: free[0], joiners, invitees: [] });
		const toasts: number[] = [];
		for (let i = 1; i < actions.size(); i++) {
			const a = actions[i];
			expect(a.kind === "toast" && a.key).toBe(ARRIVAL_TOAST.partyFull);
			if (a.kind === "toast") toasts.push(a.toUserId);
		}
		// The arrival is the last free one, past the cap; then the busy mate (no room for an invite).
		expect(toasts).toEqual([ME, busyMate]);
		expect(arrivalJoinIntent(ME, actions)).toBe("none");
	});

	it("no mate here: the party rule does not apply (falls through)", () => {
		const l = lobbies();
		expect(resolve(l, { party: { mates: [] } })).toEqual(NONE);
		expect(resolve(l, { party: { mates: [ME] } })).toEqual(NONE);
		expect(resolve(l, { party: { mates: [] }, launch: { kind: "game", fromUserId: HOST } })).toEqual([
			{ kind: "notify", toUserId: HOST, notice: "inviteArrived" },
		]);
	});

	it("comes after invites and LaunchData lobbies, before a menu invite's notice", () => {
		const l = lobbies();
		const open = create(l, HOST);
		expect(resolve(l, { launch: lobbyLaunch(open, HOST), party: { mates: [A] } })).toEqual([
			{ kind: "joinOpen", lobbyId: open.lobbyId },
		]);
		expect(resolve(l, { launch: { kind: "game", fromUserId: HOST }, party: { mates: [A] } })).toEqual([
			{ kind: "makePartyLobby", hostId: A, joiners: [ME], invitees: [] },
		]);
	});
});

describe("arrival: 5, a menu invite", () => {
	it("the `inviteArrived` notice to the sender; the arrival is not moved", () => {
		const l = lobbies();
		const actions = resolve(l, { launch: { kind: "game", fromUserId: HOST } });
		expect(actions).toEqual([{ kind: "notify", toUserId: HOST, notice: "inviteArrived" }]);
		expect(arrivalJoinIntent(ME, actions)).toBe("none");
	});
});

describe("arrival: 6, the lobby cannot take them", () => {
	it("full / in a run / starting / kicked / gone each read their toast", () => {
		const l = lobbies();
		const full = create(l, HOST);
		fill(l, full);
		expect(resolve(l, { launch: lobbyLaunch(full, HOST) })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.full },
		]);
		const running = create(l, A, "closed");
		startRun(l, running);
		expect(resolve(l, { launch: lobbyLaunch(running, A) })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.inRun },
		]);
		const starting = create(l, B);
		l.setReady(B, true);
		l.start(B, ctx(0));
		expect(resolve(l, { launch: lobbyLaunch(starting, B) })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.inRun },
		]);
		const kicked = create(l, C);
		join(l, ME, kicked);
		l.kick(C, ME, ctx(0));
		expect(resolve(l, { launch: lobbyLaunch(kicked, C), now: 1 })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.kickCooldown },
		]);
		expect(resolve(l, { launch: lobbyLaunch(kicked, C), now: LOBBY.kickCooldownSeconds })).toEqual([
			{ kind: "joinOpen", lobbyId: kicked.lobbyId },
		]);
		const gone = create(l, 900);
		const goneId = gone.lobbyId;
		l.leave(900);
		expect(resolve(l, { launch: { kind: "lobby", lobbyId: goneId, fromUserId: 900 } })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.gone },
		]);
	});

	it("an invite to a lobby in a run stays live: the toast now, joinable when the run ends", () => {
		const l = lobbies();
		const lobby = create(l, HOST, "closed");
		l.platformInvites(HOST, [ME], ctx());
		startRun(l, lobby);
		// No LaunchData yet: the invite's lobby is used.
		expect(resolve(l)).toEqual([{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.inRun }]);
		l.runEnded(lobby.lobbyId);
		const [inv] = l.invitesFor(ME, 0);
		expect(resolve(l)).toEqual([{ kind: "joinInvite", inviteId: inv.inviteId, lobbyId: lobby.lobbyId }]);
	});

	it("the toast keys are theme lobby.err ids", () => {
		for (const [, key] of pairs(ARRIVAL_TOAST as unknown as Map<string, string>)) {
			expect(key.sub(1, "lobby.err.".size())).toBe("lobby.err.");
		}
		expect(ARRIVAL_TOAST.full).toBe("lobby.err.full");
		expect(ARRIVAL_TOAST.gone).toBe("lobby.err.inviteGone");
		expect(ARRIVAL_TOAST.inRun).toBe("lobby.err.inRun");
		expect(ARRIVAL_TOAST.partyFull).toBe("lobby.err.partyFull");
	});
});

describe("arrival: 7, nothing", () => {
	it("no LaunchData, no invite, no party (Roblox's own menu invite)", () => {
		const l = lobbies();
		create(l, HOST);
		const actions = resolve(l);
		expect(actions).toEqual(NONE);
		expect(arrivalJoinIntent(ME, actions)).toBe("none");
	});
});

describe("arrival: busy or already placed", () => {
	it("a busy arrival is never moved: joins become the busy toast, the party is not grouped", () => {
		const l = lobbies();
		const closed = create(l, HOST, "closed");
		const open = create(l, A, "open");
		l.platformInvites(HOST, [ME], ctx());
		const busy = [ME];
		expect(resolve(l, { launch: lobbyLaunch(closed, HOST), busy })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.busy },
		]);
		const l2 = lobbies();
		const open2 = create(l2, A, "open");
		expect(resolve(l2, { launch: lobbyLaunch(open2, A), busy })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.busy },
		]);
		expect(resolve(l2, { party: { mates: [B, C] }, busy })).toEqual(NONE);
		expect(resolve(l2, { party: { mates: [A] }, busy })).toEqual(NONE);
		expect(open.members).toEqual([A]);
	});

	it("notices and toasts still go out for a busy arrival", () => {
		const l = lobbies();
		const closed = create(l, HOST, "closed");
		const busy = [ME];
		expect(resolve(l, { launch: lobbyLaunch(closed, HOST), busy })).toEqual([
			{ kind: "notify", toUserId: HOST, notice: "followed" },
		]);
		expect(resolve(l, { launch: { kind: "game", fromUserId: HOST }, busy, party: { mates: [A] } })).toEqual([
			{ kind: "notify", toUserId: HOST, notice: "inviteArrived" },
		]);
		expect(resolve(l, { launch: { kind: "lobby", lobbyId: "gone", fromUserId: HOST }, busy })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.gone },
		]);
	});

	it("a late LaunchData for a player already in a lobby: nothing for their own, a toast for another", () => {
		const l = lobbies();
		const mine = create(l, HOST);
		const other = create(l, A);
		join(l, ME, mine);
		expect(resolve(l, { launch: lobbyLaunch(mine, HOST) })).toEqual(NONE);
		expect(resolve(l, { launch: lobbyLaunch(other, A) })).toEqual([
			{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.alreadyInLobby },
		]);
		expect(resolve(l, { party: { mates: [B, C] } })).toEqual(NONE);
	});
});

describe("arrivalJoinIntent", () => {
	it("lobby for invite / LaunchData joins, party for grouping that includes the player, else none", () => {
		expect(arrivalJoinIntent(ME, [{ kind: "joinInvite", inviteId: "i", lobbyId: "L" }])).toBe("lobby");
		expect(arrivalJoinIntent(ME, [{ kind: "joinOpen", lobbyId: "L" }])).toBe("lobby");
		expect(arrivalJoinIntent(ME, [{ kind: "partyJoin", lobbyId: "L", fromUserId: A }])).toBe("party");
		expect(arrivalJoinIntent(ME, [{ kind: "makePartyLobby", hostId: ME, joiners: [], invitees: [A] }])).toBe(
			"party",
		);
		expect(arrivalJoinIntent(ME, [{ kind: "makePartyLobby", hostId: A, joiners: [ME], invitees: [] }])).toBe(
			"party",
		);
		expect(arrivalJoinIntent(ME, [{ kind: "notify", toUserId: A, notice: "followed" }])).toBe("none");
		expect(arrivalJoinIntent(ME, [{ kind: "toast", toUserId: ME, key: ARRIVAL_TOAST.full }])).toBe("none");
		expect(arrivalJoinIntent(ME, NONE)).toBe("none");
	});
});
