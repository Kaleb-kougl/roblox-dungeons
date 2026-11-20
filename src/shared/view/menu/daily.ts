/**
 * The main menu's Daily card and yesterday's podium strip, and the lobby room's world toggle (docs/DAILY.md DS9,
 * DSD14 / DSD15). Pure (daily.spec.ts): client/ui/menu hands in the Reflex daily status, today's day index from the
 * server clock and the string lookup, and draws what these return. The countdown is the client's per-second binding
 * (shared/view/hud dailyCountdownLine), never a re-render.
 *
 *   dailyPreview     today's seed -> floor 1's roster (shared/dungeon endlessRoster, join order) and the first boss
 *                    floor's boss (bossKindFor(floorSeed(seed, BOSS_FLOOR_EVERY)), DSD14)
 *   dailyCardModel   the card's lines: `DAILY #304 · Sat Oct 31`, `Floor 1: Swarmer · Sniper`, `Floor 5 boss: The
 *                    Demon Lord`, `Your best today 23,410 · #41` / `· top 9%` / `· #3 of 12` / `Not played yet`
 *   dailyPodiumModel yesterday's top 3 (fewer when fewer played; hidden when nobody did) and `You finished #57`
 *   lobbyWorldModel  the lobby's world: the host's toggle while forming, a line for the others
 *
 * Unknown parts say nothing: no status (not answered yet) or a stale one (its day is over: the server's push or the
 * client's re-request is on its way) keeps the title and the countdown from day math and a quiet placeholder; a status
 * without `mine` (no DataStore: Studio, an outage) shows no best line; Play solo never waits on any of it.
 *
 * @module
 */
import { BOSS_FLOOR_EVERY, bossKindFor, endlessRoster, floorSeed } from "shared/dungeon";
import { DAILY, dailyLabel, type DailyMineEntry, type DailyPodium, type DailyStatus } from "shared/daily";
import type { LobbyVisibility } from "shared/lobby";
import { formatThousands } from "shared/l10n";
import {
	DAILY_STRINGS,
	ROSTER_STRINGS,
	STANDING_KEYS,
	dailyDateText,
	dailyLobbyWorldKey,
	dailyText,
	rosterNames,
	standingOf,
	type DailyStr,
} from "shared/view/hud";

/** The Daily menu's tunables. */
export const DAILY_MENU = {
	/** "Daily with friends" creates a lobby with this visibility (the host's friends can see and join it). */
	partyVisibility: "friends" as LobbyVisibility,
	/** Yesterday's podium headshots (reference px). */
	headshotSize: 40,
	/** Compact (phone) podium headshots. */
	headshotCompact: 28,
	/** The desktop Daily card's column (reference px): beside the main menu's button column. */
	cardWidth: 340,
	/** Play Daily / Daily with friends side by side in the card (reference px). */
	cardButton: { x: 162, y: 40 },
	/** A podium cell: headshot over name and score (reference px). */
	podiumCellWidth: 104,
	/** The compact podium: three cells in a row, headshot beside the text. */
	podiumCompactCellWidth: 168,
	/** Between a podium cell's lines (reference px). */
	podiumLineGap: 2,
} as const;

/** Today's preview from the day's seed. */
export interface DailyPreview {
	/** Floor 1's roster, join order (swarmer first). */
	readonly roster: ReadonlyArray<string>;
	/** The first boss floor (5) and its boss's archetype id (`boss.act1` / `boss.demonlord`). */
	readonly bossFloor: number;
	readonly boss: string;
}

/**
 * Floor 1's roster and the first boss floor's boss for run seed `seed` (the Daily's seed of the day). The roster follows
 * the Daily's rule (DAILY.rosterUnlockFloors, docs/DAILY.md DSD17), like the daily world's floors.
 */
export function dailyPreview(seed: number): DailyPreview {
	const bossFloor = BOSS_FLOOR_EVERY;
	return {
		roster: endlessRoster(seed, 1, DAILY.rosterUnlockFloors),
		bossFloor,
		boss: bossKindFor(floorSeed(seed, bossFloor)),
	};
}

/**
 * Today's Daily run seed from `status` (the Reflex daily slice) on day `today` (dailyDay(GetServerTimeNow())): the
 * seed while the status is today's, else undefined (not answered yet, or a stale status whose day is over). The stage
 * loader's menu prefetch reads it to queue the Daily's own first floor (docs/STAGE_ASSETS.md SA7).
 */
export function todaysDailySeed(status: DailyStatus | undefined, today: number): number | undefined {
	return status !== undefined && status.day === today ? status.seed : undefined;
}

/** The Daily card's text ("" for a line that is not shown). */
export interface DailyCardModel {
	/** `DAILY #304 · Sat Oct 31` (always: computable from the server clock alone). */
	readonly title: string;
	/** Today's status is in hand (the preview lines can show). */
	readonly known: boolean;
	readonly roster: string;
	readonly boss: string;
	/** The compact card's one preview line: roster and boss joined by `roster.separator` ("" until known). */
	readonly preview: string;
	/** `Your best today 23,410 · #41`, `Not played yet`, or "" when unknown (no DataStore). */
	readonly best: string;
	/** The quiet placeholder while today's status is unknown ("" otherwise). */
	readonly placeholder: string;
	/** The status's `resetsAt` while it is today's (the countdown's end; day math otherwise). */
	readonly resetsAt: number | undefined;
}

