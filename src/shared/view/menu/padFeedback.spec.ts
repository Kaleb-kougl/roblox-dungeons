// Gamepad menus (docs/GAMEPAD_MENUS.md GM5 / GM7 / GM9 / GM12): the right stick's list scroll and its end latch
// (padScroll.ts), the hint bar's glyph choice and the menu haptics (padFeedback.ts), the TV-safe inset (fit.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	GAMEPAD_MENU,
	HapticGenerations,
	MENU_HAPTICS,
	MENU_HAPTIC_KINDS,
	MENU_SAFE_MAX_SHARE,
	ScrollEndLatch,
	fitMenu,
	hapticTimeline,
	menuFitDevice,
	menuFitOn,
	menuHapticsOn,
	menuSafeShare,
	padConfirmFeedback,
	padGlyph,
	padScrollStep,
	scrollMaxY,
} from ".";

const STEP = GAMEPAD_MENU.scrollStepPx;

describe("padScrollStep (GM5)", () => {
	it("moves one step toward the start (stick up) or the end (stick down), clamped", () => {
		expect(scrollMaxY(500, 300)).toBe(200);
		expect(scrollMaxY(200, 300)).toBe(0);
		expect(padScrollStep(100, 200, -1, STEP)).toEqual({ y: 100 + STEP, moved: true, pushedEnd: undefined });
		expect(padScrollStep(100, 200, 0.5, STEP)).toEqual({ y: 100 - STEP, moved: true, pushedEnd: undefined });
		expect(padScrollStep(190, 200, -1, STEP)).toEqual({ y: 200, moved: true, pushedEnd: "end" });
		expect(padScrollStep(10, 200, 1, STEP)).toEqual({ y: 0, moved: true, pushedEnd: "start" });
	});

	it("pushing into an end it already sits at moves nothing and names that end", () => {
		expect(padScrollStep(200, 200, -1, STEP)).toEqual({ y: 200, moved: false, pushedEnd: "end" });
		expect(padScrollStep(0, 200, 1, STEP)).toEqual({ y: 0, moved: false, pushedEnd: "start" });
		// A list that does not scroll: both ends at 0.
		expect(padScrollStep(0, 0, -1, STEP)).toEqual({ y: 0, moved: false, pushedEnd: "end" });
	});

	it("a zero stick moves nothing; an out-of-range position is clamped (and counts as a move)", () => {
		expect(padScrollStep(50, 200, 0, STEP)).toEqual({ y: 50, moved: false, pushedEnd: undefined });
		expect(padScrollStep(300, 200, 1, STEP)).toEqual({ y: 200 - STEP, moved: true, pushedEnd: undefined });
		expect(padScrollStep(-5, 200, 0, STEP)).toEqual({ y: 0, moved: false, pushedEnd: undefined });
	});
});

describe("ScrollEndLatch: the list end's tick once per arrival (GM5 / GM9)", () => {
	it("ticks on arriving at an end, not while pressing into it, again after leaving it", () => {
		const latch = new ScrollEndLatch();
		let y = 100;
		const push = (stick: number) => {
			const r = padScrollStep(y, 200, stick, STEP);
			y = r.y;
			return latch.step(r);
		};
		const ticks = new Array<boolean>();
		for (let i = 0; i < 5; i++) ticks.push(push(-1));
		// 136, 172, 200 (arrive: tick), 200 (held), 200 (held)
		expect(ticks).toEqual([false, false, true, false, false]);
		expect(push(1)).toBe(false); // 164: left the end
		expect(push(-1)).toBe(true); // 200 again: a new arrival
		for (let i = 0; i < 6; i++) push(1);
		expect(y).toBe(0);
		latch.reset();
		expect(push(1)).toBe(true); // after a reset, pressing into the start ticks once more
		expect(push(1)).toBe(false);
	});
});

describe("padGlyph (GM7, GMD8)", () => {
	it("the engine's image first, else its text when it says more than the key's name, else our label", () => {
		expect(padGlyph("ButtonA", "rbx-content", "A", "A")).toEqual({ kind: "image", image: "rbx-content" });
		expect(padGlyph("ButtonA", "", "Cross", "A")).toEqual({ kind: "text", text: "Cross" });
		expect(padGlyph("ButtonA", undefined, "ButtonA", "A")).toEqual({ kind: "text", text: "A" });
		expect(padGlyph("ButtonL1", "", "", "LB")).toEqual({ kind: "text", text: "LB" });
		expect(padGlyph("ButtonL1", undefined, undefined, "LB")).toEqual({ kind: "text", text: "LB" });
	});
});

