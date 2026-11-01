// Same-server lobbies: visibility (canAccess), joins and invites, host-only actions, ready / countdown / run start,
// kicks with their cooldown, host migration, server leaves and the browse list.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEFAULT_RUN_SESSION_LIMITS } from "shared/run";
import {
	DEFAULT_LOBBY_NAME,
	LOBBY,
	LOBBY_NAMES,
	LOBBY_WORLDS,
	Lobbies,
	MAX_USER_ID_MAGNITUDE,
	canAccess,
	isWireUserId,
	type AreFriends,
	type Lobby,
	type LobbyContext,
	type LobbyCreateRequest,
	type LobbyRefusal,
} from "shared/lobby";

const HOST = 11;
const A = 22;
const B = 33;
const C = 44;
const D = 55;
const STRANGER = 99;

/** Friend pairs (symmetric). */
function friendsOf(friendPairs: ReadonlyArray<[number, number]>): AreFriends {
	return (x, y) => {
		for (const [p, q] of friendPairs) if ((p === x && q === y) || (p === y && q === x)) return true;
		return false;
	};
}

const NO_FRIENDS: AreFriends = () => false;

function lobbies(): Lobbies {
	let ids = 0;
	return new Lobbies({ newId: () => `id-${++ids}` });
}

function ctx(now = 0, opts: { busy?: number[]; friends?: AreFriends } = {}): LobbyContext {
	const busy = opts.busy ?? [];
	return {
		now,
		busyReason: (id) => (busy.includes(id) ? `player ${id} is busy` : undefined),
		areFriends: opts.friends ?? NO_FRIENDS,
	};
}

function code(r: { ok: true } | { ok: false; code: LobbyRefusal }): LobbyRefusal | "ok" {
	return r.ok ? "ok" : r.code;
}

function create(l: Lobbies, host: number, request?: LobbyCreateRequest, c = ctx()): Lobby {
	const r = l.create(host, request, c);
	if (!r.ok) error(r.reason);
	return r.lobby;
}

function join(l: Lobbies, user: number, lobby: Lobby, c = ctx()): void {
	const r = l.join(user, lobby.lobbyId, c);
	if (!r.ok) error(r.reason);
}

function fakeLobby(visibility: Lobby["visibility"]): Lobby {
	return {
		lobbyId: "x",
		seq: 1,
		createdAt: 0,
		hostId: HOST,
		nameId: DEFAULT_LOBBY_NAME,
		visibility,
		worldKind: "endless",
		phase: "forming",
		members: [HOST],
		ready: [],
		kickedUntil: new Map(),
	};
}

describe("lobby config", () => {
	it("max size is the party max; the preset names start with the default", () => {
		expect(LOBBY.maxSize).toBe(DEFAULT_RUN_SESSION_LIMITS.maxPartySize);
		expect(LOBBY_NAMES[0]).toBe("hostDescent");
		expect(DEFAULT_LOBBY_NAME).toBe("hostDescent");
		expect(LOBBY_NAMES.size()).toBe(8);
	});
});

describe("canAccess", () => {
	const hostFriendsA = friendsOf([[HOST, A]]);
	it("open: everyone; friends: the host and the host's friends; closed: nobody", () => {
		expect(canAccess(fakeLobby("open"), STRANGER, NO_FRIENDS)).toBe(true);
		expect(canAccess(fakeLobby("friends"), A, hostFriendsA)).toBe(true);
		expect(canAccess(fakeLobby("friends"), B, hostFriendsA)).toBe(false);
		expect(canAccess(fakeLobby("friends"), HOST, NO_FRIENDS)).toBe(true);
		expect(canAccess(fakeLobby("closed"), A, hostFriendsA)).toBe(false);
		expect(canAccess(fakeLobby("closed"), HOST, hostFriendsA)).toBe(false);
	});

	it("join follows it", () => {
		const l = lobbies();
		const open = create(l, HOST, { visibility: "open" });
		const friends = create(l, A, { visibility: "friends" });
		const closed = create(l, B, { visibility: "closed" });
		const f = friendsOf([[A, C]]);
		expect(code(l.join(STRANGER, open.lobbyId, ctx(0, { friends: f })))).toBe("ok");
		l.leave(STRANGER);
		expect(code(l.join(STRANGER, friends.lobbyId, ctx(0, { friends: f })))).toBe("noAccess");
		expect(code(l.join(C, friends.lobbyId, ctx(0, { friends: f })))).toBe("ok");
		l.leave(C);
		expect(code(l.join(C, closed.lobbyId, ctx(0, { friends: friendsOf([[B, C]]) })))).toBe("noAccess");
	});
});

