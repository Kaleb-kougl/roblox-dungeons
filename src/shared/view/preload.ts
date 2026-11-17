/**
 * Asset preloading, the pure half (docs/PRELOAD.md P2): which content ids download before the join loading screen
 * lifts (core) and which load behind it (later), the screen's release and Skip rules, a progress counter, and a boss
 * floor's push, and the waits on resolved ids (LoadWaiters, the stage loader's assets wait: docs/STAGE_LOADER.md SL6).
 * No Roblox APIs: the client's PreloadController runs the queue. Tunables: PRELOAD in preloadConfig.ts.
 */
import type { ContentRef } from "shared/theme";
import {
	PRELOAD,
	PRELOAD_BIOME_PREFIX,
	PRELOAD_BOSS_IDS,
	type PreloadConfig,
	type PreloadDevice,
} from "./preloadConfig";

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
	/**
	 * docs/COSMETICS.md CS5: the dye sheets of sprite set `id` (ThemePack.dyeContentIds), never part of contentIds;
	 * a stage manifest's `dye:<set>` entry (STAGE_DYE_PREFIX) reads them. Optional: a source without it has no dyes.
	 */
	dyeContentIds?(id: string): ReadonlyArray<ContentRef>;
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

/**
 * A queue lane, served in this order: `front` for needs that are about to show (the stage being waited for: a run
 * start, a boss floor), `next` for the stage after it (docs/STAGE_ASSETS.md SA4: the prefetch of floor n + 1, the
 * menu's first-floor guess), `back` for the plan's tiers and everything else.
 */
export type PreloadLane = "front" | "next" | "back";

/** The lanes, highest priority first (`take` serves them in this order). */
export const PRELOAD_LANES: ReadonlyArray<PreloadLane> = ["front", "next", "back"];

/** A lane's rank: 0 = served first. */
function laneRank(lane: PreloadLane): number {
	return lane === "front" ? 0 : lane === "next" ? 1 : 2;
}

/**
 * The client's download queue, pure (docs/PRELOAD.md P3, docs/STAGE_ASSETS.md SA4; PreloadController runs it): three
 * FIFO lanes of content ids, `take` serving front, then next, then back. Each content id is accepted ONCE per queue
 * (queued, taken or resolved: the session's `seen` set), with one exception: a push to a higher lane of an id still
 * waiting in a lower one moves it to the end of the higher lane (a run start's sounds jump the later tier; a front
 * push jumps the prefetch). An id already taken is never queued again by `push`; only `retry` re-queues it (the
 * readiness feed's one retry of a failed fetch, the Studio fake-latency gate check).
 */
export class PreloadQueue {
	private readonly lanes: ReadonlyArray<Array<ContentRef>> = [
		new Array<ContentRef>(),
		new Array<ContentRef>(),
		new Array<ContentRef>(),
	];
	/** Content id -> where it is: still waiting in a lane, or taken (in flight or resolved). */
	private readonly where = new Map<string, PreloadLane | "taken">();

	/**
	 * Queues each of `refs` not seen before at the end of `lane` (in order; a ref repeated within `refs` once). A push
	 * also moves ids waiting in a lower lane up to `lane`. Returns how many refs were queued or moved.
	 *
	 * `first` (the Daily's known first floor on the menu, docs/STAGE_ASSETS.md SA7): the refs go to the HEAD of `lane`
	 * instead, in `refs` order, ahead of everything already waiting there, and ids already waiting in `lane` itself move
	 * to the head too (so a guess queued earlier never holds them back). Ids waiting in a higher lane or taken stay put.
	 */
	push(refs: ReadonlyArray<ContentRef>, lane: PreloadLane, first = false): number {
		let count = 0;
		let head = 0;
		const rank = laneRank(lane);
		const target = this.lanes[rank];
		for (const ref of refs) {
			const at = this.where.get(ref.contentId);
			const fresh = at === undefined;
			const lower = !fresh && at !== "taken" && laneRank(at) > rank;
			const same = first && !fresh && at === lane;
			if (!fresh && !lower && !same) continue;
			if (lower || same) this.removeFrom(this.lanes[laneRank(at as PreloadLane)], ref.contentId);
			this.where.set(ref.contentId, lane);
			if (first) {
				target.insert(head, ref);
				head += 1;
			} else {
				target.push(ref);
			}
			count += 1;
		}
		return count;
	}

	/**
	 * Re-queues `ref` at the end of `lane` once it was taken (in flight or resolved), bypassing the seen set. An id
	 * still waiting moves up as `push` would (never down); an id never accepted is queued. Returns whether it is now
	 * waiting in a lane it was not waiting in before.
	 */
	retry(ref: ContentRef, lane: PreloadLane): boolean {
		const at = this.where.get(ref.contentId);
		if (at === "taken") {
			this.where.set(ref.contentId, lane);
			this.lanes[laneRank(lane)].push(ref);
			return true;
		}
		return this.push([ref], lane) > 0;
	}