describe("menu haptics (GM9)", () => {
	it("only on the gamepad, only with vibration On", () => {
		expect(menuHapticsOn("gamepad", true)).toBe(true);
		expect(menuHapticsOn("gamepad", false)).toBe(false);
		expect(menuHapticsOn("keyboard", true)).toBe(false);
		expect(menuHapticsOn("touch", true)).toBe(false);
	});

	it("every cue's timeline turns each motor on, then off, in time order, and ends with every motor off", () => {
		for (const cue of MENU_HAPTIC_KINDS) {
			const events = hapticTimeline(cue);
			expect(events.size()).toBe(MENU_HAPTICS[cue].size() * 2);
			for (let i = 1; i < events.size(); i++) {
				expect(events[i].atSec >= events[i - 1].atSec).toBe(true);
			}
			const last = new Map<string, number>();
			for (const e of events) last.set(e.motor, e.strength);
			for (const [, strength] of last) expect(strength).toBe(0);
		}
	});

	it("the disabled press is a double buzz with a gap between the pulses", () => {
		const events = hapticTimeline("disabled");
		expect(events.map((e) => e.strength > 0)).toEqual([true, false, true, false]);
		expect(events[2].atSec > events[1].atSec).toBe(true);
		expect(hapticTimeline("confirm")[0]).toEqual({ atSec: 0, motor: "Small", strength: 0.35 });
	});

	it("a button press buzzes only on the pad, right after A, by its disabled state", () => {
		const w = GAMEPAD_MENU.confirmPressWindowSec;
		expect(padConfirmFeedback("gamepad", 0, w, false)).toBe("confirm");
		expect(padConfirmFeedback("gamepad", w, w, true)).toBe("disabled");
		expect(padConfirmFeedback("gamepad", w + 0.01, w, false)).toBe("none");
		expect(padConfirmFeedback("gamepad", undefined, w, false)).toBe("none");
		expect(padConfirmFeedback("keyboard", 0, w, false)).toBe("none");
		expect(padConfirmFeedback("touch", 0, w, true)).toBe("none");
	});
});

describe("TV-safe menus (GM12)", () => {
	it("no inset and no fitting change off a ten-foot interface (PC and phones exactly as before)", () => {
		expect(menuSafeShare(false)).toEqual({ x: 0, y: 0 });
		for (const touch of [false, true]) {
			expect(menuFitOn(menuFitDevice(touch, false), false)).toBe(menuFitDevice(touch, false));
			expect(menuFitOn(menuFitDevice(false, touch), false)).toBe(touch);
		}
	});

	it("a ten-foot interface takes GAMEPAD_MENU.tvSafe on each side and fits the panel into what is left", () => {
		const share = menuSafeShare(true);
		expect(share).toEqual({ x: GAMEPAD_MENU.tvSafe.x, y: GAMEPAD_MENU.tvSafe.y });
		expect(share.x <= MENU_SAFE_MAX_SHARE && share.y <= MENU_SAFE_MAX_SHARE).toBe(true);
		expect(menuFitOn(false, true)).toBe(true);
		// 1920 x 1080 at HUD scale 1.5: 1280 x 720 reference px, 90 % of it is the area; a 700 x 700 panel shrinks.
		const fit = fitMenu({
			w: 700,
			h: 700,
			areaW: 1280 * (1 - 2 * share.x),
			areaH: 720 * (1 - 2 * share.y),
			uiScale: 1.5,
			touch: menuFitOn(false, true),
			ornament: false,
			ornamentArtH: 0,
		});
		expect(fit.factor < 1).toBe(true);
		expect(fit.overflow).toBe(false);
	});
});

describe("HapticGenerations: per pad + motor (review fix)", () => {
	it("a newer cue on the same pad and motor drops the older one's events; another pad or motor never does", () => {
		const g = new HapticGenerations();
		const pad1 = g.begin("Gamepad1", "Small");
		expect(g.current("Gamepad1", "Small", pad1)).toBe(true);
		// A cue on a second pad: pad 1's later "off" still applies.
		const pad2 = g.begin("Gamepad2", "Small");
		expect(g.current("Gamepad1", "Small", pad1)).toBe(true);
		expect(g.current("Gamepad2", "Small", pad2)).toBe(true);
		// Another motor on pad 1: independent.
		const large = g.begin("Gamepad1", "Large");
		expect(g.current("Gamepad1", "Small", pad1)).toBe(true);
		expect(g.current("Gamepad1", "Large", large)).toBe(true);
		// A newer cue on pad 1's Small motor wins there.
		const newer = g.begin("Gamepad1", "Small");
		expect(g.current("Gamepad1", "Small", pad1)).toBe(false);
		expect(g.current("Gamepad1", "Small", newer)).toBe(true);
	});

	it("after clear (every motor off) no pending event applies, and new cues never reuse an old generation", () => {
		const g = new HapticGenerations();
		const old = g.begin("Gamepad1", "Small");
		g.clear();
		expect(g.current("Gamepad1", "Small", old)).toBe(false);
		const fresh = g.begin("Gamepad1", "Small");
		expect(fresh !== old).toBe(true);
		expect(g.current("Gamepad1", "Small", old)).toBe(false);
		expect(g.current("Gamepad1", "Small", fresh)).toBe(true);
	});
});
