/**
 * The locales the game knows (docs/LOCALIZATION.md design 1). Plain data, no Roblox APIs (headlessly tested).
 *
 * `code` is the theme pack's locale code (`xx` / `xx-XX`, shared/theme validate.ts LOCALE_PATTERNS). `roblox` lists
 * the Roblox locale ids (lowercase, `LocalizationService.RobloxLocaleId` / `Player.LocaleId`) that map to it; the
 * lists are a best guess until spike L0 (d) records the real codes. A locale is auto-picked or listed only while its
 * `status` is "live" (LD12): today only the source locale is.
 */

/** The writing system a locale's text is in: picks its fonts (L10N_FONTS). */
export type LocaleScript = "latin" | "cyrillic" | "cjk" | "thai" | "devanagari" | "arabic";

/** "live": auto-picked and listed in Options. "hidden": only by a developer override (LD12 gate not passed). */
export type LocaleStatus = "live" | "hidden";

/** How a locale writes numbers. Digits stay ASCII everywhere (LD9). */
export interface LocaleNumberFormat {
	/** Between groups of three digits ("1,240" / "1.240" / "1 240"). */
	readonly group: string;
	/** Before the fraction ("1.5" / "1,5"). */
	readonly decimal: string;
}

export interface LocaleDef {
	/** Theme pack locale code ("es", "pt-BR", "zh-CN"). */
	readonly code: string;
	/** The language's own name, shown in the picker in every locale (not a string key). */
	readonly endonym: string;
	/** Roblox locale ids (lowercase) that map to this locale exactly. */
	readonly roblox: ReadonlyArray<string>;
	readonly script: LocaleScript;
	/** Right-to-left text (docs/LOCALIZATION.md design 7). */
	readonly rtl: boolean;
	readonly number: LocaleNumberFormat;
	readonly status: LocaleStatus;
	/** The generated pseudo-locale (L8): never live, never exported. */
	readonly pseudo?: true;
}

/** The source locale: the English string table every other locale translates. */
export const SOURCE_LOCALE = "en";
/** The pseudo-locale (L8): English accented and padded, to find untranslated or overflowing text. */
export const PSEUDO_LOCALE = "en-XA";

/** No-break space: a group separator must never wrap a number. */
const NBSP = " ";

const COMMA_DOT: LocaleNumberFormat = { group: ",", decimal: "." };
const DOT_COMMA: LocaleNumberFormat = { group: ".", decimal: "," };
const SPACE_COMMA: LocaleNumberFormat = { group: NBSP, decimal: "," };

/** Every locale, source first, then by code; the pseudo-locale last. */
export const LOCALES: ReadonlyArray<LocaleDef> = [
	{
		code: "en",
		endonym: "English",
		roblox: ["en-us", "en-gb"],
		script: "latin",
		rtl: false,
		number: COMMA_DOT,
		status: "live",
	},
	{
		code: "ar",
		endonym: "العربية",
		roblox: ["ar-001"],
		script: "arabic",
		rtl: true,
		number: COMMA_DOT,
		status: "hidden",
	},
	{
		code: "de",
		endonym: "Deutsch",
		roblox: ["de-de"],
		script: "latin",
		rtl: false,
		number: DOT_COMMA,
		status: "hidden",
	},
	{
		code: "es",
		endonym: "Español",
		roblox: ["es-es", "es-mx"],
		script: "latin",
		rtl: false,
		number: DOT_COMMA,
		status: "hidden",
	},
	{
		code: "fr",
		endonym: "Français",
		roblox: ["fr-fr", "fr-ca"],
		script: "latin",
		rtl: false,
		number: SPACE_COMMA,
		status: "hidden",
	},
	{
		code: "hi",
		endonym: "हिन्दी",
		roblox: ["hi-in"],
		script: "devanagari",
		rtl: false,
		number: COMMA_DOT,
		status: "hidden",
	},
	{
		code: "id",
		endonym: "Bahasa Indonesia",
		roblox: ["id-id"],
		script: "latin",
		rtl: false,
		number: DOT_COMMA,
		status: "hidden",
	},
	{
		code: "it",
		endonym: "Italiano",
		roblox: ["it-it"],
		script: "latin",
		rtl: false,
		number: DOT_COMMA,
		status: "hidden",
	},
	{
		code: "ja",
		endonym: "日本語",
		roblox: ["ja-jp"],
		script: "cjk",
		rtl: false,
		number: COMMA_DOT,
		status: "hidden",
	},
	{
		code: "ko",
		endonym: "한국어",
		roblox: ["ko-kr"],
		script: "cjk",
		rtl: false,
		number: COMMA_DOT,
		status: "hidden",
	},
	{
		code: "pl",
		endonym: "Polski",
		roblox: ["pl-pl"],
		script: "latin",
		rtl: false,
		number: SPACE_COMMA,
		status: "hidden",
	},
	{
		code: "pt-BR",
		endonym: "Português",
		roblox: ["pt-br", "pt-pt"],
		script: "latin",
		rtl: false,
		number: DOT_COMMA,
		status: "hidden",
	},
	{
		code: "ru",
		endonym: "Русский",
		roblox: ["ru-ru"],
		script: "cyrillic",
		rtl: false,
		number: SPACE_COMMA,
		status: "hidden",
	},
	{ code: "th", endonym: "ไทย", roblox: ["th-th"], script: "thai", rtl: false, number: COMMA_DOT, status: "hidden" },
	{
		code: "tr",
		endonym: "Türkçe",
		roblox: ["tr-tr"],
		script: "latin",
		rtl: false,
		number: DOT_COMMA,
		status: "hidden",
	},
	{
		code: "vi",
		endonym: "Tiếng Việt",
		roblox: ["vi-vn"],
		script: "latin",
		rtl: false,
		number: DOT_COMMA,
		status: "hidden",
	},
	{
		code: "zh-CN",
		endonym: "简体中文",
		roblox: ["zh-cn", "zh-cjv"],
		script: "cjk",
		rtl: false,
		number: COMMA_DOT,
		status: "hidden",
	},
	{
		code: "zh-TW",
		endonym: "繁體中文",
		roblox: ["zh-tw", "zh-hk"],
		script: "cjk",
		rtl: false,
		number: COMMA_DOT,
		status: "hidden",
	},
	{
		code: PSEUDO_LOCALE,
		endonym: "Pseudo (en-XA)",
		roblox: [],
		script: "latin",
		rtl: false,
		number: COMMA_DOT,
		status: "hidden",
		pseudo: true,
	},
];

/** The locale with this code, or undefined. */
export function localeDef(code: string): LocaleDef | undefined {
	return LOCALES.find((l) => l.code === code);
}
