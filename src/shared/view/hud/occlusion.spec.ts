import { describe, expect, it } from "@rbxts/jest-globals";
import type { ScreenRect } from "./footprint";
import { HUD_OCCLUSION, OcclusionFader, occludedPanels, pointInRect } from "./occlusion";

const RECT: ScreenRect = { x: 100, y: 50, w: 200, h: 100 };
const EPS = 1e-9;

describe("occludedPanels (docs/HUD_LAYOUT.md H7)", () => {
	it("a point inside, on the edge, in the pad and outside", () => {
		expect(pointInRect(150, 100, RECT, 0)).toBe(true);
		expect(pointInRect(100, 50, RECT, 0)).toBe(true);
		expect(pointInRect(300, 150, RECT, 0)).toBe(true);
		expect(pointInRect(95, 100, RECT, 0)).toBe(false);
		expect(pointInRect(95, 100, RECT, 5)).toBe(true);
		expect(pointInRect(94, 100, RECT, 5)).toBe(false);
		expect(pointInRect(150, 156, RECT, 5)).toBe(false);
	});

	it("one boolean per rect; only the first `count` points count", () => {
		const other: ScreenRect = { x: 1000, y: 600, w: 100, h: 50 };
		const points = [
			{ x: 1050, y: 620 },
			{ x: 150, y: 100 },
		];
		const out: boolean[] = [];
		expect(occludedPanels([RECT, other], points, 2, 0, out)).toEqual([true, true]);
		expect(occludedPanels([RECT, other], points, 1, 0, out)).toEqual([false, true]);
		expect(occludedPanels([RECT, other], points, 0, 0, out)).toEqual([false, false]);
		// The count never reads past the array.
		expect(occludedPanels([RECT], points, 99, 0, out)[0]).toBe(true);
	});
});

describe("OcclusionFader", () => {
	const fade = HUD_OCCLUSION.fadeSeconds;
	const full = HUD_OCCLUSION.occludedTransparency;

	it("starts opaque and stays opaque while clear", () => {
		const f = new OcclusionFader();
		expect(f.transparency()).toBe(0);
		expect(f.update(false, 1, 1)).toBe(0);
	});

	it("fades in over fadeSeconds and clamps at occludedTransparency", () => {
		const f = new OcclusionFader();
		expect(math.abs(f.update(true, fade / 2, 1) - full / 2)).toBeLessThan(EPS);
		expect(f.update(true, fade, 1)).toBe(full);
		expect(f.update(true, 10, 1)).toBe(full);
	});

	it("holds while clear for less than holdSeconds, then fades back out", () => {
		const f = new OcclusionFader();
		f.update(true, 1, 1);
		const hold = HUD_OCCLUSION.holdSeconds;
		expect(f.update(false, hold / 2, 1)).toBe(full);
		// Occluded again mid-hold: the hold restarts.
		f.update(true, 0, 1);
		expect(f.update(false, hold * 0.9, 1)).toBe(full);
		// The hold ends on this step; the fade-out starts on the next one.
		f.update(false, hold * 0.1, 1);
		const partial = f.update(false, fade / 2, 1);
		expect(partial).toBeLessThan(full);
		expect(partial).toBeGreaterThan(0);
		expect(f.update(false, fade, 1)).toBe(0);
		expect(f.update(false, 10, 1)).toBe(0);
	});

	it("reduced motion switches instantly (the hold still applies)", () => {
		const f = new OcclusionFader();
		expect(f.update(true, 0.001, 0)).toBe(full);
		expect(f.update(false, HUD_OCCLUSION.holdSeconds / 2, 0)).toBe(full);
		expect(f.update(false, HUD_OCCLUSION.holdSeconds, 0)).toBe(0);
	});

	it("ignores a negative or zero dt and resets to opaque", () => {
		const f = new OcclusionFader();
		expect(f.update(true, -1, 1)).toBe(0);
		f.update(true, 1, 1);
		f.reset();
		expect(f.transparency()).toBe(0);
		expect(f.update(false, 0, 1)).toBe(0);
	});
});