describe("Lobbies: create and join", () => {
	it("creates a forming lobby with defaults; validates the request", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		expect(lobby.hostId).toBe(HOST);
		expect(lobby.members).toEqual([HOST]);
		expect(lobby.phase).toBe("forming");
		expect(lobby.visibility).toBe(LOBBY.defaultVisibility);
		expect(lobby.nameId).toBe(DEFAULT_LOBBY_NAME);
		expect(l.lobbyOf(HOST)).toBe(lobby);
		expect(code(l.create(HOST, undefined, ctx()))).toBe("alreadyInLobby");
		expect(code(l.create(A, "x" as never, ctx()))).toBe("badRequest");
		expect(code(l.create(A, { visibility: "public" }, ctx()))).toBe("badRequest");
		expect(code(l.create(A, { visibility: 3 as never }, ctx()))).toBe("badRequest");
		expect(code(l.create(A, { nameId: "Free text!" }, ctx()))).toBe("badName");
		expect(code(l.create(A, undefined, ctx(0, { busy: [A] })))).toBe("busy");
		const named = create(l, A, { visibility: "closed", nameId: "bossPractice" });
		expect([named.visibility, named.nameId]).toEqual(["closed", "bossPractice"]);
	});

	it("a player is in at most one lobby; busy players cannot join; bad ids are refused", () => {
		const l = lobbies();
		const one = create(l, HOST);
		const two = create(l, A);
		join(l, B, one);
		expect(code(l.join(B, two.lobbyId, ctx()))).toBe("alreadyInLobby");
		expect(code(l.join(B, one.lobbyId, ctx()))).toBe("alreadyInLobby");
		expect(code(l.join(C, two.lobbyId, ctx(0, { busy: [C] })))).toBe("busy");
		expect(code(l.join(C, "nope", ctx()))).toBe("unknownLobby");
		expect(code(l.join(C, 5 as never, ctx()))).toBe("badRequest");
		expect(code(l.join(C, "", ctx()))).toBe("badRequest");
		expect(code(l.join(C, string.rep("x", LOBBY.maxIdChars + 1), ctx()))).toBe("badRequest");
		expect(two.members).toEqual([A]);
	});

	it("refuses a full lobby", () => {
		const l = lobbies();
		const lobby = create(l, 1);
		for (let id = 2; id <= LOBBY.maxSize; id++) join(l, id, lobby);
		expect(lobby.members.size()).toBe(LOBBY.maxSize);
		expect(code(l.join(STRANGER, lobby.lobbyId, ctx()))).toBe("full");
	});

	it("refuses joins while counting down or in a run", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		l.setReady(HOST, true);
		l.start(HOST, ctx(0));
		expect(code(l.join(A, lobby.lobbyId, ctx(1)))).toBe("starting");
		l.tick(ctx(LOBBY.countdownSeconds));
		expect(lobby.phase).toBe("inRun");
		expect(code(l.join(A, lobby.lobbyId, ctx(5)))).toBe("inRun");
	});
});

describe("Lobbies: invites", () => {
	it("an invite is the only way into a closed lobby; joining consumes it", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		expect(code(l.join(A, lobby.lobbyId, ctx()))).toBe("noAccess");
		const inv = l.invite(HOST, A, ctx(1));
		if (!inv.ok) error(inv.reason);
		expect([inv.invite.fromUserId, inv.invite.toUserId, inv.invite.lobbyId]).toEqual([HOST, A, lobby.lobbyId]);
		expect(inv.invite.expiresAt).toBe(1 + LOBBY.inviteTimeoutSeconds);
		expect(l.invitesFor(A, 1)).toEqual([inv.invite]);
		const j = l.join(A, lobby.lobbyId, ctx(2));
		expect(j.ok && j.usedInvite).toBe(inv.invite);
		expect(l.invitesFor(A, 2)).toEqual([]);
		expect(lobby.members).toEqual([HOST, A]);
	});

	it("an invite lets a non-friend of the host into a friends lobby", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "friends" });
		expect(code(l.join(B, lobby.lobbyId, ctx()))).toBe("noAccess");
		expect(l.invite(HOST, B, ctx()).ok).toBe(true);
		expect(code(l.join(B, lobby.lobbyId, ctx()))).toBe("ok");
	});

	it("any member invites; a non-member cannot", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		expect(code(l.invite(STRANGER, A, ctx()))).toBe("notMember");
		l.invite(HOST, A, ctx());
		join(l, A, lobby);
		const r = l.invite(A, B, ctx());
		expect(r.ok && r.invite.fromUserId).toBe(A);
		expect(code(l.join(B, lobby.lobbyId, ctx()))).toBe("ok");
	});

	it("refuses bad targets, busy players, players in a lobby and duplicates", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		create(l, C);
		expect(code(l.invite(HOST, "x" as never, ctx()))).toBe("badRequest");
		expect(code(l.invite(HOST, 1.5, ctx()))).toBe("badRequest");
		expect(code(l.invite(HOST, HOST, ctx()))).toBe("badRequest");
		expect(code(l.invite(HOST, A, ctx(0, { busy: [A] })))).toBe("busy");
		expect(code(l.invite(HOST, C, ctx()))).toBe("alreadyInLobby"); // in another lobby
		join(l, B, lobby);
		expect(code(l.invite(HOST, B, ctx()))).toBe("alreadyInLobby"); // in this one
		expect(code(l.invite(HOST, A, ctx()))).toBe("ok");
		expect(code(l.invite(B, A, ctx()))).toBe("alreadyInvited"); // per lobby, whoever sent it
		expect(code(l.invite(C, A, ctx()))).toBe("ok"); // another lobby may invite the same player
		expect(l.invitesFor(A, 0).size()).toBe(2);
	});

	it("caps each member's live invites", () => {
		const l = lobbies();
		create(l, HOST);
		for (let i = 1; i <= LOBBY.maxInvitesPerMember; i++) expect(code(l.invite(HOST, 100 + i, ctx()))).toBe("ok");
		expect(code(l.invite(HOST, 200, ctx()))).toBe("inviteCap");
		// Expired ones no longer count.
		expect(code(l.invite(HOST, 200, ctx(LOBBY.inviteTimeoutSeconds)))).toBe("ok");
	});

	it("refuses to invite into a full lobby or one in a run", () => {
		const l = lobbies();
		const lobby = create(l, 1);
		for (let id = 2; id <= LOBBY.maxSize; id++) join(l, id, lobby);
		expect(code(l.invite(1, STRANGER, ctx()))).toBe("full");
		const solo = create(l, HOST);
		l.setReady(HOST, true);
		l.start(HOST, ctx(0));
		l.tick(ctx(LOBBY.countdownSeconds));
		expect(solo.phase).toBe("inRun");
		expect(code(l.invite(HOST, A, ctx(5)))).toBe("inRun");
	});

	it("survives its sender leaving (it belongs to the lobby)", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		l.invite(HOST, A, ctx());
		join(l, A, lobby);
		const sent = l.invite(A, B, ctx());
		if (!sent.ok) error(sent.reason);
		l.leave(A);
		expect(l.invitesFor(B, 0)).toEqual([sent.invite]);
		expect(code(l.join(B, lobby.lobbyId, ctx()))).toBe("ok");
	});

	it("expires after the timeout (tick drops and reports it)", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		const inv = l.invite(HOST, A, ctx(10));
		if (!inv.ok) error(inv.reason);
		const deadline = 10 + LOBBY.inviteTimeoutSeconds;
		expect(l.tick(ctx(deadline - 1)).expiredInvites).toEqual([]);
		expect(code(l.join(A, lobby.lobbyId, ctx(deadline)))).toBe("noAccess"); // expired before the sweep
		expect(l.tick(ctx(deadline)).expiredInvites).toEqual([inv.invite]);
		expect(l.invitesTo(lobby.lobbyId, deadline)).toEqual([]);
		expect(code(l.invite(HOST, A, ctx(deadline)))).toBe("ok"); // can be re-sent
	});

	it("decline drops it; only the invitee can decline", () => {
		const l = lobbies();
		create(l, HOST);
		const inv = l.invite(HOST, A, ctx());
		if (!inv.ok) error(inv.reason);
		expect(code(l.decline(B, inv.invite.inviteId))).toBe("notInvited");
		expect(code(l.decline(A, 7 as never))).toBe("badRequest");
		const d = l.decline(A, inv.invite.inviteId);
		expect(d.ok && d.invite).toBe(inv.invite);
		expect(code(l.decline(A, inv.invite.inviteId))).toBe("notInvited");
	});

	it("joining or creating a lobby drops the other invites the player received", () => {
		const l = lobbies();
		const one = create(l, HOST);
		create(l, B);
		create(l, C);
		const i1 = l.invite(HOST, A, ctx());
		const i2 = l.invite(B, A, ctx());
		if (!i1.ok || !i2.ok) error("invite failed");
		const j = l.join(A, one.lobbyId, ctx());
		expect(j.ok && j.droppedInvites).toEqual([i2.invite]);
		const i3 = l.invite(C, D, ctx());
		if (!i3.ok) error(i3.reason);
		const c = l.create(D, undefined, ctx());
		expect(c.ok && c.droppedInvites).toEqual([i3.invite]);
	});
});

