/**
 * Co-op latency probe (docs/FEEL.md J9, KV_Debug only): how long a button press takes from the moment this client
 * samples it to the moment the first tick that carries it is stepped here. Pure bookkeeping on numbers the caller
 * hands in (button bits, ticks, its clock): it reads nothing from the sim and changes nothing that is sent, stepped,
 * hashed or recorded.
 *
 * Per rendered frame of a co-op run, in this order:
 *   frame(buttons, now)            the frame's sampled input (what the client would send), OR-ed with the client's
 *                                  latched buttons (LockstepClient.latchedButtons(): a tap sampled on a fall's skipped
 *                                  tick and not sent yet), so a tap latched across a frame boundary keeps the time of
 *                                  the frame that pressed it
 *   sent(buttons, tick)            inside LockstepClient.pump's sample when it is sent (`sample(true)`): that input
 *                                  (with any latched buttons) goes out for `tick` (LockstepClient.nextInputTick())
 *   stepped(nextTick, now, missed) after the pump: every tick below `nextTick` (state.tick) has been stepped. `missed`:
 *                                  the pump saw one of this client's inputs miss the server's deadline, so a press
 *                                  resolved in it may have landed later than its tick: counted as `late`, not measured.
 *   drawn(nextTick, ahead, now)    after the drawn player was updated (docs/LOCAL_PREDICTION.md LP6): the drawn knight
 *                                  shows every tick below `nextTick + ahead` (`ahead`: SimController
 *                                  getPredictionAheadTicks, 0 without prediction), so a press sent for such a tick has
 *                                  been answered on screen: press -> drawn (the press -> step time without prediction;
 *                                  a missed deadline does not matter here, the drawn knight replays what was sent).
 *
 * A press is a button bit sent that the previous sent input did not have; its time is the first frame that sampled it
 * (a press sampled in a frame that stepped nothing waits for the next send). A press released before it was ever sent
 * is not measured.
 *
 * @module
 */
import { SIM_DT } from "shared/sim";
import {
	LATENCY_PROBE,
	LEAD_DEBUG_STRINGS,
	PACING_DEBUG_STRINGS,
	PREDICTION_DEBUG_DECIMALS,
	PREDICTION_DEBUG_STRINGS,
} from "./latencyProbeConfig";

/**
 * The probe's numbers as `LatencyProbe.stats()` reports them, all in milliseconds of the caller's clock: press to
 * stepped (last, mean and max over the window) and press to drawn. The KV_Debug line shows them (as part of
 * LatencyProbeView).
 */
export interface LatencyProbeStats {
	/** The last measured press, ms (undefined before the first). */
	readonly lastMs: number | undefined;
	/** Mean / max over the last LATENCY_PROBE.window measured presses, ms. */
	readonly meanMs: number | undefined;
	readonly maxMs: number | undefined;
	/** Measured presses in the window. */
	readonly count: number;
	/** Presses resolved in a pump with a deadline miss (not measured). */
	readonly late: number;
	/** Press -> drawn (LP6): the last, and the mean over the last LATENCY_PROBE.window presses, ms. */
	readonly drawnLastMs: number | undefined;
	readonly drawnMeanMs: number | undefined;
}

/**
 * The predictor's numbers the debug line reads (docs/LOCAL_PREDICTION.md Design 7): a structural subset of
 * shared/lockstep PredictionStats (LockstepClient.predictionStats()).
 */
export interface PredictionStatsInput {
	readonly horizonTicks: number;
	readonly meanError: number;
	readonly maxError: number;
}

/**
 * The debug line's prediction part: `off` (KV_PredictOff: the client was built without prediction), `waiting` (built
 * with it, but the local player is not drawn predicted now), `on`. Errors rounded to PREDICTION_DEBUG_DECIMALS tiles, so
 * the HUD store only changes when the line does.
 */
export interface PredictionDebugView {
	readonly mode: "off" | "waiting" | "on";
	readonly horizonTicks: number;
	readonly meanError: number;
	readonly maxError: number;
	/** The smoother's snaps so far (SimController.getPredictionSmoothing). */
	readonly snaps: number;
}

/** No prediction part: the client predicts nothing. */
export const PREDICTION_DEBUG_OFF: PredictionDebugView = table.freeze({
	mode: "off",
	horizonTicks: 0,
	meanError: 0,
	maxError: 0,
	snaps: 0,
});

