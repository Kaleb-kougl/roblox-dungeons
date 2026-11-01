import { getActiveThemePack, type ColorRole, type ThemePack } from "shared/theme";
import type { StringVars } from "shared/theme";
import { HUD_FONTS, type HudText } from "shared/view/hud";

/**
 * The UI's access to the theme: the active pack (loaded by ThemeController before anything mounts), strings, colour
 * roles and the HUD font token. Every HUD text and colour goes through here (CLAUDE.md: logical IDs only).
 */

function fontByName(name: string): Enum.Font {
	return Enum.Font.GetEnumItems().find((f) => f.Name === name) ?? Enum.Font.SourceSans;
}

/** The HUD font (shared/view/hud HUD_FONTS.text, resolved once): every HUD label and the damage numbers use it. */
export const HUD_FONT: Enum.Font = fontByName(HUD_FONTS.text);
/** The monospace font of the debug line. */
export const MONO_FONT: Enum.Font = fontByName(HUD_FONTS.mono);

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
