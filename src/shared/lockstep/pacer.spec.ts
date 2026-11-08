// Co-op frame pacing (docs/FRAME_PACING.md FP2): the PlayoutPacer on synthetic arrival traces. Steady arrivals step
// one tick per 16.7 ms of local time at any render rate with alpha moving smoothly through [0, 1); a late batch is
// one hold (the views freeze, then playout resumes); the depth follows the 95th percentile of the arrival offsets, not
// a single outlier; the playout clock slews within its share of real time; a client hitch (a long frame, or a stall
// inside the render step seen only in the clock) catches up at maxCatchup per frame without moving the clock, and its
// arrivals never reach the windows; a server stall's long hold is fast-forwarded back to the target within about a
// second, the lead's depth capped; frame-time jitter cannot flip frames between 0 and 2 ticks (the phase is kept
// mid-tick); the lead's depth does not flicker with a depth hovering at a tick boundary.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Rng, SIM_DT, SIM_HZ } from "shared/sim";
import {
	BROADCAST_EVERY_TICKS,
	DEFAULT_LOCKSTEP,
	MAX_SERVER_TICKS_PER_STEP,
	PACING,
	PlayoutPacer,
	type PacingStats,
	type PacingTunables,
} from "shared/lockstep";

const MAX_CATCHUP = 8;
/** Every trace's base one-way latency (seconds). */
const LATENCY = 0.04;
/** Render frames start off the tick grid, as a real client's clock does. */
const PHASE = 0.0037;

interface Batch {
	readonly at: number;
	readonly newest: number;
	readonly count: number;
}

/**
 * The server's 2-tick batches: batch j carries ticks 2j and 2j + 1 and leaves once tick 2j + 1 is final, at
 * (2j + 2) x dt; it arrives `latency(j)` later. Ordered (a reliable remote): never before the batch ahead of it.
 */
function trace(seconds: number, latency: (j: number, rng: Rng) => number, ordered: boolean, seed = 1): Batch[] {
	const rng = new Rng(seed);
	const out: Batch[] = [];
	let latest = -math.huge;
	const n = math.floor((seconds * SIM_HZ) / 2);
	for (let j = 0; j < n; j++) {
		const newest = 2 * j + 1;
		let at = (newest + 1) * SIM_DT + latency(j, rng);
		if (ordered && at < latest) at = latest;
		if (at > latest) latest = at;
		out.push({ at, newest, count: 2 });
	}
	if (!ordered) out.sort((a, b) => a.at < b.at);
	return out;
}

const steadyLatency = () => LATENCY;

interface FrameRecord {
	readonly now: number;
	readonly dt: number;
	/** Arrivals handed to the pacer this frame. */
	readonly arrivals: number;
	readonly queued: number;
	readonly ret: number;
	/** Frames stepped after this one. */
	readonly stepped: number;
	readonly alpha: number;
	/** Where the views draw: (frames stepped - 1) + alpha, in ticks. */
	readonly drawn: number;
	readonly stats: PacingStats;
}

interface SimOptions {
	readonly fps: number;
	readonly seconds: number;
	/** One frame of `hitchSec` at the first frame on or after this time. */
	readonly hitchAt?: number;
	readonly hitchSec?: number;
	/**
	 * A stall of `stallSec` inside the render step at the first frame on or after this time, before frame() (a floor
	 * change's deferred work): the clock jumps, frameDt stays normal. Batches that arrived by the stall's start are
	 * handed over before it; those that arrived during it are handed over (and stamped) at the next frame.
	 */
	readonly stallAt?: number;
	readonly stallSec?: number;
	/** Each frame's time is off its grid time by up to +/- this (seconds; frameDt = the real difference). */
	readonly frameJitterSec?: number;
	/**
	 * Arrivals are handled (and stamped) this long after the previous frame, +/- handlerJitterSec, then stepped at the
	 * next frame; undefined: handled and stamped at the frame itself.
	 */
	readonly handlerDelaySec?: number;
	readonly handlerJitterSec?: number;
	/** The jitter generator's seed (deterministic). */
	readonly seed?: number;
}

