// Ported from project-kaleb-vale src/theme/color.test.ts @ 42897e2.
import { describe, expect, it } from "@rbxts/jest-globals";
import { contrastRatio, isHexColor, parseHex, relativeLuminance, toHex } from "./color";

describe("WCAG contrast", () => {
	it("matches known WCAG values", () => {
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
		expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10);
		expect(contrastRatio("#123456", "#123456")).toBe(1);
		// Commonly cited reference pairs.
		expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
		expect(contrastRatio("#ff0000", "#ffffff")).toBeCloseTo(4.0, 1);
		expect(contrastRatio("#0000ff", "#ffffff")).toBeCloseTo(8.59, 2);
		expect(contrastRatio("#808080", "#000000")).toBeCloseTo(5.32, 2);
	});

	it("computes relative luminance at the extremes", () => {
		expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
		expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
	});

	it("is NaN for malformed colors rather than throwing", () => {
		expect(contrastRatio("red", "#ffffff")).toBeNaN();
		expect(contrastRatio("#fff", "#ffffff")).toBeNaN();
	});

	it("round-trips hex", () => {
		expect(parseHex("#ff2e88")).toEqual({ r: 255, g: 46, b: 136 });
		expect(parseHex("#FF2E88")).toEqual({ r: 255, g: 46, b: 136 });
		expect(toHex({ r: 255, g: 46, b: 136 })).toBe("#ff2e88");
		expect(toHex({ r: 300, g: -4, b: 7.6 })).toBe("#ff0008");
		expect(parseHex("ff2e88")).toBeUndefined();
	});

	it("accepts only #rrggbb", () => {
		expect(isHexColor("#a1B2c3")).toBe(true);
		for (const bad of ["#abc", "#abcdefa", "abcdef", "#ghijkl", " #abcdef", 0xabcdef, undefined]) {
			expect(isHexColor(bad)).toBe(false);
		}
	});
});
