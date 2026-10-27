/**
 * Asset preloading, the pure half (docs/PRELOAD.md P2): which content ids download before the join loading screen
 * lifts (core) and which load behind it (later), the screen's release and Skip rules, a progress counter, and a boss
 * floor's push, and the waits on resolved ids (LoadWaiters, the stage loader's assets wait: docs/STAGE_LOADER.md SL6).
 * No Roblox APIs: the client's PreloadController runs the queue. Tunables: PRELOAD in preloadConfig.ts.
 */
import type { ContentRef } from "shared/theme";
import { PRELOAD, PRELOAD_BIOME_PREFIX, PRELOAD_BOSS_IDS, type PreloadConfig } from "./preloadConfig";

/** What the plan reads from a theme pack (ThemePack satisfies it). */
export interface PreloadSource {
	/** Logical ids with at least one content id, sorted. */
	assetIdList(): ReadonlyArray<string>;
	/** Every content id of a logical id, deterministic order, each once. */
	contentIds(id: string): ReadonlyArray<ContentRef>;
	/** The pack's biome keys, sorted. */
	biomeKeys(): ReadonlyArray<string>;
	/** Every content id a biome draws. */
	biomeContentIds(b: string): ReadonlyArray<ContentRef>;
}

/** The two tiers, each in download order; a content id is in at most one of them. */
export interface PreloadPlan {
	readonly core: Array<ContentRef>;
	readonly later: Array<ContentRef>;
}

/** The released / Skip inputs of the loading screen. */
export interface LoadingReleaseInput {
	/** Every core entry resolved (ok or failed). */
	readonly coreDone: boolean;
	/** Seconds since the screen opened. */
	readonly elapsedSec: number;
	/** The player pressed Skip. */
	readonly skipped: boolean;
}

function startsWith(s: string, prefix: string): boolean {
	return s.sub(1, prefix.size()) === prefix;
}

/** Does tier entry `entry` match plan id `id` (a logical id or `biome:<key>`)? See PRELOAD_BIOME_PREFIX. */
function entryMatches(entry: string, id: string): boolean {
	if (startsWith(entry, PRELOAD_BIOME_PREFIX) && entry.size() > PRELOAD_BIOME_PREFIX.size()) {
		return id === entry;
	}
	return startsWith(id, entry);
}

/** The index of `id`'s longest matching entry in `entries`, and its length (-1, -1: none). */
function longestMatch(entries: ReadonlyArray<string>, id: string): [index: number, length: number] {
	let best = -1;
	let bestLength = -1;
	for (let i = 0; i < entries.size(); i++) {
		const e = entries[i];
		if (e.size() > bestLength && entryMatches(e, id)) {
			best = i;
			bestLength = e.size();
		}
	}
	return [best, bestLength];
}

/** Appends each of `refs` not yet in `seen` to `out`. */
function appendNew(refs: ReadonlyArray<ContentRef>, seen: Set<string>, out: Array<ContentRef>): void {
	for (const ref of refs) {
		if (seen.has(ref.contentId)) continue;
		seen.add(ref.contentId);
		out.push(ref);
	}
}

/**
 * The preload plan of a pack. Every logical id (`assetIdList`) and every biome (`biome:<key>`) goes to the tier of its
 * longest matching entry (core wins a tie; no match: last in later); within a tier, entries in list order, then ids
 * sorted. Content ids are deduped across both tiers, first occurrence wins (so an id core shares stays in core).
 * Deterministic for a given source.
 */
