/**
 * Posting a validated run to the leaderboards (M5): who may post, which board, the personal-best rule, and the two
 * DataStore writes of one personal best. Pure: the stores are interfaces (LeaderboardService passes DataStore
 * adapters; the specs an in-memory fake), so the rules are tested headlessly.
 *
 * Personal best: one entry per player per board. A post replaces it only when its ordered value is HIGHER (a higher
 * score; at an equal score a deeper floor; never a later equal run). A co-op run posts one entry for EVERY member to
 * the co-op board (each member's co-op best). The checks run inside UpdateAsync, so concurrent servers never lower a
 * best.
 *
 * Daily runs (docs/DAILY.md DS5): a run of a `dailyWorlds` world posts to ITS day's daily board only (the session's
 * day and ruleset, DSD5 / DSD11), with the same rule and value and no details document (DSD12). It never posts to the
 * all-time boards, and an endless run never posts to a daily board (DSD6).
 *
 * @module
 */
import type { DailyRunKey } from "shared/daily";
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
import { ALLTIME_SCOPE, alltimeBoard, dailyBoard, type BoardRef } from "./scope";

/** One player of a posted run, as stored with the entry. */
export interface LeaderboardMember {
	userId: number;
	name: string;
	/**
	 * The character this member played (a shared/characters CharacterId; docs/ARCHER.md AR5, owner answer 4: one
	 * board, the character shown). Every member of a party entry carries their own; absent for a run without
	 * characters (M1) and older entries.
	 */
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
	/** Daily runs: the session's day and ruleset (the board's scope, DSD5). Ignored outside the daily worlds. */
	readonly daily?: DailyRunKey;
}

/** One personal-best write: `userId`'s entry on `board` under `scope`. */
export interface PostJob {
	readonly board: LeaderboardBoard;
	/** ALLTIME_SCOPE, or the daily board's dailyScope(day, ruleset). */
	readonly scope: string;
	readonly userId: number;
	readonly value: number;
	/** The all-time details document; daily boards keep none (DSD12). */
	readonly details?: LeaderboardEntryDetails;
}

/** The board a job writes. */
export function jobBoard(job: PostJob): BoardRef {
	return { board: job.board, scope: job.scope };
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
	| "contributors"
	/** A daily-world run without its session's daily key (day and ruleset): it has no board to post to. */
	| "daily_key";

/**
 * The facts about a finished, validated run that decide whether it may post (`leaderboardEligibility`). The server
 * fills it from its own replay and from the server it runs on; nothing here comes from a client claim.
 */
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
	/** Daily runs: the session's day and ruleset. */
	readonly daily?: DailyRunKey;
}

/**
 * Whether a validated run may post, under `policy`: undefined when it posts, else the first reason it does not. Checked
 * in this order: the world (neither an all-time nor a daily world), debug limits, Studio, a private server, a party
 * size outside 1 to `MAX_PARTY_SIZE`, an abandoned run (a death-only world counts only a death as finished, a boss kill
 * there is not an end), a party run with fewer than `COOP_MIN_PARTY` contributors, and a daily-world run without its
 * daily key. Shared so the server decides with it and the specs test the rules headlessly.
 */
export function leaderboardEligibility(
	ctx: PostContext,
	policy: LeaderboardPolicy = LEADERBOARD_POLICY,
): IneligibleReason | undefined {
	const daily = policy.dailyWorlds.includes(ctx.worldKind);
	if (!daily && !policy.eligibleWorlds.includes(ctx.worldKind)) return "world";
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
	if (daily && ctx.daily === undefined) return "daily_key";
	return undefined;
}

/**
 * The board an eligible run posts to: its day's daily board for a `dailyWorlds` run with a daily key (DSD5 / DSD6),
 * else the all-time board of its party size. An endless run never gets a daily board, whatever key it carries.
 */
export function postTarget(
	run: Pick<VerifiedRunPost, "worldKind" | "daily" | "partySize" | "members">,
	policy: LeaderboardPolicy = LEADERBOARD_POLICY,
): BoardRef {
	const board = boardForParty(run.partySize ?? run.members.size());
	if (policy.dailyWorlds.includes(run.worldKind) && run.daily !== undefined) return dailyBoard(board, run.daily);
	return alltimeBoard(board);
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

/**
 * The personal-best writes for a validated run: one per credited member, on its board (postTarget): the party's
 * all-time board with a details document, or its day's daily board without one.
 */
export function planPosts(run: VerifiedRunPost, policy: LeaderboardPolicy = LEADERBOARD_POLICY): PostJob[] {
	const partySize = run.partySize ?? run.members.size();
	const target = postTarget(run, policy);
	const board = target.board;
	const value = encodeOrderedValue({ score: run.score, floor: run.floor, at: run.at });
	const jobs: PostJob[] = [];
	if (target.scope !== ALLTIME_SCOPE) {
		for (const m of run.members) jobs.push({ board, scope: target.scope, userId: m.userId, value });
		return jobs;
	}
	const members = run.members.map((m) => ({ ...m }));
	for (const m of run.members) {
		jobs.push({
			board,
			scope: ALLTIME_SCOPE,
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

/**
 * The DataStores one personal-best write touches, as `postPersonalBest` takes them. LeaderboardService passes adapters
 * over the real OrderedDataStores and the details DataStore; the specs pass an in-memory fake.
 */
export interface LeaderboardStores {
	/** The ordered store of a board and scope (the all-time stores unscoped, daily ones scoped by day and ruleset). */
	readonly ordered: (ref: BoardRef) => OrderedScoreStore;
	readonly details: DetailsStore;
}

/**
 * What one `postPersonalBest` call did. The write queue's loop hands it to the post waiters (the daily verdict reads
 * `improved` and `previous`); a write that threw has no outcome.
 */
export interface PostOutcome {
	/** The ordered entry went up (a new personal best). */
	readonly improved: boolean;
	/** The details document was written (always false for a daily job: no details). */
	readonly detailsWritten: boolean;
	/** The valid ordered value the write found (the last transform run's `old`); undefined: no entry before. */
	readonly previous?: number;
}

/**
 * Writes one personal best: the ordered entry if the value is higher, then the details document if its stored value
 * is lower. A retry after a half-done attempt (ordered written, details failed) finds the ordered value EQUAL and
 * still writes the details. Throws what the stores throw (the write queue retries).
 */
export function postPersonalBest(stores: LeaderboardStores, job: PostJob): PostOutcome {
	let improved = false;
	let equal = false;
	let previous: number | undefined;
	stores.ordered(jobBoard(job)).update(
		orderedKey(job.userId),
		(old) => {
			// UpdateAsync may run the transform more than once: only the last run counts.
			previous = asOrderedValue(old);
			improved = isBetterValue(job.value, old);
			equal = previous === job.value;
			return improved ? job.value : undefined;
		},
		[job.userId],
	);
	const details = job.details;
	if (details === undefined || (!improved && !equal)) return { improved, detailsWritten: false, previous };
	let written = false;
	stores.details.update(
		detailsKey(job.board, job.userId),
		(old) => {
			const stored = detailsValue(old);
			written = stored === undefined || stored < job.value;
			return written ? details : undefined;
		},
		[job.userId],
	);
	return { improved, detailsWritten: written, previous };
}
