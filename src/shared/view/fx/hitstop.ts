/**
 * Hitstop / freeze frame + slow motion (port of the web build's src/fx/hitstop.ts @ 42897e2, the HitstopClock and
 * its rules; the web build's module singleton and wrappers are not ported: the client's SimController owns one clock).
 *
 * Effects ask for a freeze (request) or a slow-motion ramp (requestSlowMo); the live loop (shared/play LiveRun, as the
 * web SimDriver) turns each rendered frame's REAL delta into the SIM delta it feeds the FixedStepLoop through
 * `frame()`. It only changes WHEN ticks run (wall-time pacing), never what a tick does: no tick runs during a freeze,
 * fewer ticks per real second during slow motion, input is still sampled once per frame and recorded per tick, so
 * recordings, hashes and replays are unaffected (liveRun.hitstop.spec.ts).
 *
 * The LiveRun hook, after the pause handling (paused frames never reach it):
 *   const adv = clock.frame(delta, out);     // real seconds -> { simDelta, frozen, timeScale }
 *   if (!adv.frozen) alpha = loop.advance(adv.simDelta, onTick);
 *   // frozen: loop.advance is skipped: no step(), nothing recorded, accumulator and alpha unchanged (a true still)
 * and clear() when a run resets. Frozen time is never added to the accumulator, so there is no catch-up burst.
 *
 * Rules (hitstop.spec.ts):
 *   - Longest wins: overlapping freezes don't add up; a longer request extends the pending one to its length.
 *   - One request is clamped to MAX_HITSTOP_MS (150), or BOSS_DEATH_HITSTOP_MS (250) with { exceedCap: true }.
 *   - Rate cap: at most HITSTOP_WINDOW_BUDGET_MS (150) of freeze per rolling HITSTOP_WINDOW_MS (1 s) of real time.
 *     `exceedCap` requests (the boss death) bypass the cap; what they grant still counts in the window.
 *   - Slow motion: the time scale ramps from `fromScale` back to 1 over `durationMs` of real time on a smoothstep
 *     curve, after any pending freeze; integrated exactly per frame (frame-rate independent). A new request replaces it.
 *   - Settings: requests are ignored (return false) when freezeFrameOn(settings) is false.
 *   - Pause: paused frames never call frame(), so a pending freeze neither drains nor runs while paused.
 *   - Huge deltas: the freeze and the ramp are simply spent; the loop's own 5-ticks-per-frame cap does the rest.
 *
 * Pure (no clock, no Roblox API): time only moves through frame().
 *
 * @module
 */
import type { JuiceSettings } from "shared/settings";
import { freezeFrameOn } from "./juiceRules";

/** Longest hitstop one request may ask for, ms (longer requests are clamped). */
export const MAX_HITSTOP_MS = 150;
/** The one exception to MAX_HITSTOP_MS and to the rate cap: the boss death freeze (request with { exceedCap: true }). */
export const BOSS_DEATH_HITSTOP_MS = 250;
/** Rolling rate-cap window, ms of (unpaused) real time. */
export const HITSTOP_WINDOW_MS = 1000;
/** Most freeze granted per window, ms (exceedCap requests excepted). */
export const HITSTOP_WINDOW_BUDGET_MS = 150;
/** Slow-motion defaults (the boss death): 0.5 s ramp from 0.3x back to 1x. */
export const SLOWMO_DEFAULT_MS = 500;
/**
 * The time scale the default slow motion starts from (0.3 = 30 % speed), before easing back to 1 over
 * SLOWMO_DEFAULT_MS. The boss death's own numbers in freezeRules.ts match it.
 */
export const SLOWMO_DEFAULT_SCALE = 0.3;
/** Slowest scale a slow-mo request may ask for (0 would be a freeze: use request). */
export const SLOWMO_MIN_SCALE = 0.05;
/** Longest slow-motion ramp, ms. */
export const SLOWMO_MAX_MS = 2000;
/** Grants remembered for the rate-cap window (when full, new grants merge into the newest: conservative). */
const WINDOW_SLOTS = 64;
const MS_PER_SECOND = 1000;

/**
 * Options of HitstopClock.request. Omitted, a request is clamped to MAX_HITSTOP_MS and is subject to the rolling rate
 * cap.
 */
export interface HitstopRequestOptions {
	/** Boss death only: clamp to BOSS_DEATH_HITSTOP_MS instead of MAX_HITSTOP_MS, and skip the rolling rate cap. */
	readonly exceedCap?: boolean;
}

/** What one rendered frame does to the sim. Reused object: read it, don't keep it. */
export interface FrameAdvance {
	/** Seconds to feed FixedStepLoop.advance (0 when frozen). */
	simDelta: number;
	/** The whole frame was frozen: skip loop.advance entirely (no ticks, alpha unchanged). */
	frozen: boolean;
	/** simDelta / real delta for this frame (0 frozen, < 1 slow-mo / partly frozen, 1 normal). */
	timeScale: number;
	/** Real ms of this frame spent frozen. */
	frozenMs: number;
}

