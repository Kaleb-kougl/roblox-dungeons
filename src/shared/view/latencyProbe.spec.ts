// The co-op latency probe (docs/FEEL.md J9): press edges, the first frame that sampled them, the tick they go out for,
// the step that carries them; late presses, the rolling window, the debug line's vars; and, against a real
// LockstepClient on a loopback server, that nextInputTick() is the tick each sampled input is sent for.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Button, EMPTY_INPUT, SIM_DT, copyInput, type InputFrame } from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { DEFAULT_LOCKSTEP, LockstepClient, MergedEncoder, decodeInputBatch } from "shared/lockstep";
import { LATENCY_PROBE, LatencyProbe, latencyProbeVars, latencyProbeView, latencyProbeViewsEqual } from "shared/view";

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
			const res = c.pump(DT, () => {
				targets.push(c.nextInputTick());
				probe.sent(input.buttons, c.nextInputTick());
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
