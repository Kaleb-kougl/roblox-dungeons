// The menu shell's back stack and the lobby screens' view logic (tasks L3, L5, L6). String keys: hud.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import { LOBBY, LOBBY_NAMES, type LobbySummary } from "shared/lobby";
import type { LobbyInviteView, LobbyView } from "shared/network";
import { ARRIVAL_TOAST, type ArrivalToastKey } from "shared/invite";
import {
	LOBBY_BROWSER_PATH,
	LOBBY_REFUSALS,
	LOBBY_ROOM_PATH,
	LOBBY_STRINGS,
	MENU_STRINGS,
	NO_MENU,
	afterRunPath,
	arrivalToastKey,
	arrivedInviteShown,
	browserRows,
	canGoBack,
	countdownLeft,
	eligibilityDue,
	inviteCandidateKey,
	inviteCandidates,
	knownLobbyTitle,
	lobbyChangePath,
	lobbyErrorKey,
	lobbyRoomModel,
	lobbyStartAccepted,
	lobbyTitle,
	mainMenuLobbyKey,
	menuNavReduce,
	nextLobbyName,
	noticeSpec,
	pauseItems,
	platformInviteButton,
	receivedInvites,
	restartForfeits,
	partyRunOverLine,
	runOverExits,
	type MenuNav,
} from ".";

const nameOf = (id: number) => `P${id}`;

function view(over: Partial<LobbyView>): LobbyView {
	return {
		lobbyId: "L1",
		nameId: "hostDescent",
		hostId: 1,
		visibility: "open",
		worldKind: "endless",
		phase: "forming",
		members: [1],
		ready: [],
		invited: [],
		invitedSources: [],
		...over,
	};
}

function summary(over: Partial<LobbySummary>): LobbySummary {
	return {
		lobbyId: "L1",
		nameId: "chill",
		hostId: 1,
		count: 1,
		max: LOBBY.maxSize,
		visibility: "open",
		worldKind: "endless",
		phase: "forming",
		hasFriend: false,
		...over,
	};
}

describe("menu back stack", () => {
	it("opens, pushes, goes back and stops at the root", () => {
		let nav: MenuNav = NO_MENU;
		nav = menuNavReduce(nav, { kind: "open", screen: "main" });
		expect(nav).toEqual({ screen: "main", stack: [] });
		expect(canGoBack(nav)).toBe(false);
		nav = menuNavReduce(nav, { kind: "open", screen: "lobbies" });
		nav = menuNavReduce(nav, { kind: "open", screen: "lobby" });
		expect(nav).toEqual({ screen: "lobby", stack: ["main", "lobbies"] });
		expect(canGoBack(nav)).toBe(true);
		nav = menuNavReduce(nav, { kind: "back" });
		expect(nav).toEqual({ screen: "lobbies", stack: ["main"] });
		nav = menuNavReduce(nav, { kind: "back" });
		nav = menuNavReduce(nav, { kind: "back" });
		expect(nav).toEqual({ screen: "main", stack: [] });
		expect(menuNavReduce(NO_MENU, { kind: "back" })).toBe(NO_MENU);
	});

	it("opening a screen on the stack pops back to it; the same screen is a no-op", () => {
		const nav = menuNavReduce(NO_MENU, { kind: "reset", path: LOBBY_ROOM_PATH });
		expect(nav).toEqual({ screen: "lobby", stack: ["main", "lobbies"] });
		expect(menuNavReduce(nav, { kind: "open", screen: "main" })).toEqual({ screen: "main", stack: [] });
		expect(menuNavReduce(nav, { kind: "open", screen: "lobby" })).toBe(nav);
	});

	it("replace keeps the stack; close and reset([]) leave no menu", () => {
		const nav = menuNavReduce(NO_MENU, { kind: "reset", path: LOBBY_ROOM_PATH });
		expect(menuNavReduce(nav, { kind: "replace", screen: "lobbies" })).toEqual({
			screen: "lobbies",
			stack: ["main", "lobbies"],
		});
		expect(menuNavReduce(nav, { kind: "close" })).toEqual(NO_MENU);
		expect(menuNavReduce(nav, { kind: "reset", path: [] })).toEqual(NO_MENU);
		expect(menuNavReduce(nav, { kind: "open", screen: "none" })).toEqual(NO_MENU);
	});

	it("after a run: the lobby room while in a lobby, else the main menu", () => {
		expect(menuNavReduce(NO_MENU, { kind: "reset", path: afterRunPath(true) }).screen).toBe("lobby");
		expect(menuNavReduce(NO_MENU, { kind: "reset", path: afterRunPath(false) })).toEqual({
			screen: "main",
			stack: [],
		});
		expect([mainMenuLobbyKey(true), mainMenuLobbyKey(false)]).toEqual([
			MENU_STRINGS.yourLobby,
			MENU_STRINGS.lobbies,
		]);
	});
});

