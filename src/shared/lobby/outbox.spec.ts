// LobbyService's "who hears what" (LobbyOutbox), the wire views, and the lobby analytics specs, driven by a real
// Lobbies.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	COUNTDOWN_CANCELLED_MEMBER_LEFT,
	LOBBY,
	LOBBY_ANALYTICS_EVENT,
	Lobbies,
	LobbyOutbox,
	analyticsForInviteAnswered,
	analyticsForInviteArrival,
	analyticsForInviteSent,
	analyticsForLobbyCreated,
	analyticsForPartyGrouped,
	analyticsForLobbyStarted,
	inviteViewsOf,
	lobbyViewOf,
	type Lobby,
	type LobbyContext,
} from "shared/lobby";

const HOST = 11;
const A = 22;
const B = 33;
const C = 44;

function setup(): { l: Lobbies; o: LobbyOutbox; lookup: (id: string) => Lobby | undefined } {
	let ids = 0;
	const l = new Lobbies({ newId: () => `id-${++ids}` });
	const o = new LobbyOutbox();
	o.takeList(); // start clean
	return { l, o, lookup: (id) => l.get(id) };
}

function ctx(now = 0): LobbyContext {
	return { now, busyReason: () => undefined, areFriends: () => false };
}

function mustCreate(l: Lobbies, host: number): Lobby {
	const r = l.create(host, undefined, ctx());
	if (!r.ok) error(r.reason);
	return r.lobby;
}

function mustJoin(l: Lobbies, user: number, lobby: Lobby): void {
	const r = l.join(user, lobby.lobbyId, ctx());
	if (!r.ok) error(r.reason);
}

describe("lobby views", () => {
	it("lobbyViewOf: members, ready, invited (deduplicated) and countdown seconds left", () => {
		const { l } = setup();
		const lobby = mustCreate(l, HOST);
		mustJoin(l, A, lobby);
		l.invite(HOST, B, ctx(1));
		l.setReady(HOST, true);
		l.setReady(A, true);
		const forming = lobbyViewOf(lobby, l.invitesTo(lobby.lobbyId, 1), 1);
		expect(forming.members).toEqual([HOST, A]);
		expect(forming.invited).toEqual([B]);
		expect(forming.invitedSources).toEqual(["server"]);
		expect(forming.countdownIn).toBe(undefined);
		l.start(HOST, ctx(2));
		const counting = lobbyViewOf(lobby, [], 2.5);
		expect(counting.phase).toBe("countdown");
		expect(counting.countdownIn).toBe(LOBBY.countdownSeconds - 0.5);
		expect(lobbyViewOf(lobby, [], 100).countdownIn).toBe(0);
	});

	it("lobbyViewOf: each member's look for their pick, by index (docs/COSMETICS.md CS4); none given: default", () => {
		const { l } = setup();
		const lobby = mustCreate(l, HOST);
		mustJoin(l, A, lobby);
		mustJoin(l, B, lobby);
		l.setReady(A, true, "archer");
		const asked = new Array<string>();
		const v = lobbyViewOf(lobby, [], 0, (id, character) => {
			asked.push(`${id}:${character}`);
			return id === A
				? { dye: `dye.${character}.frost`, outline: "outline.jade" }
				: id === B
				? {}
				: { trail: "trail.ivory" };
		});
		expect(asked).toEqual([`${HOST}:knight`, `${A}:archer`, `${B}:knight`]);
		expect(v.looks).toEqual([{ trail: "trail.ivory" }, { dye: "dye.archer.frost", outline: "outline.jade" }, {}]);
		expect(lobbyViewOf(lobby, [], 0).looks).toEqual([{}, {}, {}]);
	});

	it("inviteViewsOf: lobby name and host, seconds left; invites to gone lobbies skipped", () => {
		const { l, lookup } = setup();
		const lobby = mustCreate(l, HOST);
		l.invite(HOST, B, ctx(0));
		const views = inviteViewsOf(l.invitesFor(B, 10), lookup, 10);
		expect(views.size()).toBe(1);
		expect(views[0].hostId).toBe(HOST);
		expect(views[0].fromUserId).toBe(HOST);
		expect(views[0].lobbyId).toBe(lobby.lobbyId);
		expect(views[0].expiresIn).toBe(LOBBY.inviteTimeoutSeconds - 10);
		expect(inviteViewsOf(l.invitesFor(B, 10), () => undefined, 10)).toEqual([]);
	});
});

