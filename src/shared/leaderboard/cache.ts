/**
 * A time-to-live cache with shared loads, for leaderboard reads (top 100 per board, a player's own entry): within
 * `ttlSeconds` a key is served from memory; a load while the same key is loading waits for that one (one
 * GetSortedAsync for every player who opens the board at once); a failed load serves the last value, marked stale.
 *
 * Pure: time is passed in, waiting uses coroutine.running / coroutine.yield and resuming is injected (task.spawn on
 * the server, coroutine.resume in the specs), like shared/settings PlayerDocCache.
 */

export type CacheLoad<V> =
	| { readonly ok: true; readonly value: V; readonly stale: boolean }
	| { readonly ok: false; readonly error: string };

interface Slot<V> {
	value?: V;
	has: boolean;
	at: number;
	loading: boolean;
	readonly waiters: thread[];
	lastError: string;
	/** +1 per invalidate: a load that started under an older generation never makes its value fresh. */
	generation: number;
}

export class SharedTtlCache<K, V> {
	private readonly slots = new Map<K, Slot<V>>();

	constructor(private readonly ttlSeconds: number, private readonly resume: (waiter: thread) => void) {}

	/**
	 * The value for `key`: cached if fresh at `now`, else `fetch()` (which may yield and throw). Concurrent callers
	 * share one fetch. A failed fetch returns the previous value as stale, or the error when there is none.
	 */
	load(key: K, now: number, fetch: () => V): CacheLoad<V> {
		const slot = this.slot(key);
		if (slot.has && now - slot.at < this.ttlSeconds) return { ok: true, value: slot.value as V, stale: false };
		if (slot.loading) {
			slot.waiters.push(coroutine.running());
			coroutine.yield(); // resumed when the load in progress finishes
			return this.current(slot);
		}
		slot.loading = true;
		const generation = slot.generation;
		const [ok, result] = pcall(fetch);
		slot.loading = false;
		if (ok) {
			slot.value = result as V;
			slot.has = true;
			// Invalidated while this fetch was in flight (e.g. the player posted): the value may predate the write, so
			// it is served to this load's callers but stays expired; the next load fetches again.
			slot.at = slot.generation === generation ? now : -math.huge;
			slot.lastError = "";
		} else {
			slot.lastError = tostring(result);
		}
		const waiters = [...slot.waiters];
		slot.waiters.clear();
		for (const w of waiters) this.resume(w);
		return ok ? { ok: true, value: result as V, stale: false } : this.current(slot);
	}

	/**
	 * Drops a key (e.g. the player's own entry after they post). A load in progress still completes and answers its
	 * callers, but its value is not cached as fresh (generation counter): the invalidate wins.
	 */
	invalidate(key: K): void {
		const slot = this.slots.get(key);
		if (slot === undefined) return;
		if (!slot.loading) {
			this.slots.delete(key);
			return;
		}
		slot.generation += 1;
		slot.at = -math.huge;
	}

	/** Keys held (for leak checks). */
	size(): number {
		return this.slots.size();
	}

	private current(slot: Slot<V>): CacheLoad<V> {
		if (slot.has) return { ok: true, value: slot.value as V, stale: slot.lastError !== "" };
		return { ok: false, error: slot.lastError };
	}

	private slot(key: K): Slot<V> {
		let s = this.slots.get(key);
		if (s === undefined) {
			s = { has: false, at: 0, loading: false, waiters: [], lastError: "", generation: 0 };
			this.slots.set(key, s);
		}
		return s;
	}
}
