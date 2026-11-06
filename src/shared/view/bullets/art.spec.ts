// Sprite bullets (docs/PROJECTILE_ART.md PA4, PAD8): flicker frame phase / wrap / reduced-motion freeze, the anchor's
// yaw along the velocity, the screen heading through the camera basis, part size axes and the size key.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { FX_SPRITE_VIEW } from "shared/view/fx";
import { BULLET_VIEW } from "../config";
import { bulletFrame, bulletPartSize, bulletSizeKey, bulletYaw, bulletYawAxes, screenHeading } from "./art";
import { BULLET_ART_VIEW } from "./config";

const V = BULLET_ART_VIEW;

/** The 8 compass velocities on the ground (world x, z), each with a name. */
const COMPASS: ReadonlyArray<readonly [string, number, number]> = [
	["-z", 0, -1],
	["+x-z", 1, -1],
	["+x", 1, 0],
	["+x+z", 1, 1],
	["+z", 0, 1],
	["-x+z", -1, 1],
	["-x", -1, 0],
	["-x-z", -1, -1],
];

/** Tolerances: unit vectors (trig and a square root, float64) and angles in degrees. */
const VECTOR_EPS = 1e-12;
const ANGLE_EPS = 1e-9;

function near(a: number, b: number): boolean {
	return math.abs(a - b) < VECTOR_EPS;
}

/** Circular distance between two angles, degrees. */
function angleGap(a: number, b: number): number {
	const d = math.abs(a - b) % 360;
	return math.min(d, 360 - d);
}

describe("sprite bullets: flicker frame", () => {
	it("loops at fps with the slot's phase and wraps", () => {
		// 3 frames at 10 fps: step = floor(seconds * 10).
		expect(bulletFrame(0, 0, 3, 10, false)).toBe(0);
		expect(bulletFrame(0, 1, 3, 10, false)).toBe(1);
		expect(bulletFrame(0, 2, 3, 10, false)).toBe(2);
		expect(bulletFrame(0, 3, 3, 10, false)).toBe(0);
		expect(bulletFrame(0.1, 0, 3, 10, false)).toBe(1);
		expect(bulletFrame(0.25, 0, 3, 10, false)).toBe(2);
		expect(bulletFrame(0.5, 0, 3, 10, false)).toBe(2); // step 5
		expect(bulletFrame(0.5, 1, 3, 10, false)).toBe(0); // step 5 + phase 1
		expect(bulletFrame(1, 0, 3, 10, false)).toBe(1); // step 10
		expect(bulletFrame(1, 0, 2, 4, false)).toBe(0); // step 4 of 2 frames
		expect(bulletFrame(1.25, 0, 2, 4, false)).toBe(1); // step 5
	});

	it("a ring in consecutive slots never shows one frame on every bullet", () => {
		for (const t of [0, 0.1, 0.25, 0.5, 1, 2.5]) {
			const seen = new Set<number>();
			for (let slot = 10; slot < 13; slot++) seen.add(bulletFrame(t, slot, 3, 10, false));
			expect([t, seen.size()]).toEqual([t, 3]);
		}
	});

	it("falls back to BULLET_ART_VIEW.fps when the sprite has none; negative time is step 0", () => {
		expect(V.fps).toBe(10);
		expect(bulletFrame(0.1, 0, 3, 0, false)).toBe(1);
		expect(bulletFrame(0.25, 0, 3, -1, false)).toBe(2);
		expect(bulletFrame(-5, 0, 3, 10, false)).toBe(0);
	});

	it("holds reducedMotionFrame under reduced motion and frame 0 for one-frame art", () => {
		expect(V.reducedMotionFrame).toBe(0);
		for (const t of [0, 0.1, 0.25, 0.5, 1, 7.3]) {
			for (const slot of [0, 1, 2, 5, 2047]) {
				expect(bulletFrame(t, slot, 3, 10, true)).toBe(0);
				expect(bulletFrame(t, slot, 1, 10, false)).toBe(0);
				expect(bulletFrame(t, slot, 0, 10, false)).toBe(0);
			}
		}
	});
});

