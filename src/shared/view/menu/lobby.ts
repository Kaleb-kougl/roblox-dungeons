/**
 * The lobby screens' view logic (task L5), pure: browser rows, the lobby room's model (host-only controls, the
 * Start rule, the status line), the invite list, received invites, notice toasts, and the small run-handoff / exit
 * rules the controllers use (task L6). Display names come from a `nameOf` callback (the client reads the Player in
 * this server), so this stays Roblox-API-free and headlessly tested (menu.spec.ts).
 *
 * @module
 */
import {
	LOBBY,
	LOBBY_NAMES,
	type LobbyInviteSource,
	type LobbyNameId,
	type LobbyPhase,
	type LobbySummary,
	type LobbyVisibility,
} from "shared/lobby";
import { isCharacterId, type CharacterId } from "shared/characters";
import { readCosmeticLook } from "shared/cosmetics";
import type { LobbyInviteView, LobbyNotice, LobbyView } from "shared/network";
import type { StringVars } from "shared/theme";
import { LOBBY_BROWSER_PATH, LOBBY_ROOM_PATH, MAIN_MENU_PATH, type MenuScreen } from "./nav";
import {
	LOBBY_STRINGS,
	MENU_STRINGS,
	arrivalToastKey,
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

/**
 * Looks up a player's display name by UserId. The client passes one that reads the Player in this server, so this
 * module never touches the Roblox API.
 */
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

/**
 * One lobby as a row of the lobby browser: its title, member count and visibility as string specs and keys, its phase,
 * and whether this player is in it or may join it. Built by `browserRows` from the server's lobby summaries.
 */
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

/**
 * One member as a row of the lobby room: name, host / ready / me tags, their character pick and dye, and whether the
 * host's row buttons (kick, make host) show. Built by `lobbyRoomModel`, in join order.
 */
export interface RoomMember {
	readonly userId: number;
	readonly name: string;
	readonly host: boolean;
	readonly ready: boolean;
	readonly me: boolean;
	/**
	 * docs/ARCHER.md AR8: the member's character pick (LobbyView.characters, same index as `members`; the server shows
	 * the Knight until their first pick), drawn as a CharacterIcon on the row; undefined for a value that is no id.
	 */
	readonly character: CharacterId | undefined;
	/**
	 * docs/COSMETICS.md CS7: the dye the member wears for that pick (LobbyView.looks, same index; read as an untrusted
	 * value), drawn as a small swatch chip on the character icon; undefined: none.
	 */
	readonly dye: string | undefined;
	/** Host-only row buttons (never on the host's own row; only while forming). */
	readonly canKick: boolean;
	readonly canMakeHost: boolean;
}

/**
 * The lobby room screen for this player: the title, which controls are shown or enabled (the host's Start and settings,
 * Ready, inviting), the status line and the member rows. Built by `lobbyRoomModel` from the server's lobby view;
 * client/ui/menu draws it.
 */
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

/** Member `i`'s pick in `view` (LobbyView.characters), or undefined when missing or no character id. */
function memberPick(view: LobbyView, i: number): CharacterId | undefined {
	const c = view.characters[i];
	return isCharacterId(c) ? c : undefined;
}

/**
 * docs/ARCHER.md AR8 (AR5's note): the pick to send with an un-ready (`lobbySetReady(false, pick)`) when the lobby
 * room opens, so the other members see this player's last pick before they ready: the remembered `selected` when it
 * differs from the pick the view shows for `me`, `me` is a member, not ready (an un-ready never un-readies anyone:
 * a ready member keeps the pick they readied with) and the lobby is forming. Undefined: nothing to send.
 */
export function lobbyPickToSend(view: LobbyView, me: number, selected: CharacterId): CharacterId | undefined {
	if (view.phase !== "forming") return undefined;
	const i = view.members.indexOf(me);
	if (i < 0 || view.ready.includes(me)) return undefined;
	const shown = view.characters[i];
	return shown === selected ? undefined : selected;
}

/** Whole seconds left on a countdown `countdownIn` seconds long when it arrived, `elapsed` seconds ago. */
export function countdownLeft(countdownIn: number | undefined, elapsed: number): number {
	if (countdownIn === undefined) return 0;
	return math.max(0, math.ceil(countdownIn - elapsed));
}

/**
 * The lobby room's model for player `me` from the server's `view`: the member rows in join order, the host-only
 * controls (only while forming), the Start rule (host, forming, every member ready) and the status line.
 * `countdownSeconds` is the whole seconds left that the countdown status shows (see `countdownLeft`).
 */
export function lobbyRoomModel(view: LobbyView, me: number, nameOf: NameOf, countdownSeconds: number): LobbyRoomModel {
	const isHost = view.hostId === me;
	const forming = view.phase === "forming";
	let allReady = view.members.size() > 0;
	for (const id of view.members) if (!view.ready.includes(id)) allReady = false;
	const members: RoomMember[] = view.members.map((id, i) => ({
		userId: id,
		name: nameOf(id),
		host: id === view.hostId,
		ready: view.ready.includes(id),
		me: id === me,
		character: memberPick(view, i),
		dye: readCosmeticLook(view.looks?.[i]).dye,
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

/**
 * A player in this server, by UserId and display name: what the invite list is built from (the client's `lobby` slice
 * keeps everyone in this server, this player too, in join order).
 */
export interface ServerPlayer {
	readonly userId: number;
	readonly name: string;
}

/**
 * One row of the lobby room's invite list: a player who could be invited, or one already invited, with where the invite
 * came from and whether they are in this server yet. Built by `inviteCandidates`; `inviteCandidateKey` gives the row's
 * button text.
 */
export interface InviteCandidate {
	readonly userId: number;
	readonly name: string;
	/** A live invite to this lobby exists ("Invited"; no duplicate invites). */
	readonly invited: boolean;
	/** That invite came through Roblox (a platform or party invite): "Invited (Roblox)". */
	readonly platform: boolean;
	/** In this server (false: a platform / party invitee who has not arrived yet). */
	readonly here: boolean;
	readonly canInvite: boolean;
}

/** Where `userId`'s live invite to `view` came from (undefined: none). `invitedSources` is parallel to `invited`. */
function inviteSourceOf(view: LobbyView, userId: number): LobbyInviteSource | undefined {
	const i = view.invited.indexOf(userId);
	if (i < 0) return undefined;
	return view.invitedSources[i] ?? "server";
}

/**
 * The invite list: the players in this server who are not in this lobby, by name (then UserId), with their invite
 * state; then the Roblox (platform / party) invitees who are not in this server yet, in invite order, always in the
 * invited state (named by `nameOf`: "#<UserId>" until they arrive, as no web lookups are made).
 */
export function inviteCandidates(
	players: ReadonlyArray<ServerPlayer>,
	view: LobbyView,
	me: number,
	canInviteNow: boolean,
	nameOf: NameOf = (id) => `#${id}`,
): InviteCandidate[] {
	const out: InviteCandidate[] = [];
	for (const p of players) {
		if (p.userId === me || view.members.includes(p.userId)) continue;
		const source = inviteSourceOf(view, p.userId);
		const invited = source !== undefined;
		out.push({
			userId: p.userId,
			name: p.name,
			invited,
			platform: invited && source !== "server",
			here: true,
			canInvite: canInviteNow && !invited,
		});
	}
	out.sort((a, b) => {
		const an = a.name.lower();
		const bn = b.name.lower();
		return an !== bn ? an < bn : a.userId < b.userId;
	});
	for (let i = 0; i < view.invited.size(); i++) {
		const id = view.invited[i];
		const source = view.invitedSources[i] ?? "server";
		if (source === "server" || id === me || view.members.includes(id)) continue;
		if (players.some((p) => p.userId === id)) continue;
		out.push({ userId: id, name: nameOf(id), invited: true, platform: true, here: false, canInvite: false });
	}
	return out;
}

/** An invite list row's button: "Invite", "Invited" or "Invited (Roblox)". */
export function inviteCandidateKey(c: InviteCandidate): string {
	if (!c.invited) return LOBBY_STRINGS.inviteSend;
	return c.platform ? LOBBY_STRINGS.invitedPlatform : LOBBY_STRINGS.invited;
}

/**
 * A Roblox invite button (the lobby room's "Invite friends (Roblox)", the main menu's "Invite friends"): disabled
 * with the reason line when the server said this player cannot send invites (`canSend` false; undefined, not asked or
 * not answered yet, stays enabled: the server checks again), or when `allowed` is false (the lobby is in a run or full:
 * no reason line, the room's status says why).
 */
export interface PlatformInviteButton {
	readonly enabled: boolean;
	/** The reason line under the button, or undefined. */
	readonly reasonKey?: string;
}

/**
 * The state of a Roblox invite button (see `PlatformInviteButton`): disabled with the reason line when the server said
 * this player cannot send invites (`canSend` false; undefined stays enabled), otherwise enabled only while `allowed`.
 */
export function platformInviteButton(canSend: boolean | undefined, allowed = true): PlatformInviteButton {
	if (canSend === false) return { enabled: false, reasonKey: LOBBY_STRINGS.invitePlatformUnavailable };
	return { enabled: allowed };
}

/**
 * Ask the server for `inviteEligible` again? Once at startup (`askedAt` undefined), then when a menu opens and the
 * last ask is at least `cacheSeconds` (INVITE.eligibilityCacheSeconds) old.
 */
export function eligibilityDue(askedAt: number | undefined, now: number, cacheSeconds: number): boolean {
	return askedAt === undefined || now - askedAt >= cacheSeconds;
}

/**
 * The `inviteArrived` toast's Invite button: shown while this player is in a lobby that can take an invite (not in a
 * run, not full), and the friend who arrived is in this server, outside the lobby and not invited to it yet.
 */
export function arrivedInviteShown(
	userId: number,
	mine: LobbyView | undefined,
	players: ReadonlyArray<ServerPlayer>,
	me: number,
): boolean {
	if (mine === undefined || userId === me) return false;
	if (mine.phase === "inRun" || mine.members.size() >= LOBBY.maxSize) return false;
	if (mine.members.includes(userId) || mine.invited.includes(userId)) return false;
	return players.some((p) => p.userId === userId);
}

/**
 * A live invite this player received, as an invite toast draws it: the ids Accept and Decline send back, the inviter's
 * display name and the lobby's title. Built by `receivedInvites`.
 */
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

/**
 * A notice toast: its line, plus (partyLobby) the lobby's title for the `{lobby}` var, resolved by the component like
 * the invite toasts' titles, and (inviteArrived) the friend the toast's Invite button invites (arrivedInviteShown).
 */
export interface NoticeSpec extends StringSpec {
	readonly lobby?: StringSpec;
	readonly inviteUserId?: number;
}

/** The title of a lobby this client knows (its own, or one in the browse list), or undefined. */
export function knownLobbyTitle(
	lobbyId: string | undefined,
	mine: LobbyView | undefined,
	list: ReadonlyArray<LobbySummary>,
	nameOf: NameOf,
): StringSpec | undefined {
	if (lobbyId === undefined) return undefined;
	if (mine !== undefined && mine.lobbyId === lobbyId) return lobbyTitle(mine.nameId, mine.hostId, nameOf);
	const s = list.find((l) => l.lobbyId === lobbyId);
	return s !== undefined ? lobbyTitle(s.nameId, s.hostId, nameOf) : undefined;
}

/**
 * A lobby notice as a toast line: refusals read `lobby.err.<code>`, arrivals their `key` (a `lobby.err.*` id), the
 * rest `lobby.notice.<kind>`. `lobbyTitleOf` names the partyLobby notice's lobby (knownLobbyTitle); without a title
 * it reads "Your Roblox party is together in a lobby".
 */
export function noticeSpec(
	notice: LobbyNotice,
	nameOf: NameOf,
	lobbyTitleOf: (lobbyId: string | undefined) => StringSpec | undefined = () => undefined,
): NoticeSpec {
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
		case "inviteArrived": {
			const id = notice.userId;
			return id !== undefined
				? { key: lobbyNoticeKey("inviteArrived"), vars: { name: nameOf(id) }, inviteUserId: id }
				: { key: lobbyNoticeKey("inviteArrived"), vars: { name: "" } };
		}
		case "partyLobby": {
			const lobby = lobbyTitleOf(notice.lobbyId);
			return lobby !== undefined
				? { key: lobbyNoticeKey("partyLobby"), lobby }
				: { key: LOBBY_STRINGS.noticePartyLobbyAny };
		}
		case "arrival":
			return { key: arrivalToastKey(notice.key) };
		default:
			return { key: lobbyNoticeKey(notice.kind) };
	}
}

// --- run handoff and exits (L6) --------------------------------------------------------------

/** `partyRunStarted` / `lobbyRunStart` is taken only for the lobby this client is in. */
export function lobbyStartAccepted(startLobbyId: string, myLobbyId: string | undefined): boolean {
	return myLobbyId !== undefined && startLobbyId !== "" && startLobbyId === myLobbyId;
}

/**
 * This player's lobby changed (`lobbyState`) while the menu shows `screen`: the path to reset the menu to, or
 * undefined to leave it. In a lobby now (created, joined, or put there by an invite / party arrival they did not ask
 * for, docs/INVITES.md): its room. Out of it (left, kicked) while in its room: the browser. With no menu screen up (a
 * run, the tutorial, the first-run wait, "Starting run...") nothing moves; the menu after a run / the join opens the
 * room then (afterRunPath). A panel over the menu (Options, Leaderboard) stays open: only the screen under it changes.
 * `stack`: the screens under `screen` (MenuNav.stack; read for the character screen only).
 */
export function lobbyChangePath(
	screen: MenuScreen,
	lobbyId: string | undefined,
	prevLobbyId: string | undefined,
	stack: ReadonlyArray<MenuScreen> = [],
): ReadonlyArray<MenuScreen> | undefined {
	if (screen === "none" || lobbyId === prevLobbyId) return undefined;
	// docs/ARCHER.md AR7 / AR8: the character screen over no menu (the run-over panel, the outro, a dev run) moves
	// nothing, like the run under it; over the lobby room (a member's Ready) a lost lobby goes to the browser.
	if (screen === "character") {
		if (stack.size() === 0) return undefined;
		if (lobbyId !== undefined) return LOBBY_ROOM_PATH;
		return stack.includes("lobby") ? LOBBY_BROWSER_PATH : undefined;
	}
	if (lobbyId !== undefined) return LOBBY_ROOM_PATH;
	return screen === "lobby" ? LOBBY_BROWSER_PATH : undefined;
}

/** Where the menu opens after a run (and on join): the lobby room while in a lobby, else the main menu. */
export function afterRunPath(inLobby: boolean): ReadonlyArray<MenuScreen> {
	return inLobby ? LOBBY_ROOM_PATH : MAIN_MENU_PATH;
}

/** The main menu's lobby button: "Your lobby" (straight to the room) while in one, else "Lobbies". */
export function mainMenuLobbyKey(inLobby: boolean): string {
	return inLobby ? MENU_STRINGS.yourLobby : MENU_STRINGS.lobbies;
}

/**
 * The run-over panel's ways out: whether Again is offered, and the exit button's string key. Built by `runOverExits`.
 */
export interface RunOverExits {
	/** "Again" (retry; R): solo runs only. A party run's way on is the lobby. */
	readonly again: boolean;
	/** "Back to lobby" while in a lobby, else "Main menu". */
	readonly exitKey: string;
}

/**
 * The run-over panel's exits: Again only after a solo run (`coop` false), and an exit button that reads Back to lobby
 * while this player is in a lobby, else Main menu.
 */
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
 * `left`: this player left the run with Leave run (leaveRun.ts runOverLeft): that line, whatever the verdict says.
 */
export function partyRunOverLine(
	verdict: RunOverVerdict,
	run: number,
	left = false,
): { readonly key: string; readonly reason: string } {
	if (left) return { key: MENU_STRINGS.partyLeft, reason: "" };
	if (verdict.status !== "rejected" || verdict.run !== run) return { key: MENU_STRINGS.partyDown, reason: "" };
	return { key: MENU_STRINGS.partyEnded, reason: verdict.reason ?? verdict.code ?? "" };
}

/**
 * A button of the pause overlay (solo, the co-op party overlay or a tutorial run). `pauseItems` gives the buttons for
 * each case, in order.
 */
export type PauseItem =
	| "resume"
	| "restart"
	| "leave"
	| "settings"
	| "leaderboards"
	/** A first-run tutorial run (docs/TUTORIAL.md): a fresh tutorial run, and the skip (asks first). */
	| "restartTutorial"
	| "skipTutorial"
	/** Touch (docs/MOBILE.md MB10): the full map, from the co-op party overlay (a tap on the map closes it). */
	| "map";

/**
 * The pause overlay's buttons: solo (the run is paused), the co-op overlay (the run goes on; no restart), or a
 * tutorial run (paused; Restart tutorial / Skip tutorial take Restart's and Leave run's places, no leaderboards: the
 * outro points there). The tutorial replay lives in the main menu, not here. On touch (`touchMap`, co-op) the party
 * overlay adds Map: the full map (solo has it in the pause overlay already).
 */
export function pauseItems(coop: boolean, tutorial = false, touchMap = false): ReadonlyArray<PauseItem> {
	if (coop && touchMap) return ["resume", "map", "leave", "settings", "leaderboards"];
	if (coop) return ["resume", "leave", "settings", "leaderboards"];
	if (tutorial) return ["resume", "restartTutorial", "skipTutorial", "settings"];
	return ["resume", "restart", "leave", "settings", "leaderboards"];
}

/**
 * R / Again / Restart mid-run: a ranked solo run still being played is forfeited (it counts as a death and is
 * submitted, like Leave run) and the next run starts once that death was submitted. Unranked runs restart at once
 * (submitted as abandoned, as before).
 */
export function restartForfeits(ranked: boolean, playing: boolean): boolean {
	return ranked && playing;
}
