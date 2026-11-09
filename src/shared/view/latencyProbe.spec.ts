// The co-op latency probe (docs/FEEL.md J9): press edges, the first frame that sampled them, the tick they go out for,
// the step that carries them; late presses, the rolling window, the debug line's vars; and, against a real
// LockstepClient on a loopback server, that nextInputTick() is the tick each sampled input is sent for.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Button, EMPTY_INPUT, SIM_DT, copyInput, type InputFrame } from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { DEFAULT_LOCKSTEP, LockstepClient, MergedEncoder, decodeInputBatch } from "shared/lockstep";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import {
	LATENCY_PROBE,
	LEAD_DEBUG_LEGACY,
	LEAD_DEBUG_OFF,
	LatencyProbe,
	PACING_DEBUG_OFF,
	latencyProbeVars,
	leadDebugKey,
	leadDebugVars,
	leadDebugView,
	latencyProbeView,
	latencyProbeViewsEqual,
	pacingDebugKey,
	pacingDebugVars,
	pacingDebugView,
	type LatencyProbeView,
} from "shared/view";
import { HUD_STRINGS } from "shared/view/hud";

const FIRE = Button.FIRE;
const ROLL = Button.ROLL;

describe("LatencyProbe", () => {
	it("measures a press from the frame that sampled it to the step of its tick", () => {
		const p = new LatencyProbe();
		p.frame(FIRE, 1);
		p.sent(FIRE, 10);
		p.stepped(5, 1, false);
		expect(p.pending()).toBe(1);
		p.frame(FIRE, 1.05);
		p.sent(FIRE, 11); // held: not a new press
		p.stepped(10, 1.05, false); // tick 10 not stepped yet
		expect(p.stats().count).toBe(0);
		p.stepped(11, 1.1, false);
		const s = p.stats();
		expect(s.count).toBe(1);
		expect(s.lastMs).toBeCloseTo(100, 6);
		expect(p.pending()).toBe(0);
	});

	it("a press sampled in frames that stepped nothing keeps its first frame's time", () => {
		const p = new LatencyProbe();
		p.frame(FIRE, 2);
		p.stepped(0, 2, false); // nothing stepped, nothing sent
		p.frame(FIRE, 2.02);
		p.sent(FIRE, 7);
		p.stepped(8, 2.05, false);
		expect(p.stats().lastMs).toBeCloseTo(50, 6);
	});

	it("a tap released before it was sent is not measured; the next press starts fresh", () => {
		const p = new LatencyProbe();
		p.frame(FIRE, 0);
		p.frame(0, 0.01);
		p.sent(0, 3);
		p.frame(ROLL, 0.5);
		p.sent(ROLL, 4);
		p.stepped(5, 0.6, false);
		const s = p.stats();
		expect(s.count).toBe(1);
		expect(s.lastMs).toBeCloseTo(100, 6);
	});

	it("re-pressing after a release is a new press; a second button joining a held one is too", () => {
		const p = new LatencyProbe();
		p.frame(FIRE, 0);
		p.sent(FIRE, 1);
		p.frame(0, 0.1);
		p.sent(0, 2);
		p.frame(FIRE, 0.2);
		p.sent(FIRE, 3);
		p.frame(bit32.bor(FIRE, ROLL), 0.3);
		p.sent(bit32.bor(FIRE, ROLL), 4);
		expect(p.pending()).toBe(3);
		p.stepped(5, 0.4, false);
		expect(p.stats().count).toBe(3);
	});

	it("a tap latched across a frame boundary (a fall's skipped tick) is measured from the frame that pressed it", () => {
		const p = new LatencyProbe();
		// Frame 1 samples the tap; its step's target was already sent, so the client latches it (no send).
		p.frame(FIRE, 1);
		// Frame 2: released, but the caller passes the latched buttons too (input | latchedButtons()).
		const released = 0;
		p.frame(bit32.bor(released, FIRE), 1.02);
		p.sent(FIRE, 20);
		p.stepped(21, 1.1, false);
		const s = p.stats();
		expect(s.count).toBe(1);
		expect(s.lastMs).toBeCloseTo(100, 6);
	});

	it("a press resolved in a pump with a deadline miss is late, not measured", () => {
		const p = new LatencyProbe();
		p.frame(FIRE, 0);
		p.sent(FIRE, 4);
		p.stepped(5, 0.1, true);
		const s = p.stats();
		expect([s.count, s.late, s.lastMs]).toEqual([0, 1, undefined]);
	});

	it("mean and max cover the last `window` presses", () => {
		const p = new LatencyProbe(3);
		const ms = [10, 40, 20, 30, 60];
		for (let k = 0; k < ms.size(); k++) {
			p.frame(FIRE, k);
			p.sent(FIRE, k);
			p.stepped(k + 1, k + ms[k] / LATENCY_PROBE.msPerSecond, false);
			p.frame(0, k);
			p.sent(0, k);
		}
		const s = p.stats();
		expect(s.count).toBe(3);
		expect(s.lastMs).toBeCloseTo(60, 6);
		expect(s.meanMs).toBeCloseTo((20 + 30 + 60) / 3, 6);
		expect(s.maxMs).toBeCloseTo(60, 6);
	});

	it("at most `maxPending` presses wait at once", () => {
		const p = new LatencyProbe(LATENCY_PROBE.window, 2);
		for (let k = 0; k < 4; k++) {
			p.frame(FIRE, k);
			p.sent(FIRE, 100 + k);
			p.frame(0, k);
			p.sent(0, 100 + k);
		}
		expect(p.pending()).toBe(2);
	});

	it("the debug line's vars: lead in ticks and ms, whole ms, '-' before the first press", () => {
		const p = new LatencyProbe();
		const lead = DEFAULT_LOCKSTEP.inputDelay;
		const none = latencyProbeVars(latencyProbeView(p, lead, 0));
		expect(none.lead).toBe(lead);
		expect(none.leadMs).toBe(math.round(lead * SIM_DT * LATENCY_PROBE.msPerSecond));
		expect([none.last, none.mean, none.max, none.count, none.late, none.misses]).toEqual([
			LATENCY_PROBE.none,
			LATENCY_PROBE.none,
			LATENCY_PROBE.none,
			0,
			0,
			0,
		]);
		p.frame(FIRE, 0);
		p.sent(FIRE, 1);
		p.stepped(2, 0.0834, false);
		const v = latencyProbeView(p, lead + 1, 2);
		const vars = latencyProbeVars(v);
		expect([vars.last, vars.mean, vars.max, vars.count, vars.misses]).toEqual([83, 83, 83, 1, 2]);
		expect(latencyProbeViewsEqual(v, latencyProbeView(p, lead + 1, 2))).toBe(true);
		expect(latencyProbeViewsEqual(v, latencyProbeView(p, lead, 2))).toBe(false);
		expect(latencyProbeViewsEqual(undefined, undefined)).toBe(true);
		expect(latencyProbeViewsEqual(v, undefined)).toBe(false);
	});
});