/**
 * A fresh FrameAdvance in the normal state (not frozen, time scale 1) to preallocate and pass to `frame()` as its
 * out-parameter. The live run and the client's FreezeFrameController each keep one.
 */
export function newFrameAdvance(): FrameAdvance {
	return { simDelta: 0, frozen: false, timeScale: 1, frozenMs: 0 };
}

/** Anything that turns a real frame delta into the sim delta of that frame (LiveRun's optional pacer). */
export interface FramePacer {
	frame(realDeltaSeconds: number, out: FrameAdvance): FrameAdvance;
}

/** Running counters (debug readout, tests). */
export interface HitstopStats {
	/** Requests that passed the settings check (freeze + slow-mo). */
	requests: number;
	/** Requests ignored because freezeFrameOn(settings) was false. */
	ignored: number;
	/** Freeze requests the rate cap shortened or refused. */
	throttled: number;
	/** Freeze ms granted (after longest-wins and the cap). */
	grantedMs: number;
	/** Real ms spent frozen / in slow motion. */
	frozenMs: number;
	slowMs: number;
	/** Real ms minus sim ms over every frame (time the sim did not advance because of hitstop / slow-mo). */
	lostMs: number;
	/** Frames fully frozen (no loop.advance), frames partly frozen, frames in slow motion. */
	frozenFrames: number;
	partialFrames: number;
	slowFrames: number;
	/** Frames seen by frame(). */
	frames: number;
}

function blankStats(): HitstopStats {
	return {
		requests: 0,
		ignored: 0,
		throttled: 0,
		grantedMs: 0,
		frozenMs: 0,
		slowMs: 0,
		lostMs: 0,
		frozenFrames: 0,
		partialFrames: 0,
		slowFrames: 0,
		frames: 0,
	};
}

/** smoothstep(u) = 3u^2 - 2u^3 on [0, 1]. */
export function smoothstep01(u: number): number {
	const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
	return t * t * (3 - 2 * t);
}

/** Integral of smoothstep from 0 to u (u in [0, 1]): u^3 - u^4 / 2. */
function smoothstepIntegral(u: number): number {
	const u3 = u * u * u;
	return u3 - (u3 * u) / 2;
}

/** The slow-motion time scale `elapsedMs` into a ramp from `fromScale` to 1 over `durationMs` (1 outside the ramp). */
export function slowMoScaleAt(elapsedMs: number, durationMs: number, fromScale: number): number {
	if (!(durationMs > 0) || elapsedMs >= durationMs) return 1;
	const u = elapsedMs > 0 ? elapsedMs / durationMs : 0;
	return fromScale + (1 - fromScale) * smoothstep01(u);
}

function isFinitePositive(v: number): boolean {
	return v === v && v > 0 && v !== math.huge;
}

/** The hitstop state machine. The client's SimController owns one; tests make their own. */
export class HitstopClock implements FramePacer {
	/** Real ms this clock has been advanced through frame() (the rate-cap window's time base). */
	nowMs = 0;
	/** Freeze left, ms. */
	remainingMs = 0;
	/** Slow motion: running?, ms into the ramp, ramp length, starting scale. */
	slowActive = false;
	slowElapsedMs = 0;
	slowDurationMs = 0;
	slowFromScale = 1;
	readonly stats: HitstopStats = blankStats();

	// Rate-cap window: ring of grants (time granted, ms granted), oldest at `head` (0-based).
	private readonly grantAt: number[] = [];
	private readonly grantMs: number[] = [];
	private head = 0;
	private count = 0;

	constructor() {
		for (let i = 0; i < WINDOW_SLOTS; i++) {
			this.grantAt.push(0);
			this.grantMs.push(0);
		}
	}

	/** Freeze ms granted within the last HITSTOP_WINDOW_MS (drops older grants). */
	windowUsed(): number {
		const cutoff = this.nowMs - HITSTOP_WINDOW_MS;
		while (this.count > 0 && this.grantAt[this.head] <= cutoff) {
			this.head = (this.head + 1) % WINDOW_SLOTS;
			this.count--;
		}
		let used = 0;
		for (let k = 0; k < this.count; k++) used += this.grantMs[(this.head + k) % WINDOW_SLOTS];
		return used;
	}

	private remember(ms: number): void {
		if (this.count === WINDOW_SLOTS) {
			// Full: merge into the newest grant (its later timestamp keeps it in the window longer: never under-counts).
			const newest = (this.head + this.count - 1) % WINDOW_SLOTS;
			this.grantMs[newest] += ms;
			this.grantAt[newest] = this.nowMs;
			return;
		}
		const i = (this.head + this.count) % WINDOW_SLOTS;
		this.grantAt[i] = this.nowMs;
		this.grantMs[i] = ms;
		this.count++;
	}

