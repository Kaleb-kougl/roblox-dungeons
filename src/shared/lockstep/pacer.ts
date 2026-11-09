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
 *                              around a hitch), slews P toward its target, and returns how many queued frames to step
 *                              now; holds (P moves forward, the views freeze) when a due frame has not arrived;
 *                              catches up at most `maxCatchup` per frame after a client hitch (P untouched); fast-forwards
 *                              (P reset near its target, the due frames at `maxCatchup` per frame) once P is more than
 *                              `fastForwardTicks` past it (a long hold: a server stall, a long network hiccup)
 *   alpha()                    the interpolation alpha, in [0, 1), once the caller stepped what frame() returned
 *   depthTicks()               the buffer depth the input lead adds (Design 5): whole ticks, with hysteresis, capped
 *   rawDepthTicks(), unsteady()  P - base in ticks, and "the last frame was hitched / catching up / fast-forwarding":
 *                              what LockstepClient records per sent input for its measured lead (Revision 2, Design 9)
 *
 * Target: base = the smallest offset over `floorWindowSec`; jitter = the `jitterPercentile` offset over
 * `jitterWindowSec` minus base; P* = base + clamp(jitter / dt + marginTicks, minDepthTicks, maxDepthTicks) x dt.
 * The slew aims at P* plus a phase shift of at most half a tick (+ hysteresis) that puts the playout position at the
 * rendered frames mid-tick (frac(pos) near 0.5), so frame-time jitter cannot flip frames between 0 and 2 ticks; only
 * while the frames keep a steady phase on the tick grid (render rates at or below about the sim rate).
 * Never extrapolates (FPD3): alpha stays below 1 and only ever lerps between two stepped ticks.
 *
 * A frame is hitched when its frameDt, or the clock elapsed since the last frame() (a stall inside the render step
 * before this call), is over `hitchFrameSec`. A hitched frame never moves P (no hold, no slew, no fast-forward) and only
 * steps what is due and queued, up to the cap; the arrivals pending at it, and at the frame right after it (handled
 * after the stall), are discarded: their timestamps carry the client's own stall, not the network's. Arrivals handled
 * while fast-forwarding count for base but not for the jitter (the burst behind the hold, not the network's jitter).
 */
import { SIM_DT, isFiniteNumber } from "shared/sim";
import { PACING, type PacingTunables } from "./config";

/** Absorbs float rounding so a frame on a tick boundary reliably counts that tick as due (as loop.ts). */
const EPSILON = 1e-9;
/** A hold leaves the playout position at least this far (ticks) below the next undelivered frame. */
const HOLD_GAP_TICKS = 1e-6;
/** Alpha is capped here (just below 1, and far enough that a hold's freeze never draws behind it). */
const ALPHA_MAX = 1 - HOLD_GAP_TICKS;
/** Mid-tick: the playout phase aimed for at the rendered frames, and how far behind the newest state a hold freezes. */
const MID_TICK = 0.5;
/** The phase spread before any frame was measured: unlocked (a uniform phase's mean distance is 0.25). */
const PHASE_SPREAD_UNLOCKED = 0.5;
/** At the first lock a phase this close below 1 counts as 0 (the tick boundary just passed, as `due`'s EPSILON). */
const PHASE_TIE = 1e-6;
const MS_PER_SEC = 1000;

export interface PacingStats {
	/** The first arrival placed the playout clock. */
	readonly started: boolean;
	/** depthTicks(): the lead's buffer depth (whole ticks, hysteresis, capped at maxDepthTicks). */
	readonly depthTicks: number;
	/** The buffer depth (P - base) in milliseconds, unrounded. */
	readonly depthMs: number;
	/** The target depth in ticks (fractional, clamped to [minDepthTicks, maxDepthTicks]), before the phase shift. */
	readonly targetTicks: number;
	/** The measured jitter: the percentile offset minus base, in milliseconds. */
	readonly jitterMs: number;
	/** Holds so far (one per contiguous run of held frames). */
	readonly holds: number;
	/** The last frame held (a due frame had not arrived). */
	readonly holding: boolean;
	/** The last frame was catching up (more due than it stepped, P untouched: a hitch or the cap). */
	readonly catchingUp: boolean;
	/** The last frame was fast-forwarding (P was reset toward its target after a long hold). */
	readonly fastForwarding: boolean;
	/** The last frame was hitched (its frameDt or the clock since the frame before over hitchFrameSec). */
	readonly hitched: boolean;
	/** Committed arrival offsets still inside a window. */
	readonly samples: number;
	/** Arrivals waiting for the next frame() (committed or discarded there). */
	readonly pending: number;
	/** Arrival offsets committed to the windows so far. */
	readonly committed: number;
	/** Arrival offsets discarded so far (they arrived around a hitch). */
	readonly discarded: number;
	/** The playout position (ticks) as of the last frame(). */
	readonly position: number;
	/** The smoothed playout phase at the rendered frames: frac(pos) for the current P, in [0, 1). */
	readonly phase: number;
	/** The frames keep a steady phase on the tick grid, so the phase shift is applied. */
	readonly phaseLocked: boolean;
	/** The phase shift added to P* (ticks; 0 while unlocked). */
	readonly phaseShiftTicks: number;
	/** The playout offset P (seconds, on the caller's clock). */
	readonly offsetSec: number;
	/** The target playout offset P* (seconds, before the phase shift). */
	readonly targetOffsetSec: number;
	/** The smallest offset over the floor window (seconds). */
	readonly baseSec: number;
}

function sanitizeCount(v: number): number {
	return isFiniteNumber(v) && v > 0 ? math.floor(v) : 0;
}

/** x mod 1, in [0, 1). */
function frac(x: number): number {
	return x - math.floor(x);
}

/** x wrapped to [-0.5, 0.5): the signed distance of a phase from 0 on the unit circle. */
function wrapHalf(x: number): number {
	return x - math.floor(x + MID_TICK);
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

	/** Committed samples, oldest first: the local time each arrived, its offset, and whether it counts for the jitter. */
	private readonly sampleAt: number[] = [];
	private readonly sampleOffset: number[] = [];
	private readonly sampleJitter: boolean[] = [];
	/** Arrivals since the last frame(), not yet committed. */
	private readonly pendingAt: number[] = [];
	private readonly pendingOffset: number[] = [];
	/** Scratch for the percentile (sorted copy of the jitter window). */
	private readonly scratch: number[] = [];

	private lastNow: number | undefined;
	private pos = 0;
	private lastAlpha = 0;
	/** What the views drew last frame: (ticks stepped - 1) + alpha. Never decreases. */
	private drawn = -math.huge;
	private holdCount = 0;
	private isHolding = false;
	private isCatchingUp = false;
	private isFastForward = false;
	/** P is being reset toward its target (entered past fastForwardTicks; left once at target + margin). */
	private fastForwarding = false;
	private isHitched = false;
	/** The frame before was hitched (this frame's arrivals were handled after the stall). */
	private wasHitched = false;
	private committedCount = 0;
	private discardedCount = 0;
	/** The lead's depth (depthTicks), updated at every frame(). */
	private leadDepth = 0;

	/** The smoothed phase of the frames on the tick grid, frac(now / dt), and its mean distance from the frames. */
	private phaseSeen = false;
	private framePhase = 0;
	private phaseSpread = PHASE_SPREAD_UNLOCKED;
	private phaseLocked = false;
	/** Ticks added to P* in the slew target (the mid-tick phase), 0 while unlocked. */
	private phaseShift = 0;

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

		// A long frame, or a stall inside the render step before this call (the clock moved on, frameDt did not).
		const hitched = delta > t.hitchFrameSec || elapsed > t.hitchFrameSec;
		this.takePending(!hitched && !this.wasHitched, !this.fastForwarding);
		this.wasHitched = hitched;
		this.isHitched = hitched;
		if (!this.started) {
			this.pos = 0;
			this.lastAlpha = 0;
			return 0;
		}
		this.expire(clock);
		if (this.targetDirty) this.retarget();
		if (!hitched) {
			this.trackPhase(clock);
			this.updatePhaseShift();
		}

		let pos = (clock - this.offset) / dt;
		let need = this.due(pos, done);
		let count: number;
		let hold = false;
		/** A fast-forward frame with a due frame missing: counted as held, P not moved. */
		let starved = false;
		this.isCatchingUp = false;
		this.isFastForward = false;
		if (hitched) {
			// Never moves P: what is due and queued, up to the cap; a missing frame waits for the next frame.
			count = math.min(need, inQueue, cap);
			this.isCatchingUp = need > count;
		} else {
			if (this.offset - this.targetOffset() > t.fastForwardTicks * dt) this.fastForwarding = true;
			if (this.fastForwarding) {
				// Back to the target plus a margin, but never past the newest queued frame (mid-tick before it): the
				// queued frames step at the cap per frame, a bounded fast-forward instead of a slew of seconds.
				const floor = this.slewTarget() + t.fastForwardMarginTicks * dt;
				const newest = clock - (done + inQueue - MID_TICK) * dt;
				const reset = math.max(floor, newest);
				if (reset < this.offset) this.offset = reset;
				if (this.offset <= floor) this.fastForwarding = false;
				pos = (clock - this.offset) / dt;
				need = this.due(pos, done);
				count = math.min(need, inQueue, cap);
				starved = need > inQueue;
				this.isFastForward = true;
			} else {
				hold = need > inQueue && inQueue < cap;
				if (hold) {
					count = inQueue;
				} else if (need > cap) {
					// Everything due is queued; step the cap and leave P alone.
					count = cap;
					this.isCatchingUp = true;
				} else {
					// Slewed by the frame's time, never more than the clock really moved (a playout rate on `now`).
					this.slew(math.min(delta, elapsed));
					pos = (clock - this.offset) / dt;
					need = this.due(pos, done);
					hold = need > inQueue && inQueue < cap;
					count = hold ? inQueue : math.min(need, inQueue, cap);
				}
			}
		}
		const after = done + count;
		if (hold) {
			// Freeze where the views already are (never backwards), at most half a tick behind the newest state, so
			// playout resumes mid-tick.
			pos = math.min(math.max(this.drawn, after - MID_TICK), after - HOLD_GAP_TICKS);
			this.offset = clock - pos * dt;
		}
		if ((hold || starved) && !this.isHolding) this.holdCount++;
		this.isHolding = hold || starved;
		this.pos = pos;
		const a = pos - (after - 1);
		this.lastAlpha = !(a > 0) ? 0 : a < ALPHA_MAX ? a : ALPHA_MAX;
		const drawn = after - 1 + this.lastAlpha;
		if (drawn > this.drawn) this.drawn = drawn;
		this.updateLeadDepth();
		return count;
	}

	/** After frame() (and after the caller stepped what it returned): interpolation alpha in [0, 1). */
	alpha(): number {
		return this.lastAlpha;
	}

	/**
	 * The buffer depth the input lead adds, in whole ticks (>= 0): it rises at once when the depth (P - base) passes it
	 * (so the inputs keep covering the buffer), falls only once the depth is `leadHysteresisTicks` at or below the next
	 * whole tick down (a depth hovering at a tick boundary never flickers the lead: each rise leaves a tick to
	 * repeat-last, each fall drops a sample), and never exceeds maxDepthTicks (so lead + depth stays inside the relay's window,
	 * MAX_INPUT_AHEAD_TICKS, even while P is far past its target).
	 */
	depthTicks(): number {
		return this.started ? this.leadDepth : 0;
	}

	/**
	 * The raw buffer depth P - base in ticks (0 before the first arrival): what a sent input's trip excludes
	 * (docs/FRAME_PACING.md Design 9; stats().depthMs in ticks, without allocating).
	 */
	rawDepthTicks(): number {
		return this.started ? (this.offset - this.base) / this.dt : 0;
	}

	/**
	 * The last frame() was not a steady playout frame: hitched, catching up or fast-forwarding (stats().hitched /
	 * catchingUp / fastForwarding). Inputs sent in it carry the client's own stall, not the network's (Design 9).
	 */
	unsteady(): boolean {
		return this.isHitched || this.isCatchingUp || this.isFastForward;
	}

	/** The target playout offset P* (seconds, before the phase shift). */
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
			fastForwarding: this.isFastForward,
			hitched: this.isHitched,
			samples: this.sampleAt.size(),
			pending: this.pendingAt.size(),
			committed: this.committedCount,
			discarded: this.discardedCount,
			position: this.pos,
			phase: frac(this.framePhase - this.offset / this.dt),
			phaseLocked: this.phaseLocked,
			phaseShiftTicks: this.phaseShift,
			offsetSec: this.offset,
			targetOffsetSec: this.targetOffset(),
			baseSec: this.base,
		};
	}

	/** What the slew aims at: P* plus the phase shift. */
	private slewTarget(): number {
		return this.targetOffset() + this.phaseShift * this.dt;
	}

	/** Frames due and not yet stepped: frame k is due once pos >= k. */
	private due(pos: number, stepped: number): number {
		const n = math.floor(pos + EPSILON) + 1 - stepped;
		return n > 0 ? n : 0;
	}

	/**
	 * Commits (or, around a hitch, discards) the pending arrivals; the first-ever one starts the clock. While
	 * fast-forwarding they count for base but not for the jitter: they are the burst behind a long hold (a server
	 * catching up), whose lateness the jitter window would otherwise take as the network's for its whole length.
	 */
	private takePending(commit: boolean, jitter: boolean): void {
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
				this.sampleJitter.push(jitter);
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
			this.sampleJitter.remove(0);
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
			if (at >= jitterFrom && this.sampleJitter[i]) scratch.push(o);
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

	/**
	 * The frames' phase on the tick grid, frac(now / dt), smoothed on the unit circle, and its spread (the mean distance
	 * of each frame from it). Frames at or below about the sim rate keep a steady phase (spread ~ the frame-time jitter);
	 * faster or uneven rates walk round the circle (spread ~0.25) and leave the phase unlocked.
	 */
	private trackPhase(clock: number): void {
		const t = this.tunables;
		const phi = frac(clock / this.dt);
		if (!this.phaseSeen) {
			this.phaseSeen = true;
			this.framePhase = phi;
			return;
		}
		const r = wrapHalf(phi - this.framePhase);
		this.phaseSpread += t.phaseSmoothing * (math.abs(r) - this.phaseSpread);
		this.framePhase = frac(this.framePhase + t.phaseSmoothing * r);
	}

	/**
	 * The phase shift (ticks) that puts frac(pos) at the frames mid-tick were P at P* + shift: frac at P* minus 0.5. It
	 * sticks to the nearest equivalent of the last shift while that stays within 0.5 + phaseHysteresisTicks, so a P*
	 * wobbling across a tick boundary does not flip the target by a whole tick. 0 while unlocked.
	 */
	private updatePhaseShift(): void {
		const t = this.tunables;
		if (!(this.phaseSpread < t.phaseLockSpread)) {
			this.phaseLocked = false;
			this.phaseShift = 0;
			return;
		}
		let x = frac(this.framePhase - this.targetOffset() / this.dt);
		const c = x - MID_TICK;
		if (this.phaseLocked) {
			const near = c + math.floor(this.phaseShift - c + MID_TICK);
			this.phaseShift = math.abs(near) <= MID_TICK + t.phaseHysteresisTicks ? near : c;
		} else {
			if (x > 1 - PHASE_TIE) x -= 1;
			this.phaseShift = x - MID_TICK;
		}
		this.phaseLocked = true;
	}

	/** The lead's depth after this frame (see depthTicks). */
	private updateLeadDepth(): void {
		const t = this.tunables;
		const raw = (this.offset - this.base) / this.dt;
		const up = math.ceil(raw - EPSILON);
		// Falls only to ceil(raw + hysteresis): once raw is at or below the next whole tick down minus the hysteresis.
		const down = math.ceil(raw + t.leadHysteresisTicks - EPSILON);
		let d = this.leadDepth;
		if (up > d) d = up;
		else if (down < d) d = down;
		this.leadDepth = d < 0 ? 0 : d > t.maxDepthTicks ? t.maxDepthTicks : d;
	}

	/** Moves P toward the slew target by at most share x frameDt (fast share while P is far past it). */
	private slew(frameDt: number): void {
		const t = this.tunables;
		const target = this.slewTarget();
		const diff = target - this.offset;
		if (diff === 0) return;
		const share = -diff > t.fastSlewTicks * this.dt ? t.fastSlewShare : t.slewShare;
		const step = share * frameDt;
		if (diff > step) this.offset += step;
		else if (diff < -step) this.offset -= step;
		else this.offset = target;
	}
}