/** Renders frames at `fps`, delivering every batch that arrived by each frame's clock, and steps what frame() says. */
function simulate(batches: Batch[], opts: SimOptions, pacer = new PlayoutPacer()): FrameRecord[] {
	const records: FrameRecord[] = [];
	const got = new Set<number>();
	const rng = new Rng(opts.seed ?? 1);
	const jitter = (amp: number | undefined) => (amp === undefined ? 0 : amp * (2 * rng.next() - 1));
	const jittered = opts.frameJitterSec !== undefined;
	let grid = PHASE;
	let prevNow = PHASE;
	let nextBatch = 0;
	let received = 0;
	let stepped = 0;
	let hitched = false;
	let stalled = false;
	const frameDt = 1 / opts.fps;
	const deliver = (by: number, stamp: number) => {
		let n = 0;
		while (nextBatch < batches.size() && batches[nextBatch].at <= by) {
			const b = batches[nextBatch];
			nextBatch++;
			n++;
			pacer.arrived(stamp, b.newest);
			for (let k = b.newest - b.count + 1; k <= b.newest; k++) got.add(k);
		}
		return n;
	};
	while (grid < opts.seconds) {
		let step = frameDt;
		if (!hitched && opts.hitchAt !== undefined && grid >= opts.hitchAt) {
			step = opts.hitchSec ?? frameDt;
			hitched = true;
		}
		grid += step;
		let now = grid + jitter(opts.frameJitterSec);
		if (now < prevNow) now = prevNow;
		const dt = jittered ? now - prevNow : step;
		let arrivals: number;
		if (opts.handlerDelaySec !== undefined) {
			const at = math.min(prevNow + opts.handlerDelaySec + jitter(opts.handlerJitterSec), now);
			arrivals = deliver(at, at);
		} else {
			arrivals = deliver(now, now);
		}
		if (!stalled && opts.stallAt !== undefined && grid >= opts.stallAt) {
			stalled = true;
			grid += opts.stallSec ?? 0;
			now += opts.stallSec ?? 0;
		}
		while (got.has(received)) received++;
		const queued = received - stepped;
		const ret = pacer.frame(now, dt, stepped, queued, MAX_CATCHUP);
		stepped += ret;
		const alpha = pacer.alpha();
		records.push({
			now,
			dt,
			arrivals,
			queued,
			ret,
			stepped,
			alpha,
			drawn: stepped - 1 + alpha,
			stats: pacer.stats(),
		});
		prevNow = now;
	}
	return records;
}

/**
 * The server's own cadence (session.ts): a step every SIM_DT finalizes the ticks real time has reached, at most
 * MAX_SERVER_TICKS_PER_STEP, and broadcasts once BROADCAST_EVERY_TICKS wait; no step at all for `stallSec` from
 * `stallAt` (a server hitch), after which it catches up at the cap. Each batch arrives `latency` later.
 */
function serverTrace(seconds: number, latency: number, stallAt: number, stallSec: number): Batch[] {
	const out: Batch[] = [];
	let finalized = 0;
	let unsent = 0;
	const steps = math.floor(seconds * SIM_HZ);
	for (let k = 1; k <= steps; k++) {
		const t = k * SIM_DT;
		if (t >= stallAt && t < stallAt + stallSec) continue;
		const n = math.min(k - finalized, MAX_SERVER_TICKS_PER_STEP);
		finalized += n;
		unsent += n;
		if (unsent >= BROADCAST_EVERY_TICKS) {
			out.push({ at: t + latency, newest: finalized - 1, count: unsent });
			unsent = 0;
		}
	}
	return out;
}

/** Share of `records` that stepped exactly one tick. */
function oneTickShare(records: FrameRecord[]): number {
	let one = 0;
	for (const r of records) if (r.ret === 1) one++;
	return records.size() > 0 ? one / records.size() : 0;
}

/**
 * The lead's depth covers the buffer: at least the depth rounded up, at most one hysteresis above it (a depth sitting on
 * a whole tick, as at 144 fps where no phase shift applies, keeps the lead one tick up rather than flicker).
 */
function expectLeadCovers(s: PacingStats): void {
	const raw = s.depthMs / 1000 / SIM_DT;
	expect(s.depthTicks >= math.ceil(raw - 1e-9)).toBe(true);
	expect(s.depthTicks <= math.ceil(raw + PACING.leadHysteresisTicks)).toBe(true);
}

/** The views never draw backwards: `drawn` never decreases from one frame to the next (after the start). */
function expectDrawnNeverDecreases(records: FrameRecord[]): void {
	let last = -math.huge;
	for (const r of records) {
		if (!r.stats.started) continue;
		expect(r.alpha >= 0 && r.alpha < 1).toBe(true);
		expect(r.drawn >= last).toBe(true);
		last = r.drawn;
	}
}

function after(records: FrameRecord[], t: number): FrameRecord[] {
	const out: FrameRecord[] = [];
	for (const r of records) if (r.now >= t) out.push(r);
	return out;
}

