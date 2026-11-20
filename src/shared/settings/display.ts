/**
 * Display settings (Options screen, task L4): the HUD scale, a percent of the automatic scale (shared/view/hud
 * computeHudScale; the client's useHudScale multiplies it in), and the room-edge lines on the floor
 * (docs/ROOM_EDGES.md RE6), the corner panels' occlusion fade (docs/HUD_LAYOUT.md H7), the live HUD's item tooltips (docs/ITEM_TOOLTIPS.md ITD8), the corner minimap
 * (docs/MINIMAP.md M10), the player outline (docs/PLAYER_OUTLINE.md P4), the co-op name tags (docs/PLAYER_NAMES.md PN2), the build effects (docs/BUILDS.md BUD13), the touch controls (docs/MOBILE.md MB7: size,
 * opacity, auto-target, left-handed), the language (docs/LOCALIZATION.md L6), the gamepad menus' vibration
 * (docs/GAMEPAD_MENUS.md GM9), the phone's vibration (docs/HAPTICS.md HP5), the remembered character pick (docs/ARCHER.md ARD12: the character screen's focus
 * and the run a start plays) and the gauntlet cursor's size (docs/CURSOR.md D2) and whether it shows in gameplay (revision 3). Presentation only; stored
 * overrides-only (a new optional field needs no migration).
 */
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from "shared/characters";
import { localeDef } from "shared/l10n";
import {
	BUILD_FX_LEVELS,
	CURSOR_SIZES,
	DEFAULT_BUILD_FX,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_GAME_CURSOR,
	DEFAULT_HUD_FADE,
	DEFAULT_HUD_SCALE_PERCENT,
	DEFAULT_HUD_TOOLTIPS,
	DEFAULT_LANGUAGE,
	DEFAULT_MINIMAP,
	DEFAULT_PAD_VIBRATION,
	DEFAULT_PLAYER_NAMES,
	DEFAULT_PLAYER_OUTLINE,
	DEFAULT_ROOM_EDGES,
	DEFAULT_TOUCH_AUTO_TARGET,
	DEFAULT_TOUCH_LEFT_HANDED,
	DEFAULT_TOUCH_OPACITY_PERCENT,
	DEFAULT_TOUCH_SIZE_PERCENT,
	DEFAULT_TOUCH_VIBRATION,
	HUD_SCALE_PERCENTS,
	LANGUAGE_AUTO,
	TOUCH_OPACITY_PERCENTS,
	TOUCH_SIZE_PERCENTS,
	type BuildFxLevel,
	type CursorSize,
} from "./config";

