/**
 * Friends on the daily boards (docs/DAILY.md "6. Friends", DS7, DSD16): every friend looked up (up to
 * DAILY_FRIENDS.max), friends in this server first, then the rest in friends-list order; answers from the top rows are
 * free (an entry in the rows, or no entry at all when the rows hold the whole board); every other friend costs one
 * GetAsync on the day's ordered store, through ONE per-server queue under a read budget
 * (DAILY_FRIENDS.readsPerMinute), deduplicated in a cache per (board, scope, userId) shared by every player of the
 * server; an answer older than DAILY_FRIENDS.refreshSeconds keeps showing while it is re-read (FriendLookupQueue).
 *
 * The friends view: the caller's friends with an entry, ranked among themselves, the caller included, and how many
 * friends were never read yet (`pending`), so the client can say it is filling in.
 *
 * Pure: time is passed in; the service pumps `take` / `resolve` / `failed`.
 *
 * @module
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

/** The lanes, read in this order: never-read friends in a requester's server, other never-read friends, refreshes. */
type Lane = "first" | "rest" | "refresh";

interface Queued extends FriendLookup {
	lane: Lane;
}

/** The answer for one friend: known (an entry or none, maybe stale and being refreshed) or still to come. */
export type FriendAnswer = { readonly known: true; readonly value: number | undefined } | { readonly known: false };

/**
 * The per-server friends lookup queue and its shared answer cache (stale-while-revalidate):
 *
 *   answers    a friend read once stays KNOWN (shown in the rows, frozen into run baselines) for as long as someone
 *              here needs it; once older than `refreshSeconds` it is re-read in the background (the refresh lane,
 *              after every never-read friend) and keeps showing meanwhile. Only a never-read friend is pending.
 *   budget     one sliding window of `readsPerMinute` reads shared by every lane and requester. `refreshSeconds` is
 *              well above the time a full friends list takes to read (DAILY_FRIENDS.max / readsPerMinute minutes,
 *              friends.spec), so refreshes never starve first reads.
 *   requesters each `request` names its requester (a UserId) and replaces what that requester needs on that board;
 *              `forget(requester)` (they left) drops every queued lookup nobody else needs. A cached answer nobody
 *              needs is pruned once stale.
 */
export class FriendLookupQueue {
	private readonly cache = new Map<string, Cached>();
	private readonly queued = new Map<string, Queued>();
	private readonly lanes: Record<Lane, string[]> = { first: [], rest: [], refresh: [] };
	private readonly inFlight = new Set<string>();
	private readonly limiter: SlidingWindowLimiter<string>;
	/** requester -> board ref key -> the lookup keys of their last request on that board. */
	private readonly needs = new Map<number, Map<string, ReadonlyArray<string>>>();
	/** lookup key -> how many (requester, board) requests need it. */
	private readonly needCount = new Map<string, number>();

	constructor(
		readsPerMinute: number = DAILY_FRIENDS.readsPerMinute,
		private readonly refreshSeconds: number = DAILY_FRIENDS.refreshSeconds,
	) {
		this.limiter = new SlidingWindowLimiter<string>(readsPerMinute, SECONDS_PER_MINUTE);
	}

	/** What is known about `userId` on `ref`: a cached answer of any age (a stale one is refreshed in the background). */
	answer(ref: BoardRef, userId: number): FriendAnswer {
		const c = this.cache.get(lookupKey(ref, userId));
		if (c === undefined) return { known: false };
		return { known: true, value: c.value };
	}