describe("sprite bullets: yaw along the velocity", () => {
	it("the Top-face canvas turn is FX_SPRITE_VIEW's (one engine quirk)", () => {
		expect(V.canvasTurnDeg).toBe(FX_SPRITE_VIEW.floorCanvasTurnDeg);
	});

	it("turns the canvas's up (local -X at a 90 degree turn) onto the velocity for the 8 compass directions", () => {
		const out = { c: 0, s: 0 };
		const t = math.rad(V.canvasTurnDeg);
		// The canvas's up in the part's local frame: -Z turned `turn` anticlockwise seen from above.
		const ux = -math.sin(t);
		const uz = -math.cos(t);
		for (const [name, vx, vz] of COMPASS) {
			const len = math.sqrt(vx * vx + vz * vz);
			const a = bulletYawAxes(vx * 3, vz * 3, out); // any speed
			// CFrame.Angles(0, yaw, 0) applied to (ux, 0, uz): (c ux + s uz, -s ux + c uz).
			const wx = a.c * ux + a.s * uz;
			const wz = -a.s * ux + a.c * uz;
			expect([name, near(wx, vx / len), near(wz, vz / len)]).toEqual([name, true, true]);
			expect([name, near(a.c * a.c + a.s * a.s, 1)]).toEqual([name, true]);
			// The angle form agrees with the independent formula: yaw of the velocity minus the canvas turn.
			const want = math.atan2(-vx, -vz) - t;
			const gap = angleGap(math.deg(bulletYaw(vx, vz)), math.deg(want));
			expect([name, gap, gap < ANGLE_EPS]).toEqual([name, gap, true]);
		}
	});

	it("exact on the axes (no trig): +x is a half turn, -z a quarter turn back", () => {
		const out = { c: 0, s: 0 };
		bulletYawAxes(1, 0, out);
		expect(out.c).toBe(-1);
		expect(out.s === 0).toBe(true);
		bulletYawAxes(0, -2, out);
		expect(out.c === 0).toBe(true);
		expect(out.s).toBe(-1);
		expect(bulletYaw(0, -1)).toBe(-math.pi / 2);
	});

	it("no ground velocity points screen-up (the camera's view along the floor)", () => {
		const out = bulletYawAxes(0, 0, { c: 0, s: 0 });
		// Canvas up = local -X: (-c, s) on the ground; screen-up on the floor = (-sin yaw, -cos yaw).
		const yaw = math.rad(CAMERA_YAW_DEG);
		expect(-out.c).toBeCloseTo(-math.sin(yaw), 12);
		expect(out.s).toBeCloseTo(-math.cos(yaw), 12);
	});

	it("the part's long side runs along local X at a quarter turn (the canvas's up axis)", () => {
		expect(bulletPartSize(2.5, 0.8, 0.02)).toEqual([2.5, 0.02, 0.8]);
		expect(bulletPartSize(2.5, 0.8)).toEqual([2.5, V.thicknessStuds, 0.8]);
	});
});

describe("sprite bullets: screen heading", () => {
	it("gives the 8 compass velocities' angles on screen through the yaw 45 / pitch 55 basis", () => {
		expect([CAMERA_YAW_DEG, CAMERA_PITCH_DEG]).toEqual([V.cameraYawDeg, V.cameraPitchDeg]);
		// At yaw 45 the diagonals lie along the screen axes; an axis direction is foreshortened by sin(pitch) along
		// screen-up, so it sits A = atan(sin 55) off the screen's horizontal.
		const A = math.deg(math.atan(math.sin(math.rad(CAMERA_PITCH_DEG))));
		const want: ReadonlyArray<number> = [90 - A, 90, 90 + A, 180, 270 - A, 270, 270 + A, 0];
		for (let i = 0; i < COMPASS.size(); i++) {
			const [name, vx, vz] = COMPASS[i];
			const h = screenHeading(vx, vz);
			expect([name, h >= 0 && h < 360]).toEqual([name, true]);
			expect([name, h, angleGap(h, want[i]) < ANGLE_EPS]).toEqual([name, h, true]);
			expect([name, angleGap(screenHeading(vx * 7, vz * 7), h) < ANGLE_EPS]).toEqual([name, true]);
		}
		expect(screenHeading(0, 0)).toBe(0);
	});
});

describe("sprite bullets: size key", () => {
	it("quantizes scale x fade like the neon parts, never under one step", () => {
		expect(V.sizeQuantum).toBe(BULLET_VIEW.sizeQuantum);
		const q = V.sizeQuantum;
		expect(bulletSizeKey(1, 1)).toBe(1);
		expect(bulletSizeKey(1.5, 1)).toBe(1.5);
		expect(bulletSizeKey(1, 0.55)).toBe(4 * q);
		expect(bulletSizeKey(1, 0.01)).toBe(q);
		expect(bulletSizeKey(1, 0)).toBe(q);
	});
});
