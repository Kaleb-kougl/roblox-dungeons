/**
 * The Daily's in-run rank layer tunables (docs/DAILY.md DS10): the rank thresholds that shout, the floor shout slot's
 * priorities (new best > rank threshold > combo tier), the friend toasts' pacing and headshots, the run-over row of
 * friends passed, and the debug attribute. Data only; the tracker and helpers are dailyRank.ts. Presentation
 * only: no number here changes the sim, the score, a board or a record.
 *
 * @module
 */

/** The theme colour role of the rank layer's target row and threshold shouts (new best's gold: you are past your best). */
export const DAILY_RANK_ROLE = "newBest";

/**
 * Priorities in the floor shout slot (ComboController.requestShout): a higher one replaces a lower one showing or
 * asked for on the same frame, a lower one is dropped while a higher shows. A combo tier shout is below all (0). The
 * Horde's shouts (docs/FORTUNE.md FO7: HORDE x2 on rousing, WAVE 2 at the telegraph) rank over the rank threshold
 * (they tell of new enemies) and under new best. The Goldling (FO8): its appearance's GOLDLING! is a call to act
 * within its 10 s, so it outranks every celebration (the new best keeps its fanfare and score-panel stamp); its escape
 * line is news like a rank threshold (the later of the two on one frame wins). Bastion's BRACED (docs/LEGENDARIES.md
 * LG6) is the lowest request: feedback on the player's own guard, so any news replaces it; it ranks with a tier shout
 * (the request path replaces a showing tier shout, and a later tier-up while it shows stays in the panel).
 * Builds v2, wave 1 (docs/BUILDS_V2.md BV11): COUNTER xN (Riposte's wave), PINNED and SLAM (Siege Bolt) are feedback
 * on the player's own move like BRACED, but its payoff: they rank between BRACED / a tier (0) and the rank threshold
 * (1), at 0.5, so a COUNTER replaces the BRACED of the Rebuke that fired it, a SLAM the PINNED before it (a tie: the
 * later wins), and any news (a rank threshold, the Horde, new best, the Goldling) replaces them and is never replaced
 * by one: they come with every guard and every Siege Bolt, the news once a run. A secret room's SECRET!
 * (docs/SECRET_ROOMS.md SR9) is a discovery: over the new best (a run's best can wait a second), under the Goldling's
 * appearance (its 10 s are running), at 3.5.
 */
export const FLOOR_SHOUT_PRIORITY = {
	comboTier: 0,
	brace: 0,
	rankThreshold: 1,
	horde: 2,
	newBest: 3,
	goldenAppear: 4,
	/** docs/SECRET_ROOMS.md SR9: SECRET! at a secret room's open (see above). */
	secret: 3.5,
	goldenEscaped: 1,
	/** docs/BUILDS_V2.md BV11: Riposte's COUNTER xN, Siege Bolt's PINNED and SLAM (see above). */
	counter: 0.5,
	pinned: 0.5,
	slam: 0.5,
} as const;

/**
 * The Daily's in-run rank layer tunables: the rank thresholds that shout, the shout's and the friend toasts' timings
 * (real seconds), the toast id base, the headshot and run-over row sizes (reference px before the HUD scale) and
 * counts, and the debug attribute's name.
 */
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
	 * Check aid, off by default, read wherever it is set (local effect). The Workspace string attribute forces a daily
	 * run's rank baseline (parseDailyRankDebug): "rows:<count>:<step>" (count rows scored step x count down to step),
	 * optional "friends:<every>" (every n-th row a friend), "best:<score>" (best today; also new best's baseline).
	 */
	debugAttribute: "KV_DailyRankDebug",
} as const;
