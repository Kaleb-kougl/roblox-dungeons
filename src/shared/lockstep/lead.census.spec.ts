/**
 * docs/FRAME_PACING.md Revision 3 (FP17): the measured lead on jittery links, today's rule against candidate rules,
 * on the real client, server, relay, pacer and echo (only the lead rule changes). OPT-IN CENSUS: without the runner's
 * `--census` flag it runs a smoke sample (12 s of the owner-like network: today's LeadController next to this spec's
 * copy of it, which must give the same lead every frame); with it (npm run test:only -- --census lockstep/lead.census),
 * every network x every rule, printed as the doc's tables (about 3.5 minutes; the VM shell's 3-minute cap needs two runs,
 * see the doc). `--flag lead.<network>` (repeatable, e.g. `--flag lead.owner`) keeps only those networks and
 * `--flag lead.rule.<rule>` only those rules (today's always runs first: the reference).
 *
 * A candidate is a lead rule written here, never wired into LeadController: `SpecLead` is lead.ts's rule copied with
 * knobs (what a late does, a second, longer "cover" window capped at the prediction cap, the fall), put in place of
 * each client's controller after its construction. Printed per network and rule: the effective lead (net + the
 * buffer's depth, inputLead()) and the net lead (mean / p95 / max over frames after the 2 s warm-up), the server's
 * late frames and the dropped changed inputs (the frame sent differs from the one the relay finalized: a correction
 * under local prediction) per 10 s, the relay's repeat-last ticks (lates and ticks never sent: a rise of the lead or
 * depth skips them), bumps and lead churn (the net lead's total change) per 10 s, the felt delay max(0, effective lead
 * - cap) at the prediction caps 20 and 10 (mean / p95), and the FP11 / FP12 gates where the network has one. Loose
 * assertions only: every run plays through measured, the copy matches today's rule exactly.
 *
 * Revision 3 (FP19): "today" is Revision 2's rule explicitly (`LEAD` with `lateBump: true`, no ceiling: what
 * `KV_LeadBump` builds), so its rows are the FP17 tables' exactly; `rule3` is the real, shipped LeadController
 * (`LEAD`'s defaults, built by LockstepClient with prediction on, so its ceiling is `PREDICTION.maxTicks`), which must
 * give `cov20`'s lead on every frame (asserted wherever both run, the smoke included), and is held to FPD18's gates
 * against today on the owner-like networks (printed: felt delay at cap 20 at most half, dropped changed inputs at most
 * today's, churn at most a third). `kvbump` is what `KV_LeadBump` builds with prediction on: the bump on top of the
 * cover (FP21's A/B), printed only.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { AXIS_MAX, Button, EMPTY_INPUT, Rng, SIM_HZ, inputsEqual, isFiniteNumber, playerAt } from "shared/sim";
import type { InputFrame, SimState } from "shared/sim";
import { DEFAULT_SEGMENT_LIMITS, SegmentedValidator, buildRunConfig } from "shared/run";
import { censusRequested } from "shared/run/testing";
import {
	DEFAULT_LOCKSTEP,
	LEAD,
	LockstepClient,
	LockstepSession,
	MergedDecoder,
	PACING,
	PREDICTION,
	decodeInputBatch,
	decodeInputEcho,
	nearestRank,
	type LeadEcho,
	type LeadStats,
	type LeadTunables,
	type LockstepTunables,
} from ".";

const FULL = censusRequested();
const SEED = 4242;
const DT = 1 / SIM_HZ;
const PLAYERS = 2;
/** Neutral input under the stage cover (docs/STAGE_LOADER.md SL7), as the real client. */
const COVER_SEC = 1;
/** Frames before this are the warm-up (FP11): left out of every number. */
const WARMUP_SEC = 2;
/** The owner's [Pace] window: rates are per this many seconds. */
const RATE_SEC = 10;
/** The prediction caps the felt delay is measured against (PREDICTION.maxTicks now and before). */
const CAPS = [20, 10];
const MS_PER_SEC = 1000;
const EPSILON = 1e-9;
const MEDIAN = 0.5;
const HIGH = 0.95;
/** FP12: the lead is back when within this many ticks of its value before the trouble. */
const RECOVER_TICKS = 1;
/** FP12: the recovery is watched this long after the trouble ended (seconds). */
const WATCH_SEC = 12;
/** FP12: slack on the fall's own bound (seconds). */
const TROUBLE_FALL_SLACK_SEC = 0.5;
/** FP11: relay misses (repeat-last ticks) after the warm-up stay under this share of ticks. */
const FP11_MISSED_SHARE = 0.005;
/** NetSpec.seedBase's default. */
const DEFAULT_CHANNEL_SEED = 7;

/** Revision 2's rule (FP17's "today"; Revision 3's KV_LeadBump): every late not excused bumps, no cover. */
const REV2_LEAD: LeadTunables = { ...LEAD, lateBump: true };

const TUNABLES: LockstepTunables = {
	...DEFAULT_LOCKSTEP,
	// No segment is offered within a run (the validator is never pumped: the server side is the relay and the echo).
	segmentTicks: SIM_HZ * 600,
	checkpointEvery: SIM_HZ * 2,
	allowDebugInput: true,
	pacing: PACING,
	lead: REV2_LEAD,
	// Read only (it never changes what is sent or stepped): off, to save the time. Without it the client's lead has no
	// ceiling (no cover): today's rule.
	prediction: undefined,
};
/** Revision 3 as shipped: LEAD's defaults, and prediction on, so LockstepClient gives the lead its ceiling. */
const RULE3_TUNABLES: LockstepTunables = { ...TUNABLES, lead: LEAD, prediction: PREDICTION };
/** KV_LeadBump as built (FP20): the shipped client with `lateBump` (prediction on: the cover stays, plus the bump). */
const KV_BUMP_TUNABLES: LockstepTunables = { ...RULE3_TUNABLES, lead: REV2_LEAD };
/** FPD18's gates are held on these networks. */
const GATE_NETWORKS = ["owner", "owner2", "ownerS"];
/** FPD18: felt delay at cap 20 at most this share of today's, churn at most this share; dropped at most today's. */
const GATE_FELT_SHARE = 0.5;
const GATE_CHURN_SHARE = 1 / 3;
const SEG_LIMITS = { ...DEFAULT_SEGMENT_LIMITS, checkpointEvery: SIM_HZ * 2, allowDebugInput: true };

// ---------------------------------------------------------------------------------------------------------------
// Networks

interface Trouble {
	readonly at: number;
	readonly sec: number;
	readonly extra: number;
}

/**
 * One way, the same both ways (each client its own two channels): base + U(0, jitter) per DT slot; with `spikeChance`
 * per slot that slot's messages take U(spikeLo, spikeHi) more (a lost packet's retransmit: FIFO, so every later
 * message waits behind it, a head-of-line hold). `upSpike`: a scheduled +extra for every up message sent in [at, at +
 * sec) (FP12's spike); `upHold`: nothing delivered up in [at, at + sec) (FP12's hold).
 */