describe("Lobbies: host-only actions", () => {
	it("members (and outsiders) cannot kick, rename, change visibility, transfer or start", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		join(l, B, lobby);
		expect(code(l.kick(A, B, ctx()))).toBe("notHost");
		expect(code(l.setVisibility(A, "closed"))).toBe("notHost");
		expect(code(l.setName(A, "chill"))).toBe("notHost");
		expect(code(l.transferHost(A, B))).toBe("notHost");
		l.setReady(HOST, true);
		l.setReady(A, true);
		l.setReady(B, true);
		expect(code(l.start(A, ctx()))).toBe("notHost");
		expect(code(l.setName(STRANGER, "chill"))).toBe("notMember");
		expect(lobby.members).toEqual([HOST, A, B]);
		expect([lobby.visibility, lobby.nameId, lobby.hostId, lobby.phase]).toEqual([
			"open",
			DEFAULT_LOBBY_NAME,
			HOST,
			"forming",
		]);
	});

	it("setName takes preset ids only; setVisibility validates and never removes members or invites", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "open" });
		join(l, A, lobby); // not a friend of the host
		l.invite(HOST, B, ctx());
		expect(code(l.setName(HOST, "My lobby"))).toBe("badName");
		expect(code(l.setName(HOST, 4 as never))).toBe("badName");
		expect(code(l.setName(HOST, "scoreChasing"))).toBe("ok");
		expect(lobby.nameId).toBe("scoreChasing");
		expect(code(l.setVisibility(HOST, "secret"))).toBe("badRequest");
		expect(code(l.setVisibility(HOST, "closed"))).toBe("ok");
		expect(lobby.members).toEqual([HOST, A]);
		expect(code(l.join(B, lobby.lobbyId, ctx()))).toBe("ok"); // the invite is still valid
	});

	it("the world: endless by default, daily on create or by the host while forming; a change clears Ready", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		expect(lobby.worldKind).toBe("endless");
		expect(LOBBY.defaultWorld).toBe("endless");
		expect(LOBBY_WORLDS).toEqual(["endless", "daily"]);
		expect(code(l.create(A, { worldKind: "tutorial" }, ctx()))).toBe("badRequest");
		expect(code(l.create(A, { worldKind: "game" }, ctx()))).toBe("badRequest");
		const daily = create(l, A, { worldKind: "daily" });
		expect(daily.worldKind).toBe("daily");
		join(l, B, lobby);
		l.setReady(HOST, true);
		l.setReady(B, true);
		// Host only, known worlds only.
		expect(code(l.setWorld(B, "daily"))).toBe("notHost");
		expect(code(l.setWorld(STRANGER, "daily"))).toBe("notMember");
		expect(code(l.setWorld(HOST, "greybox"))).toBe("badRequest");
		expect(code(l.setWorld(HOST, 3 as never))).toBe("badRequest");
		// The same world changes nothing (Ready kept); another clears every Ready.
		const same = l.setWorld(HOST, "endless");
		expect(same.ok && same.changed).toBe(false);
		expect(lobby.ready.size()).toBe(2);
		const changed = l.setWorld(HOST, "daily");
		expect(changed.ok && changed.changed).toBe(true);
		expect([lobby.worldKind, lobby.ready.size()]).toEqual(["daily", 0]);
		expect(l.summariesFor(STRANGER, NO_FRIENDS).map((x) => [x.lobbyId, x.worldKind])).toEqual([
			[lobby.lobbyId, "daily"],
			[daily.lobbyId, "daily"],
		]);
		// Not while starting or in a run: the countdown plays the world it started with.
		l.setReady(HOST, true);
		l.setReady(B, true);
		expect(code(l.start(HOST, ctx(0)))).toBe("ok");
		expect(code(l.setWorld(HOST, "endless"))).toBe("starting");
		expect(l.tick(ctx(LOBBY.countdownSeconds)).starts).toEqual([
			{ kind: "party", lobbyId: lobby.lobbyId, members: [HOST, B], worldKind: "daily" },
		]);
		expect(code(l.setWorld(HOST, "endless"))).toBe("inRun");
		// A one-member daily lobby starts a solo daily run.
		l.setReady(A, true);
		expect(code(l.start(A, ctx(10)))).toBe("ok");
		expect(l.tick(ctx(10 + LOBBY.countdownSeconds)).starts).toEqual([
			{ kind: "solo", lobbyId: daily.lobbyId, userId: A, worldKind: "daily" },
		]);
	});

	it("transferHost hands the lobby to a member; refuses outsiders and self", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		expect(code(l.transferHost(HOST, STRANGER))).toBe("notMember");
		expect(code(l.transferHost(HOST, HOST))).toBe("badRequest");
		expect(code(l.transferHost(HOST, A))).toBe("ok");
		expect(lobby.hostId).toBe(A);
		expect(lobby.members).toEqual([HOST, A]); // join order unchanged
		expect(code(l.setName(HOST, "chill"))).toBe("notHost");
		expect(code(l.setName(A, "chill"))).toBe("ok");
	});
});

