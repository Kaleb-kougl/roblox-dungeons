/** docs/LOCAL_PREDICTION.md LP4: the PredictionSmoother (shared/view/predict/smoother.ts). */
import { describe, expect, it } from "@rbxts/jest-globals";
import { PREDICTION_VIEW, PredictionSmoother, type PredictedBody, type PredictionPath } from ".";

/** The knight's walk, tiles per second (playerData PLAYER_SPEED). */
const WALK = 6;
const TICK = 1 / 60;

function body(x: number, prevX: number, z = 0, prevZ = 0, faceX = 1, faceZ = 0): PredictedBody {
	return { x, z, prevX, prevZ, faceX, faceZ };
}

/** Ticks a walk prediction replays (its path: the merged tick and HORIZON more). */
const HORIZON = 10;

/** A walk along +x at WALK: the head for tick t is at t x WALK x TICK, plus `shift` (a newer, corrected guess). */
function walkHead(t: number, shift = 0): PredictedBody {
	return body(t * WALK * TICK + shift, (t - 1) * WALK * TICK + shift);
}

/** The walk's path for a head at tick t (ticks t - HORIZON .. t), every entry shifted like the head. */
function walkPath(t: number, shift = 0): PredictionPath {
	const xs: number[] = [];
	const zs: number[] = [];
	for (let k = 0; k <= HORIZON; k++) {
		xs.push((t - HORIZON + k) * WALK * TICK + shift);
		zs.push(0);
	}
	return { firstTick: t - HORIZON, size: HORIZON + 1, xs, zs };
}

function feedWalk(s: PredictionSmoother, t: number, shift = 0): void {
	s.feed(walkHead(t, shift), walkPath(t, shift));
}

describe("PredictionSmoother (docs/LOCAL_PREDICTION.md LP4)", () => {
	it("with no correction the drawn pose is exactly lerp(prev, x, alpha)", () => {
		const s = new PredictionSmoother(PREDICTION_VIEW);
		for (let t = 10; t < 200; t++) {
			const h = walkHead(t);
			feedWalk(s, t);
			for (const alpha of [0, 0.25, 0.5, 0.999]) {
				const d = s.draw(alpha, TICK / 4)!;
				expect(d.x).toBe(h.prevX + (h.x - h.prevX) * alpha);
				expect(d.z).toBe(0);
			}
		}
		expect(s.correctionCount()).toBe(0);
		expect(s.offset()).toBe(0);
	});

	for (const fps of [30, 60, 144]) {
		it(`a 0.3-tile correction decays below 0.01 within 0.4 s at ${fps} fps, the body never jumping`, () => {
			const s = new PredictionSmoother(PREDICTION_VIEW);
			const dt = 1 / fps;
			let clock = 0;
			let fed = -1;
			let last: number | undefined;
			let worst = 0;
			let correctedAt: number | undefined;
			for (let frame = 0; frame < fps * 2; frame++) {
				clock += dt;
				const t = math.floor(clock / TICK);
				if (t !== fed) {
					// Half a second in, every newer prediction is 0.3 tiles behind the older ones (a miss's correction).
					const shift = clock >= 0.5 ? -0.3 : 0;
					if (shift !== 0 && correctedAt === undefined) correctedAt = clock;
					feedWalk(s, t, shift);
					fed = t;
				}
				const alpha = clock / TICK - t;
				const offsetBefore = s.offset();
				const d = s.draw(alpha, dt)!;
				if (last !== undefined) {
					// The drawn body moves at most the walk's frame plus what the offset gave up this frame.
					const moved = math.abs(d.x - last);
					const allowed = WALK * dt + math.abs(offsetBefore - s.offset()) + 1e-9;
					worst = math.max(worst, moved - allowed);
				}
				last = d.x;
				if (correctedAt !== undefined && clock >= correctedAt + 0.4 && clock < correctedAt + 0.4 + dt) {
					expect(s.offset()).toBeLessThan(0.01);
				}
			}
			expect(correctedAt).toBeDefined();
			expect(worst).toBeLessThanOrEqual(0);
			expect(s.correctionCount()).toBe(1);
		});
	}

	it("snaps: a jump over snapTiles, snap(), and not predicting", () => {
		const s = new PredictionSmoother(PREDICTION_VIEW);
		feedWalk(s, 10);
		s.draw(0.5, TICK);
		// A floor change's spawn, far away: no glide.
		const far = walkHead(11, PREDICTION_VIEW.snapTiles + 5);
		feedWalk(s, 11, PREDICTION_VIEW.snapTiles + 5);
		const d = s.draw(0.5, TICK)!;
		expect(d.x).toBe(far.prevX + (far.x - far.prevX) * 0.5);
		expect(s.snapCount()).toBe(1);
		// A small correction, then the caller's snap (a draft opening): the offset goes at once.
		feedWalk(s, 12, PREDICTION_VIEW.snapTiles + 5 + 0.2);
		expect(s.offset()).toBeGreaterThan(0);
		s.snap();
		expect(s.offset()).toBe(0);
		expect(s.snapCount()).toBe(2);
		// Not predicting: nothing drawn; the next prediction starts fresh (nothing to glide from).
		s.feed(undefined, undefined);
		expect(s.draw(0.5, TICK)).toBeUndefined();
		feedWalk(s, 14, -0.5);
		expect(s.offset()).toBe(0);
		expect(s.draw(0, TICK)!.x).toBe(walkHead(14, -0.5).prevX);
	});

	it("compares an old head with the new path at its own tick, also when a pump stepped several ticks", () => {
		const s = new PredictionSmoother(PREDICTION_VIEW);
		feedWalk(s, 10);
		// Three ticks later, the same walk: the old head's tick is inside the new path, and it agrees.
		feedWalk(s, 13);
		expect(s.correctionCount()).toBe(0);
		// The horizon shrank (the head is a tick earlier than the last one): compared with the new head, no jump.
		const shorter = walkPath(12);
		s.feed(walkHead(12), shorter);
		expect(s.offset()).toBeCloseTo(WALK * TICK, 12);
	});

	it("never draws farther than maxOffsetTiles from the prediction", () => {
		const s = new PredictionSmoother(PREDICTION_VIEW);
		feedWalk(s, 10);
		feedWalk(s, 11, -0.9);
		feedWalk(s, 12, -1.8);
		const d = s.draw(0, 0)!;
		const h = walkHead(12, -1.8);
		expect(math.abs(d.x - h.prevX)).toBeLessThanOrEqual(PREDICTION_VIEW.maxOffsetTiles + 1e-12);
		expect(s.offset()).toBeLessThanOrEqual(PREDICTION_VIEW.maxOffsetTiles + 1e-12);
	});

	it("facing passes through unsmoothed", () => {
		const s = new PredictionSmoother(PREDICTION_VIEW);
		s.feed(body(1, 0.9, 0, 0, 1, 0), walkPath(10));
		s.feed(body(1.1, 0.7, 0, 0, 0, -1), walkPath(11));
		const d = s.draw(0.3, TICK)!;
		expect(d.faceX).toBe(0);
		expect(d.faceZ).toBe(-1);
	});
});
