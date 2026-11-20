/**
 * The locale the client shows, as one value (docs/LOCALIZATION.md design 8, L6): what the client's `l10n` Reflex slice
 * holds and every font / alignment choice reads. Pure: the client hands in the Roblox locale ids, the Options override
 * and whether the player may pick hidden locales.
 *
 * @module
 */
import { SOURCE_LOCALE, localeDef, type LocaleScript } from "./locales";
import { pickLocale, type LocalePick, type PickLocaleOptions } from "./pick";

export interface LocaleState {
	/** The locale code shown (a LOCALES code). */
	readonly code: string;
	/** True when it came from the player's Roblox language (Options > Language is Automatic, or its pick is unusable). */
	readonly auto: boolean;
	/** The code's writing system (picks the fonts: fontsFor). */
	readonly script: LocaleScript;
	/** Right-to-left text (design 7): left-aligned labels align right; the layout is not mirrored (LD6). */
	readonly rtl: boolean;
}

/** The state of a pick (an unknown code: the source locale's script and direction). */
export function localeStateOf(pick: LocalePick): LocaleState {
	const def = localeDef(pick.code) ?? localeDef(SOURCE_LOCALE);
	return {
		code: pick.code,
		auto: pick.auto,
		script: def !== undefined ? def.script : "latin",
		rtl: def !== undefined && def.rtl,
	};
}

/** English, automatic: the state before the client resolved anything. */
export const SOURCE_LOCALE_STATE: LocaleState = localeStateOf({ code: SOURCE_LOCALE, auto: true });

/**
 * pickLocale, as a LocaleState. `allowHidden` (developers) applies to the Options override only: the automatic pick
 * from the Roblox language stays live-only for everyone, so a developer never lands in an unfinished locale by default.
 */
export function resolveLocaleState(
	robloxIds: ReadonlyArray<string>,
	override: string | undefined,
	opts: PickLocaleOptions = {},
): LocaleState {
	if (override !== undefined && opts.allowHidden === true && localeDef(override) !== undefined) {
		return localeStateOf({ code: override, auto: false });
	}
	return localeStateOf(pickLocale(robloxIds, override, { allowHidden: false }));
}

/** Two states show the same thing (no re-render needed). */
export function sameLocaleState(a: Readonly<LocaleState>, b: Readonly<LocaleState>): boolean {
	return a.code === b.code && a.auto === b.auto && a.script === b.script && a.rtl === b.rtl;
}
