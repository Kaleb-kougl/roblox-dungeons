/**
 * Posting a validated run to the leaderboards (M5): who may post, which board, the personal-best rule, and the two
 * DataStore writes of one personal best. Pure: the stores are interfaces (LeaderboardService passes DataStore
 * adapters; the specs an in-memory fake), so the rules are tested headlessly.
 *
 * Personal best: one entry per player per board. A post replaces it only when its ordered value is HIGHER (a higher
 * score; at an equal score a deeper floor; never a later equal run). A co-op run posts one entry for EVERY member to
 * the co-op board (each member's co-op best). The checks run inside UpdateAsync, so concurrent servers never lower a
 * best.
 */
import { playerDataKey } from "shared/settings";
import {
	COOP_MIN_PARTY,
	LEADERBOARD_DETAILS_VERSION,
	LEADERBOARD_POLICY,
	MAX_PARTY_SIZE,
	type LeaderboardBoard,
	type LeaderboardPolicy,
} from "./config";
import { asOrderedValue, encodeOrderedValue } from "./orderedValue";

/** One player of a posted run, as stored with the entry. */
export interface LeaderboardMember {
	userId: number;
	name: string;
	classId?: string;
}

/** The details document kept per personal best (`LB_Details_v1`, key detailsKey(board, userId)). */
export interface LeaderboardEntryDetails {
	v: number;
	/** The ordered value it was posted with (the PB rule compares this). */
	value: number;
	score: number;
	floor: number;
	partySize: number;
	members: LeaderboardMember[];
	/** Unix seconds of the submission. */
	at: number;
	runId: string;
	worldKind: string;
}

/** A run the server validated, ready to post. Every number is the server's replay. */
export interface VerifiedRunPost {
	readonly runId: string;
	readonly worldKind: string;
	/** The members credited (owner first): party runs list only those who contributed (partyContributors). */
	readonly members: ReadonlyArray<LeaderboardMember>;
	/** The run's party size (default members.size()); the board follows it, the details store it. */
	readonly partySize?: number;
	readonly score: number;
	readonly floor: number;
	/** Unix seconds. */
	readonly at: number;
}

/** One personal-best write: `userId`'s entry on `board`. */
export interface PostJob {
	readonly board: LeaderboardBoard;
	readonly userId: number;
	readonly value: number;
	readonly details: LeaderboardEntryDetails;
}

/** Why a validated run does not post (undefined: it posts). */
export type IneligibleReason =
	| "world"
	| "studio"
	| "private_server"
	| "debug"
	| "abandoned"
	| "party"
	/** A party run (2+ members) where fewer than COOP_MIN_PARTY members contributed (partyContributors). */
	| "contributors";

export interface PostContext {
	readonly worldKind: string;
	readonly partySize: number;
	/** Debug limits were in force for the run. */
	readonly debug: boolean;
	readonly studio: boolean;
	/** A VIP (owned) private server. Reserved servers (matchmaking) are not private. */
	readonly privateServer: boolean;
	readonly died: boolean;
	readonly bossDefeated: boolean;
	/** Party runs: members who contributed (partyContributors). Default: every member. */
	readonly contributors?: number;
}

export function leaderboardEligibility(
	ctx: PostContext,
	policy: LeaderboardPolicy = LEADERBOARD_POLICY,
): IneligibleReason | undefined {
	if (!policy.eligibleWorlds.includes(ctx.worldKind)) return "world";
	if (ctx.debug) return "debug";
	if (ctx.studio && !policy.postFromStudio) return "studio";
	if (ctx.privateServer && !policy.postFromPrivateServers) return "private_server";
	if (ctx.partySize < 1 || ctx.partySize > MAX_PARTY_SIZE) return "party";
	if (!policy.postAbandoned) {
		// An endless run is finished only by death: a boss kill there is one floor of it, so R after a boss is abandoned.
		const finished = policy.deathOnlyWorlds.includes(ctx.worldKind) ? ctx.died : ctx.died || ctx.bossDefeated;
		if (!finished) return "abandoned";
	}
	if (ctx.partySize >= COOP_MIN_PARTY && (ctx.contributors ?? ctx.partySize) < COOP_MIN_PARTY) return "contributors";
	return undefined;
}

/**
 * Who of a party run gets co-op credit (by player index): a member CONTRIBUTED when they were in the run until its end
 * (never marked left / stalled, or marked only from `finalTick` on: the wipe came first), or were still present after
 * the run's first floor change (they played at least one full floor: their leave frame came after it).
 *
 *   leftFromTick(i)        the first tick player i's merged frame carried the leave bit (relay.ts), undefined = never
 *   firstFloorChangeTick   the tick whose step changed floor 1 -> 2 (undefined: the run never left floor 1)
 *
 * Pure. A run where fewer than COOP_MIN_PARTY members contributed is not a co-op post (leaderboardEligibility).
 */
export function partyContributors(
	leftFromTick: (i: number) => number | undefined,
	size: number,
	finalTick: number,
	firstFloorChangeTick: number | undefined,
): boolean[] {
	const out: boolean[] = [];
	for (let i = 0; i < size; i++) {
		const left = leftFromTick(i);
		out.push(
			left === undefined ||
				left >= finalTick ||
				(firstFloorChangeTick !== undefined && left > firstFloorChangeTick),
		);
	}
	return out;
}

