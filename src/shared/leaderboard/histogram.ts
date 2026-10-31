/**
 * Score histograms of the daily boards (docs/DAILY.md "5. Percentile", DS6). OrderedDataStore cannot count entries
 * or rank a key outside the rows read, so each daily board and scope keeps bucket counts of its entries' scores:
 *
 *   buckets   bucketOf(score): DAILY_HIST.buckets (64) on a log scale. Bucket 0 = scores below 2^6 (64, 0 included);
 *             then 3 buckets per doubling with edges 2^k x {1, 5/4, 8/5} (floor), k = 6..26: 64, 80, 102, 128, 160,
 *             204, 256, ... 67,108,864, 83,886,080, 107,374,182; bucket 63 = [107,374,182, inf) (the ordered value
 *             caps scores at 2^27 - 1). Each bucket spans a score ratio of 1.25-1.28. Integer arithmetic only, so every
 *             server computes the same edges.
 *   deltas    from the personal-best transform (histDeltas): a new entry +1 in its bucket; a replacement also -1 in the
 *             old entry's bucket (nothing when both fall in one bucket); a write that did not raise the entry: none.
 *   buffer    deltas collect per server (HistogramBuffer) and flush every DAILY_HIST.flushSeconds into ONE of
 *             DAILY_HIST.shards keys `<board>_<scope>_s<n>` (histShardOf(JobId)) with UpdateAsync adding the counts
 *             (addHistCounts). A shard's bucket may go NEGATIVE (the -1 of an entry whose +1 another server's shard
 *             holds): only the sum over shards is meaningful, clamped at 0 per bucket (sumHistShards).
 *
 * Pure.
 */
import { DAILY_HIST } from "shared/daily";
import { imul, u32 } from "shared/jsmath";
import { decodeOrderedValue, maxEncodableScore, pow2 } from "./orderedValue";
import { boardRefKey, type BoardRef } from "./scope";

/** One bucket's change. */
export interface HistDelta {
	readonly bucket: number;
	readonly delta: number;
}

/** A shard as stored in LB_Daily_Hist_v1. */
export interface HistShardDoc {
	v: number;
	/** Counts per bucket (dense, DAILY_HIST.buckets long; may hold negatives, see the file comment). */
	c: number[];
}

function buildEdges(): number[] {
	const H = DAILY_HIST;
	const steps = H.edgeNumerators.size();
	const edges = [0];
	for (let i = 1; i < H.buckets; i++) {
		const idx = i - 1;
		const k = H.firstEdgeExponent + math.floor(idx / steps);
		const m = idx % steps;
		edges.push(math.floor((pow2(k) * H.edgeNumerators[m]) / H.edgeDenominators[m]));
	}
	return edges;
}

/** Lower edge of every bucket (edges[0] = 0). */
const EDGES = buildEdges();

/** The lower edge of bucket `i` (0 for bucket 0). */
export function histBucketEdge(i: number): number {
	return EDGES[i];
}

/** Scores in bucket `i`: [lo, hi) (the last bucket ends past the largest encodable score). */
export function histBucketBounds(i: number): { readonly lo: number; readonly hi: number } {
	const hi = i + 1 < EDGES.size() ? EDGES[i + 1] : maxEncodableScore() + 1;
	return { lo: EDGES[i], hi };
}

