/**
 * Which locale a player reads (docs/LOCALIZATION.md design 1, L2). Pure: the client hands in the Roblox locale ids it
 * knows (`Player.LocaleId` / `LocalizationService.RobloxLocaleId`, whichever spike L0 shows to be the in-experience
 * language, first) and the Options override, if any.
 *
 * @module
 */
import { LOCALES, SOURCE_LOCALE, localeDef, type LocaleDef } from "./locales";

/** The picked locale: its code, and whether it came from the player's Roblox language (true) or the override. */
export interface LocalePick {
	readonly code: string;
	readonly auto: boolean;
}

/**
 * Options for `pickLocale`. By default only live locales can be picked, whether from the Roblox language or from the
 * Options override.
 */
export interface PickLocaleOptions {
	/** Also pick hidden locales (a developer override, Studio): the pseudo-locale and locales not yet live (LD12). */
	readonly allowHidden?: boolean;
}

/**
 * Language-only matches that are not "the first locale with this language" (step 3 of pickLocale), keyed by a
 * lowercase Roblox id or its first one or two subtags. Chinese picks its script by region (or by an explicit script
 * subtag): Simplified for the mainland, Singapore and Malaysia, Traditional for Taiwan, Hong Kong and Macau.
 */
export const LANGUAGE_FALLBACKS: ReadonlyMap<string, string> = new Map<string, string>([
	["zh", "zh-CN"],
	["zh-hans", "zh-CN"],
	["zh-sg", "zh-CN"],
	["zh-my", "zh-CN"],
	["zh-hant", "zh-TW"],
	["zh-hk", "zh-TW"],
	["zh-mo", "zh-TW"],
]);

const SUBTAG_SEPARATOR = "-";

/** "es_MX" / "ES-mx" -> "es-mx". */
function normalizeId(id: string): string {
	const [out] = id.lower().gsub("_", SUBTAG_SEPARATOR);
	return out;
}

/** The subtags of a normalized id ("zh-hant-tw" -> ["zh", "hant", "tw"]). */
function subtags(id: string): string[] {
	return id.split(SUBTAG_SEPARATOR);
}

/** The language subtag of a locale code ("pt-BR" -> "pt"). */
function languageOf(code: string): string {
	return subtags(normalizeId(code))[0];
}

function usable(def: LocaleDef, allowHidden: boolean): boolean {
	return def.status === "live" || allowHidden;
}

/** Every live locale, in LOCALES order (the source first): what Options lists and auto-pick may choose. */
export function liveLocales(): LocaleDef[] {
	return LOCALES.filter((l) => l.status === "live");
}

function exactMatch(id: string, allowHidden: boolean): LocaleDef | undefined {
	return LOCALES.find((l) => usable(l, allowHidden) && l.roblox.includes(id));
}

function languageMatch(id: string, allowHidden: boolean): LocaleDef | undefined {
	const tags = subtags(id);
	const keys = [id];
	if (tags.size() > 2) keys.push(`${tags[0]}${SUBTAG_SEPARATOR}${tags[1]}`);
	keys.push(tags[0]);
	for (const key of keys) {
		const code = LANGUAGE_FALLBACKS.get(key);
		const def = code !== undefined ? localeDef(code) : undefined;
		if (def !== undefined && usable(def, allowHidden)) return def;
	}
	return LOCALES.find((l) => usable(l, allowHidden) && l.pseudo === undefined && languageOf(l.code) === tags[0]);
}

/**
 * The locale to show, in order:
 *   1. `override` (Options > Language), if it is a known locale that is live (any known one with `allowHidden`);
 *   2. an exact, case-insensitive match of `robloxIds` (in order) against LocaleDef.roblox;
 *   3. a language-only match of `robloxIds` (in order): LANGUAGE_FALLBACKS, else the first locale with that language
 *      ("es-ar" -> "es", "pt-pt" -> "pt-BR", "zh-sg" -> "zh-CN");
 *   4. SOURCE_LOCALE.
 * Hidden locales are skipped unless `allowHidden`. `auto` is false only for the override.
 */
export function pickLocale(
	robloxIds: ReadonlyArray<string>,
	override: string | undefined,
	opts: PickLocaleOptions = {},
): LocalePick {
	const allowHidden = opts.allowHidden === true;
	if (override !== undefined) {
		const def = localeDef(override);
		if (def !== undefined && usable(def, allowHidden)) return { code: def.code, auto: false };
	}
	const ids = robloxIds.map(normalizeId);
	for (const id of ids) {
		const def = exactMatch(id, allowHidden);
		if (def !== undefined) return { code: def.code, auto: true };
	}
	for (const id of ids) {
		const def = languageMatch(id, allowHidden);
		if (def !== undefined) return { code: def.code, auto: true };
	}
	return { code: SOURCE_LOCALE, auto: true };
}
