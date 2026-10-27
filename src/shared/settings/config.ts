/** Settings persistence tunables (SettingsService). Data only. */
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
export const DEFAULT_HUD_SCALE_PERCENT = 100;

/** Room-edge lines (docs/ROOM_EDGES.md RE6, Options > Display > Room edges): On by default. */
export const DEFAULT_ROOM_EDGES = true;

/** Corner HUD panels fade while the action is under them (docs/HUD_LAYOUT.md H7, Options > Display > HUD fade): On. */
export const DEFAULT_HUD_FADE = true;

/** The corner minimap (docs/MINIMAP.md M10, Options > Display > Minimap): On by default (the full map key always works). */
export const DEFAULT_MINIMAP = true;