/**
 * The pacer's numbers the debug line reads (docs/FRAME_PACING.md Design 7): a structural subset of shared/lockstep
 * PacingStats (LockstepClient.pacingStats()).
 */
export interface PacingStatsInput {
	readonly started: boolean;
	readonly depthTicks: number;
	readonly depthMs: number;
	readonly jitterMs: number;
	readonly holds: number;
}

/**
 * The debug line's pacing part: `off` (KV_PacingOff: the client was built without pacing), `waiting` (pacing not on
 * yet, or no batch has placed the playout clock), `on` (the numbers below). Whole milliseconds, so the HUD store only
 * changes when the line does.
 */
export interface PacingDebugView {
	readonly mode: "off" | "waiting" | "on";
	/** The buffer depth in whole ticks (what the lead adds) and in ms (unrounded depth, rounded to whole ms). */
	readonly depthTicks: number;
	readonly depthMs: number;
	/** Holds so far (one per contiguous run of held frames). */
	readonly holds: number;
	/** Received ticks not stepped yet (LockstepClient.backlog()). */
	readonly backlog: number;
	/** The measured jitter (the pacer's percentile offset minus its base), whole ms. */
	readonly jitterMs: number;
}

/** No pacing part: the client paces nothing. */
export const PACING_DEBUG_OFF: PacingDebugView = table.freeze({
	mode: "off",
	depthTicks: 0,
	depthMs: 0,
	holds: 0,
	backlog: 0,
	jitterMs: 0,
});

/**
 * The measured lead's numbers the debug line reads (docs/FRAME_PACING.md Design 11): a structural subset of
 * shared/lockstep LeadStats (LockstepClient.leadStats()).
 */
export interface LeadStatsInput {
	readonly echoing: boolean;
	/** The window's trip p95, ticks (undefined while the window is empty). */
	readonly tripP95: number | undefined;
	/** The cover window's trip p99, ticks (Revision 3, Design 13; undefined while it is empty). */
	readonly coverP99: number | undefined;
}

/**
 * The debug line's lead part: `measured` (the server's echoes steer the lead), `legacy` (the miss counter: before the
 * first echo, or after the echo timeout), `off` (KV_LeadOff: the client was built without the measured lead). Whole ms.
 */
export interface LeadDebugView {
	readonly mode: "measured" | "legacy" | "off";
	/** The trip p95 in whole ms (undefined: not measured, or no trip in the window). */
	readonly tripP95Ms: number | undefined;
	/** The cover window's trip p99 in whole ms (undefined: not measured, or no trip in the cover window). */
	readonly tripP99Ms: number | undefined;
}

/** The lead part of a client built without the measured lead (KV_LeadOff). */
export const LEAD_DEBUG_OFF: LeadDebugView = table.freeze({ mode: "off", tripP95Ms: undefined, tripP99Ms: undefined });
/** The lead part while the legacy miss counter steers the lead. */
export const LEAD_DEBUG_LEGACY: LeadDebugView = table.freeze({
	mode: "legacy",
	tripP95Ms: undefined,
	tripP99Ms: undefined,
});

/** What the debug line shows (the SimController hands it to the HUD store). */
export interface LatencyProbeView extends LatencyProbeStats {
	/**
	 * The client's EFFECTIVE input lead, ticks (LockstepClient.inputLead(): how far its sent inputs reach, the pacing
	 * buffer's depth included).
	 */
	readonly leadTicks: number;
	/** The network part of the lead, ticks (LockstepClient.netLead(): the lead that adapts to misses, no depth). */
	readonly netLeadTicks: number;
	/**
	 * This client's inputs known to have missed so far (LockstepClient.misses: the echoed lates while echoing, the
	 * mismatches before): the line's `late`.
	 */
	readonly misses: number;
	/** Deadline checks that found another frame finalized (LockstepClient.mismatches): the line's `miss`. */
	readonly mismatches: number;
	/** The pacing part (docs/FRAME_PACING.md Design 7). */
	readonly pacing: PacingDebugView;
	/** The lead part (docs/FRAME_PACING.md Design 11). */
	readonly lead: LeadDebugView;
	/** The prediction part (docs/LOCAL_PREDICTION.md Design 7). */
	readonly prediction: PredictionDebugView;
}

