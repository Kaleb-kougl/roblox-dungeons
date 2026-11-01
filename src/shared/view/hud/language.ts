/**
 * Options > Display > Language (docs/LOCALIZATION.md L6, design 9): the row's choices, stepping and labels. Pure; the
 * Options screen draws it as `< value >` (the - / + pattern of the audio rows), the value in the display-name font.
 *
 * Choices: Automatic first, then each listed locale in LOCALES order (the source first): live ones for everybody,
 * hidden ones (the pseudo-locale included) only for developers, marked with LANGUAGE_ROW.hiddenMark. Endonyms are
 * LocaleDef.endonym, never theme strings; Automatic is `options.display.language.auto` with the endonym of what it picks.
 */
import { LOCALES, localeDef, type LocaleDef } from "shared/l10n";
import { LANGUAGE_AUTO } from "shared/settings";
import { OPTIONS_STRINGS } from "./options";

export const LANGUAGE_ROW = {
	/**
	 * After a hidden locale's endonym: only developers see hidden locales, so it is developer text (LD10: English, kept
	 * out of the theme strings and never exported).
	 */
	hiddenMark: " [dev]",
	/** The value's width (reference px): fits "Automatic (Português (Brasil))" at the small text size. */
	valueWidth: 300,
} as const;

/** One choice of the row: LANGUAGE_AUTO or a locale code, and whether that locale is hidden (developers only). */
export interface LanguageChoice {
	readonly value: string;
	readonly hidden: boolean;
}

function listed(def: LocaleDef, allowHidden: boolean): boolean {
	return def.status === "live" || allowHidden;
}

/** The row's choices: Automatic, then the listed locales (hidden ones with `allowHidden`). */
export function languageChoices(allowHidden: boolean): LanguageChoice[] {
	const out: LanguageChoice[] = [{ value: LANGUAGE_AUTO, hidden: false }];
	for (const def of LOCALES)
		if (listed(def, allowHidden)) out.push({ value: def.code, hidden: def.status !== "live" });
	return out;
}

/** The choice the row shows as current: Automatic while the locale shown came from it, else the code shown. */
export function currentLanguageChoice(shown: { readonly code: string; readonly auto: boolean }): string {
	return shown.auto ? LANGUAGE_AUTO : shown.code;
}

/** The choice `step` places from `current` (wrapping both ways; an unlisted current counts as Automatic). */
export function stepLanguageChoice(choices: ReadonlyArray<LanguageChoice>, current: string, step: number): string {
	const n = choices.size();
	if (n === 0) return LANGUAGE_AUTO;
	let index = choices.findIndex((c) => c.value === current);
	if (index < 0) index = 0;
	return choices[(((index + step) % n) + n) % n].value;
}

/** A locale's endonym (an unknown code: the code itself). */
export function localeEndonym(code: string): string {
	return localeDef(code)?.endonym ?? code;
}

/**
 * A choice's label: Automatic as `options.display.language.auto` with the endonym of `autoCode` (what it picks), a
 * locale as its endonym (plus LANGUAGE_ROW.hiddenMark when hidden).
 */
export function languageChoiceLabel(
	choice: LanguageChoice,
	autoCode: string,
	s: (key: string, vars?: Record<string, string | number>) => string,
): string {
	if (choice.value === LANGUAGE_AUTO) return s(OPTIONS_STRINGS.languageAuto, { name: localeEndonym(autoCode) });
	const name = localeEndonym(choice.value);
	return choice.hidden ? `${name}${LANGUAGE_ROW.hiddenMark}` : name;
}