/** Solo for a party of one, co-op from COOP_MIN_PARTY. */
export function boardForParty(partySize: number): LeaderboardBoard {
	return partySize >= COOP_MIN_PARTY ? "coop" : "solo";
}

/** The ordered store key of a player (`u_<UserId>`). */
export function orderedKey(userId: number): string {
	return playerDataKey(userId);
}

/** The UserId in an ordered store key, or undefined for a key this module did not write. */
export function userIdFromKey(key: string): number | undefined {
	const [digits] = string.match(key, "^u_(%d+)$");
	if (digits === undefined) return undefined;
	const id = tonumber(digits);
	return id !== undefined && id > 0 ? id : undefined;
}

/** The details store key of a player's entry on a board (`solo_u_<UserId>`, `coop_u_<UserId>`). */
export function detailsKey(board: LeaderboardBoard, userId: number): string {
	return `${board}_${playerDataKey(userId)}`;
}

/** The personal-best writes for a validated run: one per credited member, on the party's board. */
export function planPosts(run: VerifiedRunPost): PostJob[] {
	const partySize = run.partySize ?? run.members.size();
	const board = boardForParty(partySize);
	const value = encodeOrderedValue({ score: run.score, floor: run.floor, at: run.at });
	const members = run.members.map((m) => ({ ...m }));
	const jobs: PostJob[] = [];
	for (const m of run.members) {
		jobs.push({
			board,
			userId: m.userId,
			value,
			details: {
				v: LEADERBOARD_DETAILS_VERSION,
				value,
				score: run.score,
				floor: run.floor,
				partySize,
				members,
				at: run.at,
				runId: run.runId,
				worldKind: run.worldKind,
			},
		});
	}
	return jobs;
}

/** The personal-best rule: `candidate` replaces `stored` only when strictly higher (or nothing valid is stored). */
export function isBetterValue(candidate: number, stored: unknown): boolean {
	const old = asOrderedValue(stored);
	return old === undefined || candidate > old;
}

/** The ordered value inside a stored details document, or undefined. */
export function detailsValue(raw: unknown): number | undefined {
	if (!typeIs(raw, "table")) return undefined;
	return asOrderedValue((raw as { value?: unknown }).value);
}

/** A stored details document, validated loosely for display (undefined when it is not one). */
export function decodeDetails(raw: unknown): LeaderboardEntryDetails | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const d = raw as Partial<LeaderboardEntryDetails>;
	if (detailsValue(raw) === undefined || !typeIs(d.score, "number") || !typeIs(d.floor, "number")) return undefined;
	if (!typeIs(d.partySize, "number") || !typeIs(d.at, "number") || !typeIs(d.members, "table")) return undefined;
	return d as LeaderboardEntryDetails;
}

/** OrderedDataStore, as the poster and the reads use it. Calls may yield and throw. */
export interface OrderedScoreStore {
	/** UpdateAsync: `transform(old)` returns the new value, or undefined to leave it. Tagged with `userIds`. */
	update(key: string, transform: (old: unknown) => number | undefined, userIds?: ReadonlyArray<number>): void;
	get(key: string): unknown;
	/** The `count` highest entries, highest first (GetSortedAsync descending, first page). */
	top(count: number): ReadonlyArray<{ readonly key: string; readonly value: number }>;
}

/** The details DataStore (DataStoreKeyValue satisfies it). Calls may yield and throw. */
export interface DetailsStore {
	get(key: string): unknown;
	update(key: string, transform: (old: unknown) => unknown, userIds?: ReadonlyArray<number>): void;
}

export interface LeaderboardStores {
	readonly ordered: (board: LeaderboardBoard) => OrderedScoreStore;
	readonly details: DetailsStore;
}

export interface PostOutcome {
	/** The ordered entry went up (a new personal best). */
	readonly improved: boolean;
	/** The details document was written. */
	readonly detailsWritten: boolean;
}

/**
 * Writes one personal best: the ordered entry if the value is higher, then the details document if its stored value
 * is lower. A retry after a half-done attempt (ordered written, details failed) finds the ordered value EQUAL and
 * still writes the details. Throws what the stores throw (the write queue retries).
 */
export function postPersonalBest(stores: LeaderboardStores, job: PostJob): PostOutcome {
	let improved = false;
	let equal = false;
	stores.ordered(job.board).update(
		orderedKey(job.userId),
		(old) => {
			// UpdateAsync may run the transform more than once: only the last run counts.
			improved = isBetterValue(job.value, old);
			equal = asOrderedValue(old) === job.value;
			return improved ? job.value : undefined;
		},
		[job.userId],
	);
	if (!improved && !equal) return { improved: false, detailsWritten: false };
	let written = false;
	stores.details.update(
		detailsKey(job.board, job.userId),
		(old) => {
			const stored = detailsValue(old);
			written = stored === undefined || stored < job.value;
			return written ? job.details : undefined;
		},
		[job.userId],
	);
	return { improved, detailsWritten: written };
}
