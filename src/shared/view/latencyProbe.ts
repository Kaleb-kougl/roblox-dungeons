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
import { LATENCY_PROBE } from "./latencyProbeConfig";

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

/** What the debug line shows (the SimController hands it to the HUD store). */
export interface LatencyProbeView extends LatencyProbeStats {
	/** The client's input lead, ticks (LockstepClient.inputLead()). */
	readonly leadTicks: number;
	/** Deadline misses of this client's own input so far (LockstepClient.misses). */
	readonly misses: number;
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

/** The probe's view for the debug line: its stats plus the client's lead and misses. */
export function latencyProbeView(probe: LatencyProbe, leadTicks: number, misses: number): LatencyProbeView {
	return { ...probe.stats(), leadTicks, misses };
}

export function latencyProbeViewsEqual(a: LatencyProbeView | undefined, b: LatencyProbeView | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.leadTicks === b.leadTicks &&
		a.misses === b.misses &&
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

/** The vars of the `hud.debug.net` string: lead in ticks and ms, last / mean / max press -> step in whole ms. */
export function latencyProbeVars(view: LatencyProbeView): Readonly<Record<string, string | number>> {
	return {
		lead: view.leadTicks,
		leadMs: math.round(view.leadTicks * SIM_DT * LATENCY_PROBE.msPerSecond),
		last: msText(view.lastMs),
		mean: msText(view.meanMs),
		max: msText(view.maxMs),
		count: view.count,
		late: view.late,
		misses: view.misses,
	};
}
