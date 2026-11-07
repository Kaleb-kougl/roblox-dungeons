// Gamepad menus (docs/GAMEPAD_MENUS.md GM4): the menu pad input keys, tab stepping (clamped) and the right stick's
// scroll repeat (padNav.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	GAMEPAD_MENU,
	MENU_PAD_INPUT_KEYS,
	PAD_KEYS,
	PAD_SURFACES,
	PAD_SURFACE_IDS,
	PadStickRepeat,
	isMenuPadInputKey,
	stepTab,
	subTabStep,
	tabStep,
} from ".";

describe("MENU_PAD_INPUT_KEYS", () => {
	it("holds the bumpers, triggers, X and Y, never A, B or Start", () => {
		for (const k of [PAD_KEYS.lb, PAD_KEYS.rb, PAD_KEYS.lt, PAD_KEYS.rt, PAD_KEYS.x, PAD_KEYS.y]) {
			expect(isMenuPadInputKey(k)).toBe(true);
		}
		for (const k of [PAD_KEYS.a, PAD_KEYS.b, PAD_KEYS.start, PAD_KEYS.rightStick, "DPadUp"]) {
			expect(isMenuPadInputKey(k)).toBe(false);
		}
		expect(MENU_PAD_INPUT_KEYS.size()).toBe(6);
	});

	it("covers every key a surface row maps, except Start (its own path) and the right stick (polled)", () => {
		for (const id of PAD_SURFACE_IDS) {
			for (const row of PAD_SURFACES[id].rows) {
				for (const k of row.keys) {
					if (k === PAD_KEYS.start || k === PAD_KEYS.rightStick) continue;
					expect(isMenuPadInputKey(k)).toBe(true);
				}
			}
		}
	});
});

describe("stepTab", () => {
	const tabs = ["juice", "controls", "audio", "display"];

	it("steps to the neighbour", () => {
		expect(stepTab(tabs, "controls", 1)).toBe("audio");
		expect(stepTab(tabs, "controls", -1)).toBe("juice");
	});

	it("clamps at both ends (no wrap)", () => {
		expect(stepTab(tabs, "juice", -1)).toBe(undefined);
		expect(stepTab(tabs, "display", 1)).toBe(undefined);
	});

	it("goes to the first tab from an unknown one, and nowhere for a zero step or no tabs", () => {
		expect(stepTab(tabs, "nope", 1)).toBe("juice");
		expect(stepTab(tabs, "audio", 0)).toBe(undefined);
		expect(stepTab([] as string[], "audio", 1)).toBe(undefined);
	});

	it("reads only the sign of the step", () => {
		expect(stepTab(tabs, "juice", 5)).toBe("controls");
		expect(stepTab(tabs, "display", -3)).toBe("audio");
	});
});

describe("tabStep / subTabStep", () => {
	it("map the tab actions to steps and everything else to 0", () => {
		expect(tabStep({ kind: "tabPrev" })).toBe(-1);
		expect(tabStep({ kind: "tabNext" })).toBe(1);
		expect(tabStep({ kind: "subTabNext" })).toBe(0);
		expect(subTabStep({ kind: "subTabPrev" })).toBe(-1);
		expect(subTabStep({ kind: "subTabNext" })).toBe(1);
		expect(subTabStep({ kind: "tabNext" })).toBe(0);
		expect(subTabStep({ kind: "back" })).toBe(0);
	});
});

describe("PadStickRepeat", () => {
	const dz = GAMEPAD_MENU.stickDeadZone;
	const rep = GAMEPAD_MENU.scrollRepeatSec;

	it("does nothing inside the dead zone", () => {
		const r = new PadStickRepeat();
		expect(r.step(0, 0, 0.016, dz, rep)).toBe(false);
		expect(r.step(0, dz * 0.9, 0.016, dz, rep)).toBe(false);
	});

	it("fires on leaving the dead zone, then every repeat interval", () => {
		const r = new PadStickRepeat();
		expect(r.step(0, 1, 0.016, dz, rep)).toBe(true);
		expect(r.step(0, 1, rep / 2, dz, rep)).toBe(false);
		expect(r.step(0, 1, rep / 2, dz, rep)).toBe(true);
		expect(r.step(0, 1, rep / 4, dz, rep)).toBe(false);
	});

	it("fires at most once per frame on a long frame", () => {
		const r = new PadStickRepeat();
		r.step(1, 0, 0.016, dz, rep);
		expect(r.step(1, 0, rep * 5, dz, rep)).toBe(true);
		expect(r.step(1, 0, 0, dz, rep)).toBe(false);
	});

	it("rearms back inside the dead zone and after reset", () => {
		const r = new PadStickRepeat();
		r.step(0, -1, 0.016, dz, rep);
		expect(r.step(0, 0, 0.016, dz, rep)).toBe(false);
		expect(r.step(0, -1, 0.016, dz, rep)).toBe(true);
		r.reset();
		expect(r.step(0, -1, 0.016, dz, rep)).toBe(true);
	});
});