	/** Takes up to `max` waiting refs, front lane first, then next, then back, each first in first out. */
	take(max: number): Array<ContentRef> {
		const out = new Array<ContentRef>();
		for (const lane of this.lanes) {
			while (out.size() < max && lane.size() > 0) out.push(lane.shift()!);
		}
		for (const ref of out) this.where.set(ref.contentId, "taken");
		return out;
	}

	/** Refs waiting in every lane (or in `lane` alone). */
	pending(lane?: PreloadLane): number {
		if (lane !== undefined) return this.lanes[laneRank(lane)].size();
		let n = 0;
		for (const l of this.lanes) n += l.size();
		return n;
	}

	/** The id was ever accepted (waiting, in flight or resolved). */
	seen(contentId: string): boolean {
		return this.where.has(contentId);
	}

	/** Where the id is: the lane it waits in, "taken" (in flight or resolved), or undefined (never accepted). */
	laneOf(contentId: string): PreloadLane | "taken" | undefined {
		return this.where.get(contentId);
	}

	private removeFrom(lane: Array<ContentRef>, contentId: string): void {
		let i = 0;
		while (i < lane.size()) {
			if (lane[i].contentId === contentId) {
				lane.remove(i);
				return;
			}
			i += 1;
		}
	}
}

/**
 * Who waits for which content ids (docs/STAGE_LOADER.md SL6; PreloadController.whenLoaded runs it): the session's set
 * of resolved ids (ok or failed: both count) and the open waits, each a set of ids still unresolved, its size at the
 * start and its payload (the callback). `wait` returns true when every id already resolved (the caller fires at
 * once; nothing is stored); `resolve` returns the payloads whose last id that was, in the order they waited.
 * `progress(payload)` reads an open wait's [resolved, total] (docs/STAGE_ASSETS.md SA4: the stage bars), `cancel`
 * drops one, `forget` makes a resolved id unresolved again (the Studio fake-latency gate check re-fetches it).
 * Payloads are compared by identity: give each wait its own (a fresh closure).
 */
export class LoadWaiters<T extends defined> {
	private readonly resolvedIds = new Set<string>();
	private readonly waits = new Array<{ left: Set<string>; total: number; payload: T }>();

	/** `ids` resolved already: true (fire now). Else the wait is stored until its last id resolves. */
	wait(ids: ReadonlyArray<string>, payload: T): boolean {
		const left = new Set<string>();
		const all = new Set<string>();
		for (const id of ids) {
			all.add(id);
			if (!this.resolvedIds.has(id)) left.add(id);
		}
		if (left.size() === 0) return true;
		this.waits.push({ left, total: all.size(), payload });
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

	/**
	 * An open wait's progress: [ids resolved, distinct ids waited for]. Undefined when `payload` has no open wait
	 * (it fired, was cancelled, or never waited).
	 */
	progress(payload: T): [resolved: number, total: number] | undefined {
		for (const w of this.waits) {
			if (w.payload === payload) return [w.total - w.left.size(), w.total];
		}
		return undefined;
	}

	/** Drops the open wait of `payload` (it never fires). Returns whether one was open. */
	cancel(payload: T): boolean {
		let i = 0;
		while (i < this.waits.size()) {
			if (this.waits[i].payload === payload) {
				this.waits.remove(i);
				return true;
			}
			i += 1;
		}
		return false;
	}

	/** Makes a resolved id unresolved again: later waits include it until it resolves once more. Open waits keep theirs. */
	forget(contentId: string): void {
		this.resolvedIds.delete(contentId);
	}

	isResolved(contentId: string): boolean {
		return this.resolvedIds.has(contentId);
	}

	/** Waits still open. */
	open(): number {
		return this.waits.size();
	}
}

/** What the client reads to pick its PreloadDevice (GuiService / UserInputService, once at start). */
export interface PreloadDeviceInput {
	/** GuiService:IsTenFootInterface() (a console on a TV). */
	readonly tenFoot: boolean;
	readonly touchEnabled: boolean;
	readonly keyboardEnabled: boolean;
	readonly gamepadEnabled: boolean;
}

/**
 * The device class: a ten-foot interface is a console; touch with no keyboard and no gamepad is a touch device (the
 * rule InputController uses for a phone's first device); anything else is a desktop.
 */
export function preloadDeviceOf(i: PreloadDeviceInput): PreloadDevice {
	if (i.tenFoot) return "console";
	if (i.touchEnabled && !i.keyboardEnabled && !i.gamepadEnabled) return "touch";
	return "desktop";
}

/** Entries per PreloadAsync call on `device` (PRELOAD.chunkSizeByDevice), at least 1. */
export function preloadChunkSize(device: PreloadDevice, cfg: PreloadConfig = PRELOAD): number {
	return math.max(1, cfg.chunkSizeByDevice[device]);
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