describe("LobbyOutbox", () => {
	it("a changed lobby: each member once, ascending, and the lists go stale", () => {
		const { l, o } = setup();
		const lobby = mustCreate(l, B);
		mustJoin(l, A, lobby);
		o.lobby(lobby);
		o.lobby(lobby);
		expect(o.isListDirty()).toBe(true);
		const batch = o.take();
		expect(batch.state).toEqual([A, B]);
		expect(batch.invites).toEqual([]);
		expect(o.take().state).toEqual([]);
		expect(o.takeList()).toBe(true);
		expect(o.takeList()).toBe(false);
	});

	it("a new invite: the invitee's list and the members' state, not the browse lists", () => {
		const { l, o } = setup();
		const lobby = mustCreate(l, HOST);
		const r = l.invite(HOST, B, ctx());
		if (!r.ok) error(r.reason);
		o.invited(r.invite, lobby);
		const batch = o.take();
		expect(batch.invites).toEqual([B]);
		expect(batch.state).toEqual([HOST]);
		expect(o.isListDirty()).toBe(false);
	});

	it("kick: the kicked player hears it and gets an empty state; their invite to the lobby is dropped quietly", () => {
		const { l, o, lookup } = setup();
		const lobby = mustCreate(l, HOST);
		mustJoin(l, A, lobby);
		const r = l.kick(HOST, A, ctx());
		if (!r.ok) error(r.reason);
		o.departure(r.departure, true, lookup);
		const batch = o.take();
		expect(batch.state).toEqual([HOST, A]);
		expect(batch.notices).toEqual([{ userId: A, notice: { kind: "kicked", lobbyId: lobby.lobbyId } }]);
	});

	it("the host leaving: the new host hears hostChanged; a countdown cancel reaches everyone left", () => {
		const { l, o, lookup } = setup();
		const lobby = mustCreate(l, HOST);
		mustJoin(l, A, lobby);
		mustJoin(l, B, lobby);
		for (const id of [HOST, A, B]) l.setReady(id, true);
		l.start(HOST, ctx());
		const r = l.leave(HOST);
		if (!r.ok) error(r.reason);
		o.departure(r.departure, false, lookup);
		const batch = o.take();
		expect(batch.state).toEqual([HOST, A, B]);
		const kinds: string[] = [];
		for (const n of batch.notices) kinds.push(`${n.notice.kind}:${n.userId}`);
		expect(kinds).toEqual(["hostChanged:22", "countdownCancelled:22", "countdownCancelled:33"]);
		expect(batch.notices[1].notice.reason).toBe(COUNTDOWN_CANCELLED_MEMBER_LEFT);
	});

	it("the last member leaving: the lobby's invites are dropped with an inviteDropped notice", () => {
		const { l, o, lookup } = setup();
		const lobby = mustCreate(l, HOST);
		l.invite(HOST, B, ctx());
		const r = l.leave(HOST);
		if (!r.ok) error(r.reason);
		o.departure(r.departure, false, lookup);
		const batch = o.take();
		expect(batch.state).toEqual([HOST]);
		expect(batch.invites).toEqual([B]);
		expect(batch.notices).toEqual([{ userId: B, notice: { kind: "inviteDropped", lobbyId: lobby.lobbyId } }]);
	});

	it("tick: expired invites notify their invitees; the lobby's invited list refreshes", () => {
		const { l, o, lookup } = setup();
		const lobby = mustCreate(l, HOST);
		l.invite(HOST, C, ctx(0));
		o.tick(l.tick({ now: LOBBY.inviteTimeoutSeconds, busyReason: () => undefined }), lookup);
		const batch = o.take();
		expect(batch.invites).toEqual([C]);
		expect(batch.state).toEqual([HOST]);
		expect(batch.notices).toEqual([{ userId: C, notice: { kind: "inviteExpired", lobbyId: lobby.lobbyId } }]);
	});

	it("tick: a countdown cancelled because a member became busy tells every member why", () => {
		const { l, o, lookup } = setup();
		const lobby = mustCreate(l, HOST);
		mustJoin(l, A, lobby);
		l.setReady(HOST, true);
		l.setReady(A, true);
		l.start(HOST, ctx(0));
		const result = l.tick({ now: LOBBY.countdownSeconds, busyReason: (id) => (id === A ? "busy" : undefined) });
		expect(result.starts).toEqual([]);
		o.tick(result, lookup);
		const batch = o.take();
		expect(batch.state).toEqual([HOST, A]);
		expect(batch.notices.size()).toBe(2);
		expect(batch.notices[0].notice).toEqual({ kind: "countdownCancelled", lobbyId: lobby.lobbyId, reason: "busy" });
	});

	it("an invite the player dropped themselves (joining another lobby) is silent", () => {
		const { l, o, lookup } = setup();
		const first = mustCreate(l, HOST);
		l.invite(HOST, B, ctx());
		const second = mustCreate(l, A);
		const r = l.join(B, second.lobbyId, ctx());
		if (!r.ok) error(r.reason);
		o.lobby(r.lobby);
		o.droppedInvites(r.droppedInvites, lookup);
		const batch = o.take();
		expect(batch.notices).toEqual([]);
		expect(batch.invites).toEqual([B]);
		expect(batch.state).toEqual([HOST, A, B]); // HOST: the first lobby's invited list changed
		expect(l.invitesTo(first.lobbyId, 0)).toEqual([]);
	});

	it("refused: a notice to the requester only, with the request kind, code and reason", () => {
		const { l, o } = setup();
		const r = l.join(A, "nope", ctx());
		if (r.ok) error("joined a missing lobby");
		o.refused(A, "lobbyJoin", r);
		expect(o.take().notices).toEqual([
			{
				userId: A,
				notice: { kind: "refused", requestKind: "lobbyJoin", code: "unknownLobby", reason: r.reason },
			},
		]);
	});
});

