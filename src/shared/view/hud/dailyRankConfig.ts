/**
 * The Daily's in-run rank layer tunables (docs/DAILY.md DS10): the rank thresholds that shout, the floor shout slot's
 * priorities (new best > rank threshold > combo tier), the friend toasts' pacing and headshots, the run-over row of
 * friends passed, and the Studio debug attribute. Data only; the tracker and helpers are dailyRank.ts. Presentation
 * only: no number here changes the sim, the score, a board or a record.
 */

/** The theme colour role of the rank layer's target row and threshold shouts (new best's gold: you are past your best). */
export const DAILY_RANK_ROLE = "newBest";

/**
 * Priorities in the floor shout slot (ComboController.requestShout): a higher one replaces a lower one showing or
 * asked for on the same frame, a lower one is dropped while a higher shows. A combo tier shout is below all (0). The
 * Horde's shouts (docs/FORTUNE.md FO7: HORDE x2 on rousing, WAVE 2 at the telegraph) rank over the rank threshold
 * (they tell of new enemies) and under new best. The Goldling (FO8): its appearance's GOLDLING! is a call to act
 * within its 10 s, so it outranks every celebration (the new best keeps its fanfare and score-panel stamp); its escape
 * line is news like a rank threshold (the later of the two on one frame wins).
 */
export const FLOOR_SHOUT_PRIORITY = {
	comboTier: 0,
	rankThreshold: 1,
	horde: 2,
	newBest: 3,
	goldenAppear: 4,
	goldenEscaped: 1,
} as const;

export const DAILY_RANK = {
	/**
	 * Rank thresholds, highest rank number first: entering the top 100, top 10, top 3, #1. Each shouts once per run, and
	 * only when the board had at least that many other entries at run start (passing someone is the point: an empty
	 * board's first run is not #1 news).
	 */
	thresholds: [100, 10, 3, 1] as ReadonlyArray<number>,
	/** The threshold shout's life in the floor shout slot (new best's NEW BEST! is NEW_BEST.shout.lifeSec). */
	shoutLifeSec: 1.2,
	/** A friend toast stays this long; the next queued one follows `toastGapSec` after it ends. */
	toastSeconds: 3,
	toastGapSec: 0.25,
	/** Toast ids count down from here (apart from the progression toasts and the sightings: SIGHTING_VIEW.toastIdBase). */
	toastIdBase: -(2 ** 21),
	/** The toast's headshot (Players:GetUserThumbnailAsync HeadShot 48x48), reference px. */
	toastHeadshotPx: 28,
	/** Headshots fetched at run start for the nearest friends still ahead of best today (the rest on demand). */
	headshotPrefetch: 8,
	/** The run-over row of friends passed this run: headshots shown, then `+{n} more`. */
	passedShown: 3,
	passedHeadshotPx: 32,
	/** Each friend's cell in that row (the headshot centred over the name, which shrinks to fit), reference px. */
	passedCellPx: 72,
	/**
	 * Studio check aid (CLAUDE.md working agreement: off by default). The Workspace string attribute forces a daily
	 * run's rank baseline (parseDailyRankDebug): "rows:<count>:<step>" (count rows scored step x count down to step),
	 * optional "friends:<every>" (every n-th row a friend), "best:<score>" (best today; also new best's baseline).
	 */
	debugAttribute: "KV_DailyRankDebug",
} as const;
