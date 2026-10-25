// Ported from src/sim/loop.test.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import { FixedStepLoop, MAX_TICKS_PER_FRAME, SIM_DT } from "shared/sim";

function ticksFor(loop: FixedStepLoop, delta: number): number {
	let n = 0;
	loop.advance(delta, () => n++);
	return n;
}

describe("FixedStepLoop", () => {
	it("runs 2 ticks for a 1/30 s frame", () => {
		const loop = new FixedStepLoop();
		expect(ticksFor(loop, 1 / 30)).toBe(2);
		expect(loop.getAlpha()).toBeGreaterThanOrEqual(0);
		expect(loop.getAlpha()).toBeLessThan(1e-6);
	});

	it("runs 1 tick per 1/60 s frame, with no drift over 10 s", () => {
		const loop = new FixedStepLoop();
		let total = 0;
		for (let i = 0; i < 600; i++) total += ticksFor(loop, 1 / 60);
		expect(total).toBe(600);
	});

	it("accumulates small frames: two 1/120 s frames -> 1 tick, alpha 0.5 in between", () => {
		const loop = new FixedStepLoop();
		expect(ticksFor(loop, 1 / 120)).toBe(0);
		expect(loop.getAlpha()).toBeCloseTo(0.5, 9);
		expect(ticksFor(loop, 1 / 120)).toBe(1);
	});

	it("caps a 1 s hitch at 5 ticks and drops the excess", () => {
		const loop = new FixedStepLoop();
		expect(ticksFor(loop, 1)).toBe(MAX_TICKS_PER_FRAME);
		expect(MAX_TICKS_PER_FRAME).toBe(5);
		expect(loop.accumulator).toBeLessThan(SIM_DT);
		expect(loop.droppedTime).toBeGreaterThan(0.9);
		// No spiral: the next normal frame is back to one tick.
		expect(ticksFor(loop, 1 / 60)).toBeLessThanOrEqual(2);
	});

	it("treats negative, NaN and infinite deltas as zero", () => {
		const loop = new FixedStepLoop();
		expect(ticksFor(loop, -1)).toBe(0);
		expect(ticksFor(loop, 0 / 0)).toBe(0);
		expect(ticksFor(loop, math.huge)).toBe(0);
		expect(loop.accumulator).toBe(0);
		expect(loop.getAlpha()).toBe(0);
	});

	it("always returns alpha in [0, 1)", () => {
		const loop = new FixedStepLoop();
		let seed = 12345;
		for (let i = 0; i < 5000; i++) {
			// seed = (seed * 1103515245 + 12345) >>> 0, exactly: split the product to stay below 2^53
			const hi = (math.floor(seed / 65536) * 1103515245) % 65536;
			seed = ((hi * 65536) % 4294967296) + ((seed % 65536) * 1103515245 + 12345);
			seed %= 4294967296;
			const delta = (seed / 2 ** 32) * 0.2 - 0.01;
			const a = loop.advance(delta, () => {});
			expect(a).toBeGreaterThanOrEqual(0);
			expect(a).toBeLessThan(1);
		}
	});

	it("passes the tick index within the frame", () => {
		const loop = new FixedStepLoop();
		const seen: number[] = [];
		loop.advance(3 / 60, (i) => seen.push(i));
		expect(seen).toEqual([0, 1, 2]);
	});

	it("reset() and clearAccumulator() (port: alpha is getAlpha())", () => {
		const loop = new FixedStepLoop();
		loop.advance(1 / 120 + 2 / 60, () => {});
		expect(loop.totalTicks).toBe(2);
		loop.clearAccumulator();
		expect([loop.accumulator, loop.getAlpha(), loop.totalTicks]).toEqual([0, 0, 2]);
		loop.advance(1, () => {});
		loop.reset();
		expect([loop.accumulator, loop.getAlpha(), loop.totalTicks, loop.droppedTime]).toEqual([0, 0, 0, 0]);
	});
});
