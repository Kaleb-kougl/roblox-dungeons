/**
 * Fonts per script (docs/LOCALIZATION.md design 6, LD8, LD13): legacy Enum.Font item names, so this stays free of
 * Roblox types; the client resolves them (L4).
 *
 * PROVISIONAL until spike L0 (a) records which fonts draw each script: Latin keeps today's HUD fonts (Arcade / Code,
 * shared/view/hud HUD_FONTS), every other script uses BuilderSans. L0 decides the real table and any `sizeScale`.
 *
 * @module
 */
import { SOURCE_LOCALE, localeDef, type LocaleScript } from "./locales";

/**
 * The fonts one writing system is drawn with, as legacy `Enum.Font` item names (strings, so this module needs no Roblox
 * types; the client resolves them). One row of `L10N_FONTS` per script; `fontsFor` returns the row for a locale code.
 */
export interface LocaleFonts {
	/** Labels, numbers, banners (Enum.Font name). */
	readonly text: string;
	/** The debug line (monospace). */
	readonly mono: string;
	/** Player display names and language endonyms: a font that covers every script (LD13). */
	readonly name: string;
	/** Multiplies text sizes for scripts whose glyphs read small at HUD sizes (1: as designed). */
	readonly sizeScale: number;
}

const OTHER_SCRIPT: LocaleFonts = { text: "BuilderSans", mono: "Code", name: "BuilderSans", sizeScale: 1 };

/** The fonts of each script (provisional, see above). */
export const L10N_FONTS: Readonly<Record<LocaleScript, LocaleFonts>> = {
	latin: { text: "Arcade", mono: "Code", name: "BuilderSans", sizeScale: 1 },
	cyrillic: OTHER_SCRIPT,
	cjk: OTHER_SCRIPT,
	thai: OTHER_SCRIPT,
	devanagari: OTHER_SCRIPT,
	arabic: OTHER_SCRIPT,
};

/** The fonts for a locale code (an unknown code: the source locale's). */
export function fontsFor(code: string): LocaleFonts {
	const def = localeDef(code) ?? localeDef(SOURCE_LOCALE);
	return L10N_FONTS[def !== undefined ? def.script : "latin"];
}

/** A text size (reference px) times a script's sizeScale, rounded to whole px (exactly `size` at 1). */
export function scaledTextSize(size: number, sizeScale: number): number {
	return sizeScale === 1 ? size : math.max(1, math.round(size * sizeScale));
}
