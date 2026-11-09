/**
 * ArrivalLog: the KV_Debug co-op arrival log (docs/FRAME_PACING.md FP0 / FP5). Pure bookkeeping on numbers the caller
 * hands in (its clock, each merged batch's tick count, its render frames); it reads nothing from the sim and changes
 * nothing that is sent, stepped, hashed or recorded. SimController creates one only in a KV_Debug co-op run.
 *
 *   arrived(now, ticks)   a merged batch of `ticks` ticks arrived at `now` (seconds)
 *   frame(now, dt)        a rendered frame of `dt` seconds ended at `now`
 *   due(now)              the window (ARRIVAL_LOG.windowSec) is full
 *   take(now)             the window's numbers (ArrivalWindow), and a new window starts at `now`
 *
 * Inter-arrival gaps run from one batch to the next, across windows (a window's first gap is measured from the last
 * batch of the window before). Quantiles are nearest rank: the smallest gap with at least that share at or below it.
 * formatArrivalLine turns a window and the client's pacing numbers into the line SimController prints.
 */
import { SIM_DT, isFiniteNumber } from "shared/sim";
import { ARRIVAL_LOG, type ArrivalLogTunables } from "./config";
import type { LeadStats } from "./lead";
import type { PacingStats } from "./pacer";

const MS_PER_SEC = 1000;
const PERCENT = 100;
const NONE = "-";

export interface ArrivalWindow {
	/** The window's length, seconds of local clock. */
	readonly seconds: number;
	/** Batches that arrived in it, and the ticks they carried. */
	readonly batches: number;
	readonly ticks: number;
	/** Inter-arrival gaps (ms): ARRIVAL_LOG's mid / high quantiles and the max; undefined with no gap measured. */
	readonly gapMidMs: number | undefined;
	readonly gapHighMs: number | undefined;
	readonly gapMaxMs: number | undefined;
	/** Batch-size histogram: sizes[i] batches of i + 1 ticks; the last bucket counts sizeBuckets or more. */
	readonly sizes: ReadonlyArray<number>;
	/** Rendered frames, their rate over the window (undefined for an empty window) and the longest one (ms). */
	readonly frames: number;
	readonly fps: number | undefined;
	readonly worstFrameMs: number | undefined;
}

/** The nearest-rank quantile `p` of an ascending array (undefined when empty). */
export function nearestRank(sorted: ReadonlyArray<number>, p: number): number | undefined {
	const n = sorted.size();
	if (n === 0) return undefined;
	let rank = math.ceil(p * n);
	if (rank < 1) rank = 1;
	if (rank > n) rank = n;
	return sorted[rank - 1];
}

export class ArrivalLog {
	private readonly tunables: ArrivalLogTunables;
	private start: number | undefined;
	private lastArrival: number | undefined;
	private readonly gaps: number[] = [];
	private readonly sizes: number[] = [];
	private batches = 0;
	private ticks = 0;
	private frames = 0;
	private worstFrame: number | undefined;

	constructor(tunables: ArrivalLogTunables = ARRIVAL_LOG) {
		this.tunables = tunables;
		for (let i = 0; i < tunables.sizeBuckets; i++) this.sizes.push(0);
	}

	/** A merged batch of `ticks` ticks arrived at `now`. Empty or non-finite input is ignored. */
	arrived(now: number, ticks: number): void {
		if (!isFiniteNumber(now) || !isFiniteNumber(ticks) || ticks < 1) return;
		this.open(now);
		const count = math.floor(ticks);
		this.batches++;
		this.ticks += count;
		const bucket = math.min(count, this.tunables.sizeBuckets) - 1;
		this.sizes[bucket] += 1;
		const last = this.lastArrival;
		if (last !== undefined && now >= last && this.gaps.size() < this.tunables.maxGaps) {
			this.gaps.push((now - last) * MS_PER_SEC);
		}
		this.lastArrival = now;
	}

	/** A rendered frame of `dt` seconds ended at `now`. */
	frame(now: number, dt: number): void {
		if (!isFiniteNumber(now)) return;
		this.open(now);
		this.frames++;
		if (isFiniteNumber(dt) && dt >= 0) {
			const ms = dt * MS_PER_SEC;
			if (this.worstFrame === undefined || ms > this.worstFrame) this.worstFrame = ms;
		}
	}

	/** The window is full (its first arrival or frame was windowSec or more before `now`). */
	due(now: number): boolean {
		return this.start !== undefined && isFiniteNumber(now) && now - this.start >= this.tunables.windowSec;
	}

	/** The window's numbers; a new window starts at `now` (the last arrival is kept for the next gap). */
	take(now: number): ArrivalWindow {
		const start = this.start ?? now;
		const seconds = math.max(now - start, 0);
		const sorted: number[] = [];
		for (const g of this.gaps) sorted.push(g);
		sorted.sort((a, b) => a < b);
		const sizes: number[] = [];
		for (const s of this.sizes) sizes.push(s);
		const t = this.tunables;
		const out: ArrivalWindow = {
			seconds,
			batches: this.batches,
			ticks: this.ticks,
			gapMidMs: nearestRank(sorted, t.midPercentile),
			gapHighMs: nearestRank(sorted, t.highPercentile),
			gapMaxMs: sorted.size() > 0 ? sorted[sorted.size() - 1] : undefined,
			sizes,
			frames: this.frames,
			fps: seconds > 0 ? this.frames / seconds : undefined,
			worstFrameMs: this.worstFrame,
		};
		this.start = now;
		this.gaps.clear();
		for (let i = 0; i < this.sizes.size(); i++) this.sizes[i] = 0;
		this.batches = 0;
		this.ticks = 0;
		this.frames = 0;
		this.worstFrame = undefined;
		return out;
	}

