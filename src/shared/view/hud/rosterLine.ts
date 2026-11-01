/**
 * The seeded roster on the stage card (docs/DAILY.md DS2, DSD13; the roster itself: shared/dungeon endlessRoster,
 * EndlessFloorLayout.roster, DS1). Pure: the client's StageController hands in the floor's roster (join order) and the
 * floor before's, and a string lookup (the active pack's `str`).
 *
 *   rosterJoined     the kinds of a floor's roster that the floor before's did not hold (in join order)
 *   stageRosterLine  the card's roster line: at a run start (no floor before) every kind, `roster.line` ("Swarmer ·
 *                    Bruiser"); on a floor where kinds joined `roster.new` ("New: Imp"); else none
 *   stageCardLine    the card's one second line (DSD13): new best's NEW DEEPEST outranks the roster line, which
 *                    outranks new best's other lines ("Deepest: floor 9 · 2 to go", "Record floor", "Deepest yet")
 *
 * Names are the kinds' `enemy.<id>.name` strings joined with ROSTER_VIEW.separator.
 */
import { NEW_BEST_STRINGS } from "./newBestStrings";
import type { NewBestLineText, NewBestStr } from "./newBest";

/** The roster strings (theme ROSTER_STRING_KEYS, same order; all REQUIRED). `{names}`: the joined kind names. */
export const ROSTER_STRINGS = {
	line: "roster.line",
	joined: "roster.new",
} as const;

/** How the roster line is drawn. */
export const ROSTER_VIEW = {
	/** Between two kind names ("Swarmer · Bruiser"). */
	separator: " · ",
} as const;

/** The theme string key of an enemy kind's name (`enemy.<id>.name`, required for every theme ENEMY_ARCHETYPES id). */
export function enemyNameKey(kind: string): string {
	return `enemy.${kind}.name`;
}

/** The kinds of `roster` that `previous` does not hold, in `roster`'s (join) order. */
export function rosterJoined(roster: ReadonlyArray<string>, previous: ReadonlyArray<string>): string[] {
	const out: string[] = [];
	for (const kind of roster) if (!previous.includes(kind)) out.push(kind);
	return out;
}

function namesOf(kinds: ReadonlyArray<string>, s: NewBestStr): string {
	return kinds.map((k) => s(enemyNameKey(k))).join(ROSTER_VIEW.separator);
}

/**
 * The stage card's roster line for a floor whose roster is `roster` (EndlessFloorLayout.roster; undefined: a floor
 * without one, e.g. the tutorial's: none). `previous`: the roster of the floor before (endlessRoster(runSeed, floor -
 * 1)), undefined at a run start (floor 1): then every kind, `roster.line`; otherwise the kinds that joined on this
 * floor, `roster.new`, or none when no kind joined. Never gold.
 */
export function stageRosterLine(
	roster: ReadonlyArray<string> | undefined,
	previous: ReadonlyArray<string> | undefined,
	s: NewBestStr,
): NewBestLineText | undefined {
	if (roster === undefined || roster.size() === 0) return undefined;
	if (previous === undefined) return { key: ROSTER_STRINGS.line, args: { names: namesOf(roster, s) }, gold: false };
	const joined = rosterJoined(roster, previous);
	if (joined.size() === 0) return undefined;
	return { key: ROSTER_STRINGS.joined, args: { names: namesOf(joined, s) }, gold: false };
}

/**
 * The stage card's second line (DSD13) from new best's line (shared/view/hud stageBestLine) and the roster line
 * (stageRosterLine): NEW DEEPEST first, then the roster line, then new best's other lines; undefined when neither.
 */
export function stageCardLine(
	best: NewBestLineText | undefined,
	roster: NewBestLineText | undefined,
): NewBestLineText | undefined {
	if (best !== undefined && best.key === NEW_BEST_STRINGS.stageNewDeepest) return best;
	return roster ?? best;
}
