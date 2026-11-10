// The co-op input lead from measured trips (docs/FRAME_PACING.md Revision 2, FP10; Revision 3, FP18): the
// LeadController on synthetic trip traces. A client steps and sends at 60 Hz and the server echoes every broadcast (30 a
// second) with a chosen net trip. Revision 2's rule (`lateBump: true`, KV_LeadBump; no ceiling: no cover), its cases
// unchanged: the lead holds at ceil(p95 + margin) on a steady network, follows a step up in the same echo and a step
// down within the window + hold + a fall step per tick, ignores a single unflagged outlier, bumps a late to its own
// trip, never bounces with the p95 near a tick boundary, warms up on the max, and runs the legacy miss counter exactly
// while no echo arrives (before the first, and after the echo timeout, resuming on the next echo). Revision 3's
// defaults (`LEAD`: no bump, the capped cover with the prediction cap as the ceiling): a late moves the lead only
// through the p95 / p99, the cover rises to and stops at the ceiling less the depth and follows it, no ceiling = the
// base alone, a step up is still followed at once, the fall is unchanged.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Rng, SIM_HZ } from "shared/sim";
import {
	BROADCAST_EVERY_TICKS,
	INPUT_DELAY_TICKS,
	INPUT_LEAD_DECAY_TICKS,
	LEAD,
	LeadController,
	MAX_INPUT_LEAD_TICKS,
	PREDICTION,
	type LeadTunables,
} from "shared/lockstep";

const MIN_LEAD = INPUT_DELAY_TICKS;
const MAX_LEAD = MAX_INPUT_LEAD_TICKS;
/** Revision 2's rule (KV_LeadBump): every late not excused bumps; Revision 2's cases run on it unchanged. */
const REV2: LeadTunables = { ...LEAD, lateBump: true };
/** The cover's ceiling LockstepClient passes (the prediction cap). */
const CEILING = PREDICTION.maxTicks;

interface TraceOptions {
	readonly seconds: number;
	/** The net trip (ticks) of the echo sent at time t. */
	readonly trip: (t: number) => number;
	/** Whether the echo is flagged late; default: the trip used up the lead the tick was sent with (slack <= 0). */
	readonly late?: (t: number, slack: number) => boolean;
	/** The send at time t happened in a hitched frame. */
	readonly hitched?: (t: number) => boolean;
	/** The server echoes (default true); false = batches arrive without echoes (an old server). */
	readonly echoes?: boolean;
	/** One echo per this many frames (default: one per broadcast). */
	readonly echoEvery?: number;
	/** Each step's checkDeadline result (default: matched). */
	readonly matched?: (t: number) => boolean;
	/** Called after every frame. */
	readonly onFrame?: (trace: Trace) => void;
	/** The pacing depth (whole ticks) at time t: the lead adds it to the target, the record carries it (default 0). */
	readonly depth?: (t: number) => number;
}

/** A client at 60 fps stepping one tick a frame, the controller driven as LockstepClient will drive it. */
class Trace {
	readonly ctl: LeadController;
	frames = 0;
	tick = 0;
	lastTarget = -1;
	/** Lead changes and decreases, with the time of each change. */
	changes = 0;
	decreases = 0;
	lastChangeAt = 0;
	private latesFrom = 0;
	private bumpsFrom = 0;
	private readonly sentAt = new Map<number, number>();
	private readonly depthAt = new Map<number, number>();
	private prevLead: number;

	constructor(decay: number = INPUT_LEAD_DECAY_TICKS, tunables: LeadTunables = REV2, ceiling?: number) {
		this.ctl = new LeadController(tunables, MIN_LEAD, MAX_LEAD, decay, ceiling);
		this.prevLead = this.ctl.lead();
	}

	now(): number {
		return this.frames / SIM_HZ;
	}

	run(opts: TraceOptions): void {
		const ctl = this.ctl;
		const total = math.floor(opts.seconds * SIM_HZ + 0.5);
		const every = opts.echoEvery ?? BROADCAST_EVERY_TICKS;
		for (let f = 0; f < total; f++) {
			this.frames++;
			const now = this.now();
			ctl.deadline(opts.matched === undefined || opts.matched(now), now);
			this.tick++;
			const depth = opts.depth !== undefined ? opts.depth(now) : 0;
			const target = this.tick + ctl.lead() + depth;
			if (target > this.lastTarget) {
				ctl.sent(target, this.tick, depth, opts.hitched !== undefined && opts.hitched(now), depth);
				this.sentAt.set(target, this.tick);
				this.depthAt.set(target, depth);
				this.lastTarget = target;
			}
			if (this.frames % every === 0) {
				ctl.received(now);
				if (opts.echoes !== false) {
					const x = this.lastTarget;
					const slack = x - (this.sentAt.get(x) ?? x) - (this.depthAt.get(x) ?? 0) - opts.trip(now);
					const late = opts.late !== undefined ? opts.late(now, slack) : slack <= 0;
					ctl.echoed({ tick: x, slack, lates: late ? 1 : 0 }, now);
				}
			}
			ctl.frame(now);
			const lead = ctl.lead();
			if (lead !== this.prevLead) {
				this.changes++;
				if (lead < this.prevLead) this.decreases++;
				this.lastChangeAt = now;
				this.prevLead = lead;
			}
			if (opts.onFrame) opts.onFrame(this);
		}
	}

	/** Starts the counts over (lead changes; the lates and bumps since, below). */
	resetCounts(): void {
		this.changes = 0;
		this.decreases = 0;
		const s = this.ctl.stats();
		this.latesFrom = s.lates;
		this.bumpsFrom = s.bumps;
	}

	/** Lates and bumps since resetCounts (the run's first echoes are late at the starting lead: the warm-up). */
	lates(): number {
		return this.ctl.stats().lates - this.latesFrom;
	}

	bumps(): number {
		return this.ctl.stats().bumps - this.bumpsFrom;
	}
}

/** ceil(p95 + margin) clamped, as the controller computes it (no float fuzz in these traces). */
function expectedTarget(p95: number): number {
	return math.clamp(math.ceil(p95 + LEAD.marginTicks - 1e-9), MIN_LEAD, MAX_LEAD);
}

/** Two decimals, for the printed measurements. */
function f2(x: number): string {
	return string.format("%.2f", x);
}

function jittered(rng: Rng, centre: number, spread: number): number {
	return centre + (rng.next() * 2 - 1) * spread;
}

