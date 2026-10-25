// Co-op consent (M4): a party run needs every member's accept; declines, expiry, leaving and busy members close or
// refuse an invite; the registry only starts a party from an accepted invite (runSessions.spec.ts covers that side).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_RUN_SESSION_LIMITS,
	PARTY_INVITE_TTL_SECONDS,
	PartyInvites,
	type PartyInviteContext,
	type PartyInviteRequest,
} from "shared/run";

const HOST = 11;
const A = 22;
const B = 33;
const STRANGER = 99;

function invites(): PartyInvites {
	let ids = 0;
	return new PartyInvites({
		newId: () => `inv-${++ids}`,
		ttlSeconds: PARTY_INVITE_TTL_SECONDS,
		limits: DEFAULT_RUN_SESSION_LIMITS,
	});
}

function ctx(now = 0, busy: number[] = []): PartyInviteContext {
	return {
		now,
		isInServer: (id) => id !== STRANGER,
		busyReason: (id) => (busy.includes(id) ? `player ${id} is busy` : undefined),
	};
}

const REQ: PartyInviteRequest = { requestId: 1, worldKind: "endless", members: [A, B] };

describe("PartyInvites", () => {
	it("is ready only once EVERY member accepted (the host counts from the start)", () => {
		const inv = invites();
		const r = inv.invite(HOST, REQ, ctx());
		if (!r.ok) error(r.reason);
		const id = r.invite.inviteId;
		expect(r.invite.members).toEqual([HOST, A, B]);
		expect(r.invite.accepted).toEqual([HOST]);
		expect(r.invite.status).toBe("pending");
		const a = inv.respond(A, id, true, ctx(1));
		expect(a.ok && a.invite.status).toBe("pending");
		const again = inv.respond(A, id, true, ctx(2)); // idempotent
		expect(again.ok && again.invite.accepted).toEqual([HOST, A]);
		const b = inv.respond(B, id, true, ctx(3));
		expect(b.ok && b.invite.status).toBe("ready");
		expect(inv.started(id)).toEqual([]);
		expect(inv.get(id)).toBe(undefined);
	});

	it("refuses bad requests, strangers, a party of one and busy members", () => {
		const inv = invites();
		const code = (req: unknown, c = ctx()) => {
			const r = inv.invite(HOST, req as PartyInviteRequest, c);
			return r.ok ? "ok" : r.code;
		};
		expect(code("x")).toBe("bad_request");
		expect(code({ requestId: 1, worldKind: "nowhere", members: [A] })).toBe("unknown_world");
		expect(code({ ...REQ, members: [STRANGER] })).toBe("bad_party");
		expect(code({ ...REQ, members: [] })).toBe("bad_party");
		expect(code({ ...REQ, members: [HOST] })).toBe("bad_party");
		expect(code(REQ, ctx(0, [B]))).toBe("busy");
		expect(code(REQ, ctx(0, [HOST]))).toBe("busy");
		expect(code(REQ)).toBe("ok");
	});

	it("a decline cancels it for everyone; only invited non-host members can answer", () => {
		const inv = invites();
		const r = inv.invite(HOST, REQ, ctx());
		if (!r.ok) error(r.reason);
		const id = r.invite.inviteId;
		const stranger = inv.respond(STRANGER, id, true, ctx());
		expect(stranger.ok ? "ok" : stranger.code).toBe("not_invited");
		const host = inv.respond(HOST, id, true, ctx());
		expect(host.ok ? "ok" : host.code).toBe("not_invited");
		const unknown = inv.respond(A, "nope", true, ctx());
		expect(unknown.ok ? "ok" : unknown.code).toBe("not_invited");
		inv.respond(A, id, true, ctx());
		const d = inv.respond(B, id, false, ctx());
		expect(d.ok && d.invite.status).toBe("declined");
		expect(d.ok && d.invite.reason).toBe(`declined by ${B}`);
		const late = inv.respond(A, id, true, ctx());
		expect(late.ok ? "ok" : late.code).toBe("not_invited"); // gone
	});

	it("a busy member's accept is refused (the invite stays open) until they are free", () => {
		const inv = invites();
		const r = inv.invite(HOST, REQ, ctx());
		if (!r.ok) error(r.reason);
		const id = r.invite.inviteId;
		const busy = inv.respond(A, id, true, ctx(1, [A]));
		expect(busy.ok ? "ok" : busy.code).toBe("busy");
		expect(inv.get(id)?.status).toBe("pending");
		expect(inv.respond(A, id, true, ctx(2)).ok).toBe(true);
	});

	it("expires (sweep, or an answer after the deadline); a player leaving cancels every invite naming them", () => {
		const inv = invites();
		const r = inv.invite(HOST, REQ, ctx(0));
		if (!r.ok) error(r.reason);
		const late = inv.respond(A, r.invite.inviteId, true, ctx(PARTY_INVITE_TTL_SECONDS));
		expect(late.ok ? "ok" : late.code).toBe("closed");
		expect(late.ok ? "" : late.invite?.status).toBe("expired");
		const s = inv.invite(HOST, REQ, ctx(100));
		if (!s.ok) error(s.reason);
		expect(inv.sweep(100 + PARTY_INVITE_TTL_SECONDS - 1)).toEqual([]);
		expect(inv.sweep(100 + PARTY_INVITE_TTL_SECONDS).map((x) => x.status)).toEqual(["expired"]);
		const t = inv.invite(HOST, REQ, ctx(200));
		if (!t.ok) error(t.reason);
		expect(inv.removePlayer(B).map((x) => [x.inviteId, x.status])).toEqual([[t.invite.inviteId, "cancelled"]]);
		expect(inv.size()).toBe(0);
	});

	it("a new invite replaces the host's pending one; a started party cancels other invites naming its members", () => {
		const inv = invites();
		const first = inv.invite(HOST, REQ, ctx());
		const second = inv.invite(HOST, { ...REQ, members: [A] }, ctx());
		if (!first.ok || !second.ok) error("invite failed");
		expect(second.replaced).toBe(first.invite);
		expect(first.invite.status).toBe("cancelled");
		const other = inv.invite(B, { ...REQ, members: [A] }, ctx());
		if (!other.ok) error(other.reason);
		inv.respond(A, second.invite.inviteId, true, ctx());
		expect(inv.get(second.invite.inviteId)?.status).toBe("ready");
		const cancelled = inv.started(second.invite.inviteId);
		expect(cancelled.map((x) => x.inviteId)).toEqual([other.invite.inviteId]);
		expect(other.invite.status).toBe("cancelled");
	});
});
