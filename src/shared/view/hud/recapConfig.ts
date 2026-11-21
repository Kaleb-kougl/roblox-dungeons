/**
 * The run-over recap's tunables, highlight table and string keys (docs/RUN_RECAP.md RR2; logic in recap.ts).
 * Presentation only (RRD1): nothing here reaches the sim, a hash or the leaderboard. Times are real seconds from the
 * run-over frame; thresholds are tuned at RR10. Owner decisions: RRD6 (the 0.6 s arm), RRD8 (boss <= 25 %, score gap
 * <= 15 %, <= 2 rooms).
 *
 * @module
 */
import { SECRET_RECAP_KEY } from "shared/theme";

/**
 * The recap's tunables (`RECAP`; recap.ts takes another one in specs): the timeline's times in real seconds from the
 * run-over frame, the near-miss thresholds, the highlight counts and the retry levers.
 */
export interface RecapConfig {
	/** A confirm / FIRE press before this skips the timeline instead of retrying (RRD6). */
	readonly retryArmSec: number;
	/** The near-miss line fades up at this time (non-record runs). */
	readonly nearMissDelaySec: number;
	/** The near-miss line's number counts over this long. */
	readonly countSec: number;
	/** The first highlight shows at this time (non-record runs). */
	readonly highlightsStartSec: number;
	/** One highlight every this many seconds. */
	readonly highlightGapSec: number;
	/** Each highlight's number counts over this long. */
	readonly highlightCountSec: number;
	/** Record runs: the highlights start this long after new best's record rows finished. */
	readonly afterRecordRowsSec: number;
	/** Near-miss 1: the boss had at most this fraction of its hp left (RRD8). */
	readonly bossHpFraction: number;
	/** Near-miss 2: the gap to the best is at most this fraction of the best (RRD8). */
	readonly nearScoreFraction: number;
	/** Near-miss 4: the open stairwell was at most this many tiles away by walking path. */
	readonly stairsNearTiles: number;
	/** Near-miss 5: at most this many rooms of the floor were left uncleared (RRD8). */
	readonly roomsLeftMax: number;
	/** At most this many highlights. */
	readonly maxHighlights: number;
	/** Fill the grid to at least this many (Kills, Rooms cleared). */
	readonly minHighlights: number;
	/** RR8 lever: request the next solo session when the panel opens and use it on Again (RRD7; off until measured). */
	readonly prefetchSession: boolean;
	/**
	 * RR8 lever: a retry's run-start cover hold (the roster line's STAGE_LOADER.rosterStartSec, RR0 5) in seconds.
	 * Undefined: not decided, the stage loader's own hold applies. RR8 sets it from the measurement.
	 */
	readonly retryStartSec: number | undefined;
}

/**
 * The recap's tunables as shipped. Owner decisions: the 0.6 s arm (RRD6); a boss at 25 % health or less, a score gap of
 * 15 % or less and 2 rooms or fewer left count as near misses (RRD8). The rest is tuned at RR10.
 */
export const RECAP: RecapConfig = {
	retryArmSec: 0.6,
	nearMissDelaySec: 0.3,
	countSec: 0.3,
	highlightsStartSec: 0.7,
	highlightGapSec: 0.15,
	highlightCountSec: 0.25,
	afterRecordRowsSec: 0.2,
	bossHpFraction: 0.25,
	nearScoreFraction: 0.15,
	stairsNearTiles: 10,
	roomsLeftMax: 2,
	maxHighlights: 4,
	minHighlights: 2,
	prefetchSession: false,
	retryStartSec: undefined,
};

/** Studio / playtest aids (client only, off by default). */
export const RECAP_DEBUG = {
	/**
	 * RR8's measurement: a Workspace attribute; true makes a run-over retry print `[Recap] retry: press -> control
	 * <s> s` once the next run takes input (RecapController; read at the press).
	 */
	retryTimingAttribute: "KV_RetryTiming",
} as const;

