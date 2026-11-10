/** docs/LOCAL_PREDICTION.md LP5: the drawn player (shared/view/predict drawn.ts). */
import { describe, expect, it } from "@rbxts/jest-globals";
import { createSimState, newPlayerState, playerAt, type PlayerState } from "shared/sim";
import { drawnOrMerged, writeDrawnPlayer, type DrawnPlayerOf, type PredictedMotion } from ".";

const HEAD: PredictedMotion = {
	x: 10.5,
	z: -3.25,
	prevX: 10.4,
	prevZ: -3.2,
	faceX: 0,
	faceZ: -1,
	rollTicks: 7,
	rollDirX: 0.6,
	rollDirZ: -0.8,
	flaskTicks: 12,
};

function merged(): PlayerState {
	const p = newPlayerState(4, 5);
	p.hearts = 3;
	p.armor = 1;
	p.flask = 1;
	p.embers = 0;
	p.iframeTicks = 9;
	p.hurtTicks = 30;
	p.prevButtons = 4;
	p.dead = 0;
	return p;
}

describe("the drawn player (docs/LOCAL_PREDICTION.md LP5)", () => {
	it("takes the head's motion shifted by the offset and keeps every other field merged", () => {
		const out = newPlayerState(0, 0);
		const m = merged();
		writeDrawnPlayer(out, m, HEAD, 0.25, -0.5);
		expect(out.x).toBe(HEAD.x + 0.25);
		expect(out.z).toBe(HEAD.z - 0.5);
		expect(out.prevX).toBe(HEAD.prevX + 0.25);
		expect(out.prevZ).toBe(HEAD.prevZ - 0.5);
		expect([out.faceX, out.faceZ, out.rollTicks, out.rollDirX, out.rollDirZ, out.flaskTicks]).toEqual([
			HEAD.faceX,
			HEAD.faceZ,
			HEAD.rollTicks,
			HEAD.rollDirX,
			HEAD.rollDirZ,
			HEAD.flaskTicks,
		]);
		expect([out.hearts, out.armor, out.flask, out.embers, out.iframeTicks, out.hurtTicks, out.dead]).toEqual([
			m.hearts,
			m.armor,
			m.flask,
			m.embers,
			m.iframeTicks,
			m.hurtTicks,
			m.dead,
		]);
		expect(out.prevButtons).toBe(m.prevButtons);
	});

	it("a view's lerp gives the head's lerp plus the offset, exactly with no offset; the step is the head's", () => {
		const out = newPlayerState(0, 0);
		writeDrawnPlayer(out, merged(), HEAD, 0, 0);
		for (const a of [0, 0.3, 0.999]) {
			expect(out.prevX + (out.x - out.prevX) * a).toBe(HEAD.prevX + (HEAD.x - HEAD.prevX) * a);
		}
		writeDrawnPlayer(out, merged(), HEAD, 0.5, 0);
		expect(out.x - out.prevX).toBeCloseTo(HEAD.x - HEAD.prevX, 12);
		expect(out.prevX + (out.x - out.prevX) * 0.5).toBeCloseTo(HEAD.prevX + (HEAD.x - HEAD.prevX) * 0.5 + 0.5, 12);
	});

	it("drawnOrMerged: the merged player without a DrawnPlayerOf, the function's answer with one", () => {
		const state = createSimState(1, 2, 3);
		expect(drawnOrMerged(state, 0, undefined)).toBe(playerAt(state, 0));
		const other = newPlayerState(9, 9);
		const drawn: DrawnPlayerOf = () => other;
		expect(drawnOrMerged(state, 0, drawn)).toBe(other);
	});
});