	/** A free answer (the top rows, a write of this server): cached as if looked up; a queued lookup is dropped. */
	learn(ref: BoardRef, userId: number, value: number | undefined, now: number): void {
		const key = lookupKey(ref, userId);
		this.cache.set(key, { value, at: now });
		this.unqueue(key);
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
	 * `requester` (a UserId) needs the friends in `ids` (lookup order, orderFriends) on `ref`; this replaces their last
	 * request on that board. Never-read friends are queued, the first `inServer` of them in the front lane (a queued
	 * one is promoted); answers older than refreshSeconds are queued in the refresh lane and stay known. Returns how
	 * many of `ids` are still pending (never read: queued or being read).
	 */
	request(ref: BoardRef, ids: ReadonlyArray<number>, inServer: number, now: number, requester: number): number {
		const keys: string[] = [];
		for (const id of ids) keys.push(lookupKey(ref, id));
		this.setNeeds(requester, boardRefKey(ref), keys);
		this.prune(now);
		for (let i = 0; i < ids.size(); i++) {
			const key = keys[i];
			if (this.inFlight.has(key)) continue;
			const c = this.cache.get(key);
			if (c !== undefined) {
				if (now - c.at >= this.refreshSeconds && !this.queued.has(key))
					this.enqueue(ref, ids[i], key, "refresh");
				continue;
			}
			const lane: Lane = i < inServer ? "first" : "rest";
			const q = this.queued.get(key);
			if (q === undefined) {
				this.enqueue(ref, ids[i], key, lane);
			} else if (lane === "first" && q.lane !== "first") {
				removeFrom(this.lanes[q.lane], key);
				q.lane = "first";
				this.lanes.first.push(key);
			}
		}
		return this.pending(ref, ids);
	}

	/** How many of `ids` are pending: never read, and queued or being read. */
	pending(ref: BoardRef, ids: ReadonlyArray<number>): number {
		let n = 0;
		for (const id of ids) {
			const key = lookupKey(ref, id);
			if (this.cache.has(key)) continue;
			if (this.queued.has(key) || this.inFlight.has(key)) n++;
		}
		return n;
	}

	/** The next lookup to read now (front lane, then the rest, then refreshes), or undefined (none / budget spent). */
	take(now: number): FriendLookup | undefined {
		const lane =
			this.lanes.first.size() > 0
				? this.lanes.first
				: this.lanes.rest.size() > 0
				? this.lanes.rest
				: this.lanes.refresh;
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

	/**
	 * A lookup failed: dropped (not cached; the next request queues it again). A failed refresh keeps the stale answer.
	 */
	failed(lookup: FriendLookup): void {
		this.inFlight.delete(lookupKey(lookup.ref, lookup.userId));
	}

	/** `requester` left: their needs go, and every queued lookup nobody else needs is dropped. */
	forget(requester: number, now: number): void {
		const boards = this.needs.get(requester);
		if (boards === undefined) return;
		this.needs.delete(requester);
		for (const [, keys] of boards) this.release(keys);
		this.prune(now);
	}

	/** Lookups queued (not in flight). */
	queuedCount(): number {
		return this.queued.size();
	}

	/** Cached answers (for leak checks). */
	cachedCount(): number {
		return this.cache.size();
	}

	private enqueue(ref: BoardRef, userId: number, key: string, lane: Lane): void {
		this.queued.set(key, { ref, userId, lane });
		this.lanes[lane].push(key);
	}

	private unqueue(key: string): void {
		const q = this.queued.get(key);
		if (q === undefined) return;
		this.queued.delete(key);
		removeFrom(this.lanes[q.lane], key);
	}

	private setNeeds(requester: number, board: string, keys: ReadonlyArray<string>): void {
		let boards = this.needs.get(requester);
		if (boards === undefined) {
			boards = new Map();
			this.needs.set(requester, boards);
		}
		const old = boards.get(board);
		boards.set(board, keys);
		for (const key of keys) this.needCount.set(key, (this.needCount.get(key) ?? 0) + 1);
		if (old !== undefined) this.release(old);
	}

	/** One need fewer on each of `keys`; a queued key nobody needs any more is dropped. */
	private release(keys: ReadonlyArray<string>): void {
		for (const key of keys) {
			const n = (this.needCount.get(key) ?? 0) - 1;
			if (n > 0) {
				this.needCount.set(key, n);
				continue;
			}
			this.needCount.delete(key);
			this.unqueue(key);
		}
	}

	/** Drops stale answers nobody needs (a needed one stays known while it is refreshed). */
	private prune(now: number): void {
		const expired: string[] = [];
		for (const [key, c] of this.cache) {
			if (now - c.at >= this.refreshSeconds && !this.needCount.has(key)) expired.push(key);
		}
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
