/**
 * First sightings (docs/ENEMY_VARIANTS.md EV12, EVD10): the ids an account can have "seen", once each, stored in the
 * onboarding document's optional `seen` list (doc.ts) and named by the client's first-sighting toast. A sighting id is a
 * new archetype's id (`imp`, `slime`, `summoner`; a `slime.small` counts as `slime`; docs/NEW_ENEMIES.md's `bomber`,
 * `charger`, `stormcaller`, `warbanner`, `reaper`; docs/FORTUNE.md's Goldling `golden`) or `affix.<id>` for an elite affix
 * (`affix.hulking`, ...), or `pellet.power` for the power pellet (docs/PELLETS.md PL14), or `golden.rumour` for the first
 * Goldling rumour heard (docs/GOLDLING_RUMOURS.md GR7). Its toast line is the theme string `bestiary.<sighting id>` (shared/theme
 * BESTIARY_STRING_KEYS; a spec keeps the two lists equal). Plain data, no Roblox API and no theme import, so the server's
 * OnboardingService can validate a client's report with it cheaply.
 */

/** Every sighting id, in canonical order (the stored list keeps this order): the archetypes, then the affixes. */
export const SIGHTING_IDS: ReadonlyArray<string> = [
	"imp",
	"slime",
	"summoner",
	// docs/NEW_ENEMIES.md NED13: the second endless set
	"bomber",
	"charger",
	"stormcaller",
	"warbanner",
	"reaper",
	// docs/FORTUNE.md FO6: the Goldling (an archetype: with the others, before the affixes, like NED13's five)
	"golden",
	"affix.hulking",
	"affix.swift",
	"affix.shielded",
	"affix.vengeful",
	// docs/PELLETS.md PL14 (PD16): the power pellet, seen in a real run (appended: the stored list keeps this order)
	"pellet.power",
	// docs/GOLDLING_RUMOURS.md GR7 (RD7): the first Goldling rumour heard (its first-time card; appended)
	"golden.rumour",
];

/** The affix sighting ids by shared/dungeon AffixKind - 1 (AffixKind 1..4 = hulking, swift, shielded, vengeful). */
export const AFFIX_SIGHTING_IDS: ReadonlyArray<string> = [
	"affix.hulking",
	"affix.swift",
	"affix.shielded",
	"affix.vengeful",
];

/** Prefix of the theme string a sighting's toast shows (`bestiary.<id>`). */
const BESTIARY_PREFIX = "bestiary.";

/**
 * Longest stored `seen` list read from the store: a decode scans at most this many entries (a corrupt or hostile value
 * can be long; a valid one holds each id once). Twice the id count leaves room for duplicates an older build wrote.
 */
export const SEEN_SCAN_LIMIT = 2 * SIGHTING_IDS.size();

/** Per-player budget for `bestiarySeen` (OnboardingService). An honest client sends one per id per account, ever. */
export const BESTIARY_SEEN_RATE = table.freeze({ count: 10, windowSeconds: 10 });

/** True for a known sighting id. */
export function isSightingId(v: unknown): v is string {
	return typeIs(v, "string") && SIGHTING_IDS.includes(v);
}

/** The theme string key of a sighting's toast line (`bestiary.imp`, `bestiary.affix.swift`, ...). */
export function sightingStringKey(id: string): string {
	return `${BESTIARY_PREFIX}${id}`;
}

/**
 * Any value -> the known sighting ids it lists, deduplicated, in canonical (SIGHTING_IDS) order. A non-table, a
 * non-string entry or an unknown id contributes nothing; at most SEEN_SCAN_LIMIT entries are read. Never throws.
 */
export function normalizeSeen(raw: unknown): string[] {
	const out: string[] = [];
	if (!typeIs(raw, "table")) return out;
	const list = raw as ReadonlyArray<unknown>;
	const n = math.min(list.size(), SEEN_SCAN_LIMIT);
	const found = new Set<string>();
	for (let i = 0; i < n; i++) {
		const v = list[i];
		if (isSightingId(v)) found.add(v);
	}
	for (const id of SIGHTING_IDS) if (found.has(id)) out.push(id);
	return out;
}

/** The ids of `seen` plus `id`, canonical order (a copy; `seen` itself is not touched). */
export function withSighting(seen: ReadonlyArray<string>, id: string): string[] {
	const list: unknown[] = [...seen, id];
	return normalizeSeen(list);
}

/** Same ids in the same order (both canonical lists). */
export function sameSeen(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) return false;
	return true;
}
