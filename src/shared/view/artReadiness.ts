/**
 * Art readiness, the pure core (docs/STAGE_ASSETS.md "Revision 2" section 11, SA15): has a logical id's art finished
 * downloading on this device? Until it has, renderers draw the pack's placeholder (a stand-in) and swap to the art on
 * the flip. Fed by the client's PreloadController (SA16: PreloadAsync statuses, the engine's fetch status); renderers
 * ask `isReady(id)` next to `pack.sprites(id)` / `pack.bullet(id)` / ... ThemePack stays pure and unchanged.
 *
 *   content ids   pending -> ready (markReady) or failed (markFailed). The first failure schedules ONE retry
 *                 (`retryAfterSec` later; `retryDue(now)` hands it out once); the `maxFailures`-th failure is final.
 *                 A final failure counts as resolved (waits and logs stop waiting for it) but NOT as ready: a set
 *                 with a sheet that never loaded stays a stand-in for the session (SAD13), never art drawn from a
 *                 blank sheet (an invisible enemy, an invisible solid decor blocker). Ready wins: a failure reported
 *                 after a success is ignored. Resolved is monotonic.
 *   logical ids   ready when every content id of `source.contentIds(id)` is ready; an id with NO content ids (the
 *                 placeholder pack, an id not uploaded) is ready at once: nothing to wait for.
 *                 Per logical id the core keeps the count of its content ids not ready yet (built on first use, kept
 *                 current by every status change), so `isReady` is a map read.
 *   tracking      a logical id is tracked once `isReady(id)` or `track(id)` saw it; only tracked ids are listed by
 *                 `flippedSince`. PreloadController tracks every `assetIdList()` id of the pack at start, so in the
 *                 client every pack id is listed.
 *   epoch         `epoch()` increments on every content status change and every `setForced` change. A consumer keeps
 *                 the epoch it last handled and reads `flippedSince(it)`: the tracked ids whose `isReady` CHANGED
 *                 since (in normal play only pending -> ready; `setForced` also flips ids back to not ready), each
 *                 once, in the order they flipped. Re-read `isReady(id)` for the direction.
 *   forced        `setForced("all" | prefixes | undefined)` (debug `KV_StandInsForce`): matching logical ids report not
 *                 ready whatever their content; clearing it flips them back.
 *   time          passed in (`nowSec`), never read: the core is headless-testable.
 *
 * Extension point, not built (SA0 has measured no first-draw hitch, SAD7): a "warm" stage between downloaded and
 * ready (ready only after one confirmed hidden draw) would sit between `markReady` and the logical count: a content id
 * would count as resolved only once warmed. Nothing here assumes it away.
 *
 * Tunables: ART_READINESS in artReadinessConfig.ts. No Roblox APIs.
 */
import type { ContentRef } from "shared/theme";
import { ART_READINESS, type ArtReadinessConfig } from "./artReadinessConfig";

/** A content id's download status. `failed` covers both a failure waiting for its retry and a final one. */
export type ContentStatus = "pending" | "ready" | "failed";

/** What the core reads from a theme pack (ThemePack and PreloadSource satisfy it). */
export interface ReadinessSource {
	/** Every content id of a logical id, deterministic order. The pack is immutable: read once per logical id. */
	contentIds(id: string): ReadonlyArray<ContentRef>;
}

/** The debug force: every logical id, a list of logical-id prefixes, or none. */
export type StandInsForce = "all" | ReadonlyArray<string> | undefined;

function startsWith(s: string, prefix: string): boolean {
	return s.sub(1, prefix.size()) === prefix;
}

function trim(s: string): string {
	const [t] = s.gsub("^%s+", "");
	const [u] = t.gsub("%s+$", "");
	return u;
}

/**
 * `KV_StandInsForce`'s value -> the force: `cfg.forceAllValue` ("all", any case, trimmed) forces everything; any other
 * non-empty string is a `cfg.forceListSeparator`-separated list of logical-id prefixes (trimmed, empty entries
 * dropped); anything else (unset, a number, an empty string) is none.
 */
export function parseStandInsForce(value: unknown, cfg: ArtReadinessConfig = ART_READINESS): StandInsForce {
	if (!typeIs(value, "string")) return undefined;
	const trimmed = trim(value);
	if (trimmed === "") return undefined;
	if (trimmed.lower() === cfg.forceAllValue) return "all";
	const out = new Array<string>();
	for (const part of trimmed.split(cfg.forceListSeparator)) {
		const p = trim(part);
		if (p !== "") out.push(p);
	}
	return out.size() > 0 ? out : undefined;
}

