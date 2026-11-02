import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE, VIEW_TILES_HIGH } from "shared/config";
import {
	GAME_CAMERA,
	GAME_WORLD,
	PORTRAIT,
	VOID,
	backdropReachTiles,
	cameraFraming,
	distanceForFov,
	isPortrait,
	viewTilesHigh,
	viewTilesWide,
} from "shared/view";

/** Viewports (px / pt): landscape desktops, a 21:9, landscape phones, portrait phones and a tablet. */
const LANDSCAPE = [
	[1280, 720],
	[1920, 1080],
	[2560, 1080],
	[1024, 768],
	[844, 390],
	[667, 375],
	[1366, 1024],
] as const;
const UPRIGHT = [
	[375, 667],
	[390, 844],
	[360, 800],
	[430, 932],
	[768, 1024],
] as const;

const DIGITS = 9;
/** Height over width from which a screen counts as a phone (16:9 is 1.78). */
const PHONE_ASPECT = 1.7;

describe("portrait framing (docs/PORTRAIT.md PT2)", () => {
	it("landscape is exactly today's view: VIEW_TILES_HIGH high at GAME_CAMERA.fovDeg, no lift", () => {
		const today = distanceForFov(GAME_CAMERA.fovDeg, VIEW_TILES_HIGH * STUDS_PER_TILE);
		for (const [w, h] of LANDSCAPE) {
			expect(isPortrait(w, h)).toBe(false);
			for (const touch of [false, true]) {
				const f = cameraFraming(w, h, touch);
				expect(f.tilesHigh).toBe(VIEW_TILES_HIGH);
				expect(f.distance).toBe(today);
				expect(f.fovDeg).toBe(GAME_CAMERA.fovDeg);
				expect(f.liftTiles).toBe(0);
			}
		}
	});

	it("upright, the width shows VIEW_TILES_HIGH (the short side) and the height more", () => {
		for (const [w, h] of UPRIGHT) {
			expect(isPortrait(w, h)).toBe(true);
			expect(viewTilesWide(w, h)).toBeCloseTo(VIEW_TILES_HIGH, DIGITS);
			expect(viewTilesHigh(w, h)).toBeCloseTo((VIEW_TILES_HIGH * h) / w, DIGITS);
			const f = cameraFraming(w, h, false);
			expect(f.fovDeg).toBe(GAME_CAMERA.fovDeg);
			expect(f.distance).toBeCloseTo(distanceForFov(GAME_CAMERA.fovDeg, f.tilesHigh * STUDS_PER_TILE), DIGITS);
		}
	});

	it("a square screen is landscape's view; a degenerate one falls back to it", () => {
		expect(viewTilesHigh(800, 800)).toBe(VIEW_TILES_HIGH);
		expect(viewTilesHigh(0, 0)).toBe(VIEW_TILES_HIGH);
		expect(cameraFraming(0, 0, true).liftTiles).toBe(0);
	});

	it("caps the aspect at PORTRAIT.maxAspect: a taller screen shows fewer tiles across", () => {
		const w = 300;
		const h = w * (PORTRAIT.maxAspect + 1);
		expect(viewTilesHigh(w, h)).toBeCloseTo(VIEW_TILES_HIGH * PORTRAIT.maxAspect, DIGITS);
		expect(viewTilesWide(w, h)).toBeLessThan(VIEW_TILES_HIGH);
	});

	it("lifts the player only upright with the touch controls, centring it above the control band", () => {
		for (const [w, h] of UPRIGHT) {
			expect(cameraFraming(w, h, false).liftTiles).toBe(0);
			const f = cameraFraming(w, h, true);
			expect(f.liftTiles).toBeCloseTo((f.tilesHigh * PORTRAIT.controlBandShare) / 2, DIGITS);
			// Above the player and between it and the band: the same, and at least landscape's half height.
			const above = f.tilesHigh / 2 - f.liftTiles;
			const belowToBand = f.tilesHigh / 2 + f.liftTiles - f.tilesHigh * PORTRAIT.controlBandShare;
			expect(above).toBeCloseTo(belowToBand, DIGITS);
			// Phones (16:9 and taller): more than landscape's half height either way (an upright 4:3 tablet: a little less).
			if (h / w >= PHONE_ASPECT) expect(above).toBeGreaterThan(VIEW_TILES_HIGH / 2);
		}
	});

	it("no phone needs the distance cap (the FOV stays GAME_CAMERA.fovDeg up to the aspect cap)", () => {
		const f = cameraFraming(100, 100 * PORTRAIT.maxAspect, true);
		expect(f.distance).toBeLessThan(PORTRAIT.maxDistanceStuds);
		expect(f.fovDeg).toBe(GAME_CAMERA.fovDeg);
	});
});

describe("backdrop reach (docs/PORTRAIT.md PT4)", () => {
	const depth = VOID.abyssDepthTiles;

	it("covers a 21:9 landscape view and the tallest upright view with the lift", () => {
		const wide = backdropReachTiles(VIEW_TILES_HIGH, (VIEW_TILES_HIGH * 21) / 9, 0, depth);
		const tall = cameraFraming(100, 100 * PORTRAIT.maxAspect, true);
		const upright = backdropReachTiles(tall.tilesHigh, VIEW_TILES_HIGH, tall.liftTiles, depth);
		expect(GAME_WORLD.backdropMarginTiles).toBeGreaterThanOrEqual(wide);
		expect(GAME_WORLD.backdropMarginTiles).toBeGreaterThanOrEqual(upright);
	});

	it("grows with the view and the depth", () => {
		const base = backdropReachTiles(VIEW_TILES_HIGH, VIEW_TILES_HIGH, 0, 0);
		expect(backdropReachTiles(VIEW_TILES_HIGH * 2, VIEW_TILES_HIGH, 0, 0)).toBeGreaterThan(base);
		expect(backdropReachTiles(VIEW_TILES_HIGH, VIEW_TILES_HIGH, 0, depth)).toBeGreaterThan(base);
	});
});
