/**
 * LeadController: the co-op net input lead from measured trips (docs/FRAME_PACING.md Revision 2, Design 10; Revision 3,
 * Design 13: the capped cover). Pure: no Roblox API, clock or randomness; the caller passes its monotonic clock `now`
 * (seconds). Nothing here reaches the sim: it only decides how far ahead the client's inputs are sent (LockstepClient
 * adds the pacing buffer's depth, Design 5).
 *
 *   sent(target, sentAt, depthRaw, hitched, depthUsed)  a frame was sent for `target` at state.tick `sentAt` (a
 *                                            fixed ring of records, the newest `recordTicks` targets)
 *   received(now)                            a merged batch arrived (echo or not): times the echo timeout
 *   echoed(echo, now)                        the server's echo: the trip of its tick X joins both windows; the lead
 *                                            jumps up to the target at once; a late is counted, and only with
 *                                            `lateBump` (Revision 2's rule, KV_LeadBump) bumps it to that late's own
 *                                            trip, unless excused: the server was catching up (the echo's flag), the
 *                                            late was sent in an unsteady frame, or the buffer depth over the lead's
 *                                            cap (depthRaw - depthUsed) covers its overshoot. Excused lates are counted,
 *                                            never bumped; the catching-up echo's and the unsteady send's trips stay out
 *   deadline(matched, now)                   checkDeadline's per-tick result: today's miss counter while not echoing;
 *                                            while echoing a mismatch is only counted (its late is the echo's:
 *                                            only echoed lates bump, Design 10)
 *   frame(now)                               once per pump: the fall (after a hold, a tick per step)
 *   lead()                                   the net lead, an integer in [minLead, maxLead]
 *
 * A trip (Design 9): netTrip(X) = (X - sentAt[X]) - slack - depthRaw[X], ticks: the lead X was sent with, minus what
 * it had to spare at the server, minus the buffer. The window keeps the trips of the last `windowSec` (from sends not
 * hitched). The base Lb = ceil(p + marginTicks) with p the window's `percentile` trip (nearest rank); in the warm-up
 * (fewer than `minSamples` trips) p is the window's max and nothing falls. The cover (Design 13): the same trips over
 * `coverWindowSec` give Lc = ceil(p99 + marginTicks) (`coverPercentile`), capped at the ceiling C = `ceiling` (the
 * constructor's: the prediction cap, PREDICTION.maxTicks) minus the depth the newest send's lead added (`depthUsed`),
 * so net + depth never passes the cap for the cover's sake. Target L* = clamp(max(Lb, min(Lc, C))); without a ceiling
 * (no prediction), in the warm-up, or before any cover trip, L* = clamp(Lb). Fall target Lf: the same with
 * `fallSlackTicks` added to both quantiles; once Lf has been below the lead for `fallHoldSec`, the lead falls a tick
 * every `fallStepSec` while it stays below, so after a fall the lead rests at Lf (L* or L* + 1: the slack band).
 * Without `lateBump` the lead follows these quantiles only: a late raises it only when its trip moves one of them.
 *
 * Echoing: off before the first echo with a tick, and again once batches keep arriving (`received`) for
 * `echoTimeoutSec` without any decodable echo (an old server; a "none" echo proves the server echoes, so an up-link
 * outage keeps echoing). While off, `deadline` runs the legacy rule exactly as
 * LockstepClient.checkDeadline: matched -> one clean tick, `legacyDecayTicks` of them lower the lead by one (never below
 * minLead); a mismatch raises it by one (never above maxLead) and restarts the clean count.
 */
import { isFiniteNumber } from "shared/sim";
import { nearestRank } from "./arrivalLog";
import type { LeadTunables } from "./config";

/** Absorbs float rounding: a trip + margin a hair over a whole tick does not round up a tick (as pacer.ts). */
const EPSILON = 1e-9;
/** The trip quantile shown beside the target's. */
const MEDIAN = 0.5;
/** A ring slot never written. */
const NO_RECORD = -1;

