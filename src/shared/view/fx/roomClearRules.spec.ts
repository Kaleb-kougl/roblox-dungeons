// The room clear celebration's freeze-frame hooks (docs/ROOM_CLEAR.md RC5): the solo slow-motion ramp and the stamp nudge.
import { describe, expect, it } from "@rbxts/jest-globals";
import { defaultJuiceSettings } from "shared/settings";
import { HitstopClock } from "./hitstop";
import { applyRoomClearSlowMo, stampNudgeFor } from "./roomClearRules";

describe("room clear freeze-frame hooks (docs/ROOM_CLEAR.md RC5)", () => {
	it("a CLEAR asks 500 ms of slow motion from 0.5, a PERFECT 700 ms", () => {
		const clear = new HitstopClock();
		expect(applyRoomClearSlowMo({ perfect: false }, clear, defaultJuiceSettings())).toBe(true);
		expect(clear.slowActive).toBe(true);
		expect(clear.slowDurationMs).toBe(500);
		expect(clear.slowFromScale).toBe(0.5);

		const perfect = new HitstopClock();
		expect(applyRoomClearSlowMo({ perfect: true }, perfect, defaultJuiceSettings())).toBe(true);
		expect(perfect.slowActive).toBe(true);
		expect(perfect.slowDurationMs).toBe(700);
		expect(perfect.slowFromScale).toBe(0.5);
	});

	it("Room clear off: no slow motion", () => {
		const c = new HitstopClock();
		expect(applyRoomClearSlowMo({ perfect: true }, c, { ...defaultJuiceSettings(), roomClear: false })).toBe(false);
		expect(c.slowActive).toBe(false);
	});

	it("freezeFrame off or reduced motion: the clock ignores the ramp", () => {
		const off = new HitstopClock();
		expect(applyRoomClearSlowMo({ perfect: false }, off, { ...defaultJuiceSettings(), freezeFrame: false })).toBe(
			false,
		);
		expect(off.slowActive).toBe(false);

		const reduced = new HitstopClock();
		expect(
			applyRoomClearSlowMo({ perfect: false }, reduced, { ...defaultJuiceSettings(), reducedMotion: true }),
		).toBe(false);
		expect(reduced.slowActive).toBe(false);
	});

	it("the stamp's kick is 'stamp' by default, 'none' with Room clear, screen shake or reduced motion off", () => {
		expect(stampNudgeFor(defaultJuiceSettings())).toBe("stamp");
		expect(stampNudgeFor({ ...defaultJuiceSettings(), roomClear: false })).toBe("none");
		expect(stampNudgeFor({ ...defaultJuiceSettings(), screenShake: false })).toBe("none");
		expect(stampNudgeFor({ ...defaultJuiceSettings(), reducedMotion: true })).toBe("none");
	});
});