/** The bucket of a score (negative / NaN scores: bucket 0). */
export function bucketOf(score: number): number {
	if (score !== score || score < EDGES[1]) return 0;
	let lo = 1;
	let hi = EDGES.size() - 1;
	while (lo < hi) {
		const mid = math.floor((lo + hi + 1) / 2);
		if (EDGES[mid] <= score) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/**
 * The histogram deltas of one personal-best write: `previous` = the valid ordered value the transform found
 * (undefined: no entry), `value` = the value posted, `improved` = the write raised the entry.
 */
export function histDeltas(previous: number | undefined, value: number, improved: boolean): HistDelta[] {
	if (!improved) return [];
	const into = bucketOf(decodeOrderedValue(value).score);
	if (previous === undefined) return [{ bucket: into, delta: 1 }];
	const old = bucketOf(decodeOrderedValue(previous).score);
	if (old === into) return [];
	return [
		{ bucket: old, delta: -1 },
		{ bucket: into, delta: 1 },
	];
}

/** A zeroed count array. */
export function emptyHistCounts(): number[] {
	const out: number[] = [];
	for (let i = 0; i < DAILY_HIST.buckets; i++) out.push(0);
	return out;
}

/** Entrants counted (the sum of the buckets). */
export function histTotal(counts: ReadonlyArray<number>): number {
	let total = 0;
	for (const c of counts) total += c;
	return total;
}

/** The shard a server writes: FNV-1a 32 of its JobId, mod `shards` (Studio's empty JobId: always the same one). */
export function histShardOf(jobId: string, shards: number = DAILY_HIST.shards): number {
	let h = 0x811c9dc5;
	for (let i = 1; i <= jobId.size(); i++) {
		const [b] = string.byte(jobId, i);
		h = u32(imul(bit32.bxor(h, b ?? 0), 0x01000193));
	}
	return h % shards;
}

/** A shard's key in LB_Daily_Hist_v1: `<board>_<scope>_s<n>` ("solo_d303_r1_s3"). */
export function histShardKey(ref: BoardRef, shard: number): string {
	return `${boardRefKey(ref)}_s${shard}`;
}

function isCount(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge && math.floor(v) === v;
}

/** A stored shard's counts (dense), or undefined when it is not a shard document of this version. */
export function decodeHistShard(raw: unknown): number[] | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const doc = raw as { v?: unknown; c?: unknown };
	if (doc.v !== DAILY_HIST.version || !typeIs(doc.c, "table")) return undefined;
	const src = doc.c as unknown[];
	const out = emptyHistCounts();
	for (let i = 0; i < DAILY_HIST.buckets; i++) {
		const v = src[i];
		if (v === undefined) continue;
		if (!isCount(v)) return undefined;
		out[i] = v;
	}
	return out;
}

/** UpdateAsync's transform for a flush: the stored shard (anything unreadable counts as empty) plus `add`. */
export function addHistCounts(old: unknown, add: ReadonlyArray<number>): HistShardDoc {
	const counts = decodeHistShard(old) ?? emptyHistCounts();
	for (let i = 0; i < DAILY_HIST.buckets; i++) counts[i] += add[i] ?? 0;
	return { v: DAILY_HIST.version, c: counts };
}

/** The board's histogram from its shards (missing / bad shards count as empty), each bucket clamped at 0. */
export function sumHistShards(raws: ReadonlyArray<unknown>): number[] {
	const out = emptyHistCounts();
	for (const raw of raws) {
		const counts = decodeHistShard(raw);
		if (counts === undefined) continue;
		for (let i = 0; i < DAILY_HIST.buckets; i++) out[i] += counts[i];
	}
	for (let i = 0; i < DAILY_HIST.buckets; i++) out[i] = math.max(0, out[i]);
	return out;
}

/** `a + b` per bucket (a server's own unflushed deltas on top of the read shards), each clamped at 0. */
export function addCounts(a: ReadonlyArray<number>, b: ReadonlyArray<number> | undefined): number[] {
	const out = emptyHistCounts();
	for (let i = 0; i < DAILY_HIST.buckets; i++) out[i] = math.max(0, (a[i] ?? 0) + (b?.[i] ?? 0));
	return out;
}

/**
 * A server's unflushed histogram deltas per board and scope (keyed by boardRefKey). `takeAll` empties it for a flush;
 * a failed flush puts its counts back with `restore`.
 */
export class HistogramBuffer {
	private readonly counts = new Map<string, { ref: BoardRef; counts: number[] }>();

	add(ref: BoardRef, deltas: ReadonlyArray<HistDelta>): void {
		if (deltas.size() === 0) return;
		const key = boardRefKey(ref);
		let slot = this.counts.get(key);
		if (slot === undefined) {
			slot = { ref, counts: emptyHistCounts() };
			this.counts.set(key, slot);
		}
		for (const d of deltas) slot.counts[d.bucket] += d.delta;
	}

	/** Puts back counts a failed flush took. */
	restore(ref: BoardRef, counts: ReadonlyArray<number>): void {
		const deltas: HistDelta[] = [];
		for (let i = 0; i < counts.size(); i++) if (counts[i] !== 0) deltas.push({ bucket: i, delta: counts[i] });
		this.add(ref, deltas);
	}

	/** This server's unflushed counts for a board (undefined: none). */
	pending(ref: BoardRef): ReadonlyArray<number> | undefined {
		return this.counts.get(boardRefKey(ref))?.counts;
	}

	/** Everything buffered (boards whose deltas cancel out are dropped), removed. */
	takeAll(): Array<{ readonly ref: BoardRef; readonly counts: number[] }> {
		const out: Array<{ ref: BoardRef; counts: number[] }> = [];
		for (const [, slot] of this.counts) {
			if (slot.counts.some((c) => c !== 0)) out.push({ ref: slot.ref, counts: slot.counts });
		}
		this.counts.clear();
		return out;
	}

	size(): number {
		return this.counts.size();
	}
}
