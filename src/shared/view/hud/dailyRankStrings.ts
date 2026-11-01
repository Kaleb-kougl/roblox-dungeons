/**
 * The Daily's in-run rank layer strings (docs/DAILY.md DS10) and new best's "best today" wording for daily runs
 * (DSD6). All REQUIRED (theme contract DAILY_RANK_STRING_KEYS, same order), so no slot ever shows a raw key.
 *
 *   new best (daily)  the score panel's target row before best today (`{points}`: the gap / margin), its compact
 *                     passed text, the floor shout, the run-over ribbon / first ribbon, the record row (`{old}` /
 *                     `{new}` / `{delta}`) and the dim target line (`{score}`, `{floor}`; also the pause overlay's);
 *   rank layer        the target row after best today: a rung (`{from}` -> `{to}`, `{points}` to go), #1, the next
 *                     friend (`{name}`) or the top-rows cut-off (`{n}`) beyond the rows read, their compact forms;
 *                     the friend toast (`{name}`, `{score}`); the threshold shouts (one per DAILY_RANK.thresholds);
 *                     the run-over row of friends passed (its label and `+{n} more`).
 */
export const DAILY_RANK_STRINGS = {
	// --- new best on a daily run (the baseline is best today) ---
	toGo: "hud.dailyRank.toGo",
	over: "hud.dailyRank.over",
	newBest: "hud.dailyRank.new",
	shout: "hud.dailyRank.shout",
	ribbon: "run.dailyRank.ribbon",
	first: "run.dailyRank.first",
	scoreRow: "run.dailyRank.score",
	target: "run.dailyRank.target",
	// --- the rank layer's target row ---
	rung: "hud.dailyRank.rung",
	rungShort: "hud.dailyRank.rungShort",
	top: "hud.dailyRank.top",
	topShort: "hud.dailyRank.topShort",
	friend: "hud.dailyRank.friend",
	cutoff: "hud.dailyRank.cutoff",
	chaseShort: "hud.dailyRank.chaseShort",
	// --- beats ---
	passed: "hud.dailyRank.passed",
	shout100: "hud.dailyRank.shout.100",
	shout10: "hud.dailyRank.shout.10",
	shout3: "hud.dailyRank.shout.3",
	shout1: "hud.dailyRank.shout.1",
	// --- run over ---
	passedLabel: "run.dailyRank.passed",
	passedMore: "run.dailyRank.more",
} as const;