describe("LatencyProbe on a LockstepClient (loopback server, one tick per frame)", () => {
	const SEED = 31337;
	const DT = SIM_DT;

	it("nextInputTick() is the tick each sampled input goes out for; a press steps lead + 1 ticks later", () => {
		const setup = buildEndlessRunConfig(SEED, 2);
		const c = new LockstepClient({
			runId: "probe",
			seed: SEED,
			spawn: setup.spawn!,
			config: setup.config,
			players: 2,
			localIndex: 0,
		});
		const enc = new MergedEncoder(2);
		const probe = new LatencyProbe();
		// The loopback server: tick t carries what the client sent for t (no deadline miss), else an empty input.
		const sent = new Map<number, InputFrame>();
		const pressFrame = 10;
		const frames = 30;
		for (let k = 0; k < frames; k++) {
			const mine = sent.get(k) ?? EMPTY_INPUT;
			expect(c.receive(k, enc.encode([[copyInput(mine), copyInput(EMPTY_INPUT)]]))).toBe(true);
			const now = k * DT;
			const input = copyInput(EMPTY_INPUT);
			if (k >= pressFrame) input.buttons = FIRE;
			probe.frame(input.buttons, now);
			const targets: number[] = [];
			const missesBefore = c.misses;
			const res = c.pump(DT, (sending) => {
				// Only a sample that is sent is a send (a fall's skipped tick only latches its buttons).
				if (sending) {
					targets.push(c.nextInputTick());
					probe.sent(bit32.bor(input.buttons, c.latchedButtons()), c.nextInputTick());
				}
				return input;
			});
			probe.stepped(c.state.tick, now, c.misses > missesBefore);
			expect(res.stepped).toBe(1);
			// Every sampled input went out for the tick nextInputTick() named.
			let n = 0;
			for (const b of res.inputs) {
				const batch = decodeInputBatch(b.data, DEFAULT_LOCKSTEP.maxBatchFrames)!;
				for (let j = 0; j < batch.size(); j++) {
					expect(b.firstTick + j).toBe(targets[n]);
					sent.set(b.firstTick + j, batch[j]);
					n++;
				}
			}
			expect(n).toBe(targets.size());
		}
		expect(c.misses).toBe(0);
		expect(c.inputLead()).toBe(DEFAULT_LOCKSTEP.inputDelay);
		const s = probe.stats();
		expect([s.count, s.late]).toEqual([1, 0]);
		expect(s.lastMs).toBeCloseTo((DEFAULT_LOCKSTEP.inputDelay + 1) * DT * LATENCY_PROBE.msPerSecond, 6);
	});
});

