// The gauntlet cursor's pure logic (docs/CURSOR.md section 3, task C3): every mode branch, the hover art, the
// whole-number scale per Cursor size at 720 / 1080 / 1440 / 2160 px, and the placement that keeps the fingertip on the
// mouse at every scale and through the whole click squeeze.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CURSOR_SIZES, type CursorSize } from "shared/settings";
import {
	CURSOR_VIEW,
	cursorMode,
	cursorPlacement,
	cursorScale,
	cursorSqueeze,
	cursorVisualId,
	type CursorModeInput,
} from "shared/view";

/** A menu with a mouse and the art ready: the one case that draws the gauntlet. */
const MENU: CursorModeInput = {
	hasCustomArt: true,
	artReady: true,
	menuContext: true,
	mouseEnabled: true,
	touchOnly: false,
	onGamepad: false,
	robloxMenuOpen: false,
	windowFocused: true,
	killSwitch: false,
};

function mode(patch: Partial<CursorModeInput>): string {
	return cursorMode({ ...MENU, ...patch });
}

/** Every combination of the nine inputs (2^9). */
function everyInput(): Array<CursorModeInput> {
	const out = new Array<CursorModeInput>();
	for (let bits = 0; bits < 512; bits++) {
		const b = (i: number) => bit32.btest(bits, bit32.lshift(1, i));
		out.push({
			hasCustomArt: b(0),
			artReady: b(1),
			menuContext: b(2),
			mouseEnabled: b(3),
			touchOnly: b(4),
			onGamepad: b(5),
			robloxMenuOpen: b(6),
			windowFocused: b(7),
			killSwitch: b(8),
		});
	}
	return out;
}

describe("cursor: mode", () => {
	it("custom in a menu context with the art present and ready, a mouse, no touch-only, the Roblox menu closed", () => {
		expect(mode({})).toBe("custom");
	});

	it("gameplay is system (or hidden on a pad), whatever else holds", () => {
		expect(mode({ menuContext: false })).toBe("system");
		expect(mode({ menuContext: false, windowFocused: false })).toBe("system");
		expect(mode({ menuContext: false, onGamepad: true })).toBe("hidden");
		for (const input of everyInput()) {
			if (input.menuContext) continue;
			expect([input, cursorMode(input)]).toEqual([input, input.onGamepad ? "hidden" : "system"]);
		}
	});

	it("a gamepad hides the pointer in either context", () => {
		expect(mode({ onGamepad: true })).toBe("hidden");
		expect(mode({ onGamepad: true, menuContext: false })).toBe("hidden");
		expect(mode({ onGamepad: true, hasCustomArt: false })).toBe("hidden");
		expect(mode({ onGamepad: true, killSwitch: true })).toBe("hidden");
	});

	it("no art, art not ready, no mouse, touch-only, the Roblox menu or the kill switch: system", () => {
		expect(mode({ hasCustomArt: false })).toBe("system");
		expect(mode({ artReady: false })).toBe("system");
		expect(mode({ mouseEnabled: false })).toBe("system");
		expect(mode({ touchOnly: true })).toBe("system");
		expect(mode({ robloxMenuOpen: true })).toBe("system");
		expect(mode({ killSwitch: true })).toBe("system");
	});

	it("an unfocused window hides the pointer only where custom would apply", () => {
		expect(mode({ windowFocused: false })).toBe("hidden");
		expect(mode({ windowFocused: false, artReady: false })).toBe("system");
		expect(mode({ windowFocused: false, killSwitch: true })).toBe("system");
		expect(mode({ windowFocused: false, robloxMenuOpen: true })).toBe("system");
	});

	it("custom only for the one combination of inputs", () => {
		let customs = 0;
		for (const input of everyInput()) {
			if (cursorMode(input) !== "custom") continue;
			customs++;
			expect(input).toEqual(MENU);
		}
		expect(customs).toBe(1);
	});
});

describe("cursor: visual", () => {
	it("the hover art over a button, else the gauntlet", () => {
		expect(cursorVisualId({ overButton: true })).toBe("ui.cursor.hover");
		expect(cursorVisualId({ overButton: false })).toBe("ui.cursor");
		expect(CURSOR_VIEW.visualId).toBe("ui.cursor");
		expect(CURSOR_VIEW.hoverVisualId).toBe("ui.cursor.hover");
	});
});

