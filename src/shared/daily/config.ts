/**
 * Daily tunables (docs/DAILY.md "2. The day and the daily seed"). Data only: day.ts, seed.ts and the services read
 * these (CLAUDE.md "No magic numbers"). The daily seed's KEY is not here: it lives in the server only
 * (src/server/config/daily.ts, DSD8), so no client can compute a day's seed before the server reveals it.
 */
import { KV_EPOCH_UNIX_SECONDS, SECONDS_PER_DAY } from "shared/config";

export interface DailyConfig {
	/** Unix seconds of day 0's start (UTC midnight): the leaderboard's epoch, 2026-01-01 (shared/config). */
	readonly epochSeconds: number;
	/** Seconds per day: days roll over at UTC midnight (DSD5). */
	readonly secondsPerDay: number;
	/**
	 * The ruleset in the daily board scope (DSD11). Bump it with any change that alters endless play, so a daily board
	 * never mixes two rulesets (servers on the old build keep their old scope).
	 */
	readonly ruleset: number;
	/** Shown number = day + this (day 0, 2026-01-01, is Daily #1; 2026-10-31 is Daily #304). */
	readonly labelOffset: number;
	/**
	 * Yesterday's board (rows, the caller's entry, its histogram) is cached this long per server (DS5 / DS8): it stops
	 * changing once the day is over (only runs started before midnight still post to it).
	 */
	readonly yesterdayCacheSeconds: number;
	/** Fewer entrants than this: no percentile, only `#rank of total` when the rank is exact (DSD15). */
	readonly minEntrantsForPercentile: number;
	/** Rows on yesterday's podium (DS8). */
	readonly podiumSize: number;
	/**
	 * Whether the Daily's seeded roster keeps the room kinds' unlock floors (shared/dungeon ROOM_KIND_UNLOCK_FLOOR,
	 * DSD9). False (owner, 2026-11-11, DSD17): the day's seed alone orders the pool, so floor 1's seeded kind may be any
	 * of the ten and every later join is the next kind of the shuffle. Endless and dev follow the same rule since DSD18
	 * (shared/run ENDLESS_ROSTER_UNLOCK_FLOORS).
	 */
	readonly rosterUnlockFloors: boolean;
}

export const DAILY: DailyConfig = table.freeze({
	epochSeconds: KV_EPOCH_UNIX_SECONDS,
	secondsPerDay: SECONDS_PER_DAY,
	// 2: breakable loot (docs/BREAKABLE_DROPS.md) changes endless play. 3: solid decor and room themes (docs/DECOR.md
	// "Solid decor", "Room themes") change endless layouts and breakables, and five new room enemies with a reshuffled
	// seeded roster (docs/NEW_ENEMIES.md NE7, NED12) change endless rooms (one bump: none of them has shipped).
	// 4 (branch pellets only, never on main): pellets. 5: pellets merged onto main's 3 (docs/PELLETS.md PL5, PD10).
	// 6: bookcases, the library room theme and its reading area (docs/BOOKSHELVES.md) change endless layouts (on
	// main; treasure rooms' own 6, branch treasure-rooms only, never on main). 7: treasure rooms merged onto main's 6
	// (docs/TREASURE.md TR5: vaults, their chest piece and rewards change endless floors and play; kept at 7 on the
	// second merge, which brought the reading area: main stayed at 6).
	// 8: pacts and the Goldling merged onto main's 7 (docs/FORTUNE.md, FD15: endless shrines, rooms and scores change;
	// one bump for both; branch fortune's own 6 never shipped).
	// 9: two legendaries, Overkill and Bastion, and their four duos (docs/LEGENDARIES.md LGD11) change endless drafts.
	// 10: Bastion's brace needs 8 bullets, not 3 (docs/LEGENDARIES.md LGD6, owner 2026-11-06).
	// 11: the player's wall slide (docs/WALL_SLIDE.md WSD1: the player moves differently in every world); main's brace
	// threshold took 10.
	// 12: builds v2 wave 1 (docs/BUILDS_V2.md BVD20): Riposte, Ballista, Wrecker and seven duos change endless drafts.
	// 13: Kenney decor's Forge pieces (docs/KENNEY_DECOR.md KN5-KN8): library v2, mess halls and solid store stock change
	// endless layouts and spawns.
	// 14: the Archer (docs/ARCHER.md ARD11): a character per run (the Knight sword only, the Archer bow only with a
	// longer roll), weapon-tagged drafts; every endless run plays and draws differently.
	// 15: the Daily's roster ignores the unlock floors (docs/DAILY.md DSD17, rosterUnlockFloors): daily rooms change.
	// 16: floor modifiers (docs/FLOOR_MODIFIERS.md FM4: Gilded / Hoard / Feast / Plunder / Blood Moon floors change
	// endless floors, play and scores).
	// 17: one new seeded kind every floor, not every 2 (docs/DAILY.md DSD18, ROSTER.floorsPerKind 2 -> 1): daily rooms
	// change from floor 2.
	// 18: the Goldling hides in its own barrel or crate and comes out when a player breaks it (docs/GOLDLING_RUMOURS.md
	// GR1-GR3, RD10 / RD11): Goldling floors gain a piece and the Goldling no longer appears 3 s into the fight.
	// 19: secret rooms (docs/SECRET_ROOMS.md SR5: a cracked far wall on about one floor in five from floor 2, its chamber
	// and chest; the carved grid, the openers and the SECRET source change endless floors, play and scores).
	// 20: Silver (docs/SILVER.md: the heart cut, Knight 2 and Archer 1 1/2 hearts; Armory upgrades in every ranked world;
	// Silver in barrels and crates, the hashed `silver` group): daily play, hashes and scores change.
	// 21: new enemies 2 (docs/NEW_ENEMIES_2.md NX6, NXD16: the Shieldwall, Chainhook, Snatcher and Pyre-keeper join the
	// endless room pool; 14 seeded kinds reshuffle every roster, the Chainhook never on floor 1).
	// 22: new enemies 3 (docs/NEW_ENEMIES_3.md NT6, NTD14: the Mortar, Mender and Jackal pack join the endless room pool;
	// 17 seeded kinds reshuffle every roster, the Mender never on floor 1).
	// 23: the boss room's seal never leaves a straggler in a wall (boss/shared.ts sealPlayer: a clamp that lands the
	// body on a blocked cell moves it to the nearest open cell of the arena); co-op boss fights can replay differently.
	// 24: the Goldling's escape window 10 s -> 15 s (docs/FORTUNE.md FD17); daily play, hashes and scores change.
	// 25: Bastion's brace adds up 10 bullets over a room's guards and rolls, not 8 in one (docs/LEGENDARIES.md LGD15).
	ruleset: 25,
	labelOffset: 1,
	yesterdayCacheSeconds: 600,
	minEntrantsForPercentile: 20,
	podiumSize: 3,
	rosterUnlockFloors: false,
});

