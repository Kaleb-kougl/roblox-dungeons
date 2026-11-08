/**
 * PlayoutPacer: co-op frame pacing (docs/FRAME_PACING.md, Design 1-4). Pure: no Roblox API, clock or randomness; the
 * caller passes its monotonic clock `now` (seconds).
 *
 * Merged frame k steps the sim from tick k to k + 1, and is due once the playout position
 * `pos = (now - P) / dt` reaches k, where P is the playout offset. P sits a small buffer behind the fastest arrivals:
 *
 *   arrived(now, newestTick)   a merged batch arrived: its offset `now - newestTick x dt` is kept as pending (the
 *                              unknown server-client clock difference is in every offset, so it cancels out)
 *   frame(now, frameDt, ...)   once per rendered frame: commits the pending offsets to the windows (or discards them
 *                              when the frame hitched), slews P toward its target, and returns how many queued frames
 *                              to step now; holds (P moves forward, the views freeze on the newest state) when a due
 *                              frame has not arrived; catches up at most `maxCatchup` per frame after a client hitch
 *   alpha()                    the interpolation alpha, in [0, 1), once the caller stepped what frame() returned
 *   depthTicks()               the buffer depth in whole ticks (what the input lead adds, Design 5)
 *
 * Target: base = the smallest offset over `floorWindowSec`; jitter = the `jitterPercentile` offset over
 * `jitterWindowSec` minus base; P* = base + clamp(jitter / dt + marginTicks, minDepthTicks, maxDepthTicks) x dt.
 * Never extrapolates (FPD3): alpha stays below 1 and only ever lerps between two stepped ticks.
 */
import { SIM_DT, isFiniteNumber } from "shared/sim";
import { PACING, type PacingTunables } from "./config";

/** Absorbs float rounding so a frame on a tick boundary reliably counts that tick as due (as loop.ts). */
const EPSILON = 1e-9;
/** `Number.EPSILON` (2^-52): alpha is capped just below 1. */
const DOUBLE_EPSILON = 2.220446049250313e-16;
/** A hold leaves the playout position this far (ticks) below the next undelivered frame: alpha just under 1. */
const HOLD_GAP_TICKS = 1e-6;
const MS_PER_SEC = 1000;

export interface PacingStats {
	/** The first arrival placed the playout clock. */
	readonly started: boolean;
	/** depthTicks(): the buffer depth (P - base) in whole ticks, rounded up. */
	readonly depthTicks: number;
	/** The buffer depth (P - base) in milliseconds, unrounded. */
	readonly depthMs: number;
	/** The target depth in ticks (fractional, clamped to [minDepthTicks, maxDepthTicks]). */
	readonly targetTicks: number;
	/** The measured jitter: the percentile offset minus base, in milliseconds. */
	readonly jitterMs: number;
	/** Holds so far (one per contiguous run of held frames). */
	readonly holds: number;
	/** The last frame held (a due frame had not arrived). */
	readonly holding: boolean;
	/** The last frame was catching up (more than maxCatchup frames due, all of them queued). */
	readonly catchingUp: boolean;
	/** Committed arrival offsets still inside a window. */
	readonly samples: number;
	/** Arrival offsets committed to the windows so far. */
	readonly committed: number;
	/** Arrival offsets discarded so far (they arrived in a hitched frame). */
	readonly discarded: number;
	/** The playout position (ticks) as of the last frame(). */
	readonly position: number;
	/** The playout offset P (seconds, on the caller's clock). */
	readonly offsetSec: number;
	/** The target playout offset P* (seconds). */
	readonly targetOffsetSec: number;
	/** The smallest offset over the floor window (seconds). */
	readonly baseSec: number;
}

function sanitizeCount(v: number): number {
	return isFiniteNumber(v) && v > 0 ? math.floor(v) : 0;
}

export class PlayoutPacer {
	private readonly tunables: PacingTunables;
	private readonly dt: number;

	private started = false;
	/** Playout offset P: frame k is due at local time k x dt + P. */
	private offset = 0;
	/** The smallest committed offset over the floor window (kept when the window empties). */
	private base = 0;
	/** Target depth in ticks (kept when the jitter window empties). */
	private targetDepth: number;
	private jitter = 0;
	private targetDirty = false;
	/** Committed samples inside the floor / jitter windows as of the last frame (a change means a retarget). */
	private floorCount = 0;
	private jitterCount = 0;

