// Haptics' shared core (docs/HAPTICS.md HP1): the timeline moved out of shared/view/menu (every menu cue exactly as
// before), ramp expansion and offsets for play cues, and HapticGenerations' priority (a weaker cue blocked while a
// stronger runs, allowed after it ends; the menu's priority-free path unchanged).
import { describe, expect, it } from "@rbxts/jest-globals";
import { MENU_HAPTICS, MENU_HAPTIC_KINDS, hapticTimeline as menuTimeline, type MenuHaptic } from "../menu";
import { HapticGenerations, hapticTimeline, pulseStrengthAt, pulsesSeconds, type HapticEvent } from "./haptics";
import { PLAY_HAPTICS, PLAY_HAPTICS_RULES } from "./hapticsConfig";

const STEP = PLAY_HAPTICS_RULES.rampStepSec;
const EPS = 1e-9;

/** The menu's timeline exactly as shared/view/menu padFeedback.ts built it before HP1 (the reference). */
function oldMenuTimeline(cue: MenuHaptic): ReadonlyArray<HapticEvent> {
	const out = new Array<HapticEvent>();
	for (const p of MENU_HAPTICS[cue]) {
		const start = math.max(0, p.delaySec);
		out.push({ atSec: start, motor: p.motor, strength: math.clamp(p.strength, 0, 1) });
		out.push({ atSec: start + math.max(0, p.seconds), motor: p.motor, strength: 0 });
	}
	out.sort((a, b) => (a.atSec !== b.atSec ? a.atSec < b.atSec : a.strength < b.strength));
	return out;
}

describe("hapticTimeline moved to shared/view/fx (HP1)", () => {
	it("every menu cue's timeline is exactly the old one", () => {
		for (const cue of MENU_HAPTIC_KINDS) {
			expect([cue, menuTimeline(cue)]).toEqual([cue, oldMenuTimeline(cue)]);
		}
	});

	it("the menu's overload with a pulse list is the shared timeline", () => {
		const pulses = PLAY_HAPTICS.hurtHeart.pad;
		expect(menuTimeline(pulses, STEP)).toEqual(hapticTimeline(pulses, STEP));
	});

	it("a pulse without a ramp or an offset is one on at 0 and one off at its length", () => {
		expect(hapticTimeline([{ motor: "Small", strength: 0.25, seconds: 0.035 }], STEP)).toEqual([
			{ atSec: 0, motor: "Small", strength: 0.25 },
			{ atSec: 0.035, motor: "Small", strength: 0 },
		]);
		// Clamped strength, negative offset and length.
		expect(hapticTimeline([{ motor: "Large", strength: 1.5, seconds: -1, atSec: -2 }], STEP)).toEqual([
			{ atSec: 0, motor: "Large", strength: 0 },
			{ atSec: 0, motor: "Large", strength: 1 },
		]);
	});
});