describe("Lobbies: ready, countdown and run", () => {
	it("start needs every member ready; one member is enough and starts solo", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		expect(code(l.start(HOST, ctx()))).toBe("notReady");
		l.setReady(HOST, true);
		expect(code(l.start(HOST, ctx(0, { busy: [HOST] })))).toBe("busy");
		const s = l.start(HOST, ctx(100));
		expect(s.ok && s.lobby.countdownEndsAt).toBe(100 + LOBBY.countdownSeconds);
		expect(lobby.phase).toBe("countdown");
		expect(code(l.start(HOST, ctx(101)))).toBe("starting");
		expect(l.tick(ctx(100 + LOBBY.countdownSeconds - 1)).starts).toEqual([]);
		expect(l.tick(ctx(100 + LOBBY.countdownSeconds)).starts).toEqual([
			{ kind: "solo", lobbyId: lobby.lobbyId, userId: HOST, worldKind: "endless" },
		]);
		expect(lobby.phase).toBe("inRun");
		expect(lobby.countdownEndsAt).toBe(undefined);
		expect(l.tick(ctx(200)).starts).toEqual([]); // once
		expect(code(l.start(HOST, ctx(200)))).toBe("inRun");
	});

	it("two or more members start a party in join order (not host first)", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		join(l, B, lobby);
		l.transferHost(HOST, B);
		for (const id of [HOST, A]) l.setReady(id, true);
		expect(code(l.start(B, ctx()))).toBe("notReady");
		l.setReady(B, true);
		expect(code(l.start(B, ctx()))).toBe("ok");
		expect(l.tick(ctx(LOBBY.countdownSeconds)).starts).toEqual([
			{ kind: "party", lobbyId: lobby.lobbyId, members: [HOST, A, B], worldKind: "endless" },
		]);
	});

	it("a member un-readying or leaving cancels the countdown", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		join(l, B, lobby);
		for (const id of [HOST, A, B]) l.setReady(id, true);
		l.start(HOST, ctx());
		const r = l.setReady(A, false);
		expect(r.ok && r.countdownCancelled).toBe(true);
		expect([lobby.phase, lobby.countdownEndsAt]).toEqual(["forming", undefined]);
		expect(l.tick(ctx(LOBBY.countdownSeconds)).starts).toEqual([]);
		l.setReady(A, true);
		l.start(HOST, ctx(10));
		const left = l.leave(B);
		expect(left.ok && left.departure.countdownCancelled).toBe(true);
		expect(lobby.phase).toBe("forming");
		expect(l.tick(ctx(10 + LOBBY.countdownSeconds)).starts).toEqual([]);
		expect(lobby.ready).toEqual([HOST, A]); // the others stay ready
	});

	it("a member who became busy cancels a due countdown", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		l.setReady(HOST, true);
		l.setReady(A, true);
		l.start(HOST, ctx());
		const t = l.tick(ctx(LOBBY.countdownSeconds, { busy: [A] }));
		expect(t.starts).toEqual([]);
		expect(t.cancelled.map((x) => [x.lobby.lobbyId, x.reason])).toEqual([[lobby.lobbyId, `player ${A} is busy`]]);
		expect(lobby.phase).toBe("forming");
	});

	it("runEnded returns to forming with Ready cleared; ready toggles are refused in a run", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		expect(code(l.runEnded(lobby.lobbyId))).toBe("notInRun");
		l.setReady(HOST, true);
		l.setReady(A, true);
		expect(code(l.setReady(A, "yes" as never))).toBe("badRequest");
		expect(code(l.setReady(STRANGER, true))).toBe("notMember");
		l.start(HOST, ctx());
		l.tick(ctx(LOBBY.countdownSeconds));
		expect(code(l.setReady(A, false))).toBe("inRun");
		expect(code(l.runEnded("nope"))).toBe("unknownLobby");
		expect(code(l.runEnded(lobby.lobbyId))).toBe("ok");
		expect([lobby.phase, lobby.ready]).toEqual(["forming", []]);
		expect(code(l.join(B, lobby.lobbyId, ctx()))).toBe("ok");
	});

	it("a member leaving the server while in a run is just removed", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		l.setReady(HOST, true);
		l.setReady(A, true);
		l.start(HOST, ctx());
		l.tick(ctx(LOBBY.countdownSeconds));
		const gone = l.playerRemoving(A);
		expect(gone.departure?.countdownCancelled).toBe(false);
		expect([lobby.phase, lobby.members, lobby.ready]).toEqual(["inRun", [HOST], [HOST]]);
	});
});

