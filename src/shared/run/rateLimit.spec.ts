import { describe, expect, it } from "@rbxts/jest-globals";
import { RUN_SUBMIT_RATE, SlidingWindowLimiter } from "shared/run";

describe("SlidingWindowLimiter", () => {
	it("allows `count` calls per window per key, then frees slots as they age out", () => {
		const l = new SlidingWindowLimiter<string>(2, 10);
		expect(l.tryAcquire("a", 0)).toBe(true);
		expect(l.tryAcquire("a", 1)).toBe(true);
		expect(l.tryAcquire("a", 2)).toBe(false);
		expect(l.tryAcquire("b", 2)).toBe(true);
		expect(l.retryAfter("a", 2)).toBe(8);
		expect(l.tryAcquire("a", 9.9)).toBe(false);
		expect(l.tryAcquire("a", 10)).toBe(true);
		expect(l.retryAfter("a", 10)).toBe(1);
		expect(l.retryAfter("b", 20)).toBe(0);
	});

	it("rejected calls do not extend the window; forget drops a key", () => {
		const l = new SlidingWindowLimiter<number>(1, 5);
		expect(l.tryAcquire(1, 0)).toBe(true);
		for (let t = 1; t < 5; t++) expect(l.tryAcquire(1, t)).toBe(false);
		expect(l.tryAcquire(1, 5)).toBe(true);
		expect(l.size()).toBe(1);
		l.forget(1);
		expect(l.size()).toBe(0);
	});

	it("the submission budget is data (shared/run limits)", () => {
		expect(RUN_SUBMIT_RATE.count).toBeGreaterThan(0);
		expect(RUN_SUBMIT_RATE.windowSeconds).toBeGreaterThan(0);
	});
});
