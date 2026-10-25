import { describe, expect, it } from "@rbxts/jest-globals";
import { FIXTURE_NAMES } from "shared/fixtures-generated";

/**
 * Harness smoke test: proves the headless runner (scripts/lune/run-tests.luau) loads a spec
 * from src/shared/sim, resolves roblox-ts imports, and runs real Jest matchers.
 */
describe("headless harness", () => {
	it("runs a passing test with real Jest matchers", () => {
		expect(1 + 1).toBe(2);
		expect([1, 2, 3]).toHaveLength(3);
		expect({ a: [1, 2] }).toEqual({ a: [1, 2] });
		expect(0.1 + 0.2).never.toBe(0.3);
		expect(0.1 + 0.2).toBeCloseTo(0.3);
		expect(() => error("boom")).toThrow("boom");
	});

	it("has Luau's bit32 with uint32 semantics (the sim's RNG depends on it)", () => {
		expect(bit32.bxor(0xffffffff, 1)).toBe(4294967294);
		expect(bit32.lshift(1, 31)).toBe(2147483648);
	});

	it("can import the generated fixture index", () => {
		expect(typeIs(FIXTURE_NAMES, "table")).toBe(true);
	});
});
