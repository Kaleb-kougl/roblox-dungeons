// JS number formatting and the recording JSON reader (port-only helpers; the source uses String(n) / JSON.parse).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	JSON_NULL,
	float64FromHex,
	isFiniteNumber,
	isIntegerNumber,
	isJsonArray,
	isJsonObject,
	jsonToJsString,
	numberToJsString,
	parseJson,
} from "shared/sim";

describe("numberToJsString (Number.prototype.toString)", () => {
	it("prints the shortest round-trip decimal in JS layout", () => {
		// Expected strings from Node: String(x).
		const cases: Array<[number, string]> = [
			[0, "0"],
			[-0, "0"],
			[1, "1"],
			[-1, "-1"],
			[0.1, "0.1"],
			[-3.25, "-3.25"],
			[12.5, "12.5"],
			[1e-7, "1e-7"],
			[-1e-7, "-1e-7"],
			[1e-6, "0.000001"],
			[1.5e-7, "1.5e-7"],
			[123456789.12345679, "123456789.12345679"],
			[4294967295, "4294967295"], // check-asset-ids: allow (number formatting vector)
			[1e20, "100000000000000000000"], // check-asset-ids: allow (number formatting vector)
			[1e21, "1e+21"],
			[1.5e21, "1.5e+21"],
			[2 ** 53, "9007199254740992"], // check-asset-ids: allow (number formatting vector)
			[0.30000000000000004, "0.30000000000000004"],
			[1 / 3, "0.3333333333333333"],
			[5.689999999999999, "5.689999999999999"],
			[5e-324, "5e-324"],
			[1.7976931348623157e308, "1.7976931348623157e+308"],
			[2.2250738585072014e-308, "2.2250738585072014e-308"],
		];
		for (const [v, s] of cases) expect(numberToJsString(v)).toBe(s);
		expect(numberToJsString(0 / 0)).toBe("NaN");
		expect(numberToJsString(math.huge)).toBe("Infinity");
		expect(numberToJsString(-math.huge)).toBe("-Infinity");
	});

	it("round-trips through tonumber for awkward doubles", () => {
		for (const hex of [
			"3fb999999999999a",
			"bff4000000000000",
			"41efffffffe00000",
			"3fe6a09e667f3bcd",
			"0000000000000001", // check-asset-ids: allow (float64 bits)
		]) {
			const v = float64FromHex(hex);
			expect(tonumber(numberToJsString(v))).toBe(v);
		}
	});
});

describe("Number.isFinite / Number.isInteger", () => {
	it("are false for non-numbers and non-finite numbers; -0 is an integer", () => {
		expect(isFiniteNumber("1")).toBe(false);
		expect(isFiniteNumber(0 / 0)).toBe(false);
		expect(isFiniteNumber(-math.huge)).toBe(false);
		expect(isFiniteNumber(1.5)).toBe(true);
		expect(isIntegerNumber(-0)).toBe(true);
		expect(isIntegerNumber(1.5)).toBe(false);
		expect(isIntegerNumber(true)).toBe(false);
	});
});

describe("parseJson", () => {
	it("parses objects, arrays, numbers (exactly), strings with escapes, literals", () => {
		const v = parseJson(
			' {"a": [1, -0.5, 1e-7, 2E+3], "b": "x\\n\\"\\u00e9\\ud83d\\ude00", "c": true, "d": null, "a": [0]} ',
		);
		expect(isJsonObject(v)).toBe(true);
		if (!isJsonObject(v)) return;
		const a = v.fields.get("a");
		expect(isJsonArray(a) && a.items).toEqual([0]); // last duplicate key wins
		expect(v.fields.get("b")).toBe('x\n"é\u{1F600}');
		expect(v.fields.get("c")).toBe(true);
		expect(v.fields.get("d")).toBe(JSON_NULL);
		const nums = parseJson("[1, -0.5, 1e-7, 2E+3, 0.1, -0]");
		expect(isJsonArray(nums) && nums.items).toEqual([1, -0.5, 1e-7, 2000, 0.1, -0]);
	});

	it("rejects malformed JSON", () => {
		for (const bad of ["", "{", "[1,]", "{'a':1}", "01", "1.", "-", "[1] x", '"\\x"', "tru", '{"a" 1}']) {
			const [ok] = pcall(() => parseJson(bad));
			expect(`${bad}: ${ok}`).toBe(`${bad}: false`);
		}
	});

	it("prints values like a JS template string", () => {
		expect(jsonToJsString(undefined)).toBe("undefined");
		expect(jsonToJsString(2)).toBe("2");
		expect(jsonToJsString("x")).toBe("x");
		expect(jsonToJsString(JSON_NULL)).toBe("null");
		expect(jsonToJsString(parseJson("[1,null,[2,3]]"))).toBe("1,,2,3");
		expect(jsonToJsString(parseJson("{}"))).toBe("[object Object]");
	});
});