describe("Lobbies: kick", () => {
	it("removes the member and blocks every member from re-inviting them for the cooldown", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		join(l, B, lobby);
		expect(code(l.kick(HOST, HOST, ctx()))).toBe("badRequest");
		expect(code(l.kick(HOST, STRANGER, ctx()))).toBe("notMember");
		const k = l.kick(HOST, B, ctx(100));
		expect(k.ok && k.departure.userId).toBe(B);
		expect(lobby.members).toEqual([HOST, A]);
		expect(l.lobbyOf(B)).toBe(undefined);
		const coolUntil = 100 + LOBBY.kickCooldownSeconds;
		expect(code(l.invite(HOST, B, ctx(101)))).toBe("kickCooldown");
		expect(code(l.invite(A, B, ctx(coolUntil - 1)))).toBe("kickCooldown");
		expect(code(l.join(B, lobby.lobbyId, ctx(coolUntil - 1)))).toBe("kickCooldown"); // an open lobby too
		expect(code(l.invite(A, B, ctx(coolUntil)))).toBe("ok");
		l.tick(ctx(coolUntil));
		expect(lobby.kickedUntil.size()).toBe(0);
	});

	it("drops the kicked player's invites to the lobby, cancels a countdown, and is refused in a run", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		for (const id of [HOST, A]) l.setReady(id, true);
		l.start(HOST, ctx());
		const k = l.kick(HOST, A, ctx());
		expect(k.ok && k.departure.countdownCancelled).toBe(true);
		expect(lobby.phase).toBe("forming");
		join(l, B, lobby);
		l.setReady(B, true);
		l.start(HOST, ctx());
		l.tick(ctx(LOBBY.countdownSeconds));
		expect(code(l.kick(HOST, B, ctx(10)))).toBe("inRun");
	});
});

describe("Lobbies: leaving and host migration", () => {
	it("the longest-standing member becomes host; the last member leaving deletes the lobby and its invites", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		join(l, B, lobby);
		l.invite(B, C, ctx());
		const h = l.leave(HOST);
		expect(h.ok && h.departure.newHostId).toBe(A);
		expect(lobby.hostId).toBe(A);
		const m = l.leave(B);
		expect(m.ok && m.departure.newHostId).toBe(undefined);
		expect(lobby.hostId).toBe(A);
		const last = l.leave(A);
		expect(last.ok && last.departure.deleted).toBe(true);
		expect(last.ok && last.departure.droppedInvites.map((x) => x.toUserId)).toEqual([C]);
		expect(l.get(lobby.lobbyId)).toBe(undefined);
		expect(l.size()).toBe(0);
		expect(l.invitesFor(C, 0)).toEqual([]);
		expect(code(l.leave(A))).toBe("notMember");
	});

	it("a friends lobby whose new host has other friends keeps its members; the listing follows the new host", () => {
		const l = lobbies();
		const f = friendsOf([
			[HOST, A],
			[HOST, B],
			[A, C],
		]);
		const lobby = create(l, HOST, { visibility: "friends" });
		join(l, A, lobby, ctx(0, { friends: f }));
		join(l, B, lobby, ctx(0, { friends: f }));
		const ids = (viewer: number) => l.summariesFor(viewer, f).map((s) => s.lobbyId);
		expect(ids(C)).toEqual([]);
		expect(ids(D)).toEqual([]);
		l.leave(HOST);
		expect(lobby.hostId).toBe(A);
		expect(lobby.members).toEqual([A, B]); // B is not A's friend and stays
		expect(ids(C)).toEqual([lobby.lobbyId]);
		expect(code(l.join(C, lobby.lobbyId, ctx(0, { friends: f })))).toBe("ok");
		expect(ids(HOST)).toEqual([lobby.lobbyId]);
	});

	it("playerRemoving leaves the lobby and drops the invites received; the ones sent stay", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		const other = create(l, C);
		join(l, A, lobby);
		const sent = l.invite(A, B, ctx());
		if (!sent.ok) error(sent.reason);
		const r = l.playerRemoving(A);
		expect(r.departure?.lobbyId).toBe(lobby.lobbyId);
		expect(l.invitesFor(B, 0)).toEqual([sent.invite]);
		const got = l.invite(C, D, ctx());
		if (!got.ok) error(got.reason);
		const d = l.playerRemoving(D);
		expect(d.departure).toBe(undefined);
		expect(d.droppedInvites).toEqual([got.invite]);
		expect(l.invitesTo(other.lobbyId, 0)).toEqual([]);
	});
});