interface ContentEntry {
	status: ContentStatus;
	failures: number;
	/** Counts as resolved for its logical ids (ready, or a final failure). */
	resolved: boolean;
}

interface RetryEntry {
	readonly contentId: string;
	readonly dueSec: number;
}

/** See the module comment. One per client session (PreloadController owns it). */
export class ArtReadiness {
	private readonly content = new Map<string, ContentEntry>();
	/** Logical id -> its distinct content ids (read once from the source). */
	private readonly contentsOf = new Map<string, ReadonlyArray<string>>();
	/** Content id -> the known logical ids that use it, in first-seen order. */
	private readonly logicalOf = new Map<string, Array<string>>();
	/** Logical id -> how many of its content ids are not resolved yet (the cache). */
	private readonly left = new Map<string, number>();
	private readonly tracked = new Set<string>();
	private readonly trackedOrder = new Array<string>();
	/** Flips in order: the epoch they happened at and the logical id. */
	private readonly flips = new Array<{ readonly epoch: number; readonly id: string }>();
	private readonly retries = new Array<RetryEntry>();
	private forced: StandInsForce = undefined;
	private epochCount = 0;

	constructor(private readonly source: ReadinessSource, private readonly cfg: ArtReadinessConfig = ART_READINESS) {}

	// --- content ids -----------------------------------------------------------------------------

	/** The content id downloaded (PreloadAsync Success, or already in the engine). Idempotent. */
	markReady(contentId: string): void {
		const e = this.entry(contentId);
		if (e.status === "ready") return;
		e.status = "ready";
		e.resolved = true;
		this.removeRetry(contentId);
		this.changed(contentId, true);
	}

	/**
	 * The content id's fetch failed or timed out at `nowSec`. The first failures (below `maxFailures`) schedule one retry
	 * `retryAfterSec` later; the last is final (resolved). Ignored once the id is ready or finally failed.
	 */
	markFailed(contentId: string, nowSec: number): void {
		const e = this.entry(contentId);
		if (e.status === "ready" || e.resolved) return;
		e.failures += 1;
		e.status = "failed";
		const final = e.failures >= this.cfg.maxFailures;
		if (final) {
			e.resolved = true;
			this.removeRetry(contentId);
		} else {
			this.removeRetry(contentId);
			this.retries.push({ contentId, dueSec: nowSec + this.cfg.retryAfterSec });
		}
		this.changed(contentId, false);
	}

	/**
	 * The content ids whose retry is due at `nowSec`, in the order they failed; each is handed out once (the caller
	 * re-queues it). A status change is not an epoch change: nothing flips until the retry resolves.
	 */
	retryDue(nowSec: number): Array<string> {
		const out = new Array<string>();
		let i = 0;
		while (i < this.retries.size()) {
			const r = this.retries[i];
			if (r.dueSec <= nowSec) {
				out.push(r.contentId);
				this.retries.remove(i);
			} else {
				i += 1;
			}
		}
		return out;
	}

	/** Retries scheduled and not handed out yet. */
	retriesPending(): number {
		return this.retries.size();
	}

	status(contentId: string): ContentStatus {
		return this.content.get(contentId)?.status ?? "pending";
	}

	/** Ready, or finally failed. */
	isResolved(contentId: string): boolean {
		return this.content.get(contentId)?.resolved ?? false;
	}

	/** Failed `maxFailures` times: left as a stand-in for the session (counted as resolved). */
	isFinalFailure(contentId: string): boolean {
		const e = this.content.get(contentId);
		return e !== undefined && e.status === "failed" && e.resolved;
	}

	// --- logical ids -----------------------------------------------------------------------------

	/**
	 * Every content id of `logicalId` is ready (none: ready; a finally failed one keeps it a stand-in), and no debug
	 * force matches it. Tracks
	 * the id (see the module comment).
	 */
	isReady(logicalId: string): boolean {
		this.track(logicalId);
		if (this.isForced(logicalId)) return false;
		return this.left.get(logicalId) === 0;
	}

	/** Registers `logicalId` for `flippedSince` without asking. Idempotent. */
	track(logicalId: string): void {
		if (this.tracked.has(logicalId)) return;
		this.index(logicalId);
		this.tracked.add(logicalId);
		this.trackedOrder.push(logicalId);
	}

	/** The distinct content ids of `logicalId` (the `[Ready] ... (<n> content ids)` log). */
	contentCount(logicalId: string): number {
		return this.index(logicalId).size();
	}