	private open(now: number): void {
		if (this.start === undefined) this.start = now;
	}
}

/** What the arrival line shows beside the window: the client's lead and pacing (LockstepClient). */
export interface ArrivalLineInfo {
	/** LockstepClient.pacingStats(): undefined while pacing is not on. */
	readonly pacing: PacingStats | undefined;
	/** KV_PacingOff: the client was built without pacing. */
	readonly pacingOff: boolean;
	/** LockstepClient.inputLead() (effective) and netLead(), ticks. */
	readonly lead: number;
	readonly netLead: number;
	/** LockstepClient.mismatches so far (the `miss` of the debug line). */
	readonly misses: number;
	/** Received ticks not stepped yet (LockstepClient.backlog()). */
	readonly backlog: number;
	/** LockstepClient.leadStats(): the measured lead's numbers (undefined without it). */
	readonly leadStats: LeadStats | undefined;
	/** KV_LeadOff: the client was built without the measured lead. */
	readonly leadOff: boolean;
}

function ms(v: number | undefined): string {
	return v === undefined ? NONE : string.format("%.0f", v);
}

/** The histogram's non-empty buckets, "2:290 3:10 8+:1" ("-" when empty). */
function sizesText(sizes: ReadonlyArray<number>): string {
	const parts: string[] = [];
	const last = sizes.size() - 1;
	for (let i = 0; i <= last; i++) {
		if (sizes[i] === 0) continue;
		parts.push(`${i + 1}${i === last ? "+" : ""}:${sizes[i]}`);
	}
	return parts.size() > 0 ? parts.join(" ") : NONE;
}

function paceText(info: ArrivalLineInfo): string {
	if (info.pacingOff) return "pace off (KV_PacingOff)";
	const p = info.pacing;
	if (p === undefined || !p.started) return "pace waiting";
	return (
		`pace ${p.depthTicks}t ${ms(p.depthMs)}ms target ${string.format("%.1f", p.targetTicks)}t` +
		` jitter p95 ${ms(p.jitterMs)}ms holds ${p.holds} discarded ${p.discarded}`
	);
}

/** Ticks -> whole ms ('-' for none). */
function tickMs(ticks: number | undefined): string {
	return ticks === undefined ? NONE : ms(ticks * SIM_DT * MS_PER_SEC);
}

/** The measured lead's part (docs/FRAME_PACING.md Design 11): trips, the lead and its targets, lates / bumps / falls. */
function leadText(info: ArrivalLineInfo): string {
	const l = info.leadStats;
	if (info.leadOff || l === undefined) return "lead off (KV_LeadOff)";
	if (!l.echoing) return "lead legacy";
	return (
		`trip p50 ${tickMs(l.tripP50)} p95 ${tickMs(l.tripP95)} max ${tickMs(l.tripMax)} ms` +
		` · lead ${l.lead}t target ${l.target}t fall ${l.fallTarget}t` +
		` · lates ${l.lates} bumps ${l.bumps} falls ${l.falls}`
	);
}

/**
 * The arrival log's line (developer text, English):
 * `[Pace] 10.0s batches 300 ticks 600 · gap p50 33 p95 41 max 87 ms · sizes 2:290 3:10 · pace 4t 58ms target 3.5t
 * jitter p95 9ms holds 0 discarded 0 · lead 7t net 3t miss 0 backlog 3 · fps 60.0 worst 21ms · trip p50 117 p95 150
 * max 183 ms · lead 11t target 11t fall 12t · lates 9 bumps 3 falls 1` (the last part `lead legacy` while the miss
 * counter steers the lead, `lead off (KV_LeadOff)` without the measured lead).
 */
export function formatArrivalLine(w: ArrivalWindow, info: ArrivalLineInfo, tunables = ARRIVAL_LOG): string {
	const mid = math.round(tunables.midPercentile * PERCENT);
	const high = math.round(tunables.highPercentile * PERCENT);
	const fps = w.fps === undefined ? NONE : string.format("%.1f", w.fps);
	return (
		`[Pace] ${string.format("%.1f", w.seconds)}s batches ${w.batches} ticks ${w.ticks}` +
		` · gap p${mid} ${ms(w.gapMidMs)} p${high} ${ms(w.gapHighMs)} max ${ms(w.gapMaxMs)} ms` +
		` · sizes ${sizesText(w.sizes)}` +
		` · ${paceText(info)}` +
		` · lead ${info.lead}t net ${info.netLead}t miss ${info.misses} backlog ${info.backlog}` +
		` · fps ${fps} worst ${ms(w.worstFrameMs)}ms` +
		` · ${leadText(info)}`
	);
}