export function preloadPlan(src: PreloadSource, cfg: PreloadConfig = PRELOAD): PreloadPlan {
	const coreBuckets = cfg.core.map(() => new Array<string>());
	// one bucket per later entry, plus the last for ids no entry matches
	const laterBuckets = new Array<Array<string>>();
	for (let i = 0; i <= cfg.later.size(); i++) laterBuckets.push(new Array<string>());

	const ids = [...src.assetIdList()];
	for (const b of src.biomeKeys()) ids.push(`${PRELOAD_BIOME_PREFIX}${b}`);
	for (const id of ids) {
		const [coreIndex, coreLength] = longestMatch(cfg.core, id);
		const [laterIndex, laterLength] = longestMatch(cfg.later, id);
		if (coreIndex >= 0 && coreLength >= laterLength) {
			coreBuckets[coreIndex].push(id);
		} else {
			laterBuckets[laterIndex >= 0 ? laterIndex : cfg.later.size()].push(id);
		}
	}

	const seen = new Set<string>();
	const emit = (buckets: ReadonlyArray<Array<string>>): Array<ContentRef> => {
		const out = new Array<ContentRef>();
		for (const bucket of buckets) {
			bucket.sort((a, c) => a < c);
			for (const id of bucket) {
				const refs = startsWith(id, PRELOAD_BIOME_PREFIX)
					? src.biomeContentIds(id.sub(PRELOAD_BIOME_PREFIX.size() + 1))
					: src.contentIds(id);
				appendNew(refs, seen, out);
			}
		}
		return out;
	};
	const core = emit(coreBuckets);
	const later = emit(laterBuckets);
	return { core, later };
}

/** Has the loading screen released? Core done, or skipped, or the timeout reached (D2: no minimum show time). */
export function loadingReleased(s: LoadingReleaseInput, cfg: PreloadConfig = PRELOAD): boolean {
	return s.coreDone || s.skipped || s.elapsedSec >= cfg.timeoutSec;
}

/** Is the Skip button shown yet (D6)? */
export function skipVisible(elapsedSec: number, cfg: PreloadConfig = PRELOAD): boolean {
	return elapsedSec >= cfg.skipAfterSec;
}

/** The content ids of a boss kind's art (PRELOAD_BOSS_IDS), for a boss floor's front-lane push. Unknown kind: none. */
export function bossContentIds(src: PreloadSource, bossKind: string): ReadonlyArray<ContentRef> {
	const id = PRELOAD_BOSS_IDS[bossKind];
	return id !== undefined ? src.contentIds(id) : [];
}

/**
 * Progress over a fixed number of entries: each `resolve` counts one done (a failure is done too, and counted as
 * failed). Pure; the loading screen reads it once per frame.
 */
export class PreloadProgress {
	private readonly totalCount: number;
	private doneCount = 0;
	private failedCount = 0;

	constructor(total: number) {
		this.totalCount = math.max(0, total);
	}

	/** One entry resolved; `ok` false when it failed or timed out. Extra calls past the total are ignored. */
	resolve(ok: boolean): void {
		if (this.doneCount >= this.totalCount) return;
		this.doneCount += 1;
		if (!ok) this.failedCount += 1;
	}

	done(): number {
		return this.doneCount;
	}

	failed(): number {
		return this.failedCount;
	}

	total(): number {
		return this.totalCount;
	}

	/** done / total in [0, 1]; 1 when there is nothing to load. */
	fraction(): number {
		return this.totalCount === 0 ? 1 : this.doneCount / this.totalCount;
	}

	/** Every entry resolved. */
	complete(): boolean {
		return this.doneCount >= this.totalCount;
	}
}

/** A queue lane: `front` for needs that are about to show (a run start, a boss floor), `back` for the plan's tiers. */
export type PreloadLane = "front" | "back";

/**
 * The client's download queue, pure (docs/PRELOAD.md P3; PreloadController runs it): two FIFO lanes of content ids,
 * `take` serving the front lane first. Each content id is accepted ONCE per queue (queued, taken or resolved: the
 * session's `seen` set), with one exception: a front push of an id still waiting in the back lane moves it to the
 * end of the front lane (a run start's sounds jump the later tier). An id already taken is never queued again.
 */
export class PreloadQueue {
	private readonly front = new Array<ContentRef>();
	private readonly back = new Array<ContentRef>();
	/** Content id -> where it is: still waiting in a lane, or taken (in flight or resolved). */
	private readonly where = new Map<string, PreloadLane | "taken">();

