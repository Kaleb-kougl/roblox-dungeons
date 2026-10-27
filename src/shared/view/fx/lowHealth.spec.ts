// The low-health pulse (docs/FEEL.md J11): when it is on (armor, the Aegis pip, dead, the tutorial's harmless mode and
// wounded start), the 1 Hz rate (under the 3 Hz guideline), the reduced-motion steady glow, the fade envelope and the
// spectate scale.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DROPS_CONFIG, TUTORIAL_START_HALF_HEARTS, createSimState, playerAt } from "shared/sim";
import { FEEL_HURT, FEEL_LOW_HEALTH, LowHealthPulse, lowHealthAt, lowHealthLook, lowHealthOn } from ".";

const PHOTOSENSITIVE_HZ = 3;
const FRAME = 1 / 60;

describe("lowHealthOn / lowHealthAt", () => {
	it("on while alive on the last half heart with no armor and no Aegis pip", () => {
		const s = createSimState(1, 0, 0);
		const p = playerAt(s, 0);
		expect(lowHealthOn(p, false)).toBe(false); // full hearts
		p.hearts = FEEL_LOW_HEALTH.halfHearts;
		expect(lowHealthOn(p, false)).toBe(true);
		expect(lowHealthAt(s, 0)).toBe(true);
		expect(lowHealthOn(p, true)).toBe(false); // the Aegis pip would absorb the next hit
		p.armor = 1;
		expect(lowHealthOn(p, false)).toBe(false); // so would armor
		p.armor = 0;
		p.hearts = 0;
		p.dead = 1;
		expect(lowHealthOn(p, false)).toBe(false); // dead
	});

	it("reads the Aegis pip from state.drops", () => {
		const s = createSimState(1, 0, 0, { drops: DROPS_CONFIG });
		playerAt(s, 0).hearts = 1;
		expect(lowHealthAt(s, 0)).toBe(true);
		s.drops!.players[0].aegisPips = 1;
		expect(lowHealthAt(s, 0)).toBe(false);
	});

	it("never in the tutorial: its hits are harmless, and it starts wounded above the threshold", () => {
		const s = createSimState(1, 0, 0, {
			tutorial: { harmless: true, startHalfHearts: TUTORIAL_START_HALF_HEARTS },
		});
		expect(playerAt(s, 0).hearts).toBe(TUTORIAL_START_HALF_HEARTS);
		expect(TUTORIAL_START_HALF_HEARTS).toBeGreaterThan(FEEL_LOW_HEALTH.halfHearts);
		expect(lowHealthAt(s, 0)).toBe(false);
		playerAt(s, 0).hearts = 1;
		expect(lowHealthAt(s, 0)).toBe(false);
	});

	it("each party member on their own", () => {
		const s = createSimState(1, 0, 0, { party: { size: 2 } });
		playerAt(s, 1).hearts = 1;
		expect([lowHealthAt(s, 0), lowHealthAt(s, 1)]).toEqual([false, true]);
	});
});

describe("lowHealthLook", () => {
	it("a 1 Hz raised cosine between clear and the peak (under the 3 Hz guideline)", () => {
		expect(FEEL_LOW_HEALTH.hz).toBe(1);
		expect(FEEL_LOW_HEALTH.hz).toBeLessThan(PHOTOSENSITIVE_HZ);
		const period = 1 / FEEL_LOW_HEALTH.hz;
		expect(lowHealthLook(0, 1)).toBeCloseTo(1, 9);
		expect(lowHealthLook(period / 2, 1)).toBeCloseTo(1 - FEEL_LOW_HEALTH.peak, 9);
		expect(lowHealthLook(period, 1)).toBeCloseTo(1, 9);
		expect(lowHealthLook(period * 1.5, 1)).toBeCloseTo(1 - FEEL_LOW_HEALTH.peak, 9);
		// one peak per period: count the local minima of the transparency over 5 s
		let peaks = 0;
		let a = lowHealthLook(0, 1);
		let b = lowHealthLook(FRAME, 1);
		for (let t = 2 * FRAME; t < 5; t += FRAME) {
			const c = lowHealthLook(t, 1);
			if (b < a && b <= c) peaks++;
			a = b;
			b = c;
		}
		expect(peaks).toBe(5);
		// faint: never stronger than the weakest hurt flash
		expect(FEEL_LOW_HEALTH.peak).toBeLessThan(FEEL_HURT.peak.armor);
	});

	it("reduced motion (motion 0): a steady glow", () => {
		for (const t of [0, 0.25, 0.5, 3.7]) expect(lowHealthLook(t, 0)).toBeCloseTo(1 - FEEL_LOW_HEALTH.steady, 9);
	});
});

describe("LowHealthPulse", () => {
	it("fades in over fadeSec when it turns on, and out when it turns off", () => {
		const pulse = new LowHealthPulse();
		expect(pulse.update(false, FRAME, 0, false)).toBe(1);
		let t = 0;
		let last = 1;
		while (t < FEEL_LOW_HEALTH.fadeSec - FRAME / 2) {
			last = pulse.update(true, FRAME, 0, false);
			t += FRAME;
		}
		expect(pulse.level).toBeCloseTo(1, 6);
		expect(last).toBeCloseTo(1 - FEEL_LOW_HEALTH.steady, 6);
		pulse.update(false, FEEL_HURT.maxFrameDtSec, 0, false);
		expect(pulse.level).toBeCloseTo(1 - FEEL_HURT.maxFrameDtSec / FEEL_LOW_HEALTH.fadeSec, 6);
		let out = 0;
		for (let i = 0; i < 60; i++) out = pulse.update(false, FRAME, 0, false);
		expect(out).toBe(1);
		expect(pulse.level).toBe(0);
	});

	it("spectating scales it by spectateScale; reset() and bad dts are safe", () => {
		const pulse = new LowHealthPulse();
		for (let i = 0; i < 60; i++) pulse.update(true, FRAME, 0, false);
		expect(pulse.update(true, FRAME, 0, true)).toBeCloseTo(1 - FEEL_LOW_HEALTH.steady * FEEL_HURT.spectateScale, 6);
		const level = pulse.level;
		pulse.update(true, 0 / 0, 1, false);
		pulse.update(true, -1, 1, false);
		expect(pulse.level).toBe(level);
		// a hitch advances the envelope by at most maxFrameDtSec
		pulse.update(false, 10, 1, false);
		expect(pulse.level).toBeCloseTo(1 - FEEL_HURT.maxFrameDtSec / FEEL_LOW_HEALTH.fadeSec, 6);
		pulse.reset();
		expect([pulse.level, pulse.ageSec]).toEqual([0, 0]);
	});
});
