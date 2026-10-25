import { describe, expect, it } from "@rbxts/jest-globals";
import mathTrace from "shared/fixtures-generated/math-trace";
import { hypot, i32, imul, jsMax, jsMin, jsRem, jsRound, stableSort, u32 } from "shared/jsmath";

interface TraceCall {
	fn: string;
	args: ReadonlyArray<number>;
	result: number;
}
// the generated type lists each context by name; a ReadonlyMap view iterates them all
const traceContexts = mathTrace.contexts as unknown as ReadonlyMap<string, { calls: ReadonlyArray<TraceCall> }>;

function isNegZero(x: number): boolean {
	return x === 0 && 1 / x < 0;
}

describe("u32 / i32", () => {
	it("follows ToUint32 / ToInt32", () => {
		expect(u32(-1)).toBe(4294967295);
		expect(u32(4294967296 + 5)).toBe(5);
		expect(u32(-1.7)).toBe(4294967295);
		expect(u32(0 / 0)).toBe(0);
		expect(u32(math.huge)).toBe(0);
		expect(isNegZero(u32(-0))).toBe(false);
		expect(i32(4294967295)).toBe(-1);
		expect(i32(2147483648)).toBe(-2147483648);
	});
});

describe("imul", () => {
	it("matches Math.imul(a, b) >>> 0", () => {
		// Values computed in Node: (Math.imul(a, b) >>> 0)
		expect(imul(0x9e3779b1, 2)).toBe(1013904226);
		expect(imul(2654435761, 2654435761)).toBe(4293315681);
		expect(imul(-1, 5)).toBe(4294967291);
		expect(imul(0xffffffff, 0xffffffff)).toBe(1);
		expect(imul(0x6d2b79f5, 61)).toBe(56364897);
	});
});

describe("jsRound", () => {
	it("rounds halves toward +Infinity and keeps -0", () => {
		expect(jsRound(-15.5)).toBe(-15);
		expect(jsRound(-1.5)).toBe(-1);
		expect(jsRound(1.5)).toBe(2);
		expect(jsRound(2.4999999999999996)).toBe(2);
		expect(isNegZero(jsRound(-0.5))).toBe(true);
		expect(isNegZero(jsRound(-0.2))).toBe(true);
		expect(isNegZero(jsRound(-0))).toBe(true);
		expect(jsRound(4503599627370497)).toBe(4503599627370497);
	});

	it("matches every exact-half Math.round call the dungeon fixtures traced", () => {
		let checked = 0;
		for (const [, ctx] of traceContexts) {
			for (const call of ctx.calls) {
				if (call.fn !== "round") continue;
				expect(jsRound(call.args[0])).toBe(call.result);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(0);
	});
});

describe("jsRem / jsMax / jsMin", () => {
	it("use JS semantics", () => {
		expect(jsRem(-7, 3)).toBe(-1);
		expect(jsRem(7, -3)).toBe(1);
		expect(isNegZero(jsMax(-0, 0))).toBe(false);
		expect(isNegZero(jsMin(0, -0))).toBe(true);
		const nan = jsMax(1, 0 / 0);
		expect(nan !== nan).toBe(true);
	});
});

describe("hypot", () => {
	it("matches every Math.hypot call V8 made in the traced dungeons and runs, bit for bit", () => {
		let checked = 0;
		for (const [, ctx] of traceContexts) {
			for (const call of ctx.calls) {
				if (call.fn !== "hypot") continue;
				expect(hypot(call.args)).toBe(call.result);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(50);
	});

	it("handles the special cases", () => {
		expect(hypot([])).toBe(0);
		expect(hypot([3, 4])).toBe(5);
		expect(hypot([0 / 0, -math.huge])).toBe(math.huge);
		const nan = hypot([0 / 0, 1]);
		expect(nan !== nan).toBe(true);
	});
});

describe("stableSort", () => {
	it("keeps equal keys in their original order", () => {
		const items = [] as { key: number; id: number }[];
		for (let i = 0; i < 40; i++) items.push({ key: i % 3, id: i });
		stableSort(items, (a, b) => b.key - a.key);
		for (let i = 1; i < items.size(); i++) {
			const a = items[i - 1];
			const b = items[i];
			expect(a.key > b.key || (a.key === b.key && a.id < b.id)).toBe(true);
		}
	});
});