function maxOf(records: FrameRecord[], read: (r: FrameRecord) => number): number {
	let m = -math.huge;
	for (const r of records) m = math.max(m, read(r));
	return m;
}

describe("PlayoutPacer: steady arrivals", () => {
	const batches = trace(21, steadyLatency, true);
	const WARM = 2;
	const END = 20;

	for (const [fps, perFrame] of [
		[30, 2],
		[60, 1],
		[144, -1],
	] as const) {
		it(`steps one tick per 16.7 ms at ${fps} fps`, () => {
			const records = simulate(batches, { fps, seconds: END });
			const warm = after(records, WARM);
			for (const r of warm) {
				if (perFrame > 0) expect(r.ret).toBe(perFrame);
				else expect(r.ret === 0 || r.ret === 1).toBe(true);
			}
			const first = warm[0];
			const last = warm[warm.size() - 1];
			const ticks = last.stepped - first.stepped;
			const elapsed = (last.now - first.now) / SIM_DT;
			expect(math.abs(ticks - elapsed) <= 1).toBe(true);
			expect(last.stats.holds).toBe(0);
			expectLeadCovers(last.stats);
		});

		it(`keeps alpha in [0, 1) at ${fps} fps`, () => {
			for (const r of simulate(batches, { fps, seconds: 6 })) {
				expect(r.alpha >= 0 && r.alpha < 1).toBe(true);
			}
		});
	}

	it("raises alpha strictly within a tick at 144 fps (and wraps when a tick is stepped)", () => {
		const warm = after(simulate(batches, { fps: 144, seconds: 8 }), WARM);
		let rising = 0;
		for (let i = 1; i < warm.size(); i++) {
			const prev = warm[i - 1];
			const r = warm[i];
			if (r.ret === 0) {
				expect(r.alpha > prev.alpha).toBe(true);
				rising++;
			} else {
				expect(r.alpha < prev.alpha).toBe(true);
			}
		}
		expect(rising > warm.size() / 2).toBe(true);
	});

	it("starts at the minimum depth of 3 ticks and stays there on perfectly steady arrivals", () => {
		const pacer = new PlayoutPacer();
		const records = simulate(batches, { fps: 60, seconds: 15 }, pacer);
		for (const r of after(records, 0.2)) {
			expect(r.stats.targetTicks).toBe(PACING.minDepthTicks);
			expect(r.stats.depthTicks).toBe(PACING.minDepthTicks);
		}
		expect(pacer.depthTicks()).toBe(3);
		// The buffer is the 3 ticks plus the phase shift that puts the frames mid-tick (at most half a tick).
		const s = pacer.stats();
		expect(s.phaseLocked).toBe(true);
		expect(math.abs(s.phaseShiftTicks) <= 0.5).toBe(true);
		expect(s.depthMs).toBeCloseTo((3 + s.phaseShiftTicks) * SIM_DT * 1000, 6);
		expect(s.jitterMs).toBeCloseTo(0, 6);
	});
});