describe("invite sources in the views", () => {
	it("lobbyViewOf pairs each invited player with its source; inviteViewsOf carries it", () => {
		const { l, lookup } = setup();
		const lobby = mustCreate(l, HOST);
		l.invite(HOST, B, ctx(0));
		l.platformInvites(HOST, [C, 1001], ctx(0));
		l.partyInvite(HOST, A, ctx(0));
		const v = lobbyViewOf(lobby, l.invitesTo(lobby.lobbyId, 0), 0);
		expect(v.invited).toEqual([B, C, 1001, A]);
		expect(v.invitedSources).toEqual(["server", "platform", "platform", "party"]);
		expect(inviteViewsOf(l.invitesFor(C, 0), lookup, 0)[0].source).toBe("platform");
		expect(inviteViewsOf(l.invitesFor(A, 0), lookup, 0)[0].source).toBe("party");
		expect(inviteViewsOf(l.invitesFor(B, 0), lookup, 0)[0].source).toBe("server");
		expect(inviteViewsOf(l.invitesFor(C, 0), lookup, 0)[0].expiresIn).toBe(LOBBY.platformInviteTimeoutSeconds);
	});
});

describe("lobby analytics", () => {
	it("event names and the fixed field values", () => {
		expect(analyticsForLobbyCreated("friends")).toEqual({
			kind: "custom",
			name: LOBBY_ANALYTICS_EVENT.lobbyCreated,
			value: 1,
			fields: { field01: "friends" },
		});
		const party = analyticsForLobbyStarted(3);
		expect(party.kind === "custom" && party.value === 3 && party.fields?.field01 === "party").toBe(true);
		const solo = analyticsForLobbyStarted(1);
		expect(solo.kind === "custom" && solo.fields?.field01 === "solo").toBe(true);
		const expired = analyticsForInviteAnswered("expire");
		expect(expired.kind === "custom" && expired.name === LOBBY_ANALYTICS_EVENT.inviteAnswered).toBe(true);
		expect(expired.fields?.field01).toBe("expire");
	});

	it("invite sent: source and recipient count; arrival outcome and kind; party grouped size and how", () => {
		expect(analyticsForInviteSent("server", 1)).toEqual({
			kind: "custom",
			name: LOBBY_ANALYTICS_EVENT.inviteSent,
			value: 1,
			fields: { field01: "server" },
		});
		expect(analyticsForInviteSent("platform", 3)).toEqual({
			kind: "custom",
			name: "LobbyInviteSent",
			value: 3,
			fields: { field01: "platform" },
		});
		expect(analyticsForInviteArrival("followedClosed", "lobby")).toEqual({
			kind: "custom",
			name: "InviteArrival",
			value: 1,
			fields: { field01: "followedClosed", field02: "lobby" },
		});
		expect(analyticsForPartyGrouped(3, "created")).toEqual({
			kind: "custom",
			name: "PartyGrouped",
			value: 3,
			fields: { field01: "created" },
		});
		expect(LOBBY_ANALYTICS_EVENT.inviteArrival).toBe("InviteArrival");
		expect(LOBBY_ANALYTICS_EVENT.partyGrouped).toBe("PartyGrouped");
	});
});
