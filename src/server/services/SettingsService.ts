import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { SlidingWindowLimiter } from "shared/run";
import {
	PlayerDocCache,
	SETTINGS_AUTOSAVE_SECONDS,
	SETTINGS_DATASTORE_NAME,
	SETTINGS_REQUEST_RATE,
	SETTINGS_RETRY,
	applySettingsPatch,
	decodeSettingsDoc,
	encodeSettingsDoc,
	playerDataKey,
	sameSettingsOverrides,
	type DocCodec,
	type SettingsOverrides,
	type KeyValueStore,
} from "shared/settings";
import { DataStoreKeyValue } from "./data/DataStoreKeyValue";

const log = serverLogger("Settings");

/** BindToClose: give up waiting for the last saves after this many seconds (Roblox allows about 30). */
const SHUTDOWN_SAVE_TIMEOUT_SECONDS = 25;
const SHUTDOWN_POLL_SECONDS = 0.1;

const SETTINGS_CODEC: DocCodec<SettingsOverrides> = {
	decode(raw) {
		return decodeSettingsDoc(raw);
	},
	encode(doc) {
		return encodeSettingsDoc(doc);
	},
	equals(a, b) {
		return sameSettingsOverrides(a, b);
	},
	empty() {
		return {};
	},
};

/**
 * Per-player settings (the web build's localStorage juice settings, src/fx/settings.ts, moved to a DataStore; since
 * task L4 also key bindings, audio volumes and the HUD scale): one settings document v2 per player (shared/settings
 * doc.ts; a stored v1 document migrates on load, its juice kept). Stores only what a player changed, sanitized here
 * (`applySettingsPatch`: reserved / duplicate bindings, bad volumes, unknown keys dropped); the client resolves it
 * against its defaults. `updateSettings` replaces each group its patch carries.
 *
 * Loaded on join (with retries) into a session cache, served from it, saved when dirty on leave, on BindToClose and
 * every SETTINGS_AUTOSAVE_SECONDS. A failed load runs the session on defaults and never overwrites the stored value
 * unless the player changes something. Requests are rate limited per player; a rate-limited update / reset still
 * answers with the stored overrides so the client's optimistic copy re-syncs.
 *
 * Races: the join load and an early requestSettings share one DataStore read (PlayerDocCache load sharing); remotes
 * from a player who already left are ignored, and after any yield a handler drops the player's entry instead of
 * using it if they left meanwhile, so nothing is cached for departed players. The leave save and the BindToClose save
 * of the same key never both write (the cache waits for an in-flight save).
 */
