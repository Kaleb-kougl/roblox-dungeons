/**
 * Leaderboard tunables (M5). Data only: the pure modules here and LeaderboardService read these (CLAUDE.md "No magic
 * numbers"). docs/SERVER.md "Leaderboards" has the DataStore layout.
 */
import { KV_EPOCH_UNIX_SECONDS } from "shared/config";
import { DAILY_WORLD_KIND } from "shared/daily";
import { MAX_PARTY_SIZE } from "shared/run";

const SECONDS_PER_MINUTE = 60;

/** The two all-time boards: solo (party of 1) and co-op (party of COOP_MIN_PARTY..MAX_PARTY_SIZE). */
export type LeaderboardBoard = "solo" | "coop";
export const LEADERBOARD_BOARDS: ReadonlyArray<LeaderboardBoard> = ["solo", "coop"];

/** Smallest party that counts as co-op. */
export const COOP_MIN_PARTY = 2;
export { MAX_PARTY_SIZE };

/** OrderedDataStore per board (ranking). Key `u_<UserId>`, value = encodeOrderedValue (orderedValue.ts). */
export const LEADERBOARD_ORDERED_STORES: Readonly<Record<LeaderboardBoard, string>> = table.freeze({
	solo: "LB_Solo_v1",
	coop: "LB_Coop_v1",
});

/**
 * Daily boards (docs/DAILY.md DS5, DSD12): one OrderedDataStore per board, SCOPED by day and ruleset
 * (`GetOrderedDataStore(name, dailyScope(day, ruleset))`, scope `d<day>_r<ruleset>`). Key `u_<UserId>`, value =
 * encodeOrderedValue (the all-time layout). No details document: score and floor decode from the value.
 */
export const LEADERBOARD_DAILY_ORDERED_STORES: Readonly<Record<LeaderboardBoard, string>> = table.freeze({
	solo: "LB_Daily_Solo_v1",
	coop: "LB_Daily_Coop_v1",
});

/** The daily boards' score histograms (DS6): key `<board>_<scope>_s<shard>`, value `{ v, c: counts }`. */
export const LEADERBOARD_DAILY_HIST_STORE = "LB_Daily_Hist_v1";

/** Regular DataStore with each personal best's details. Key `<board>_u_<UserId>` (detailsKey). */
export const LEADERBOARD_DETAILS_STORE = "LB_Details_v1";

/** Rows per board read and shown. */
export const LEADERBOARD_TOP_COUNT = 100;

/** A board's top rows are cached this long per server (one GetSortedAsync per board per minute at most). */
export const LEADERBOARD_CACHE_SECONDS = SECONDS_PER_MINUTE;

/** A player's own entry (details) is cached this long (dropped at once when they post). */
export const LEADERBOARD_MINE_CACHE_SECONDS = SECONDS_PER_MINUTE;

/**
 * Personal-best writes per server (sliding window). Each job is 1-2 UpdateAsync calls (ordered + details); Roblox
 * allows 60 + 10 x players Set/Update calls a minute per server and DataStore type, shared with settings and runs.
 */
export const LEADERBOARD_WRITE_RATE = table.freeze({ count: 20, windowSeconds: 60 });

/** Retries of one failed personal-best write: tries, first backoff, cap (seconds, doubling). */
export const LEADERBOARD_WRITE_RETRY = table.freeze({ attempts: 5, baseDelaySeconds: 2, maxDelaySeconds: 60 });

/** How often the service's write loop looks at the queue (seconds). */
export const LEADERBOARD_PUMP_SECONDS = 1;

/**
 * On server shutdown (BindToClose) the flush waits for runs still validating (they may post) and drains the write
 * queue, ignoring the rate, for at most this long in all (Roblox gives BindToClose 30 s).
 */
export const LEADERBOARD_SHUTDOWN_FLUSH_SECONDS = 20;

/** getLeaderboard requests per player (sliding window); the answer is served from the cache anyway. */
export const LEADERBOARD_REQUEST_RATE = table.freeze({ count: 10, windowSeconds: 30 });