/**
 * The press-to-step and press-to-drawn stopwatch of a co-op run (see the file comment for the call order per frame).
 * `window` is how many measured presses the mean and max cover, `maxPending` how many sent presses may wait to be
 * resolved at once (more are not measured); both default to `LATENCY_PROBE`. `now` arguments are seconds on any one
 * clock. The client's SimController makes one per run, only under KV_Debug.
 */
export class LatencyProbe {
	private prevSent = 0;
	private edgeAt: number | undefined;
	private readonly pendingTicks: number[] = [];
	private readonly pendingAt: number[] = [];
	private readonly samples: number[] = [];
	private head = 0;
	private lastMs: number | undefined;
	private late = 0;
	private readonly drawnTicks: number[] = [];
	private readonly drawnAt: number[] = [];
	private readonly drawnSamples: number[] = [];
	private drawnHead = 0;
	private drawnLast: number | undefined;

	constructor(
		private readonly window: number = LATENCY_PROBE.window,
		private readonly maxPending: number = LATENCY_PROBE.maxPending,
	) {}

	/** The frame's sampled buttons at `now` (seconds). */
	frame(buttons: number, now: number): void {
		if (bit32.band(buttons, bit32.bnot(this.prevSent)) === 0) {
			this.edgeAt = undefined; // nothing new waits to be sent (or a tap ended before it was)
			return;
		}
		if (this.edgeAt === undefined) this.edgeAt = now;
	}

	/** An input with `buttons` goes out for `tick`. */
	sent(buttons: number, tick: number): void {
		const rising = bit32.band(buttons, bit32.bnot(this.prevSent));
		this.prevSent = buttons;
		if (rising === 0) return;
		const at = this.edgeAt;
		this.edgeAt = undefined;
		if (at === undefined) return;
		if (this.drawnTicks.size() < this.maxPending) {
			this.drawnTicks.push(tick);
			this.drawnAt.push(at);
		}
		if (this.pendingTicks.size() >= this.maxPending) return;
		this.pendingTicks.push(tick);
		this.pendingAt.push(at);
	}

	/** The drawn knight shows every tick below `nextTick + ahead`, at `now` (seconds): press -> drawn. */
	drawn(nextTick: number, ahead: number, now: number): void {
		const shown = nextTick + math.max(ahead, 0);
		while (this.drawnTicks.size() > 0 && this.drawnTicks[0] < shown) {
			this.drawnTicks.remove(0);
			const at = this.drawnAt.remove(0)!;
			const ms = (now - at) * LATENCY_PROBE.msPerSecond;
			this.drawnLast = ms;
			if (this.drawnSamples.size() < this.window) this.drawnSamples.push(ms);
			else {
				this.drawnSamples[this.drawnHead] = ms;
				this.drawnHead = (this.drawnHead + 1) % this.window;
			}
		}
	}

	/** Every tick below `nextTick` has been stepped, at `now` (seconds). */
	stepped(nextTick: number, now: number, missed: boolean): void {
		while (this.pendingTicks.size() > 0 && this.pendingTicks[0] < nextTick) {
			this.pendingTicks.remove(0);
			const at = this.pendingAt.remove(0)!;
			if (missed) this.late++;
			else this.record((now - at) * LATENCY_PROBE.msPerSecond);
		}
	}

	/** Presses sent and not stepped yet. */
	pending(): number {
		return this.pendingTicks.size();
	}

	stats(): LatencyProbeStats {
		const n = this.samples.size();
		let sum = 0;
		let max: number | undefined;
		for (const v of this.samples) {
			sum += v;
			if (max === undefined || v > max) max = v;
		}
		let drawnSum = 0;
		for (const v of this.drawnSamples) drawnSum += v;
		const dn = this.drawnSamples.size();
		return {
			lastMs: this.lastMs,
			meanMs: n > 0 ? sum / n : undefined,
			maxMs: max,
			count: n,
			late: this.late,
			drawnLastMs: this.drawnLast,
			drawnMeanMs: dn > 0 ? drawnSum / dn : undefined,
		};
	}

	private record(ms: number): void {
		this.lastMs = ms;
		if (this.samples.size() < this.window) {
			this.samples.push(ms);
			return;
		}
		this.samples[this.head] = ms;
		this.head = (this.head + 1) % this.window;
	}
}

