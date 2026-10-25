// Sim units <-> studs, interpolation and the mouse-aim ray onto the floor.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import {
	GAME_WORLD,
	cameraPosition,
	degToRad,
	floorStudsY,
	isoBasis,
	lerp,
	pointerAimFromRay,
	rayHitPlaneY,
	simX,
	simZ,
	studsX,
	studsY,
	studsZ,
	type Vec3,
} from "shared/view";

describe("sim units <-> studs", () => {
	it("scales by STUDS_PER_TILE around the world origin, and round-trips", () => {
		const [ox, oy, oz] = GAME_WORLD.originStuds;
		expect(studsX(0)).toBe(ox);
		expect(studsZ(0)).toBe(oz);
		expect(studsY(0)).toBe(oy);
		expect(floorStudsY()).toBe(oy);
		expect(studsX(2.5) - ox).toBe(2.5 * STUDS_PER_TILE);
		for (const v of [-13.25, 0, 0.1, 47]) {
			expect(simX(studsX(v))).toBeCloseTo(v, 12);
			expect(simZ(studsZ(v))).toBeCloseTo(v, 12);
		}
	});

	it("lerp is the sim loop's prev -> current interpolation", () => {
		expect(lerp(2, 4, 0)).toBe(2);
		expect(lerp(2, 4, 0.25)).toBe(2.5);
		expect(lerp(-1, -1, 0.7)).toBe(-1);
	});
});

describe("rayHitPlaneY", () => {
	it("hits the plane in front of the ray", () => {
		const hit = rayHitPlaneY([0, 10, 0], [1, -1, 2], 0);
		expect(hit).toEqual([10, 20]);
	});

	it("misses parallel rays and rays pointing away", () => {
		expect(rayHitPlaneY([0, 10, 0], [1, 0, 0], 0)).toBe(undefined);
		expect(rayHitPlaneY([0, 10, 0], [0, 1, 0], 0)).toBe(undefined);
		expect(rayHitPlaneY([0, 10, 0], [0, 0 / 0, 0], 0)).toBe(undefined);
	});
});

describe("pointerAimFromRay (mouse aim)", () => {
	const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));

	it("the screen-centre ray of the iso camera hits the focus point: zero aim from a player standing there", () => {
		const px = 12.5;
		const pz = -3.25;
		const focus: Vec3 = [studsX(px), floorStudsY(), studsZ(pz)];
		const eye = cameraPosition(focus, basis, 500);
		const aim = pointerAimFromRay(eye, basis.forward, px, pz)!;
		expect(aim[0]).toBeCloseTo(0, 6);
		expect(aim[1]).toBeCloseTo(0, 6);
	});

	it("a ray tilted toward screen-right aims along the camera's ground-right direction", () => {
		const focus: Vec3 = [studsX(0), floorStudsY(), studsZ(0)];
		const eye = cameraPosition(focus, basis, 500);
		const k = 0.01;
		const dir: Vec3 = [
			basis.forward[0] + basis.right[0] * k,
			basis.forward[1] + basis.right[1] * k,
			basis.forward[2] + basis.right[2] * k,
		];
		const aim = pointerAimFromRay(eye, dir, 0, 0)!;
		const len = math.sqrt(aim[0] * aim[0] + aim[1] * aim[1]);
		// screen-right on the ground = (cos yaw, -sin yaw) = (1, -1) / sqrt 2 at 45 degrees
		expect(aim[0] / len).toBeCloseTo(basis.right[0], 6);
		expect(aim[1] / len).toBeCloseTo(basis.right[2], 6);
	});
});
