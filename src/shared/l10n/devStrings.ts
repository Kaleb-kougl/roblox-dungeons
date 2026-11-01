/**
 * Developer-only string keys (docs/LOCALIZATION.md LD10): the playtest overlay and the debug lines. They stay English
 * in every locale and the l10n pipeline never exports them.
 */
export const DEV_ONLY_STRING_PREFIXES: ReadonlyArray<string> = ["playtest.", "hud.debug"];

/** True for a key under one of DEV_ONLY_STRING_PREFIXES. */
export function isDevOnlyStringKey(key: string): boolean {
	return DEV_ONLY_STRING_PREFIXES.some((p) => key.sub(1, p.size()) === p);
}