describe("LeadController, Revision 2's rule (lateBump: true, no ceiling)", () => {
	it("measures a trip as the lead sent with, minus the slack, minus the buffer depth", () => {
		const ctl = new LeadController(REV2, MIN_LEAD, MAX_LEAD, INPUT_LEAD_DECAY_TICKS);
		expect(ctl.lead()).toBe(MIN_LEAD);
		expect(ctl.echoing()).toBe(false);
		ctl.sent(100, 90, 1.5, false);
		ctl.received(1);
		ctl.echoed({ tick: 100, slack: 2, lates: 0 }, 1);
		const s = ctl.stats();
		expect(s.tripMax).toBe(6.5);
		expect(s.samples).toBe(1);
		expect(s.warmingUp).toBe(true);
		// One sample: the warm-up's max-based target, taken at once.
		expect(s.target).toBe(8);
		expect(ctl.lead()).toBe(8);
		expect(ctl.echoing()).toBe(true);
		// The record is spent: the same tick again adds nothing.
		ctl.echoed({ tick: 100, slack: 0, lates: 0 }, 1.1);
		expect(ctl.stats().samples).toBe(1);
	});

	it("holds the lead at ceil(p95 + 1.5) on steady trips of 6 +/- 1 ticks, no change in 60 s", () => {
		const rng = new Rng(11);
		const trace = new Trace();
		const trip = () => jittered(rng, 6, 1);
		trace.run({ seconds: 1, trip });
		trace.resetCounts();
		const leadAfterWarmup = trace.ctl.lead();
		let offTarget = 0;
		trace.run({
			seconds: 60,
			trip,
			onFrame: (t) => {
				const s = t.ctl.stats();
				if (s.lead !== expectedTarget(s.tripP95 ?? 0)) offTarget++;
			},
		});
		const s = trace.ctl.stats();
		print(
			`[lead] steady 6+/-1: lead ${s.lead} p95 ${f2(s.tripP95 ?? 0)} changes ${
				trace.changes
			} lates ${trace.lates()}`,
		);
		expect(trace.changes).toBe(0);
		expect(offTarget).toBe(0);
		expect(s.lead).toBe(leadAfterWarmup);
		expect(s.lead).toBe(expectedTarget(s.tripP95 ?? 0));
		expect(s.lead).toBe(9);
		expect(trace.lates()).toBe(0);
		expect(s.falls).toBe(0);
		expect(s.echoing).toBe(true);
	});

	it("a step from 12 to 4 tick trips is back on the new target within window + hold + a step per tick", () => {
		const trace = new Trace();
		trace.run({ seconds: 20, trip: () => 12 });
		const before = trace.ctl.lead();
		expect(before).toBe(expectedTarget(12));
		trace.resetCounts();
		const stepAt = trace.now();
		let settledAt: number | undefined;
		let lowest = before;
		trace.run({
			seconds: 20,
			trip: () => 4,
			onFrame: (t) => {
				const s = t.ctl.stats();
				if (s.lead < lowest) lowest = s.lead;
				if (settledAt === undefined && s.samples >= LEAD.minSamples && s.lead === s.fallTarget) {
					settledAt = t.now();
				}
			},
		});
		const s = trace.ctl.stats();
		const ticks = before - s.lead;
		const bound = LEAD.windowSec + LEAD.fallHoldSec + LEAD.fallStepSec * ticks + 0.5;
		const took = (settledAt ?? math.huge) - stepAt;
		print(
			`[lead] step 12 -> 4: lead ${before} -> ${s.lead} (L* ${s.target}, Lf ${s.fallTarget})` +
				` in ${f2(took)} s (bound ${bound} s), falls ${s.falls}`,
		);
		// The lead rests on the fall target: L* or L* + 1 (the slack band), never below it.
		expect(s.lead).toBe(s.fallTarget);
		expect(s.lead >= s.target && s.lead <= s.target + 1).toBe(true);
		expect(lowest).toBe(s.lead);
		expect(took <= bound).toBe(true);
		expect(s.falls).toBe(ticks);
		expect(trace.lates()).toBe(0);
	});

	it("a step up is followed in the same echo (the late bumps to its trip); unflagged, once the p95 has it", () => {
		const trace = new Trace();
		trace.run({ seconds: 10, trip: () => 6 });
		expect(trace.ctl.lead()).toBe(expectedTarget(6));
		trace.resetCounts();
		// One echo (two frames) of 12-tick trips: late at lead 8, bumped to ceil(12 + 1.5) at once.
		trace.run({ seconds: 2 / SIM_HZ, trip: () => 12 });
		expect(trace.ctl.lead()).toBe(expectedTarget(12));
		expect(trace.bumps()).toBe(1);
		trace.run({ seconds: 5, trip: () => 12 });
		expect(trace.ctl.lead()).toBe(expectedTarget(12));

		// The same step never flagged late: the p95 takes it within the window's top 5 % (~0.25 s).
		const quiet = new Trace();
		quiet.run({ seconds: 10, trip: () => 6, late: () => false });
		quiet.resetCounts();
		const stepAt = quiet.now();
		let upAt: number | undefined;
		quiet.run({
			seconds: 2,
			trip: () => 12,
			late: () => false,
			onFrame: (t) => {
				if (upAt === undefined && t.ctl.lead() === expectedTarget(12)) upAt = t.now();
			},
		});
		const took = (upAt ?? math.huge) - stepAt;
		print(`[lead] step 6 -> 12 unflagged: up in ${f2(took)} s in one jump (changes ${quiet.changes})`);
		expect(took <= 0.5).toBe(true);
		expect(quiet.changes).toBe(1);
	});

	it("one 30-tick outlier among steady 6s moves nothing unless flagged late; flagged it bumps and is gone ~6 s later", () => {
		const rng = new Rng(5);
		const outlierAt = 10;
		const trip = (t: number) => (math.abs(t - outlierAt) < 1e-6 ? 30 : jittered(rng, 6, 1));
		const quiet = new Trace();
		quiet.run({ seconds: 2, trip });
		const lead = quiet.ctl.lead();
		quiet.resetCounts();
		let maxTarget = 0;
		quiet.run({
			seconds: 30,
			trip,
			late: () => false,
			onFrame: (t) => {
				maxTarget = math.max(maxTarget, t.ctl.stats().target);
			},
		});
		expect(quiet.changes).toBe(0);
		expect(maxTarget).toBe(lead);
		expect(quiet.ctl.lead()).toBe(lead);

		const loud = new Trace();
		loud.run({ seconds: 2, trip });
		loud.resetCounts();
		let peak = 0;
		let peakAt = 0;
		loud.run({
			seconds: 30,
			trip,
			onFrame: (t) => {
				if (t.ctl.lead() > peak) {
					peak = t.ctl.lead();
					peakAt = t.now();
				}
			},
		});
		const s = loud.ctl.stats();
		const gone = loud.lastChangeAt - peakAt;
		print(
			`[lead] 30-tick outlier flagged: ${lead} -> ${peak} -> ${s.lead} (Lf ${s.fallTarget})` +
				` gone in ${f2(gone)} s, bumps ${loud.bumps()} falls ${s.falls}`,
		);
		expect(peak).toBe(MAX_LEAD);
		expect(loud.bumps()).toBe(1);
		expect(s.lead).toBe(s.fallTarget);
		expect(s.lead <= lead + 1).toBe(true);
		expect(gone <= LEAD.fallHoldSec + LEAD.fallStepSec * (peak - s.lead) + 0.1).toBe(true);
	});

	it("a late bumps to its own trip, at least one tick past the lead it was sent with", () => {
		const trace = new Trace();
		trace.run({ seconds: 5, trip: () => 6 });
		const lead = trace.ctl.lead();
		expect(lead).toBe(8);
		trace.run({ seconds: 2 / SIM_HZ, trip: () => 15 });
		expect(trace.ctl.lead()).toBe(17);

		// A late whose trip + margin is under the lead + 1: one tick (the lead it was sent with + 1).
		const small = new Trace();
		small.run({ seconds: 5, trip: () => 6 });
		small.resetCounts();
		const ctl = small.ctl;
		// A tick sent now at the lead 8 from a hitched frame (no trip measured), echoed late only after the bump below.
		const far = small.lastTarget + 1000;
		ctl.sent(far, far - lead, 0, true);
		small.run({ seconds: 2 / SIM_HZ, trip: () => 6, late: () => true });
		expect(ctl.lead()).toBe(lead + 1);
		// A second late of unknown trip, of a tick sent before that bump, adds nothing more.
		const before = ctl.lead();
		ctl.echoed({ tick: far, slack: 0, lates: 1 }, small.now());
		expect(ctl.lead()).toBe(before);
		// A late with no tick (none echoed): one tick.
		ctl.echoed({ tick: undefined, slack: 0, lates: 2 }, small.now());
		expect(ctl.lead()).toBe(before + 1);
		expect(small.lates()).toBe(4);
	});

	for (const [frac, label] of [
		[0, "x.0"],
		[0.5, "x.5"],
		[0.9, "x.9"],
	] as const) {
		it(`a p95 sitting at ${label} ticks never bounces the lead`, () => {
			const rng = new Rng(math.floor(frac * 10) + 3);
			const centre = 6 + frac;
			const wobble = 0.15;
			const period = 20;
			// 7 trips in 8 a tick or two below the centre, every 8th in the tail, slowly swinging +/- 0.15 round it: the
			// p95 (the 8th largest of ~150) is a tail trip, so it swings with the tail.
			let k = 0;
			const trip = (t: number) => {
				k++;
				if (k % 8 !== 0) return centre - 1 - rng.next();
				const phase = (t % period) / period;
				const tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
				return centre + wobble * tri;
			};
			const trace = new Trace();
			trace.run({ seconds: 2, trip });
			trace.resetCounts();
			let lo = math.huge;
			let hi = -math.huge;
			trace.run({
				seconds: 60,
				trip,
				onFrame: (t) => {
					const p = t.ctl.stats().tripP95 ?? 0;
					lo = math.min(lo, p);
					hi = math.max(hi, p);
				},
			});
			const s = trace.ctl.stats();
			print(
				`[lead] p95 at ${label}: p95 ${f2(lo)}..${f2(hi)} lead ${s.lead}` +
					` changes ${trace.changes} (down ${trace.decreases}) lates ${trace.lates()}`,
			);
			// It did wobble across the target's boundary at x.5, yet the lead moved at most once, and never down.
			expect(hi - lo > wobble).toBe(true);
			expect(trace.changes <= 1).toBe(true);
			expect(trace.decreases).toBe(0);
			expect(trace.lates()).toBe(0);
		});
	}

	it("warms up on the max and never falls before minSamples trips", () => {
		const trace = new Trace();
		trace.run({ seconds: 3, trip: () => 6, echoes: false });
		expect(trace.ctl.lead()).toBe(MIN_LEAD);
		expect(trace.ctl.echoing()).toBe(false);
		// Two echoes a second: the window never holds minSamples (5 s x 2 = 10).
		let first = true;
		trace.run({
			seconds: 30,
			echoEvery: SIM_HZ / 2,
			trip: () => {
				const t = first ? 20 : 4;
				first = false;
				return t;
			},
			late: () => false,
		});
		let s = trace.ctl.stats();
		expect(s.warmingUp).toBe(true);
		expect(s.lead).toBe(expectedTarget(20));
		expect(s.target).toBe(expectedTarget(4));
		expect(s.falls).toBe(0);
		// Echoes at the broadcast rate: past the warm-up the lead falls to the fall target.
		trace.run({ seconds: 10, trip: () => 4 });
		s = trace.ctl.stats();
		expect(s.warmingUp).toBe(false);
		expect(s.lead).toBe(s.fallTarget);
		expect(s.falls).toBe(expectedTarget(20) - s.lead);
	});

	it("without an echo runs exactly the legacy miss counter (client.ts checkDeadline)", () => {
		const decay = 10;
		const ctl = new LeadController(REV2, MIN_LEAD, MAX_LEAD, decay);
		// checkDeadline, reimplemented.
		let lead = MIN_LEAD;
		let clean = 0;
		let misses = 0;
		const rng = new Rng(99);
		let missRun = 0;
		let diverged = 0;
		for (let i = 0; i < 20000; i++) {
			const now = i / SIM_HZ;
			// Bursts of misses, long clean stretches.
			if (missRun === 0 && rng.next() < 0.01) missRun = rng.int(1, 40);
			const matched = missRun === 0 || rng.next() < 0.3;
			if (missRun > 0) missRun--;
			if (matched) {
				clean++;
				if (clean >= decay && lead > MIN_LEAD) {
					lead--;
					clean = 0;
				}
			} else {
				misses++;
				clean = 0;
				if (lead < MAX_LEAD) lead++;
			}
			ctl.deadline(matched, now);
			// Sends, batches and frames without echoes change nothing.
			ctl.sent(i + lead, i, 0.5, false);
			if (i % 2 === 0) ctl.received(now);
			ctl.frame(now);
			if (ctl.lead() !== lead) diverged++;
		}
		expect(diverged).toBe(0);
		expect(ctl.stats().mismatches).toBe(misses);
		expect(ctl.echoing()).toBe(false);
		expect(misses > 1000).toBe(true);
	});

	it("an echo timeout switches back to the legacy rule, and the next echo resumes", () => {
		const decay = 60;
		const trace = new Trace(decay);
		trace.run({ seconds: 10, trip: () => 6 });
		const lead = trace.ctl.lead();
		expect(trace.ctl.echoing()).toBe(true);
		// While echoing, clean deadlines never decay the lead.
		expect(trace.ctl.stats().falls).toBe(0);
		const quietFrom = trace.now();
		let offAt: number | undefined;
		trace.run({
			seconds: 2.5,
			trip: () => 6,
			echoes: false,
			onFrame: (t) => {
				if (offAt === undefined && !t.ctl.echoing()) offAt = t.now();
			},
		});
		const took = (offAt ?? math.huge) - quietFrom;
		print(`[lead] echo timeout: legacy after ${f2(took)} s without an echo`);
		expect(took >= LEAD.echoTimeoutSec && took <= LEAD.echoTimeoutSec + 2 / SIM_HZ + 1e-6).toBe(true);
		// Legacy: a mismatch is exactly +1, `decay` clean ticks exactly -1.
		const ctl = trace.ctl;
		const base = ctl.lead();
		expect(base).toBe(lead);
		for (let i = 0; i < 4; i++) ctl.deadline(false, trace.now());
		expect(ctl.lead()).toBe(base + 4);
		for (let i = 0; i < decay - 1; i++) ctl.deadline(true, trace.now());
		expect(ctl.lead()).toBe(base + 4);
		ctl.deadline(true, trace.now());
		expect(ctl.lead()).toBe(base + 3);
		// Echoes again: echoing resumes and the lead falls back to the fall target.
		trace.run({ seconds: 8, trip: () => 6 });
		const s = ctl.stats();
		expect(s.echoing).toBe(true);
		expect(s.lead).toBe(s.fallTarget);
		expect(s.lead <= lead + 1).toBe(true);
	});

	it("a mismatch while echoing is only counted: no bump, the fall goes on (Design 10)", () => {
		const trace = new Trace();
		trace.run({ seconds: 10, trip: () => 12 });
		const high = trace.ctl.lead();
		// Trips drop: the lead starts falling once the 12s leave the window.
		let firstFallAt: number | undefined;
		trace.run({
			seconds: LEAD.windowSec + LEAD.fallHoldSec + 0.6,
			trip: () => 4,
			onFrame: (t) => {
				if (firstFallAt === undefined && t.ctl.lead() < high) firstFallAt = t.now();
			},
		});
		expect(firstFallAt).toBeDefined();
		const ctl = trace.ctl;
		const before = ctl.lead();
		const fallsBefore = ctl.stats().falls;
		const bumpsBefore = ctl.stats().bumps;
		const at = trace.now();
		ctl.deadline(false, at);
		expect(ctl.lead()).toBe(before);
		expect(ctl.stats().mismatches).toBe(1);
		expect(ctl.stats().bumps).toBe(bumpsBefore);
		let nextFallAt: number | undefined;
		trace.run({
			seconds: 2,
			trip: () => 4,
			onFrame: (t) => {
				if (nextFallAt === undefined && t.ctl.stats().falls > fallsBefore) nextFallAt = t.now();
			},
		});
		// The fall's hold was not restarted: the next step comes within one fall step.
		const waited = (nextFallAt ?? math.huge) - at;
		expect(waited <= LEAD.fallStepSec + 2 / SIM_HZ).toBe(true);
	});

	it("ignores hitched sends' trips and counts their lates without a bump (the client's stall, not the network)", () => {
		const trace = new Trace();
		trace.run({ seconds: 5, trip: () => 6 });
		const lead = trace.ctl.lead();
		const samplesBefore = trace.ctl.stats().samples;
		// Two seconds of hitched sends with 40-tick trips, never flagged: nothing enters the window.
		trace.run({ seconds: 2, trip: () => 40, hitched: () => true, late: () => false });
		let s = trace.ctl.stats();
		expect(s.tripMax).toBe(6);
		expect(s.lead).toBe(lead);
		expect(s.samples <= samplesBefore).toBe(true);
		// One hitched late: counted and excused, the lead unchanged.
		trace.run({ seconds: 5, trip: () => 6 });
		const before = trace.ctl.stats();
		trace.run({ seconds: 2 / SIM_HZ, trip: () => 40, hitched: () => true });
		s = trace.ctl.stats();
		expect(s.lates).toBe(before.lates + 1);
		expect(s.excused).toBe(before.excused + 1);
		expect(s.bumps).toBe(before.bumps);
		expect(s.lead).toBe(lead);
		expect(s.tripMax).toBe(6);
	});

	it("keeps a bounded ring of send records: a server that never echoes cannot grow it", () => {
		const ctl = new LeadController(REV2, MIN_LEAD, MAX_LEAD, INPUT_LEAD_DECAY_TICKS);
		const n = 100000;
		for (let target = 0; target < n; target++) ctl.sent(target, target - 5, 0, false);
		const newest = n - 1;
		// Older than the newest recordTicks targets: gone (no trip measured).
		ctl.echoed({ tick: newest - LEAD.recordTicks, slack: 1, lates: 0 }, 1);
		expect(ctl.stats().samples).toBe(0);
		expect(ctl.echoing()).toBe(true);
		// Within them: still there.
		ctl.echoed({ tick: newest - LEAD.recordTicks + 1, slack: 1, lates: 0 }, 1);
		expect(ctl.stats().samples).toBe(1);
		expect(ctl.stats().tripMax).toBe(4);
		// An echo at or below one already echoed: spent.
		ctl.echoed({ tick: newest - LEAD.recordTicks + 1, slack: 1, lates: 0 }, 1);
		ctl.echoed({ tick: newest - LEAD.recordTicks - 10, slack: 1, lates: 0 }, 1);
		expect(ctl.stats().samples).toBe(1);
		// Out-of-order sends are ignored (targets only increase).
		ctl.sent(newest - 3, 0, 0, false);
		ctl.echoed({ tick: newest - 3, slack: 1, lates: 0 }, 1);
		expect(ctl.stats().tripMax).toBe(4);
	});

	it("ignores non-finite input and a clock that goes back", () => {
		const ctl = new LeadController(REV2, MIN_LEAD, MAX_LEAD, INPUT_LEAD_DECAY_TICKS);
		ctl.sent(0 / 0, 1, 0, false);
		ctl.echoed({ tick: 0 / 0, slack: 1, lates: 0 / 0 }, 1);
		ctl.frame(0 / 0);
		ctl.received(math.huge);
		expect(ctl.echoing()).toBe(false);
		expect(ctl.stats().lates).toBe(0);
		ctl.sent(20, 10, 0, false);
		ctl.echoed({ tick: 20, slack: 1, lates: 0 }, 5);
		ctl.sent(22, 12, 0, false);
		ctl.echoed({ tick: 22, slack: 1, lates: 0 }, 4);
		ctl.frame(3);
		const s = ctl.stats();
		expect(s.samples).toBe(2);
		expect(s.lead).toBe(expectedTarget(9));
	});
});

