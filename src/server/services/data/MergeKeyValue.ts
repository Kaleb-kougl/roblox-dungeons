import type { KeyValueStore } from "shared/settings";
import { DataStoreKeyValue } from "./DataStoreKeyValue";

/**
 * A KeyValueStore whose writes MERGE into the stored value inside UpdateAsync instead of replacing it: `set(key,
 * value)` runs `merge(stored, value)` in the transform (undefined cancels the write). With a monotonic merge (shared/
 * records `mergeStoredRecords`, max per field) concurrent servers never lower what another wrote, and a session whose
 * join load failed may still write safely. PlayerDocCache uses it like any store.
 *
 * `canWrite` false makes every write a no-op that succeeds (Studio under a no-Studio-writes policy: the session cache
 * still works, nothing reaches the DataStore).
 */
export class MergeKeyValue implements KeyValueStore {
	private readonly store: DataStoreKeyValue;

	constructor(
		name: string,
		private readonly merge: (stored: unknown, incoming: unknown) => unknown,
		private readonly canWrite: () => boolean = () => true,
	) {
		this.store = new DataStoreKeyValue(name);
	}

	get(key: string): unknown {
		return this.store.get(key);
	}

	set(key: string, value: unknown, userIds?: ReadonlyArray<number>): void {
		if (!this.canWrite()) return;
		this.store.update(key, (stored) => this.merge(stored, value), userIds);
	}
}
