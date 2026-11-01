/**
 * Developer-only string keys (docs/LOCALIZATION.md LD10): the playtest overlay and the debug lines. They stay English
 * in every locale and the l10n pipeline never exports them.
 */
export const DEV_ONLY_STRING_PREFIXES: ReadonlyArray<string> = ["playtest.", "hud.debug"];

/**
 * Keys under a developer prefix that players do read: the run-over panel's title and stat labels (shared/view/hud
 * HUD_STRINGS runOver / runVictory / time / timeVictory / hits / kills) kept the web build's `playtest.run.*` keys
 * (shared/theme requested-ids.spec). They are translated like any other key.
 */
export const DEV_ONLY_STRING_EXCEPTIONS: ReadonlyArray<string> = [
	"playtest.run.over",
	"playtest.run.victory",
	"playtest.run.time",
	"playtest.run.timeVictory",
	"playtest.run.hits",
	"playtest.run.kills",
];

/** True for a key under one of DEV_ONLY_STRING_PREFIXES, unless it is one of DEV_ONLY_STRING_EXCEPTIONS. */
export function isDevOnlyStringKey(key: string): boolean {
	if (DEV_ONLY_STRING_EXCEPTIONS.includes(key)) return false;
	return DEV_ONLY_STRING_PREFIXES.some((p) => key.sub(1, p.size()) === p);
}
