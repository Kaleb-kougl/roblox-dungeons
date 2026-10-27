/**
 * Lobby tunables and the preset vocabularies (visibility, phase, name ids). Data only: lobbies.ts and the server
 * service read these (CLAUDE.md "No magic numbers"). Display strings for the name ids come from shared/theme later.
 */
import { MAX_PARTY_SIZE, isFiniteValue } from "shared/run";

export interface LobbyConfig {
	/** Most members in one lobby: the largest party a run accepts (shared/run limits.ts, the sim's partyData.ts). */
	readonly maxSize: number;
	/** Pending (live) in-server invites one player may have sent at once, across lobbies (`invite`, source "server"). */
	readonly maxInvitesPerMember: number;
	/** An in-server invite expires this long after it was sent. */
	readonly inviteTimeoutSeconds: number;
	/**
	 * Pending (live) platform invites (Roblox's invite prompt, `platformInvites`, source "platform") one player may
	 * have sent at once, counted apart from `maxInvitesPerMember`; also the longest recipient list one call takes
	 * (docs/INVITES.md ID3).
	 */
	readonly maxPlatformInvitesPerMember: number;
	/** A platform or party invite expires this long after it was sent (Roblox notifications are read late). */
	readonly platformInviteTimeoutSeconds: number;
	/** After a kick, no member may re-invite the kicked player (and they may not rejoin) for this long. */
	readonly kickCooldownSeconds: number;
	/** The host's start begins a countdown of this long before the run starts. */
	readonly countdownSeconds: number;
	/** Visibility of a new lobby when the create request names none. */
	readonly defaultVisibility: LobbyVisibility;
	/** Longest lobby id accepted on the wire (server GUIDs are 36). */
	readonly maxIdChars: number;
}

/**
 * Who sees and may join a lobby (canAccess, lobbies.ts):
 *   open     listed for everyone, anyone may join
 *   friends  listed for and joinable by the HOST's friends only
 *   closed   never listed; the only way in is an invite
 */
export type LobbyVisibility = "open" | "friends" | "closed";
export const LOBBY_VISIBILITIES: ReadonlyArray<LobbyVisibility> = ["open", "friends", "closed"];

/**
 * Where a lobby invite came from (docs/INVITES.md):
 *   server    `invite`: a member picked a player in this server (the lobby's invite list)
 *   platform  `platformInvites`: a member sent it through Roblox's invite prompt; the player may not be here yet
 *   party     `partyInvite`: the server made it for a Roblox Party mate (shared/invite arrival.ts)
 */
export type LobbyInviteSource = "server" | "platform" | "party";
export const LOBBY_INVITE_SOURCES: ReadonlyArray<LobbyInviteSource> = ["server", "platform", "party"];

/** forming: members join, ready up and leave. countdown: the host started. inRun: the members are in the run. */
export type LobbyPhase = "forming" | "countdown" | "inRun";

/** Preset lobby name ids (no free text). `hostDescent` reads "<Host>'s descent". */
export const LOBBY_NAMES = [
	"hostDescent",
	"chill",
	"pushingDeep",
	"bossPractice",
	"newPlayers",
	"scoreChasing",
	"friendsOnly",
	"quickRun",
] as const;
export type LobbyNameId = (typeof LOBBY_NAMES)[number];

/** A new lobby's name. */
export const DEFAULT_LOBBY_NAME: LobbyNameId = "hostDescent";

export const LOBBY: LobbyConfig = table.freeze({
	maxSize: MAX_PARTY_SIZE,
	maxInvitesPerMember: 4,
	inviteTimeoutSeconds: 60,
	maxPlatformInvitesPerMember: 20,
	platformInviteTimeoutSeconds: 900,
	kickCooldownSeconds: 60,
	countdownSeconds: 3,
	defaultVisibility: "open" as LobbyVisibility,
	maxIdChars: 64,
});

/** LobbyService's pacing (server). */
export interface LobbyServiceConfig {
	/** `Lobbies.tick` cadence: countdowns end and invites expire within this of their time. */
	readonly tickSeconds: number;
	/** `lobbyList` pushes are coalesced: at most one round every this long (~2 per second) while lobbies change. */
	readonly listPushSeconds: number;
	/**
	 * A solo lobby run: after `lobbyRunStart` the client must start its ranked run (`startRun`) within this long, or
	 * the lobby goes back to `forming` (runTracker.ts).
	 */
	readonly soloStartTimeoutSeconds: number;
}

export const LOBBY_SERVICE: LobbyServiceConfig = table.freeze({
	tickSeconds: 0.25,
	listPushSeconds: 0.5,
	soloStartTimeoutSeconds: 30,
});

/** Per player: every lobby request except invites and list requests (sliding window; over it: `rateLimited`). */
export const LOBBY_REQUEST_RATE = table.freeze({ count: 20, windowSeconds: 10 });
/** Per player: `lobbyInvite` calls (a budget of its own: invites reach other players). */
export const LOBBY_INVITE_RATE = table.freeze({ count: 10, windowSeconds: 60 });
/** Per player: `lobbyRequestList` calls (extra calls are dropped quietly: the list is pushed anyway). */
export const LOBBY_LIST_REQUEST_RATE = table.freeze({ count: 10, windowSeconds: 10 });

/** FriendCache tunables (friendCache.ts). */
export interface FriendCacheConfig {
	/** A known answer is fetched again (in the background; the old answer is served meanwhile) after this long. */
	readonly refreshSeconds: number;
	/** A failed fetch (the web call errored) counts as "not friends" and is retried after this long. */
	readonly retrySeconds: number;
	/** Fetches in flight at once (Player:IsFriendsWith is a web call). */
	readonly maxConcurrentFetches: number;
}

export const FRIEND_CACHE: FriendCacheConfig = table.freeze({
	refreshSeconds: 300,
	retrySeconds: 30,
	maxConcurrentFetches: 4,
});

/**
 * Largest |UserId| accepted from the wire or a report (2^53 - 1: every integer up to it is exact in a float64), so a
 * forged 1e300 never reaches `Players:GetPlayerByUserId` in a flush. Negative ids stay valid (Studio test players).
 */
export const MAX_USER_ID_MAGNITUDE = 2 ** 53 - 1;

/** A UserId as the wire carries it: a nonzero integer of magnitude at most MAX_USER_ID_MAGNITUDE. */
export function isWireUserId(v: unknown): v is number {
	return isFiniteValue(v) && v % 1 === 0 && v !== 0 && math.abs(v) <= MAX_USER_ID_MAGNITUDE;
}

export function isLobbyNameId(v: unknown): v is LobbyNameId {
	if (!typeIs(v, "string")) return false;
	for (const id of LOBBY_NAMES) if (id === v) return true;
	return false;
}

export function isLobbyVisibility(v: unknown): v is LobbyVisibility {
	if (!typeIs(v, "string")) return false;
	for (const vis of LOBBY_VISIBILITIES) if (vis === v) return true;
	return false;
}