interface NetSpec {
	readonly name: string;
	readonly label: string;
	readonly baseSec: number;
	readonly jitterSec: number;
	readonly spikeChance: number;
	/** The down channel's spike chance (default spikeChance). */
	readonly downSpikeChance?: number;
	readonly spikeLoSec: number;
	readonly spikeHiSec: number;
	readonly durationSec: number;
	readonly upSpike?: Trouble;
	readonly upHold?: Trouble;
	/** Gates measured on this network. */
	readonly gate?: "fp11" | "fp12";
	/** Client i's down / up channels are seeded seedBase + 2i / + 1 (default 7, predict.net.spec's). */
	readonly seedBase?: number;
}

const NETWORKS: ReadonlyArray<NetSpec> = [
	{
		name: "owner",
		label: "owner-like (Studio 4G): 78-84 ms one way, 1.2 % of up slots +120-175 ms (head-of-line), 0.2 % down",
		baseSec: 0.078,
		jitterSec: 0.006,
		spikeChance: 0.012,
		downSpikeChance: 0.002,
		spikeLoSec: 0.12,
		spikeHiSec: 0.175,
		durationSec: 62,
	},
	{
		name: "owner2",
		label: "owner-like, harsher: 78-84 ms one way, 2 % of up slots +100-200 ms (head-of-line), 0.2 % down",
		baseSec: 0.078,
		jitterSec: 0.006,
		spikeChance: 0.02,
		downSpikeChance: 0.002,
		spikeLoSec: 0.1,
		spikeHiSec: 0.2,
		durationSec: 62,
	},
	{
		name: "ownerS",
		label: "owner-like, other channel seeds: 78-84 ms one way, 1.2 % of up slots +120-175 ms, 0.2 % down",
		baseSec: 0.078,
		jitterSec: 0.006,
		spikeChance: 0.012,
		downSpikeChance: 0.002,
		spikeLoSec: 0.12,
		spikeHiSec: 0.175,
		durationSec: 62,
		seedBase: 101,
	},
	{
		name: "jitter",
		label: "4G jitter: 50-130 ms one way, 0.4 % of slots +80-200 ms both ways",
		baseSec: 0.05,
		jitterSec: 0.08,
		spikeChance: 0.004,
		spikeLoSec: 0.08,
		spikeHiSec: 0.2,
		durationSec: 62,
	},
	{
		name: "clean",
		label: "clean: 30-40 ms one way",
		baseSec: 0.03,
		jitterSec: 0.01,
		spikeChance: 0,
		spikeLoSec: 0,
		spikeHiSec: 0,
		durationSec: 32,
	},
	{
		name: "spec",
		label: "FP11 spec: 20-120 ms one way",
		baseSec: 0.02,
		jitterSec: 0.1,
		spikeChance: 0,
		spikeLoSec: 0,
		spikeHiSec: 0,
		durationSec: 32,
		gate: "fp11",
	},
	{
		name: "spec200",
		label: "FP11 spec: 0-200 ms one way",
		baseSec: 0,
		jitterSec: 0.2,
		spikeChance: 0,
		spikeLoSec: 0,
		spikeHiSec: 0,
		durationSec: 32,
		gate: "fp11",
	},
	{
		name: "fp12",
		label: "FP12: 20-120 ms one way, +200 ms up for 1 s at 7 s",
		baseSec: 0.02,
		jitterSec: 0.1,
		spikeChance: 0,
		spikeLoSec: 0,
		spikeHiSec: 0,
		durationSec: 7 + 1 + WATCH_SEC + 1,
		upSpike: { at: 7, sec: 1, extra: 0.2 },
		gate: "fp12",
	},
	{
		name: "longhold",
		label: "one-off: 70-82 ms one way, a 600 ms up hold at 15 s",
		baseSec: 0.07,
		jitterSec: 0.012,
		spikeChance: 0,
		spikeLoSec: 0,
		spikeHiSec: 0,
		durationSec: 15 + 0.6 + WATCH_SEC + 1,
		upHold: { at: 15, sec: 0.6, extra: 0.6 },
		gate: "fp12",
	},
];

interface Message {
	readonly at: number;
	readonly deliver: () => void;
}

/** One-way FIFO channel (a reliable ordered remote); its latency is drawn per DT slot from its own generator. */
class Channel {
	private readonly queue: Message[] = [];
	private readonly latencies: number[] = [];
	private readonly rng: Rng;
	private last = 0;
	constructor(seed: number, private readonly net: NetSpec, private readonly isUp: boolean) {
		this.rng = new Rng(seed);
	}

	private latencyAt(now: number): number {
		const n = this.net;
		const slot = math.max(0, math.floor(now / DT + 0.5));
		while (this.latencies.size() <= slot) {
			const jitter = this.rng.next();
			const roll = this.rng.next();
			const extra = this.rng.next();
			let lat = n.baseSec + n.jitterSec * jitter;
			const chance = this.isUp ? n.spikeChance : n.downSpikeChance ?? n.spikeChance;
			if (roll < chance) lat += n.spikeLoSec + (n.spikeHiSec - n.spikeLoSec) * extra;
			this.latencies.push(lat);
		}
		const ev = this.isUp ? n.upSpike : undefined;
		const add = ev !== undefined && now >= ev.at && now < ev.at + ev.sec ? ev.extra : 0;
		return this.latencies[slot] + add;
	}

	send(now: number, deliver: () => void): void {
		const at = math.max(this.last, now + this.latencyAt(now));
		this.last = at;
		this.queue.push({ at, deliver });
	}

