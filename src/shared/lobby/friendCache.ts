/**
 * Friendship answers for the lobbies (`AreFriends`: the `friends` visibility, the browse list's `hasFriend` and its
 * sort), cached per player pair and filled in the background. `areFriends` never waits: a pair it has not asked about
 * yet answers false and schedules a fetch; when the fetch lands with a different answer `onChanged` fires (the server
 * marks every browse list stale). A failed fetch counts as "not friends" and is retried after `retrySeconds`; a known
 * answer is fetched again after `refreshSeconds` (served meanwhile). At most `maxConcurrentFetches` run at once; the
 * rest wait in order.
 *
 * Pure: the fetcher (Player:IsFriendsWith on the server; it may yield or throw), the scheduler (task.spawn) and the
 * clock are injected, so the specs drive it synchronously.
 *
 * @module
 */
import { FRIEND_CACHE, type FriendCacheConfig } from "./config";

/**
 * What the cache is built over: the friendship fetch, how a fetch is run in the background, the clock (seconds; only
 * differences are used) and the change listener. The server passes Roblox's calls, specs synchronous fakes.
 */
export interface FriendCacheDeps {
	/** Are `a` and `b` friends? May yield; an error means "unknown" (retried later). */
	readonly fetch: (a: number, b: number) => boolean;
	/** Runs one fetch in the background (task.spawn on the server). */
	readonly spawn: (job: () => void) => void;
	readonly clock: () => number;
	/** A pair's answer changed. */
	readonly onChanged?: (a: number, b: number, friends: boolean) => void;
	/** Defaults to FRIEND_CACHE. */
	readonly config?: FriendCacheConfig;
}

type EntryState = "queued" | "fetching" | "known" | "failed";

interface Entry {
	readonly key: string;
	readonly lo: number;
	readonly hi: number;
	friends: boolean;
	state: EntryState;
	/** known: when it was fetched. failed: when to retry. */
	at: number;
}

function pairKey(lo: number, hi: number): string {
	return `${lo}:${hi}`;
}

/**
 * The cache itself (see the file comment), one per server. Pairs are unordered (the answer for a and b is the answer
 * for b and a), a player is never their own friend, and `areFriends` has the shape the lobby rules ask for (lobbies.ts
 * AreFriends).
 */
export class FriendCache {
	private readonly entries = new Map<string, Entry>();
	/** Entries waiting for a fetch slot, oldest first (stale ones are skipped). */
	private readonly queue: Entry[] = [];
	private readonly config: FriendCacheConfig;
	private inFlight = 0;

	constructor(private readonly deps: FriendCacheDeps) {
		this.config = deps.config ?? FRIEND_CACHE;
	}

	/** The cached answer (false until known); schedules a fetch for a new, stale or failed pair. */
	areFriends(a: number, b: number): boolean {
		if (a === b) return false;
		const lo = math.min(a, b);
		const hi = math.max(a, b);
		const key = pairKey(lo, hi);
		const now = this.deps.clock();
		const entry = this.entries.get(key);
		if (entry === undefined) {
			const fresh: Entry = { key, lo, hi, friends: false, state: "queued", at: now };
			this.entries.set(key, fresh);
			this.enqueue(fresh);
			return false; // a miss, even when the scheduler ran the fetch already
		}
		const answer = entry.friends;
		if (
			(entry.state === "known" && now - entry.at >= this.config.refreshSeconds) ||
			(entry.state === "failed" && now >= entry.at)
		) {
			this.enqueue(entry);
		}
		return answer;
	}

	/** Starts fetching a pair now (PlayerAdded: every pair with the new player). */
	prefetch(a: number, b: number): void {
		this.areFriends(a, b);
	}

	/** The player left: their pairs are dropped (a fetch in flight for one is discarded when it lands). */
	forget(userId: number): void {
		const drop: string[] = [];
		for (const [key, e] of this.entries) if (e.lo === userId || e.hi === userId) drop.push(key);
		for (const key of drop) this.entries.delete(key);
	}

	/** Pairs cached (any state). */
	size(): number {
		return this.entries.size();
	}

	/** Fetches in flight. */
	fetching(): number {
		return this.inFlight;
	}

	/** Pairs waiting for a fetch slot. */
	waiting(): number {
		let n = 0;
		for (const e of this.queue) if (this.entries.get(e.key) === e && e.state === "queued") n++;
		return n;
	}

	private enqueue(entry: Entry): void {
		entry.state = "queued";
		this.queue.push(entry);
		this.pump();
	}

	private pump(): void {
		while (this.inFlight < this.config.maxConcurrentFetches && this.queue.size() > 0) {
			const entry = this.queue.remove(0)!;
			if (this.entries.get(entry.key) !== entry || entry.state !== "queued") continue;
			entry.state = "fetching";
			this.inFlight += 1;
			this.deps.spawn(() => this.run(entry));
		}
	}

	private run(entry: Entry): void {
		const [ok, value] = pcall(() => this.deps.fetch(entry.lo, entry.hi));
		this.inFlight -= 1;
		if (this.entries.get(entry.key) === entry) {
			if (ok && typeIs(value, "boolean")) {
				const changed = value !== entry.friends;
				entry.friends = value;
				entry.state = "known";
				entry.at = this.deps.clock();
				if (changed) this.deps.onChanged?.(entry.lo, entry.hi, value);
			} else {
				// Unknown counts as "not friends" until a retry says otherwise.
				const changed = entry.friends;
				entry.friends = false;
				entry.state = "failed";
				entry.at = this.deps.clock() + this.config.retrySeconds;
				if (changed) this.deps.onChanged?.(entry.lo, entry.hi, false);
			}
		}
		this.pump();
	}
}

/**
 * Friendships of `userId` a caller has just confirmed with Roblox (LobbyService.fetchFriendship), which answer true
 * even while the FriendCache does not know the pair yet.
 */
export interface ConfirmedFriends {
	readonly userId: number;
	readonly friends: ReadonlyArray<number>;
}

/**
 * Whether `a` and `b` are friends for a lobby rule: true when the pair is `confirmed` (either way round), otherwise
 * what `cached` (FriendCache.areFriends) answers. A cache miss answers false, which would refuse a joining friend of a
 * `friends` lobby's host; `confirmed` covers exactly the pairs the caller asked Roblox about. Pure.
 */
export function friendsWithConfirmed(
	a: number,
	b: number,
	confirmed: ConfirmedFriends | undefined,
	cached: (a: number, b: number) => boolean,
): boolean {
	if (confirmed !== undefined) {
		if (a === confirmed.userId && confirmed.friends.includes(b)) return true;
		if (b === confirmed.userId && confirmed.friends.includes(a)) return true;
	}
	return cached(a, b);
}
