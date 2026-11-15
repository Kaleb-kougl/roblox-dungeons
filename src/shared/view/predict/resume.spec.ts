// docs/NEW_ENEMIES_2.md NX7: local prediction suspended while the local player is hooked (merged state), then blended
// back over PREDICTION_VIEW.resumeSec: the drawn player equals the merged one on every hooked frame, and the blend back
// never moves the knight more than a tile in a frame beyond what the merged body moved, at any frame rate.
import { describe, expect, it } from "@rbxts/jest-globals";
import { newPlayerState, type PlayerState } from "shared/sim";
import {
	PREDICTION_VIEW,
	PredictionResume,
	blendTowardMerged,
	writeDrawnPlayer,
	type PredictedMotion,
	type PredictionViewTunables,
} from ".";

/** The prediction's worst gap: PREDICTION.maxTicks (20) of a full-speed walk (6 u/s), plus the smoother's 1 tile. */
const WORST_GAP = 2 + PREDICTION_VIEW.maxOffsetTiles;

function head(x: number, z: number): PredictedMotion {
	return { x, z, prevX: x, prevZ: z, faceX: 1, faceZ: 0, rollTicks: 0, rollDirX: 0, rollDirZ: 0, flaskTicks: 0 };
}

/** The drawn x of one frame: writeDrawnPlayer then the blend, as SimController.updateDrawn does. */
function drawnX(merged: PlayerState, predictedX: number, w: number): number {
	if (w <= 0) return merged.x; // drawnActive false: getDrawnPlayer is playerAt itself
	const out = newPlayerState(0, 0);
	writeDrawnPlayer(out, merged, head(predictedX, merged.z), 0, 0);
	blendTowardMerged(out, merged, w);
	return out.x;
}

describe("PredictionResume (docs/NEW_ENEMIES_2.md NX7)", () => {
	it("is 0 on every hooked frame and climbs back to 1 over resumeSec", () => {
		const r = new PredictionResume(PREDICTION_VIEW);
		expect(r.weight()).toBe(1);
		const dt = 1 / 60;
		for (let i = 0; i < 30; i++) expect(r.update(true, dt)).toBe(0);
		let frames = 0;
		while (r.update(false, dt) < 1) frames++;
		const ideal = math.ceil(PREDICTION_VIEW.resumeSec / dt - 1e-9);
		expect([ideal, frames + 1 >= ideal && frames + 1 <= ideal + 1]).toEqual([ideal, true]);
		expect(r.update(false, dt)).toBe(1);
		r.update(true, dt);
		r.reset();
		expect(r.weight()).toBe(1);
	});

	it("draws exactly the merged player while hooked, at any frame rate", () => {
		for (const dt of [1 / 240, 1 / 60, 1 / 20, 0.5]) {
			const r = new PredictionResume(PREDICTION_VIEW);
			const merged = newPlayerState(3, 1);
			for (let i = 0; i < 20; i++) {
				merged.prevX = merged.x;
				merged.x += 0.15; // the drag
				const w = r.update(true, dt);
				expect(drawnX(merged, merged.x + WORST_GAP, w)).toBe(merged.x);
			}
		}
	});

	it("never jumps more than a tile in a frame on the way back (beyond the merged body's own step)", () => {
		for (const dt of [1 / 240, 1 / 60, 1 / 30, 1 / 10, 0.5, 2]) {
			const r = new PredictionResume(PREDICTION_VIEW);
			const merged = newPlayerState(0, 0);
			r.update(true, dt);
			let last = drawnX(merged, WORST_GAP, r.weight());
			let reached = false;
			for (let i = 0; i < 400 && !reached; i++) {
				merged.prevX = merged.x;
				merged.x += 0.1; // walking on, the prediction the worst gap ahead
				const w = r.update(false, dt);
				const now = drawnX(merged, merged.x + WORST_GAP, w);
				expect([dt, math.abs(now - last - 0.1) <= 1]).toEqual([dt, true]);
				last = now;
				reached = w >= 1;
			}
			expect([dt, reached]).toEqual([dt, true]);
			expect(last).toBe(merged.x + WORST_GAP); // fully predicted again: bit-exact writeDrawnPlayer
		}
	});

	it("an optional blend into merged at the latch (suspendSec > 0) is bounded the same way", () => {
		const t: PredictionViewTunables = { ...PREDICTION_VIEW, suspendSec: 0.1 };
		const r = new PredictionResume(t);
		const merged = newPlayerState(0, 0);
		let last = drawnX(merged, WORST_GAP, 1);
		for (let i = 0; i < 30; i++) {
			const w = r.update(true, 1 / 60);
			const now = drawnX(merged, WORST_GAP, w);
			expect(math.abs(now - last) <= 1).toBe(true);
			last = now;
		}
		expect(last).toBe(merged.x);
	});

	it("blendTowardMerged moves position and prev only, and leaves w >= 1 untouched", () => {
		const merged = newPlayerState(1, 2);
		merged.prevX = 0.5;
		merged.prevZ = 1.5;
		const out = newPlayerState(5, 6);
		out.prevX = 4;
		out.prevZ = 5;
		out.hearts = 9;
		blendTowardMerged(out, merged, 0.25);
		expect([out.x, out.z, out.prevX, out.prevZ, out.hearts]).toEqual([2, 3, 1.375, 2.375, 9]);
		const keep = newPlayerState(5, 6);
		blendTowardMerged(keep, merged, 1);
		expect([keep.x, keep.z]).toEqual([5, 6]);
	});
});
