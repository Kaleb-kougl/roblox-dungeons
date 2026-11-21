/**
 * Roblox port (claude/codex-plan.md CX5): the Codex's theme keys. Pure data with no runtime import, so contract.ts takes
 * its string list (CODEX_STRING_KEYS) for REQUIRED_STRING_KEYS with one import (its compiled Luau sits near Luau's
 * 200-locals-per-function limit; the list is spread inside REQUIRED_STRING_KEYS' function); the sound is written out in
 * contract.ts PORT_AUDIO_EVENTS (CODEX_AUDIO_IDS, the same list; codex.spec.ts checks they agree). The theme imports
 * nothing outside shared/theme, so the Codex's tabs, groups and characters are spelled here as plain strings
 * (shared/codex CODEX_TABS / CODEX_GROUPS, shared/characters; codex.spec.ts checks they agree).
 *
 * Entry names and descriptions are the existing item / enemy keys (`boon.<k>.name`, `bestiary.<id>`, ...); only the
 * entries with no line of their own get a codex description (`codex.desc.<category>.<key>`, decision R6): the five of
 * CX5, then the secret rooms' (docs/SECRET_ROOMS.md SRD12: `codex.desc.secret.room`; its name `secret.room.name` is
 * secrets.ts SECRET_STRING_KEYS').
 *
 * The contract lists named above:
 * {@link shared/theme/contract/strings!REQUIRED_STRING_KEYS | REQUIRED_STRING_KEYS},
 * {@link shared/theme/contract/ids!PORT_AUDIO_EVENTS | PORT_AUDIO_EVENTS}.
 *
 * @module
 */

/** The Codex screen's tabs (shared/codex CODEX_TABS, same order): `codex.tab.<tab>`. */
export const CODEX_TAB_NAMES = ["boons", "evolutions", "duos", "items", "boosts", "bestiary"] as const;

/**
 * The sub-headers inside a tab with more than one group (items: relics, curses; bestiary: enemies, champions, bosses,
 * then docs/SECRET_ROOMS.md SRD12's secret rooms).
 */
export const CODEX_SUBHEADER_GROUPS = ["relics", "curses", "enemies", "champions", "bosses", "secrets"] as const;

/**
 * The detail panel's kind line per catalog group (shared/codex CODEX_GROUPS): `codex.kind.<kind>`. A boon's takes
 * `{rarity}` (`boon.rarity.*`), an evolution's `{boon}` (its boon's name).
 */
export const CODEX_KIND_OF_GROUP = {
	boons: "boon",
	evolutions: "evolution",
	duos: "duo",
	relics: "relic",
	curses: "curse",
	boosts: "boost",
	enemies: "enemy",
	champions: "champion",
	bosses: "boss",
	secrets: "secret",
} as const;

/** Characters a weapon-gated entry can need (R7: `codex.requires.<character>`, shared/characters CHARACTERS ids). */
export const CODEX_REQUIRES_CHARACTERS = ["knight", "archer"] as const;

/** The Codex's one sound (CXD12): a codex toast's soft chime. Port audio ID, SILENT in the placeholder, no fallback. */
export const CODEX_NEW_SOUND = "sfx.codex.new";
/**
 * Every Codex audio ID, the same list `contract.ts` writes out inside PORT_AUDIO_EVENTS (`codex.spec.ts` checks they
 * agree). One entry today; nothing reads its order.
 */
export const CODEX_AUDIO_IDS: ReadonlyArray<string> = [CODEX_NEW_SOUND];

/** `codex.tab.<tab>`. */
export function codexTabNameKey(tab: string): string {
	return `codex.tab.${tab}`;
}

/** `codex.group.<group>` (a sub-header; CODEX_SUBHEADER_GROUPS). */
export function codexGroupNameKey(group: string): string {
	return `codex.group.${group}`;
}

/** The kind line's key of catalog group `group` (`codex.kind.<kind>`), or undefined for an unknown group. */
export function codexKindKey(group: string): string | undefined {
	const kind = (CODEX_KIND_OF_GROUP as unknown as ReadonlyMap<string, string>).get(group);
	return kind !== undefined ? `codex.kind.${kind}` : undefined;
}

/** `codex.requires.<character>` (R7: `Knight only` / `Archer only`). */
export function codexRequiresKey(character: string): string {
	return `codex.requires.${character}`;
}

/**
 * Every Codex string (all REQUIRED), in this order:
 *   - the screen: title, completion (`{pct}`), the tabs, a tab's count (`{tab}` `{found}`/`{total}`), the sub-headers
 *     (docs/SECRET_ROOMS.md SRD12's `secrets` last), the unknown name `???`;
 *   - the state lines: Seen; Found with its floor and date (`{floor}`, `{date}`), and the variants that drop an unknown
 *     part (day 0 / floor 0: floor only, date only, neither); the date (`{day}` `{month}` `{year}`, the month a
 *     `daily.date.month.*` name);
 *   - the hints of unknown tiles (R3): enemy, affix (`{floor}`), boss (`{every}`: BOSS_FLOOR_EVERY), evolution (`{boon}`;
 *     the third take evolves), duo recipe (`{a}` + `{b}`) and the duo hint before both boons are found;
 *   - the character tags (R7), the kind lines (one per group);
 *   - the codex-only descriptions (R6: swarmer, sniper, bruiser, both bosses; then the secret rooms');
 *   - the run: the NEW! chip, the draft card's NEW tag, the decorated toast's second line, a codex toast (`{name}`);
 *   - the run-over line: `{n}` new (2 or more) and its singular, the icon strip's `+{n}`, the completion (`{pct}`);
 *   - the main menu: the Codex button, its badge above 9 (`{n}+`), the unavailable line.
 */
export const CODEX_STRING_KEYS: ReadonlyArray<string> = [
	"codex.title",
	"codex.completion",
	"codex.tab.boons",
	"codex.tab.evolutions",
	"codex.tab.duos",
	"codex.tab.items",
	"codex.tab.boosts",
	"codex.tab.bestiary",
	"codex.tab.count",
	"codex.group.relics",
	"codex.group.curses",
	"codex.group.enemies",
	"codex.group.champions",
	"codex.group.bosses",
	"codex.group.secrets",
	"codex.unknown",
	"codex.state.seen",
	"codex.state.found",
	"codex.state.foundFloor",
	"codex.state.foundDate",
	"codex.state.foundAny",
	"codex.date",
	"codex.hint.enemy",
	"codex.hint.affix",
	"codex.hint.boss",
	"codex.hint.evo",
	"codex.hint.duo",
	"codex.hint.duoLocked",
	"codex.requires.knight",
	"codex.requires.archer",
	"codex.kind.boon",
	"codex.kind.evolution",
	"codex.kind.duo",
	"codex.kind.relic",
	"codex.kind.curse",
	"codex.kind.boost",
	"codex.kind.enemy",
	"codex.kind.champion",
	"codex.kind.boss",
	"codex.kind.secret",
	"codex.desc.enemy.swarmer",
	"codex.desc.enemy.sniper",
	"codex.desc.enemy.bruiser",
	"codex.desc.boss.act1",
	"codex.desc.boss.demonlord",
	"codex.desc.secret.room",
	"hud.codex.new",
	"hud.codex.tag",
	"hud.codex.added",
	"hud.codex.toast",
	"run.codex.new",
	"run.codex.newOne",
	"run.codex.more",
	"run.codex.total",
	"menu.codex",
	"menu.codexMore",
	"codex.unavailable",
];
