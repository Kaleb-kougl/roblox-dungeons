import { DataStoreService } from "@rbxts/services";
import type { OrderedScoreStore } from "shared/leaderboard";

/**
 * The real OrderedScoreStore: one Roblox OrderedDataStore (a leaderboard board). Thin on purpose: the rules (personal
 * best, retries, throttling, caching) live in shared/leaderboard and are tested headlessly with an in-memory store.
 *
 * OrderedDataStore writes take no `userIds` (no metadata on ordered stores); the key itself is `u_<UserId>`, so an
 * erasure request finds the entry by key. Resolved on first use, inside the caller's retry (GetOrderedDataStore
 * throws in a Studio place without API access).
 *
 * `scope`: the daily boards' day-and-ruleset scope (shared/leaderboard orderedStoreOf); undefined for the all-time
 * boards, which stay unscoped (`GetOrderedDataStore(name)`, scope "global", exactly as before).
 */
export class OrderedDataStoreScores implements OrderedScoreStore {
	private store?: OrderedDataStore;

	constructor(private readonly name: string, private readonly scope?: string) {}

	update(key: string, transform: (old: unknown) => number | undefined): void {
		this.resolve().UpdateAsync(key, (old) => transform(old));
	}

	get(key: string): unknown {
		return this.resolve().GetAsync(key);
	}

	top(count: number): ReadonlyArray<{ readonly key: string; readonly value: number }> {
		const page = this.resolve().GetSortedAsync(false, count).GetCurrentPage();
		const out: Array<{ key: string; value: number }> = [];
		for (const entry of page) if (typeIs(entry.value, "number")) out.push({ key: entry.key, value: entry.value });
		return out;
	}

	private resolve(): OrderedDataStore {
		if (this.store === undefined) {
			this.store =
				this.scope === undefined
					? DataStoreService.GetOrderedDataStore(this.name)
					: DataStoreService.GetOrderedDataStore(this.name, this.scope);
		}
		return this.store;
	}
}
