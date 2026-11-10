/**
 * docs/LOCAL_PREDICTION.md LP6: the KV_Debug pieces of local prediction: the latency probe's press -> drawn, the debug
 * line's prediction part, and KV_CollisionDebug's two body rings.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { newPlayerState } from "shared/sim";
import {
	LatencyProbe,
	PREDICTION_DEBUG_OFF,
	PREDICTION_DEBUG_STRINGS,
	collisionRings,
	latencyProbeVars,
	latencyProbeView,
	latencyProbeViewsEqual,
	predictionDebugKey,
	predictionDebugVars,
	predictionDebugView,
	type CollisionRings,
} from ".";

const FIRE = 1;
const FRAME = 1 / 60;

/** One press sent for tick `target` at t = 0; the frames after it step a tick each from `next`. */
function pressAt(p: LatencyProbe, target: number): void {
	p.frame(FIRE, 0);
	p.sent(FIRE, target);
}

describe("local prediction debug (docs/LOCAL_PREDICTION.md LP6)", () => {
	it("press -> drawn: answered once the drawn knight shows the press's tick (ahead = the horizon)", () => {
		const lead = 12;
		// Predicted 10 ticks ahead: the press for tick 12 shows once state.tick + 10 > 12, three frames later.
		const p = new LatencyProbe();
		pressAt(p, lead);
		for (let k = 1; k <= 3; k++) p.drawn(k, 10, k * FRAME);
		expect(p.stats().drawnLastMs).toBeCloseTo(3 * FRAME * 1000, 9);
		// Without prediction (ahead 0) press -> drawn is press -> step: the tick itself must be stepped.
		const q = new LatencyProbe();
		pressAt(q, lead);
		for (let k = 1; k <= lead + 1; k++) q.drawn(k, 0, k * FRAME);
		expect(q.stats().drawnLastMs).toBeCloseTo((lead + 1) * FRAME * 1000, 9);
		expect(q.stats().drawnMeanMs).toBe(q.stats().drawnLastMs);
	});

	it("the prediction part: off, waiting, on with rounded errors and the snaps", () => {
		const stats = { horizonTicks: 10, meanError: 0.01234, maxError: 0.5678 };
		expect(predictionDebugView(stats, false, true, 3)).toBe(PREDICTION_DEBUG_OFF);
		expect(predictionDebugView(undefined, true, true, 3)).toBe(PREDICTION_DEBUG_OFF);
		const waiting = predictionDebugView(stats, true, false, 3);
		expect(waiting.mode).toBe("waiting");
		expect(waiting.horizonTicks).toBe(0);
		const on = predictionDebugView(stats, true, true, 3);
		expect([on.mode, on.horizonTicks, on.meanError, on.maxError, on.snaps]).toEqual(["on", 10, 0.01, 0.57, 3]);
		expect(predictionDebugKey(on)).toBe(PREDICTION_DEBUG_STRINGS.on);
		expect(predictionDebugKey(waiting)).toBe(PREDICTION_DEBUG_STRINGS.waiting);
		expect(predictionDebugKey(PREDICTION_DEBUG_OFF)).toBe(PREDICTION_DEBUG_STRINGS.off);
		const probe = new LatencyProbe();
		const view = latencyProbeView(probe, 14, 0, 11, undefined, undefined, 0, on);
		const vars = predictionDebugVars(view);
		expect([vars.h, vars.mean, vars.max, vars.snaps, vars.drawn]).toEqual([10, "0.01", "0.57", 3, "-"]);
		expect(latencyProbeVars(view, "pace", "net", "PRED").pred).toBe("PRED");
		// The store only changes with the line: a different prediction part is a different view.
		expect(latencyProbeViewsEqual(view, latencyProbeView(probe, 14, 0, 11, undefined, undefined, 0, waiting))).toBe(
			false,
		);
		expect(latencyProbeViewsEqual(view, latencyProbeView(probe, 14, 0, 11, undefined, undefined, 0, on))).toBe(
			true,
		);
	});

	it("KV_CollisionDebug's rings: one ring at the merged body without prediction, two with it", () => {
		const out: CollisionRings = { bodyX: 0, bodyZ: 0, mergedShown: false, mergedX: 0, mergedZ: 0 };
		const merged = newPlayerState(2, 3);
		merged.prevX = 1;
		collisionRings(merged, merged, 0.5, out);
		expect([out.bodyX, out.bodyZ, out.mergedShown]).toEqual([1.5, 3, false]);
		const drawn = newPlayerState(4, 3);
		drawn.prevX = 3;
		collisionRings(drawn, merged, 0.5, out);
		expect([out.bodyX, out.mergedShown, out.mergedX, out.mergedZ]).toEqual([3.5, true, 1.5, 3]);
	});
});
