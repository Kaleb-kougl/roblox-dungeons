/**
 * The LaunchData an invite carries (`ExperienceInviteOptions.LaunchData`, read back from
 * `Player:GetJoinData().LaunchData`, docs/INVITES.md §1). A tiny text format, not JSON, so this stays pure (no
 * HttpService) and runs headlessly:
 *
 *   kv1|l|<lobbyId>|<fromUserId>    a lobby invite (the sender's lobby)
 *   kv1|g|<fromUserId>              a menu invite to the game, no lobby
 *
 * A UserId is written in plain decimal, no sign, no leading zero (the only spelling decode accepts, so a decoded
 * launch re-encodes to the same string). A lobby id is 1..LOBBY.maxIdChars characters without the separator.
 *
 * Users can edit LaunchData: it is a HINT, never proof. `decodeInviteLaunch` never throws and returns undefined for
 * anything unexpected; Closed lobby entry still needs a server-side invite record (arrival.ts).
 */
import { LOBBY } from "shared/lobby";
import { isFiniteValue } from "shared/run";
import { INVITE } from "./config";

export type InviteLaunch =
	| { readonly kind: "lobby"; readonly lobbyId: string; readonly fromUserId: number }
	| { readonly kind: "game"; readonly fromUserId: number };

/** The format's pieces (changing any of them is a new version). */
export const INVITE_LAUNCH_FORMAT = table.freeze({
	version: "kv1",
	separator: "|",
	lobbyTag: "l",
	gameTag: "g",
	/** Longest UserId spelling: every integer of up to 15 digits is exact in a float64 (2^53 has 16). */
	maxUserIdDigits: 15,
});

export interface InviteLaunchOptions {
	/**
	 * Studio only: accept negative UserIds (Studio test players are -1, -2, ...), written with a leading "-".
	 * InviteService passes it when `RunService:IsStudio()` (the `KV_FakeLaunchData` attribute); live servers never
	 * do, so a live LaunchData with a negative id decodes to undefined.
	 */
	readonly allowNegativeUserIds?: boolean;
}

function isLobbyIdText(id: string): boolean {
	return (
		id.size() > 0 &&
		id.size() <= LOBBY.maxIdChars &&
		string.find(id, INVITE_LAUNCH_FORMAT.separator, 1, true)[0] === undefined
	);
}

/** Every UserId spelling fits in maxUserIdDigits digits: |id| below this. */
const USER_ID_LIMIT = 10 ** INVITE_LAUNCH_FORMAT.maxUserIdDigits;

function isEncodableUserId(id: unknown, opts: InviteLaunchOptions | undefined): id is number {
	if (!isFiniteValue(id) || id % 1 !== 0 || math.abs(id) >= USER_ID_LIMIT) return false;
	return id >= 0 || opts?.allowNegativeUserIds === true;
}

function userIdText(id: number): string {
	return id < 0 ? `-${string.format("%d", -id)}` : string.format("%d", id);
}

/** Parses the one accepted UserId spelling, or undefined. */
function parseUserId(text: string, opts: InviteLaunchOptions | undefined): number | undefined {
	let digits = text;
	let negative = false;
	if (opts?.allowNegativeUserIds === true && text.sub(1, 1) === "-") {
		negative = true;
		digits = text.sub(2);
	}
	if (digits.size() === 0 || digits.size() > INVITE_LAUNCH_FORMAT.maxUserIdDigits) return undefined;
	if (string.match(digits, "^%d+$")[0] === undefined) return undefined;
	if (digits.size() > 1 && digits.sub(1, 1) === "0") return undefined;
	const n = tonumber(digits);
	if (n === undefined) return undefined;
	if (negative) return n === 0 ? undefined : -n;
	return n;
}

/**
 * The LaunchData string for an invite. Errors (a server bug, never user input) on a malformed launch or a result
 * over INVITE.launchDataMaxChars.
 */
export function encodeInviteLaunch(launch: InviteLaunch, opts?: InviteLaunchOptions): string {
	const f = INVITE_LAUNCH_FORMAT;
	if (!isEncodableUserId(launch.fromUserId, opts)) error("encodeInviteLaunch: fromUserId must be a plain integer", 0);
	let text: string;
	if (launch.kind === "lobby") {
		if (!isLobbyIdText(launch.lobbyId)) error("encodeInviteLaunch: bad lobby id", 0);
		text = [f.version, f.lobbyTag, launch.lobbyId, userIdText(launch.fromUserId)].join(f.separator);
	} else {
		text = [f.version, f.gameTag, userIdText(launch.fromUserId)].join(f.separator);
	}
	if (text.size() > INVITE.launchDataMaxChars) error("encodeInviteLaunch: over the LaunchData limit", 0);
	return text;
}

/** The invite a LaunchData string names, or undefined for anything else (never throws). */
export function decodeInviteLaunch(text: unknown, opts?: InviteLaunchOptions): InviteLaunch | undefined {
	if (!typeIs(text, "string")) return undefined;
	if (text.size() === 0 || text.size() > INVITE.launchDataMaxChars) return undefined;
	const f = INVITE_LAUNCH_FORMAT;
	const parts = text.split(f.separator);
	if (parts[0] !== f.version) return undefined;
	if (parts[1] === f.lobbyTag && parts.size() === 4) {
		const lobbyId = parts[2];
		const fromUserId = parseUserId(parts[3], opts);
		if (!isLobbyIdText(lobbyId) || fromUserId === undefined) return undefined;
		return { kind: "lobby", lobbyId, fromUserId };
	}
	if (parts[1] === f.gameTag && parts.size() === 3) {
		const fromUserId = parseUserId(parts[2], opts);
		if (fromUserId === undefined) return undefined;
		return { kind: "game", fromUserId };
	}
	return undefined;
}
