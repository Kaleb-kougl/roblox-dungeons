/**
 * A generated locale table (docs/LOCALIZATION.md design 2), written by `npm run l10n:import`, never by hand:
 * string key -> [translated text, sourceHash of the English it was translated from].
 */
export type LocaleEntry = readonly [text: string, srcHash: number];
/**
 * One locale's generated translations: string key to entry, for the keys that have a translation. A key missing from
 * it, or whose stored hash no longer matches the current English, shows the English text instead.
 */
export type LocaleTable = Readonly<Record<string, LocaleEntry>>;
