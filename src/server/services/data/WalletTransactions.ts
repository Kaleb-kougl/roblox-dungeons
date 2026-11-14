import type { WalletStore } from "shared/wallet";
import { DataStoreKeyValue } from "./DataStoreKeyValue";

/**
 * The wallet's real store (docs/SILVER.md SVD5): one Roblox DataStore where every change is its own UpdateAsync
 * transaction (DataStoreKeyValue.update) running shared/wallet's pure transform on the STORED value, so concurrent
 * servers compose and a balance is never max-merged or overwritten by a stale session copy. Next to MergeKeyValue,
 * which serves the max-merged docs (records, the Codex); thin on purpose (retries, the lock and the read copies live in
 * the pure shared/wallet WalletBook).
 *
 * Studio never writes through it: WalletService runs Studio transactions on shared/wallet MemoryWalletStore, which
 * reads this store's `get` for keys it does not hold.
 */
export class WalletTransactions implements WalletStore {
	private readonly store: DataStoreKeyValue;

	constructor(name: string) {
		this.store = new DataStoreKeyValue(name);
	}

	get(key: string): unknown {
		return this.store.get(key);
	}

	update(key: string, transform: (stored: unknown) => unknown, userIds?: ReadonlyArray<number>): void {
		this.store.update(key, transform, userIds);
	}
}
