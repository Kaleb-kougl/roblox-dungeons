/**
 * Friends on the daily boards (docs/DAILY.md "6. Friends", DS7, DSD16): every friend looked up (up to
 * DAILY_FRIENDS.max), friends in this server first, then the rest in friends-list order; answers from the top rows are
 * free (an entry in the rows, or no entry at all when the rows hold the whole board); every other friend costs one
 * GetAsync on the day's ordered store, through ONE per-server queue under a read budget
 * (DAILY_FRIENDS.readsPerMinute), deduplicated in a cache per (board, scope, userId) shared by every player of the
 * server (DAILY_FRIENDS.cacheSeconds).
 *
 * The friends view: the caller's friends with an entry, ranked among themselves, the caller included, and how many
 * lookups are still queued (`pending`), so the client can say it is filling in.
 *
 * Pure: time is passed in; the service pumps `take` / `resolve` / `failed`.
 */
import { DAILY_FRIENDS } from "shared/daily";
import { SlidingWindowLimiter } from "shared/run";
import { decodeOrderedValue } from "./orderedValue";
import { boardRefKey, type BoardRef } from "./scope";
import { entryValue, type BoardTop } from "./top";
import type { LeaderboardRow } from "./view";

const SECONDS_PER_MINUTE = 60;
const RATE_KEY = "reads";

/**
 * The friends to look up, in lookup order: those in this server first (in list order), then the rest in list order;
 * repeats, the caller and invalid ids dropped; at most `max`.
 */
export function orderFriends(
	friendIds: ReadonlyArray<number>,
	inServer: (userId: number) => boolean,
	callerId: number,
	max: number = DAILY_FRIENDS.max,
): number[] {
	const seen = new Set<number>([callerId]);
	const first: number[] = [];
	const rest: number[] = [];
	for (const id of friendIds) {
		if (seen.has(id) || id === 0 || math.floor(id) !== id) continue;
		seen.add(id);
		(inServer(id) ? first : rest).push(id);
	}
	const out: number[] = [];
	for (const id of first) if (out.size() < max) out.push(id);
	for (const id of rest) if (out.size() < max) out.push(id);
	return out;
}

/** A queued or in-flight lookup. */
export interface FriendLookup {
	readonly ref: BoardRef;
	readonly userId: number;
}

interface Cached {
	/** The friend's ordered value on the board, undefined for no entry. */
	readonly value: number | undefined;
	readonly at: number;
}

interface Queued extends FriendLookup {
	first: boolean;
}

/** The answer for one friend: known (an entry or none) or still to come. */
export type FriendAnswer = { readonly known: true; readonly value: number | undefined } | { readonly known: false };

export class FriendLookupQueue {
	private readonly cache = new Map<string, Cached>();
	private readonly queued = new Map<string, Queued>();
	private readonly first: string[] = [];
	private readonly rest: string[] = [];
	private readonly inFlight = new Set<string>();
	private readonly limiter: SlidingWindowLimiter<string>;

	constructor(
		readsPerMinute: number = DAILY_FRIENDS.readsPerMinute,
		private readonly cacheSeconds: number = DAILY_FRIENDS.cacheSeconds,
	) {
		this.limiter = new SlidingWindowLimiter<string>(readsPerMinute, SECONDS_PER_MINUTE);
	}

	/** What is known about `userId` on `ref` at `now` (a cached answer younger than cacheSeconds). */
	answer(ref: BoardRef, userId: number, now: number): FriendAnswer {
		const c = this.cache.get(lookupKey(ref, userId));
		if (c === undefined || now - c.at >= this.cacheSeconds) return { known: false };
		return { known: true, value: c.value };
	}

	/** A free answer (the top rows, a write of this server): cached as if looked up; a queued lookup is dropped. */
	learn(ref: BoardRef, userId: number, value: number | undefined, now: number): void {
		const key = lookupKey(ref, userId);
		this.cache.set(key, { value, at: now });
		if (this.queued.delete(key)) {
			removeFrom(this.first, key);
			removeFrom(this.rest, key);
		}
	}

	/**
	 * Free answers from the top rows for `ids`: a friend in the rows has that entry; on a complete board (every entrant
	 * in the rows) a friend outside them has none.
	 */
	learnFromTop(ref: BoardRef, top: BoardTop, ids: ReadonlyArray<number>, now: number): void {
		for (const id of ids) {
			const value = entryValue(top, id);
			if (value !== undefined || top.complete) this.learn(ref, id, value, now);
		}
	}

