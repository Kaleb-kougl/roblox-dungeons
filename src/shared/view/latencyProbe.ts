/**
 * Co-op latency probe (docs/FEEL.md J9, KV_Debug only): how long a button press takes from the moment this client
 * samples it to the moment the first tick that carries it is stepped here. Pure bookkeeping on numbers the caller
 * hands in (button bits, ticks, its clock): it reads nothing from the sim and changes nothing that is sent, stepped,
 * hashed or recorded.
 *
 * Per rendered frame of a co-op run, in this order:
 *   frame(buttons, now)            the frame's sampled input (what the client would send)
 *   sent(buttons, tick)            inside LockstepClient.pump's sample: that input goes out for `tick`
 *                                  (LockstepClient.nextInputTick())
 *   stepped(nextTick, now, missed) after the pump: every tick below `nextTick` (state.tick) has been stepped. `missed`:
 *                                  the pump saw one of this client's inputs miss the server's deadline, so a press
 *                                  resolved in it may have landed later than its tick: counted as `late`, not measured.
 *
 * A press is a button bit sent that the previous sent input did not have; its time is the first frame that sampled it
 * (a press sampled in a frame that stepped nothing waits for the next send). A press released before it was ever sent
 * is not measured.
 */
import { SIM_DT } from "shared/sim";
import { LATENCY_PROBE, PACING_DEBUG_STRINGS } from "./latencyProbeConfig";

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
}

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

/** What the debug line shows (the SimController hands it to the HUD store). */
export interface LatencyProbeView extends LatencyProbeStats {
	/**
	 * The client's EFFECTIVE input lead, ticks (LockstepClient.inputLead(): how far its sent inputs reach, the pacing
	 * buffer's depth included).
	 */
	readonly leadTicks: number;
	/** The network part of the lead, ticks (LockstepClient.netLead(): the lead that adapts to misses, no depth). */
	readonly netLeadTicks: number;
	/** Deadline misses of this client's own input so far (LockstepClient.misses). */
	readonly misses: number;
	/** The pacing part (docs/FRAME_PACING.md Design 7). */
	readonly pacing: PacingDebugView;
}

export class LatencyProbe {
	private prevSent = 0;
	private edgeAt: number | undefined;
	private readonly pendingTicks: number[] = [];
	private readonly pendingAt: number[] = [];
	private readonly samples: number[] = [];
	private head = 0;
	private lastMs: number | undefined;
	private late = 0;

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
		if (at === undefined || this.pendingTicks.size() >= this.maxPending) return;
		this.pendingTicks.push(tick);
		this.pendingAt.push(at);
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
		return { lastMs: this.lastMs, meanMs: n > 0 ? sum / n : undefined, maxMs: max, count: n, late: this.late };
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
 * The probe's view for the debug line: its stats plus the client's effective lead, misses, net lead (default: the
 * effective lead) and pacing part (default: off).
 */
export function latencyProbeView(
	probe: LatencyProbe,
	leadTicks: number,
	misses: number,
	netLeadTicks: number = leadTicks,
	pacing: PacingDebugView = PACING_DEBUG_OFF,
): LatencyProbeView {
	return { ...probe.stats(), leadTicks, netLeadTicks, misses, pacing };
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

export function latencyProbeViewsEqual(a: LatencyProbeView | undefined, b: LatencyProbeView | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.leadTicks === b.leadTicks &&
		a.netLeadTicks === b.netLeadTicks &&
		a.misses === b.misses &&
		pacingViewsEqual(a.pacing, b.pacing) &&
		a.lastMs === b.lastMs &&
		a.meanMs === b.meanMs &&
		a.maxMs === b.maxMs &&
		a.count === b.count &&
		a.late === b.late
	);
}

function msText(ms: number | undefined): string | number {
	return ms === undefined ? LATENCY_PROBE.none : math.round(ms);
}

/**
 * The vars of the `hud.debug.net` string: the effective lead in ticks and ms, the net lead in ticks, last / mean / max
 * press -> step in whole ms. Its `{pace}` is the pacing part's own string (pacingDebugKey / pacingDebugVars), which the
 * caller formats and passes as `pace`.
 */
export function latencyProbeVars(view: LatencyProbeView, pace = ""): Readonly<Record<string, string | number>> {
	return {
		lead: view.leadTicks,
		leadMs: math.round(view.leadTicks * SIM_DT * LATENCY_PROBE.msPerSecond),
		net: view.netLeadTicks,
		pace,
		last: msText(view.lastMs),
		mean: msText(view.meanMs),
		max: msText(view.maxMs),
		count: view.count,
		late: view.late,
		misses: view.misses,
	};
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