	/** Committed samples, oldest first: the local time each arrived, and its offset. */
	private readonly sampleAt: number[] = [];
	private readonly sampleOffset: number[] = [];
	/** Arrivals since the last frame(), not yet committed. */
	private readonly pendingAt: number[] = [];
	private readonly pendingOffset: number[] = [];
	/** Scratch for the percentile (sorted copy of the jitter window). */
	private readonly scratch: number[] = [];

	private lastNow: number | undefined;
	private pos = 0;
	private lastAlpha = 0;
	private holdCount = 0;
	private isHolding = false;
	private isCatchingUp = false;
	private committedCount = 0;
	private discardedCount = 0;

	constructor(tunables: PacingTunables = PACING, dt: number = SIM_DT) {
		this.tunables = tunables;
		this.dt = dt;
		this.targetDepth = tunables.startDepthTicks;
	}

	/** A merged batch arrived; newestTick = index of the newest merged frame in it (firstTick + count - 1). */
	arrived(now: number, newestTick: number): void {
		if (!isFiniteNumber(now) || !isFiniteNumber(newestTick)) return;
		this.pendingAt.push(now);
		this.pendingOffset.push(now - newestTick * this.dt);
	}

	/** Called once per rendered frame. Returns how many queued frames to step now (0..min(queued, maxCatchup)). */
	frame(now: number, frameDt: number, stepped: number, queued: number, maxCatchup: number): number {
		const t = this.tunables;
		const dt = this.dt;
		// The clock: non-finite keeps the last one; it never goes back.
		let clock = isFiniteNumber(now) ? now : this.lastNow;
		if (clock === undefined) return 0;
		if (this.lastNow !== undefined && clock < this.lastNow) clock = this.lastNow;
		const elapsed = this.lastNow !== undefined ? clock - this.lastNow : 0;
		this.lastNow = clock;
		const delta = isFiniteNumber(frameDt) && frameDt > 0 ? frameDt : 0;
		const done = sanitizeCount(stepped);
		const inQueue = sanitizeCount(queued);
		const cap = sanitizeCount(maxCatchup);

		this.takePending(delta <= t.hitchFrameSec);
		if (!this.started) {
			this.pos = 0;
			this.lastAlpha = 0;
			return 0;
		}
		this.expire(clock);
		if (this.targetDirty) this.retarget();

		let pos = (clock - this.offset) / dt;
		let need = this.due(pos, done);
		let count: number;
		let hold = need > inQueue && inQueue < cap;
		this.isCatchingUp = false;
		if (hold) {
			count = inQueue;
		} else if (need > cap) {
			// A client hitch: everything due is queued; step the cap and leave P alone.
			count = cap;
			this.isCatchingUp = true;
		} else {
			// Slewed by the frame's time, never more than the clock really moved (a playout rate on `now`).
			if (delta <= t.hitchFrameSec) this.slew(math.min(delta, elapsed));
			pos = (clock - this.offset) / dt;
			need = this.due(pos, done);
			hold = need > inQueue && inQueue < cap;
			count = hold ? inQueue : math.min(need, inQueue, cap);
		}
		const after = done + count;
		if (hold) {
			// Freeze on the newest state: just below the next frame that has not arrived.
			pos = after - HOLD_GAP_TICKS;
			this.offset = clock - pos * dt;
			if (!this.isHolding) this.holdCount++;
		}
		this.isHolding = hold;
		this.pos = pos;
		const a = pos - (after - 1);
		this.lastAlpha = !(a > 0) ? 0 : a < 1 ? a : 1 - DOUBLE_EPSILON;
		return count;
	}

	/** After frame() (and after the caller stepped what it returned): interpolation alpha in [0, 1). */
	alpha(): number {
		return this.lastAlpha;
	}

	/** Current buffer depth in whole ticks (rounded up), >= 0; what the input lead adds. */
	depthTicks(): number {
		if (!this.started) return 0;
		const d = math.ceil((this.offset - this.base) / this.dt - EPSILON);
		return d > 0 ? d : 0;
	}

	/** The target playout offset P* (seconds). */
	targetOffset(): number {
		return this.base + this.targetDepth * this.dt;
	}