/**
 * Every recap string key (the theme contract's `run.recap.*`, added by RR3; plain strings here, not the theme's key
 * union). Variables in braces; numbers are passed as numbers, `{boss}` as the boss's display name.
 */
export const RECAP_STRINGS = {
	/** "{boss} had {pct}% left" */
	nearBoss: "run.recap.near.boss",
	/** "{gap} pts short of your best" */
	nearScore: "run.recap.near.score",
	/** "One more floor for a new deepest" */
	nearRecordFloor: "run.recap.near.recordFloor",
	/** "{tiles} tiles from floor {next}" */
	nearStairs: "run.recap.near.stairs",
	/** "{rooms} rooms from a full clear" */
	nearFullClear: "run.recap.near.fullClear",
	/** "1 room from a full clear" */
	nearFullClearOne: "run.recap.near.fullClearOne",
	/** "1 floor from {boss}" */
	nearNextBoss: "run.recap.near.nextBoss",
	hlBossNoHit: "run.recap.hl.bossNoHit",
	hlBosses: "run.recap.hl.bosses",
	hlCombo: "run.recap.hl.combo",
	hlPerfect: "run.recap.hl.perfect",
	hlTeamPerfect: "run.recap.hl.teamPerfect",
	/** "{n} of {total}" */
	hlOfTotal: "run.recap.hl.ofTotal",
	/** "{n} pts" (a points value: the speed bonus) */
	hlPoints: "run.recap.hl.points",
	hlTeamStreak: "run.recap.hl.teamStreak",
	hlDuos: "run.recap.hl.duos",
	hlEvolved: "run.recap.hl.evolved",
	hlParries: "run.recap.hl.parries",
	hlSyncParries: "run.recap.hl.syncParries",
	hlSweeps: "run.recap.hl.sweeps",
	/** "Chests opened" (docs/TREASURE.md: vault chests opened this run) */
	hlChests: "run.recap.hl.chests",
	hlGrazes: "run.recap.hl.grazes",
	hlJackpots: "run.recap.hl.jackpots",
	hlSpeed: "run.recap.hl.speed",
	hlKills: "run.recap.hl.kills",
	hlRooms: "run.recap.hl.rooms",
	/** "Team" (a co-op highlight's team value) */
	team: "run.recap.team",
	/** "You" (a co-op highlight's own value) */
	you: "run.recap.you",
	/** "Details" (opens the breakdown and Build list, RRD5) */
	details: "run.recap.details",
	/** "Highlights" (closes them again) */
	detailsHide: "run.recap.detailsHide",
} as const;

/** Every RECAP_STRINGS value (for RR3's contract list). */
export function recapStringKeys(): string[] {
	const out: string[] = [];
	for (const [, key] of pairs(RECAP_STRINGS as unknown as ReadonlyMap<string, string>)) out.push(key);
	out.sort();
	return out;
}

/** A highlight's id (pickHighlights' output). */
export type RecapHighlightId =
	| "bossNoHit"
	| "bosses"
	| "combo"
	| "perfect"
	| "teamStreak"
	| "duos"
	| "evolved"
	| "parries"
	| "syncParries"
	| "sweeps"
	| "secrets"
	| "chests"
	| "grazes"
	| "jackpots"
	| "speed"
	| "kills"
	| "rooms";

/**
 * How a co-op run labels the highlight: `team` (the party's value: `Team`), `you` (the local player's own: `You`), or
 * `label` (the label itself says team: TEAM PERFECT, team streak, sync parries; no extra label). Solo runs label
 * nothing.
 */
export type RecapCoopScope = "team" | "you" | "label";

