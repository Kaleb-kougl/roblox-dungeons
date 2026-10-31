// LobbyRunTracker: which lobby a run belongs to and when that lobby's run ends (party, solo binding, timeout, leave).
import { describe, expect, it } from "@rbxts/jest-globals";
import { LOBBY_SERVICE, LobbyRunTracker } from "shared/lobby";

describe("LobbyRunTracker", () => {
	it("a party run ends its lobby run when it concludes, once", () => {
		const t = new LobbyRunTracker();
		t.party("run-1", "lobby-A");
		expect(t.lobbyOfRun("run-1")).toBe("lobby-A");
		expect(t.concluded("run-2")).toBe(undefined);
		expect(t.concluded("run-1")).toBe("lobby-A");
		expect(t.concluded("run-1")).toBe(undefined);
		expect(t.size()).toBe(0);
	});

	it("a party member leaving the server does not end the party's lobby run", () => {
		const t = new LobbyRunTracker();
		t.party("run-1", "lobby-A");
		expect(t.playerRemoving(7)).toEqual([]);
		expect(t.lobbyOfRun("run-1")).toBe("lobby-A");
	});

	it("solo: the player's next start is bound; its conclusion ends the lobby run", () => {
		const t = new LobbyRunTracker();
		t.expectSolo(7, "lobby-A", 0);
		expect(t.hasPending()).toBe(true);
		expect(t.soloStarted(8, "other")).toBe(undefined); // another player's start
		expect(t.soloStarted(7, "run-1")).toBe("lobby-A");
		expect(t.hasPending()).toBe(false);
		expect(t.soloStarted(7, "run-2")).toBe(undefined); // only the first start is the lobby's
		expect(t.concluded("run-2")).toBe(undefined);
		expect(t.concluded("run-1")).toBe("lobby-A");
		expect(t.playerRemoving(7)).toEqual([]); // already over
	});

	it("solo: only a start in the lobby's world is bound (a daily lobby waits for a daily start)", () => {
		const t = new LobbyRunTracker();
		t.expectSolo(7, "lobby-D", 0, "daily");
		expect(t.soloStarted(7, "run-endless", "endless")).toBe(undefined);
		expect(t.hasPending()).toBe(true);
		expect(t.soloStarted(7, "run-daily", "daily")).toBe("lobby-D");
		expect(t.concluded("run-daily")).toBe("lobby-D");
		// The default world is endless (LOBBY.defaultWorld).
		t.expectSolo(8, "lobby-E", 0);
		expect(t.soloStarted(8, "run-daily-8", "daily")).toBe(undefined);
		expect(t.soloStarted(8, "run-8", "endless")).toBe("lobby-E");
	});

	it("solo: no start within soloStartTimeoutSeconds ends it (sweep, UserId order)", () => {
		const t = new LobbyRunTracker();
		t.expectSolo(9, "lobby-B", 0);
		t.expectSolo(7, "lobby-A", 0);
		t.expectSolo(8, "lobby-C", 5);
		expect(t.sweep(LOBBY_SERVICE.soloStartTimeoutSeconds - 0.5)).toEqual([]);
		expect(t.sweep(LOBBY_SERVICE.soloStartTimeoutSeconds)).toEqual(["lobby-A", "lobby-B"]);
		expect(t.sweep(LOBBY_SERVICE.soloStartTimeoutSeconds + 5)).toEqual(["lobby-C"]);
		expect(t.hasPending()).toBe(false);
		expect(t.soloStarted(7, "run-1")).toBe(undefined);
	});

	it("solo: the player leaving ends a pending or bound lobby run", () => {
		const t = new LobbyRunTracker(10);
		t.expectSolo(7, "lobby-A", 0);
		expect(t.playerRemoving(7)).toEqual(["lobby-A"]);
		t.expectSolo(8, "lobby-B", 0);
		t.soloStarted(8, "run-8");
		expect(t.playerRemoving(8)).toEqual(["lobby-B"]);
		expect(t.concluded("run-8")).toBe(undefined);
		expect(t.size()).toBe(0);
	});

	it("a second solo request replaces the first and reports the replaced lobby", () => {
		const t = new LobbyRunTracker();
		expect(t.expectSolo(7, "lobby-A", 0)).toBe(undefined);
		expect(t.expectSolo(7, "lobby-A", 1)).toBe(undefined); // same lobby: nothing ended
		expect(t.expectSolo(7, "lobby-B", 2)).toBe("lobby-A");
		expect(t.soloStarted(7, "run-1")).toBe("lobby-B");
	});
});