/** A score and, when known, where it stands: `Your best today 23,410 · #41` (DSD15 forms). */
function bestToday(entry: DailyMineEntry, s: DailyStr): string {
	const score = formatThousands(entry.score);
	const standing = standingOf(entry, STANDING_KEYS);
	return standing !== undefined
		? s(DAILY_STRINGS.cardBest, { score, standing: dailyText(standing, s) })
		: s(DAILY_STRINGS.cardBestScore, { score });
}

/** The Daily card for `status` (the Reflex daily slice) on day `today` (dailyDay(GetServerTimeNow())). */
export function dailyCardModel(status: DailyStatus | undefined, today: number, s: DailyStr): DailyCardModel {
	const current = status !== undefined && status.day === today ? status : undefined;
	const title = s(DAILY_STRINGS.cardTitle, { label: dailyLabel(today), date: dailyDateText(today, s) });
	if (current === undefined) {
		return {
			title,
			known: false,
			roster: "",
			boss: "",
			preview: "",
			best: "",
			placeholder: s(DAILY_STRINGS.cardLoading),
			resetsAt: undefined,
		};
	}
	const preview = dailyPreview(current.seed);
	const names = rosterNames(preview.roster, s);
	const mine = current.mine;
	let best = "";
	if (mine !== undefined) best = mine.solo !== undefined ? bestToday(mine.solo, s) : s(DAILY_STRINGS.cardNotPlayed);
	const roster = s(DAILY_STRINGS.cardRoster, { names });
	const boss = s(DAILY_STRINGS.cardBoss, { floor: preview.bossFloor, name: s(`${preview.boss}.name`) });
	return {
		title,
		known: true,
		roster,
		boss,
		preview: `${roster}${s(ROSTER_STRINGS.separator)}${boss}`,
		best,
		placeholder: "",
		resetsAt: current.resetsAt,
	};
}

/** One podium place. */
export interface DailyPodiumRow {
	/** 1-based. */
	readonly place: number;
	readonly userId: number;
	readonly name: string;
	/** `#1`. */
	readonly placeText: string;
	/** The compact row: `#1 Name` (`daily.podium.row`). */
	readonly line: string;
	/** `23,410`. */
	readonly score: string;
}

export interface DailyPodiumModel {
	/** `Yesterday's podium · Daily #303`. */
	readonly title: string;
	/** Highest first; 1 to DAILY.podiumSize rows. */
	readonly rows: ReadonlyArray<DailyPodiumRow>;
	/** `You finished #57` / `You finished top 12%` / `You scored 8,120`, or "" when you did not play. */
	readonly mine: string;
}

/** Yesterday's podium strip, or undefined (hidden) when unknown or nobody played. */
export function dailyPodiumModel(podium: DailyPodium | undefined, s: DailyStr): DailyPodiumModel | undefined {
	if (podium === undefined || podium.top.size() === 0) return undefined;
	const rows = podium.top.map((e, i): DailyPodiumRow => {
		const placeText = s(DAILY_STRINGS.standingRank, { rank: i + 1 });
		return {
			place: i + 1,
			userId: e.userId,
			name: e.name,
			placeText,
			line: s(DAILY_STRINGS.podiumRow, { place: placeText, name: e.name }),
			score: formatThousands(e.score),
		};
	});
	let mine = "";
	if (podium.mine !== undefined) {
		const standing = standingOf(podium.mine, STANDING_KEYS);
		mine =
			standing !== undefined
				? s(DAILY_STRINGS.podiumMine, { standing: dailyText(standing, s) })
				: s(DAILY_STRINGS.podiumMineScore, { score: formatThousands(podium.mine.score) });
	}
	return { title: s(DAILY_STRINGS.podiumTitle, { label: podium.label }), rows, mine };
}

/** The lobby room's world row. */
export interface LobbyWorldModel {
	/** The host gets the toggle (one button per world); the others a line. */
	readonly toggle: boolean;
	/** The toggle's buttons are live (the host, while forming). */
	readonly canEdit: boolean;
	/** `World` (the toggle's label). */
	readonly label: string;
	/** `World: Daily` (the others' line). */
	readonly line: string;
	readonly options: ReadonlyArray<{ readonly world: string; readonly text: string; readonly active: boolean }>;
}

/** The world row for a lobby on `world`, seen by its host or not, forming or not; `worlds`: shared/lobby LOBBY_WORLDS. */
export function lobbyWorldModel(
	world: string,
	worlds: ReadonlyArray<string>,
	isHost: boolean,
	forming: boolean,
	s: DailyStr,
): LobbyWorldModel {
	return {
		toggle: isHost,
		canEdit: isHost && forming,
		label: s(DAILY_STRINGS.lobbyWorld),
		line: s(DAILY_STRINGS.lobbyWorldShown, { world: s(dailyLobbyWorldKey(world)) }),
		options: worlds.map((w) => ({ world: w, text: s(dailyLobbyWorldKey(w)), active: w === world })),
	};
}