describe("PlayoutPacer: start and inputs", () => {
	it("steps nothing before the first arrival, then places the clock startDepthTicks behind it", () => {
		const pacer = new PlayoutPacer();
		expect(pacer.frame(1, SIM_DT, 0, 0, MAX_CATCHUP)).toBe(0);
		expect(pacer.alpha()).toBe(0);
		expect(pacer.depthTicks()).toBe(0);
		expect(pacer.stats().started).toBe(false);
		// Ticks 0-1 arrive at t = 2 (offset 2 - 1 x dt); frame 0 is due at offset + 3 dt = 2 + 2 dt.
		pacer.arrived(2, 1);
		expect(pacer.frame(2, SIM_DT, 0, 2, MAX_CATCHUP)).toBe(0);
		expect(pacer.stats().started).toBe(true);
		expect(pacer.depthTicks()).toBe(PACING.startDepthTicks);
		expect(pacer.frame(2 + 2 * SIM_DT + 1e-6, SIM_DT, 0, 2, MAX_CATCHUP)).toBe(1);
		expect(pacer.alpha()).toBeCloseTo(1e-6 / SIM_DT, 6);
	});

	it("starts from the first arrival even in a hitched frame, but does not commit it", () => {
		const pacer = new PlayoutPacer();
		pacer.arrived(2, 1);
		pacer.frame(2, 0.5, 0, 2, MAX_CATCHUP);
		const s = pacer.stats();
		expect(s.started).toBe(true);
		expect(s.committed).toBe(0);
		expect(s.discarded).toBe(1);
		expect(s.samples).toBe(0);
		expect(pacer.depthTicks()).toBe(PACING.startDepthTicks);
	});

	it("ignores non-finite and negative inputs", () => {
		// No fast-forward here: the frame after the held clock steps exactly what is due, as without one.
		const pacer = new PlayoutPacer({ ...PACING, fastForwardTicks: math.huge });
		pacer.arrived(0 / 0, 1);
		pacer.arrived(1, math.huge);
		expect(pacer.frame(1, SIM_DT, 0, 0, MAX_CATCHUP)).toBe(0);
		expect(pacer.stats().started).toBe(false);
		const fresh = new PlayoutPacer();
		fresh.arrived(1, 1);
		expect(fresh.frame(0 / 0, -1, -3, -2, 0 / 0)).toBe(0); // no clock yet: nothing, the arrival stays pending
		expect(fresh.stats().started).toBe(false);
		expect(fresh.frame(1, 0 / 0, 0, 2, MAX_CATCHUP)).toBe(0);
		expect(fresh.stats().started).toBe(true);
		expect(fresh.stats().committed).toBe(1);
		pacer.arrived(1, 1);
		expect(pacer.frame(1, 0 / 0, 0, 2, MAX_CATCHUP)).toBe(0);
		expect(pacer.stats().started).toBe(true);
		// A clock that goes back is held; a NaN one keeps the last.
		expect(pacer.frame(5, SIM_DT, 0, 2, -MAX_CATCHUP)).toBe(0);
		expect(pacer.frame(0 / 0, SIM_DT, 0, 0 / 0, MAX_CATCHUP)).toBe(0); // due, nothing queued: a hold
		expect(pacer.stats().holds).toBe(1);
		expect(pacer.frame(4, SIM_DT, 0, 2, MAX_CATCHUP)).toBe(0); // held at 5: still just before frame 0
		expect(pacer.frame(5 + 1.5 * SIM_DT, SIM_DT, 0, 2, MAX_CATCHUP)).toBe(2);
		const a = pacer.alpha();
		expect(a >= 0 && a < 1).toBe(true);
	});
});

describe("PlayoutPacer: holds", () => {
	const LATE_BATCH = 150;
	const batches = trace(21, (j) => (j === LATE_BATCH ? LATENCY + 0.15 : LATENCY), true);

	it("makes exactly one hold for one late batch, freezes where the views are, then resumes pacing mid-tick", () => {
		const records = simulate(batches, { fps: 60, seconds: 20 });
		const last = records[records.size() - 1];
		expect(last.stats.holds).toBe(1);
		let held = 0;
		let deepest = 0;
		let resumed: FrameRecord | undefined;
		for (let i = 0; i < records.size(); i++) {
			const r = records[i];
			expect(r.ret <= 2).toBe(true); // never a jump: at most the 10 % fast slew's extra tick
			if (r.stats.holding) {
				held++;
				// Frozen: the views stand still (never backwards), at most half a tick behind the newest state.
				const prev = records[i - 1];
				if (prev.stats.holding && r.ret === 0) expect(r.drawn).toBe(prev.drawn);
				expect(r.drawn >= prev.drawn).toBe(true);
				expect(r.alpha >= 0.5 - 1e-9 && r.alpha < 1).toBe(true);
			} else if (resumed === undefined && i > 0 && records[i - 1].stats.holding) {
				resumed = r;
			}
			deepest = math.max(deepest, r.stats.depthTicks);
		}
		expect(held > 3).toBe(true); // ~117 ms past the buffer
		// Playout resumes mid-tick (the frames were mid-tick when it froze), not on a tick boundary: off by at most the
		// first resumed frame's slew (the fast one: P is now well past its target).
		expect(resumed).never.toBe(undefined);
		expect(resumed!.ret).toBe(1);
		expect(math.abs(resumed!.alpha - 0.5) <= PACING.fastSlewShare + 1e-6).toBe(true);
		expectDrawnNeverDecreases(records);
		expect(deepest > PACING.minDepthTicks).toBe(true); // the hold deepened the buffer (the lead follows it)
		for (const r of after(records, 15)) {
			expect(r.ret).toBe(1);
			expect(r.stats.holding).toBe(false);
			expect(r.stats.depthTicks).toBe(PACING.minDepthTicks);
		}
	});
});