/**
 * The debug line's pacing part from the client's pacer stats (undefined while pacing is not on), its backlog, and
 * whether the client was built with pacing at all (false: KV_PacingOff).
 */
export function pacingDebugView(
	stats: PacingStatsInput | undefined,
	backlog: number,
	configured: boolean,
): PacingDebugView {
	if (!configured) return PACING_DEBUG_OFF;
	const on = stats !== undefined && stats.started;
	return {
		mode: on ? "on" : "waiting",
		depthTicks: on ? stats.depthTicks : 0,
		depthMs: on ? math.round(stats.depthMs) : 0,
		holds: stats !== undefined ? stats.holds : 0,
		backlog,
		jitterMs: on ? math.round(stats.jitterMs) : 0,
	};
}

/**
 * The debug line's lead part from the client's lead stats (undefined without the measured lead) and whether the client
 * was built with it (false: KV_LeadOff). The trip p95 (and the cover's p99) in whole ms, so the HUD store only changes
 * with the line.
 */
export function leadDebugView(stats: LeadStatsInput | undefined, configured: boolean): LeadDebugView {
	if (!configured || stats === undefined) return LEAD_DEBUG_OFF;
	if (!stats.echoing) return LEAD_DEBUG_LEGACY;
	return { mode: "measured", tripP95Ms: wholeMs(stats.tripP95), tripP99Ms: wholeMs(stats.coverP99) };
}

/** Ticks -> whole ms (undefined stays undefined). */
function wholeMs(ticks: number | undefined): number | undefined {
	return ticks === undefined ? undefined : math.round(ticks * SIM_DT * LATENCY_PROBE.msPerSecond);
}

function roundTo(v: number, decimals: number): number {
	const k = math.pow(10, decimals);
	return math.round(v * k) / k;
}

/**
 * The debug line's prediction part from the client's prediction stats (undefined without prediction), whether the
 * client was built with it (false: KV_PredictOff), whether the local player is drawn predicted this frame, and the
 * smoother's snaps.
 */
export function predictionDebugView(
	stats: PredictionStatsInput | undefined,
	configured: boolean,
	predicting: boolean,
	snaps: number,
): PredictionDebugView {
	if (!configured || stats === undefined) return PREDICTION_DEBUG_OFF;
	return {
		mode: predicting ? "on" : "waiting",
		horizonTicks: predicting ? stats.horizonTicks : 0,
		meanError: roundTo(stats.meanError, PREDICTION_DEBUG_DECIMALS),
		maxError: roundTo(stats.maxError, PREDICTION_DEBUG_DECIMALS),
		snaps,
	};
}

/**
 * The probe's view for the debug line: its stats plus the client's effective lead, misses, net lead (default: the
 * effective lead), pacing part (default: off), lead part (default: legacy), mismatches (default: the misses) and
 * prediction part (default: off).
 */
export function latencyProbeView(
	probe: LatencyProbe,
	leadTicks: number,
	misses: number,
	netLeadTicks: number = leadTicks,
	pacing: PacingDebugView = PACING_DEBUG_OFF,
	lead: LeadDebugView = LEAD_DEBUG_LEGACY,
	mismatches: number = misses,
	prediction: PredictionDebugView = PREDICTION_DEBUG_OFF,
): LatencyProbeView {
	return { ...probe.stats(), leadTicks, netLeadTicks, misses, mismatches, pacing, lead, prediction };
}

function pacingViewsEqual(a: PacingDebugView, b: PacingDebugView): boolean {
	return (
		a.mode === b.mode &&
		a.depthTicks === b.depthTicks &&
		a.depthMs === b.depthMs &&
		a.holds === b.holds &&
		a.backlog === b.backlog &&
		a.jitterMs === b.jitterMs
	);
}

/**
 * True when two debug-line views would show the same line: every number and mode equal (both undefined counts as equal,
 * one undefined does not). The client's game store uses it to keep its state object when a new view changes nothing, so
 * the HUD does not re-render every frame.
 */