/** Retries of a leaderboard read (GetSortedAsync, details GetAsync). */
export const LEADERBOARD_READ_RETRY = table.freeze({ attempts: 3, baseDelaySeconds: 1 });

/**
 * Which posts are allowed. Only runs validated (segmented, by the server) in one of `eligibleWorlds` post; private
 * (VIP) servers, Studio and debug runs never do. Abandoned runs (neither died nor beat the boss) post only if
 * `postAbandoned`.
 */
export interface LeaderboardPolicy {
	readonly eligibleWorlds: ReadonlyArray<string>;
	readonly postFromStudio: boolean;
	readonly postFromPrivateServers: boolean;
	readonly postAbandoned: boolean;
	/**
	 * Worlds whose runs only END in death (the endless descent: a boss kill is a floor of the run, not its end). A run
	 * of one of these posts only when it died (the whole party wiped); otherwise it was abandoned, boss kill or not.
	 */
	readonly deathOnlyWorlds: ReadonlyArray<string>;
	/**
	 * Worlds whose runs post to their day's DAILY board only (never the all-time boards, DSD6), by the run's own
	 * daily key (the session's day and ruleset, never the clock at finish: DSD5). Not in `eligibleWorlds`.
	 */
	readonly dailyWorlds: ReadonlyArray<string>;
}

/**
 * Worlds that end only in death: the endless descent and the Daily (a boss kill raises the Depth and the run goes on).
 * shared/records reads it too; harmless there, its own eligible worlds stay endless-only.
 */
export const LEADERBOARD_DEATH_ONLY_WORLDS: ReadonlyArray<string> = ["endless", DAILY_WORLD_KIND];

/**
 * World kinds whose validated runs post to the daily boards (DS5). Kept apart from LEADERBOARD_ELIGIBLE_WORLDS (the
 * all-time boards), which shared/records RECORDS_POLICY reuses: daily runs never write records (DSD6).
 */
export const LEADERBOARD_DAILY_WORLDS: ReadonlyArray<string> = [DAILY_WORLD_KIND];

/**
 * World kinds whose validated runs post: the endless descent only (the M5 slice's world, always scored). The M1 "game"
 * run is unscored (its readRunScore is 0), so it never posts.
 */
export const LEADERBOARD_ELIGIBLE_WORLDS: ReadonlyArray<string> = ["endless"];

export const LEADERBOARD_POLICY: LeaderboardPolicy = table.freeze({
	eligibleWorlds: LEADERBOARD_ELIGIBLE_WORLDS,
	postFromStudio: false,
	postFromPrivateServers: false,
	postAbandoned: false,
	deathOnlyWorlds: LEADERBOARD_DEATH_ONLY_WORLDS,
	dailyWorlds: LEADERBOARD_DAILY_WORLDS,
});

/**
 * The ordered value's bit layout (orderedValue.ts): score, then floor, then inverted submission time, in 53 bits
 * (OrderedDataStore values are integers; Luau numbers are exact to 2^53). Defaults: score < 2^27 (134,217,728),
 * floor < 2^10 (1,024), time in 2-hour slots from 2026-01-01 UTC for 2^16 slots (~15 years). Values outside clamp.
 */
export interface OrderedValueLayout {
	readonly scoreBits: number;
	readonly floorBits: number;
	readonly timeBits: number;
	readonly timeSlotSeconds: number;
	/** Unix seconds of time slot 0. */
	readonly epochSeconds: number;
}

/** 2026-01-01T00:00:00Z (shared/config KV_EPOCH_UNIX_SECONDS: also day 0 of the Daily, shared/daily). */
const LEADERBOARD_EPOCH = KV_EPOCH_UNIX_SECONDS;
const TWO_HOURS = 7200;

export const ORDERED_VALUE_LAYOUT: OrderedValueLayout = table.freeze({
	scoreBits: 27,
	floorBits: 10,
	timeBits: 16,
	timeSlotSeconds: TWO_HOURS,
	epochSeconds: LEADERBOARD_EPOCH,
});

/** Bits of an exactly representable integer in a double (2^53). */
export const ORDERED_VALUE_MAX_BITS = 53;

/** Entry details document version. */
export const LEADERBOARD_DETAILS_VERSION = 1;