const ascending = (a: number, b: number) => a < b;

/** The server's echo for this client (docs/FRAME_PACING.md Design 9): tick undefined = none since the last batch. */
export interface LeadEcho {
	/**
	 * The tick of the frame the server received from this client with the lowest slack since its last broadcast
	 * (undefined: none). Echoed ticks increase from one echo to the next (each window's frames arrived after the last).
	 */
	readonly tick: number | undefined;
	/** How many ticks before its deadline that tick arrived (<= 0: late). */
	readonly slack: number;
	/** Frames from this client the server counted late since the last echo. */
	readonly lates: number;
	/**
	 * The server was catching up (a stall's backlog finalized at maxTicksPerStep a step) during this echo's window: its
	 * trip and lates measure the server, not the network. Absent: no.
	 */
	readonly catchingUp?: boolean;
}

export interface LeadStats {
	/** lead(): the net lead (ticks). */
	readonly lead: number;
	/** L*: the window's target (warm-up: from its max); the lead when no trip is in the window. */
	readonly target: number;
	/** Lf: what the lead falls toward (L* + the slack band); the lead when no trip is in the window. */
	readonly fallTarget: number;
	/** Lb: the base window's target alone (warm-up: from its max); the lead when no trip is in the window. */
	readonly baseTarget: number;
	/** The cover window's `coverPercentile` trip (ticks; undefined while it is empty). */
	readonly coverP99: number | undefined;
	/**
	 * Lc: ceil(coverP99 + marginTicks), clamped like the targets, before the ceiling (undefined while the cover window is
	 * empty). It raises L* only up to `ceiling`, and only with a ceiling and past the warm-up.
	 */
	readonly coverTarget: number | undefined;
	/** C: the ceiling less the depth the newest send added (ticks); undefined without a ceiling (no cover). */
	readonly ceiling: number | undefined;
	/** The window's trips (ticks): median, `percentile` and max; undefined while the window is empty. */
	readonly tripP50: number | undefined;
	readonly tripP95: number | undefined;
	readonly tripMax: number | undefined;
	/** Trips in the window. */
	readonly samples: number;
	/** The window holds fewer than minSamples trips: the target is max-based and nothing falls. */
	readonly warmingUp: boolean;
	/** Late frames the server echoed (all of them, hitched sends' included). */
	readonly lates: number;
	/** checkDeadline mismatches (the finalized frame differs from the one sent), echoing or not. */
	readonly mismatches: number;
	/** Bumps while echoing: echoes with lates that bumped (only with `lateBump`; 0 otherwise). */
	readonly bumps: number;
	/**
	 * Echoes with lates that are not the network's: the server was catching up, the late was sent in an unsteady
	 * (hitched / catching-up) frame, or the pacing depth over its lead cap explains it (never bumped).
	 */
	readonly excused: number;
	/** Jumps up to the target (L* above the lead). */
	readonly raises: number;
	/** Ticks the lead fell (one per fall step). */
	readonly falls: number;
	/** The server's echoes are steering the lead (else the legacy miss counter). */
	readonly echoing: boolean;
}

