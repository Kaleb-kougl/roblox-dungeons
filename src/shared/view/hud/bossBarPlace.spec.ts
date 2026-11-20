import { describe, expect, it } from "@rbxts/jest-globals";
import { BOSS_BAR_PLACE, BossBarPlacer, bossScreenBox, rectNear } from "./bossBarPlace";

const TOP = { x: 380, y: 16, w: 520, h: 66 };
const BOTTOM = { x: 380, y: 638, w: 520, h: 66 };
/** A boss box at screen y `y` (its head), under the bar horizontally. */
function bossAt(y: number) {
	return { x: 600, y, w: 80, h: 100 };
}
const FAR = bossAt(300);
const UNDER_TOP = bossAt(-20);
/** Binary-exact steps: BOSS_BAR_PLACE.holdSeconds is a whole number of them. */
const DT = 0.0625;
const HOLD_STEPS = BOSS_BAR_PLACE.holdSeconds / DT;

describe("bossScreenBox", () => {
	it("spans head to feet, widthShare of the height wide, centred", () => {
		const out = bossScreenBox(500, 400, 500, 300, 0.8, { x: 0, y: 0, w: 0, h: 0 });
		expect(out).toEqual({ x: 460, y: 300, w: 80, h: 100 });
	});
});

describe("rectNear", () => {
	it("counts the pad, not touching edges without it", () => {
		const a = { x: 0, y: 0, w: 10, h: 10 };
		expect(rectNear(a, { x: 10, y: 0, w: 10, h: 10 }, 0)).toBe(false);
		expect(rectNear(a, { x: 15, y: 0, w: 10, h: 10 }, 6)).toBe(true);
		expect(rectNear(a, { x: 15, y: 0, w: 10, h: 10 }, 4)).toBe(false);
	});
});

describe("BossBarPlacer", () => {
	it("stays at the top while the boss is elsewhere or off screen", () => {
		const p = new BossBarPlacer();
		expect(p.update(FAR, TOP, BOTTOM, 1, DT)).toBe("top");
		expect(p.update(undefined, TOP, BOTTOM, 1, DT)).toBe("top");
	});

	it("drops at once when the boss comes under the top spot, a boss beside it does not", () => {
		const p = new BossBarPlacer();
		expect(p.update({ x: 0, y: 0, w: 80, h: 100 }, TOP, BOTTOM, 1, DT)).toBe("top");
		expect(p.update(UNDER_TOP, TOP, BOTTOM, 1, DT)).toBe("bottom");
	});

	it("the enter pad scales with the HUD scale", () => {
		const gap = BOSS_BAR_PLACE.enterPadPx * 1.5;
		const boss = bossAt(TOP.y + TOP.h + gap - 1);
		expect(new BossBarPlacer().update(boss, TOP, BOTTOM, 1, DT)).toBe("top");
		expect(new BossBarPlacer().update(boss, TOP, BOTTOM, 2, DT)).toBe("bottom");
	});

	it("goes back up only after the boss stays clear of the exit pad for holdSeconds", () => {
		const p = new BossBarPlacer();
		p.update(UNDER_TOP, TOP, BOTTOM, 1, DT);
		// Inside the exit pad but outside the enter pad: still held at the bottom.
		const lingering = bossAt(TOP.y + TOP.h + BOSS_BAR_PLACE.exitPadPx - 1);
		for (let i = 0; i < 40; i++) expect(p.update(lingering, TOP, BOTTOM, 1, DT)).toBe("bottom");
		for (let i = 1; i < HOLD_STEPS; i++) expect(p.update(FAR, TOP, BOTTOM, 1, DT)).toBe("bottom");
		expect(p.update(FAR, TOP, BOTTOM, 1, DT)).toBe("top");
	});

	it("a return under the top spot restarts the hold", () => {
		const p = new BossBarPlacer();
		p.update(UNDER_TOP, TOP, BOTTOM, 1, DT);
		p.update(FAR, TOP, BOTTOM, 1, BOSS_BAR_PLACE.holdSeconds - DT);
		p.update(UNDER_TOP, TOP, BOTTOM, 1, DT);
		expect(p.update(FAR, TOP, BOTTOM, 1, BOSS_BAR_PLACE.holdSeconds - DT)).toBe("bottom");
		expect(p.update(FAR, TOP, BOTTOM, 1, DT)).toBe("top");
	});

	it("goes up at once when the boss reaches the bottom spot", () => {
		const p = new BossBarPlacer();
		p.update(UNDER_TOP, TOP, BOTTOM, 1, DT);
		expect(p.update(bossAt(600), TOP, BOTTOM, 1, DT)).toBe("top");
		const q = new BossBarPlacer();
		q.update(UNDER_TOP, TOP, undefined, 1, DT);
		expect(q.update(bossAt(600), TOP, undefined, 1, DT)).toBe("bottom");
	});

	it("an off-screen boss counts as clear; reset puts the bar back at the top", () => {
		const p = new BossBarPlacer();
		p.update(UNDER_TOP, TOP, BOTTOM, 1, DT);
		expect(p.update(undefined, TOP, BOTTOM, 1, BOSS_BAR_PLACE.holdSeconds)).toBe("top");
		p.update(UNDER_TOP, TOP, BOTTOM, 1, DT);
		p.reset();
		expect(p.spot()).toBe("top");
	});
});
