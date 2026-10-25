/**
 * Per-key sliding-window rate limit: at most `count` acquisitions in any `windowSeconds`. Pure (the caller passes the
 * time), so the server services and the headless tests share it. Keys are players on the server.
 */
export class SlidingWindowLimiter<K> {
	private readonly stamps = new Map<K, number[]>();

	constructor(private readonly count: number, private readonly windowSeconds: number) {}

	/** Records one call at `now` and returns true, or returns false (and records nothing) when over budget. */
	tryAcquire(key: K, now: number): boolean {
		const list = this.prune(key, now);
		if (list.size() >= this.count) return false;
		list.push(now);
		return true;
	}

	/** Seconds until `key` may call again (0 when it may call now). */
	retryAfter(key: K, now: number): number {
		const list = this.prune(key, now);
		if (list.size() < this.count) return 0;
		return list[0] + this.windowSeconds - now;
	}

	/** Drops a key's history (player left). */
	forget(key: K): void {
		this.stamps.delete(key);
	}

	/** Keys currently tracked (for tests / leak checks). */
	size(): number {
		return this.stamps.size();
	}

	private prune(key: K, now: number): number[] {
		let list = this.stamps.get(key);
		if (list === undefined) {
			list = [];
			this.stamps.set(key, list);
		}
		while (list.size() > 0 && now - list[0] >= this.windowSeconds) list.remove(0);
		return list;
	}
}