describe("Lobbies: summaries", () => {
	it("lists what the viewer can access (never closed) with counts, phase and hasFriend", () => {
		const l = lobbies();
		const open = create(l, HOST, { visibility: "open", nameId: "chill" });
		create(l, A, { visibility: "closed" });
		join(l, B, open);
		const f = friendsOf([[STRANGER, B]]);
		expect(l.summariesFor(STRANGER, f)).toEqual([
			{
				lobbyId: open.lobbyId,
				nameId: "chill",
				hostId: HOST,
				count: 2,
				max: LOBBY.maxSize,
				visibility: "open",
				worldKind: "endless",
				phase: "forming",
				hasFriend: true,
			},
		]);
		expect(l.summariesFor(A, NO_FRIENDS).map((s) => [s.lobbyId, s.hasFriend])).toEqual([[open.lobbyId, false]]);
	});

	it("sorts friends lobbies first, then lobbies with a friend, then fullest, then oldest", () => {
		const l = lobbies();
		const V = 1000;
		const f = friendsOf([
			[V, 1],
			[V, 21],
		]);
		const c = (now: number) => ctx(now, { friends: f });
		const small = create(l, 10, undefined, c(0)); // 1 member
		const big = create(l, 20, undefined, c(1)); // 3 members
		join(l, 22, big, c(1));
		join(l, 23, big, c(1));
		const withFriend = create(l, 30, undefined, c(2)); // 1 member + the viewer's friend 21
		join(l, 21, withFriend, c(2));
		const friendsLobby = create(l, 1, { visibility: "friends" }, c(3)); // host is the viewer's friend
		const small2 = create(l, 40, undefined, c(4)); // 1 member, newer than `small`
		const hidden = create(l, 50, { visibility: "friends" }, c(5)); // host is not the viewer's friend
		expect(l.summariesFor(V, f).map((s) => s.lobbyId)).toEqual([
			friendsLobby.lobbyId,
			withFriend.lobbyId,
			big.lobbyId,
			small.lobbyId,
			small2.lobbyId,
		]);
		expect(
			l
				.summariesFor(V, f)
				.map((s) => s.lobbyId)
				.includes(hidden.lobbyId),
		).toBe(false);
	});
});