/**
 * The daily world's kind (shared/run worlds.ts): the endless descent (buildEndlessRunConfig) on the server's seed of
 * the day. shared/run `isEndlessWorld` is true for it.
 */
export const DAILY_WORLD_KIND = "daily";

/**
 * dailySeedFrom (seed.ts): seed = the first 4 bytes (a big-endian uint32) of HMAC-SHA256(key, messagePrefix ..
 * day), the day in decimal. The key is server-only and at least `minKeyBytes` long (128 bits: out of brute-force
 * reach). Changing the prefix changes every day's seed, like changing the key.
 */
export const DAILY_SEED = table.freeze({
	messagePrefix: "kv-daily|",
	minKeyBytes: 16,
});

/** Per player: `requestDaily` calls (sliding window; extra calls are dropped: the status is pushed anyway). */
export const DAILY_REQUEST_RATE = table.freeze({ count: 6, windowSeconds: 60 });

/** DailyService (server) pacing. */
export const DAILY_SERVICE = table.freeze({
	/** How often the server checks whether the UTC day changed (the midnight push goes out within this). */
	dayCheckSeconds: 1,
});

/** DailyController (client) pacing. */
export const DAILY_CLIENT = table.freeze({
	/** After the status's `resetsAt` passes on the server clock, ask again this much later (the push may race it). */
	resetRequestDelaySeconds: 2,
	/** While the answer is still the old day (its `resetsAt` already passed), ask again this often. */
	staleRetrySeconds: 15,
	/** No answer at all yet (join): ask again this often. */
	unansweredRetrySeconds: 30,
});

/*
 * DataStore budget (per server, per minute; Roblox: GetAsync 60 + 10 x players, Set / Update 60 + 10 x players,
 * GetSortedAsync 5 + 2 x players; each key at most one write per 6 s). OrderedDataStore calls count against the same
 * request types as regular DataStores (docs/DAILY.md DS0 confirms it on a published place). What the Daily adds:
 *
 *   writes   1 UpdateAsync per credited member of a finished daily run (the leaderboard write queue,
 *            LEADERBOARD_WRITE_RATE: the same as an endless post) + at most 1 histogram UpdateAsync per active board
 *            and scope per DAILY_HIST.flushSeconds (today solo / co-op; yesterday's around midnight): <= 3 a minute.
 *   sorted   1 GetSortedAsync per board and scope per cache period: today 60 s, yesterday DAILY.yesterdayCacheSeconds.
 *            Today solo + co-op + yesterday solo (the podium) <= 2.1 a minute.
 *   reads    the caller's own entry: 1 GetAsync per player, board and scope per 60 s (yesterday 600 s), only when asked
 *            (a view, the daily status); histogram: DAILY_HIST.shards GetAsync per board and scope per
 *            DAILY_HIST.cacheSeconds (8 a minute per board read; yesterday's every 600 s); friends: at most
 *            DAILY_FRIENDS.readsPerMinute GetAsync, shared by every player of the server.
 *
 * Every read is behind a cache (SharedTtlCache in LeaderboardService, the friends lookup cache).
 */

