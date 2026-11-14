// docs/SILVER.md SV17: the Archer unlock in lobbies. With an ownership predicate (the server's wallet) a member cannot
// Ready as a character they do not own (`lockedCharacter`, nothing changes), an un-ready always goes through, a Start
// with an unowned pick is refused, and a due countdown whose member lost ownership is cancelled with a reason; a buyer
// passes; the Knight is always owned; no predicate = every character owned (today's behaviour).
import { describe, expect, it } from "@rbxts/jest-globals";
import type { CharacterId } from "shared/characters";
import {
	LOBBY,
	Lobbies,
	lockedPickReason,
	memberCharacter,
	type Lobby,
	type LobbyContext,
	type LobbyRefusal,
	type OwnsCharacter,
} from "shared/lobby";

const HOST = 11;
const A = 22;

/** Players who own the Archer (mutable per test). */
function wallet(owners: number[]): OwnsCharacter {
	return (id, c) => c === "knight" || owners.includes(id);
}

function ctx(now: number, owns?: OwnsCharacter): LobbyContext {
	return { now, busyReason: () => undefined, areFriends: () => true, ownsCharacter: owns };
}

function code(r: { ok: true } | { ok: false; code: LobbyRefusal }): LobbyRefusal | "ok" {
	return r.ok ? "ok" : r.code;
}

function setup(owners: number[]): { l: Lobbies; lobby: Lobby; owns: OwnsCharacter } {
	let ids = 0;
	const l = new Lobbies({ newId: () => `id-${++ids}` });
	const owns = wallet(owners);
	const made = l.create(HOST, undefined, ctx(0, owns));
	if (!made.ok) error(made.reason);
	expect(code(l.join(A, made.lobby.lobbyId, ctx(0, owns)))).toBe("ok");
	return { l, lobby: made.lobby, owns };
}

describe("lobby Ready and the Archer unlock (SV17)", () => {
	it("readying as an unowned Archer is lockedCharacter and changes nothing; as the Knight it passes", () => {
		const { l, lobby, owns } = setup([]);
		const r = l.setReady(A, true, "archer", owns);
		expect(code(r)).toBe("lockedCharacter");
		expect(lobby.ready.includes(A)).toBe(false);
		expect(memberCharacter(lobby, A)).toBe("knight");
		expect(code(l.setReady(A, true, "knight", owns))).toBe("ok");
		expect(lobby.ready.includes(A)).toBe(true);
	});

	it("a buyer readies as the Archer", () => {
		const { l, lobby, owns } = setup([A]);
		expect(code(l.setReady(A, true, "archer", owns))).toBe("ok");
		expect(memberCharacter(lobby, A)).toBe("archer");
		expect(code(l.setReady(HOST, true, "archer", owns))).toBe("lockedCharacter");
	});

	it("an un-ready always goes through; an unowned pick sent with it is not stored", () => {
		const { l, lobby, owns } = setup([]);
		l.setReady(A, true, "knight", owns);
		const r = l.setReady(A, false, "archer", owns);
		expect(code(r)).toBe("ok");
		expect(r.ok && r.pickChanged).toBe(false);
		expect(lobby.ready.includes(A)).toBe(false);
		expect(memberCharacter(lobby, A)).toBe("knight");
	});

	it("readying with no pick sent checks the stored pick (a wallet that turned unknown)", () => {
		const owners = [A];
		const { l, lobby } = setup(owners);
		const owns = wallet(owners);
		l.setReady(A, true, "archer", owns);
		l.setReady(A, false, undefined, owns);
		owners.clear(); // the wallet now owns the Knight only
		expect(code(l.setReady(A, true, undefined, owns))).toBe("lockedCharacter");
		expect(lobby.ready.includes(A)).toBe(false);
		expect(code(l.setReady(A, true, "knight", owns))).toBe("ok");
	});

	it("no predicate: every character is owned (today's behaviour)", () => {
		const { l, lobby } = setup([]);
		expect(code(l.setReady(A, true, "archer"))).toBe("ok");
		expect(memberCharacter(lobby, A)).toBe("archer");
		expect(lockedPickReason(lobby, undefined)).toBe(undefined);
	});
});

describe("lobby Start and the countdown re-check (SV17)", () => {
	it("a Start with a member whose pick is no longer owned is refused", () => {
		const owners = [A];
		const { l, owns } = setup(owners);
		l.setReady(HOST, true, "knight", owns);
		l.setReady(A, true, "archer", owns);
		owners.clear();
		expect(code(l.start(HOST, ctx(0, owns)))).toBe("lockedCharacter");
		owners.push(A);
		expect(code(l.start(HOST, ctx(0, owns)))).toBe("ok");
	});

	it("a countdown whose member lost ownership is cancelled at its end, with a reason; the lobby is forming", () => {
		const owners = [A];
		const { l, lobby, owns } = setup(owners);
		l.setReady(HOST, true, "knight", owns);
		l.setReady(A, true, "archer", owns);
		expect(code(l.start(HOST, ctx(0, owns)))).toBe("ok");
		owners.clear();
		const result = l.tick(ctx(LOBBY.countdownSeconds, owns));
		expect(result.starts).toEqual([]);
		expect(result.cancelled.size()).toBe(1);
		const [c] = result.cancelled;
		expect(c.cause).toBe("lockedCharacter");
		expect(c.reason).toBe(`player ${A} has not unlocked archer`);
		expect(lobby.phase).toBe("forming");
	});

	it("an owned party starts with its picks; the Knight is never asked", () => {
		const asked: Array<[number, CharacterId]> = [];
		const owns: OwnsCharacter = (id, c) => {
			asked.push([id, c]);
			return true;
		};
		const { l, lobby } = setup([]);
		l.setReady(HOST, true, "knight", owns);
		l.setReady(A, true, "archer", owns);
		l.start(HOST, ctx(0, owns));
		const [start] = l.tick(ctx(LOBBY.countdownSeconds, owns)).starts;
		expect(start !== undefined && start.kind === "party" ? start.characters : undefined).toEqual([
			"knight",
			"archer",
		]);
		expect(lobby.phase).toBe("inRun");
		for (const [, c] of asked) expect(c).toBe("archer");
	});
});