	/**
	 * Queues each of `refs` not seen before at the end of `lane` (in order; a ref repeated within `refs` once). A front
	 * push also moves ids waiting in the back lane. Returns how many refs were queued or moved.
	 */
	push(refs: ReadonlyArray<ContentRef>, lane: PreloadLane): number {
		let count = 0;
		for (const ref of refs) {
			const at = this.where.get(ref.contentId);
			if (at === undefined) {
				this.where.set(ref.contentId, lane);
				(lane === "front" ? this.front : this.back).push(ref);
				count += 1;
			} else if (at === "back" && lane === "front") {
				this.removeFromBack(ref.contentId);
				this.where.set(ref.contentId, "front");
				this.front.push(ref);
				count += 1;
			}
		}
		return count;
	}

	/** Takes up to `max` waiting refs, the front lane first, each lane first in first out. Taken ids stay seen. */
	take(max: number): Array<ContentRef> {
		const out = new Array<ContentRef>();
		while (out.size() < max && this.front.size() > 0) out.push(this.front.shift()!);
		while (out.size() < max && this.back.size() > 0) out.push(this.back.shift()!);
		for (const ref of out) this.where.set(ref.contentId, "taken");
		return out;
	}

	/** Refs waiting in both lanes. */
	pending(): number {
		return this.front.size() + this.back.size();
	}

	/** The id was ever accepted (waiting, in flight or resolved). */
	seen(contentId: string): boolean {
		return this.where.has(contentId);
	}

	private removeFromBack(contentId: string): void {
		let i = 0;
		while (i < this.back.size()) {
			if (this.back[i].contentId === contentId) {
				this.back.remove(i);
				return;
			}
			i += 1;
		}
	}
}

/**
 * Who waits for which content ids (docs/STAGE_LOADER.md SL6; PreloadController.whenLoaded runs it): the session's set
 * of resolved ids (ok or failed: both count, a failed id is never retried) and the open waits, each a set of ids still
 * unresolved and its payload (the callback). `wait` returns true when every id already resolved (the caller fires at
 * once; nothing is stored); `resolve` returns the payloads whose last id that was, in the order they waited.
 */
export class LoadWaiters<T extends defined> {
	private readonly resolvedIds = new Set<string>();
	private readonly waits = new Array<{ left: Set<string>; payload: T }>();

	/** `ids` resolved already: true (fire now). Else the wait is stored until its last id resolves. */
	wait(ids: ReadonlyArray<string>, payload: T): boolean {
		const left = new Set<string>();
		for (const id of ids) if (!this.resolvedIds.has(id)) left.add(id);
		if (left.size() === 0) return true;
		this.waits.push({ left, payload });
		return false;
	}

	/** `contentId` resolved: the payloads whose waits completed with it, in wait order. */
	resolve(contentId: string): Array<T> {
		this.resolvedIds.add(contentId);
		const out = new Array<T>();
		let i = 0;
		while (i < this.waits.size()) {
			const w = this.waits[i];
			w.left.delete(contentId);
			if (w.left.size() === 0) {
				out.push(w.payload);
				this.waits.remove(i);
			} else {
				i += 1;
			}
		}
		return out;
	}

	isResolved(contentId: string): boolean {
		return this.resolvedIds.has(contentId);
	}

	/** Waits still open. */
	open(): number {
		return this.waits.size();
	}
}

/**
 * The join gate's dispatch rule (docs/PRELOAD.md P5): the first-run decision fires once it is decided AND the loading
 * screen released, whichever comes last, exactly once. `decide` and `release` each return the decision to dispatch
 * now, or undefined (still waiting for the other, or already fired). Later calls never fire again.
 */
export class JoinGate<T extends defined> {
	private decision: T | undefined;
	private released = false;
	private fired = false;

	/** The gate decided (only the first decision counts). */
	decide(decision: T): T | undefined {
		if (this.decision === undefined) this.decision = decision;
		return this.tryFire();
	}

	/** The loading screen released. */
	release(): T | undefined {
		this.released = true;
		return this.tryFire();
	}

	/** Has the decision been dispatched? */
	hasFired(): boolean {
		return this.fired;
	}

	private tryFire(): T | undefined {
		if (this.fired || !this.released || this.decision === undefined) return undefined;
		this.fired = true;
		return this.decision;
	}
}