describe("lobby browser rows", () => {
	it("puts my lobby first, greys runs, and only enables Join for a free, forming lobby when not in one", () => {
		const list = [
			summary({ lobbyId: "A" }),
			summary({ lobbyId: "B", phase: "inRun" }),
			summary({ lobbyId: "C", count: LOBBY.maxSize }),
			summary({ lobbyId: "D", phase: "countdown", hasFriend: true, visibility: "friends" }),
		];
		const free = browserRows(list, undefined, nameOf);
		expect(free.map((r) => [r.lobbyId, r.canJoin, r.inRun, r.starting])).toEqual([
			["A", true, false, false],
			["B", false, true, false],
			["C", false, false, false],
			["D", false, false, true],
		]);
		expect(free[3].visibilityKey).toBe("lobby.visibility.friends");
		expect(free[3].hasFriend).toBe(true);
		expect(free[0].count).toEqual({ key: LOBBY_STRINGS.count, vars: { count: 1, max: LOBBY.maxSize } });
		const inC = browserRows(list, "C", nameOf);
		expect(inC.map((r) => [r.lobbyId, r.mine, r.canJoin])).toEqual([
			["C", true, false],
			["A", false, false],
			["B", false, false],
			["D", false, false],
		]);
	});

	it("names lobbies by preset with the host's name; Rename cycles the presets", () => {
		expect(lobbyTitle("hostDescent", 7, nameOf)).toEqual({ key: "lobby.name.hostDescent", vars: { host: "P7" } });
		expect(nextLobbyName("hostDescent")).toBe(LOBBY_NAMES[1]);
		expect(nextLobbyName(LOBBY_NAMES[LOBBY_NAMES.size() - 1])).toBe(LOBBY_NAMES[0]);
	});
});

describe("lobby room model", () => {
	it("host alone: Start solo run, enabled once ready", () => {
		const m = lobbyRoomModel(view({}), 1, nameOf, 0);
		expect([m.isHost, m.canStart, m.startKey, m.canEdit, m.status.key]).toEqual([
			true,
			false,
			LOBBY_STRINGS.startSolo,
			true,
			LOBBY_STRINGS.forming,
		]);
		const ready = lobbyRoomModel(view({ ready: [1] }), 1, nameOf, 0);
		expect([ready.canStart, ready.meReady, ready.status.key]).toEqual([true, true, LOBBY_STRINGS.allReady]);
	});

	it("Start needs everyone ready; host-only controls are off for members", () => {
		const v = view({ members: [1, 2, 3], ready: [1, 2] });
		const host = lobbyRoomModel(v, 1, nameOf, 0);
		expect([host.canStart, host.startKey]).toEqual([false, LOBBY_STRINGS.start]);
		expect(host.members.map((r) => [r.userId, r.host, r.ready, r.me, r.canKick, r.canMakeHost])).toEqual([
			[1, true, true, true, false, false],
			[2, false, true, false, true, true],
			[3, false, false, false, true, true],
		]);
		expect(lobbyRoomModel(view({ members: [1, 2, 3], ready: [1, 2, 3] }), 1, nameOf, 0).canStart).toBe(true);
		const member = lobbyRoomModel(v, 2, nameOf, 0);
		expect([member.isHost, member.canStart, member.canEdit, member.canReady]).toEqual([false, false, false, true]);
		expect(member.members.some((r) => r.canKick || r.canMakeHost)).toBe(false);
		expect(member.membersLine).toEqual({ key: LOBBY_STRINGS.members, vars: { count: 3, max: LOBBY.maxSize } });
	});

	it("countdown and run phases: status line, no Start, no Ready in a run", () => {
		const cd = lobbyRoomModel(view({ phase: "countdown", ready: [1], countdownIn: 3 }), 1, nameOf, 2);
		expect([cd.canStart, cd.canEdit, cd.status]).toEqual([
			false,
			false,
			{ key: LOBBY_STRINGS.countdown, vars: { seconds: 2 } },
		]);
		const run = lobbyRoomModel(view({ phase: "inRun", ready: [1] }), 1, nameOf, 0);
		expect([run.inRun, run.canReady, run.canInvite, run.status.key]).toEqual([
			true,
			false,
			false,
			LOBBY_STRINGS.runInProgress,
		]);
		expect([countdownLeft(3, 0), countdownLeft(3, 0.2), countdownLeft(3, 2.5), countdownLeft(3, 9)]).toEqual([
			3, 3, 1, 0,
		]);
		expect(countdownLeft(undefined, 0)).toBe(0);
	});
});

