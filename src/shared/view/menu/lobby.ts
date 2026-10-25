/**
 * The lobby screens' view logic (task L5), pure: browser rows, the lobby room's model (host-only controls, the
 * Start rule, the status line), the invite list, received invites, notice toasts, and the small run-handoff / exit
 * rules the controllers use (task L6). Display names come from a `nameOf` callback (the client reads the Player in
 * this server), so this stays Roblox-API-free and headlessly tested (menu.spec.ts).
 */
import {
	LOBBY,
	LOBBY_NAMES,
	type LobbyNameId,
	type LobbyPhase,
	type LobbySummary,
	type LobbyVisibility,
} from "shared/lobby";
import type { LobbyInviteView, LobbyNotice, LobbyView } from "shared/network";
import type { StringVars } from "shared/theme";
import { LOBBY_ROOM_PATH, MAIN_MENU_PATH, type MenuScreen } from "./nav";
import {
	LOBBY_STRINGS,
	MENU_STRINGS,
	lobbyErrorKey,
	lobbyNameKey,
	lobbyNoticeKey,
	lobbyVisibilityKey,
} from "./strings";

/** A theme string key and its vars (the component calls `str(key, vars)`). */
export interface StringSpec {
	readonly key: string;
	readonly vars?: StringVars;
}

export type NameOf = (userId: number) => string;

/** A lobby's display name: `lobby.name.<id>` ("{host}'s descent" for hostDescent). */
export function lobbyTitle(nameId: LobbyNameId, hostId: number, nameOf: NameOf): StringSpec {
	return { key: lobbyNameKey(nameId), vars: { host: nameOf(hostId) } };
}

/** The next preset name (the host's Rename button cycles through LOBBY_NAMES). */
export function nextLobbyName(nameId: LobbyNameId): LobbyNameId {
	const i = LOBBY_NAMES.indexOf(nameId);
	return LOBBY_NAMES[(i + 1) % LOBBY_NAMES.size()];
}

// --- browser ---------------------------------------------------------------------------------

export interface BrowserRow {
	readonly lobbyId: string;
	readonly title: StringSpec;
	readonly count: StringSpec;
	readonly visibilityKey: string;
	readonly phase: LobbyPhase;
	/** Greyed: its members are in a run (no joining until it is back to forming). */
	readonly inRun: boolean;
	readonly starting: boolean;
	readonly hasFriend: boolean;
	/** The lobby this player is in. */
	readonly mine: boolean;
	/** Join is enabled: not in a lobby, forming, not full. */
	readonly canJoin: boolean;
}

/** The browser's rows: this player's own lobby first, then the server's order (it sorts the list). */
export function browserRows(
	list: ReadonlyArray<LobbySummary>,
	myLobbyId: string | undefined,
	nameOf: NameOf,
): BrowserRow[] {
	const mine: BrowserRow[] = [];
	const rest: BrowserRow[] = [];
	for (const s of list) {
		const isMine = s.lobbyId === myLobbyId;
		const row: BrowserRow = {
			lobbyId: s.lobbyId,
			title: lobbyTitle(s.nameId, s.hostId, nameOf),
			count: { key: LOBBY_STRINGS.count, vars: { count: s.count, max: s.max } },
			visibilityKey: lobbyVisibilityKey(s.visibility),
			phase: s.phase,
			inRun: s.phase === "inRun",
			starting: s.phase === "countdown",
			hasFriend: s.hasFriend,
			mine: isMine,
			canJoin: myLobbyId === undefined && s.phase === "forming" && s.count < s.max,
		};
		if (isMine) mine.push(row);
		else rest.push(row);
	}
	for (const r of rest) mine.push(r);
	return mine;
}

// --- lobby room ------------------------------------------------------------------------------

export interface RoomMember {
	readonly userId: number;
	readonly name: string;
	readonly host: boolean;
	readonly ready: boolean;
	readonly me: boolean;
	/** Host-only row buttons (never on the host's own row; only while forming). */
	readonly canKick: boolean;
	readonly canMakeHost: boolean;
}

