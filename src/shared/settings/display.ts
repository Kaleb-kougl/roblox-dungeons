/**
 * Display settings (Options screen, task L4): the HUD scale, a percent of the automatic scale (shared/view/hud
 * computeHudScale; the client's useHudScale multiplies it in), and the room-edge lines on the floor
 * (docs/ROOM_EDGES.md RE6), the corner panels' occlusion fade (docs/HUD_LAYOUT.md H7), the corner minimap
 * (docs/MINIMAP.md M10), the player outline (docs/PLAYER_OUTLINE.md P4), the build effects (docs/BUILDS.md BUD13) and the touch controls (docs/MOBILE.md MB7: size,
 * opacity, auto-target, left-handed). Presentation only; stored overrides-only (a new optional field needs no migration).
 */
import {
	BUILD_FX_LEVELS,
	DEFAULT_BUILD_FX,
	DEFAULT_HUD_FADE,
	DEFAULT_HUD_SCALE_PERCENT,
	DEFAULT_MINIMAP,
	DEFAULT_PLAYER_OUTLINE,
	DEFAULT_ROOM_EDGES,
	DEFAULT_TOUCH_AUTO_TARGET,
	DEFAULT_TOUCH_LEFT_HANDED,
	DEFAULT_TOUCH_OPACITY_PERCENT,
	DEFAULT_TOUCH_SIZE_PERCENT,
	HUD_SCALE_PERCENTS,
	TOUCH_OPACITY_PERCENTS,
	TOUCH_SIZE_PERCENTS,
	type BuildFxLevel,
} from "./config";

export interface DisplaySettings {
	/** One of HUD_SCALE_PERCENTS. */
	hudScale: number;
	/** Draw the dashed room-edge lines (docs/ROOM_EDGES.md RE6). Default true: only Off (false) is ever stored. */
	roomEdges: boolean;
	/** Fade a corner HUD panel while the player, enemies or bullets are under it (docs/HUD_LAYOUT.md H7). Default true. */
	hudFade: boolean;
	/** Show the corner minimap (docs/MINIMAP.md M10; the full map key works either way). Default true: only Off is stored. */
	minimap: boolean;
	/** Draw the rim around the watched player's character (docs/PLAYER_OUTLINE.md P4). Default true: only Off is stored. */
	playerOutline: boolean;
	/** Build effects Full / Reduced (docs/BUILDS.md BUD13). Default "full": only "reduced" is ever stored. */
	buildFx: BuildFxLevel;
	/** One of TOUCH_SIZE_PERCENTS: the touch controls' size, percent (docs/MOBILE.md MB7). Default 100. */
	touchSize: number;
	/** One of TOUCH_OPACITY_PERCENTS: the touch controls' opacity, percent (docs/MOBILE.md MB7). Default 70. */
	touchOpacity: number;
	/** Touch auto-target, the attack stick's aim assist (docs/MOBILE.md MB7). Default true: only Off (false) is stored. */
	touchAutoTarget: boolean;
	/** Mirror the touch controls to the left side (docs/MOBILE.md MB7). Default false: only On (true) is stored. */
	touchLeftHanded: boolean;
}

export type DisplayOverrides = Partial<DisplaySettings>;

export const DISPLAY_SETTING_KEYS: ReadonlyArray<keyof DisplaySettings> = [
	"hudScale",
	"roomEdges",
	"hudFade",
	"minimap",
	"playerOutline",
	"buildFx",
	"touchSize",
	"touchOpacity",
	"touchAutoTarget",
	"touchLeftHanded",
];

export function defaultDisplaySettings(): DisplaySettings {
	return {
		hudScale: DEFAULT_HUD_SCALE_PERCENT,
		roomEdges: DEFAULT_ROOM_EDGES,
		hudFade: DEFAULT_HUD_FADE,
		minimap: DEFAULT_MINIMAP,
		playerOutline: DEFAULT_PLAYER_OUTLINE,
		buildFx: DEFAULT_BUILD_FX,
		touchSize: DEFAULT_TOUCH_SIZE_PERCENT,
		touchOpacity: DEFAULT_TOUCH_OPACITY_PERCENT,
		touchAutoTarget: DEFAULT_TOUCH_AUTO_TARGET,
		touchLeftHanded: DEFAULT_TOUCH_LEFT_HANDED,
	};
}

/**
 * Keeps only a hudScale that is one of HUD_SCALE_PERCENTS (and not the default) and a roomEdges that is a boolean other
 * than the default (so only `false`), and the same for hudFade, minimap and playerOutline; a buildFx from
 * BUILD_FX_LEVELS other than the default (so only "reduced"); a touchSize / touchOpacity
 * from its list and not the default; a touchAutoTarget / touchLeftHanded that is a boolean other than the default. Never
 * throws.
 */
export function sanitizeDisplayOverrides(raw: unknown): DisplayOverrides {
	const out: DisplayOverrides = {};
	if (!typeIs(raw, "table")) return out;
	const t = raw as Record<string, unknown>;
	const v = t.hudScale;
	if (typeIs(v, "number") && v !== DEFAULT_HUD_SCALE_PERCENT && HUD_SCALE_PERCENTS.includes(v)) out.hudScale = v;
	const edges = t.roomEdges;
	if (typeIs(edges, "boolean") && edges !== DEFAULT_ROOM_EDGES) out.roomEdges = edges;
	const fade = t.hudFade;
	if (typeIs(fade, "boolean") && fade !== DEFAULT_HUD_FADE) out.hudFade = fade;
	const minimap = t.minimap;
	if (typeIs(minimap, "boolean") && minimap !== DEFAULT_MINIMAP) out.minimap = minimap;
	const rim = t.playerOutline;
	if (typeIs(rim, "boolean") && rim !== DEFAULT_PLAYER_OUTLINE) out.playerOutline = rim;
	const buildFx = t.buildFx;
	if (
		typeIs(buildFx, "string") &&
		buildFx !== DEFAULT_BUILD_FX &&
		BUILD_FX_LEVELS.includes(buildFx as BuildFxLevel)
	) {
		out.buildFx = buildFx as BuildFxLevel;
	}
	const touchSize = t.touchSize;
	if (
		typeIs(touchSize, "number") &&
		touchSize !== DEFAULT_TOUCH_SIZE_PERCENT &&
		TOUCH_SIZE_PERCENTS.includes(touchSize)
	) {
		out.touchSize = touchSize;
	}
	const touchOpacity = t.touchOpacity;
	if (
		typeIs(touchOpacity, "number") &&
		touchOpacity !== DEFAULT_TOUCH_OPACITY_PERCENT &&
		TOUCH_OPACITY_PERCENTS.includes(touchOpacity)
	) {
		out.touchOpacity = touchOpacity;
	}
	const autoTarget = t.touchAutoTarget;
	if (typeIs(autoTarget, "boolean") && autoTarget !== DEFAULT_TOUCH_AUTO_TARGET) out.touchAutoTarget = autoTarget;
	const leftHanded = t.touchLeftHanded;
	if (typeIs(leftHanded, "boolean") && leftHanded !== DEFAULT_TOUCH_LEFT_HANDED) out.touchLeftHanded = leftHanded;
	return out;
}

export function resolveDisplaySettings(overrides: unknown): DisplaySettings {
	return { ...defaultDisplaySettings(), ...sanitizeDisplayOverrides(overrides) };
}

export function sameDisplayOverrides(a: Readonly<DisplayOverrides>, b: Readonly<DisplayOverrides>): boolean {
	for (const k of DISPLAY_SETTING_KEYS) if (a[k] !== b[k]) return false;
	return true;
}
