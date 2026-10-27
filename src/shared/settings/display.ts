/**
 * Display settings (Options screen, task L4): the HUD scale, a percent of the automatic scale (shared/view/hud
 * computeHudScale; the client's useHudScale multiplies it in), and the room-edge lines on the floor
 * (docs/ROOM_EDGES.md RE6). Presentation only; stored overrides-only (a new optional field needs no migration).
 */
import { DEFAULT_HUD_SCALE_PERCENT, DEFAULT_ROOM_EDGES, HUD_SCALE_PERCENTS } from "./config";

export interface DisplaySettings {
	/** One of HUD_SCALE_PERCENTS. */
	hudScale: number;
	/** Draw the dashed room-edge lines (docs/ROOM_EDGES.md RE6). Default true: only Off (false) is ever stored. */
	roomEdges: boolean;
}

export type DisplayOverrides = Partial<DisplaySettings>;

export const DISPLAY_SETTING_KEYS: ReadonlyArray<keyof DisplaySettings> = ["hudScale", "roomEdges"];

export function defaultDisplaySettings(): DisplaySettings {
	return { hudScale: DEFAULT_HUD_SCALE_PERCENT, roomEdges: DEFAULT_ROOM_EDGES };
}

/**
 * Keeps only a hudScale that is one of HUD_SCALE_PERCENTS (and not the default) and a roomEdges that is a boolean other
 * than the default (so only `false`). Never throws.
 */
export function sanitizeDisplayOverrides(raw: unknown): DisplayOverrides {
	const out: DisplayOverrides = {};
	if (!typeIs(raw, "table")) return out;
	const t = raw as Record<string, unknown>;
	const v = t.hudScale;
	if (typeIs(v, "number") && v !== DEFAULT_HUD_SCALE_PERCENT && HUD_SCALE_PERCENTS.includes(v)) out.hudScale = v;
	const edges = t.roomEdges;
	if (typeIs(edges, "boolean") && edges !== DEFAULT_ROOM_EDGES) out.roomEdges = edges;
	return out;
}

export function resolveDisplaySettings(overrides: unknown): DisplaySettings {
	return { ...defaultDisplaySettings(), ...sanitizeDisplayOverrides(overrides) };
}

export function sameDisplayOverrides(a: Readonly<DisplayOverrides>, b: Readonly<DisplayOverrides>): boolean {
	for (const k of DISPLAY_SETTING_KEYS) if (a[k] !== b[k]) return false;
	return true;
}