/** Index of the first element of the ascending `sorted` greater than (upper) or at least (lower) x: a binary search. */
function searchSorted(sorted: ReadonlyArray<number>, x: number, upper: boolean): number {
	let lo = 0;
	let hi = sorted.size();
	while (lo < hi) {
		const mid = math.floor((lo + hi) / 2);
		const v = sorted[mid];
		if (v < x || (upper && v === x)) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function sanitizeCount(v: number): number {
	return isFiniteNumber(v) && v > 0 ? math.floor(v) : 0;
}

/** ceil(x) with float fuzz just above a whole number absorbed. */
function ceilTicks(x: number): number {
	return math.ceil(x - EPSILON);
}

export class LeadController {
	private readonly tunables: LeadTunables;
	private readonly minLead: number;
	private readonly maxLead: number;
	private readonly legacyDecayTicks: number;
	/** The cover's ceiling (the prediction cap, ticks of effective lead); undefined: no cover (Design 13). */
	private readonly ceilingTicks: number | undefined;
	private readonly ringSize: number;

	private leadValue: number;
	/** Legacy: matched deadlines since the last change (checkDeadline's cleanTicks). */
	private cleanTicks = 0;

	/** Send records, a ring indexed by target % ringSize; a slot is valid only while its target is the one asked. */
	private readonly recTarget: number[] = [];
	private readonly recSentAt: number[] = [];
	private readonly recDepth: number[] = [];
	private readonly recHitched: boolean[] = [];
	/** The pacing depth the lead actually added for the target (whole ticks, capped): depthRaw above it went uncovered. */
	private readonly recDepthUsed: number[] = [];
	/** The net lead when the target was sent (a late bumps past it, not past a lead already raised since). */
	private readonly recLead: number[] = [];
	private newestSent: number | undefined;
	/** The depth the newest send's lead added (recDepthUsed of `newestSent`): the ceiling is C = ceiling - this. */
	private lastDepthUsed = 0;
	/**
	 * The newest tick echoed: records at or below it are spent (every later echo names a frame received after this one,
	 * so a later tick: the frames of one echo window all arrive after the previous window's).
	 */
	private echoedThrough: number | undefined;

	/** The trip window, oldest first: the local time each echo arrived and its net trip (ticks). */
	private readonly winAt: number[] = [];
	private readonly winTrip: number[] = [];
	/** Sorted copy of the window (recomputed when it changes). */
	private readonly scratch: number[] = [];
	private dirty = false;
	private p50: number | undefined;
	private pHigh: number | undefined;
	private pMax: number | undefined;
	/**
	 * The cover window (Design 13): the same trips over coverWindowSec, oldest first, and an ascending copy kept in step
	 * (binary insertion and removal: no sort, no allocation per echo).
	 */
	private readonly covAt: number[] = [];
	private readonly covTrip: number[] = [];
	private readonly covSorted: number[] = [];
	private covHigh: number | undefined;

	private isEchoing = false;
	private lastEchoAt: number | undefined;
	private lastNow: number | undefined;
	/** The fall target has been below the lead since this time (undefined: not below); a late restarts it. */
	private holdFrom: number | undefined;
	/** The last fall of the current hold. */
	private lastFallAt: number | undefined;

	private lateCount = 0;
	private mismatchCount = 0;
	private bumpCount = 0;
	private excusedCount = 0;
	private raiseCount = 0;
	private fallCount = 0;

	/**
	 * `ceiling`: the cover's ceiling in ticks of effective lead (LockstepClient passes `PREDICTION.maxTicks`, the
	 * prediction cap); undefined (or not finite): no cover, the base window alone raises the lead (FPD19).
	 */
	constructor(
		tunables: LeadTunables,
		minLead: number,
		maxLead: number,
		legacyDecayTicks: number,
		ceiling: number | undefined = undefined,
	) {
		this.tunables = tunables;
		this.minLead = minLead;
		this.maxLead = maxLead;
		this.legacyDecayTicks = legacyDecayTicks;
		this.ceilingTicks = ceiling !== undefined && isFiniteNumber(ceiling) ? ceiling : undefined;
		this.leadValue = minLead;
		const size = math.max(1, math.floor(tunables.recordTicks));
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

	/**
	 * A frame was sent for `target` while the client's state.tick was `sentAt`; depthRaw = the pacer's raw buffer depth
	 * in ticks then (0 unpaced); hitched = the send happened in a hitched / catching-up frame; depthUsed = the depth the
	 * lead added for it (the pacer's whole-tick, capped depthTicks(); default depthRaw: none uncovered). Targets only
	 * increase (a target at or below the newest sent, or not a whole tick, is ignored).
	 */
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

	/**
	 * A merged batch arrived (any batch, echo or not) at local time now: no decodable echo (with a tick or "none") for
	 * echoTimeoutSec while batches arrive ends echoing.
	 */
	received(now: number): void {
		const clock = this.clock(now);
		if (clock === undefined || !this.isEchoing || this.lastEchoAt === undefined) return;
		if (clock - this.lastEchoAt + EPSILON >= this.tunables.echoTimeoutSec) {
			this.isEchoing = false;
			this.cleanTicks = 0;
			this.resetHold();
		}
	}

	/** The server's echo for this client (shape like the server's InputEcho; tick undefined = none). */
	echoed(echo: LeadEcho, now: number): void {
		const clock = this.clock(now);
		if (clock === undefined) return;
		const lates = sanitizeCount(echo.lates);
		this.lateCount += lates;
		const tick = echo.tick;
		const serverCatchUp = echo.catchingUp === true;
		/** The late's own trip (undefined: not measured, or from a hitched send). */
		let trip: number | undefined;
		/** The lead the echoed tick was sent with. */
		let sentLead: number | undefined;
		/** The echo's lates are not the network's: the server catching up, an unsteady send, the depth cap. */
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
					const t = tick - this.recSentAt[slot] - echo.slack - depth;
					if (this.recHitched[slot]) excused = true;
					// Sent short by the buffer's lead cap: the depth the lead did not cover explains the overshoot.
					const uncovered = depth - this.recDepthUsed[slot];
					if (uncovered > EPSILON && uncovered + EPSILON >= -echo.slack) excused = true;
					if (!this.recHitched[slot] && !serverCatchUp && isFiniteNumber(t)) {
						trip = t;
						this.winAt.push(clock);
						this.winTrip.push(t);
						this.dirty = true;
						this.covAt.push(clock);
						this.covTrip.push(t);
						this.covSorted.insert(searchSorted(this.covSorted, t, true), t);
					}
				}
			}
		}
		// Any decodable echo (a "none" one too) proves the server echoes: the timeout restarts.
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
		} else if (lates > 0 && this.tunables.lateBump) {
			// Revision 2's bump (KV_LeadBump). Without it a late is only counted: its trip is in both windows already.
			let bump = (sentLead ?? this.leadValue) + 1;
			if (trip !== undefined) bump = math.max(bump, ceilTicks(trip + this.tunables.marginTicks));
			bump = this.clampLead(bump);
			if (bump > raised) raised = bump;
			this.bumpCount++;
			this.restartHold(clock);
		}
		this.leadValue = raised;
	}

	/** checkDeadline's per-tick result: did the server finalize exactly the frame this client sent for that tick? */
	deadline(matched: boolean, now: number): void {
		if (!this.isEchoing) {
			// The legacy rule, exactly LockstepClient.checkDeadline's.
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
		// While echoing a mismatch is only counted: the input was late, and the echo's lates already bump the lead to
		// that late's own trip (Design 10: a mismatch bumps only without an echo). Bumping here too raised the lead a
		// tick per late input on top of the echo's bump (FP12's spike overshoot).
		if (!matched) this.mismatchCount++;
	}

	/** Once per pump: expires the window, raises to the target, steps the fall. */
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
		const t = this.tunables;
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

	/** The net lead, an integer within [minLead, maxLead]. */
	lead(): number {
		return this.leadValue;
	}

	/** The server's echoes are steering the lead (false: the legacy miss counter). */
	echoing(): boolean {
		return this.isEchoing;
	}

	stats(): LeadStats {
		const n = this.winTrip.size();
		const cov = this.covHigh;
		return {
			lead: this.leadValue,
			target: this.windowTarget() ?? this.leadValue,
			fallTarget: n > 0 ? this.fallTarget() : this.leadValue,
			baseTarget: this.baseTarget() ?? this.leadValue,
			coverP99: cov,
			coverTarget: cov !== undefined ? this.clampLead(ceilTicks(cov + this.tunables.marginTicks)) : undefined,
			ceiling: this.ceiling(),
			tripP50: this.p50,
			tripP95: this.pHigh,
			tripMax: this.pMax,
			samples: n,
			warmingUp: n < this.tunables.minSamples,
			lates: this.lateCount,
			mismatches: this.mismatchCount,
			bumps: this.bumpCount,
			excused: this.excusedCount,
			raises: this.raiseCount,
			falls: this.fallCount,
			echoing: this.isEchoing,
		};
	}

	/** The caller's clock, never going back; undefined for a non-finite one before any. */
	private clock(now: number): number | undefined {
		let c = isFiniteNumber(now) ? now : this.lastNow;
		if (c === undefined) return undefined;
		if (this.lastNow !== undefined && c < this.lastNow) c = this.lastNow;
		this.lastNow = c;
		return c;
	}

	/** The ring slot still holding `tick`'s record, if any. */
	private slotOf(tick: number): number | undefined {
		if (tick < 0 || tick !== math.floor(tick)) return undefined;
		const slot = tick % this.ringSize;
		return this.recTarget[slot] === tick ? slot : undefined;
	}

	private clampLead(x: number): number {
		return math.clamp(x, this.minLead, this.maxLead);
	}

	/** Lb, unclamped: undefined with an empty window; the max-based warm-up target below minSamples trips. */
	private baseRaw(): number | undefined {
		const n = this.winTrip.size();
		if (n === 0) return undefined;
		const p = n < this.tunables.minSamples ? this.pMax : this.pHigh;
		return p === undefined ? undefined : ceilTicks(p + this.tunables.marginTicks);
	}

	/** Lb, clamped (undefined with an empty window). */
	private baseTarget(): number | undefined {
		const b = this.baseRaw();
		return b === undefined ? undefined : this.clampLead(b);
	}

	/** L*: max(Lb, min(Lc, C)) clamped; undefined with an empty window (the warm-up: Lb alone). */
	private windowTarget(): number | undefined {
		const b = this.baseRaw();
		return b === undefined ? undefined : this.withCover(b, 0);
	}

	/** Lf (with a non-empty window): L*'s rule with fallSlackTicks added to both quantiles. */
	private fallTarget(): number {
		const t = this.tunables;
		const p = this.pHigh ?? 0;
		return this.withCover(ceilTicks(p + t.marginTicks + t.fallSlackTicks), t.fallSlackTicks);
	}

	/** C: the ceiling less the newest send's depth; undefined without a ceiling. */
	private ceiling(): number | undefined {
		const c = this.ceilingTicks;
		return c === undefined ? undefined : c - this.lastDepthUsed;
	}

	/**
	 * max(base, min(ceil(cover p99 + margin + slack), C)), clamped (Design 13); the base alone without a ceiling, in the
	 * warm-up (fewer than minSamples trips in the base window) or before any cover trip.
	 */
	private withCover(base: number, slack: number): number {
		const c = this.ceiling();
		const cov = this.covHigh;
		if (c === undefined || cov === undefined || this.winTrip.size() < this.tunables.minSamples) {
			return this.clampLead(base);
		}
		const cover = math.min(ceilTicks(cov + this.tunables.marginTicks + slack), c);
		return this.clampLead(math.max(base, cover));
	}

	private resetHold(): void {
		this.holdFrom = undefined;
		this.lastFallAt = undefined;
	}

	private restartHold(clock: number): void {
		this.holdFrom = clock;
		this.lastFallAt = undefined;
	}

	/** Drops trips older than the windows and recomputes their quantiles when they changed. */
	private refresh(now: number): void {
		const keepCov = now - this.tunables.coverWindowSec;
		const sorted = this.covSorted;
		while (this.covAt.size() > 0 && this.covAt[0] < keepCov) {
			const old = this.covTrip[0];
			this.covAt.remove(0);
			this.covTrip.remove(0);
			const i = searchSorted(sorted, old, false);
			if (i < sorted.size() && sorted[i] === old) sorted.remove(i);
		}
		this.covHigh = nearestRank(sorted, this.tunables.coverPercentile);
		const keep = now - this.tunables.windowSec;
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
		this.pHigh = nearestRank(scratch, this.tunables.percentile);
		this.pMax = n > 0 ? scratch[n - 1] : undefined;
	}
}