export interface LobbyRoomModel {
	readonly lobbyId: string;
	readonly title: StringSpec;
	readonly visibility: LobbyVisibility;
	readonly isHost: boolean;
	readonly meReady: boolean;
	readonly allReady: boolean;
	/** The host's Start: forming and every member ready (alone: ready too). */
	readonly canStart: boolean;
	/** "Start run", or "Start solo run" when the host is alone. */
	readonly startKey: string;
	/** Host settings (visibility, rename) are editable: host and forming. */
	readonly canEdit: boolean;
	/** The Ready toggle works (forming only). */
	readonly canReady: boolean;
	/** Inviting works: not in a run and not full. */
	readonly canInvite: boolean;
	readonly inRun: boolean;
	readonly status: StringSpec;
	readonly membersLine: StringSpec;
	/** Join order (the run's player order). */
	readonly members: ReadonlyArray<RoomMember>;
}

/** Whole seconds left on a countdown `countdownIn` seconds long when it arrived, `elapsed` seconds ago. */
export function countdownLeft(countdownIn: number | undefined, elapsed: number): number {
	if (countdownIn === undefined) return 0;
	return math.max(0, math.ceil(countdownIn - elapsed));
}

export function lobbyRoomModel(view: LobbyView, me: number, nameOf: NameOf, countdownSeconds: number): LobbyRoomModel {
	const isHost = view.hostId === me;
	const forming = view.phase === "forming";
	let allReady = view.members.size() > 0;
	for (const id of view.members) if (!view.ready.includes(id)) allReady = false;
	const members: RoomMember[] = view.members.map((id) => ({
		userId: id,
		name: nameOf(id),
		host: id === view.hostId,
		ready: view.ready.includes(id),
		me: id === me,
		canKick: isHost && forming && id !== me,
		canMakeHost: isHost && forming && id !== me,
	}));
	let status: StringSpec;
	if (view.phase === "inRun") status = { key: LOBBY_STRINGS.runInProgress };
	else if (view.phase === "countdown") status = { key: LOBBY_STRINGS.countdown, vars: { seconds: countdownSeconds } };
	else status = { key: allReady ? LOBBY_STRINGS.allReady : LOBBY_STRINGS.forming };
	return {
		lobbyId: view.lobbyId,
		title: lobbyTitle(view.nameId, view.hostId, nameOf),
		visibility: view.visibility,
		isHost,
		meReady: view.ready.includes(me),
		allReady,
		canStart: isHost && forming && allReady,
		startKey: view.members.size() <= 1 ? LOBBY_STRINGS.startSolo : LOBBY_STRINGS.start,
		canEdit: isHost && forming,
		canReady: forming,
		canInvite: view.phase !== "inRun" && view.members.size() < LOBBY.maxSize,
		inRun: view.phase === "inRun",
		status,
		membersLine: { key: LOBBY_STRINGS.members, vars: { count: view.members.size(), max: LOBBY.maxSize } },
		members,
	};
}

// --- invites ---------------------------------------------------------------------------------

export interface ServerPlayer {
	readonly userId: number;
	readonly name: string;
}

export interface InviteCandidate {
	readonly userId: number;
	readonly name: string;
	/** A live invite to this lobby exists ("Invited"; no duplicate invites). */
	readonly invited: boolean;
	readonly canInvite: boolean;
}

/** The players in this server who are not in this lobby, by name (then UserId), with their invite state. */
export function inviteCandidates(
	players: ReadonlyArray<ServerPlayer>,
	view: LobbyView,
	me: number,
	canInviteNow: boolean,
): InviteCandidate[] {
	const out: InviteCandidate[] = [];
	for (const p of players) {
		if (p.userId === me || view.members.includes(p.userId)) continue;
		const invited = view.invited.includes(p.userId);
		out.push({ userId: p.userId, name: p.name, invited, canInvite: canInviteNow && !invited });
	}
	out.sort((a, b) => {
		const an = a.name.lower();
		const bn = b.name.lower();
		return an !== bn ? an < bn : a.userId < b.userId;
	});
	return out;
}

export interface ReceivedInvite {
	readonly inviteId: string;
	readonly lobbyId: string;
	/** `lobby.invite.received` vars: {from} and {lobby} (the lobby title, resolved by the caller). */
	readonly from: string;
	readonly title: StringSpec;
}