describe("Lobbies: platform invites (Roblox's invite prompt)", () => {
	/** Friends not in this server (the prompt's recipients). */
	const F1 = 1001;
	const F2 = 1002;
	const F3 = 1003;

	function platform(l: Lobbies, from: number, ids: unknown, c = ctx()) {
		const r = l.platformInvites(from, ids, c);
		if (!r.ok) error(r.reason);
		return r;
	}

	it("refuses recipients who are in this server (they get the lobby's invite list and its rules)", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		const here = (id: number) => id === A;
		const r = l.platformInvites(HOST, [A, F1], ctx(), here);
		if (!r.ok) error(r.reason);
		expect(r.invites.size()).toBe(1);
		expect(r.invites[0].toUserId).toBe(F1);
		expect(r.refusals.size()).toBe(1);
		expect([r.refusals[0].userId, r.refusals[0].code]).toEqual([A, "badRequest"]);
		expect(l.invitesFor(A, 0)).toEqual([]);
		expect(l.invitesTo(lobby.lobbyId, 0).size()).toBe(1);
		// Through invite they get the server source and TTL.
		const s = l.invite(HOST, A, ctx());
		expect(s.ok && s.invite.source).toBe("server");
	});

	it("invites players absent from the server, with source platform and the platform TTL", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		const r = platform(l, HOST, [F1, F2], ctx(5));
		expect(r.lobby).toBe(lobby);
		expect(r.refusals).toEqual([]);
		expect(r.invites.size()).toBe(2);
		for (const inv of r.invites) {
			expect([inv.source, inv.lobbyId, inv.fromUserId]).toEqual(["platform", lobby.lobbyId, HOST]);
			expect(inv.expiresAt).toBe(5 + LOBBY.platformInviteTimeoutSeconds);
		}
		expect(l.invitesFor(F1, 5)).toEqual([r.invites[0]]);
		expect(l.invitesTo(lobby.lobbyId, 5)).toEqual([r.invites[0], r.invites[1]]);
	});

	it("an arriving player joins a Closed lobby through it (nothing converts)", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		const r = platform(l, HOST, [F1]);
		// F1 arrives minutes later (well within the platform TTL, far past the server one).
		const later = LOBBY.inviteTimeoutSeconds * 5;
		expect(later < LOBBY.platformInviteTimeoutSeconds).toBe(true);
		expect(l.invitesFor(F1, later)).toEqual([r.invites[0]]);
		const j = l.join(F1, lobby.lobbyId, ctx(later));
		expect(j.ok && j.usedInvite).toBe(r.invites[0]);
		expect(lobby.members).toEqual([HOST, F1]);
		expect(l.invitesFor(F1, later)).toEqual([]);
	});

	it("validates the list: an array of integers at most the platform cap long; repeats count once", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		expect(code(l.platformInvites(HOST, F1 as never, ctx()))).toBe("badRequest");
		expect(code(l.platformInvites(HOST, "x", ctx()))).toBe("badRequest");
		expect(code(l.platformInvites(HOST, [F1, "x"], ctx()))).toBe("badRequest");
		expect(code(l.platformInvites(HOST, [F1, 1.5], ctx()))).toBe("badRequest");
		expect(code(l.platformInvites(HOST, [F1, 0 / 0], ctx()))).toBe("badRequest");
		expect(code(l.platformInvites(HOST, { a: F1 }, ctx()))).toBe("badRequest");
		const mixed = new Map<unknown, unknown>([
			[1, F1],
			["x", F2],
		]);
		expect(code(l.platformInvites(HOST, mixed, ctx()))).toBe("badRequest");
		const tooMany: number[] = [];
		for (let i = 0; i <= LOBBY.maxPlatformInvitesPerMember; i++) tooMany.push(2000 + i);
		expect(code(l.platformInvites(HOST, tooMany, ctx()))).toBe("badRequest");
		expect(l.invitesTo(lobby.lobbyId, 0)).toEqual([]); // nothing made by a refused call
		const r = platform(l, HOST, [F1, F2, F1, F1]);
		expect(r.invites.map((inv) => inv.toUserId)).toEqual([F1, F2]);
		expect(r.refusals).toEqual([]);
		expect(platform(l, HOST, []).invites).toEqual([]);
	});

	it("keeps the sender rules: a member, not in a run, not a full lobby", () => {
		const l = lobbies();
		expect(code(l.platformInvites(STRANGER, [F1], ctx()))).toBe("notMember");
		const full = create(l, 1);
		for (let id = 2; id <= LOBBY.maxSize; id++) join(l, id, full);
		expect(code(l.platformInvites(1, [F1], ctx()))).toBe("full");
		create(l, HOST);
		l.setReady(HOST, true);
		l.start(HOST, ctx(0));
		l.tick(ctx(LOBBY.countdownSeconds));
		expect(code(l.platformInvites(HOST, [F1], ctx(5)))).toBe("inRun");
	});

	it("refuses per id: self, busy, in a lobby, kick cooldown, already invited; the rest still go out", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		create(l, C);
		join(l, B, lobby);
		l.kick(HOST, B, ctx(0));
		const r = platform(l, HOST, [HOST, D, A, C, B, F1], ctx(1, { busy: [D] }));
		expect(r.invites.map((inv) => inv.toUserId)).toEqual([F1]);
		expect(r.refusals.map((x) => [x.userId, x.code])).toEqual([
			[HOST, "badRequest"],
			[D, "busy"],
			[A, "alreadyInLobby"], // in this lobby
			[C, "alreadyInLobby"], // in another
			[B, "kickCooldown"],
		]);
		for (const x of r.refusals) expect(typeIs(x.reason, "string") && x.reason.size() > 0).toBe(true);
		// After the cooldown the kicked player may be invited again.
		expect(platform(l, HOST, [B], ctx(1 + LOBBY.kickCooldownSeconds)).invites.size()).toBe(1);
	});

	it("dedupes against any live invite to this lobby, server ones included, both ways", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		join(l, A, lobby);
		expect(code(l.invite(HOST, B, ctx()))).toBe("ok");
		const r = platform(l, A, [B, F1]); // another member, same lobby
		expect(r.refusals.map((x) => [x.userId, x.code])).toEqual([[B, "alreadyInvited"]]);
		expect(code(l.invite(HOST, F1, ctx()))).toBe("alreadyInvited"); // a platform invite blocks a server one
		expect(platform(l, HOST, [F1]).refusals.map((x) => x.code)).toEqual(["alreadyInvited"]);
		// Another lobby may invite the same friend.
		create(l, C);
		expect(platform(l, C, [F1]).invites.size()).toBe(1);
		expect(l.invitesFor(F1, 0).size()).toBe(2);
	});

	it("has its own cap, counted apart from the server cap (both directions)", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		for (let i = 1; i <= LOBBY.maxInvitesPerMember; i++) expect(code(l.invite(HOST, 100 + i, ctx()))).toBe("ok");
		// Server cap reached: platform invites still go out, up to their own cap.
		const ids: number[] = [];
		for (let i = 1; i <= LOBBY.maxPlatformInvitesPerMember; i++) ids.push(2000 + i);
		expect(platform(l, HOST, ids).invites.size()).toBe(LOBBY.maxPlatformInvitesPerMember);
		const over = platform(l, HOST, [F1, F2]);
		expect(over.refusals.map((x) => [x.userId, x.code])).toEqual([
			[F1, "inviteCap"],
			[F2, "inviteCap"],
		]);
		// Platform invites never count toward the server cap: once the server ones expire, invite works again
		// while every platform invite is still live.
		const t = LOBBY.inviteTimeoutSeconds;
		expect(code(l.invite(HOST, 300, ctx(t)))).toBe("ok");
		expect(l.invitesTo(lobby.lobbyId, t).size()).toBe(LOBBY.maxPlatformInvitesPerMember + 1);
	});

	it("the cap stops part way through a list and frees up as invites expire", () => {
		const l = lobbies();
		create(l, HOST);
		const first: number[] = [];
		for (let i = 1; i < LOBBY.maxPlatformInvitesPerMember; i++) first.push(2000 + i);
		expect(platform(l, HOST, first, ctx(0)).invites.size()).toBe(LOBBY.maxPlatformInvitesPerMember - 1);
		const r = platform(l, HOST, [F1, F2, F3], ctx(1));
		expect(r.invites.map((inv) => inv.toUserId)).toEqual([F1]);
		expect(r.refusals.map((x) => x.userId)).toEqual([F2, F3]);
		// The first batch expires (at 900 s); the later one is still live and counts.
		const t = LOBBY.platformInviteTimeoutSeconds;
		const again = platform(l, HOST, [F2, F3], ctx(t));
		expect(again.invites.map((inv) => inv.toUserId)).toEqual([F2, F3]);
	});

	it("expires at 900 s: tick drops and reports it; the join is refused after", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		const inv = platform(l, HOST, [F1], ctx(10)).invites[0];
		const deadline = 10 + LOBBY.platformInviteTimeoutSeconds;
		expect(l.tick(ctx(10 + LOBBY.inviteTimeoutSeconds)).expiredInvites).toEqual([]); // not the server TTL
		expect(l.tick(ctx(deadline - 1)).expiredInvites).toEqual([]);
		expect(code(l.join(F1, lobby.lobbyId, ctx(deadline)))).toBe("noAccess");
		expect(l.tick(ctx(deadline)).expiredInvites).toEqual([inv]);
		expect(platform(l, HOST, [F1], ctx(deadline)).invites.size()).toBe(1); // can be re-sent
	});

	it("drops with the lobby, on a kick, and when the invitee joins elsewhere; a never-arrived leave drops nothing", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		const [i1] = platform(l, HOST, [F1]).invites;
		// Lobby deleted (last member left).
		const dep = l.leave(HOST);
		expect(dep.ok && dep.departure.droppedInvites).toEqual([i1]);
		expect(l.invitesFor(F1, 0)).toEqual([]);
		expect(lobby.members).toEqual([]);

		// Kick: the arrival joins with a platform invite, is kicked; re-invite blocked by the cooldown.
		const two = create(l, HOST);
		platform(l, HOST, [F2]);
		join(l, F2, two);
		const k = l.kick(HOST, F2, ctx(0));
		expect(k.ok).toBe(true);
		expect(platform(l, HOST, [F2]).refusals.map((x) => x.code)).toEqual(["kickCooldown"]);

		// Joined elsewhere: the other lobby's platform invite is dropped (silently, like any).
		const other = create(l, A);
		const [i3] = platform(l, HOST, [F3]).invites;
		const [i4] = platform(l, A, [F3]).invites;
		const j = l.join(F3, other.lobbyId, ctx());
		expect(j.ok && j.usedInvite).toBe(i4);
		expect(j.ok && j.droppedInvites).toEqual([i3]);

		// A recipient who never arrived "leaving" drops nothing they did not receive; the sender's stay.
		const [i5] = platform(l, HOST, [F1]).invites;
		expect(l.playerRemoving(STRANGER).droppedInvites).toEqual([]);
		expect(l.invitesTo(two.lobbyId, 0)).toEqual([i5]);
	});

	it("server invites keep source server and their own TTL", () => {
		const l = lobbies();
		create(l, HOST);
		const r = l.invite(HOST, A, ctx(3));
		expect(r.ok && [r.invite.source, r.invite.expiresAt]).toEqual(["server", 3 + LOBBY.inviteTimeoutSeconds]);
	});
});