describe("PlayoutPacer: depth", () => {
	it("is not raised by a single 300 ms outlier among 20 ms arrivals", () => {
		const base = 0.02;
		const batches = trace(16, (j) => (j === 200 ? 0.3 : base), false);
		const records = simulate(batches, { fps: 60, seconds: 15 });
		expect(maxOf(records, (r) => r.stats.targetTicks)).toBe(PACING.minDepthTicks);
		const last = records[records.size() - 1];
		expect(last.stats.holds).toBe(1);
		expect(last.stats.depthTicks).toBe(PACING.minDepthTicks);
	});

	it("follows the percentile when the outlier holds back the batches behind it (ordered delivery)", () => {
		const batches = trace(16, (j) => (j === 200 ? 0.3 : 0.02), true);
		const records = simulate(batches, { fps: 60, seconds: 15 });
		const highest = maxOf(records, (r) => r.stats.targetTicks);
		// Nine stacked samples (280, 247, ... 13 ms) among 120: the 95th is the 7th highest, ~80 ms (5.3 ticks).
		expect(highest < 0.3 / SIM_DT).toBe(true);
		expect(highest <= 7).toBe(true);
		expect(records[records.size() - 1].stats.targetTicks).toBe(PACING.minDepthTicks);
	});

	it("rises to about 100 ms / dt + margin under sustained 0-100 ms jitter", () => {
		const batches = trace(16, (_j, rng) => 0.02 + 0.1 * rng.next(), true, 7);
		const records = simulate(batches, { fps: 60, seconds: 15 });
		const target = records[records.size() - 1].stats.targetTicks;
		const expected = 0.1 / SIM_DT + PACING.marginTicks; // 6.5
		expect(target > expected - 1.5 && target < expected + 1.5).toBe(true);
		const jitter = records[records.size() - 1].stats.jitterMs;
		expect(jitter > 70 && jitter < 125).toBe(true);
	});

	it("is clamped to maxDepthTicks under 0-300 ms jitter", () => {
		const batches = trace(16, (_j, rng) => 0.02 + 0.3 * rng.next(), true, 11);
		const records = simulate(batches, { fps: 60, seconds: 15 });
		expect(records[records.size() - 1].stats.targetTicks).toBe(PACING.maxDepthTicks);
		expect(maxOf(records, (r) => r.stats.targetTicks)).toBe(PACING.maxDepthTicks);
	});
});

/** A late batch whose hold leaves P between fastSlewTicks and fastForwardTicks past a ~6.5-tick target. */
const LONG_HOLD_LATENCY = 0.27;

describe("PlayoutPacer: slew", () => {
	it("runs the playout clock within 1 +/- slewShare, or fastSlewShare while far past its target", () => {
		// 6 s steady, then 0-100 ms jitter (the target rises), then a 600 ms late batch (a long hold, far past it).
		// The late batch's hold leaves P 6-12 ticks past its target (fast slew); past fastForwardTicks it would reset.
		const batches = trace(
			21,
			(j, rng) => (j < 180 ? 0.02 : j === 450 ? LONG_HOLD_LATENCY : 0.02 + 0.1 * rng.next()),
			true,
			3,
		);
		const records = simulate(batches, { fps: 60, seconds: 20 });
		let slow = 0;
		let fast = 0;
		const tol = 1e-9;
		for (let i = 1; i < records.size(); i++) {
			const prev = records[i - 1];
			const r = records[i];
			if (!prev.stats.started || r.stats.holding || r.stats.catchingUp || r.stats.fastForwarding) continue;
			const rate = (r.stats.position - prev.stats.position) / (r.dt / SIM_DT);
			const far = prev.stats.offsetSec - r.stats.targetOffsetSec > PACING.fastSlewTicks * SIM_DT;
			const share = far ? PACING.fastSlewShare : PACING.slewShare;
			expect(math.abs(rate - 1) <= share + tol).toBe(true);
			if (math.abs(math.abs(rate - 1) - PACING.slewShare) < 1e-6) slow++;
			if (math.abs(math.abs(rate - 1) - PACING.fastSlewShare) < 1e-6) fast++;
		}
		for (const r of records) expect(r.stats.fastForwarding).toBe(false);
		// Not vacuous: both slews ran for a while.
		expect(slow > 30).toBe(true);
		expect(fast > 10).toBe(true);
		expect(records[records.size() - 1].stats.holds >= 1).toBe(true);
	});
});