describe("invites", () => {
	it("lists server players outside the lobby by name, marking live invites", () => {
		const players = [
			{ userId: 1, name: "Me" },
			{ userId: 2, name: "zed" },
			{ userId: 3, name: "Amy" },
			{ userId: 4, name: "bob" },
		];
		const v = view({ members: [1, 4], invited: [2] });
		expect(inviteCandidates(players, v, 1, true)).toEqual([
			{ userId: 3, name: "Amy", invited: false, platform: false, here: true, canInvite: true },
			{ userId: 2, name: "zed", invited: true, platform: false, here: true, canInvite: false },
		]);
		expect(inviteCandidates(players, v, 1, false).some((c) => c.canInvite)).toBe(false);
		const full = lobbyRoomModel(
			view({ members: [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((_, i) => i < LOBBY.maxSize) }),
			1,
			nameOf,
			0,
		);
		expect(full.canInvite).toBe(false);
	});

	it("Roblox invitees read Invited (Roblox); those not in the server yet get their own invited rows", () => {
		const players = [
			{ userId: 1, name: "Me" },
			{ userId: 2, name: "Bea" },
			{ userId: 3, name: "Cal" },
			{ userId: 4, name: "Dee" },
		];
		// 2: server invite, 3: platform (here), 50: platform (not here), 4 party (here), 60 party (not here), 7 member.
		const v = view({
			members: [1, 7],
			invited: [2, 3, 50, 4, 60, 7],
			invitedSources: ["server", "platform", "platform", "party", "party", "platform"],
		});
		const rows = inviteCandidates(players, v, 1, true, nameOf);
		expect(rows).toEqual([
			{ userId: 2, name: "Bea", invited: true, platform: false, here: true, canInvite: false },
			{ userId: 3, name: "Cal", invited: true, platform: true, here: true, canInvite: false },
			{ userId: 4, name: "Dee", invited: true, platform: true, here: true, canInvite: false },
			{ userId: 50, name: "P50", invited: true, platform: true, here: false, canInvite: false },
			{ userId: 60, name: "P60", invited: true, platform: true, here: false, canInvite: false },
		]);
		expect(rows.map(inviteCandidateKey)).toEqual([
			LOBBY_STRINGS.invited,
			LOBBY_STRINGS.invitedPlatform,
			LOBBY_STRINGS.invitedPlatform,
			LOBBY_STRINGS.invitedPlatform,
			LOBBY_STRINGS.invitedPlatform,
		]);
		// Without a nameOf an absent invitee reads #<UserId>; a missing source counts as a server invite.
		expect(inviteCandidates([], view({ invited: [50], invitedSources: ["platform"] }), 1, true)[0].name).toBe(
			"#50",
		);
		expect(inviteCandidates([], view({ invited: [50], invitedSources: [] }), 1, true)).toEqual([]);
		expect(
			inviteCandidateKey({ userId: 9, name: "x", invited: false, platform: false, here: true, canInvite: true }),
		).toBe(LOBBY_STRINGS.inviteSend);
	});

	it("the Roblox invite buttons: disabled with the reason only when the server said no", () => {
		expect(platformInviteButton(undefined)).toEqual({ enabled: true });
		expect(platformInviteButton(true)).toEqual({ enabled: true });
		expect(platformInviteButton(false)).toEqual({
			enabled: false,
			reasonKey: LOBBY_STRINGS.invitePlatformUnavailable,
		});
		expect(platformInviteButton(true, false)).toEqual({ enabled: false });
		expect(platformInviteButton(undefined, false)).toEqual({ enabled: false });
		expect(platformInviteButton(false, false).reasonKey).toBe(LOBBY_STRINGS.invitePlatformUnavailable);
	});

	it("asks for eligibility at startup, then again only once the cached answer is old", () => {
		expect(eligibilityDue(undefined, 0, 300)).toBe(true);
		expect(eligibilityDue(10, 309, 300)).toBe(false);
		expect(eligibilityDue(10, 310, 300)).toBe(true);
	});

	it("the inviteArrived toast's Invite: in a lobby with room, the friend here, outside it and not invited", () => {
		const here = [
			{ userId: 1, name: "Me" },
			{ userId: 2, name: "Friend" },
		];
		const mine = view({ members: [1] });
		expect(arrivedInviteShown(2, mine, here, 1)).toBe(true);
		expect(arrivedInviteShown(2, undefined, here, 1)).toBe(false);
		expect(arrivedInviteShown(2, mine, [{ userId: 1, name: "Me" }], 1)).toBe(false); // left again
		expect(arrivedInviteShown(2, view({ members: [1, 2] }), here, 1)).toBe(false);
		expect(arrivedInviteShown(2, view({ invited: [2], invitedSources: ["server"] }), here, 1)).toBe(false);
		expect(arrivedInviteShown(2, view({ phase: "inRun" }), here, 1)).toBe(false);
		const full: number[] = [];
		for (let i = 0; i < LOBBY.maxSize; i++) full.push(100 + i);
		expect(arrivedInviteShown(2, view({ members: full }), here, 100)).toBe(false);
		expect(arrivedInviteShown(1, mine, here, 1)).toBe(false);
	});

	it("received invites drop when expired (counted from arrival) and cap at max", () => {
		const inv = (id: string, expiresIn: number): LobbyInviteView => ({
			inviteId: id,
			lobbyId: `L${id}`,
			nameId: "chill",
			hostId: 5,
			fromUserId: 6,
			expiresIn,
			source: "server",
		});
		const out = receivedInvites([inv("a", 10), inv("b", 2), inv("c", 30), inv("d", 30)], 3, nameOf, 2);
		expect(out.map((r) => r.inviteId)).toEqual(["a", "c"]);
		expect(out[0]).toEqual({
			inviteId: "a",
			lobbyId: "La",
			from: "P6",
			title: { key: "lobby.name.chill", vars: { host: "P5" } },
		});
	});
});

describe("notices, handoff and exits", () => {
	it("maps notices to toast lines (refusal codes to lobby.err.*)", () => {
		expect(noticeSpec({ kind: "refused", code: "full" }, nameOf)).toEqual({ key: "lobby.err.full" });
		expect(noticeSpec({ kind: "refused" }, nameOf)).toEqual({ key: "lobby.err.generic" });
		expect(noticeSpec({ kind: "kicked", lobbyId: "L" }, nameOf)).toEqual({ key: "lobby.notice.kicked" });
		expect(noticeSpec({ kind: "followed", userId: 9 }, nameOf)).toEqual({
			key: "lobby.notice.followed",
			vars: { name: "P9" },
		});
		expect(noticeSpec({ kind: "countdownCancelled", reason: "busy" }, nameOf)).toEqual({
			key: "lobby.notice.countdownCancelled",
			vars: { reason: "busy" },
		});
		for (const c of LOBBY_REFUSALS) expect(lobbyErrorKey(c)).toBe(`lobby.err.${c}`);
		expect(lobbyErrorKey("nonsense")).toBe("lobby.err.generic");
	});

	it("maps the Roblox invite notices (inviteArrived, partyLobby, arrival)", () => {
		expect(noticeSpec({ kind: "inviteArrived", userId: 9 }, nameOf)).toEqual({
			key: "lobby.notice.inviteArrived",
			vars: { name: "P9" },
			inviteUserId: 9,
		});
		expect(noticeSpec({ kind: "inviteArrived" }, nameOf)).toEqual({
			key: "lobby.notice.inviteArrived",
			vars: { name: "" },
		});
		const mine = view({ lobbyId: "L1", nameId: "chill", hostId: 5 });
		const list = [summary({ lobbyId: "L2", nameId: "quickRun", hostId: 6 })];
		const titleOf = (id: string | undefined) => knownLobbyTitle(id, mine, list, nameOf);
		expect(noticeSpec({ kind: "partyLobby", lobbyId: "L1", userId: 5 }, nameOf, titleOf)).toEqual({
			key: "lobby.notice.partyLobby",
			lobby: { key: "lobby.name.chill", vars: { host: "P5" } },
		});
		expect(noticeSpec({ kind: "partyLobby", lobbyId: "L2" }, nameOf, titleOf).lobby).toEqual({
			key: "lobby.name.quickRun",
			vars: { host: "P6" },
		});
		expect(noticeSpec({ kind: "partyLobby", lobbyId: "L9" }, nameOf, titleOf)).toEqual({
			key: LOBBY_STRINGS.noticePartyLobbyAny,
		});
		expect(noticeSpec({ kind: "partyLobby", lobbyId: "L1" }, nameOf)).toEqual({
			key: LOBBY_STRINGS.noticePartyLobbyAny,
		});
		expect(knownLobbyTitle(undefined, mine, list, nameOf)).toBe(undefined);
		for (const [, key] of pairs(ARRIVAL_TOAST as unknown as Map<string, string>)) {
			expect(noticeSpec({ kind: "arrival", key: key as ArrivalToastKey }, nameOf)).toEqual({ key });
			expect(arrivalToastKey(key)).toBe(key);
		}
		expect(noticeSpec({ kind: "arrival", key: ARRIVAL_TOAST.gone }, nameOf)).toEqual({
			key: "lobby.err.inviteGone",
		});
		expect(
			noticeSpec({ kind: "arrival", key: "lobby.err.nonsense" as unknown as ArrivalToastKey }, nameOf),
		).toEqual({
			key: "lobby.err.generic",
		});
		expect(noticeSpec({ kind: "arrival" }, nameOf)).toEqual({ key: "lobby.err.generic" });
	});

	it("moves the menu to the lobby room when a lobby appears, never off a no-menu state", () => {
		// Created / joined / put there by an invite or party arrival while on a menu screen: the room.
		for (const screen of ["main", "lobbies", "lobby"] as const) {
			expect(lobbyChangePath(screen, "L1", undefined)).toEqual(LOBBY_ROOM_PATH);
		}
		expect(lobbyChangePath("lobby", "L2", "L1")).toEqual(LOBBY_ROOM_PATH);
		// A run, the tutorial, the first-run wait: nothing moves (the menu after it opens the room).
		expect(lobbyChangePath("none", "L1", undefined)).toBe(undefined);
		expect(lobbyChangePath("none", undefined, "L1")).toBe(undefined);
		// Left / kicked: the browser from the room, nothing elsewhere.
		expect(lobbyChangePath("lobby", undefined, "L1")).toEqual(LOBBY_BROWSER_PATH);
		expect(lobbyChangePath("main", undefined, "L1")).toBe(undefined);
		expect(lobbyChangePath("lobbies", "L1", "L1")).toBe(undefined);
	});

	it("takes a run start only for my lobby", () => {
		expect(lobbyStartAccepted("L1", "L1")).toBe(true);
		expect(lobbyStartAccepted("L2", "L1")).toBe(false);
		expect(lobbyStartAccepted("L1", undefined)).toBe(false);
		expect(lobbyStartAccepted("", "")).toBe(false);
	});

	it("run-over exits, pause items and the forfeiting restart", () => {
		expect(runOverExits(false, false)).toEqual({ again: true, exitKey: MENU_STRINGS.mainMenu });
		expect(runOverExits(false, true)).toEqual({ again: true, exitKey: MENU_STRINGS.backToLobby });
		expect(runOverExits(true, true)).toEqual({ again: false, exitKey: MENU_STRINGS.backToLobby });
		// A party run: "the party is down", or the server's reason once it rejected THIS run (ended before the wipe).
		const down = { key: MENU_STRINGS.partyDown, reason: "" };
		expect(partyRunOverLine({ status: "pending", run: 3 }, 3)).toEqual(down);
		expect(partyRunOverLine({ status: "accepted", run: 3 }, 3)).toEqual(down);
		expect(partyRunOverLine({ status: "rejected", run: 2, code: "desync" }, 3)).toEqual(down); // another run's
		expect(
			partyRunOverLine({ status: "rejected", run: 3, code: "desync", reason: "desync at tick 60" }, 3),
		).toEqual({
			key: MENU_STRINGS.partyEnded,
			reason: "desync at tick 60",
		});
		expect(partyRunOverLine({ status: "rejected", run: 3, code: "expired" }, 3).reason).toBe("expired");
		expect(pauseItems(false)).toEqual(["resume", "restart", "leave", "settings", "leaderboards"]);
		expect(pauseItems(true)).toEqual(["resume", "leave", "settings", "leaderboards"]);
		expect(pauseItems(false, true)).toEqual(["resume", "restartTutorial", "skipTutorial", "settings"]);
		expect(pauseItems(false, false)).toEqual(pauseItems(false));
		expect(pauseItems(true, true)).toEqual(pauseItems(true)); // a party run is never a tutorial run
		expect([restartForfeits(true, true), restartForfeits(true, false), restartForfeits(false, true)]).toEqual([
			true,
			false,
			false,
		]);
	});

	it("on touch the co-op party overlay gains a Map item (docs/MOBILE.md MB10); solo and tutorial lists do not change", () => {
		expect(pauseItems(true, false, true)).toEqual(["resume", "map", "leave", "settings", "leaderboards"]);
		expect(pauseItems(false, false, true)).toEqual(pauseItems(false));
		expect(pauseItems(false, true, true)).toEqual(pauseItems(false, true));
	});
});
