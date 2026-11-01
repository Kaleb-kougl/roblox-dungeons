import { describe, expect, it } from "@rbxts/jest-globals";
import {
	LANGUAGE_FALLBACKS,
	LOCALES,
	PSEUDO_LOCALE,
	SOURCE_LOCALE,
	liveLocales,
	localeDef,
	pickLocale,
} from "shared/l10n";

const HIDDEN = { allowHidden: true };

describe("pickLocale", () => {
	it("prefers a usable override, marked not automatic", () => {
		expect(pickLocale(["es-es"], "de", HIDDEN)).toEqual({ code: "de", auto: false });
		expect(pickLocale([], SOURCE_LOCALE)).toEqual({ code: SOURCE_LOCALE, auto: false });
	});
	it("ignores an unknown or (without allowHidden) hidden override", () => {
		expect(pickLocale(["es-es"], "xx", HIDDEN)).toEqual({ code: "es", auto: true });
		expect(pickLocale([], "de")).toEqual({ code: SOURCE_LOCALE, auto: true });
		expect(pickLocale([], PSEUDO_LOCALE)).toEqual({ code: SOURCE_LOCALE, auto: true });
		expect(pickLocale([], PSEUDO_LOCALE, HIDDEN)).toEqual({ code: PSEUDO_LOCALE, auto: false });
	});
	it("matches Roblox ids exactly, case-insensitively and in order", () => {
		expect(pickLocale(["PT-BR"], undefined, HIDDEN)).toEqual({ code: "pt-BR", auto: true });
		expect(pickLocale(["fr_CA"], undefined, HIDDEN).code).toBe("fr");
		expect(pickLocale(["ja-jp", "ko-kr"], undefined, HIDDEN).code).toBe("ja");
		expect(pickLocale(["xx-yy", "ko-kr"], undefined, HIDDEN).code).toBe("ko");
	});
	it("tries every exact match before any language-only match", () => {
		expect(pickLocale(["es-ar", "de-de"], undefined, HIDDEN).code).toBe("de");
	});
	it("falls back to the language alone", () => {
		expect(pickLocale(["es-ar"], undefined, HIDDEN).code).toBe("es");
		expect(pickLocale(["pt-ao"], undefined, HIDDEN).code).toBe("pt-BR");
		expect(pickLocale(["en-au"], undefined).code).toBe("en");
		expect(pickLocale(["de"], undefined, HIDDEN).code).toBe("de");
	});
	it("picks the Chinese script by region or script subtag", () => {
		expect(pickLocale(["zh-sg"], undefined, HIDDEN).code).toBe("zh-CN");
		expect(pickLocale(["zh-my"], undefined, HIDDEN).code).toBe("zh-CN");
		expect(pickLocale(["zh-mo"], undefined, HIDDEN).code).toBe("zh-TW");
		expect(pickLocale(["zh-hant-hk"], undefined, HIDDEN).code).toBe("zh-TW");
		expect(pickLocale(["zh-hans-cn"], undefined, HIDDEN).code).toBe("zh-CN");
		expect(pickLocale(["zh"], undefined, HIDDEN).code).toBe("zh-CN");
	});
	it("skips hidden locales unless allowed, and ends at the source locale", () => {
		expect(pickLocale(["es-es", "es-ar", "zh-sg"], undefined)).toEqual({ code: SOURCE_LOCALE, auto: true });
		expect(pickLocale([], undefined, HIDDEN)).toEqual({ code: SOURCE_LOCALE, auto: true });
		expect(pickLocale(["qq-zz"], undefined, HIDDEN).code).toBe(SOURCE_LOCALE);
	});
	it("never auto-picks the pseudo-locale", () => {
		expect(pickLocale(["en-xa"], undefined, HIDDEN).code).toBe(SOURCE_LOCALE);
	});
	it("has fallbacks that name known locales", () => {
		for (const [, code] of LANGUAGE_FALLBACKS) expect(localeDef(code)).toBeDefined();
	});
});

describe("liveLocales", () => {
	it("lists exactly the live locales, the source first", () => {
		const live = liveLocales();
		expect(live[0].code).toBe(SOURCE_LOCALE);
		expect(live.size()).toBe(LOCALES.filter((l) => l.status === "live").size());
		for (const l of live) expect(l.status).toBe("live");
	});
});