describe("PlayoutPacer: client hitch", () => {
	it("catches up at maxCatchup per frame after a 0.5 s frame without moving P, and drops its arrivals", () => {
		const batches = trace(12, steadyLatency, true);
		const records = simulate(batches, { fps: 60, seconds: 10, hitchAt: 5, hitchSec: 0.5 });
		let h = 0;
		while (records[h].dt !== 0.5) h++;
		const before = records[h - 1];
		const hitch = records[h];
		// Its arrivals (~15 batches) are discarded, none committed.
		expect(hitch.arrivals > 10).toBe(true);
		expect(hitch.stats.discarded - before.stats.discarded).toBe(hitch.arrivals);
		expect(hitch.stats.committed).toBe(before.stats.committed);
		expect(hitch.stats.targetTicks).toBe(before.stats.targetTicks);
		// Catch-up: maxCatchup a frame, P untouched, never a hold.
		expect(hitch.ret).toBe(MAX_CATCHUP);
		let i = h;
		while (records[i].stats.catchingUp) {
			expect(records[i].ret).toBe(MAX_CATCHUP);
			expect(records[i].alpha < 1).toBe(true);
			i++;
		}
		expect(i - h >= 3).toBe(true); // ~31 ticks due at 8 a frame
		for (let k = h; k <= i + 2; k++) {
			expect(records[k].stats.offsetSec).toBeCloseTo(before.stats.offsetSec, 10);
			expect(records[k].stats.holding).toBe(false);
		}
		// Back on schedule within a frame or two; one tick a frame after it.
		for (const r of after(records, hitch.now + 0.1)) expect(r.ret).toBe(1);
		const last = records[records.size() - 1];
		expect(last.stats.holds).toBe(0);
		expect(last.stats.depthTicks).toBe(PACING.minDepthTicks);
		expect(math.abs(last.stepped - (last.now - before.now) / SIM_DT - before.stepped) <= 1).toBe(true);
	});
});

/** A time just before a frame's grid time (the frame is the first on or after it). */
const EARLY = 1e-9;

describe("PlayoutPacer: a stall inside the render step (the clock jumps, frameDt does not)", () => {
	const STALL_FROM = 5;
	const STALL_SEC = 0.5;
	const batches = trace(12, steadyLatency, true);
	// The stall hits a frame that hands over a batch before it (batches come every other frame at 60 fps).
	let stallAt = 0;
	for (const r of simulate(batches, { fps: 60, seconds: STALL_FROM + 1 })) {
		if (r.now >= STALL_FROM && r.arrivals > 0) {
			stallAt = r.now - EARLY;
			break;
		}
	}
	const records = simulate(batches, { fps: 60, seconds: 10, stallAt, stallSec: STALL_SEC });
	let h = 0;
	while (!records[h].stats.hitched) h++;
	const before = records[h - 1];
	const stall = records[h];
	const following = records[h + 1];

	it("is a hitch: P stays, nothing is held, and its arrivals and the next frame's are discarded", () => {
		expect(stall.dt).toBe(1 / 60); // frameDt is normal: only the clock moved on
		expect(stall.now - before.now > STALL_SEC).toBe(true);
		expect(stall.arrivals > 0).toBe(true); // handed over before the stall (correctly stamped, still dropped)
		expect(following.arrivals > 10).toBe(true); // arrived during the stall, stamped after it
		expect(following.stats.hitched).toBe(false);
		expect(following.stats.discarded - before.stats.discarded).toBe(stall.arrivals + following.arrivals);
		expect(following.stats.committed).toBe(before.stats.committed);
		expect(following.stats.targetTicks).toBe(before.stats.targetTicks);
		expect(stall.stats.holding).toBe(false);
		expect(stall.stats.holds).toBe(0);
		// What was queued steps; the frames that arrived during the stall wait for the next frame.
		expect(stall.ret).toBe(stall.queued);
		expect(stall.stats.offsetSec).toBe(before.stats.offsetSec);
	});

	it("then catches up at maxCatchup per frame with P untouched, and paces one tick a frame after", () => {
		let i = h + 1;
		expect(records[i].stats.catchingUp).toBe(true);
		while (records[i].stats.catchingUp) {
			expect(records[i].ret).toBe(MAX_CATCHUP);
			i++;
		}
		expect(i - h >= 3).toBe(true); // ~30 ticks due at 8 a frame
		for (let k = h; k <= i + 2; k++) {
			expect(records[k].stats.offsetSec).toBeCloseTo(before.stats.offsetSec, 10);
			expect(records[k].stats.holding).toBe(false);
		}
		for (const r of after(records, stall.now + 0.1)) expect(r.ret).toBe(1);
		const last = records[records.size() - 1];
		expect(last.stats.holds).toBe(0);
		expect(last.stats.depthTicks).toBe(PACING.minDepthTicks);
		// No delay was added: the playout is where it would have been without the stall.
		expect(math.abs(last.stepped - (last.now - before.now) / SIM_DT - before.stepped) <= 1).toBe(true);
		expectDrawnNeverDecreases(records);
	});
});