	stats(): PacingStats {
		return {
			started: this.started,
			depthTicks: this.depthTicks(),
			depthMs: this.started ? (this.offset - this.base) * MS_PER_SEC : 0,
			targetTicks: this.targetDepth,
			jitterMs: this.jitter * MS_PER_SEC,
			holds: this.holdCount,
			holding: this.isHolding,
			catchingUp: this.isCatchingUp,
			samples: this.sampleAt.size(),
			committed: this.committedCount,
			discarded: this.discardedCount,
			position: this.pos,
			offsetSec: this.offset,
			targetOffsetSec: this.targetOffset(),
			baseSec: this.base,
		};
	}

	/** Frames due and not yet stepped: frame k is due once pos >= k. */
	private due(pos: number, stepped: number): number {
		const n = math.floor(pos + EPSILON) + 1 - stepped;
		return n > 0 ? n : 0;
	}

	/** Commits (or, in a hitched frame, discards) the pending arrivals; the first-ever one starts the clock. */
	private takePending(commit: boolean): void {
		const n = this.pendingAt.size();
		if (n === 0) return;
		if (!this.started) {
			this.started = true;
			this.base = this.pendingOffset[0];
			this.offset = this.base + this.tunables.startDepthTicks * this.dt;
		}
		if (commit) {
			for (let i = 0; i < n; i++) {
				this.sampleAt.push(this.pendingAt[i]);
				this.sampleOffset.push(this.pendingOffset[i]);
			}
			this.committedCount += n;
			this.targetDirty = true;
		} else {
			this.discardedCount += n;
		}
		this.pendingAt.clear();
		this.pendingOffset.clear();
	}

	/** Drops samples older than both windows. */
	private expire(now: number): void {
		const t = this.tunables;
		const keep = now - math.max(t.floorWindowSec, t.jitterWindowSec);
		while (this.sampleAt.size() > 0 && this.sampleAt[0] < keep) {
			this.sampleAt.remove(0);
			this.sampleOffset.remove(0);
			this.targetDirty = true;
		}
		// A sample can leave the shorter window before it leaves the stored ones: count what is inside both.
		const n = this.sampleAt.size();
		const floorFrom = now - t.floorWindowSec;
		const jitterFrom = now - t.jitterWindowSec;
		let outFloor = 0;
		while (outFloor < n && this.sampleAt[outFloor] < floorFrom) outFloor++;
		let outJitter = 0;
		while (outJitter < n && this.sampleAt[outJitter] < jitterFrom) outJitter++;
		const inFloor = n - outFloor;
		const inJitter = n - outJitter;
		if (inFloor !== this.floorCount || inJitter !== this.jitterCount) this.targetDirty = true;
		this.floorCount = inFloor;
		this.jitterCount = inJitter;
	}

	/** base, jitter and the target depth from the committed samples (each kept while its window is empty). */
	private retarget(): void {
		this.targetDirty = false;
		const t = this.tunables;
		const now = this.lastNow ?? 0;
		const floorFrom = now - t.floorWindowSec;
		const jitterFrom = now - t.jitterWindowSec;
		const scratch = this.scratch;
		scratch.clear();
		let lowest: number | undefined;
		const n = this.sampleAt.size();
		for (let i = 0; i < n; i++) {
			const at = this.sampleAt[i];
			const o = this.sampleOffset[i];
			if (at >= floorFrom && (lowest === undefined || o < lowest)) lowest = o;
			if (at >= jitterFrom) scratch.push(o);
		}
		if (lowest !== undefined) this.base = lowest;
		const m = scratch.size();
		if (m === 0) return;
		scratch.sort((x, y) => x < y);
		// Nearest rank: the smallest offset with at least `jitterPercentile` of the window at or below it.
		let rank = math.ceil(t.jitterPercentile * m) - 1;
		if (rank < 0) rank = 0;
		if (rank > m - 1) rank = m - 1;
		const jitter = scratch[rank] - this.base;
		this.jitter = jitter > 0 ? jitter : 0;
		const depth = this.jitter / this.dt + t.marginTicks;
		this.targetDepth = math.clamp(depth, t.minDepthTicks, t.maxDepthTicks);
	}

	/** Moves P toward P* by at most share x frameDt (fast share while P is far past P*). */
	private slew(frameDt: number): void {
		const t = this.tunables;
		const target = this.targetOffset();
		const diff = target - this.offset;
		if (diff === 0) return;
		const share = -diff > t.fastSlewTicks * this.dt ? t.fastSlewShare : t.slewShare;
		const step = share * frameDt;
		if (diff > step) this.offset += step;
		else if (diff < -step) this.offset -= step;
		else this.offset = target;
	}
}