	/** The content ids of `logicalId` not resolved yet, in the source's order (logs: what a stand-in waits for). */
	unresolved(logicalId: string): Array<string> {
		const out = new Array<string>();
		for (const c of this.index(logicalId)) if (!this.isResolved(c)) out.push(c);
		return out;
	}

	/** Tracked ids, and how many of them are ready now (the summary log line). */
	trackedCounts(): [ready: number, tracked: number] {
		let ready = 0;
		for (const id of this.trackedOrder) if (!this.isForced(id) && this.left.get(id) === 0) ready += 1;
		return [ready, this.trackedOrder.size()];
	}

	// --- epoch and flips -------------------------------------------------------------------------

	/** Increments on every content status change and every `setForced` change; starts at 0. */
	epoch(): number {
		return this.epochCount;
	}

	/**
	 * The tracked logical ids whose `isReady` changed after epoch `since` (pending -> ready, or either way under a
	 * `setForced` change), each once, in the order they (first) flipped. `flippedSince(epoch())` is empty.
	 */
	flippedSince(since: number): Array<string> {
		const out = new Array<string>();
		const seen = new Set<string>();
		// flips are appended in epoch order: walk back to the first one after `since`
		let start = this.flips.size();
		while (start > 0 && this.flips[start - 1].epoch > since) start -= 1;
		for (let i = start; i < this.flips.size(); i++) {
			const id = this.flips[i].id;
			if (seen.has(id)) continue;
			seen.add(id);
			out.push(id);
		}
		return out;
	}

	// --- the debug force -------------------------------------------------------------------------

	/** Forces matching logical ids to report not ready (`undefined` clears it). Flips every tracked id it changes. */
	setForced(force: StandInsForce): void {
		if (sameForce(this.forced, force)) return;
		const before = new Map<string, boolean>();
		for (const id of this.trackedOrder) before.set(id, this.readyNow(id));
		this.forced = force;
		this.epochCount += 1;
		for (const id of this.trackedOrder) {
			if (before.get(id) !== this.readyNow(id)) this.flips.push({ epoch: this.epochCount, id });
		}
	}

	forcedNow(): StandInsForce {
		return this.forced;
	}

	isForced(logicalId: string): boolean {
		const f = this.forced;
		if (f === undefined) return false;
		if (f === "all") return true;
		for (const prefix of f) if (startsWith(logicalId, prefix)) return true;
		return false;
	}

	// --- internals -------------------------------------------------------------------------------

	private readyNow(logicalId: string): boolean {
		return !this.isForced(logicalId) && this.left.get(logicalId) === 0;
	}

	private entry(contentId: string): ContentEntry {
		let e = this.content.get(contentId);
		if (e === undefined) {
			e = { status: "pending", failures: 0, resolved: false };
			this.content.set(contentId, e);
		}
		return e;
	}

	/** Reads `logicalId`'s content ids once, links them back and counts the unresolved ones. */
	private index(logicalId: string): ReadonlyArray<string> {
		const known = this.contentsOf.get(logicalId);
		if (known !== undefined) return known;
		const ids = new Array<string>();
		const seen = new Set<string>();
		let unresolved = 0;
		for (const ref of this.source.contentIds(logicalId)) {
			const c = ref.contentId;
			if (seen.has(c)) continue;
			seen.add(c);
			ids.push(c);
			let users = this.logicalOf.get(c);
			if (users === undefined) {
				users = [];
				this.logicalOf.set(c, users);
			}
			users.push(logicalId);
			if (this.status(c) !== "ready") unresolved += 1;
		}
		this.contentsOf.set(logicalId, ids);
		this.left.set(logicalId, unresolved);
		return ids;
	}

	/** A content status changed: bump the epoch; if it just became ready, count it down and record the flips. */
	private changed(contentId: string, becameReady: boolean): void {
		this.epochCount += 1;
		if (!becameReady) return;
		const users = this.logicalOf.get(contentId);
		if (users === undefined) return;
		for (const id of users) {
			const n = (this.left.get(id) ?? 0) - 1;
			this.left.set(id, n);
			if (n === 0 && this.tracked.has(id) && !this.isForced(id)) {
				this.flips.push({ epoch: this.epochCount, id });
			}
		}
	}

	private removeRetry(contentId: string): void {
		let i = 0;
		while (i < this.retries.size()) {
			if (this.retries[i].contentId === contentId) this.retries.remove(i);
			else i += 1;
		}
	}
}

function sameForce(a: StandInsForce, b: StandInsForce): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined || a === "all" || b === "all") return false;
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) return false;
	return true;
}
