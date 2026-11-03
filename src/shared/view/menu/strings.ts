/**
 * Every theme string key the main menu, the lobby screens, the leave-run confirm and the lobby toasts read (tasks L3,
 * L5, L6). The React components (client/ui/menu) take their keys from here; hud.spec.ts checks each one exists in the
 * placeholder pack (`menuStringKeys`), so a missing key fails the build instead of showing the raw key in game.
 */
import { ARRIVAL_TOAST } from "shared/invite";
import { creditStringKeys } from "./credits";
import {
	LOBBY_NAMES,
	LOBBY_VISIBILITIES,
	type LobbyNameId,
	type LobbyRefusal,
	type LobbyVisibility,
} from "shared/lobby";

/** Main menu, run-end exits, the pause overlay's Leave run (with its confirm) and the co-op (non-pausing) overlay. */
export const MENU_STRINGS = {
	playSolo: "menu.playSolo",
	lobbies: "menu.lobbies",
	yourLobby: "menu.yourLobby",
	options: "menu.options",
	leaderboard: "menu.leaderboard",
	back: "menu.back",
	backHint: "menu.backHint",
	starting: "menu.starting",
	mainMenu: "menu.mainMenu",
	backToLobby: "menu.backToLobby",
	again: "menu.again",
	leaveRun: "menu.leaveRun",
	leaveConfirm: "menu.leaveConfirm",
	leaveConfirmCoop: "menu.leaveConfirmCoop",
	leaveYes: "menu.leaveYes",
	leaveNo: "menu.leaveNo",
	coopTitle: "menu.coopTitle",
	coopHint: "menu.coopHint",
	partyDown: "menu.partyDown",
	partyEnded: "menu.partyEnded",
	invitesBadge: "menu.invitesBadge",
	/** Roblox's invite prompt without a lobby (docs/INVITES.md ID7). */
	inviteFriends: "menu.inviteFriends",
} as const;

/** The lobby browser, the lobby room, the invite list and the invite toasts. */
export const LOBBY_STRINGS = {
	browserTitle: "lobby.browser.title",
	create: "lobby.browser.create",
	newVisibility: "lobby.browser.newVisibility",
	empty: "lobby.browser.empty",
	join: "lobby.browser.join",
	inRun: "lobby.browser.inRun",
	starting: "lobby.browser.starting",
	count: "lobby.browser.count",
	friend: "lobby.browser.friend",
	refresh: "lobby.browser.refresh",
	host: "lobby.room.host",
	you: "lobby.room.you",
	ready: "lobby.room.ready",
	notReady: "lobby.room.notReady",
	readyUp: "lobby.room.readyUp",
	unready: "lobby.room.unready",
	start: "lobby.room.start",
	startSolo: "lobby.room.startSolo",
	invite: "lobby.room.invite",
	leave: "lobby.room.leave",
	kick: "lobby.room.kick",
	makeHost: "lobby.room.makeHost",
	rename: "lobby.room.rename",
	visibility: "lobby.room.visibility",
	members: "lobby.room.members",
	forming: "lobby.room.forming",
	allReady: "lobby.room.allReady",
	countdown: "lobby.room.countdown",
	runInProgress: "lobby.room.inRun",
	inviteTitle: "lobby.invite.title",
	inviteNone: "lobby.invite.none",
	inviteSend: "lobby.invite.send",
	invited: "lobby.invite.invited",
	inviteReceived: "lobby.invite.received",
	inviteAccept: "lobby.invite.accept",
	inviteDecline: "lobby.invite.decline",
	/** Roblox invites (docs/INVITES.md I5): the invite panel's top row, its disabled reason, a platform invitee. */
	invitePlatform: "lobby.invite.platform",
	invitePlatformUnavailable: "lobby.invite.platformUnavailable",
	invitedPlatform: "lobby.invite.invitedPlatform",
	/** The partyLobby notice before this client knows the lobby's name. */
	noticePartyLobbyAny: "lobby.notice.partyLobbyAny",
} as const;