/** Score histogram per daily board (docs/DAILY.md "5. Percentile", shared/leaderboard histogram.ts). */
export const DAILY_HIST = table.freeze({
	/** Buckets per board (bucketOf: 0 below firstEdge, then 3 per doubling, the last one open-ended). */
	buckets: 64,
	/** Bucket 1 starts at 2^firstEdgeExponent (64); bucket 0 holds every lower score (0 included). */
	firstEdgeExponent: 6,
	/**
	 * Edges inside one doubling [2^k, 2^(k+1)): 2^k x numerators[i] / denominators[i] = 1, 5/4, 8/5 (ratios 1.25, 1.28,
	 * 1.25: log-uniform to within 3 %). Integer arithmetic (floor), so every server computes the same edges.
	 */
	edgeNumerators: [1, 5, 8] as ReadonlyArray<number>,
	edgeDenominators: [1, 4, 5] as ReadonlyArray<number>,
	/** Shard keys per board and scope (`<board>_<scope>_s<n>`): a server writes the one picked by its JobId. */
	shards: 8,
	/** A server flushes its buffered deltas this often (1 UpdateAsync per board and scope with deltas). */
	flushSeconds: 60,
	/** The summed shards (8 GetAsync) are cached this long per board and scope (yesterday: DAILY.yesterdayCacheSeconds). */
	cacheSeconds: 60,
	/** BindToClose: the histogram flush runs after the leaderboard flush, for at most this long. */
	shutdownFlushSeconds: 5,
	/** Stored shard document version (`{ v, c: counts[buckets] }`). */
	version: 1,
});

/** Friends on the daily boards (docs/DAILY.md "6. Friends", DSD16; shared/leaderboard friends.ts). */
export const DAILY_FRIENDS = table.freeze({
	/** Friends looked up per player (Roblox's friends-list limit): in-server friends first, then list order. */
	max: 200,
	/**
	 * Per-friend GetAsync reads on a day's ordered store, per server per minute (sliding window), shared by every
	 * player: a player with 200 friends none of whom is in the top rows fills in over ~200 / this minutes the first
	 * time, then from the cache. The lever if the budget is tight (with `max`).
	 */
	readsPerMinute: 30,
	/**
	 * A looked-up friend's entry (or "no entry") is cached per (board, scope, userId), shared by the server, and stays
	 * known (shown, frozen into run baselines) while anyone here needs it; once older than this it is re-read in the
	 * background, behind every never-read friend (stale-while-revalidate). Kept well above the time a full list takes
	 * to read, max / readsPerMinute minutes (400 s; friends.spec asserts at least twice that), so the oldest answers
	 * never come due before the last first reads.
	 */
	refreshSeconds: 900,
	/** The lookup queue is pumped this often (seconds). */
	pumpSeconds: 0.5,
	/** While a player's friends view is filling in, an updated view is pushed at most this often (seconds). */
	progressPushSeconds: 5,
	/**
	 * A friends view keeps being pushed as it fills in for this long after the request (seconds): longer than a full
	 * list takes to read on an idle budget (max / readsPerMinute minutes; friends.spec).
	 */
	watchSeconds: 480,
	/** The friends list (GetFriendsAsync, paged) is fetched once per player per session; retried after this on failure. */
	listRetrySeconds: 60,
	/** Studio only: Workspace attribute with UserIds standing in for the friends list (GetFriendsAsync fails there). */
	fakeAttribute: "KV_FakeFriends",
	/** KV_FakeFriends separator (spaces allowed around ids). */
	fakeSeparator: ",",
});

/** The verdict of a daily run (RunFinishVerdict.daily). */
export const DAILY_VERDICT = table.freeze({
	/**
	 * The verdict waits this long at most for the members' daily writes (they go through the leaderboard write queue,
	 * usually within a second or two), so it can say improved / previous / rank. Past it: `posted: false` (the write
	 * may still land; the next daily status shows it).
	 */
	waitSeconds: 15,
	/** How often the waiting verdict checks its writes (seconds). */
	pollSeconds: 0.25,
});
