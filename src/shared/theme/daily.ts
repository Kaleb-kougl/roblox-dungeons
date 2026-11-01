/**
 * Roblox port (docs/DAILY.md DS9 / DS11 / DS12, section 9): the Daily's menu and result strings. Pure data with no
 * runtime import, so contract.ts takes its string list (DAILY_STRING_KEYS) for REQUIRED_STRING_KEYS with one import:
 * its compiled Luau sits near Luau's 200-locals-per-function limit. The in-run rank layer's strings (DS10) are in
 * their own file.
 */

/**
 * Every Daily menu / result string (shared/view/hud dailyStringKeys(), same order), all REQUIRED:
 *   daily.card.*      the main menu's Daily card: title (`{label}`, `{date}`), floor 1's roster (`{names}`), floor 5's
 *                     boss (`{floor}`, `{name}`), best today (`{score}`, `{standing}`), not played, the quiet placeholder,
 *                     the countdown (`{time}`), Play Daily, Daily with friends
 *   daily.standing.*  a board standing: `#{rank}`, `top {percent}%`, `#{rank} of {total}` (under 20 entrants, DSD15)
 *   daily.date.*      the UTC date (`daily.date.format`: `{weekday} {month} {date}`, the order translatable) and the
 *                     weekday / month names
 *   daily.podium.*    yesterday's podium: title (`{label}`), your final standing / score, a place's row (`{place}`
 *                     `{name}`)
 *   daily.result.*    the run-over daily block: title, rank / percentile / too few, entrants, best today lines, the
 *                     save chip, Retry Daily
 *   daily.tab.*       the leaderboard panel's scope (Today / Yesterday / All time) and filter (Global / Friends) tabs
 *   daily.board.*     the daily leaderboard tabs: friends pending, entrants, your best, empty boards
 *   daily.lobby.*     the lobby room's world toggle (host) / world line (others)
 * The theme imports nothing outside shared/theme, so the list is repeated here.
 */
export const DAILY_STRING_KEYS: ReadonlyArray<string> = [
	"daily.card.title",
	"daily.card.roster",
	"daily.card.boss",
	"daily.card.best",
	"daily.card.bestScore",
	"daily.card.notPlayed",
	"daily.card.loading",
	"daily.card.resetsIn",
	"daily.card.play",
	"daily.card.playParty",
	"daily.standing.rank",
	"daily.standing.percentile",
	"daily.standing.rankOf",
	"daily.date.format",
	"daily.date.weekday.mon",
	"daily.date.weekday.tue",
	"daily.date.weekday.wed",
	"daily.date.weekday.thu",
	"daily.date.weekday.fri",
	"daily.date.weekday.sat",
	"daily.date.weekday.sun",
	"daily.date.month.jan",
	"daily.date.month.feb",
	"daily.date.month.mar",
	"daily.date.month.apr",
	"daily.date.month.may",
	"daily.date.month.jun",
	"daily.date.month.jul",
	"daily.date.month.aug",
	"daily.date.month.sep",
	"daily.date.month.oct",
	"daily.date.month.nov",
	"daily.date.month.dec",
	"daily.podium.title",
	"daily.podium.mine",
	"daily.podium.mineScore",
	"daily.podium.row",
	"daily.result.title",
	"daily.result.rank",
	"daily.result.percentile",
	"daily.result.rankOf",
	"daily.result.entrants",
	"daily.result.improved",
	"daily.result.firstBest",
	"daily.result.best",
	"daily.result.saved",
	"daily.result.unsaved",
	"daily.result.retry",
	"daily.tab.today",
	"daily.tab.yesterday",
	"daily.tab.alltime",
	"daily.tab.global",
	"daily.tab.friends",
	"daily.board.pending",
	"daily.board.total",
	"daily.board.mine",
	"daily.board.mineScore",
	"daily.board.mineNone",
	"daily.board.empty",
	"daily.board.friendsEmpty",
	"daily.lobby.world",
	"daily.lobby.worldShown",
	"daily.lobby.world.endless",
	"daily.lobby.world.daily",
];
