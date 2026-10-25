// Ported from src/sim/step.test.ts ("step"; the rng part is in rng.spec.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_BOUNDS,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	PLAYER_SPEED,
	Rng,
	createSimState,
	step,
	type SimConfig,
} from "shared/sim";

function len(x: number, z: number): number {
	return math.sqrt(x * x + z * z);
}

describe("step", () => {
	it("moves at PLAYER_SPEED and records prev position", () => {
		const s = createSimState(1, 0, 0);
		step(s, { ...EMPTY_INPUT, moveX: 1000 });
		expect(s.player.prevX).toBe(0);
		expect(s.player.x).toBeCloseTo(PLAYER_SPEED / 60, 12);
		for (let i = 1; i < 60; i++) step(s, { ...EMPTY_INPUT, moveX: 1000 });
		expect(s.player.x).toBeCloseTo(PLAYER_SPEED, 9);
		expect(s.tick).toBe(60);
	});

	it("clamps the move vector to length 1", () => {
		const s = createSimState(1, 0, 0);
		step(s, { ...EMPTY_INPUT, moveX: 1000, moveZ: 1000 });
		expect(len(s.player.x, s.player.z)).toBeCloseTo(PLAYER_SPEED / 60, 12);
	});

	it("clamps position to the arena bounds", () => {
		const s = createSimState(1, 7, -7);
		for (let i = 0; i < 120; i++) step(s, { ...EMPTY_INPUT, moveX: 1000, moveZ: -1000 });
		expect(s.player.x).toBe(DEFAULT_SIM_CONFIG.bounds.maxX);
		expect(s.player.z).toBe(DEFAULT_SIM_CONFIG.bounds.minZ);
	});

	it("faces aim, else movement, else keeps facing (unit vector)", () => {
		const s = createSimState(1, 0, 0);
		step(s, { ...EMPTY_INPUT, moveX: 300, moveZ: 400 });
		expect([s.player.faceX, s.player.faceZ]).toEqual([0.6, 0.8]);
		step(s, { ...EMPTY_INPUT, moveX: 300, moveZ: 400, aimX: -1000, aimZ: 0 });
		expect([s.player.faceX, s.player.faceZ]).toEqual([-1, 0]);
		step(s, EMPTY_INPUT);
		expect([s.player.faceX, s.player.faceZ]).toEqual([-1, 0]);
	});

	it("a moveResolver replaces the bounds clamp and receives the per-tick move", () => {
		const calls: number[][] = [];
		const config: SimConfig = {
			bounds: DEFAULT_BOUNDS,
			// Toy wall at x = 7.5: deterministic, no trig.
			moveResolver: (x, z, dx, dz) => {
				calls.push([x, z, dx, dz]);
				return { x: math.min(x + dx, 7.5), z: z + dz };
			},
		};
		const s = createSimState(1, 7, 0);
		for (let i = 0; i < 120; i++) step(s, { ...EMPTY_INPUT, moveX: 1000, moveZ: 1000 }, config);
		expect(s.player.x).toBe(7.5); // not the 7.25 bounds clamp
		expect(s.player.z).toBeGreaterThan(DEFAULT_BOUNDS.maxZ); // bounds ignored
		expect(calls.size()).toBe(120);
		expect(calls[0][0]).toBe(7);
		expect(len(calls[0][2], calls[0][3])).toBeCloseTo(PLAYER_SPEED / 60, 12);
		step(s, EMPTY_INPUT, config);
		expect(calls.size()).toBe(120); // not called without movement
		expect(s.player.prevX).toBe(7.5);
	});

	it("keeps the rng state in SimState", () => {
		const s = createSimState(42, 0, 0);
		expect(s.rngState).toBe(new Rng(42).getState());
	});

	it("DEFAULT_SIM_CONFIG is the greybox +/-7.25 room", () => {
		expect(DEFAULT_SIM_CONFIG.bounds).toEqual({ minX: -7.25, maxX: 7.25, minZ: -7.25, maxZ: 7.25 });
		expect(DEFAULT_SIM_CONFIG.moveResolver).toBe(undefined);
	});
});
