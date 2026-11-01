/**
 * The Daily's menu and result string ids (docs/DAILY.md DS9 / DS11 / DS12): every key the main menu's Daily card and
 * podium, the leaderboard panel's daily tabs, the lobby world toggle and the run-over daily block read. All REQUIRED
 * (shared/theme DAILY_STRING_KEYS, the same keys in dailyStringKeys() order; daily.spec.ts checks it), so no slot ever
 * shows a raw key. The in-run rank layer's strings (DS10) are not here.
 */

export const DAILY_STRINGS = {
	cardTitle: "daily.card.title",
	cardRoster: "daily.card.roster",
	cardBoss: "daily.card.boss",
	cardBest: "daily.card.best",
	cardBestScore: "daily.card.bestScore",
	cardNotPlayed: "daily.card.notPlayed",
	cardLoading: "daily.card.loading",
	resetsIn: "daily.card.resetsIn",
	play: "daily.card.play",
	playParty: "daily.card.playParty",
	standingRank: "daily.standing.rank",
	standingPercentile: "daily.standing.percentile",
	standingRankOf: "daily.standing.rankOf",
	date: "daily.date.format",
	podiumTitle: "daily.podium.title",
	podiumMine: "daily.podium.mine",
	podiumMineScore: "daily.podium.mineScore",
	podiumRow: "daily.podium.row",
	resultTitle: "daily.result.title",
	resultRank: "daily.result.rank",
	resultPercentile: "daily.result.percentile",
	resultRankOf: "daily.result.rankOf",
	resultEntrants: "daily.result.entrants",
	resultImproved: "daily.result.improved",
	resultFirstBest: "daily.result.firstBest",
	resultBest: "daily.result.best",
	resultSaved: "daily.result.saved",
	resultUnsaved: "daily.result.unsaved",
	retry: "daily.result.retry",
	tabToday: "daily.tab.today",
	tabYesterday: "daily.tab.yesterday",
	tabAlltime: "daily.tab.alltime",
	tabGlobal: "daily.tab.global",
	tabFriends: "daily.tab.friends",
	boardPending: "daily.board.pending",
	boardTotal: "daily.board.total",
	boardMine: "daily.board.mine",
	boardMineScore: "daily.board.mineScore",
	boardMineNone: "daily.board.mineNone",
	boardEmpty: "daily.board.empty",
	boardFriendsEmpty: "daily.board.friendsEmpty",
	lobbyWorld: "daily.lobby.world",
	lobbyWorldShown: "daily.lobby.worldShown",
} as const;

/** Weekday name ids, Monday first (`daily.date.weekday.<id>`). */
export const DAILY_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Month name ids, January first (`daily.date.month.<id>`). */
export const DAILY_MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
] as const;

/** A lobby world's name (`daily.lobby.world.<kind>`: endless / daily). */
export function dailyLobbyWorldKey(world: string): string {
	return `daily.lobby.world.${world}`;
}

/** The weekday name key for index `i` (0 = Monday). */
export function dailyWeekdayKey(i: number): string {
	return `daily.date.weekday.${DAILY_WEEKDAYS[i]}`;
}

/** The month name key for month `m` (1 = January). */
export function dailyMonthKey(m: number): string {
	return `daily.date.month.${DAILY_MONTHS[m - 1]}`;
}

/** The lobby worlds the toggle offers, in order (shared/lobby LOBBY_WORLDS; repeated so the view imports no lobby). */
const LOBBY_WORLD_IDS = ["endless", "daily"] as const;

/** Every Daily menu / result key, in the theme's DAILY_STRING_KEYS order. */
export function dailyStringKeys(): string[] {
	const K = DAILY_STRINGS;
	const keys: string[] = [
		K.cardTitle,
		K.cardRoster,
		K.cardBoss,
		K.cardBest,
		K.cardBestScore,
		K.cardNotPlayed,
		K.cardLoading,
		K.resetsIn,
		K.play,
		K.playParty,
		K.standingRank,
		K.standingPercentile,
		K.standingRankOf,
		K.date,
	];
	for (let i = 0; i < DAILY_WEEKDAYS.size(); i++) keys.push(dailyWeekdayKey(i));
	for (let m = 1; m <= DAILY_MONTHS.size(); m++) keys.push(dailyMonthKey(m));
	const rest: string[] = [
		K.podiumTitle,
		K.podiumMine,
		K.podiumMineScore,
		K.podiumRow,
		K.resultTitle,
		K.resultRank,
		K.resultPercentile,
		K.resultRankOf,
		K.resultEntrants,
		K.resultImproved,
		K.resultFirstBest,
		K.resultBest,
		K.resultSaved,
		K.resultUnsaved,
		K.retry,
		K.tabToday,
		K.tabYesterday,
		K.tabAlltime,
		K.tabGlobal,
		K.tabFriends,
		K.boardPending,
		K.boardTotal,
		K.boardMine,
		K.boardMineScore,
		K.boardMineNone,
		K.boardEmpty,
		K.boardFriendsEmpty,
		K.lobbyWorld,
		K.lobbyWorldShown,
	];
	for (const k of rest) keys.push(k);
	for (const w of LOBBY_WORLD_IDS) keys.push(dailyLobbyWorldKey(w));
	return keys;
}
