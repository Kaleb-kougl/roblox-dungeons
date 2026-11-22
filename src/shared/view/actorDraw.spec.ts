// The actor renderer's placeholder rules (docs/ACTOR_RENDER.md R5): the scale a placeholder model is built at (the
// boss minimum width, then the Hulking factor) and the capsule's tumble through a roll.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ROLL_TICKS } from "shared/sim";
import { ACTOR_VIEW, placeholderDrawScale, rollTumbleTurn } from "shared/view";

describe("placeholderDrawScale", () => {
	const min = ACTOR_VIEW.bossMinDrawPx;

	it("is the archetype's spriteScale, 1 when it has none", () => {
		expect(placeholderDrawScale(undefined, false, 16)).toBe(1);
		expect(placeholderDrawScale(0.5, false, 16)).toBe(0.5);
		expect(placeholderDrawScale(2, false, 16)).toBe(2);
	});

	it("never widens an actor that is not a boss, however small", () => {
		expect(placeholderDrawScale(undefined, false, 1)).toBe(1);
		expect(placeholderDrawScale(0.25, false, min / 8)).toBe(0.25);
	});

	it("draws a boss at least bossMinDrawPx wide", () => {
		const cell = min / 4;
		expect(placeholderDrawScale(undefined, true, cell)).toBe(min / cell);
		expect(placeholderDrawScale(undefined, true, cell) * cell).toBe(min);
		// its own scale counts toward the width, and is replaced (not multiplied) when it falls short
		expect(placeholderDrawScale(2, true, cell)).toBe(min / cell);
	});

	it("keeps a boss that is already wide enough at its own scale", () => {
		expect(placeholderDrawScale(undefined, true, min)).toBe(1);
		expect(placeholderDrawScale(3, true, min)).toBe(3);
		expect(placeholderDrawScale(2, true, min / 2)).toBe(2); // exactly the minimum
	});

	it("applies the affix scale last, on top of the boss minimum", () => {
		expect(placeholderDrawScale(undefined, false, 16, 1.5)).toBe(1.5);
		expect(placeholderDrawScale(0.5, false, 16, 1.5)).toBe(0.5 * 1.5);
		const cell = min / 4;
		expect(placeholderDrawScale(undefined, true, cell, 1.5)).toBe((min / cell) * 1.5);
		expect(placeholderDrawScale(2, false, 16, 1)).toBe(placeholderDrawScale(2, false, 16));
	});
});

describe("rollTumbleTurn", () => {
	it("runs from 0 at the roll's first tick to 1 at its end", () => {
		expect(rollTumbleTurn(ROLL_TICKS, 0)).toBe(0);
		expect(rollTumbleTurn(0, 0)).toBe(1);
		expect(rollTumbleTurn(ROLL_TICKS, 1)).toBe(1 / ROLL_TICKS);
		expect(rollTumbleTurn(1, 0)).toBe((ROLL_TICKS - 1) / ROLL_TICKS);
	});

	it("never goes back as the countdown falls and alpha rises", () => {
		let last = -1;
		for (let ticks = ROLL_TICKS; ticks >= 1; ticks--) {
			for (const alpha of [0, 0.25, 0.5, 0.75]) {
				const t = rollTumbleTurn(ticks, alpha);
				expect(t).toBeGreaterThanOrEqual(last);
				last = t;
			}
		}
		expect(last).toBeLessThan(1);
	});

	it("is clamped to 0..1", () => {
		expect(rollTumbleTurn(ROLL_TICKS + 5, 0)).toBe(0); // a countdown longer than ROLL_TICKS
		expect(rollTumbleTurn(0, 0.5)).toBe(1);
		expect(rollTumbleTurn(-1, 0)).toBe(1);
	});
});