describe("the debug line's pacing part (docs/FRAME_PACING.md Design 7)", () => {
	const stats = { started: true, depthTicks: 4, depthMs: 58.4, jitterMs: 9.6, holds: 2 };
	const warnings: string[] = [];
	const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
	const line = (v: LatencyProbeView) =>
		pack.str(
			HUD_STRINGS.netProbe,
			latencyProbeVars(
				v,
				pack.str(pacingDebugKey(v.pacing), pacingDebugVars(v.pacing)),
				pack.str(leadDebugKey(v.lead), leadDebugVars(v)),
			),
		);

	it("off without pacing (KV_PacingOff), waiting before the playout clock starts, else the pacer's numbers", () => {
		expect(pacingDebugView(stats, 3, false)).toEqual(PACING_DEBUG_OFF);
		expect(pacingDebugView(undefined, 3, true)).toEqual({ ...PACING_DEBUG_OFF, mode: "waiting", backlog: 3 });
		expect(pacingDebugView({ ...stats, started: false }, 1, true).mode).toBe("waiting");
		expect(pacingDebugView(stats, 3, true)).toEqual({
			mode: "on",
			depthTicks: 4,
			depthMs: 58,
			holds: 2,
			backlog: 3,
			jitterMs: 10,
		});
		expect([pacingDebugKey(PACING_DEBUG_OFF), pacingDebugKey(pacingDebugView(stats, 0, true))]).toEqual([
			HUD_STRINGS.paceProbeOff,
			HUD_STRINGS.paceProbe,
		]);
		expect(pacingDebugKey(pacingDebugView(undefined, 0, true))).toBe(HUD_STRINGS.paceProbeWait);
	});

	it("shows the effective lead, the net lead and the pacing part", () => {
		const p = new LatencyProbe();
		const paced = latencyProbeView(p, 7, 1, 3, pacingDebugView(stats, 3, true));
		expect(line(paced)).toBe(
			"co-op lead 7t 117ms (net 3t legacy) · pace 4t 58ms · holds 2 · backlog 3 · jitter p95 10ms · " +
				"press->step -ms avg - max - n0 · late 1 miss 1",
		);
		const off = latencyProbeView(p, 3, 0, 3, pacingDebugView(undefined, 2, false), LEAD_DEBUG_OFF);
		expect(line(off)).toBe(
			"co-op lead 3t 50ms (net 3t, lead off (KV_LeadOff)) · pace off (KV_PacingOff) · press->step -ms avg - max - " +
				"n0 · late 0 miss 0",
		);
		// The measured lead (docs/FRAME_PACING.md Design 11): trip p95 9.4 ticks = 157 ms; late = echoed lates, miss =
		// mismatches.
		const measured = latencyProbeView(
			p,
			18,
			4,
			11,
			pacingDebugView(stats, 3, true),
			leadDebugView({ echoing: true, tripP95: 9.4 }, true),
			1,
		);
		expect(line(measured)).toBe(
			"co-op lead 18t 300ms (net 11t, trip p95 157ms) · pace 4t 58ms · holds 2 · backlog 3 · jitter p95 10ms · " +
				"press->step -ms avg - max - n0 · late 4 miss 1",
		);
		const waiting = latencyProbeView(p, 3, 0, 3, pacingDebugView(undefined, 2, true));
		expect(line(waiting).find("· pace waiting · backlog 2 ·", 1, true)[0]).never.toBe(undefined);
		expect(warnings).toEqual([]);
	});

	it("the lead part: off without the measured lead, legacy while not echoing, whole ms while measured", () => {
		expect(leadDebugView(undefined, true)).toEqual(LEAD_DEBUG_OFF);
		expect(leadDebugView({ echoing: true, tripP95: 5 }, false)).toEqual(LEAD_DEBUG_OFF);
		expect(leadDebugView({ echoing: false, tripP95: 5 }, true)).toEqual(LEAD_DEBUG_LEGACY);
		expect(leadDebugView({ echoing: true, tripP95: undefined }, true)).toEqual({
			mode: "measured",
			tripP95Ms: undefined,
		});
		const v = leadDebugView({ echoing: true, tripP95: 9.4 }, true);
		expect(v).toEqual({ mode: "measured", tripP95Ms: 157 });
		expect([leadDebugKey(LEAD_DEBUG_OFF), leadDebugKey(LEAD_DEBUG_LEGACY), leadDebugKey(v)]).toEqual([
			HUD_STRINGS.leadProbeOff,
			HUD_STRINGS.leadProbeLegacy,
			HUD_STRINGS.leadProbe,
		]);
		// Sub-millisecond trip changes round away: the HUD store keeps its view.
		const p = new LatencyProbe();
		const a = latencyProbeView(p, 12, 0, 9, PACING_DEBUG_OFF, v, 0);
		const near = leadDebugView({ echoing: true, tripP95: 9.41 }, true);
		expect(latencyProbeViewsEqual(a, latencyProbeView(p, 12, 0, 9, PACING_DEBUG_OFF, near, 0))).toBe(true);
		expect(latencyProbeViewsEqual(a, latencyProbeView(p, 12, 0, 9, PACING_DEBUG_OFF, LEAD_DEBUG_LEGACY, 0))).toBe(
			false,
		);
		expect(latencyProbeViewsEqual(a, latencyProbeView(p, 12, 0, 9, PACING_DEBUG_OFF, v, 1))).toBe(false);
		expect(leadDebugVars(a)).toEqual({ net: 9, p95: 157 });
	});

	it("a change in the net lead or the pacing part is a new view (the HUD store updates)", () => {
		const p = new LatencyProbe();
		const v = latencyProbeView(p, 7, 0, 3, pacingDebugView(stats, 3, true));
		expect(latencyProbeViewsEqual(v, latencyProbeView(p, 7, 0, 3, pacingDebugView(stats, 3, true)))).toBe(true);
		expect(latencyProbeViewsEqual(v, latencyProbeView(p, 7, 0, 4, pacingDebugView(stats, 3, true)))).toBe(false);
		expect(latencyProbeViewsEqual(v, latencyProbeView(p, 7, 0, 3, pacingDebugView(stats, 2, true)))).toBe(false);
		const held = pacingDebugView({ ...stats, holds: 3 }, 3, true);
		expect(latencyProbeViewsEqual(v, latencyProbeView(p, 7, 0, 3, held))).toBe(false);
		// Sub-millisecond changes round away.
		const near = pacingDebugView({ ...stats, depthMs: 58.3, jitterMs: 9.7 }, 3, true);
		expect(latencyProbeViewsEqual(v, latencyProbeView(p, 7, 0, 3, near))).toBe(true);
	});

	it("with a paced LockstepClient: the effective lead is the net lead plus the depth", () => {
		const seed = 31337;
		const setup = buildEndlessRunConfig(seed, 1);
		const client = new LockstepClient({
			runId: "paced",
			seed,
			spawn: setup.spawn!,
			config: setup.config,
			players: 1,
			localIndex: 0,
		});
		const enc = new MergedEncoder(1);
		const neutral = copyInput(EMPTY_INPUT);
		let t = 0;
		client.pump(SIM_DT, () => neutral, t);
		for (let k = 0; k < 4; k++)
			expect(client.receive(k, enc.encode([[copyInput(EMPTY_INPUT)]]), (t += SIM_DT))).toBe(true);
		client.pump(SIM_DT, () => neutral, t);
		const view = latencyProbeView(
			new LatencyProbe(),
			client.inputLead(),
			client.misses,
			client.netLead(),
			pacingDebugView(client.pacingStats(), client.backlog(), true),
		);
		expect(view.pacing.mode).toBe("on");
		expect(view.pacing.depthTicks).toBeGreaterThanOrEqual(DEFAULT_LOCKSTEP.pacing!.minDepthTicks);
		expect(view.leadTicks).toBe(view.netLeadTicks + view.pacing.depthTicks);
		expect(view.netLeadTicks).toBe(DEFAULT_LOCKSTEP.inputDelay);
	});
});