/** The live invites (expiry counted from when the list arrived, `elapsed` seconds ago), newest last, at most `max`. */
export function receivedInvites(
	invites: ReadonlyArray<LobbyInviteView>,
	elapsed: number,
	nameOf: NameOf,
	max: number,
): ReceivedInvite[] {
	const out: ReceivedInvite[] = [];
	for (const inv of invites) {
		if (inv.expiresIn - elapsed <= 0) continue;
		if (out.size() >= max) break;
		out.push({
			inviteId: inv.inviteId,
			lobbyId: inv.lobbyId,
			from: nameOf(inv.fromUserId),
			title: lobbyTitle(inv.nameId, inv.hostId, nameOf),
		});
	}
	return out;
}

/** A lobby notice as a toast line: refusals read `lobby.err.<code>`, the rest `lobby.notice.<kind>`. */
export function noticeSpec(notice: LobbyNotice, nameOf: NameOf): StringSpec {
	switch (notice.kind) {
		case "refused":
			return { key: lobbyErrorKey(notice.code) };
		case "countdownCancelled":
			return { key: lobbyNoticeKey("countdownCancelled"), vars: { reason: notice.reason ?? "" } };
		case "followed":
			return {
				key: lobbyNoticeKey("followed"),
				vars: { name: notice.userId !== undefined ? nameOf(notice.userId) : "" },
			};
		default:
			return { key: lobbyNoticeKey(notice.kind) };
	}
}

// --- run handoff and exits (L6) --------------------------------------------------------------

/** `partyRunStarted` / `lobbyRunStart` is taken only for the lobby this client is in. */
export function lobbyStartAccepted(startLobbyId: string, myLobbyId: string | undefined): boolean {
	return myLobbyId !== undefined && startLobbyId !== "" && startLobbyId === myLobbyId;
}

/** Where the menu opens after a run: the lobby room while in a lobby, else the main menu. */
export function afterRunPath(inLobby: boolean): ReadonlyArray<MenuScreen> {
	return inLobby ? LOBBY_ROOM_PATH : MAIN_MENU_PATH;
}

/** The main menu's lobby button: "Your lobby" (straight to the room) while in one, else "Lobbies". */
export function mainMenuLobbyKey(inLobby: boolean): string {
	return inLobby ? MENU_STRINGS.yourLobby : MENU_STRINGS.lobbies;
}

export interface RunOverExits {
	/** "Again" (retry; R): solo runs only. A party run's way on is the lobby. */
	readonly again: boolean;
	/** "Back to lobby" while in a lobby, else "Main menu". */
	readonly exitKey: string;
}

export function runOverExits(coop: boolean, inLobby: boolean): RunOverExits {
	return { again: !coop, exitKey: inLobby ? MENU_STRINGS.backToLobby : MENU_STRINGS.mainMenu };
}

/** What the run-over panel needs of the run's verdict (client/store VerdictView). */
export interface RunOverVerdict {
	readonly status: string;
	readonly run?: number;
	readonly code?: string;
	readonly reason?: string;
}

/**
 * A party run's main run-over line: "the party is down", or, once the server rejected THIS run (`run`: a desync, an
 * error, expiry; it may have ended the run before the wipe), that the server ended it, with the verdict's reason.
 */
export function partyRunOverLine(
	verdict: RunOverVerdict,
	run: number,
): { readonly key: string; readonly reason: string } {
	if (verdict.status !== "rejected" || verdict.run !== run) return { key: MENU_STRINGS.partyDown, reason: "" };
	return { key: MENU_STRINGS.partyEnded, reason: verdict.reason ?? verdict.code ?? "" };
}

export type PauseItem = "resume" | "restart" | "leave" | "settings" | "leaderboards";

/** The pause overlay's buttons: solo (the run is paused) or the co-op overlay (the run goes on; no restart). */
export function pauseItems(coop: boolean): ReadonlyArray<PauseItem> {
	return coop
		? ["resume", "leave", "settings", "leaderboards"]
		: ["resume", "restart", "leave", "settings", "leaderboards"];
}

/**
 * R / Again / Restart mid-run: a ranked solo run still being played is forfeited (it counts as a death and is
 * submitted, like Leave run) and the next run starts once that death was submitted. Unranked runs restart at once
 * (submitted as abandoned, as before).
 */
export function restartForfeits(ranked: boolean, playing: boolean): boolean {
	return ranked && playing;
}