	pump(now: number): void {
		const hold = this.isUp ? this.net.upHold : undefined;
		if (hold !== undefined && now >= hold.at && now < hold.at + hold.sec) return;
		while (this.queue.size() > 0 && this.queue[0].at <= now) this.queue.remove(0)!.deliver();
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Candidate rules

/** What LockstepClient calls on its lead controller (LeadController's surface). */
interface LeadLike {
	sent(target: number, sentAt: number, depthRaw: number, hitched: boolean, depthUsed?: number): void;
	received(now: number): void;
	echoed(echo: LeadEcho, now: number): void;
	deadline(matched: boolean, now: number): void;
	frame(now: number): void;
	lead(): number;
	echoing(): boolean;
	stats(): LeadStats;
}

interface Policy {
	readonly name: string;
	readonly label: string;
	/** undefined: the real LeadController (today); else SpecLead with these knobs. */
	readonly spec?: SpecKnobs;
	/** The clients' tunables (default TUNABLES: today's rule). */
	readonly tunables?: LockstepTunables;
}

interface SpecKnobs {
	readonly lead: LeadTunables;
	/** An echoed late: "trip" bumps to its own trip (today), "one" one tick over the lead it was sent with, "none" counts. */
	readonly bump: "trip" | "one" | "none";
	/** Late echoes within `bumpWindowSec` before one bumps (1: every late echo bumps, today). */
	readonly bumpAfter: number;
	readonly bumpWindowSec: number;
	/** Cap-aware: a bump never takes the effective lead past this (the window target still can). */
	readonly bumpCeiling?: number;
	/** A late that does not bump restarts the fall hold all the same. */
	readonly lateHolds: boolean;
	/**
	 * A second, longer window (the cover): the lead target is max(the base target, min(the cover's, ceiling)), with
	 * ceiling = coverCeiling - the depth the lead last added (the prediction cap: what the drawn knight hides).
	 */
	readonly cover?: { readonly windowSec: number; readonly percentile: number; readonly ceiling?: number };
}

const ascending = (a: number, b: number) => a < b;
const NO_RECORD = -1;

function ceilTicks(x: number): number {
	return math.ceil(x - EPSILON);
}

/**
 * lead.ts's LeadController copied, with SpecKnobs (FP17's candidates). With TODAY_KNOBS it must give exactly the real
 * controller's lead (asserted by the smoke run).
 */
class SpecLead implements LeadLike {
	private readonly t: LeadTunables;
	private readonly ringSize: number;
	private leadValue: number;
	private cleanTicks = 0;
	private readonly recTarget: number[] = [];
	private readonly recSentAt: number[] = [];
	private readonly recDepth: number[] = [];
	private readonly recHitched: boolean[] = [];
	private readonly recDepthUsed: number[] = [];
	private readonly recLead: number[] = [];
	private newestSent: number | undefined;
	private lastDepthUsed = 0;
	private echoedThrough: number | undefined;
	private readonly winAt: number[] = [];
	private readonly winTrip: number[] = [];
	private readonly scratch: number[] = [];
	private dirty = false;
	private p50: number | undefined;
	private pHigh: number | undefined;
	private pMax: number | undefined;
	private isEchoing = false;
	private lastEchoAt: number | undefined;
	private lastNow: number | undefined;
	private holdFrom: number | undefined;
	private lastFallAt: number | undefined;
	private readonly lateEchoAt: number[] = [];
	private readonly covAt: number[] = [];
	private readonly covTrip: number[] = [];
	private covHigh: number | undefined;
	private lateCount = 0;
	private mismatchCount = 0;
	private bumpCount = 0;
	private excusedCount = 0;
	private raiseCount = 0;
	private fallCount = 0;

	constructor(
		private readonly k: SpecKnobs,
		private readonly minLead: number,
		private readonly maxLead: number,
		private readonly legacyDecayTicks: number,
	) {
		this.t = k.lead;
		this.leadValue = minLead;
		const size = math.max(1, math.floor(this.t.recordTicks));
		this.ringSize = size;
		for (let i = 0; i < size; i++) {
			this.recTarget.push(NO_RECORD);
			this.recSentAt.push(0);
			this.recDepth.push(0);
			this.recHitched.push(false);
			this.recDepthUsed.push(0);
			this.recLead.push(minLead);
		}
	}

	sent(target: number, sentAt: number, depthRaw: number, hitched: boolean, depthUsed: number = depthRaw): void {
		if (!isFiniteNumber(target) || !isFiniteNumber(sentAt) || target < 0 || target !== math.floor(target)) return;
		if (this.newestSent !== undefined && target <= this.newestSent) return;
		const slot = target % this.ringSize;
		this.recTarget[slot] = target;
		this.recSentAt[slot] = sentAt;
		this.recDepth[slot] = isFiniteNumber(depthRaw) ? depthRaw : 0;
		this.recHitched[slot] = hitched;
		this.recDepthUsed[slot] = isFiniteNumber(depthUsed) ? depthUsed : this.recDepth[slot];
		this.recLead[slot] = this.leadValue;
		this.lastDepthUsed = this.recDepthUsed[slot];
		this.newestSent = target;
	}

	received(now: number): void {
		const clock = this.clock(now);
		if (clock === undefined || !this.isEchoing || this.lastEchoAt === undefined) return;
		if (clock - this.lastEchoAt + EPSILON >= this.t.echoTimeoutSec) {
			this.isEchoing = false;
			this.cleanTicks = 0;
			this.resetHold();
		}
	}

	echoed(echo: LeadEcho, now: number): void {
		const clock = this.clock(now);
		if (clock === undefined) return;
		const lates = isFiniteNumber(echo.lates) && echo.lates > 0 ? math.floor(echo.lates) : 0;
		this.lateCount += lates;
		const tick = echo.tick;
		const serverCatchUp = echo.catchingUp === true;
		let trip: number | undefined;
		let sentLead: number | undefined;
		let excused = serverCatchUp;
		if (tick !== undefined && isFiniteNumber(tick)) {
			if (!this.isEchoing) {
				this.isEchoing = true;
				this.cleanTicks = 0;
				this.resetHold();
			}
			if (this.echoedThrough === undefined || tick > this.echoedThrough) {
				this.echoedThrough = tick;
				const slot = this.slotOf(tick);
				if (slot !== undefined) {
					sentLead = this.recLead[slot];
					const depth = this.recDepth[slot];
					const tr = tick - this.recSentAt[slot] - echo.slack - depth;
					if (this.recHitched[slot]) excused = true;
					const uncovered = depth - this.recDepthUsed[slot];
					if (uncovered > EPSILON && uncovered + EPSILON >= -echo.slack) excused = true;
					if (!this.recHitched[slot] && !serverCatchUp && isFiniteNumber(tr)) {
						trip = tr;
						this.winAt.push(clock);
						this.winTrip.push(tr);
						if (this.k.cover !== undefined) {
							this.covAt.push(clock);
							this.covTrip.push(tr);
						}
						this.dirty = true;
					}
				}
			}
		}
		if (this.isEchoing) this.lastEchoAt = clock;
		this.refresh(clock);
		if (!this.isEchoing) return;
		let raised = this.leadValue;
		const target = this.windowTarget();
		if (target !== undefined && target > raised) {
			raised = target;
			this.raiseCount++;
		}
		if (lates > 0 && excused) {
			this.excusedCount++;
		} else if (lates > 0) {
			const k = this.k;
			this.lateEchoAt.push(clock);
			while (this.lateEchoAt.size() > 0 && this.lateEchoAt[0] < clock - k.bumpWindowSec - EPSILON) {
				this.lateEchoAt.remove(0);
			}
			if (k.bump !== "none" && this.lateEchoAt.size() >= k.bumpAfter) {
				let bump = (sentLead ?? this.leadValue) + 1;
				if (k.bump === "trip" && trip !== undefined) {
					bump = math.max(bump, ceilTicks(trip + this.t.marginTicks));
				}
				if (k.bumpCeiling !== undefined) bump = math.min(bump, k.bumpCeiling - this.lastDepthUsed);
				bump = this.clampLead(bump);
				if (bump > raised) raised = bump;
				this.bumpCount++;
				this.restartHold(clock);
			} else if (k.lateHolds) {
				this.restartHold(clock);
			}
		}
		this.leadValue = raised;
	}

	deadline(matched: boolean, now: number): void {
		if (!this.isEchoing) {
			if (matched) {
				this.cleanTicks++;
				if (this.cleanTicks >= this.legacyDecayTicks && this.leadValue > this.minLead) {
					this.leadValue--;
					this.cleanTicks = 0;
				}
				return;
			}
			this.mismatchCount++;
			this.cleanTicks = 0;
			if (this.leadValue < this.maxLead) this.leadValue++;
			return;
		}
		if (!matched) this.mismatchCount++;
	}

	frame(now: number): void {
		const clock = this.clock(now);
		if (clock === undefined) return;
		this.refresh(clock);
		const n = this.winTrip.size();
		if (!this.isEchoing || n === 0) {
			this.resetHold();
			return;
		}
		const target = this.windowTarget();
		if (target !== undefined && target > this.leadValue) {
			this.leadValue = target;
			this.raiseCount++;
		}
		const t = this.t;
		if (n < t.minSamples) {
			this.resetHold();
			return;
		}
		if (this.fallTarget() >= this.leadValue) {
			this.resetHold();
			return;
		}
		if (this.holdFrom === undefined) this.holdFrom = clock;
		if (clock - this.holdFrom + EPSILON < t.fallHoldSec) return;
		if (this.lastFallAt !== undefined && clock - this.lastFallAt + EPSILON < t.fallStepSec) return;
		this.leadValue--;
		this.fallCount++;
		this.lastFallAt = clock;
	}

	lead(): number {
		return this.leadValue;
	}

	echoing(): boolean {
		return this.isEchoing;
	}

	stats(): LeadStats {
		const n = this.winTrip.size();
		return {
			lead: this.leadValue,
			target: this.windowTarget() ?? this.leadValue,
			fallTarget: n > 0 ? this.fallTarget() : this.leadValue,
			baseTarget: this.clampLead(
				ceilTicks(((n < this.t.minSamples ? this.pMax : this.pHigh) ?? 0) + this.t.marginTicks),
			),
			coverP99: this.covHigh,
			coverTarget:
				this.covHigh !== undefined ? this.clampLead(ceilTicks(this.covHigh + this.t.marginTicks)) : undefined,
			ceiling: this.k.cover?.ceiling !== undefined ? this.k.cover.ceiling - this.lastDepthUsed : undefined,
			tripP50: this.p50,
			tripP95: this.pHigh,
			tripMax: this.pMax,
			samples: n,
			warmingUp: n < this.t.minSamples,
			lates: this.lateCount,
			mismatches: this.mismatchCount,
			bumps: this.bumpCount,
			excused: this.excusedCount,
			raises: this.raiseCount,
			falls: this.fallCount,
			echoing: this.isEchoing,
		};
	}

	private clock(now: number): number | undefined {
		let c = isFiniteNumber(now) ? now : this.lastNow;
		if (c === undefined) return undefined;
		if (this.lastNow !== undefined && c < this.lastNow) c = this.lastNow;
		this.lastNow = c;
		return c;
	}

	private slotOf(tick: number): number | undefined {
		if (tick < 0 || tick !== math.floor(tick)) return undefined;
		const slot = tick % this.ringSize;
		return this.recTarget[slot] === tick ? slot : undefined;
	}

	private clampLead(x: number): number {
		return math.clamp(x, this.minLead, this.maxLead);
	}

	private windowTarget(): number | undefined {
		const n = this.winTrip.size();
		if (n === 0) return undefined;
		const p = n < this.t.minSamples ? this.pMax : this.pHigh;
		if (p === undefined) return undefined;
		return this.withCover(ceilTicks(p + this.t.marginTicks), 0, n < this.t.minSamples);
	}

	private fallTarget(): number {
		const p = this.pHigh ?? 0;
		return this.withCover(ceilTicks(p + this.t.marginTicks + this.t.fallSlackTicks), this.t.fallSlackTicks, false);
	}

	/** max(base, min(the cover's target + slack, ceiling)), clamped; the base alone without a cover (or warming up). */
	private withCover(base: number, slack: number, warming: boolean): number {
		const cov = this.k.cover;
		if (cov === undefined || warming || this.covHigh === undefined) return this.clampLead(base);
		let c = ceilTicks(this.covHigh + this.t.marginTicks + slack);
		if (cov.ceiling !== undefined) c = math.min(c, cov.ceiling - this.lastDepthUsed);
		return this.clampLead(math.max(base, c));
	}

	private resetHold(): void {
		this.holdFrom = undefined;
		this.lastFallAt = undefined;
	}

	private restartHold(clock: number): void {
		this.holdFrom = clock;
		this.lastFallAt = undefined;
	}

	private refresh(now: number): void {
		const cov = this.k.cover;
		if (cov !== undefined) {
			const keepCov = now - cov.windowSec;
			let changed = false;
			while (this.covAt.size() > 0 && this.covAt[0] < keepCov) {
				this.covAt.remove(0);
				this.covTrip.remove(0);
				changed = true;
			}
			if (changed || this.dirty) {
				const sc: number[] = [];
				for (const x of this.covTrip) sc.push(x);
				sc.sort(ascending);
				this.covHigh = nearestRank(sc, cov.percentile);
			}
		}
		const keep = now - this.t.windowSec;
		while (this.winAt.size() > 0 && this.winAt[0] < keep) {
			this.winAt.remove(0);
			this.winTrip.remove(0);
			this.dirty = true;
		}
		if (!this.dirty) return;
		this.dirty = false;
		const scratch = this.scratch;
		scratch.clear();
		const n = this.winTrip.size();
		for (let i = 0; i < n; i++) scratch.push(this.winTrip[i]);
		scratch.sort(ascending);
		this.p50 = nearestRank(scratch, MEDIAN);
		this.pHigh = nearestRank(scratch, this.t.percentile);
		this.pMax = n > 0 ? scratch[n - 1] : undefined;
	}
}

const TODAY_KNOBS: SpecKnobs = { lead: LEAD, bump: "trip", bumpAfter: 1, bumpWindowSec: 0, lateHolds: true };

const NO_BUMP: SpecKnobs = { ...TODAY_KNOBS, bump: "none", lateHolds: false };

const TODAY: Policy = { name: "today", label: "today (LeadController, Revision 2: LEAD with lateBump, no ceiling)" };
const RULE3: Policy = {
	name: "rule3",
	label: "Revision 3 as built: LeadController with LEAD, ceiling PREDICTION.maxTicks (prediction on)",
	tunables: RULE3_TUNABLES,
};
const COPY: Policy = { name: "copy", label: "today, this spec's copy", spec: TODAY_KNOBS };

const CANDIDATES: ReadonlyArray<Policy> = [
	TODAY,
	{
		name: "k2",
		label: "bump to the trip only on the 2nd late echo within 3 s",
		spec: { ...TODAY_KNOBS, bumpAfter: 2, bumpWindowSec: 3 },
	},
	{ name: "plus1", label: "a late bumps +1 (not to its trip)", spec: { ...TODAY_KNOBS, bump: "one" } },
	{
		name: "nobump",
		label: "p95 / 5 s, lates never bump (the miss budget)",
		spec: { ...TODAY_KNOBS, bump: "none", lateHolds: false },
	},
	{
		name: "p99w15",
		label: "p99 / 15 s, lates never bump, fall 0.5 s + 0.1 s a tick",
		spec: {
			...TODAY_KNOBS,
			lead: { ...LEAD, windowSec: 15, percentile: 0.99, fallHoldSec: 0.5, fallStepSec: 0.1 },
			bump: "none",
			lateHolds: false,
		},
	},
	{
		name: "p98w10",
		label: "p98 / 10 s, lates never bump",
		spec: { ...TODAY_KNOBS, lead: { ...LEAD, windowSec: 10, percentile: 0.98 }, bump: "none", lateHolds: false },
	},
	{
		name: "cap20",
		label: "today, bumps capped at effective lead 20 (the prediction cap)",
		spec: { ...TODAY_KNOBS, bumpCeiling: 20 },
	},
	{
		name: "cov20",
		label: "no bump; max(p95 / 5 s, min(p99 / 15 s, 20 - depth)) + margin",
		spec: { ...NO_BUMP, cover: { windowSec: 15, percentile: 0.99, ceiling: 20 } },
	},
	RULE3,
	{
		name: "kvbump",
		label: "KV_LeadBump as built: LeadController with lateBump, ceiling PREDICTION.maxTicks (the cover and the bump)",
		tunables: KV_BUMP_TUNABLES,
	},
	{
		name: "cov20m",
		label: "no bump; max(p95 / 5 s, min(max / 10 s, 20 - depth)) + margin",
		spec: { ...NO_BUMP, cover: { windowSec: 10, percentile: 1, ceiling: 20 } },
	},
	{
		name: "fast",
		label: "today's bump, falls after 0.3 s at 0.05 s a tick",
		spec: { ...TODAY_KNOBS, lead: { ...LEAD, fallHoldSec: 0.3, fallStepSec: 0.05 } },
	},
	{
		name: "cov20bf",
		label: "cov20 + today's late bump (uncapped), falls after 0.3 s at 0.05 s a tick",
		spec: {
			...TODAY_KNOBS,
			lead: { ...LEAD, fallHoldSec: 0.3, fallStepSec: 0.05 },
			cover: { windowSec: 15, percentile: 0.99, ceiling: 20 },
		},
	},
	{
		name: "cov20f",
		label: "cov20, falls after 0.5 s at 0.1 s a tick",
		spec: {
			...NO_BUMP,
			lead: { ...LEAD, fallHoldSec: 0.5, fallStepSec: 0.1 },
			cover: { windowSec: 15, percentile: 0.99, ceiling: 20 },
		},
	},
];

// ---------------------------------------------------------------------------------------------------------------
// The harness

/** predict.net.spec's scripted player (walks, rolls, swings, guards), no debug hit; neutral under the stage cover. */
function botInput(s: SimState, i: number, coverTicks: number): InputFrame {
	if (s.tick < coverTicks) return { ...EMPTY_INPUT };
	const p = playerAt(s, i);
	const t = s.tick + i * 23;
	const dir = math.floor(t / 40) % 2 === 0 ? 1 : -1;
	let buttons = 0;
	if (t % 77 === 0) buttons = bit32.bor(buttons, Button.ROLL);
	if (t % 9 < 3) buttons = bit32.bor(buttons, Button.FIRE);
	if (t % 150 < 20) buttons = bit32.bor(buttons, Button.ALT);
	return { moveX: p.dead !== 0 ? 0 : dir * 600, moveZ: ((i % 3) - 1) * 300, aimX: dir * AXIS_MAX, aimZ: 0, buttons };
}

interface ClientRun {
	/** Per frame (all frames of the run): the clock, inputLead() and netLead(). */
	readonly at: number[];
	readonly eff: number[];
	readonly net: number[];
	/** Every echoed trip (ticks) the harness decoded, from its own send records, and the clock it arrived. */
	readonly tripAt: number[];
	readonly trip: number[];
	/** The controller's stats at each RATE_SEC mark (the owner's [Pace] lines). */
	readonly marks: LeadStats[];
	/** After the warm-up: server late frames, relay repeat-last ticks, dropped changed inputs, ticks finalized. */
	lates: number;
	missed: number;
	dropped: number;
	ticks: number;
	bumps: number;
	holds: number;
	measuredAtEnd: boolean;
}

interface NetRun {
	readonly clients: ClientRun[];
	readonly finalized: number;
	readonly sec: number;
}

function controllerOf(policy: Policy): LeadLike | undefined {
	const k = policy.spec;
	if (k === undefined) return undefined;
	const t = TUNABLES;
	return new SpecLead(k, t.inputDelay, t.maxInputLead, t.leadDecayTicks);
}

function play(net: NetSpec, policy: Policy, durationSec: number): NetRun {
	const t0 = os.clock();
	const setupOf = () => buildRunConfig(SEED, { world: "dungeonNoEncounter", partySize: PLAYERS });
	const setup = setupOf();
	const members: number[] = [];
	for (let i = 0; i < PLAYERS; i++) members.push(1000 + i);
	const validator = new SegmentedValidator({
		runId: "lead",
		seed: SEED,
		worldKind: "dungeonNoEncounter",
		setup,
		createdAt: 0,
		limits: SEG_LIMITS,
	});
	const session = new LockstepSession({
		runId: "lead",
		seed: SEED,
		spawn: setup.spawn!,
		members,
		validator,
		startedAt: 0,
		tunables: TUNABLES,
	});
	const clients: LockstepClient[] = [];
	const runs: ClientRun[] = [];
	const down: Channel[] = [];
	const up: Channel[] = [];
	const sendTick: Array<Map<number, number>> = [];
	const sendDepth: Array<Map<number, number>> = [];
	const sentFrames: Array<Map<number, InputFrame>> = [];
	const ctls: LeadLike[] = [];
	for (let i = 0; i < PLAYERS; i++) {
		const own = setupOf();
		const c = new LockstepClient({
			runId: "lead",
			seed: SEED,
			spawn: own.spawn!,
			config: own.config,
			players: PLAYERS,
			localIndex: i,
			tunables: policy.tunables ?? TUNABLES,
		});
		const ctl = controllerOf(policy);
		if (ctl !== undefined) (c as unknown as { leadCtl: LeadLike }).leadCtl = ctl;
		clients.push(c);
		const seedBase = net.seedBase ?? DEFAULT_CHANNEL_SEED;
		down.push(new Channel(seedBase + 2 * i, net, false));
		up.push(new Channel(seedBase + 2 * i + 1, net, true));
		sendTick.push(new Map());
		sendDepth.push(new Map());
		sentFrames.push(new Map());
		runs.push({
			at: [],
			eff: [],
			net: [],
			tripAt: [],
			trip: [],
			marks: [],
			lates: 0,
			missed: 0,
			dropped: 0,
			ticks: 0,
			bumps: 0,
			holds: 0,
			measuredAtEnd: false,
		});
	}
	const decoder = new MergedDecoder(PLAYERS);
	const log: InputFrame[][] = [];
	const coverTicks = math.floor(COVER_SEC * SIM_HZ + 0.5);
	const frames = math.floor(durationSec * SIM_HZ + 0.5);
	let now = 0;
	let lateAtWarmup: number[] | undefined;
	let missedAtWarmup: number[] = [];
	let warmTick = 0;
	let nextMark = RATE_SEC;
	for (let frame = 0; frame < frames; frame++) {
		now += DT;
		for (const ch of up) ch.pump(now);
		const out = session.step(now);
		for (const b of out.broadcasts) {
			for (const row of decoder.decode(b.data)!) log.push(row);
			for (let i = 0; i < PLAYERS; i++) {
				const c = clients[i];
				const echo = b.echoes[i];
				const run = runs[i];
				const st = sendTick[i];
				const sd = sendDepth[i];
				down[i].send(now, () => {
					const e = decodeInputEcho(echo, b.firstTick);
					if (e !== undefined && e.tick !== undefined && e.catchingUp !== true) {
						const sentAt = st.get(e.tick);
						if (sentAt !== undefined) {
							run.tripAt.push(now);
							run.trip.push(e.tick - sentAt - e.slack - (sd.get(e.tick) ?? 0));
						}
					}
					c.receive(b.firstTick, b.data, now, echo);
					c.acknowledge(out.ackTick);
				});
			}
		}
		expect(out.ended).toBe(undefined);
		if (lateAtWarmup === undefined && now >= WARMUP_SEC) {
			const rs = session.getRelay().getStats();
			lateAtWarmup = [...rs.late];
			missedAtWarmup = [...rs.missed];
			warmTick = session.finalizedTicks();
		}
		for (let i = 0; i < PLAYERS; i++) {
			down[i].pump(now);
			const c = clients[i];
			const user = members[i];
			const st = sendTick[i];
			const sd = sendDepth[i];
			const res = c.pump(
				DT,
				(sending) => {
					if (sending) {
						const target = c.nextInputTick();
						st.set(target, c.state.tick);
						sd.set(target, (c.pacingStats()?.depthMs ?? 0) / MS_PER_SEC / DT);
						return botInput(c.state, i, coverTicks);
					}
					return { ...EMPTY_INPUT };
				},
				now,
			);
			const run = runs[i];
			run.at.push(now);
			run.eff.push(c.inputLead());
			run.net.push(c.netLead());
			for (const inp of res.inputs) {
				const fs = decodeInputBatch(inp.data, TUNABLES.maxBatchFrames)!;
				for (let j = 0; j < fs.size(); j++) sentFrames[i].set(inp.firstTick + j, fs[j]);
				up[i].send(now, () => session.submitInput(user, inp.firstTick, inp.data, now));
			}
			if (res.hashes.size() > 0) {
				const ticks = res.hashes.map((h) => h.tick);
				const hashes = res.hashes.map((h) => h.hash);
				up[i].send(now, () => session.reportHashes(user, ticks, hashes));
			}
			expect(res.final).toBe(undefined);
		}
		if (now + EPSILON >= nextMark) {
			nextMark += RATE_SEC;
			for (let i = 0; i < PLAYERS; i++) runs[i].marks.push(clients[i].leadStats()!);
		}
	}
	const rs = session.getRelay().getStats();
	const finalized = session.finalizedTicks();
	for (let i = 0; i < PLAYERS; i++) {
		const run = runs[i];
		run.lates = rs.late[i] - (lateAtWarmup?.[i] ?? 0);
		run.missed = rs.missed[i] - (missedAtWarmup[i] ?? 0);
		run.ticks = finalized - warmTick;
		let dropped = 0;
		for (let tick = warmTick; tick < log.size(); tick++) {
			const mine = sentFrames[i].get(tick);
			if (mine !== undefined && !inputsEqual(mine, log[tick][i])) dropped++;
		}
		run.dropped = dropped;
		const st = clients[i].leadStats()!;
		run.bumps = st.bumps;
		run.holds = clients[i].pacingStats()?.holds ?? 0;
		run.measuredAtEnd = clients[i].isLeadMeasured();
		expect(clients[i].brokenReason()).toBe(undefined);
	}
	return { clients: runs, finalized, sec: os.clock() - t0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers

interface Summary {
	readonly effMean: number;
	readonly effP95: number;
	readonly effMax: number;
	readonly netMean: number;
	readonly netP95: number;
	readonly netMax: number;
	/** Per RATE_SEC, both clients averaged. */
	readonly latesRate: number;
	readonly droppedRate: number;
	readonly bumpsRate: number;
	/** Net lead changes (sum of |a frame's change|) per RATE_SEC: each rise repeats an input, each fall skips one. */
	readonly churnRate: number;
	/** Relay repeat-last ticks after the warm-up, share of ticks (worst client). */
	readonly missedShare: number;
	/** Relay repeat-last ticks that were never late (the lead or depth jumped past them), share of ticks (all clients). */
	readonly neverSentShare: number;
	readonly lates: number;
	/** Per cap (CAPS order): felt delay mean and p95 (ticks). */
	readonly feltMean: number[];
	readonly feltP95: number[];
	readonly tripP50: number;
	readonly tripP95: number;
	readonly tripMax: number;
}

function sortedCopy(xs: ReadonlyArray<number>): number[] {
	const out: number[] = [];
	for (const x of xs) out.push(x);
	out.sort(ascending);
	return out;
}

function summarize(r: NetRun, durationSec: number): Summary {
	const eff: number[] = [];
	const netL: number[] = [];
	const felt: number[][] = CAPS.map(() => []);
	const trips: number[] = [];
	let lates = 0;
	let dropped = 0;
	let bumps = 0;
	let missedShare = 0;
	let missed = 0;
	let ticks = 0;
	let churn = 0;
	for (const c of r.clients) {
		for (let k = 1; k < c.at.size(); k++) if (c.at[k] >= WARMUP_SEC) churn += math.abs(c.net[k] - c.net[k - 1]);
		missed += c.missed;
		ticks += c.ticks;
		for (let k = 0; k < c.at.size(); k++) {
			if (c.at[k] < WARMUP_SEC) continue;
			eff.push(c.eff[k]);
			netL.push(c.net[k]);
			for (let j = 0; j < CAPS.size(); j++) felt[j].push(math.max(0, c.eff[k] - CAPS[j]));
		}
		for (let k = 0; k < c.tripAt.size(); k++) if (c.tripAt[k] >= WARMUP_SEC) trips.push(c.trip[k]);
		lates += c.lates;
		dropped += c.dropped;
		bumps += c.bumps;
		missedShare = math.max(missedShare, c.ticks > 0 ? c.missed / c.ticks : 0);
	}
	const mean = (xs: ReadonlyArray<number>) => {
		let s = 0;
		for (const x of xs) s += x;
		return xs.size() > 0 ? s / xs.size() : 0;
	};
	const se = sortedCopy(eff);
	const sn = sortedCopy(netL);
	const st = sortedCopy(trips);
	const per = RATE_SEC / ((durationSec - WARMUP_SEC) * r.clients.size());
	return {
		effMean: mean(eff),
		effP95: nearestRank(se, HIGH) ?? 0,
		effMax: se.size() > 0 ? se[se.size() - 1] : 0,
		netMean: mean(netL),
		netP95: nearestRank(sn, HIGH) ?? 0,
		netMax: sn.size() > 0 ? sn[sn.size() - 1] : 0,
		latesRate: lates * per,
		droppedRate: dropped * per,
		bumpsRate: bumps * per,
		churnRate: churn * per,
		missedShare,
		neverSentShare: ticks > 0 ? (missed - lates) / ticks : 0,
		lates,
		feltMean: felt.map((f) => mean(f)),
		feltP95: felt.map((f) => nearestRank(sortedCopy(f), HIGH) ?? 0),
		tripP50: nearestRank(st, MEDIAN) ?? 0,
		tripP95: nearestRank(st, HIGH) ?? 0,
		tripMax: st.size() > 0 ? st[st.size() - 1] : 0,
	};
}

interface TroubleResult {
	readonly before: number;
	readonly peak: number;
	readonly backSec: number;
	readonly peakBound: number;
	readonly fallBound: number;
}

/** FP12 on one client: the net lead before the trouble, its peak, when it was back within RECOVER_TICKS. */
function trouble(c: ClientRun, tr: Trouble): TroubleResult {
	const ends = tr.at + tr.sec;
	const watchEnd = ends + WATCH_SEC;
	let before = 0;
	let peak = 0;
	let lastOut = ends;
	for (let k = 0; k < c.at.size(); k++) {
		const t = c.at[k];
		const lead = c.net[k];
		if (t < tr.at) before = lead;
		else if (t <= watchEnd) peak = math.max(peak, lead);
		if (t >= ends && t <= watchEnd && math.abs(lead - before) > RECOVER_TICKS) lastOut = t;
	}
	// The longest echoed trip from the trouble's start until it cleared (plus a full trip).
	let tripMax = 0;
	for (let k = 0; k < c.tripAt.size(); k++) {
		const t = c.tripAt[k];
		if (t >= tr.at && t <= ends + tr.extra + 1) tripMax = math.max(tripMax, c.trip[k]);
	}
	return {
		before,
		peak,
		backSec: lastOut + DT < watchEnd ? lastOut - ends : math.huge,
		peakBound: ceilTicks(tripMax + LEAD.marginTicks) + 1,
		// Today's fall bound (FP12's), the same gate for every candidate: back within seconds.
		fallBound:
			LEAD.windowSec + LEAD.fallHoldSec + LEAD.fallStepSec * math.max(0, peak - before) + TROUBLE_FALL_SLACK_SEC,
	};
}

const f1 = (x: number) => string.format("%.1f", x);
const f2 = (x: number) => string.format("%.2f", x);
const ms = (ticks: number) => string.format("%d", math.floor(ticks * DT * MS_PER_SEC + 0.5));

function gateText(net: NetSpec, r: NetRun, s: Summary): string {
	if (net.gate === "fp11") {
		const ok = s.lates === 0 && s.missedShare < FP11_MISSED_SHARE;
		return `FP11 ${ok ? "pass" : "FAIL"} (lates ${s.lates}, missed ${f2(s.missedShare * 100)} %)`;
	}
	if (net.gate === "fp12") {
		const tr = net.upSpike ?? net.upHold!;
		const parts: string[] = [];
		let ok = true;
		for (const c of r.clients) {
			const t = trouble(c, tr);
			const met = t.peak <= t.peakBound && t.backSec <= t.fallBound;
			if (!met) ok = false;
			parts.push(
				`${t.before}->${t.peak} (<= ${t.peakBound}) back ${
					t.backSec === math.huge ? "never" : f2(t.backSec) + " s"
				} (<= ${f2(t.fallBound)} s)`,
			);
		}
		return `FP12 ${ok ? "pass" : "FAIL"} (${parts.join("; ")})`;
	}
	return "";
}

function row(net: NetSpec, policy: Policy, r: NetRun, s: Summary, extra = ""): string {
	return `| ${net.name} | ${policy.name} | ${f1(s.effMean)} / ${s.effP95} / ${s.effMax} | ${f1(s.netMean)} / ${
		s.netP95
	} / ${s.netMax} | ${f1(s.latesRate)} | ${f1(s.droppedRate)} | ${f2(s.missedShare * 100)} % | ${f1(
		s.bumpsRate,
	)} | ${f1(s.churnRate)} | ${f2(s.feltMean[0])} / ${s.feltP95[0]} | ${f2(s.feltMean[1])} / ${s.feltP95[1]} | ${[
		gateText(net, r, s),
		extra,
	]
		.filter((x) => x !== "")
		.join("; ")} |`;
}

function paceLines(net: NetSpec, policy: Policy, r: NetRun): string[] {
	const out: string[] = [];
	for (let i = 0; i < r.clients.size(); i++) {
		const c = r.clients[i];
		let prevLates = 0;
		let prevBumps = 0;
		for (let k = 0; k < c.marks.size(); k++) {
			const m = c.marks[k];
			out.push(
				`[lead census pace] ${net.name} ${policy.name} p${i} ${(k + 1) * RATE_SEC} s: trip p50 ${ms(
					m.tripP50 ?? 0,
				)} p95 ${ms(m.tripP95 ?? 0)} max ${ms(m.tripMax ?? 0)} · lead ${m.lead}t target ${m.target}t fall ${
					m.fallTarget
				}t · lates ${m.lates - prevLates} bumps ${m.bumps - prevBumps} falls ${m.falls}`,
			);
			prevLates = m.lates;
			prevBumps = m.bumps;
		}
	}
	return out;
}

const HEADER =
	"| network | rule | effective lead mean / p95 / max (t) | net lead mean / p95 / max (t) | lates / 10 s | " +
	"dropped changed / 10 s | relay missed | bumps / 10 s | lead churn / 10 s | felt @20 mean / p95 (t) | felt @10 mean / p95 (t) | gate |";

function specFlags(): { readonly [k: string]: boolean } | undefined {
	return (_G as unknown as { KV_SPEC_FLAGS?: { readonly [k: string]: boolean } }).KV_SPEC_FLAGS;
}

function specFlag(name: string): boolean {
	return specFlags()?.[name] === true;
}

/**
 * `--flag lead.rule.<name>` keeps only those rules (today's is always run first: the table's reference; `rule3` brings
 * `cov20`, the rule it must equal).
 */
function selectedRules(): Policy[] {
	const out: Policy[] = [TODAY];
	let any = false;
	for (const p of CANDIDATES) if (specFlag(`lead.rule.${p.name}`)) any = true;
	const keep = (p: Policy) =>
		!any || specFlag(`lead.rule.${p.name}`) || (p.name === "cov20" && specFlag(`lead.rule.${RULE3.name}`));
	for (const p of CANDIDATES) if (p !== TODAY && keep(p)) out.push(p);
	return out;
}

/** Frames where two runs' leads (net and effective, every client) differ, and the first one ("" when none). */
function leadDiff(a: NetRun, b: NetRun): { readonly frames: number; readonly differ: number; readonly first: string } {
	let frames = 0;
	let differ = 0;
	let first = "";
	for (let i = 0; i < a.clients.size(); i++) {
		const x = a.clients[i];
		const y = b.clients[i];
		const n = math.max(x.net.size(), y.net.size());
		frames += n;
		for (let k = 0; k < n; k++) {
			if (x.net[k] === y.net[k] && x.eff[k] === y.eff[k]) continue;
			differ++;
			if (first === "") {
				first = `p${i} frame ${k} (${f2(x.at[k] ?? 0)} s): net ${x.net[k]} vs ${y.net[k]}, eff ${x.eff[k]} vs ${
					y.eff[k]
				}`;
			}
		}
		if (x.lates !== y.lates || x.dropped !== y.dropped) {
			differ++;
			if (first === "") first = `p${i}: lates ${x.lates} vs ${y.lates}, dropped ${x.dropped} vs ${y.dropped}`;
		}
	}
	return { frames, differ, first };
}

/** FPD18's gates for a rule against today's on one network (unrounded rates). */
function fpd18(today: Summary, rule: Summary): { readonly ok: boolean; readonly text: string } {
	const felt = rule.feltMean[0] <= today.feltMean[0] * GATE_FELT_SHARE + EPSILON;
	const dropped = rule.droppedRate <= today.droppedRate + EPSILON;
	const churn = rule.churnRate <= today.churnRate * GATE_CHURN_SHARE + EPSILON;
	const v = (b: boolean) => (b ? "pass" : "FAIL");
	const ok = felt && dropped && churn;
	return {
		ok,
		text: `FPD18 ${v(ok)} (felt @20 ${f2(rule.feltMean[0])} <= ${f2(today.feltMean[0] * GATE_FELT_SHARE)} ${v(
			felt,
		)}; dropped ${f2(rule.droppedRate)} <= ${f2(today.droppedRate)} ${v(dropped)}; churn ${f2(
			rule.churnRate,
		)} <= ${f2(today.churnRate * GATE_CHURN_SHARE)} ${v(churn)})`,
	};
}

function selectedNetworks(): NetSpec[] {
	const flags = specFlags();
	const out: NetSpec[] = [];
	let any = false;
	for (const n of NETWORKS) if (flags?.[`lead.${n.name}`] === true) any = true;
	for (const n of NETWORKS) if (!any || flags?.[`lead.${n.name}`] === true) out.push(n);
	return out;
}

if (FULL) {
	describe("FP17 lead census: today's rule and the candidates on every network (printed)", () => {
		for (const net of selectedNetworks()) {
			it(`${net.label} (${net.durationSec} s, ${PLAYERS} players)`, () => {
				const rows: string[] = [];
				const trips: string[] = [];
				const runs = new Map<string, NetRun>();
				let todaySummary: Summary | undefined;
				const gates: string[] = [];
				for (const policy of selectedRules()) {
					const r = play(net, policy, net.durationSec);
					const s = summarize(r, net.durationSec);
					expect(r.finalized).toBeGreaterThan((net.durationSec - 1) * SIM_HZ);
					for (const c of r.clients) expect(c.measuredAtEnd).toBe(true);
					runs.set(policy.name, r);
					if (policy === TODAY) todaySummary = s;
					let extra = "";
					if (policy === RULE3 && todaySummary !== undefined && GATE_NETWORKS.includes(net.name)) {
						const g = fpd18(todaySummary, s);
						extra = g.text;
						gates.push(`[lead census gate] ${net.name} rule3 ${g.text}`);
					}
					rows.push(row(net, policy, r, s, extra));
					trips.push(
						`${policy.name} echoed trips p50 ${ms(s.tripP50)} p95 ${ms(s.tripP95)} max ${ms(
							s.tripMax,
						)} ms, depth ${f1(s.effMean - s.netMean)} t, holds ${r.clients
							.map((c) => c.holds)
							.join(",")}, never sent ${f2(s.neverSentShare * 100)} % (${f2(r.sec)} s cpu)`,
					);
					if (policy === TODAY) for (const line of paceLines(net, policy, r)) print(line);
				}
				print(`[lead census] ${net.label}\n${HEADER}\n${rows.join("\n")}\n[lead census] ${trips.join("; ")}`);
				for (const g of gates) print(g);
				const r3 = runs.get(RULE3.name);
				const c20 = runs.get("cov20");
				if (r3 !== undefined && c20 !== undefined) {
					const d = leadDiff(c20, r3);
					print(
						`[lead census] ${net.name}: rule3 vs cov20 frame for frame: ${
							d.differ === 0 ? "same" : "DIFFERENT"
						}` + ` (${d.frames} client frames${d.first !== "" ? `; first ${d.first}` : ""})`,
					);
					expect(d.differ).toBe(0);
				}
			});
		}
	});
} else {
	describe("FP17 lead census, smoke: the owner-like network, 12 s", () => {
		const net = NETWORKS[0];
		const SMOKE_SEC = 12;
		it("this spec's copy of the rule gives today's LeadController's lead on every frame", () => {
			const a = play(net, TODAY, SMOKE_SEC);
			const b = play(net, COPY, SMOKE_SEC);
			for (let i = 0; i < PLAYERS; i++) {
				expect(b.clients[i].net.size()).toBe(a.clients[i].net.size());
				let same = true;
				for (let k = 0; k < a.clients[i].net.size(); k++) {
					if (a.clients[i].net[k] !== b.clients[i].net[k]) same = false;
				}
				expect(same).toBe(true);
				expect(b.clients[i].lates).toBe(a.clients[i].lates);
			}
			const s = summarize(a, SMOKE_SEC);
			print(
				`[lead census smoke] ${HEADER}\n${row(net, TODAY, a, s)}\n${row(
					net,
					COPY,
					b,
					summarize(b, SMOKE_SEC),
				)}`,
			);
			for (const line of paceLines(net, TODAY, a)) print(line);
		});

		it("the shipped LeadController (rule3: LEAD, the prediction cap as its ceiling) gives cov20's lead on every frame", () => {
			const cov20 = CANDIDATES.find((p) => p.name === "cov20")!;
			const a = play(net, cov20, SMOKE_SEC);
			const b = play(net, RULE3, SMOKE_SEC);
			const d = leadDiff(a, b);
			print(
				`[lead census smoke] rule3 vs cov20: ${d.differ} of ${d.frames} client frames differ${
					d.first !== "" ? `; first ${d.first}` : ""
				}\n${row(net, cov20, a, summarize(a, SMOKE_SEC))}\n${row(net, RULE3, b, summarize(b, SMOKE_SEC))}`,
			);
			expect(d.differ).toBe(0);
			for (const c of b.clients) expect(c.bumps).toBe(0);
		});
	});
}
