// The LaunchData codec: round trips, the 200-char limit, and every malformed string decoding to undefined.
import { describe, expect, it } from "@rbxts/jest-globals";
import { LOBBY } from "shared/lobby";
import { INVITE, INVITE_LAUNCH_FORMAT, decodeInviteLaunch, encodeInviteLaunch, type InviteLaunch } from "shared/invite";

const GUID = "{0B3D5E2A-1C4F-4A8B-9D6E-7F1A2B3C4D5E}";
/** The longest UserId the format writes (15 nines). */
const MAX_ID = tonumber(string.rep("9", INVITE_LAUNCH_FORMAT.maxUserIdDigits)) as number;

function thrown(f: () => unknown): string | undefined {
	const [ok, err] = pcall(f);
	return ok ? undefined : tostring(err);
}

describe("invite config", () => {
	it("LaunchData limit, waits and the party lobby visibility", () => {
		expect(INVITE.launchDataMaxChars).toBe(200);
		expect(INVITE.launchDataWaitSeconds >= INVITE.launchDataPollSeconds).toBe(true);
		expect(INVITE.partyLobbyVisibility).toBe("closed");
		expect(LOBBY.maxPlatformInvitesPerMember).toBe(20);
		expect(LOBBY.platformInviteTimeoutSeconds).toBe(900);
	});
});

describe("encodeInviteLaunch / decodeInviteLaunch", () => {
	it("round trips both kinds in the documented text format", () => {
		const lobby: InviteLaunch = { kind: "lobby", lobbyId: GUID, fromUserId: 12345 };
		const menu: InviteLaunch = { kind: "game", fromUserId: 678 };
		expect(encodeInviteLaunch(lobby)).toBe(`kv1|l|${GUID}|12345`);
		expect(encodeInviteLaunch(menu)).toBe("kv1|g|678");
		expect(decodeInviteLaunch(encodeInviteLaunch(lobby))).toEqual(lobby);
		expect(decodeInviteLaunch(encodeInviteLaunch(menu))).toEqual(menu);
		expect(decodeInviteLaunch("kv1|g|0")).toEqual({ kind: "game", fromUserId: 0 });
	});

	it("the longest lobby id and UserId stay well under the limit", () => {
		const longest: InviteLaunch = { kind: "lobby", lobbyId: string.rep("x", LOBBY.maxIdChars), fromUserId: MAX_ID };
		const text = encodeInviteLaunch(longest);
		expect(text.size() <= INVITE.launchDataMaxChars).toBe(true);
		expect(decodeInviteLaunch(text)).toEqual(longest);
		// A GUID lobby id: at most 60 chars even with a 15-digit UserId (docs/INVITES.md §1).
		expect(encodeInviteLaunch({ kind: "lobby", lobbyId: GUID, fromUserId: MAX_ID }).size() <= 60).toBe(true);
	});

	it("encode refuses a malformed launch (a server bug) with a plain message", () => {
		const bad: InviteLaunch[] = [
			{ kind: "lobby", lobbyId: "", fromUserId: 1 },
			{ kind: "lobby", lobbyId: "a|b", fromUserId: 1 },
			{ kind: "lobby", lobbyId: string.rep("x", LOBBY.maxIdChars + 1), fromUserId: 1 },
			{ kind: "game", fromUserId: 1.5 },
			{ kind: "game", fromUserId: -3 },
			{ kind: "game", fromUserId: MAX_ID + 1 },
			{ kind: "game", fromUserId: 0 / 0 },
			{ kind: "game", fromUserId: math.huge },
		];
		for (const l of bad) {
			const err = thrown(() => encodeInviteLaunch(l));
			expect(err !== undefined && err.sub(1, "encodeInviteLaunch".size()) === "encodeInviteLaunch").toBe(true);
		}
	});

	it("garbage, a wrong version, bad shapes and extra fields decode to undefined", () => {
		expect(decodeInviteLaunch(undefined)).toBe(undefined);
		const bad: defined[] = [
			5,
			{},
			"",
			"hello",
			"kv1",
			"kv1|",
			"kv2|g|1",
			"KV1|g|1",
			"kv1|x|1",
			"kv1|g|",
			"kv1|g|1|2", // extra field
			"kv1|l|L1", // missing field
			"kv1|l|L1|2|3", // extra field
			"kv1|l||2", // empty lobby id
			`kv1|l|${string.rep("x", LOBBY.maxIdChars + 1)}|2`,
			"kv1|g|-1", // negative (live)
			"kv1|g|1.5",
			"kv1|g|1e3",
			"kv1|g|0x10",
			"kv1|g| 12",
			"kv1|g|12 ",
			"kv1|g|+12",
			"kv1|g|012", // leading zero: not the one spelling
			`kv1|g|${string.rep("9", INVITE_LAUNCH_FORMAT.maxUserIdDigits + 1)}`,
			"kv1|g|inf",
			"kv1|g|nan",
		];
		for (const s of bad) expect(decodeInviteLaunch(s)).toBe(undefined);
	});

	it("over-long input decodes to undefined (never split)", () => {
		const tail = string.rep("x", INVITE.launchDataMaxChars);
		expect(decodeInviteLaunch(`kv1|g|1${tail}`)).toBe(undefined);
		expect(decodeInviteLaunch(string.rep("|", INVITE.launchDataMaxChars + 1))).toBe(undefined);
	});

	it("never throws, whatever the bytes", () => {
		const samples: defined[] = ["\0", "kv1|l|\0|1", "kv1|l|%d|1", "kv1|g|%", string.rep("kv1|", 50), true];
		for (let b = 0; b <= 255; b++) samples.push(`kv1|g|${string.char(b)}`, `kv1|l|${string.char(b)}|1`);
		for (const s of samples) expect(thrown(() => decodeInviteLaunch(s))).toBe(undefined);
		// Non-separator bytes are fine in a lobby id; it is only a hint, arrival.ts checks it against real lobbies.
		expect(decodeInviteLaunch("kv1|l|%d|1")).toEqual({ kind: "lobby", lobbyId: "%d", fromUserId: 1 });
	});

	it("Studio option: negative test-player ids round trip; -0 and '-' alone do not decode", () => {
		const studio = { allowNegativeUserIds: true };
		const l: InviteLaunch = { kind: "lobby", lobbyId: "L1", fromUserId: -2 };
		expect(encodeInviteLaunch(l, studio)).toBe("kv1|l|L1|-2");
		expect(decodeInviteLaunch("kv1|l|L1|-2", studio)).toEqual(l);
		expect(decodeInviteLaunch("kv1|l|L1|-2")).toBe(undefined);
		expect(decodeInviteLaunch("kv1|g|-0", studio)).toBe(undefined);
		expect(decodeInviteLaunch("kv1|g|-", studio)).toBe(undefined);
		expect(decodeInviteLaunch("kv1|g|--1", studio)).toBe(undefined);
		expect(decodeInviteLaunch("kv1|g|7", studio)).toEqual({ kind: "game", fromUserId: 7 });
	});
});