export interface DisplaySettings {
	/** One of HUD_SCALE_PERCENTS. */
	hudScale: number;
	/** Draw the dashed room-edge lines (docs/ROOM_EDGES.md RE6). Default true: only Off (false) is ever stored. */
	roomEdges: boolean;
	/** Fade a corner HUD panel while the player, enemies or bullets are under it (docs/HUD_LAYOUT.md H7). Default true. */
	hudFade: boolean;
	/** Item tooltips on the live HUD (docs/ITEM_TOOLTIPS.md ITD8; menus always have them). Default true: only Off is stored. */
	hudTooltips: boolean;
	/** Show the corner minimap (docs/MINIMAP.md M10; the full map key works either way). Default true: only Off is stored. */
	minimap: boolean;
	/** Draw the rim around the watched player's character (docs/PLAYER_OUTLINE.md P4). Default true: only Off is stored. */
	playerOutline: boolean;
	/**
	 * Draw each living teammate's display name on the floor above their character in co-op (docs/PLAYER_NAMES.md PN2).
	 * Default true: only Off is stored.
	 */
	playerNames: boolean;
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
	/**
	 * The language override (docs/LOCALIZATION.md L6): LANGUAGE_AUTO (default, never stored) or a shared/l10n LOCALES code
	 * (hidden ones too: whether a hidden pick is honoured is decided when it is read, languageOverride).
	 */
	language: string;
	/**
	 * Vibrate the gamepad on menu cues (docs/GAMEPAD_MENUS.md GM9: confirm, a disabled press, a list's end, hold-B).
	 * Default true: only Off (false) is ever stored.
	 */
	padVibration: boolean;
	/**
	 * Vibrate the phone on in-run moments (docs/HAPTICS.md HP5, HPD6: a separate Touch toggle; touchHapticsOn). Shown on
	 * Options > Controls > Touch, not the Display tab (DISPLAY_RESET_KEEPS). Default true: only Off (false) is ever
	 * stored.
	 */
	touchVibration: boolean;
	/**
	 * The last character picked (docs/ARCHER.md ARD12, AR5): a shared/characters CharacterId, the next run's and the
	 * character screen's focus. Default DEFAULT_CHARACTER (the Knight): only another pick is ever stored. Shown on the
	 * character screen, not the Display tab (DISPLAY_RESET_KEEPS).
	 */
	character: CharacterId;
	/**
	 * The gauntlet cursor's size in menus, Small / Normal / Large (docs/CURSOR.md D2; shared/view cursorScale). Default
	 * DEFAULT_CURSOR_SIZE ("normal"): only "small" or "large" is ever stored.
	 */
	cursorSize: CursorSize;
	/**
	 * The gauntlet cursor in gameplay too (docs/CURSOR.md revision 3): true = the gauntlet everywhere, false = Roblox's
	 * pointer while playing (menus keep the gauntlet). Default DEFAULT_GAME_CURSOR (true): only Off (false) is stored.
	 */
	gameCursor: boolean;
	/**
	 * docs/SILVER.md SV18 (OC12): the one-time main-menu card for accounts that played before the Silver update was
	 * shown and dismissed. Default false: only true is ever stored. Not on the Display tab (DISPLAY_RESET_KEEPS).
	 */
	silverNoticeSeen: boolean;
}

export type DisplayOverrides = Partial<DisplaySettings>;

export const DISPLAY_SETTING_KEYS: ReadonlyArray<keyof DisplaySettings> = [
	"hudScale",
	"roomEdges",
	"hudFade",
	"hudTooltips",
	"minimap",
	"playerOutline",
	"playerNames",
	"buildFx",
	"touchSize",
	"touchOpacity",
	"touchAutoTarget",
	"touchLeftHanded",
	"language",
	"padVibration",
	"touchVibration",
	"character",
	"cursorSize",
	"gameCursor",
	"silverNoticeSeen",
];

export function defaultDisplaySettings(): DisplaySettings {
	return {
		hudScale: DEFAULT_HUD_SCALE_PERCENT,
		roomEdges: DEFAULT_ROOM_EDGES,
		hudFade: DEFAULT_HUD_FADE,
		hudTooltips: DEFAULT_HUD_TOOLTIPS,
		minimap: DEFAULT_MINIMAP,
		playerOutline: DEFAULT_PLAYER_OUTLINE,
		playerNames: DEFAULT_PLAYER_NAMES,
		buildFx: DEFAULT_BUILD_FX,
		touchSize: DEFAULT_TOUCH_SIZE_PERCENT,
		touchOpacity: DEFAULT_TOUCH_OPACITY_PERCENT,
		touchAutoTarget: DEFAULT_TOUCH_AUTO_TARGET,
		touchLeftHanded: DEFAULT_TOUCH_LEFT_HANDED,
		language: DEFAULT_LANGUAGE,
		padVibration: DEFAULT_PAD_VIBRATION,
		touchVibration: DEFAULT_TOUCH_VIBRATION,
		character: DEFAULT_CHARACTER,
		cursorSize: DEFAULT_CURSOR_SIZE,
		gameCursor: DEFAULT_GAME_CURSOR,
		silverNoticeSeen: false,
	};
}

