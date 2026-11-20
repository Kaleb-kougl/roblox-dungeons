/**
 * Roblox port (docs/DAILY.md DS10, section 9): the Daily's in-run rank layer theme keys and new best's "best today"
 * wording for daily runs. Pure data with no runtime import, so contract.ts takes its string list
 * (DAILY_RANK_STRING_KEYS) for REQUIRED_STRING_KEYS with one import: its compiled Luau sits near Luau's
 * 200-locals-per-function limit. The two sounds are in contract.ts PORT_AUDIO_EVENTS (`sfx.rank.up`,
 * `sfx.friend.passed`).
 *
 * @module
 */

/**
 * Every rank-layer string (shared/view/hud DAILY_RANK_STRINGS, same order), all REQUIRED. New best on a daily run:
 * `hud.dailyRank.toGo` ("{points} TO BEST TODAY"), `.over` ("NEW BEST TODAY +{points}"), `.new` (compact passed),
 * `.shout` (the floor shout), `run.dailyRank.ribbon` / `.first` (run-over ribbons), `.score` (the record row, `{old}` /
 * `{new}` / `{delta}`), `.target` (the dim best-today line, `{score}`). The rank layer's target row: `hud.dailyRank.rung`
 * (`{from}`, `{to}`, `{points}`), `.rungShort` (`{to}`, `{points}`), `.top`, `.topShort`, `.friend` (`{name}`,
 * `{points}`), `.cutoff` (`{n}`, `{points}`), `.chaseShort` (`{points}`). Beats: the friend toast `hud.dailyRank.passed`
 * (`{name}`, `{score}`), the threshold shouts `hud.dailyRank.shout.100` / `.10` / `.3` / `.1`. Run over: the row of
 * friends passed, `run.dailyRank.passed` (its label) and `run.dailyRank.more` (`{n}`). The theme imports nothing
 * outside shared/theme, so the list is repeated here.
 */
export const DAILY_RANK_STRING_KEYS: ReadonlyArray<string> = [
	"hud.dailyRank.toGo",
	"hud.dailyRank.over",
	"hud.dailyRank.new",
	"hud.dailyRank.shout",
	"run.dailyRank.ribbon",
	"run.dailyRank.first",
	"run.dailyRank.score",
	"run.dailyRank.target",
	"hud.dailyRank.rung",
	"hud.dailyRank.rungShort",
	"hud.dailyRank.top",
	"hud.dailyRank.topShort",
	"hud.dailyRank.friend",
	"hud.dailyRank.cutoff",
	"hud.dailyRank.chaseShort",
	"hud.dailyRank.passed",
	"hud.dailyRank.shout.100",
	"hud.dailyRank.shout.10",
	"hud.dailyRank.shout.3",
	"hud.dailyRank.shout.1",
	"run.dailyRank.passed",
	"run.dailyRank.more",
];
