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

/**
 * Player-facing keys that stay English in every locale: `fx.cap` (the damage numbers' CAP beside a boss) is drawn
 * with the digit font (shared/theme DIGIT_FONT), whose glyphs are only `0-9 + - C A P !`. Never exported, never
 * looked up in a locale table, no translator context.
 */
export const UNTRANSLATED_STRING_KEYS: ReadonlyArray<string> = ["fx.cap"];

/**
 * The one rule for "is this key translated?": neither developer-only (isDevOnlyStringKey) nor in
 * UNTRANSLATED_STRING_KEYS. The theme's locale lookup, the locale-table validator and the l10n pipeline (through
 * the Lune dump, scripts/l10n/dump-strings.luau) all use it.
 */
export function isTranslatableStringKey(key: string): boolean {
	return !isDevOnlyStringKey(key) && !UNTRANSLATED_STRING_KEYS.includes(key);
}