@Service({})
export class SettingsService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly cache: PlayerDocCache<SettingsOverrides>;
	private readonly limiter = new SlidingWindowLimiter<Player>(
		SETTINGS_REQUEST_RATE.count,
		SETTINGS_REQUEST_RATE.windowSeconds,
	);
	private closing = false;

	constructor() {
		this.cache = new PlayerDocCache(
			this.createStore(),
			SETTINGS_CODEC,
			SETTINGS_RETRY,
			(s) => task.wait(s),
			(waiter) => task.spawn(waiter),
		);
	}

	onStart(): void {
		this.janitor.Add(Players.PlayerAdded.Connect((player) => this.loadAndSend(player)));
		for (const player of Players.GetPlayers()) task.spawn(() => this.loadAndSend(player));
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.release(player)));

		this.janitor.Add(
			Events.requestSettings.connect((player) => {
				if (player.Parent === undefined || !this.allow(player)) return;
				const overrides = this.loadFor(player);
				if (overrides !== undefined) this.send(player, overrides);
			}),
		);
		this.janitor.Add(
			Events.updateSettings.connect((player, patch) => {
				if (player.Parent === undefined) return;
				if (!this.allow(player)) {
					this.resync(player);
					return;
				}
				const current = this.loadFor(player);
				if (current === undefined) return;
				const updated = applySettingsPatch(current, patch);
				this.cache.set(playerDataKey(player.UserId), updated);
				this.send(player, updated);
			}),
		);
		this.janitor.Add(
			Events.resetSettings.connect((player) => {
				if (player.Parent === undefined) return;
				if (!this.allow(player)) {
					this.resync(player);
					return;
				}
				if (this.loadFor(player) === undefined) return;
				this.cache.set(playerDataKey(player.UserId), {});
				this.send(player, {});
			}),
		);

		const autosave = task.spawn(() => {
			for (;;) {
				task.wait(SETTINGS_AUTOSAVE_SECONDS);
				if (this.closing) return;
				for (const key of this.cache.keys()) if (this.cache.isDirty(key)) this.saveKey(key);
			}
		});
		this.janitor.Add(() => task.cancel(autosave));
		game.BindToClose(() => this.saveAllOnClose());
	}

	/** This player's stored overrides, or undefined before they are loaded. */
	getOverrides(player: Player): Readonly<SettingsOverrides> | undefined {
		return this.cache.get(playerDataKey(player.UserId));
	}

	/** The store (a seam: a test or tool can subclass the service with an in-memory KeyValueStore). */
	protected createStore(): KeyValueStore {
		return new DataStoreKeyValue(SETTINGS_DATASTORE_NAME);
	}

	protected now(): number {
		return os.clock();
	}

	private allow(player: Player): boolean {
		if (this.limiter.tryAcquire(player, this.now())) return true;
		log.warn("RATE_LIMITED", `${player.UserId}: settings request dropped`);
		return false;
	}

	private loadAndSend(player: Player): void {
		const key = playerDataKey(player.UserId);
		const overrides = this.loadFor(player);
		if (this.cache.loadFailed(key)) log.warn("LOAD_FAILED", `${player.UserId}: running on defaults this session`);
		if (overrides !== undefined) this.send(player, overrides);
	}

	/**
	 * The player's overrides, loading them if needed (may yield). Undefined when the player left while it yielded:
	 * their entry is dropped then, so nothing stays cached for a departed player.
	 */
	private loadFor(player: Player): SettingsOverrides | undefined {
		const overrides = this.cache.load(playerDataKey(player.UserId), [player.UserId]);
		if (player.Parent === undefined) {
			this.release(player);
			return undefined;
		}
		return overrides;
	}

	/** Answers a dropped (rate-limited) change with what is stored, if loaded: the client's optimistic copy re-syncs. */
	private resync(player: Player): void {
		const current = this.cache.get(playerDataKey(player.UserId));
		if (current !== undefined) this.send(player, current);
	}

	private send(player: Player, overrides: SettingsOverrides): void {
		if (player.Parent !== undefined) Events.settingsChanged.fire(player, overrides);
	}

	private release(player: Player): void {
		this.limiter.forget(player);
		const key = playerDataKey(player.UserId);
		if (this.cache.get(key) === undefined) return;
		const outcome = this.cache.release(key);
		if (outcome === "failed") log.warn("SAVE_FAILED", `${player.UserId}: settings not saved on leave`);
	}

	private saveKey(key: string): void {
		if (this.cache.save(key) === "failed") log.warn("SAVE_FAILED", `${key}: autosave failed, will retry`);
	}

	/** Saves every dirty player in parallel and waits (bounded) for the writes. */
	private saveAllOnClose(): void {
		this.closing = true;
		let pending = 0;
		for (const key of this.cache.keys()) {
			if (!this.cache.isDirty(key)) continue;
			pending++;
			task.spawn(() => {
				this.saveKey(key);
				pending--;
			});
		}
		const deadline = this.now() + SHUTDOWN_SAVE_TIMEOUT_SECONDS;
		while (pending > 0 && this.now() < deadline) task.wait(SHUTDOWN_POLL_SECONDS);
		if (pending > 0) log.warn("SHUTDOWN_SAVE_TIMEOUT", `${pending} settings saves still pending`);
	}
}