describe("cursor: scale", () => {
	const HEIGHTS = [720, 1080, 1440, 2160];
	const TABLE: ReadonlyArray<[CursorSize, ReadonlyArray<number>]> = [
		["normal", [1, 2, 3, 4]],
		["small", [1, 1, 2, 3]],
		["large", [2, 3, 4, 5]],
	];

	it("docs/CURSOR.md section 3's table for each size", () => {
		for (const [size, want] of TABLE) {
			const got = HEIGHTS.map((h) => cursorScale(h, size));
			expect([size, got]).toEqual([size, want]);
		}
	});

	it("whole numbers within [minScale, maxScale] at any height; Small <= Normal <= Large", () => {
		for (const h of [0, -1, 0 / 0, 1, 200, 480, 540, 600, 810, 900, 1200, 1600, 2000, 2880, 4320, 8640]) {
			let last = 0;
			for (const size of CURSOR_SIZES) {
				const s = cursorScale(h, size);
				expect([h, size, s % 1 === 0, s >= CURSOR_VIEW.minScale, s <= CURSOR_VIEW.maxScale]).toEqual([
					h,
					size,
					true,
					true,
					true,
				]);
				expect([h, size, s >= last]).toEqual([h, size, true]);
				last = s;
			}
		}
	});

	it("tiny or bad heights read as the smallest; huge ones cap at maxScale", () => {
		expect(cursorScale(0, "normal")).toBe(1);
		expect(cursorScale(0 / 0, "large")).toBe(2);
		expect(cursorScale(100, "small")).toBe(CURSOR_VIEW.minScale);
		expect(cursorScale(100000, "normal")).toBe(CURSOR_VIEW.maxScale);
	});
});

describe("cursor: squeeze and placement", () => {
	const PIVOT = { x: 3, y: 3 };
	const SIZE = { x: 29, y: 31 };
	const MICE = [
		{ x: 0, y: 0 },
		{ x: 640, y: 360 },
		{ x: 1919, y: 1079 },
		{ x: 37.5, y: 12.25 },
	];
	const STEPS = 18;

	it("the squeeze is a triangle: 1 at both ends, pressScale at the middle, never below it", () => {
		const v = CURSOR_VIEW;
		expect(cursorSqueeze(0)).toBe(1);
		expect(cursorSqueeze(v.pressSec)).toBeCloseTo(1, 12);
		expect(cursorSqueeze(v.pressSec / 2)).toBeCloseTo(v.pressScale, 12);
		expect(cursorSqueeze(v.pressSec / 4)).toBeCloseTo((1 + v.pressScale) / 2, 12);
		for (let i = 0; i <= STEPS; i++) {
			const s = cursorSqueeze((v.pressSec * i) / STEPS);
			expect([i, s >= v.pressScale - 1e-12, s <= 1]).toEqual([i, true, true]);
		}
	});

	it("no squeeze outside [0, pressSec] or without a press", () => {
		for (const t of [undefined, -0.001, -1, CURSOR_VIEW.pressSec + 0.001, 1, 0 / 0, math.huge]) {
			expect(cursorSqueeze(t)).toBe(1);
			const p = cursorPlacement({ x: 100, y: 50 }, PIVOT, SIZE, 2, t);
			expect(p).toEqual({ x: 94, y: 44, width: 58, height: 62 });
		}
	});

	it("the fingertip sits on the mouse at every scale and through the whole squeeze", () => {
		for (let scale = CURSOR_VIEW.minScale; scale <= CURSOR_VIEW.maxScale; scale++) {
			for (const mouse of MICE) {
				for (let i = -1; i <= STEPS + 1; i++) {
					const t = (CURSOR_VIEW.pressSec * i) / STEPS;
					const p = cursorPlacement(mouse, PIVOT, SIZE, scale, t);
					const k = p.width / SIZE.x;
					expect(p.height / SIZE.y).toBeCloseTo(k, 12);
					expect(k).toBeCloseTo(scale * cursorSqueeze(t), 12);
					expect(p.x + PIVOT.x * k).toBeCloseTo(mouse.x, 9);
					expect(p.y + PIVOT.y * k).toBeCloseTo(mouse.y, 9);
				}
			}
		}
	});

	it("unsqueezed, a whole-pixel mouse and pivot place the label on whole pixels at its scaled size", () => {
		for (let scale = CURSOR_VIEW.minScale; scale <= CURSOR_VIEW.maxScale; scale++) {
			const p = cursorPlacement({ x: 640, y: 360 }, PIVOT, SIZE, scale, undefined);
			expect(p).toEqual({
				x: 640 - PIVOT.x * scale,
				y: 360 - PIVOT.y * scale,
				width: SIZE.x * scale,
				height: SIZE.y * scale,
			});
		}
	});
});
