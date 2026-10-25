// ?stress=N setup (ported from src/bullets/setup.test.ts "stressFromQuery"): the Roblox build reads the target from a
// debug attribute, so the parser takes the raw value instead of a URL query.
import { describe, expect, it } from "@rbxts/jest-globals";
import { MAX_STRESS_BULLETS, createSimState, stressConfig, stressTargetFrom } from "shared/sim";

describe("stressTargetFrom", () => {
	it("parses N, ignores junk, caps the target", () => {
		expect(stressTargetFrom(undefined)).toBe(0);
		expect(stressTargetFrom("")).toBe(0);
		expect(stressTargetFrom("1000")).toBe(1000);
		expect(stressTargetFrom(" 1000 ")).toBe(1000);
		expect(stressTargetFrom(1000)).toBe(1000);
		expect(stressTargetFrom("250.7")).toBe(250);
		expect(stressTargetFrom("abc")).toBe(0);
		expect(stressTargetFrom("-5")).toBe(0);
		expect(stressTargetFrom(0 / 0)).toBe(0);
		expect(stressTargetFrom(math.huge)).toBe(0);
		expect(stressTargetFrom(true)).toBe(0);
		expect(stressTargetFrom("1e9")).toBe(MAX_STRESS_BULLETS);
		expect(MAX_STRESS_BULLETS).toBe(20000);
	});

	it("stressConfig turns a target into SimConfig.stress (rings from the spawn), undefined when off", () => {
		expect(stressConfig(0, 1, 2)).toBe(undefined);
		const stress = stressConfig(300, 67, 35);
		expect(stress).toEqual({ bullets: 300, x: 67, z: 35 });
		const s = createSimState(1, 67, 35, { stress });
		expect([s.combat.stressTarget, s.combat.stressX, s.combat.stressZ]).toEqual([300, 67, 35]);
		expect(s.combat.stressEmitterId).toBe(1);
		// The enemy pool grows past 2048 slots only for big targets.
		expect(createSimState(1, 0, 0, { stress: stressConfig(MAX_STRESS_BULLETS, 0, 0) }).combat.enemyCapacity).toBe(
			MAX_STRESS_BULLETS + 48 + 512,
		);
	});
});