describe("ramps and offsets (HP1)", () => {
	it("a ramp holds a step every rampStepSec at the ramp's value, then turns off at its end", () => {
		const pulse = { motor: "Large" as const, strength: 0.9, seconds: 0.6, toStrength: 0 };
		const events = hapticTimeline([pulse], STEP);
		const steps = math.round(pulse.seconds / STEP);
		expect(events.size()).toBe(steps + 1);
		for (let k = 0; k < steps; k++) {
			expect(events[k].atSec).toBeCloseTo(k * STEP, 9);
			expect(events[k].strength).toBeCloseTo(pulse.strength * (1 - k / steps), 9);
			if (k > 0) expect(events[k].strength < events[k - 1].strength).toBe(true);
		}
		expect(events[steps]).toEqual({ atSec: 0.6, motor: "Large", strength: 0 });
		expect(pulseStrengthAt(pulse, 0.3)).toBeCloseTo(0.45, 9);
	});

	it("a non-positive ramp step holds the start value", () => {
		const events = hapticTimeline([{ motor: "Large", strength: 0.9, seconds: 0.6, toStrength: 0 }], 0);
		expect(events).toEqual([
			{ atSec: 0, motor: "Large", strength: 0.9 },
			{ atSec: 0.6, motor: "Large", strength: 0 },
		]);
	});

	it("the stagger: the hit, then the tail on the same motor from its offset (the hit's off first), the small edge", () => {
		const events = hapticTimeline(PLAY_HAPTICS.stagger.pad, STEP);
		const large = events.filter((e) => e.motor === "Large");
		const small = events.filter((e) => e.motor === "Small");
		expect(small).toEqual([
			{ atSec: 0, motor: "Small", strength: 0.5 },
			{ atSec: 0.06, motor: "Small", strength: 0 },
		]);
		expect(large[0]).toEqual({ atSec: 0, motor: "Large", strength: 1 });
		expect(large[1]).toEqual({ atSec: 0.12, motor: "Large", strength: 0 });
		expect(large[2]).toEqual({ atSec: 0.12, motor: "Large", strength: 0.45 });
		const last = large[large.size() - 1];
		expect(last.strength).toBe(0);
		expect(last.atSec).toBeCloseTo(0.38, 9);
		for (let i = 1; i < events.size(); i++) expect(events[i].atSec + EPS >= events[i - 1].atSec).toBe(true);
		expect(pulsesSeconds(PLAY_HAPTICS.stagger.pad)).toBeCloseTo(0.38, 9);
	});
});

describe("HapticGenerations' priority (HP1)", () => {
	it("a weaker cue is refused while a stronger one runs on that pad + motor, allowed after it ends", () => {
		const g = new HapticGenerations();
		const stagger = g.begin("Gamepad1", "Large", 4, 0, 0.38);
		expect(stagger).toBeDefined();
		expect(g.begin("Gamepad1", "Large", 1, 0.1, 0.18)).toBeUndefined();
		expect(g.current("Gamepad1", "Large", stagger!)).toBe(true);
		// Another motor or another pad is never held.
		expect(g.begin("Gamepad1", "Small", 0, 0.1, 0.135)).toBeDefined();
		expect(g.begin("Gamepad2", "Large", 0, 0.1, 0.135)).toBeDefined();
		// After the stagger's end the weaker cue takes the motor.
		const parry = g.begin("Gamepad1", "Large", 1, 0.38, 0.46);
		expect(parry).toBeDefined();
		expect(g.current("Gamepad1", "Large", stagger!)).toBe(false);
		expect(g.current("Gamepad1", "Large", parry!)).toBe(true);
	});

	it("an equal or higher priority takes over at once", () => {
		const g = new HapticGenerations();
		const a = g.begin("Gamepad1", "Large", 2, 0, 0.09)!;
		const b = g.begin("Gamepad1", "Large", 2, 0.01, 0.1);
		expect(b).toBeDefined();
		expect(g.current("Gamepad1", "Large", a)).toBe(false);
		const c = g.begin("Gamepad1", "Large", 6, 0.02, 0.52);
		expect(c).toBeDefined();
		expect(g.current("Gamepad1", "Large", b!)).toBe(false);
		expect(g.begin("Gamepad1", "Large", 5, 0.1, 0.7)).toBeUndefined();
	});

	it("the menu's priority-free begin always takes over (and releases a hold); clear releases every hold", () => {
		const g = new HapticGenerations();
		const play = g.begin("Gamepad1", "Large", 5, 0, 0.6)!;
		const menu = g.begin("Gamepad1", "Large");
		expect(g.current("Gamepad1", "Large", play)).toBe(false);
		expect(g.current("Gamepad1", "Large", menu)).toBe(true);
		expect(g.begin("Gamepad1", "Large", 0, 0.1, 0.135)).toBeDefined();
		g.begin("Gamepad1", "Small", 6, 0, 0.5);
		g.clear();
		expect(g.begin("Gamepad1", "Small", 0, 0.1, 0.135)).toBeDefined();
	});
});