/** One row of RECAP_HIGHLIGHTS. */
export interface RecapHighlightDef {
	/** Priority (1 first). Entries sharing a priority are ONE slot: the first notable one of them shows. */
	readonly priority: number;
	readonly id: RecapHighlightId;
	/** The label's string key (RECAP_STRINGS). */
	readonly key: string;
	/** Co-op runs: the label's key instead of `key` (TEAM PERFECT rooms). */
	readonly coopKey?: string;
	/**
	 * The notable test's threshold, in the entry's own unit: a count (most), a combo TIER (combo: comboTier of the
	 * run's peak, COMBO_TIERS; 1 = x2 RAMPAGE), FAST awards = rooms under par (speed, whose value is points[FAST]).
	 */
	readonly min: number;
	/** Perfect: also notable when the perfect rooms are at least this share of the rooms cleared. */
	readonly minShare?: number;
	/** Shown only in a party run (Part B's team moments). */
	readonly coopOnly?: boolean;
	readonly coop: RecapCoopScope;
}

/** The highlights in priority order (docs/RUN_RECAP.md "Highlights"; thresholds tuned at RR10). */
export const RECAP_HIGHLIGHTS: ReadonlyArray<RecapHighlightDef> = [
	{ priority: 1, id: "bossNoHit", key: RECAP_STRINGS.hlBossNoHit, min: 1, coop: "team" },
	{ priority: 1, id: "bosses", key: RECAP_STRINGS.hlBosses, min: 1, coop: "team" },
	{ priority: 2, id: "combo", key: RECAP_STRINGS.hlCombo, min: 1, coop: "team" },
	{
		priority: 3,
		id: "perfect",
		key: RECAP_STRINGS.hlPerfect,
		coopKey: RECAP_STRINGS.hlTeamPerfect,
		min: 3,
		minShare: 0.5,
		coop: "label",
	},
	{ priority: 4, id: "teamStreak", key: RECAP_STRINGS.hlTeamStreak, min: 2, coopOnly: true, coop: "label" },
	{ priority: 5, id: "duos", key: RECAP_STRINGS.hlDuos, min: 1, coop: "you" },
	{ priority: 5, id: "evolved", key: RECAP_STRINGS.hlEvolved, min: 1, coop: "you" },
	{ priority: 6, id: "parries", key: RECAP_STRINGS.hlParries, min: 5, coop: "you" },
	{ priority: 7, id: "syncParries", key: RECAP_STRINGS.hlSyncParries, min: 1, coopOnly: true, coop: "label" },
	{ priority: 8, id: "sweeps", key: RECAP_STRINGS.hlSweeps, min: 1, coop: "team" },
	// docs/SECRET_ROOMS.md SR9 (SRD12): secret rooms opened this run (secretsRunSummary's `found`, the party's), before
	// the vault chests: a secret is the rarer find. Its label is the theme's SECRET_RECAP_KEY (`run.recap.hl.secrets`,
	// required with the secret-room strings, not in RECAP_STRING_KEYS).
	{ priority: 9, id: "secrets", key: SECRET_RECAP_KEY, min: 1, coop: "team" },
	// The slot docs/RUN_RECAP.md reserved for treasure rooms (docs/TREASURE.md: treasureRunSummary's `opened`).
	{ priority: 10, id: "chests", key: RECAP_STRINGS.hlChests, min: 1, coop: "team" },
	{ priority: 11, id: "grazes", key: RECAP_STRINGS.hlGrazes, min: 50, coop: "you" },
	{ priority: 12, id: "jackpots", key: RECAP_STRINGS.hlJackpots, min: 1, coop: "team" },
	{ priority: 13, id: "speed", key: RECAP_STRINGS.hlSpeed, min: 3, coop: "team" },
];

/** The fill rows (in order) that bring a short run's grid up to RECAP.minHighlights; never notable-tested. */
export const RECAP_FILL: ReadonlyArray<RecapHighlightDef> = [
	{ priority: 14, id: "kills", key: RECAP_STRINGS.hlKills, min: 0, coop: "team" },
	{ priority: 15, id: "rooms", key: RECAP_STRINGS.hlRooms, min: 0, coop: "team" },
];
