// Options > Display > Language (docs/LOCALIZATION.md L6): choices, the current choice, stepping, labels.
import { describe, expect, it } from "@rbxts/jest-globals";
import { LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE, liveLocales } from "shared/l10n";
import { LANGUAGE_AUTO } from "shared/settings";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import {
	LANGUAGE_ROW,
	OPTIONS_STRINGS,
	currentLanguageChoice,
	languageChoiceLabel,
	languageChoices,
	localeEndonym,
	stepLanguageChoice,
} from "shared/view/hud";

describe("language row choices", () => {
	it("lists Automatic, then the live locales, for everybody", () => {
		const choices = languageChoices(false);
		expect(choices[0]).toEqual({ value: LANGUAGE_AUTO, hidden: false });
		expect(choices.size()).toBe(1 + liveLocales().size());
		expect(choices[1]).toEqual({ value: SOURCE_LOCALE, hidden: false });
		for (const c of choices) expect(c.hidden).toBe(false);
	});
	it("adds every hidden locale for developers, marked hidden, the pseudo-locale last", () => {
		const choices = languageChoices(true);
		expect(choices.size()).toBe(1 + LOCALES.size());
		expect(choices[choices.size() - 1]).toEqual({ value: PSEUDO_LOCALE, hidden: true });
		expect(choices.find((c) => c.value === "de")?.hidden).toBe(true);
	});
	it("the current choice is Automatic while the locale came from it", () => {
		expect(currentLanguageChoice({ code: "en", auto: true })).toBe(LANGUAGE_AUTO);
		expect(currentLanguageChoice({ code: "en", auto: false })).toBe("en");
		expect(currentLanguageChoice({ code: PSEUDO_LOCALE, auto: false })).toBe(PSEUDO_LOCALE);
	});
	it("steps both ways, wrapping; an unlisted current counts as Automatic", () => {
		const choices = languageChoices(true);
		expect(stepLanguageChoice(choices, LANGUAGE_AUTO, 1)).toBe(SOURCE_LOCALE);
		expect(stepLanguageChoice(choices, SOURCE_LOCALE, -1)).toBe(LANGUAGE_AUTO);
		expect(stepLanguageChoice(choices, LANGUAGE_AUTO, -1)).toBe(PSEUDO_LOCALE);
		expect(stepLanguageChoice(choices, PSEUDO_LOCALE, 1)).toBe(LANGUAGE_AUTO);
		expect(stepLanguageChoice(languageChoices(false), "de", 1)).toBe(SOURCE_LOCALE);
		expect(stepLanguageChoice([], "de", 1)).toBe(LANGUAGE_AUTO);
	});
});

describe("language row labels", () => {
	const pack = new ThemePack(PLACEHOLDER_MANIFEST);
	const s = (key: string, vars?: Record<string, string | number>) => pack.str(key, vars);
	it("names Automatic with what it picks, a locale by its endonym", () => {
		expect(languageChoiceLabel({ value: LANGUAGE_AUTO, hidden: false }, "en", s)).toBe("Automatic (English)");
		expect(languageChoiceLabel({ value: LANGUAGE_AUTO, hidden: false }, "ja", s)).toBe("Automatic (日本語)");
		expect(languageChoiceLabel({ value: "en", hidden: false }, "ja", s)).toBe("English");
		expect(languageChoiceLabel({ value: "de", hidden: true }, "en", s)).toBe(`Deutsch${LANGUAGE_ROW.hiddenMark}`);
	});
	it("every locale has an endonym; an unknown code reads as itself", () => {
		for (const l of LOCALES) expect(localeEndonym(l.code).size() > 0).toBe(true);
		expect(localeEndonym("xx")).toBe("xx");
	});
	it("its strings exist in the placeholder pack", () => {
		for (const key of [
			OPTIONS_STRINGS.language,
			OPTIONS_STRINGS.languageAuto,
			OPTIONS_STRINGS.languagePrev,
			OPTIONS_STRINGS.languageNext,
		])
			expect([key, pack.hasString(key)]).toEqual([key, true]);
	});
});
