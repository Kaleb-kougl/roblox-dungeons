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