describe("Lobbies: party invites", () => {
	it("source party, the platform TTL, no cap, and the invitee may be busy", () => {
		const l = lobbies();
		const lobby = create(l, HOST, { visibility: "closed" });
		for (let i = 1; i <= LOBBY.maxInvitesPerMember; i++) l.invite(HOST, 100 + i, ctx());
		const r = l.partyInvite(HOST, A, ctx(2));
		if (!r.ok) error(r.reason);
		expect([r.invite.source, r.invite.expiresAt, r.lobby]).toEqual([
			"party",
			2 + LOBBY.platformInviteTimeoutSeconds,
			lobby,
		]);
		// A busy mate (in a run) gets one too; it is answered afterwards.
		expect(code(l.partyInvite(HOST, B, ctx(2)))).toBe("ok");
		expect(code(l.join(B, lobby.lobbyId, ctx(3, { busy: [B] })))).toBe("busy");
		expect(code(l.join(B, lobby.lobbyId, ctx(4)))).toBe("ok");
		// Party invites count toward neither cap.
		const ids: number[] = [];
		for (let i = 1; i <= LOBBY.maxPlatformInvitesPerMember; i++) ids.push(2000 + i);
		const p = l.platformInvites(HOST, ids, ctx(4));
		expect(p.ok && p.invites.size()).toBe(LOBBY.maxPlatformInvitesPerMember);
	});

	it("refuses bad ids, non-members, self, players in a lobby, full / in-run lobbies, kicked and duplicates", () => {
		const l = lobbies();
		const lobby = create(l, HOST);
		create(l, C);
		expect(code(l.partyInvite(HOST, 1.5, ctx()))).toBe("badRequest");
		expect(code(l.partyInvite(STRANGER, A, ctx()))).toBe("notMember");
		expect(code(l.partyInvite(HOST, HOST, ctx()))).toBe("badRequest");
		expect(code(l.partyInvite(HOST, C, ctx()))).toBe("alreadyInLobby");
		expect(code(l.invite(HOST, A, ctx()))).toBe("ok");
		expect(code(l.partyInvite(HOST, A, ctx()))).toBe("alreadyInvited");
		join(l, B, lobby);
		l.kick(HOST, B, ctx(0));
		expect(code(l.partyInvite(HOST, B, ctx(1)))).toBe("kickCooldown");
		const full = create(l, 1);
		for (let id = 2; id <= LOBBY.maxSize; id++) join(l, id, full);
		expect(code(l.partyInvite(1, STRANGER, ctx()))).toBe("full");
		l.setReady(C, true);
		l.start(C, ctx(0));
		l.tick(ctx(LOBBY.countdownSeconds));
		expect(code(l.partyInvite(C, D, ctx(5)))).toBe("inRun");
	});
});

describe("UserId bounds (isWireUserId)", () => {
	it("nonzero integers of magnitude at most 2^53 - 1; Studio's negatives allowed", () => {
		expect(MAX_USER_ID_MAGNITUDE).toBe(9007199254740991); // check-asset-ids: allow (2^53 - 1)
		for (const ok of [1, -1, A, -MAX_USER_ID_MAGNITUDE, MAX_USER_ID_MAGNITUDE]) expect(isWireUserId(ok)).toBe(true);
		const bad: unknown[] = [0, 1.5, 1e300, -1e300, MAX_USER_ID_MAGNITUDE + 2, 1 / 0, 0 / 0, "1"];
		for (const v of bad) expect(isWireUserId(v)).toBe(false);
		expect(isWireUserId(undefined)).toBe(false);
	});

	it("every invite, kick and transfer refuses an unbounded id", () => {
		const l = lobbies();
		create(l, HOST);
		for (const bad of [0, 1e300, -1e300]) {
			expect(code(l.invite(HOST, bad, ctx()))).toBe("badRequest");
			expect(code(l.partyInvite(HOST, bad, ctx()))).toBe("badRequest");
			expect(code(l.platformInvites(HOST, [bad], ctx()))).toBe("badRequest");
			expect(code(l.kick(HOST, bad, ctx()))).toBe("badRequest");
			expect(code(l.transferHost(HOST, bad))).toBe("badRequest");
		}
		expect(code(l.invite(HOST, -2, ctx()))).toBe("ok"); // a Studio test player
	});
});