export function latencyProbeViewsEqual(a: LatencyProbeView | undefined, b: LatencyProbeView | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.leadTicks === b.leadTicks &&
		a.netLeadTicks === b.netLeadTicks &&
		a.misses === b.misses &&
		a.mismatches === b.mismatches &&
		pacingViewsEqual(a.pacing, b.pacing) &&
		a.lead.mode === b.lead.mode &&
		a.lead.tripP95Ms === b.lead.tripP95Ms &&
		a.lead.tripP99Ms === b.lead.tripP99Ms &&
		a.lastMs === b.lastMs &&
		a.meanMs === b.meanMs &&
		a.maxMs === b.maxMs &&
		a.count === b.count &&
		a.late === b.late &&
		a.drawnLastMs === b.drawnLastMs &&
		a.drawnMeanMs === b.drawnMeanMs &&
		a.prediction.mode === b.prediction.mode &&
		a.prediction.horizonTicks === b.prediction.horizonTicks &&
		a.prediction.meanError === b.prediction.meanError &&
		a.prediction.maxError === b.prediction.maxError &&
		a.prediction.snaps === b.prediction.snaps
	);
}

function msText(ms: number | undefined): string | number {
	return ms === undefined ? LATENCY_PROBE.none : math.round(ms);
}

/**
 * The vars of the `hud.debug.net` string: the effective lead in ticks and ms, last / mean / max press -> step in whole
 * ms, `late` = the client's misses (echoed lates), `misses` = its mismatches. Its `{netPart}` is the lead part's own
 * string (leadDebugKey / leadDebugVars), its `{pace}` the pacing part's (pacingDebugKey / pacingDebugVars) and its
 * `{pred}` the prediction part's (predictionDebugKey / predictionDebugVars), which the caller formats and passes in.
 */
export function latencyProbeVars(
	view: LatencyProbeView,
	pace = "",
	netPart = "",
	pred = "",
): Readonly<Record<string, string | number>> {
	return {
		lead: view.leadTicks,
		leadMs: math.round(view.leadTicks * SIM_DT * LATENCY_PROBE.msPerSecond),
		netPart,
		pace,
		pred,
		last: msText(view.lastMs),
		mean: msText(view.meanMs),
		max: msText(view.maxMs),
		count: view.count,
		late: view.misses,
		misses: view.mismatches,
	};
}

/** The lead part's string key by mode (LEAD_DEBUG_STRINGS; HUD_STRINGS leadProbe / leadProbeLegacy / leadProbeOff). */
export function leadDebugKey(view: LeadDebugView): string {
	return LEAD_DEBUG_STRINGS[view.mode];
}

/** The vars of the lead part's strings: the net lead in ticks, the trip p95 / the cover's p99 in whole ms ('-': none). */
export function leadDebugVars(view: LatencyProbeView): Readonly<Record<string, string | number>> {
	return { net: view.netLeadTicks, p95: msText(view.lead.tripP95Ms), p99: msText(view.lead.tripP99Ms) };
}

/** The pacing part's string key by mode (PACING_DEBUG_STRINGS; HUD_STRINGS paceProbe / paceProbeWait / paceProbeOff). */
export function pacingDebugKey(view: PacingDebugView): string {
	return PACING_DEBUG_STRINGS[view.mode];
}

/** The vars of the pacing part's strings: depth in ticks and ms, holds, backlog, jitter in ms. */
export function pacingDebugVars(view: PacingDebugView): Readonly<Record<string, number>> {
	return {
		depth: view.depthTicks,
		depthMs: view.depthMs,
		holds: view.holds,
		backlog: view.backlog,
		jitter: view.jitterMs,
	};
}

/** The prediction part's string key by mode (PREDICTION_DEBUG_STRINGS; HUD_STRINGS predProbe / predProbeWait / predProbeOff). */
export function predictionDebugKey(view: PredictionDebugView): string {
	return PREDICTION_DEBUG_STRINGS[view.mode];
}

/**
 * The vars of the prediction part's strings: the horizon in ticks, the window's mean / max head error in tiles
 * (PREDICTION_DEBUG_DECIMALS), the snaps, press -> drawn last / mean in whole ms ('-' while none).
 */
export function predictionDebugVars(view: LatencyProbeView): Readonly<Record<string, string | number>> {
	const p = view.prediction;
	return {
		h: p.horizonTicks,
		mean: string.format(`%.${PREDICTION_DEBUG_DECIMALS}f`, p.meanError),
		max: string.format(`%.${PREDICTION_DEBUG_DECIMALS}f`, p.maxError),
		snaps: p.snaps,
		drawn: msText(view.drawnLastMs),
		drawnMean: msText(view.drawnMeanMs),
	};
}