describe("LeadController, Revision 2's rule: echoes that do not measure the network (review fixes)", () => {
	/** A controller echoing steady 6-tick trips for 10 s at 60 fps (one echo per broadcast). */
	function steady(): Trace {
		const trace = new Trace();
		trace.run({ seconds: 10, trip: () => 6 });
		expect(trace.ctl.echoing()).toBe(true);
		return trace;
	}

	it("an echo flagged catchingUp (the server's backlog) is counted, never windowed or bumped", () => {
		const trace = steady();
		const ctl = trace.ctl;
		const before = ctl.stats();
		const target = trace.lastTarget + 1;
		const now = trace.now();
		ctl.sent(target, trace.tick, 0, false);
		// 30 ticks late against the server's catch-up pace.
		ctl.echoed({ tick: target, slack: -30, lates: 4, catchingUp: true }, now);
		const s = ctl.stats();
		expect(s.lates).toBe(before.lates + 4);
		expect(s.excused).toBe(before.excused + 1);
		expect(s.bumps).toBe(before.bumps);
		expect(s.samples).toBe(before.samples);
		expect(s.tripMax).toBe(before.tripMax);
		expect(s.lead).toBe(before.lead);
	});

	it("a late the buffer's lead cap explains (raw depth over the depth added) does not bump; a longer one does", () => {
		const trace = steady();
		const ctl = trace.ctl;
		const before = ctl.stats();
		const now = trace.now();
		// Sent with a raw depth of 14.5 ticks but only 12 added to the lead: 2.5 ticks went uncovered.
		const a = trace.lastTarget + 1;
		ctl.sent(a, trace.tick, 14.5, false, 12);
		ctl.echoed({ tick: a, slack: -2, lates: 1 }, now);
		let s = ctl.stats();
		expect([s.excused, s.bumps, s.lead]).toEqual([before.excused + 1, before.bumps, before.lead]);
		// 3 ticks late: more than the uncovered depth, a real late.
		const b = a + 1;
		ctl.sent(b, trace.tick, 14.5, false, 12);
		ctl.echoed({ tick: b, slack: -3, lates: 1 }, now);
		s = ctl.stats();
		expect(s.bumps).toBe(before.bumps + 1);
		expect(s.lead > before.lead).toBe(true);
	});

	it("an up-link outage ('none' echoes only) keeps echoing; no decodable echo at all times out", () => {
		const trace = steady();
		const ctl = trace.ctl;
		let now = trace.now();
		const step = 1 / SIM_HZ;
		const seconds = LEAD.echoTimeoutSec * 2;
		for (let k = 0; k < seconds * SIM_HZ; k++) {
			now += step;
			ctl.received(now);
			ctl.echoed({ tick: undefined, slack: 0, lates: 0 }, now);
			ctl.frame(now);
		}
		expect(ctl.echoing()).toBe(true);
		// Batches without any echo (an old server, or echoes stripped): the timeout.
		let offAfter: number | undefined;
		const quietFrom = now;
		for (let k = 0; k < seconds * SIM_HZ && offAfter === undefined; k++) {
			now += step;
			ctl.received(now);
			ctl.frame(now);
			if (!ctl.echoing()) offAfter = now - quietFrom;
		}
		expect(offAfter).toBeDefined();
		expect(math.abs(offAfter! - LEAD.echoTimeoutSec) <= 2 * step).toBe(true);
	});
});