describe("PlayoutPacer: a server stall (a long hold is fast-forwarded, not slewed)", () => {
	const STALL_AT = 5;
	const STALL_SEC = 3;
	/** Within this long after the first arrival after the stall the depth is back near its target. */
	const RECOVER_SEC = 1;
	/** "Near": within this many ticks of the slew target (P* + the phase shift). */
	const NEAR_TICKS = 0.5;
	const batches = serverTrace(16, LATENCY, STALL_AT, STALL_SEC);
	const records = simulate(batches, { fps: 60, seconds: 15 });
	let resume = 0;
	while (records[resume].now < STALL_AT + STALL_SEC || records[resume].arrivals === 0) resume++;
	const resumedAt = records[resume].now;
	const depthOff = (r: FrameRecord) =>
		r.stats.depthMs / 1000 / SIM_DT - (r.stats.targetTicks + r.stats.phaseShiftTicks);
	print(
		`[pacer server stall] resume at ${string.format("%.2f", resumedAt)} s; depth off target ` +
			`${string.format("%.2f", depthOff(records[resume]))} ticks then, ` +
			`${string.format("%.2f", depthOff(after(records, resumedAt + RECOVER_SEC)[0]))} after ${RECOVER_SEC} s`,
	);

	it("holds through the stall, then fast-forwards at most maxCatchup a frame back to the target within ~1 s", () => {
		let ff = 0;
		for (const r of records) {
			expect(r.ret <= MAX_CATCHUP).toBe(true);
			if (r.stats.fastForwarding) ff++;
		}
		expect(ff > 0).toBe(true);
		for (const r of after(records, resumedAt + RECOVER_SEC)) {
			expect(r.stats.fastForwarding).toBe(false);
			expect(math.abs(depthOff(r)) <= NEAR_TICKS + PACING.fastForwardMarginTicks).toBe(true);
		}
		const last = records[records.size() - 1];
		expect(math.abs(depthOff(last)) < NEAR_TICKS).toBe(true);
		expect(last.stats.holds).toBe(1);
		for (const r of after(records, resumedAt + 2 * RECOVER_SEC)) expect(r.ret).toBe(1);
		expectDrawnNeverDecreases(records);
	});

	it("never lets the lead's depth past maxDepthTicks, so lead + depth stays inside the relay's window", () => {
		let deepest = 0;
		for (const r of records) {
			expect(r.stats.depthTicks <= PACING.maxDepthTicks).toBe(true);
			deepest = math.max(deepest, r.stats.depthTicks);
		}
		expect(deepest).toBe(PACING.maxDepthTicks); // the stall really pushed P far past its target
		expect(DEFAULT_LOCKSTEP.maxInputLead + PACING.maxDepthTicks <= DEFAULT_LOCKSTEP.maxInputAhead).toBe(true);
	});
});

describe("PlayoutPacer: phase (frame-time jitter)", () => {
	/** +/- 1 ms on every frame time and every arrival's stamp. */
	const JITTER = 0.001;
	/**
	 * Arrivals are handled 2 ms after the previous frame: their stamps' earliest phase sits within a jitter of the frames'
	 * own, so without the phase shift frac(pos) straddles the tick boundary (the worst case).
	 */
	const HANDLER_DELAY = 0.002;
	/**
	 * Batches arrive well before the handler (0.85 tick past the grid, the handler at ~0.34): every stamp is the
	 * handler's time, not the arrival's.
	 */
	const ARRIVAL_LATENCY = 0.0475;
	const WARM = 2;
	const SECONDS = 20;
	const ONE_TICK_SHARE = 0.99;
	/** The settled phase is within this of mid-tick. */
	const PHASE_TOL = 0.1;
	const batches = trace(SECONDS + 1, () => ARRIVAL_LATENCY, true);
	const opts: SimOptions = {
		fps: 60,
		seconds: SECONDS,
		frameJitterSec: JITTER,
		handlerDelaySec: HANDLER_DELAY,
		handlerJitterSec: JITTER,
		seed: 5,
	};
	const records = simulate(batches, opts);
	const warm = after(records, WARM);
	const unshifted: PacingTunables = { ...PACING, phaseLockSpread: 0 };
	const plain = after(simulate(batches, opts, new PlayoutPacer(unshifted)), WARM);
	print(
		`[pacer phase] one tick ${string.format("%.1f", oneTickShare(warm) * 100)} % of ${warm.size()} frames; ` +
			`phase ${string.format("%.2f", records[records.size() - 1].stats.phase)}; ` +
			`without the shift ${string.format("%.1f", oneTickShare(plain) * 100)} %`,
	);

	it("at 60 fps with +/- 1 ms frame and stamp jitter, >= 99 % of frames after the warm-up step exactly one tick", () => {
		expect(oneTickShare(warm) >= ONE_TICK_SHARE).toBe(true);
		// Not vacuous: without the phase shift the same frames flip between 0 and 2 ticks.
		expect(oneTickShare(plain) < ONE_TICK_SHARE).toBe(true);
		expect(warm[warm.size() - 1].stats.holds).toBe(0);
	});

	it("settles the playout phase at the frames near mid-tick", () => {
		for (const r of warm) {
			expect(r.stats.phaseLocked).toBe(true);
			expect(math.abs(r.stats.phase - 0.5) < PHASE_TOL).toBe(true);
		}
		expectDrawnNeverDecreases(records);
	});

	it("does not shift at 144 fps (the frames walk round the tick: unlocked)", () => {
		const fast = after(simulate(batches, { ...opts, fps: 144 }), WARM);
		for (const r of fast) {
			expect(r.stats.phaseLocked).toBe(false);
			expect(r.stats.phaseShiftTicks).toBe(0);
			expect(r.ret <= 1).toBe(true);
		}
	});
});

