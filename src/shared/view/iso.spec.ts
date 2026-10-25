import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { cameraPosition, degToRad, distanceForFov, dot, followAlpha, isoBasis, snapToGrid } from "shared/view";
import type { Vec3 } from "shared/view";

const EPS_DIGITS = 12;
const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));

describe("isoBasis", () => {
	it("is orthonormal", () => {
		const { right, up, forward } = basis;
		expect(dot(right, right)).toBeCloseTo(1, EPS_DIGITS);
		expect(dot(up, up)).toBeCloseTo(1, EPS_DIGITS);
		expect(dot(forward, forward)).toBeCloseTo(1, EPS_DIGITS);
		expect(dot(right, up)).toBeCloseTo(0, EPS_DIGITS);
		expect(dot(right, forward)).toBeCloseTo(0, EPS_DIGITS);
		expect(dot(up, forward)).toBeCloseTo(0, EPS_DIGITS);
	});

	it("matches the web build's screen axes (screen-right = (1, 0, -1) / sqrt 2, camera at +X+Z)", () => {
		const s = math.sqrt(0.5);
		expect(basis.right[0]).toBeCloseTo(s, EPS_DIGITS);
		expect(basis.right[1]).toBe(0);
		expect(basis.right[2]).toBeCloseTo(-s, EPS_DIGITS);
		// looks down and toward -X-Z
		expect(basis.forward[0]).toBeLessThan(0);
		expect(basis.forward[1]).toBeCloseTo(-math.sin(degToRad(CAMERA_PITCH_DEG)), EPS_DIGITS);
		expect(basis.forward[2]).toBeLessThan(0);
		expect(basis.up[1]).toBeGreaterThan(0);
	});
});

describe("distanceForFov", () => {
	it("shows the requested height at the focus point", () => {
		const height = 67.5;
		for (const fov of [5, 10, 70]) {
			const d = distanceForFov(fov, height);
			expect(2 * d * math.tan(degToRad(fov) / 2)).toBeCloseTo(height, 9);
		}
	});

	it("moves the camera further away as the FOV narrows", () => {
		expect(distanceForFov(5, 10)).toBeGreaterThan(distanceForFov(10, 10));
	});
});

describe("cameraPosition", () => {
	it("puts the focus point straight ahead of the camera", () => {
		const focus: Vec3 = [3, 0, -7];
		const cam = cameraPosition(focus, basis, 100);
		const toFocus: Vec3 = [focus[0] - cam[0], focus[1] - cam[1], focus[2] - cam[2]];
		expect(dot(toFocus, basis.forward)).toBeCloseTo(100, 9);
		expect(dot(toFocus, basis.right)).toBeCloseTo(0, 9);
		expect(dot(toFocus, basis.up)).toBeCloseTo(0, 9);
	});
});

describe("snapToGrid", () => {
	const grid = 0.25;

	it("lands right/up on whole grid steps and keeps forward", () => {
		const p: Vec3 = [1.234, 5.678, -9.1011];
		const s = snapToGrid(p, basis, grid);
		const r = dot(s, basis.right) / grid;
		const u = dot(s, basis.up) / grid;
		expect(r).toBeCloseTo(math.round(r), 9);
		expect(u).toBeCloseTo(math.round(u), 9);
		expect(dot(s, basis.forward)).toBeCloseTo(dot(p, basis.forward), 9);
	});

	it("moves a point by at most half a grid step on each screen axis", () => {
		const p: Vec3 = [-4.4, 2.2, 8.8];
		const s = snapToGrid(p, basis, grid);
		const d: Vec3 = [s[0] - p[0], s[1] - p[1], s[2] - p[2]];
		expect(math.abs(dot(d, basis.right))).toBeLessThan(grid / 2 + 1e-9);
		expect(math.abs(dot(d, basis.up))).toBeLessThan(grid / 2 + 1e-9);
	});

	it("is idempotent, and a no-op for grid <= 0", () => {
		const p: Vec3 = [0.3, 0.1, 0.7];
		const once = snapToGrid(p, basis, grid);
		const twice = snapToGrid(once, basis, grid);
		for (const i of [0, 1, 2]) {
			expect(twice[i]).toBeCloseTo(once[i], 9);
		}
		expect(snapToGrid(p, basis, 0)).toBe(p);
	});
});

describe("followAlpha", () => {
	it("is 1 with no damping and approaches 1 over time", () => {
		expect(followAlpha(1 / 60, 0)).toBe(1);
		expect(followAlpha(1 / 60, 0.12)).toBeGreaterThan(0);
		expect(followAlpha(1 / 60, 0.12)).toBeLessThan(followAlpha(1 / 30, 0.12));
	});

	it("is frame-rate independent: two half steps close the same gap as one step", () => {
		const tau = 0.12;
		const half = followAlpha(1 / 120, tau);
		const twoHalves = 1 - (1 - half) * (1 - half);
		expect(twoHalves).toBeCloseTo(followAlpha(1 / 60, tau), 12);
	});
});
