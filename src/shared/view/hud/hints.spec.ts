import { describe, expect, it } from "@rbxts/jest-globals";
import { HUD_HINTS, hintVisible } from "./hints";

describe("hintVisible", () => {
	it("is fully shown while the hint's time runs", () => {
		expect(hintVisible(0, 8, 0.5)).toBe(0);
		expect(hintVisible(3, 8, 0.5)).toBe(0);
		expect(hintVisible(8, 8, 0.5)).toBe(0);
	});

	it("fades linearly to hidden over the fade, then stays hidden", () => {
		expect(hintVisible(8.25, 8, 0.5)).toBe(0.5);
		expect(hintVisible(8.5, 8, 0.5)).toBe(1);
		expect(hintVisible(100, 8, 0.5)).toBe(1);
	});

	it("treats a negative or NaN time as just triggered", () => {
		expect(hintVisible(-1, 8, 0.5)).toBe(0);
		expect(hintVisible(0 / 0, 8, 0.5)).toBe(0);
	});

	it("hides at once with no fade", () => {
		expect(hintVisible(8.01, 8, 0)).toBe(1);
		expect(hintVisible(8.01, 8, -1)).toBe(1);
	});

	it("has positive tunables", () => {
		expect(HUD_HINTS.swapHintSeconds > 0).toBe(true);
		expect(HUD_HINTS.verdictSeconds > 0).toBe(true);
		expect(HUD_HINTS.fadeSeconds > 0).toBe(true);
	});
});
