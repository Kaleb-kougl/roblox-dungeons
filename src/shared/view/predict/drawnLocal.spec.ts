/** docs/SIM_CONTROLLER.md step 2: the drawn local player as one object (shared/view/predict drawnLocal.ts). */
import { describe, expect, it } from "@rbxts/jest-globals";
import { createSimState, newPlayerState, playerAt, type PlayerState, type SimState } from "shared/sim";
import { DrawnLocalPlayer, PREDICTION_VIEW, type PredictionSource } from ".";

const DT = 1 / 60;
const HORIZON = 7;
const ALPHA = 0.5;

/** A head one tile right of where it was a tick ago. */
function headAt(x: number, z: number): PlayerState {
	const p = newPlayerState(x, z);
	p.prevX = x - 1;
	p.prevZ = z;
	return p;
}

/** A scripted co-op run: `head` undefined is a client that predicts nothing. */
function source(state: SimState, head: PlayerState | undefined): PredictionSource {
	return {
		state,
		predicted() {
			return head;
		},
		predictedPath() {
			// Entry 0 the merged pose, the last one the head (shared/lockstep PredictedPath).
			return head !== undefined
				? { firstTick: state.tick, size: 2, xs: [head.prevX, head.x], zs: [head.prevZ, head.z] }
				: undefined;
		},
		predictionHorizonTicks() {
			return HORIZON;
		},
		getAlpha() {
			return ALPHA;
		},
	};
}

describe("DrawnLocalPlayer (docs/LOCAL_PREDICTION.md LP5)", () => {
	it("draws nothing before its first update: every player is the merged one", () => {
		const d = new DrawnLocalPlayer(PREDICTION_VIEW);
		const state = createSimState(1, 2, 3);
		expect(d.isActive()).toBe(false);
		expect(d.playerOf(state, 0)).toBe(playerAt(state, 0));
		expect(d.aheadTicks()).toBe(0);
		expect(d.aimX(playerAt(state, 0), 2)).toBe(2);
		expect(d.aimZ(playerAt(state, 0), 3)).toBe(3);
	});

	it("draws the local player predicted: the head's motion, the merged vitals, the horizon, the aim from the pose", () => {
		const d = new DrawnLocalPlayer(PREDICTION_VIEW);
		const state = createSimState(1, 2, 3);
		playerAt(state, 0).hearts = 1;
		const head = headAt(11, 5);
		d.update(source(state, head), 0, true, false, DT, true);
		expect(d.isActive()).toBe(true);
		const drawn = d.playerOf(state, 0);
		expect(drawn).never.toBe(playerAt(state, 0));
		expect(drawn.x).toBeCloseTo(11, 9);
		expect(drawn.prevX).toBeCloseTo(10, 9);
		expect(drawn.z).toBeCloseTo(5, 9);
		expect(drawn.hearts).toBe(1);
		expect(d.aheadTicks()).toBe(HORIZON);
		// The pose drawn this frame: lerp(prev, x, alpha).
		expect(d.aimX(drawn, 2)).toBeCloseTo(10.5, 9);
		expect(d.aimZ(drawn, 3)).toBeCloseTo(5, 9);
		// A merged player handed in keeps the merged origin.
		expect(d.aimX(playerAt(state, 0), 2)).toBe(2);
	});

	it("only the state it was drawn for gets the drawn body", () => {
		const d = new DrawnLocalPlayer(PREDICTION_VIEW);
		const state = createSimState(1, 2, 3);
		d.update(source(state, headAt(11, 5)), 0, true, false, DT, false);
		const other = createSimState(1, 2, 3);
		expect(d.playerOf(other, 0)).toBe(playerAt(other, 0));
		expect(d.playerOf(state, 0)).never.toBe(playerAt(state, 0));
	});

	it("draws merged while following a teammate, under the cover, or when the client predicts nothing", () => {
		const state = createSimState(1, 2, 3);
		const cases: ReadonlyArray<[PlayerState | undefined, boolean, boolean]> = [
			[headAt(11, 5), false, false],
			[headAt(11, 5), true, true],
			[undefined, true, false],
		];
		for (const [head, viewingSelf, covered] of cases) {
			const d = new DrawnLocalPlayer(PREDICTION_VIEW);
			d.update(source(state, headAt(11, 5)), 0, true, false, DT, false);
			expect(d.isActive()).toBe(true);
			d.update(source(state, head), 0, viewingSelf, covered, DT, false);
			expect(d.isActive()).toBe(false);
			expect(d.playerOf(state, 0)).toBe(playerAt(state, 0));
			expect(d.aheadTicks()).toBe(0);
			expect(d.aimX(d.playerOf(state, 0), 2)).toBe(2);
		}
	});

	it("reset drops what is drawn until the next update and counts a snap", () => {
		const d = new DrawnLocalPlayer(PREDICTION_VIEW);
		const state = createSimState(1, 2, 3);
		d.update(source(state, headAt(11, 5)), 0, true, false, DT, false);
		const snaps = d.snapCount();
		d.reset();
		expect(d.isActive()).toBe(false);
		expect(d.playerOf(state, 0)).toBe(playerAt(state, 0));
		expect(d.snapCount()).toBe(d.smoothing().snaps);
		expect(d.snapCount() >= snaps).toBe(true);
		d.update(source(state, headAt(11, 5)), 0, true, false, DT, false);
		expect(d.isActive()).toBe(true);
	});

	it("smoothing reports the smoother's counters: no correction and no offset from a single head", () => {
		const d = new DrawnLocalPlayer(PREDICTION_VIEW);
		const state = createSimState(1, 2, 3);
		d.update(source(state, headAt(11, 5)), 0, true, false, DT, true);
		const s = d.smoothing();
		expect([s.corrections, s.offsetTiles]).toEqual([0, 0]);
	});
});