describe("PlayoutPacer: the lead's depth", () => {
	it("does not change while the raw depth oscillates +/- 0.2 tick around a whole tick", () => {
		// The target follows the newest arrival only (a one-sample jitter window, its max), and P jumps to it: the raw
		// depth P - base alternates 3.2 / 2.8 ticks frame by frame.
		const tunables: PacingTunables = {
			...PACING,
			minDepthTicks: 0,
			marginTicks: 0,
			jitterPercentile: 1,
			jitterWindowSec: SIM_DT / 2,
			slewShare: 1e9,
			fastSlewShare: 1e9,
			phaseLockSpread: 0,
		};
		const pacer = new PlayoutPacer(tunables);
		const base = 1;
		const SWING = 0.2;
		const MID = 3;
		pacer.arrived(base, 0);
		let stepped = 0;
		let crossedUp = 0;
		let crossedDown = 0;
		const leads: number[] = [];
		for (let k = 1; k <= 120; k++) {
			const now = base + k * SIM_DT;
			const depth = MID + (k % 2 === 0 ? SWING : -SWING);
			pacer.arrived(now, (now - base) / SIM_DT - depth);
			stepped += pacer.frame(now, SIM_DT, stepped, 1000, MAX_CATCHUP);
			const raw = pacer.stats().depthMs / 1000 / SIM_DT;
			if (k > 2 && raw > MID) crossedUp++;
			if (k > 2 && raw < MID) crossedDown++;
			if (k > 2) leads.push(pacer.depthTicks());
		}
		expect(crossedUp > 50 && crossedDown > 50).toBe(true);
		for (const d of leads) expect(d).toBe(MID + 1);
		expect(pacer.stats().holds).toBe(0);
	});

	it("rises at once and falls once the depth is leadHysteresisTicks below the next tick down", () => {
		const tunables: PacingTunables = {
			...PACING,
			minDepthTicks: 0,
			marginTicks: 0,
			jitterPercentile: 1,
			jitterWindowSec: SIM_DT / 2,
			slewShare: 1e9,
			fastSlewShare: 1e9,
			phaseLockSpread: 0,
		};
		const pacer = new PlayoutPacer(tunables);
		const base = 1;
		pacer.arrived(base, 0);
		let stepped = 0;
		const leadAt = (k: number, depth: number) => {
			const now = base + k * SIM_DT;
			pacer.arrived(now, (now - base) / SIM_DT - depth);
			stepped += pacer.frame(now, SIM_DT, stepped, 1000, MAX_CATCHUP);
			return pacer.depthTicks();
		};
		expect(leadAt(1, 3)).toBe(3); // the first frame places P at startDepthTicks
		expect(leadAt(2, 4.1)).toBe(5); // up at once
		expect(leadAt(3, 3.7)).toBe(5); // inside the hysteresis
		expect(leadAt(4, 4 - PACING.leadHysteresisTicks + 0.05)).toBe(5);
		expect(leadAt(5, 4 - PACING.leadHysteresisTicks - 0.05)).toBe(4); // past it: down to ceil(depth + hysteresis)
		expect(leadAt(6, 1.2)).toBe(2);
		expect(leadAt(7, 2.01)).toBe(3);
	});
});