describe("LeadController, Revision 3's defaults: no bump, the capped cover (FP18)", () => {
	/** A late of `trip` ticks echoed now, for a tick sent now (it joins both windows like any other trip). */
	function lateNow(trace: Trace, trip: number): void {
		const ctl = trace.ctl;
		const target = trace.lastTarget + 1;
		trace.lastTarget = target;
		ctl.sent(target, trace.tick, 0, false);
		ctl.echoed({ tick: target, slack: target - trace.tick - trip, lates: 1 }, trace.now());
	}

	it("LEAD's defaults: no bump, a 15 s cover at p99", () => {
		expect([LEAD.lateBump, LEAD.coverWindowSec, LEAD.coverPercentile]).toEqual([false, 15, 0.99]);
		expect(CEILING).toBe(20);
	});

	it("a late does not move the lead unless its trip moves the p95 / p99: one burst sample in 15 s moves nothing", () => {
		const rng = new Rng(17);
		const trip = () => jittered(rng, 6, 1);
		const trace = new Trace(INPUT_LEAD_DECAY_TICKS, LEAD, CEILING);
		trace.run({ seconds: LEAD.coverWindowSec + 2, trip, late: () => false });
		const lead = trace.ctl.lead();
		expect(lead).toBe(expectedTarget(trace.ctl.stats().tripP95 ?? 0));
		const before = trace.ctl.stats();
		expect(before.samples >= (LEAD.windowSec * SIM_HZ) / BROADCAST_EVERY_TICKS - 1).toBe(true);
		trace.resetCounts();
		// One burst sample: 15 ticks, late. 1 of ~450 cover trips, 1 of ~150 base trips: neither quantile moves.
		lateNow(trace, 15);
		let s = trace.ctl.stats();
		expect(s.lead).toBe(lead);
		expect(s.coverTarget).toBe(before.coverTarget);
		expect(s.baseTarget).toBe(before.baseTarget);
		expect(s.tripMax).toBe(15);
		expect(trace.lates()).toBe(1);
		expect(trace.bumps()).toBe(0);
		// Nor for the whole cover window after it.
		let maxLead = 0;
		trace.run({
			seconds: LEAD.coverWindowSec + 1,
			trip,
			late: () => false,
			onFrame: (t) => {
				maxLead = math.max(maxLead, t.ctl.lead());
			},
		});
		expect(maxLead).toBe(lead);
		expect(trace.changes).toBe(0);

		// The same late under Revision 2's rule bumps to its own trip at once.
		const rev2 = new Trace();
		rev2.run({ seconds: LEAD.coverWindowSec + 2, trip, late: () => false });
		rev2.resetCounts();
		lateNow(rev2, 15);
		expect(rev2.ctl.lead()).toBe(expectedTarget(15));
		expect(rev2.bumps()).toBe(1);

		// Five such lates within a second move the cover's p99 (1 % of ~450 is ~4.5): the lead rises to the cover's
		// target the same echo, never a bump, and holds for the cover window (the p95 never moved).
		trace.resetCounts();
		const coverBefore = trace.ctl.stats().coverP99 ?? 0;
		const leads: number[] = [];
		for (let k = 0; k < 5; k++) {
			lateNow(trace, 15);
			leads.push(trace.ctl.lead());
			trace.run({ seconds: 0.1, trip, late: () => false });
		}
		s = trace.ctl.stats();
		print(
			`[lead] five 15-tick lates: leads ${leads.join(",")} (p99 ${f2(coverBefore)} -> ${f2(s.coverP99 ?? 0)}, ` +
				`base ${s.baseTarget}t cover ${s.coverTarget}t cap ${s.ceiling}t)`,
		);
		expect(leads[3]).toBe(lead);
		expect(leads[4]).toBe(expectedTarget(15));
		expect(s.coverP99).toBe(15);
		expect(s.baseTarget).toBe(lead);
		expect(s.target).toBe(expectedTarget(15));
		expect(trace.bumps()).toBe(0);
		expect(trace.lates()).toBe(5);
		trace.run({ seconds: LEAD.coverWindowSec - 2, trip, late: () => false });
		expect(trace.ctl.lead()).toBe(expectedTarget(15));
		// Gone once they leave the cover window: the hold and the fall steps (Revision 2's) bring it back.
		trace.run({ seconds: 6, trip, late: () => false });
		s = trace.ctl.stats();
		expect(s.lead).toBe(s.fallTarget);
		expect(s.lead <= lead + 1).toBe(true);
	});

	/** 32 of 33 trips at 6 ticks, every 33rd at 30: the p95 (top 5 % of ~150) stays 6, the p99 (top 1 % of ~450) is 30. */
	function rareSlow(): (t: number) => number {
		let k = 0;
		return () => {
			k++;
			return k % 33 === 0 ? 30 : 6;
		};
	}

	it("the cover rises to and stops at the ceiling less the depth, and follows a depth change", () => {
		const trip = rareSlow();
		let depth = 0;
		const trace = new Trace(INPUT_LEAD_DECAY_TICKS, LEAD, CEILING);
		let worstEffective = 0;
		const onFrame = (t: Trace) => {
			if (t.now() > LEAD.coverWindowSec) worstEffective = math.max(worstEffective, t.ctl.lead() + depth);
		};
		trace.run({ seconds: LEAD.coverWindowSec + 5, trip, depth: () => depth, late: () => false, onFrame });
		let s = trace.ctl.stats();
		print(
			`[lead] cover at depth 0: lead ${s.lead} (base ${s.baseTarget} cover ${s.coverTarget} cap ${s.ceiling},` +
				` p95 ${f2(s.tripP95 ?? 0)} p99 ${f2(s.coverP99 ?? 0)})`,
		);
		expect(s.tripP95).toBe(6);
		expect(s.coverP99).toBe(30);
		expect(s.baseTarget).toBe(expectedTarget(6));
		expect(s.coverTarget).toBe(expectedTarget(30));
		expect(s.ceiling).toBe(CEILING);
		expect(s.target).toBe(CEILING);
		expect(s.lead).toBe(CEILING);
		expect(s.bumps).toBe(0);
		// A deeper buffer: the ceiling falls tick for tick, the lead follows it down (the fall's own pace).
		depth = 4;
		trace.run({ seconds: 3, trip, depth: () => depth, late: () => false, onFrame });
		s = trace.ctl.stats();
		expect(s.ceiling).toBe(CEILING - 4);
		expect(s.target).toBe(CEILING - 4);
		expect(s.lead).toBe(CEILING - 4);
		// A shallower one: the lead rises to the new ceiling at once, as soon as a send carries the new depth (the
		// targets the 3 ticks of depth already covered are not sent again).
		depth = 1;
		let raisedAt: number | undefined;
		const shallowFrom = trace.now();
		trace.run({
			seconds: 0.5,
			trip,
			depth: () => depth,
			late: () => false,
			onFrame: (t) => {
				onFrame(t);
				const st = t.ctl.stats();
				if (raisedAt === undefined && st.ceiling === CEILING - 1) {
					raisedAt = t.now();
					expect(st.lead).toBe(CEILING - 1);
				}
			},
		});
		s = trace.ctl.stats();
		expect(s.ceiling).toBe(CEILING - 1);
		expect(s.lead).toBe(CEILING - 1);
		expect((raisedAt ?? math.huge) - shallowFrom <= 4 / SIM_HZ + 1e-6).toBe(true);
		// The effective lead (net + depth) never went past the cap for the cover's sake once settled.
		expect(worstEffective <= CEILING + 4).toBe(true);
		// A ceiling under the base: the base alone (the cover never lowers the lead).
		depth = 16;
		trace.run({ seconds: 8, trip, depth: () => depth, late: () => false });
		s = trace.ctl.stats();
		expect(s.ceiling).toBe(CEILING - 16);
		expect(s.target).toBe(expectedTarget(6));
		expect(s.lead).toBe(s.fallTarget);
		expect(s.lead <= expectedTarget(6) + 1).toBe(true);
	});

	it("no ceiling (no prediction): the base alone; the cover is measured but never raises the lead", () => {
		const trip = rareSlow();
		const trace = new Trace(INPUT_LEAD_DECAY_TICKS, LEAD);
		trace.run({ seconds: LEAD.coverWindowSec + 5, trip, late: () => false });
		const s = trace.ctl.stats();
		expect(s.ceiling).toBe(undefined);
		expect(s.coverP99).toBe(30);
		expect(s.target).toBe(expectedTarget(6));
		expect(s.baseTarget).toBe(expectedTarget(6));
		expect(s.lead).toBe(expectedTarget(6));
		expect(s.bumps).toBe(0);
	});

	it("the cover waits for the warm-up (minSamples base trips)", () => {
		const trace = new Trace(INPUT_LEAD_DECAY_TICKS, LEAD, CEILING);
		// A single slow first trip, then steady 6s: the warm-up's max-based target, no cover on top.
		let first = true;
		trace.run({
			seconds: ((LEAD.minSamples - 2) * BROADCAST_EVERY_TICKS) / SIM_HZ,
			trip: () => {
				const t = first ? 12 : 6;
				first = false;
				return t;
			},
			late: () => false,
		});
		const s = trace.ctl.stats();
		expect(s.warmingUp).toBe(true);
		expect(s.coverTarget).toBe(expectedTarget(12));
		expect(s.target).toBe(expectedTarget(12));
		expect(s.baseTarget).toBe(expectedTarget(12));
	});

	it("a step up of the trips is still followed at once (unflagged or late), in one jump, without a bump", () => {
		for (const flagged of [false, true]) {
			const trace = new Trace(INPUT_LEAD_DECAY_TICKS, LEAD, CEILING);
			trace.run({ seconds: LEAD.coverWindowSec + 2, trip: () => 6, late: () => false });
			expect(trace.ctl.lead()).toBe(expectedTarget(6));
			trace.resetCounts();
			const stepAt = trace.now();
			let upAt: number | undefined;
			let below = 0;
			trace.run({
				seconds: 2,
				trip: () => 12,
				late: flagged ? undefined : () => false,
				onFrame: (t) => {
					const st = t.ctl.stats();
					if (st.lead < st.target) below++;
					if (upAt === undefined && st.lead === expectedTarget(12)) upAt = t.now();
				},
			});
			const took = (upAt ?? math.huge) - stepAt;
			print(
				`[lead] step 6 -> 12 ${flagged ? "late" : "unflagged"}, defaults: up in ${f2(took)} s, changes ${
					trace.changes
				} lates ${trace.lates()} bumps ${trace.bumps()}`,
			);
			expect(took <= 0.5).toBe(true);
			expect(trace.changes).toBe(1);
			expect(below).toBe(0);
			expect(trace.bumps()).toBe(0);
			expect(trace.ctl.lead()).toBe(expectedTarget(12));
		}
	});

	it("the fall is unchanged: no ceiling within window + hold + a step per tick, with the cover after its window", () => {
		// (Objects: an array holding undefined ends at it in Luau.)
		for (const { ceiling } of [{ ceiling: undefined }, { ceiling: CEILING }] as Array<{ ceiling?: number }>) {
			const trace = new Trace(INPUT_LEAD_DECAY_TICKS, LEAD, ceiling);
			trace.run({ seconds: 20, trip: () => 12 });
			const before = trace.ctl.lead();
			expect(before).toBe(expectedTarget(12));
			trace.resetCounts();
			const stepAt = trace.now();
			let settledAt: number | undefined;
			let firstFallAt: number | undefined;
			trace.run({
				seconds: 25,
				trip: () => 4,
				onFrame: (t) => {
					const s = t.ctl.stats();
					if (firstFallAt === undefined && s.lead < before) firstFallAt = t.now();
					if (settledAt === undefined && s.lead === s.fallTarget && s.lead < before) settledAt = t.now();
				},
			});
			const s = trace.ctl.stats();
			const ticks = before - s.lead;
			const windowSec = ceiling === undefined ? LEAD.windowSec : LEAD.coverWindowSec;
			const bound = windowSec + LEAD.fallHoldSec + LEAD.fallStepSec * ticks + 0.5;
			const took = (settledAt ?? math.huge) - stepAt;
			print(
				`[lead] step 12 -> 4, defaults, ceiling ${ceiling ?? "none"}: ${before} -> ${s.lead} in ${f2(
					took,
				)} s (bound ${bound} s), first fall after ${f2((firstFallAt ?? math.huge) - stepAt)} s, falls ${
					s.falls
				}`,
			);
			expect(s.lead).toBe(s.fallTarget);
			expect(s.lead >= s.target && s.lead <= s.target + 1).toBe(true);
			expect(took <= bound).toBe(true);
			expect(s.falls).toBe(ticks);
			// One tick a fall step once it starts: the hold and the step are Revision 2's.
			expect(took - ((firstFallAt ?? 0) - stepAt) <= LEAD.fallStepSec * (ticks - 1) + 2 / SIM_HZ).toBe(true);
		}
	});

	it("a late during a fall neither bumps nor restarts the hold: the next fall step comes on time", () => {
		const trace = new Trace(INPUT_LEAD_DECAY_TICKS, LEAD);
		trace.run({ seconds: 10, trip: () => 12 });
		const high = trace.ctl.lead();
		let fellAt: number | undefined;
		trace.run({
			seconds: LEAD.windowSec + LEAD.fallHoldSec + 0.6,
			trip: () => 4,
			onFrame: (t) => {
				if (fellAt === undefined && t.ctl.lead() < high) fellAt = t.now();
			},
		});
		expect(fellAt).toBeDefined();
		const ctl = trace.ctl;
		const before = ctl.stats();
		const at = trace.now();
		lateNow(trace, 5);
		const after = ctl.stats();
		expect(after.lead).toBe(before.lead);
		expect([after.lates, after.bumps, after.excused]).toEqual([before.lates + 1, 0, before.excused]);
		let nextFallAt: number | undefined;
		trace.run({
			seconds: 2,
			trip: () => 4,
			onFrame: (t) => {
				if (nextFallAt === undefined && t.ctl.stats().falls > before.falls) nextFallAt = t.now();
			},
		});
		expect((nextFallAt ?? math.huge) - at <= LEAD.fallStepSec + 2 / SIM_HZ).toBe(true);
	});

	it("excused lates are counted as before (the server catching up)", () => {
		const trace = new Trace(INPUT_LEAD_DECAY_TICKS, LEAD, CEILING);
		trace.run({ seconds: 10, trip: () => 6 });
		const ctl = trace.ctl;
		const before = ctl.stats();
		const target = trace.lastTarget + 1;
		ctl.sent(target, trace.tick, 0, false);
		ctl.echoed({ tick: target, slack: -30, lates: 4, catchingUp: true }, trace.now());
		const s = ctl.stats();
		expect([s.lates, s.excused, s.bumps, s.samples, s.lead]).toEqual([
			before.lates + 4,
			before.excused + 1,
			0,
			before.samples,
			before.lead,
		]);
	});
});