	/**
	 * Queues lookups for the friends in `ids` (lookup order, orderFriends) not known at `now`; the first `inServer` of
	 * them go to the front lane (a queued one is promoted). Returns how many of `ids` are still pending.
	 */
	request(ref: BoardRef, ids: ReadonlyArray<number>, inServer: number, now: number): number {
		this.prune(now);
		for (let i = 0; i < ids.size(); i++) {
			const id = ids[i];
			if (this.answer(ref, id, now).known) continue;
			const key = lookupKey(ref, id);
			if (this.inFlight.has(key)) continue;
			const front = i < inServer;
			const q = this.queued.get(key);
			if (q !== undefined) {
				if (front && !q.first) {
					q.first = true;
					removeFrom(this.rest, key);
					this.first.push(key);
				}
				continue;
			}
			this.queued.set(key, { ref, userId: id, first: front });
			(front ? this.first : this.rest).push(key);
		}
		return this.pending(ref, ids);
	}

	/** How many of `ids` are queued or being read. */
	pending(ref: BoardRef, ids: ReadonlyArray<number>): number {
		let n = 0;
		for (const id of ids) {
			const key = lookupKey(ref, id);
			if (this.queued.has(key) || this.inFlight.has(key)) n++;
		}
		return n;
	}

	/** The next lookup to read now (front lane first), or undefined when none is queued or the budget is spent. */
	take(now: number): FriendLookup | undefined {
		const lane = this.first.size() > 0 ? this.first : this.rest;
		if (lane.size() === 0) return undefined;
		if (!this.limiter.tryAcquire(RATE_KEY, now)) return undefined;
		const key = lane.remove(0)!;
		const q = this.queued.get(key)!;
		this.queued.delete(key);
		this.inFlight.add(key);
		return { ref: q.ref, userId: q.userId };
	}

	/** A lookup's answer (the friend's ordered value, undefined for no entry). */
	resolve(lookup: FriendLookup, value: number | undefined, now: number): void {
		const key = lookupKey(lookup.ref, lookup.userId);
		this.inFlight.delete(key);
		this.cache.set(key, { value, at: now });
	}

	/** A lookup failed: dropped (not cached; the next request for that friend queues it again). */
	failed(lookup: FriendLookup): void {
		this.inFlight.delete(lookupKey(lookup.ref, lookup.userId));
	}

	/** Lookups queued (not in flight). */
	queuedCount(): number {
		return this.queued.size();
	}

	/** Cached answers (for leak checks). */
	cachedCount(): number {
		return this.cache.size();
	}

	private prune(now: number): void {
		const expired: string[] = [];
		for (const [key, c] of this.cache) if (now - c.at >= this.cacheSeconds) expired.push(key);
		for (const key of expired) this.cache.delete(key);
	}
}

function lookupKey(ref: BoardRef, userId: number): string {
	return `${boardRefKey(ref)}:${userId}`;
}

function removeFrom(list: string[], key: string): void {
	const i = list.indexOf(key);
	if (i >= 0) list.remove(i);
}

/**
 * The friends view's rows: the caller and every friend with a known entry, highest first (equal values by UserId),
 * ranked 1..n among themselves.
 */
export function friendsRows(
	callerId: number,
	callerValue: number | undefined,
	friendIds: ReadonlyArray<number>,
	valueOf: (userId: number) => number | undefined,
	nameOf: (userId: number) => string,
): LeaderboardRow[] {
	const entries: Array<{ userId: number; value: number }> = [];
	if (callerValue !== undefined) entries.push({ userId: callerId, value: callerValue });
	const seen = new Set<number>([callerId]);
	for (const id of friendIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		const value = valueOf(id);
		if (value !== undefined) entries.push({ userId: id, value });
	}
	entries.sort((a, b) => a.value > b.value || (a.value === b.value && a.userId < b.userId));
	const rows: LeaderboardRow[] = [];
	for (const e of entries) {
		const d = decodeOrderedValue(e.value);
		rows.push({ rank: rows.size() + 1, userId: e.userId, name: nameOf(e.userId), score: d.score, floor: d.floor });
	}
	return rows;
}

/** Studio's KV_FakeFriends: UserIds joined by DAILY_FRIENDS.fakeSeparator (spaces allowed), else undefined. */
export function parseFakeFriends(text: unknown): number[] | undefined {
	if (!typeIs(text, "string")) return undefined;
	const out: number[] = [];
	for (const part of text.split(DAILY_FRIENDS.fakeSeparator)) {
		const [digits] = string.match(part, "^%s*(-?%d+)%s*$");
		if (digits === undefined) return undefined;
		const id = tonumber(digits);
		if (id === undefined || id === 0) return undefined;
		if (!out.includes(id)) out.push(id);
	}
	return out.size() > 0 ? out : undefined;
}