	/**
	 * Ask for a freeze of `ms`. Returns false when ignored (settings off, ms <= 0); true when accepted, even if a
	 * longer pending freeze or the rate cap absorbed it.
	 */
	request(ms: number, settings: Readonly<JuiceSettings>, options?: HitstopRequestOptions): boolean {
		if (!(ms > 0)) return false;
		if (!freezeFrameOn(settings)) {
			this.stats.ignored++;
			return false;
		}
		this.stats.requests++;
		const exceed = options?.exceedCap === true;
		const cap = exceed ? BOSS_DEATH_HITSTOP_MS : MAX_HITSTOP_MS;
		const target = ms < cap ? ms : cap;
		if (target <= this.remainingMs) return true; // longest wins
		let extra = target - this.remainingMs;
		if (!exceed) {
			const budget = HITSTOP_WINDOW_BUDGET_MS - this.windowUsed();
			if (extra > budget) {
				this.stats.throttled++;
				extra = budget > 0 ? budget : 0;
			}
		}
		if (extra > 0) {
			this.remainingMs += extra;
			this.stats.grantedMs += extra;
			this.remember(extra);
		}
		return true;
	}

	/**
	 * Ask for slow motion: the sim runs at `fromScale` (clamped to [SLOWMO_MIN_SCALE, 1)) and ramps back to 1 over
	 * `durationMs` (clamped to SLOWMO_MAX_MS) of real time, after any pending freeze. Replaces a running ramp.
	 * Returns false when ignored (settings off, no duration, fromScale >= 1).
	 */
	requestSlowMo(durationMs: number, fromScale: number, settings: Readonly<JuiceSettings>): boolean {
		if (!(durationMs > 0) || !(fromScale < 1)) return false;
		if (!freezeFrameOn(settings)) {
			this.stats.ignored++;
			return false;
		}
		this.stats.requests++;
		this.slowActive = true;
		this.slowElapsedMs = 0;
		this.slowDurationMs = durationMs < SLOWMO_MAX_MS ? durationMs : SLOWMO_MAX_MS;
		this.slowFromScale = fromScale > SLOWMO_MIN_SCALE ? fromScale : SLOWMO_MIN_SCALE;
		return true;
	}

	/** Drop any pending freeze, slow motion and the rate-cap history (run reset, settings off). Stats are kept. */
	clear(): void {
		this.remainingMs = 0;
		this.slowActive = false;
		this.slowElapsedMs = 0;
		this.head = 0;
		this.count = 0;
	}

	/** True while a freeze or slow motion is pending. */
	isActive(): boolean {
		return this.remainingMs > 0 || this.slowActive;
	}

	/** 0 while frozen, the ramp's scale in slow motion, else 1 (render-only effects may scale their time by it). */
	timeScale(): number {
		if (this.remainingMs > 0) return 0;
		return this.slowActive ? slowMoScaleAt(this.slowElapsedMs, this.slowDurationMs, this.slowFromScale) : 1;
	}

	/**
	 * Spend one rendered frame of real time (`realDeltaSeconds`; negative, NaN or infinite count as 0): the pending
	 * freeze first, then the slow-motion ramp, then normal time. Writes and returns `out`.
	 */
	frame(realDeltaSeconds: number, out: FrameAdvance): FrameAdvance {
		const realMs = isFinitePositive(realDeltaSeconds) ? realDeltaSeconds * MS_PER_SECOND : 0;
		const st = this.stats;
		st.frames++;
		this.nowMs += realMs;
		const wasFrozen = this.remainingMs > 0;
		let rest = realMs;
		let frozenMs = 0;
		if (wasFrozen) {
			frozenMs = this.remainingMs < rest ? this.remainingMs : rest;
			this.remainingMs -= frozenMs;
			rest -= frozenMs;
			st.frozenMs += frozenMs;
		}
		let simMs = rest;
		if (this.slowActive && rest > 0) {
			const d = this.slowDurationMs;
			const e0 = this.slowElapsedMs;
			const e1 = e0 + rest < d ? e0 + rest : d;
			const u0 = e0 / d;
			const u1 = e1 / d;
			const from = this.slowFromScale;
			// Exact integral of the ramp over [e0, e1], plus normal time for whatever lies past the ramp's end.
			simMs =
				d * (from * (u1 - u0) + (1 - from) * (smoothstepIntegral(u1) - smoothstepIntegral(u0))) +
				(rest - (e1 - e0));
			st.slowMs += e1 - e0;
			st.slowFrames++;
			this.slowElapsedMs = e0 + rest;
			if (this.slowElapsedMs >= d) this.slowActive = false;
		}
		if (simMs < 0) simMs = 0;
		const frozen = wasFrozen && rest === 0;
		if (frozen) st.frozenFrames++;
		else if (frozenMs > 0) st.partialFrames++;
		st.lostMs += realMs - simMs;
		out.simDelta = simMs / MS_PER_SECOND;
		out.frozen = frozen;
		out.frozenMs = frozenMs;
		out.timeScale = realMs > 0 ? simMs / realMs : this.timeScale();
		return out;
	}
}
