/**
 * Every theme string key the join loading screen reads (docs/PRELOAD.md P4; client/ui/loading LoadingScreen). All
 * three are REQUIRED in every pack (shared/theme contract LOADING_STRING_KEYS); preload.spec.ts checks they match and
 * exist in the bundled packs.
 *
 *   title     the screen's heading (the game title)
 *   progress  the count under the bar: `{done}` / `{total}` core entries resolved
 *   skip      the Skip button, shown after PRELOAD.skipAfterSec
 */
export const LOADING_STRINGS = {
	title: "loading.title",
	progress: "loading.progress",
	skip: "loading.skip",
} as const;
