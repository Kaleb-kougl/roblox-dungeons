// The in-run HUD on a phone held upright (docs/PORTRAIT.md PT7): the HUD scale cap, every top-centre transient on
// touch inside the width, the touch strip inside the safe area, the draft column on screen; landscape unchanged.
import { describe, expect, it } from "@rbxts/jest-globals";
import { HUD_SCALE_PERCENTS } from "shared/settings";
import { DRAFT_OFFER_COUNT } from "shared/sim";
import { pauseButtonSlot } from "shared/view/menu";
import {
	HUD_TEST_TOP_INSET,
	HUD_TRANSIENT,
	HUD_VIEW,
	PROGRESSION_VIEW,
	SPECTATE_BAR_VIEW,
	TOUCH_STRIP,
	TOUCH_TUTORIAL_BOX,
	computeHudScale,
	touchStrip,
} from ".";

const PERCENT = 100;
const EPS = 1e-6;
/** Upright phones (pt), the smallest first. */
const UPRIGHT: ReadonlyArray<readonly [number, number]> = [
	[320, 568],
	[360, 640],
	[375, 667],
	[360, 800],
	[390, 844],
	[430, 932],
];
const LANDSCAPE: ReadonlyArray<readonly [number, number]> = [
	[667, 375],
	[844, 390],
	[1280, 720],
	[1920, 1080],
	[1024, 768],
];
/** Every top-centre bar the touch HUD can show, reference px wide. */
const TOP_CENTRE_WIDTHS: ReadonlyArray<readonly [string, number]> = [
	["slim boss bar", TOUCH_STRIP.boss.width],
	["toasts", PROGRESSION_VIEW.toastWidth],
	["spectate bar", SPECTATE_BAR_VIEW.width],
	["touch tutorial prompt", TOUCH_TUTORIAL_BOX.width],
	["room clear", HUD_TRANSIENT.roomClear.width],
];
const STRIP_CONTENT = { heartsMax: 10, ghost: false, pips: 2, flaskMax: 3, emberMax: 3, scoring: true, score: 123456 };

describe("the HUD upright on touch (docs/PORTRAIT.md PT7)", () => {
	it("every top-centre bar plus its margins fits touchUprightWidth", () => {
		for (const [name, w] of TOP_CENTRE_WIDTHS)
			expect([name, w + 2 * HUD_VIEW.margin <= HUD_VIEW.touchUprightWidth]).toEqual([name, true]);
	});

	it("caps the scale so touchUprightWidth fits the width, at every HUD scale setting", () => {
		for (const [w, h] of UPRIGHT) {
			for (const percent of HUD_SCALE_PERCENTS) {
				const u = computeHudScale(w, h, false, percent, true);
				expect([w, h, percent, HUD_VIEW.touchUprightWidth * u <= w + EPS]).toEqual([w, h, percent, true]);
				for (const [name, bar] of TOP_CENTRE_WIDTHS) {
					const fits = (bar + 2 * HUD_VIEW.margin) * u <= w + EPS;
					expect([w, h, percent, name, fits]).toEqual([w, h, percent, name, true]);
				}
			}
		}
	});

	it("keeps 100 % at the touch floor on every phone but the 320 pt one", () => {
		for (const [w, h] of UPRIGHT) {
			const u = computeHudScale(w, h, false, PERCENT, true);
			if (w >= 360) expect(u).toBe(HUD_VIEW.touchMinScale);
			else expect(u).toBeCloseTo(w / HUD_VIEW.touchUprightWidth, 9);
		}
	});

	it("changes nothing in landscape or without touch", () => {
		for (const [w, h] of LANDSCAPE) {
			for (const percent of HUD_SCALE_PERCENTS) {
				const s = math.min(w / HUD_VIEW.referenceSize.x, h / HUD_VIEW.referenceSize.y);
				const want = math.clamp(s, HUD_VIEW.touchMinScale, HUD_VIEW.maxScale) * (percent / PERCENT);
				expect(computeHudScale(w, h, false, percent, true)).toBe(want);
			}
		}
		for (const [w, h] of UPRIGHT) {
			const s = math.min(w / HUD_VIEW.referenceSize.x, h / HUD_VIEW.referenceSize.y);
			expect(computeHudScale(w, h, false, PERCENT, false)).toBe(
				math.clamp(s, HUD_VIEW.minScale, HUD_VIEW.maxScale),
			);
		}
	});

	it("the touch strip stays inside the safe area, in the top bar or under it", () => {
		for (const [w, h] of UPRIGHT) {
			for (const top of [0, HUD_TEST_TOP_INSET]) {
				const safe = { x: 0, y: top, w, h: h - top };
				// Roblox's buttons end ~208 pt after the side inset in landscape; upright assume the same.
				const bar = top > 0 ? { x: 208, y: 0, w: w - 208, h: top } : { x: 0, y: 0, w: 0, h: 0 };
				for (const percent of HUD_SCALE_PERCENTS) {
					const r = touchStrip(
						{
							viewportW: w,
							viewportH: h,
							hudPercent: percent,
							safe,
							topbar: bar,
							reserveLeft: pauseButtonSlot(bar, true).reserveLeft,
						},
						STRIP_CONTENT,
					);
					for (const b of r.footprint) {
						const inside = b.x >= -EPS && b.x + b.w <= w + EPS && b.y >= -EPS && b.y + b.h <= h + EPS;
						expect([w, h, top, percent, inside]).toEqual([w, h, top, percent, true]);
					}
				}
			}
		}
	});

	it("the draft column (three cards, the title and the hint) fits every phone", () => {
		const column =
			PROGRESSION_VIEW.cardHeight * DRAFT_OFFER_COUNT +
			HUD_VIEW.gap * (DRAFT_OFFER_COUNT - 1) +
			HUD_VIEW.bigText +
			2 * HUD_VIEW.textSize +
			HUD_VIEW.smallText +
			PROGRESSION_VIEW.cardGap * 6;
		const width = PROGRESSION_VIEW.cardWidth + PROGRESSION_VIEW.cardGap * 2;
		for (const [w, h] of UPRIGHT) {
			for (const percent of HUD_SCALE_PERCENTS) {
				const u = computeHudScale(w, h, false, percent, true);
				expect([w, h, percent, width * u <= w, column * u <= h - HUD_TEST_TOP_INSET]).toEqual([
					w,
					h,
					percent,
					true,
					true,
				]);
			}
		}
	});
});
