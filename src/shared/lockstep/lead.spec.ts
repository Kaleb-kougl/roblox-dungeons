// The co-op input lead from measured trips (docs/FRAME_PACING.md Revision 2, FP10): the LeadController on synthetic
// trip traces. A client steps and sends at 60 Hz and the server echoes every broadcast (30 a second) with a chosen net
// trip; the lead holds at ceil(p95 + margin) on a steady network, follows a step up in the same echo and a step down
// within the window + hold + a fall step per tick, ignores a single unflagged outlier, bumps a late to its own trip,
// never bounces with the p95 near a tick boundary, warms up on the max, and runs the legacy miss counter exactly while
// no echo arrives (before the first, and after the echo timeout, resuming on the next echo).
import { describe, expect, it } from "@rbxts/jest-globals";
import { Rng, SIM_HZ } from "shared/sim";
import {
	BROADCAST_EVERY_TICKS,
	INPUT_DELAY_TICKS,
	INPUT_LEAD_DECAY_TICKS,
	LEAD,
	LeadController,
	MAX_INPUT_LEAD_TICKS,
} from "shared/lockstep";

const MIN_LEAD = INPUT_DELAY_TICKS;
const MAX_LEAD = MAX_INPUT_LEAD_TICKS;

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
	private prevLead: number;

	constructor(decay: number = INPUT_LEAD_DECAY_TICKS) {
		this.ctl = new LeadController(LEAD, MIN_LEAD, MAX_LEAD, decay);
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
			const target = this.tick + ctl.lead();
			if (target > this.lastTarget) {
				ctl.sent(target, this.tick, 0, opts.hitched !== undefined && opts.hitched(now));
				this.sentAt.set(target, this.tick);
				this.lastTarget = target;
			}
			if (this.frames % every === 0) {
				ctl.received(now);
				if (opts.echoes !== false) {
					const x = this.lastTarget;
					const slack = x - (this.sentAt.get(x) ?? x) - opts.trip(now);
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

describe("LeadController", () => {
	it("measures a trip as the lead sent with, minus the slack, minus the buffer depth", () => {
		const ctl = new LeadController(LEAD, MIN_LEAD, MAX_LEAD, INPUT_LEAD_DECAY_TICKS);
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
		const ctl = new LeadController(LEAD, MIN_LEAD, MAX_LEAD, decay);
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
		const ctl = new LeadController(LEAD, MIN_LEAD, MAX_LEAD, INPUT_LEAD_DECAY_TICKS);
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
		const ctl = new LeadController(LEAD, MIN_LEAD, MAX_LEAD, INPUT_LEAD_DECAY_TICKS);
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

describe("LeadController: echoes that do not measure the network (review fixes)", () => {
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