/**
 * Keeps only a hudScale that is one of HUD_SCALE_PERCENTS (and not the default) and a roomEdges that is a boolean other
 * than the default (so only `false`), and the same for hudFade, hudTooltips, minimap, playerOutline and playerNames; a buildFx from
 * BUILD_FX_LEVELS other than the default (so only "reduced"); a touchSize / touchOpacity
 * from its list and not the default; a touchAutoTarget / touchLeftHanded that is a boolean other than the default; a
 * language that is a known locale code (stored as LOCALES spells it; "auto" and unknown codes are dropped); a
 * padVibration / touchVibration that is a boolean other than the default (so only `false`); a character that is a
 * character id other than DEFAULT_CHARACTER; a cursorSize from CURSOR_SIZES other than the default (so only "small" /
 * "large"); a gameCursor that is a boolean other than the default (so only `false`); a silverNoticeSeen that is true. Never throws.
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
	const tips = t.hudTooltips;
	if (typeIs(tips, "boolean") && tips !== DEFAULT_HUD_TOOLTIPS) out.hudTooltips = tips;
	const minimap = t.minimap;
	if (typeIs(minimap, "boolean") && minimap !== DEFAULT_MINIMAP) out.minimap = minimap;
	const rim = t.playerOutline;
	if (typeIs(rim, "boolean") && rim !== DEFAULT_PLAYER_OUTLINE) out.playerOutline = rim;
	const names = t.playerNames;
	if (typeIs(names, "boolean") && names !== DEFAULT_PLAYER_NAMES) out.playerNames = names;
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
	const language = t.language;
	if (typeIs(language, "string") && language !== LANGUAGE_AUTO) {
		const def = localeDef(language);
		if (def !== undefined) out.language = def.code;
	}
	const vibration = t.padVibration;
	if (typeIs(vibration, "boolean") && vibration !== DEFAULT_PAD_VIBRATION) out.padVibration = vibration;
	const touchVibration = t.touchVibration;
	if (typeIs(touchVibration, "boolean") && touchVibration !== DEFAULT_TOUCH_VIBRATION) {
		out.touchVibration = touchVibration;
	}
	const character = t.character;
	if (isCharacterId(character) && character !== DEFAULT_CHARACTER) out.character = character;
	const cursorSize = t.cursorSize;
	if (
		typeIs(cursorSize, "string") &&
		cursorSize !== DEFAULT_CURSOR_SIZE &&
		CURSOR_SIZES.includes(cursorSize as CursorSize)
	) {
		out.cursorSize = cursorSize as CursorSize;
	}
	const gameCursor = t.gameCursor;
	if (typeIs(gameCursor, "boolean") && gameCursor !== DEFAULT_GAME_CURSOR) out.gameCursor = gameCursor;
	const silverNotice = t.silverNoticeSeen;
	if (silverNotice === true) out.silverNoticeSeen = true;
	return out;
}

/**
 * Display settings shown elsewhere, which the Display tab's Reset (and Options X there) keeps: `padVibration` sits on
 * Controls > Gamepad (docs/GAMEPAD_MENUS.md GM9), `touchVibration` on Controls > Touch (docs/HAPTICS.md HP5),
 * `character` is the character screen's pick (docs/ARCHER.md AR5).
 */
export const DISPLAY_RESET_KEEPS: ReadonlyArray<keyof DisplaySettings> = [
	"padVibration",
	"touchVibration",
	"character",
	"silverNoticeSeen",
];

/** The display group after the Display tab's Reset: every override dropped but DISPLAY_RESET_KEEPS' (sanitized). */
export function displayResetOverrides(current: unknown): DisplayOverrides {
	const clean = sanitizeDisplayOverrides(current);
	const kept: Record<string, unknown> = {};
	for (const k of DISPLAY_RESET_KEEPS) if (clean[k] !== undefined) kept[k] = clean[k];
	return sanitizeDisplayOverrides(kept);
}

export function resolveDisplaySettings(overrides: unknown): DisplaySettings {
	return { ...defaultDisplaySettings(), ...sanitizeDisplayOverrides(overrides) };
}

export function sameDisplayOverrides(a: Readonly<DisplayOverrides>, b: Readonly<DisplayOverrides>): boolean {
	for (const k of DISPLAY_SETTING_KEYS) if (a[k] !== b[k]) return false;
	return true;
}

/**
 * The locale override a language setting asks for (shared/l10n pickLocale's `override`): undefined for automatic, an
 * unknown code, or a hidden locale when the player may not pick hidden ones (`allowHidden`: developers, Studio).
 */
export function languageOverride(language: string, allowHidden: boolean): string | undefined {
	if (language === LANGUAGE_AUTO) return undefined;
	const def = localeDef(language);
	if (def === undefined) return undefined;
	return def.status === "live" || allowHidden ? def.code : undefined;
}
