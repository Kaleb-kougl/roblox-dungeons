// Ported from the web build's src/theme/color.test.ts @ 42897e2.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio, isHexColor, parseHex, relativeLuminance, toHex, toLab } from "./color";

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

// Roblox port (docs/DECOR.md): CIELAB and the CIE76 difference behind the decor fx vs enemy bullet check.
describe("CIE76 colour difference", () => {
	const lab = (hex: string) => toLab(parseHex(hex)!);

	it("converts sRGB to CIELAB (D65) at the published reference values", () => {
		const white = lab("#ffffff");
		expect(white.l).toBeCloseTo(100, 4);
		expect(white.a).toBeCloseTo(0, 1);
		expect(white.b).toBeCloseTo(0, 1);
		expect(lab("#000000")).toEqual({ l: 0, a: 0, b: 0 });
		const red = lab("#ff0000");
		expect(red.l).toBeCloseTo(53.24, 1);
		expect(red.a).toBeCloseTo(80.09, 1);
		expect(red.b).toBeCloseTo(67.2, 1);
		const green = lab("#00ff00");
		expect(green.l).toBeCloseTo(87.73, 1);
		expect(green.a).toBeCloseTo(-86.18, 1);
		expect(green.b).toBeCloseTo(83.18, 1);
		const blue = lab("#0000ff");
		expect(blue.l).toBeCloseTo(32.3, 1);
		expect(blue.b).toBeCloseTo(-107.86, 1);
		expect(lab("#808080").l).toBeCloseTo(53.59, 1);
	});

	it("is the Euclidean distance in CIELAB, symmetric, 0 for identical colours", () => {
		expect(colorDifference("#ffffff", "#000000")).toBeCloseTo(100, 4);
		expect(colorDifference("#ff0000", "#00ff00")).toBeCloseTo(170.58, 1);
		expect(colorDifference("#123456", "#123456")).toBe(0);
		expect(colorDifference("#ff3fa4", "#ffa640")).toBe(colorDifference("#ffa640", "#ff3fa4"));
		expect(colorDifference({ r: 255, g: 63, b: 164 }, "#ff3fa4")).toBe(0);
	});

	it("separates the bullet's hue family from other hues", () => {
		// the placeholder enemy bullet vs near-pinks (under 40) and the fx colours (77+)
		expect(colorDifference("#ff3fa4", "#ff40a0")).toBeLessThan(5);
		expect(colorDifference("#ff3fa4", "#e03090")).toBeLessThan(10);
		expect(colorDifference("#ff3fa4", "#ff2a6a")).toBeLessThan(40);
		expect(colorDifference("#ff3fa4", "#ffa640")).toBeGreaterThan(77);
		expect(colorDifference("#ff3fa4", "#aab4cc")).toBeGreaterThan(77);
	});

	it("is NaN for malformed colors rather than throwing", () => {
		expect(colorDifference("pink", "#ffffff")).toBeNaN();
		expect(colorDifference("#ffffff", "#fff")).toBeNaN();
	});
});
