/**
 * Display settings (Options screen, task L4): the HUD scale, a percent of the automatic scale (shared/view/hud
 * computeHudScale; the client's useHudScale multiplies it in). Presentation only; stored overrides-only.
 */
import { DEFAULT_HUD_SCALE_PERCENT, HUD_SCALE_PERCENTS } from "./config";

export interface DisplaySettings {
	/** One of HUD_SCALE_PERCENTS. */
	hudScale: number;
}

export type DisplayOverrides = Partial<DisplaySettings>;

export const DISPLAY_SETTING_KEYS: ReadonlyArray<keyof DisplaySettings> = ["hudScale"];

export function defaultDisplaySettings(): DisplaySettings {
	return { hudScale: DEFAULT_HUD_SCALE_PERCENT };
}

/** Keeps only a hudScale that is one of HUD_SCALE_PERCENTS (and not the default). Never throws. */
export function sanitizeDisplayOverrides(raw: unknown): DisplayOverrides {
	const out: DisplayOverrides = {};
	if (!typeIs(raw, "table")) return out;
	const v = (raw as Record<string, unknown>).hudScale;
	if (typeIs(v, "number") && v !== DEFAULT_HUD_SCALE_PERCENT && HUD_SCALE_PERCENTS.includes(v)) out.hudScale = v;
	return out;
}

export function resolveDisplaySettings(overrides: unknown): DisplaySettings {
	return { ...defaultDisplaySettings(), ...sanitizeDisplayOverrides(overrides) };
}

export function sameDisplayOverrides(a: Readonly<DisplayOverrides>, b: Readonly<DisplayOverrides>): boolean {
	for (const k of DISPLAY_SETTING_KEYS) if (a[k] !== b[k]) return false;
	return true;
}
