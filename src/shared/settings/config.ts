/**
 * Settings persistence tunables (SettingsService). Data only.
 *
 * @module
 */
import type { RetryPolicy } from "./store";

/** DataStore holding one SettingsDoc per player. */
export const SETTINGS_DATASTORE_NAME = "PlayerSettings";

/** The player's key in SETTINGS_DATASTORE_NAME (and in the Runs store): `u_<UserId>`. */
export function playerDataKey(userId: number): string {
	return `u_${userId}`;
}

/** DataStore calls: 3 tries, waiting 1 s then 2 s. */
export const SETTINGS_RETRY: RetryPolicy = table.freeze({ attempts: 3, baseDelaySeconds: 1 });

/** Dirty settings are also written every this many seconds (besides leave / shutdown). */
export const SETTINGS_AUTOSAVE_SECONDS = 120;

/** Per-player budget for settings remotes (get / update / reset together): `count` per `windowSeconds`. */
export const SETTINGS_REQUEST_RATE = table.freeze({ count: 20, windowSeconds: 10 });

/**
 * Workspace attributes the client's settings read (Explorer -> Workspace -> Attributes). Off / unset by default.
 *   resetBindings  Boolean, dev only: on join, clear this player's saved key bindings (the `controls` group) once
 *                  the server's settings arrive. The other groups are kept.
 */
export const SETTINGS_ATTRIBUTES = {
	resetBindings: "KV_ResetBindings",
} as const;

/** Audio volumes are stored as whole percents 0..100; the Options screen steps them by `step`. Default: full. */
export const VOLUME_PERCENT = { min: 0, max: 100, step: 10, default: 100 } as const;

/**
 * The HUD scale choices (percent of the automatic scale, shared/view/hud computeHudScale). Only these are accepted
 * from a stored doc; 100 is the default.
 */
export const HUD_SCALE_PERCENTS: ReadonlyArray<number> = [70, 80, 90, 100, 110, 125];
/** The HUD scale of a player who never changed it: 100 percent, the automatic scale as computed. Never stored. */
export const DEFAULT_HUD_SCALE_PERCENT = 100;

/** Room-edge lines (docs/ROOM_EDGES.md RE6, Options > Display > Room edges): On by default. */
export const DEFAULT_ROOM_EDGES = true;

/** Corner HUD panels fade while the action is under them (docs/HUD_LAYOUT.md H7, Options > Display > HUD fade): On. */
export const DEFAULT_HUD_FADE = true;

/**
 * Item tooltips on the live HUD's items and boost rows (docs/ITEM_TOOLTIPS.md ITD8, Options > Display > Item tooltips
 * in combat): On. Off only stops the live HUD's; the pause and run-over lists always have them.
 */
export const DEFAULT_HUD_TOOLTIPS = true;

/** The corner minimap (docs/MINIMAP.md M10, Options > Display > Minimap): On by default (the full map key always works). */
export const DEFAULT_MINIMAP = true;

/** The watched player's rim (docs/PLAYER_OUTLINE.md P4, Options > Display > Player outline): On by default. */
export const DEFAULT_PLAYER_OUTLINE = true;

/**
 * Co-op name tags (docs/PLAYER_NAMES.md PN2, Options > Display > Player names): each living teammate's display name on
 * the floor above their character. On by default. Presentation only; solo runs never draw one.
 */
export const DEFAULT_PLAYER_NAMES = true;

/**
 * Menu vibration on the gamepad (docs/GAMEPAD_MENUS.md GM9, Options > Controls > Gamepad > Vibration): On by default.
 * Menus only (shared/view/menu MENU_HAPTICS); silent where the pad has no motor.
 */
export const DEFAULT_PAD_VIBRATION = true;

/**
 * Phone vibration (docs/HAPTICS.md HP5, HPD6, Options > Controls > Touch > Vibration): On by default. The in-run haptics
 * on a touch device (shared/settings touchHapticsOn); silent where the phone has no actuator.
 */
export const DEFAULT_TOUCH_VIBRATION = true;

/**
 * Build effects (docs/BUILDS.md BUD13, Options > Display > Build effects): Full, or Reduced (half the spark / nova
 * particles and ring segments, no bullet trails). Presentation only: effect bullets are always drawn.
 */
export type BuildFxLevel = "full" | "reduced";
/**
 * Every build effects level, in the order the Options screen offers them; a stored value outside this list is dropped.
 */
export const BUILD_FX_LEVELS: ReadonlyArray<BuildFxLevel> = ["full", "reduced"];
/** Build effects of a player who never changed them: Full. Never stored (only `reduced` is). */
export const DEFAULT_BUILD_FX: BuildFxLevel = "full";

/**
 * The gauntlet cursor's size (docs/CURSOR.md D2, Options > Display > Cursor size): Small / Normal / Large, one whole
 * scale step apart (shared/view CURSOR_VIEW.sizeSteps, cursorScale). Normal is the default. Presentation only.
 */
export type CursorSize = "small" | "normal" | "large";
/**
 * Every cursor size, in the order the Options screen offers them (small to large); a stored value outside this list is
 * dropped.
 */
export const CURSOR_SIZES: ReadonlyArray<CursorSize> = ["small", "normal", "large"];
/** The cursor size of a player who never changed it: Normal. Never stored (only `small` or `large` is). */
export const DEFAULT_CURSOR_SIZE: CursorSize = "normal";

/**
 * The gauntlet cursor in gameplay too (docs/CURSOR.md revision 3, Options > Display > In-game cursor: Gauntlet /
 * Standard). On by default; Standard (false) keeps Roblox's pointer while playing, as revision 2 did. Menus always draw
 * the gauntlet. Presentation only: the aim point is the mouse position either way.
 */
export const DEFAULT_GAME_CURSOR = true;

/** Touch control sizes, percent of the layout (docs/MOBILE.md MB7, Options > Display > Touch size). 100 is the default. */
export const TOUCH_SIZE_PERCENTS: ReadonlyArray<number> = [80, 100, 120];
/** The touch controls' size of a player who never changed it: 100 percent of the layout. Never stored. */
export const DEFAULT_TOUCH_SIZE_PERCENT = 100;

/** Touch control opacity, percent (docs/MOBILE.md MB7, Options > Display > Touch opacity). 70 is the default. */
export const TOUCH_OPACITY_PERCENTS: ReadonlyArray<number> = [40, 70, 100];
/** The touch controls' opacity of a player who never changed it: 70 percent. Never stored. */
export const DEFAULT_TOUCH_OPACITY_PERCENT = 70;

/** Touch auto-target: the aim assist on the attack stick (docs/MOBILE.md MB7, Options > Display > Auto-target): On. */
export const DEFAULT_TOUCH_AUTO_TARGET = true;

/** Left-handed touch layout: the controls mirror to the left side (docs/MOBILE.md MB7): Off. */
export const DEFAULT_TOUCH_LEFT_HANDED = false;

/**
 * Options > Display > Language (docs/LOCALIZATION.md L6, LD3): "auto" follows the player's Roblox language (the
 * default, never stored); otherwise a shared/l10n LOCALES code (the override).
 */
export const LANGUAGE_AUTO = "auto";
/** The language setting of a player who never changed it: automatic (the player's Roblox language). Never stored. */
export const DEFAULT_LANGUAGE = LANGUAGE_AUTO;