/** `lobby.notice.<kind>` for every LobbyNotice kind but "refused" (that one reads `lobby.err.<code>`). */
export const LOBBY_NOTICE_KINDS = [
	"kicked",
	"hostChanged",
	"countdownCancelled",
	"inviteExpired",
	"inviteDropped",
	"followed",
	"inviteArrived",
	"partyLobby",
] as const;
export type LobbyNoticeToastKind = (typeof LOBBY_NOTICE_KINDS)[number];

/** Every refusal code the server can send (shared/lobby LobbyRefusal); each has a `lobby.err.<code>` string. */
export const LOBBY_REFUSALS: ReadonlyArray<LobbyRefusal> = [
	"badRequest",
	"unknownLobby",
	"notMember",
	"notHost",
	"noAccess",
	"full",
	"inRun",
	"starting",
	"busy",
	"alreadyInLobby",
	"alreadyInvited",
	"inviteCap",
	"kickCooldown",
	"notInvited",
	"badName",
	"notReady",
	"notInRun",
];

/** Compile-time check that LOBBY_REFUSALS lists every LobbyRefusal (a new code without a string fails typecheck). */
export const LOBBY_REFUSALS_COMPLETE: [Exclude<LobbyRefusal, (typeof LOBBY_REFUSALS)[number]>] extends [never]
	? true
	: never = true;

/** A refusal code without its own string (or none) reads this. */
export const LOBBY_ERR_GENERIC = "lobby.err.generic";

export function lobbyNameKey(nameId: LobbyNameId): string {
	return `lobby.name.${nameId}`;
}

export function lobbyVisibilityKey(visibility: LobbyVisibility): string {
	return `lobby.visibility.${visibility}`;
}

export function lobbyNoticeKey(kind: LobbyNoticeToastKind): string {
	return `lobby.notice.${kind}`;
}

export function lobbyErrorKey(code: string | undefined): string {
	if (code === undefined) return LOBBY_ERR_GENERIC;
	for (const c of LOBBY_REFUSALS) if (c === code) return `lobby.err.${c}`;
	return LOBBY_ERR_GENERIC;
}

/**
 * The `arrival` notice's key (shared/invite ARRIVAL_TOAST, a `lobby.err.*` id) when it is one the server may send,
 * else LOBBY_ERR_GENERIC.
 */
export function arrivalToastKey(key: string | undefined): string {
	if (key === undefined) return LOBBY_ERR_GENERIC;
	for (const [, k] of pairs(ARRIVAL_TOAST as unknown as Map<string, string>)) if (k === key) return k;
	return LOBBY_ERR_GENERIC;
}

/** Every menu / lobby string key the UI can ask for (hud.spec.ts checks them all). */
export function menuStringKeys(): string[] {
	const keys: string[] = [LOBBY_ERR_GENERIC];
	for (const [, key] of pairs(MENU_STRINGS as unknown as Map<string, string>)) keys.push(key);
	for (const [, key] of pairs(LOBBY_STRINGS as unknown as Map<string, string>)) keys.push(key);
	for (const id of LOBBY_NAMES) keys.push(lobbyNameKey(id));
	for (const v of LOBBY_VISIBILITIES) keys.push(lobbyVisibilityKey(v));
	for (const k of LOBBY_NOTICE_KINDS) keys.push(lobbyNoticeKey(k));
	for (const c of LOBBY_REFUSALS) keys.push(lobbyErrorKey(c));
	// Arrival toasts: most are refusal strings already (full, inRun, ...); inviteGone / partyFull are their own.
	for (const [, k] of pairs(ARRIVAL_TOAST as unknown as Map<string, string>)) if (!keys.includes(k)) keys.push(k);
	for (const k of creditStringKeys()) keys.push(k);
	return keys;
}
