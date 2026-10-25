import { DataStoreService } from "@rbxts/services";
import type { KeyValueStore } from "shared/settings";

/**
 * The real KeyValueStore: one Roblox DataStore. Thin on purpose (retries, caching and dirty tracking live in the pure
 * shared/settings `PlayerDocCache`, tested headlessly with an in-memory store).
 *
 * Writes tag the key with the owning players' UserIds (SetAsync's `userIds`, UpdateAsync's second return value), so
 * the entry is found by GDPR / right-to-erasure tooling. Every key here is `u_<UserId>` (shared/settings
 * `playerDataKey`); callers pass that UserId alongside it.
 *
 * The DataStore is resolved on first use, inside the caller's retry, because `GetDataStore` itself throws in a Studio
 * place without "Enable Studio Access to API Services" (or unpublished): that becomes a failed load / save, not a
 * service that fails to start.
 */
export class DataStoreKeyValue implements KeyValueStore {
	private store?: DataStore;

	constructor(private readonly name: string) {}

	get(key: string): unknown {
		const [value] = this.resolve().GetAsync(key);
		return value;
	}

	set(key: string, value: unknown, userIds?: ReadonlyArray<number>): void {
		this.resolve().SetAsync(key, value, userIds !== undefined ? [...userIds] : undefined);
	}

	/** UpdateAsync: `transform(old)` returns the new value (undefined cancels the write), tagged with `userIds`. */
	update(key: string, transform: (old: unknown) => unknown, userIds?: ReadonlyArray<number>): void {
		const ids = userIds !== undefined ? [...userIds] : undefined;
		this.resolve().UpdateAsync(key, (old: unknown) => $tuple(transform(old), ids));
	}

	private resolve(): DataStore {
		if (this.store === undefined) this.store = DataStoreService.GetDataStore(this.name);
		return this.store;
	}
}