describe("LeadController, the episode detector (FPD20, FP23: LEAD's defaults with a ceiling)", () => {
	/** The steady link: 6 +/- 1 tick trips. */
	const STEADY = 6;
	const SPREAD = 1;
	/** A +200 ms spike: 12 ticks over the steady trips (FP12's). */
	const SPIKE = 12;
	/** Slow trips sit this far over the steady ones (the threshold is max(2.4, 3 IQR ~ 3) ticks over the median). */
	const SLOW = STEADY + SPIKE;
	/** Long enough that the cover window (15 s) is full of steady trips. */
	const SETTLE_SEC = LEAD.coverWindowSec + 2;
	const NO_EPISODES: LeadTunables = { ...LEAD, episodes: false };

	/** Steady trips, `extra` more for the echoes in [from, from + sec) (trace time). */
	function spikeTrip(seed: number, from: number, sec: number, extra: number): (t: number) => number {
		const rng = new Rng(seed);
		return (t) => jittered(rng, STEADY, SPREAD) + (t >= from && t < from + sec ? extra : 0);
	}

	/** A trace settled on the steady link (episodes off or on), its lead and the time the trouble starts. */
	function settled(tunables: LeadTunables, ceiling: number | undefined, trip: (t: number) => number): Trace {
		const trace = new Trace(INPUT_LEAD_DECAY_TICKS, tunables, ceiling);
		trace.run({ seconds: SETTLE_SEC, trip, late: () => false });
		return trace;
	}

	/** Seconds after `since` until the lead is back within a tick of `before` for good (math.huge: never in the run). */
	function backAfter(trace: Trace, trip: (t: number) => number, since: number, seconds: number, before: number) {
		let lastOut = since;
		let peak = 0;
		trace.run({
			seconds,
			trip,
			late: () => false,
			onFrame: (t) => {
				const lead = t.ctl.lead();
				peak = math.max(peak, lead);
				if (t.now() >= since && math.abs(lead - before) > 1) lastOut = t.now();
			},
		});
		return { back: lastOut + 1 / SIM_HZ < trace.now() ? lastOut - since : math.huge, peak };
	}

	it("LEAD's episode tunables", () => {
		expect([
			LEAD.episodes,
			LEAD.episodeGapMs,
			LEAD.episodeIqrK,
			LEAD.episodeGapSamples,
			LEAD.episodeMinSec,
			LEAD.episodeMinSlow,
		]).toEqual([true, 40, 3, 2, 0.25, 6]);
	});

	it("a long spike becomes an episode: its trips leave the cover and the lead is back in the base's time", () => {
		const from = SETTLE_SEC;
		const sec = 1;
		const runFor = LEAD.coverWindowSec + 6;
		const results: Array<{ back: number; peak: number; before: number; episodes?: number; keptOut: number }> = [];
		for (const tunables of [LEAD, NO_EPISODES]) {
			const trip = spikeTrip(23, from, sec, SPIKE);
			const trace = settled(tunables, CEILING, trip);
			const before = trace.ctl.lead();
			let activeDuring = false;
			let p99During = 0;
			trace.run({
				seconds: sec,
				trip,
				late: () => false,
				onFrame: (t) => {
					const s = t.ctl.stats();
					if (s.episodeActive) activeDuring = true;
					p99During = s.coverP99 ?? 0;
				},
			});
			const s = trace.ctl.stats();
			if (tunables === LEAD) {
				expect(activeDuring).toBe(true);
				expect(s.episodes).toBe(1);
				// 30 echoes a second: every spike trip is kept from the cover (taken out or kept out).
				expect(s.keptOut >= sec * (SIM_HZ / BROADCAST_EVERY_TICKS) - 1).toBe(true);
				// The cover's p99 at the spike's end is the steady link's.
				expect(p99During <= STEADY + SPREAD).toBe(true);
			} else {
				expect(s.episodes).toBe(undefined);
				expect(s.keptOut).toBe(0);
				expect(p99During > SLOW - SPREAD).toBe(true);
			}
			const r = backAfter(trace, trip, from + sec, runFor, before);
			// The run ends with the spike (three steady trips): the episode is over.
			expect(trace.ctl.stats().episodeActive).toBe(false);
			results.push({ ...r, before, episodes: s.episodes, keptOut: s.keptOut });
		}
		const [on, off] = results;
		print(
			`[lead] 1 s +${SPIKE}-tick spike, ceiling ${CEILING}: episodes ${on.episodes} kept out ${on.keptOut}, ` +
				`${on.before} -> ${on.peak} back in ${f2(on.back)} s; episodes off ${off.before} -> ${
					off.peak
				} back in ${f2(off.back)} s`,
		);
		const bound = LEAD.windowSec + LEAD.fallHoldSec + LEAD.fallStepSec * (on.peak - on.before) + 0.5;
		expect(on.back <= bound).toBe(true);
		expect(off.back > LEAD.coverWindowSec).toBe(true);
		// The base still covers the spike while it lasts: the same peak.
		expect(on.peak).toBe(off.peak);
	});

	it("a short burst is not an episode: the cover remembers it", () => {
		// 0.2 s: 6 echoes spanning 0.17 s, under episodeMinSec.
		const from = SETTLE_SEC;
		const trip = spikeTrip(29, from, 0.2, SPIKE);
		const trace = settled(LEAD, CEILING, trip);
		trace.run({ seconds: 2, trip, late: () => false });
		const s = trace.ctl.stats();
		expect(s.episodes).toBe(0);
		expect(s.keptOut).toBe(0);
		expect((s.coverP99 ?? 0) > SLOW - SPREAD).toBe(true);
		expect(s.lead).toBe(math.min(CEILING, expectedTarget(s.coverP99 ?? 0)));
		expect(s.lead > expectedTarget(STEADY + SPREAD)).toBe(true);
	});

	/** Steady trips, but every `every`-th echo from echo `first` is slow, `count` of them. */
	function sparseSlow(seed: number, first: number, every: number, count: number): (t: number) => number {
		const rng = new Rng(seed);
		let k = 0;
		return () => {
			k++;
			const steady = jittered(rng, STEADY, SPREAD);
			const i = k - first;
			return i >= 0 && i % every === 0 && i / every < count ? SLOW : steady;
		};
	}

	const SETTLE_ECHOES = (SETTLE_SEC * SIM_HZ) / BROADCAST_EVERY_TICKS;

	it("an episode needs episodeMinSlow slow trips, not only episodeMinSec; two other trips between keep the run", () => {
		// Slow every 3rd echo (two steady ones between): 5 span 0.4 s (> 0.25 s) but are fewer than 6.
		const gapEvery = LEAD.episodeGapSamples + 1;
		for (const count of [LEAD.episodeMinSlow - 1, LEAD.episodeMinSlow]) {
			const trip = sparseSlow(31, SETTLE_ECHOES + 10, gapEvery, count);
			const trace = settled(LEAD, CEILING, trip);
			trace.run({ seconds: 2, trip, late: () => false });
			const s = trace.ctl.stats();
			print(
				`[lead] ${count} slow trips, one every ${gapEvery} echoes: episodes ${s.episodes} kept out ${s.keptOut}`,
			);
			expect(s.episodes).toBe(count < LEAD.episodeMinSlow ? 0 : 1);
			expect(s.keptOut).toBe(count < LEAD.episodeMinSlow ? 0 : count);
		}
	});

	it("three other trips in a row end the run: slow trips one in four never make an episode", () => {
		const gapEvery = LEAD.episodeGapSamples + 2;
		const count = 4 * LEAD.episodeMinSlow;
		const trip = sparseSlow(37, SETTLE_ECHOES + 10, gapEvery, count);
		const trace = settled(LEAD, CEILING, trip);
		trace.run({ seconds: 4, trip, late: () => false });
		expect(trace.ctl.stats().tripMax).toBe(SLOW);
		const s = trace.ctl.stats();
		expect(s.episodes).toBe(0);
		expect(s.keptOut).toBe(0);
	});

	it("bursts on top of an episode enter the cover (and are remembered after it)", () => {
		const from = SETTLE_SEC;
		const sec = 1.5;
		const ON_TOP = SLOW + SPIKE;
		const BURSTS = 5;
		const rng = new Rng(41);
		let burstsLeft = 0;
		/** The spike's own trips served (not the bursts). */
		let spikeServed = 0;
		const trip = (t: number) => {
			const steady = jittered(rng, STEADY, SPREAD);
			if (t < from || t >= from + sec) return steady;
			if (burstsLeft > 0) {
				burstsLeft--;
				return ON_TOP;
			}
			spikeServed++;
			return steady + SPIKE;
		};
		const trace = settled(LEAD, CEILING, trip);
		// Into the episode, then five bursts on top of it.
		trace.run({ seconds: 0.7, trip, late: () => false });
		const mid = trace.ctl.stats();
		expect(mid.episodeActive).toBe(true);
		burstsLeft = BURSTS;
		spikeServed = 0;
		trace.run({ seconds: sec - 0.7, trip, late: () => false });
		const s = trace.ctl.stats();
		print(
			`[lead] ${BURSTS} bursts on top of an episode: kept out ${mid.keptOut} -> ${s.keptOut}, p99 ${f2(
				mid.coverP99 ?? 0,
			)} -> ${f2(s.coverP99 ?? 0)}`,
		);
		expect(burstsLeft).toBe(0);
		expect(s.episodes).toBe(1);
		// Five of ~450 cover trips: the p99 is theirs; the spike's own trips stay out.
		expect(s.coverP99).toBe(ON_TOP);
		// The episode's own trips after the bursts were kept out; the bursts were not.
		expect(s.keptOut - mid.keptOut).toBe(spikeServed);
		// After the spike the cover still holds the lead at the ceiling for the bursts (they are bursts, not the spike).
		trace.run({ seconds: LEAD.windowSec + 3, trip, late: () => false });
		expect(trace.ctl.lead()).toBe(CEILING);
	});

	it("a lasting step: the episode ends once the base window's median follows, and the cover takes the new level", () => {
		const from = SETTLE_SEC;
		const STEP = 6;
		const rng = new Rng(43);
		const trip = (t: number) => jittered(rng, STEADY, SPREAD) + (t >= from ? STEP : 0);
		const trace = settled(LEAD, CEILING, trip);
		let endedAt: number | undefined;
		let wasActive = false;
		let minLead = math.huge;
		trace.run({
			seconds: LEAD.windowSec + 2,
			trip,
			late: () => false,
			onFrame: (t) => {
				const s = t.ctl.stats();
				if (s.episodeActive) wasActive = true;
				else if (wasActive && endedAt === undefined) endedAt = t.now();
				if (t.now() > from + 0.5) minLead = math.min(minLead, s.lead);
			},
		});
		const s = trace.ctl.stats();
		const took = (endedAt ?? math.huge) - from;
		print(
			`[lead] step +${STEP} ticks: episode over after ${f2(took)} s, kept out ${s.keptOut}, p99 ${f2(
				s.coverP99 ?? 0,
			)}`,
		);
		expect(wasActive).toBe(true);
		expect(s.episodes).toBe(1);
		// Half the base window (its median's rank) and a few echoes.
		expect(took <= LEAD.windowSec / 2 + 0.5).toBe(true);
		// The base covers the new level meanwhile; afterwards the new trips enter the cover.
		expect(minLead >= expectedTarget(STEADY + STEP - SPREAD)).toBe(true);
		expect((s.coverP99 ?? 0) > STEADY + STEP).toBe(true);
		expect(s.episodeActive).toBe(false);
	});

	/** The run's slow trips the controller keeps for an episode's level (private: read for the bound). */
	function runSlowSize(ctl: LeadController): number {
		return (ctl as unknown as { runSlowSorted: number[] }).runSlowSorted.size();
	}

	it("a bimodal link keeps an episode alive, but its level holds at most a cover window of slow trips", () => {
		const ECHOES_PER_SEC = SIM_HZ / BROADCAST_EVERY_TICKS;
		const MINUTES = 4;
		for (const every of [3, 2]) {
			// From the settle's end: one slow trip in `every` (at most every - 1 steady ones between: the run never ends).
			const rng = new Rng(53);
			let k = 0;
			let bimodal = false;
			const trip = () => {
				const steady = jittered(rng, STEADY, SPREAD);
				if (!bimodal) return steady;
				k++;
				return k % every === 0 ? SLOW : steady;
			};
			const trace = settled(LEAD, CEILING, trip);
			bimodal = true;
			let maxSize = 0;
			let minLead = math.huge;
			let slowServed = 0;
			trace.run({
				seconds: MINUTES * 60,
				trip,
				late: () => false,
				onFrame: (t) => {
					maxSize = math.max(maxSize, runSlowSize(t.ctl));
					if (t.now() > SETTLE_SEC + 1) minLead = math.min(minLead, t.ctl.lead());
				},
			});
			slowServed = math.floor(k / every);
			const s = trace.ctl.stats();
			const bound = (LEAD.coverWindowSec * ECHOES_PER_SEC) / every + 1;
			print(
				`[lead] bimodal 1 slow in ${every} for ${MINUTES} min: episodes ${s.episodes} (on ${s.episodeActive}), ` +
					`level trips max ${maxSize} (bound ${bound}; ${slowServed} slow served), kept out ${s.keptOut}, ` +
					`lead ${s.lead} min ${minLead} (base ${s.baseTarget} p95 ${f2(s.tripP95 ?? 0)} p99 ${f2(
						s.coverP99 ?? 0,
					)})`,
			);
			expect(maxSize <= bound).toBe(true);
			expect(slowServed > 4 * bound).toBe(true);
			// The lead stays safe: the base's p95 covers the slow mode the cover does not see.
			expect(s.tripP95).toBe(SLOW);
			expect(minLead >= expectedTarget(SLOW)).toBe(true);
			expect(s.lead).toBe(s.target);
			if (every === 3) {
				expect(s.episodes).toBe(1);
				expect(s.episodeActive).toBe(true);
				expect((s.coverP99 ?? 0) <= STEADY + SPREAD).toBe(true);
			}
		}
	});

	it("an echo outage ends the run: no episode shows (or holds) across it", () => {
		const from = SETTLE_SEC;
		const trip = spikeTrip(59, from, 3, SPIKE);
		const trace = settled(LEAD, CEILING, trip);
		trace.run({ seconds: 1, trip, late: () => false });
		expect(trace.ctl.stats().episodeActive).toBe(true);
		trace.run({ seconds: LEAD.echoTimeoutSec + 0.5, trip, echoes: false });
		const s = trace.ctl.stats();
		expect(s.echoing).toBe(false);
		expect(s.episodeActive).toBe(false);
		expect(s.episodes).toBe(1);
		expect(runSlowSize(trace.ctl)).toBe(0);
	});

	it("without a ceiling, or with lateBump, nothing changes: the same lead on every frame as with episodes off", () => {
		const from = SETTLE_SEC;
		const cases: Array<{ name: string; on: LeadTunables; off: LeadTunables; ceiling?: number }> = [
			{ name: "no ceiling", on: LEAD, off: NO_EPISODES },
			{ name: "lateBump", on: REV2, off: { ...REV2, episodes: false }, ceiling: CEILING },
		];
		for (const c of cases) {
			const traces = [c.on, c.off].map((tunables) => {
				const trip = spikeTrip(47, from, 1, SPIKE);
				const trace = settled(tunables, c.ceiling, trip);
				const leads: number[] = [];
				trace.run({ seconds: LEAD.coverWindowSec + 4, trip, onFrame: (t) => leads.push(t.ctl.lead()) });
				return { trace, leads };
			});
			const [a, b] = traces;
			let differ = 0;
			for (let k = 0; k < a.leads.size(); k++) if (a.leads[k] !== b.leads[k]) differ++;
			const s = a.trace.ctl.stats();
			print(
				`[lead] episodes with ${c.name}: ${differ} frames differ, episodes ${s.episodes}, kept out ${s.keptOut}`,
			);
			expect(differ).toBe(0);
			expect(s.episodes).toBe(undefined);
			expect(s.keptOut).toBe(0);
			expect(s.coverP99).toBe(b.trace.ctl.stats().coverP99);
		}
	});
});
