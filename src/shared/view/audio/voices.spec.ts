// Pitch variance for repetitive sounds (voices.ts PitchVariance): a repeated sound never lands near its last pitch,
// stays inside its range, is deterministic per seed, and keeps each ID's history apart.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AUDIO_VIEW } from "./config";
import { PitchJitter, PitchVariance } from "./voices";

const RANGE: [number, number] = [0.9, 1.1];
const STARTS = 500;
/** Float slack on a distance computed back from a PlaybackSpeed (the position itself is exact). */
const EPS = 1e-9;

describe("audio: pitch variance for repetitive sounds", () => {
	it("keeps every start inside the range and at least the gap from the same ID's previous one", () => {
		const gap = AUDIO_VIEW.pitchRepeatGap;
		const p = new PitchVariance(new PitchJitter(3), gap);
		let prev = p.speed("sfx.a", RANGE);
		for (let i = 0; i < STARTS; i++) {
			const x = p.speed("sfx.a", RANGE);
			expect(x >= RANGE[0] && x <= RANGE[1]).toBe(true);
			expect(math.abs(x - prev) >= gap * (RANGE[1] - RANGE[0]) - EPS).toBe(true);
			prev = x;
		}
	});

	it("still reaches both ends of the range (the excluded window is clipped, not wrapped)", () => {
		const p = new PitchVariance(new PitchJitter(11), AUDIO_VIEW.pitchRepeatGap);
		let low = 1;
		let high = 0;
		for (let i = 0; i < STARTS; i++) {
			const u = p.position("sfx.a");
			expect(u >= 0 && u < 1).toBe(true);
			low = math.min(low, u);
			high = math.max(high, u);
		}
		expect(low < 0.05).toBe(true);
		expect(high > 0.95).toBe(true);
	});

	it("is deterministic per seed and keeps each ID's history apart", () => {
		const a = new PitchVariance(new PitchJitter(7));
		const b = new PitchVariance(new PitchJitter(7));
		for (let i = 0; i < 50; i++) expect(a.speed("sfx.a", RANGE)).toBe(b.speed("sfx.a", RANGE));
		// One draw per start whatever the ID: the first start of a new ID is plain uniform (the jitter's next unit).
		const p = new PitchVariance(new PitchJitter(5));
		const j = new PitchJitter(5);
		expect(p.position("sfx.a")).toBe(j.unit());
		expect(p.position("sfx.b")).toBe(j.unit());
	});

	it("is the plain jitter with a gap of 0, and forgets history on reset", () => {
		const p = new PitchVariance(new PitchJitter(9), 0);
		const j = new PitchJitter(9);
		for (let i = 0; i < 20; i++) expect(p.speed("sfx.a", RANGE)).toBe(j.speed(RANGE));
		const q = new PitchVariance(new PitchJitter(9));
		const r = new PitchJitter(9);
		q.position("sfx.a");
		r.unit();
		q.reset();
		expect(q.position("sfx.a")).toBe(r.unit());
	});

	it("plays at 1 without a range and draws nothing", () => {
		const p = new PitchVariance(new PitchJitter(4));
		const j = new PitchJitter(4);
		expect(p.speed("sfx.a", undefined)).toBe(1);
		expect(p.position("sfx.a")).toBe(j.unit());
	});

	it("caps an oversized gap so a mid-range start always has somewhere to go", () => {
		const p = new PitchVariance(new PitchJitter(2), 1);
		for (let i = 0; i < STARTS; i++) {
			const u = p.position("sfx.a");
			expect(u >= 0 && u < 1).toBe(true);
		}
	});

	it("gives a degenerate range its one speed", () => {
		const p = new PitchVariance(new PitchJitter(6));
		expect(p.speed("sfx.a", [1.2, 1.2])).toBe(1.2);
		expect(p.speed("sfx.a", [1.2, 1.2])).toBe(1.2);
	});
});
