import { useSelector } from "@rbxts/react-reflex";
import { clientStore, selectL10n, selectLocaleCode, type L10nState } from "client/store";
import { fontsFor, scaledTextSize, type LocaleState } from "shared/l10n";
import { getActiveThemePack, type ColorRole, type ThemePack } from "shared/theme";
import type { StringVars } from "shared/theme";
import { HUD_FONTS, type HudText } from "shared/view/hud";

export * from "./LocaleRoot";
export * from "./artReady";

/**
 * The UI's access to the theme: the active pack (loaded by ThemeController before anything mounts), strings, colour
 * roles and the fonts of the locale shown. Every HUD text and colour goes through here (CLAUDE.md: logical IDs only).
 *
 * Fonts (docs/LOCALIZATION.md design 6, L4): per locale script (shared/l10n fontsFor), read from the client's `l10n`
 * slice. React reads them with the hooks (useHudFont / useMonoFont / useNameFont / useUiFonts; the roots remount under
 * LocaleRoot on a switch), controllers with currentHudFont() & co. and follow switches with onLocaleChanged. Player
 * display names and language endonyms always use the `name` font (LD13). Developer text (dev panel, spikes) stays
 * English in today's fonts (DEV_TEXT_FONT / DEV_MONO_FONT, LD10).
 */

const fontCache = new Map<string, Enum.Font>();

function fontByName(name: string): Enum.Font {
	const cached = fontCache.get(name);
	if (cached !== undefined) return cached;
	const font = Enum.Font.GetEnumItems().find((f) => f.Name === name) ?? Enum.Font.SourceSans;
	fontCache.set(name, font);
	return font;
}

/** Developer-only text (dev panel, spikes: English, LD10): today's HUD font, whatever the locale. */
export const DEV_TEXT_FONT: Enum.Font = fontByName(HUD_FONTS.text);
/** Developer-only monospace text (the debug line's font). */
export const DEV_MONO_FONT: Enum.Font = fontByName(HUD_FONTS.mono);

/** The resolved fonts of a locale, plus its text size factor and direction. */
export interface UiFonts {
	/** Labels, numbers, banners (English: Arcade). */
	readonly text: Enum.Font;
	/** The debug line (English: Code). */
	readonly mono: Enum.Font;
	/** Player display names and endonyms: covers every script (LD13). */
	readonly name: Enum.Font;
	/** Text size factor (shared/l10n LocaleFonts.sizeScale; 1 as designed). */
	readonly sizeScale: number;
	/** Right-to-left text: left-aligned labels align right (design 7, no layout mirroring). */
	readonly rtl: boolean;
}

const fontsByLocale = new Map<string, UiFonts>();

/** The fonts of a locale state (one object per code). */
export function fontsOf(state: Readonly<LocaleState>): UiFonts {
	const cached = fontsByLocale.get(state.code);
	if (cached !== undefined) return cached;
	const f = fontsFor(state.code);
	const fonts: UiFonts = {
		text: fontByName(f.text),
		mono: fontByName(f.mono),
		name: fontByName(f.name),
		sizeScale: f.sizeScale,
		rtl: state.rtl,
	};
	fontsByLocale.set(state.code, fonts);
	return fonts;
}

/** Which of a locale's fonts a text uses: HUD text, monospace, or a display name / endonym (LD13). */
export type FontRole = "text" | "mono" | "name";

/** The font for `fontRole` (default "text"). */
export function fontFor(fonts: UiFonts, fontRole: FontRole = "text"): Enum.Font {
	return fontRole === "mono" ? fonts.mono : fontRole === "name" ? fonts.name : fonts.text;
}

/** The locale shown (the l10n slice). */
export function currentLocale(): L10nState {
	return clientStore.getState().l10n;
}

/** The fonts of the locale shown, for code outside React (controllers building labels). */
export function currentFonts(): UiFonts {
	return fontsOf(currentLocale());
}

/** The HUD text font of the locale shown (controllers; React uses useHudFont). */
export function currentHudFont(): Enum.Font {
	return currentFonts().text;
}

/** The monospace font of the locale shown. */
export function currentMonoFont(): Enum.Font {
	return currentFonts().mono;
}

/** The display-name font (LD13). */
export function currentNameFont(): Enum.Font {
	return currentFonts().name;
}

/** A text size in reference px, scaled for the locale's script (sizeScale; unchanged at 1). */
export function textSizeFor(fonts: UiFonts, size: number): number {
	return scaledTextSize(size, fonts.sizeScale);
}

/** A horizontal alignment for the locale: Left becomes Right in a right-to-left locale; Center / Right stay. */
export function alignFor(fonts: UiFonts, align: Enum.TextXAlignment): Enum.TextXAlignment {
	return fonts.rtl && align === Enum.TextXAlignment.Left ? Enum.TextXAlignment.Right : align;
}

/**
 * Calls `listener` after every locale switch (the slice's code changed). Returns the disconnect (a Janitor takes it). Controllers
 * that built labels outside React re-read their strings and fonts here, or read them on each show.
 */
export function onLocaleChanged(listener: (state: LocaleState) => void): () => void {
	return clientStore.subscribe(selectLocaleCode, () => listener(currentLocale()));
}

/** React: the locale shown (re-renders on a switch). */
export function useLocale(): L10nState {
	return useSelector(selectL10n);
}

/** React: the fonts of the locale shown. */
export function useUiFonts(): UiFonts {
	return fontsOf(useLocale());
}

/** React: the HUD text font (every HUD label; English: Arcade). */
export function useHudFont(): Enum.Font {
	return useUiFonts().text;
}

/** React: the monospace font. */
export function useMonoFont(): Enum.Font {
	return useUiFonts().mono;
}

/** React: the display-name font (lobby members, spectate bar, podium, boards, friend toasts: LD13). */
export function useNameFont(): Enum.Font {
	return useUiFonts().name;
}

/** The active pack (undefined only before ThemeController.onInit). */
export function themePack(): ThemePack | undefined {
	return getActiveThemePack();
}

/** A theme string (the key itself before a pack is loaded). */
export function str(key: string, vars?: StringVars): string {
	return getActiveThemePack()?.str(key, vars) ?? key;
}

/**
 * A shared/view HudText: its key with its literal vars and its `varKeys` (theme keys looked up first, docs/BUILDS.md
 * BU9). `extra` adds more literal vars.
 */
export function hudText(t: HudText, extra?: StringVars): string {
	const vars = new Map<string, string | number>();
	if (t.vars !== undefined)
		for (const [k, v] of pairs(t.vars as unknown as ReadonlyMap<string, string | number>)) vars.set(k, v);
	if (t.varKeys !== undefined)
		for (const [k, v] of pairs(t.varKeys as unknown as ReadonlyMap<string, string>)) vars.set(k, str(v));
	if (extra !== undefined)
		for (const [k, v] of pairs(extra as unknown as ReadonlyMap<string, string | number>)) vars.set(k, v);
	return str(t.key, vars as unknown as StringVars);
}

/** A theme colour role (black before a pack is loaded). */
export function role(r: ColorRole): Color3 {
	return getActiveThemePack()?.color(r) ?? new Color3();
}
