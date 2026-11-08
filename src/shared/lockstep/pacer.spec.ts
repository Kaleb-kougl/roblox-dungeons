// Co-op frame pacing (docs/FRAME_PACING.md FP2): the PlayoutPacer on synthetic arrival traces. Steady arrivals step
// one tick per 16.7 ms of local time at any render rate with alpha moving smoothly through [0, 1); a late batch is
// one hold (the views freeze, then playout resumes); the depth follows the 95th percentile of the arrival offsets, not
// a single outlier; the playout clock slews within its share of real time; a client hitch catches up at maxCatchup
// per frame without moving the clock, and its arrivals never reach the windows.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Rng, SIM_DT, SIM_HZ } from "shared/sim";
import { PACING, PlayoutPacer, type PacingStats } from "shared/lockstep";

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
	readonly stats: PacingStats;
}

interface SimOptions {
	readonly fps: number;
	readonly seconds: number;
	/** One frame of `hitchSec` at the first frame on or after this time. */
	readonly hitchAt?: number;
	readonly hitchSec?: number;
}

/** Renders frames at `fps`, delivering every batch that arrived by each frame's clock, and steps what frame() says. */
function simulate(batches: Batch[], opts: SimOptions, pacer = new PlayoutPacer()): FrameRecord[] {
	const records: FrameRecord[] = [];
	const got = new Set<number>();
	let now = PHASE;
	let nextBatch = 0;
	let received = 0;
	let stepped = 0;
	let hitched = false;
	const frameDt = 1 / opts.fps;
	while (now < opts.seconds) {
		let dt = frameDt;
		if (!hitched && opts.hitchAt !== undefined && now >= opts.hitchAt) {
			dt = opts.hitchSec ?? frameDt;
			hitched = true;
		}
		now += dt;
		let arrivals = 0;
		while (nextBatch < batches.size() && batches[nextBatch].at <= now) {
			const b = batches[nextBatch];
			nextBatch++;
			arrivals++;
			pacer.arrived(now, b.newest);
			for (let k = b.newest - b.count + 1; k <= b.newest; k++) got.add(k);
		}
		while (got.has(received)) received++;
		const queued = received - stepped;
		const ret = pacer.frame(now, dt, stepped, queued, MAX_CATCHUP);
		stepped += ret;
		records.push({ now, dt, arrivals, queued, ret, stepped, alpha: pacer.alpha(), stats: pacer.stats() });
	}
	return records;
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
			expect(last.stats.depthTicks).toBe(PACING.minDepthTicks);
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
		expect(pacer.stats().depthMs).toBeCloseTo(3 * SIM_DT * 1000, 6);
		expect(pacer.stats().jitterMs).toBeCloseTo(0, 6);
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
		const pacer = new PlayoutPacer();
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

	it("makes exactly one hold for one late batch, freezes near alpha 1, then resumes pacing", () => {
		const records = simulate(batches, { fps: 60, seconds: 20 });
		const last = records[records.size() - 1];
		expect(last.stats.holds).toBe(1);
		let held = 0;
		let deepest = 0;
		for (const r of records) {
			expect(r.ret <= 2).toBe(true); // never a jump: at most the 10 % fast slew's extra tick
			if (r.stats.holding) {
				held++;
				expect(r.alpha > 0.99).toBe(true);
			}
			deepest = math.max(deepest, r.stats.depthTicks);
		}
		expect(held > 3).toBe(true); // ~117 ms past the buffer
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

describe("PlayoutPacer: slew", () => {
	it("runs the playout clock within 1 +/- slewShare, or fastSlewShare while far past its target", () => {
		// 6 s steady, then 0-100 ms jitter (the target rises), then a 600 ms late batch (a long hold, far past it).
		const batches = trace(21, (j, rng) => (j < 180 ? 0.02 : j === 450 ? 0.62 : 0.02 + 0.1 * rng.next()), true, 3);
		const records = simulate(batches, { fps: 60, seconds: 20 });
		let slow = 0;
		let fast = 0;
		const tol = 1e-9;
		for (let i = 1; i < records.size(); i++) {
			const prev = records[i - 1];
			const r = records[i];
			if (!prev.stats.started || r.stats.holding || r.stats.catchingUp) continue;
			const rate = (r.stats.position - prev.stats.position) / (r.dt / SIM_DT);
			const far = prev.stats.offsetSec - r.stats.targetOffsetSec > PACING.fastSlewTicks * SIM_DT;
			const share = far ? PACING.fastSlewShare : PACING.slewShare;
			expect(math.abs(rate - 1) <= share + tol).toBe(true);
			if (math.abs(math.abs(rate - 1) - PACING.slewShare) < 1e-6) slow++;
			if (math.abs(math.abs(rate - 1) - PACING.fastSlewShare) < 1e-6) fast++;
		}
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
