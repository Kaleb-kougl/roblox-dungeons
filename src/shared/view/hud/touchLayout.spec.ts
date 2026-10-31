// The touch controls' layout fits every test screen (docs/MOBILE.md MB2): on screen, apart, below the HUD panels,
// big enough, the move zone clear of the buttons, and the left-handed layout the mirror of the right-handed one.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TOUCH } from "shared/config";
import { HUD_SCALE_PERCENTS } from "shared/settings";
import {
	HUD_FOOTPRINT,
	HUD_TEST_TOP_INSET,
	TOUCH_ALWAYS_ON_PANELS,
	TOUCH_LAYOUT,
	TOUCH_TEST_VIEWPORTS,
	computeHudScale,
	cornerRect,
	pickTouchTarget,
	touchControlsClear,
	touchLayout,
	touchPanelKeepOut,
} from ".";
import type { ScreenRect, TouchCircle, TouchLayoutMode, TouchLayoutResult, TouchPoint } from ".";

const PERCENT = 100;
const SIZE_PERCENTS: ReadonlyArray<number> = [80, 100, 120];
const HUD_PERCENTS: ReadonlyArray<number> = HUD_SCALE_PERCENTS.filter((p) => p <= PERCENT);
const INSETS: ReadonlyArray<number> = [0, HUD_TEST_TOP_INSET];
const HANDS: ReadonlyArray<boolean> = [false, true];
const MODES: ReadonlyArray<TouchLayoutMode> = ["play", "spectate"];
const MIN_MOVE_ZONE_SHARE = 0.3;
const TOP_SLACK = 0.5;
const EPS = 0.001;

function allPoints(r: TouchLayoutResult): TouchPoint[] {
	const out: TouchPoint[] = [];
	for (const b of r.buttons) out.push(b);
	if (r.moveHome !== undefined) out.push(r.moveHome);
	return out;
}

function insideRect(p: TouchPoint, w: number, h: number): boolean {
	return p.cx - p.r >= 0 && p.cx + p.r <= w && p.cy - p.r >= 0 && p.cy + p.r <= h;
}

function circleHitsRect(p: TouchPoint, z: ScreenRect): boolean {
	const nx = math.clamp(p.cx, z.x, z.x + z.w);
	const ny = math.clamp(p.cy, z.y, z.y + z.h);
	const dx = p.cx - nx;
	const dy = p.cy - ny;
	return dx * dx + dy * dy < p.r * p.r;
}

/** `left` is `right` mirrored across a safe area `w` px wide (same ids, sizes and heights). */
function mirrored(right: TouchLayoutResult, left: TouchLayoutResult, w: number): boolean {
	if (right.buttons.size() !== left.buttons.size()) return false;
	for (let i = 0; i < right.buttons.size(); i++) {
		const a = right.buttons[i];
		const b = left.buttons[i];
		if (a.id !== b.id || math.abs(b.cx - (w - a.cx)) > EPS || math.abs(b.cy - a.cy) > EPS) return false;
		if (math.abs(b.r - a.r) > EPS) return false;
	}
	if (right.moveHome === undefined || left.moveHome === undefined) return right.moveHome === left.moveHome;
	const a = right.moveHome;
	const b = left.moveHome;
	return math.abs(b.cx - (w - a.cx)) <= EPS && math.abs(b.cy - a.cy) <= EPS && math.abs(b.r - a.r) <= EPS;
}

/** Distance (px) from a circle's edge to a rect (negative: they overlap). */
function edgeGap(p: TouchPoint, z: ScreenRect): number {
	const nx = math.clamp(p.cx, z.x, z.x + z.w);
	const ny = math.clamp(p.cy, z.y, z.y + z.h);
	return math.sqrt((p.cx - nx) * (p.cx - nx) + (p.cy - ny) * (p.cy - ny)) - p.r;
}

/**
 * Every point keeps TOUCH_LAYOUT.clusterGap (at the touch HUD scale) from the status / score panels' budget boxes,
 * placed from HUD_FOOTPRINT here (independently of touchPanelKeepOut) in a safe area `safeW` x `safeH`.
 */
function clearOfPanels(
	points: ReadonlyArray<TouchPoint>,
	vw: number,
	vh: number,
	percent: number,
	safeW: number,
	safeH: number,
): boolean {
	const hudScale = computeHudScale(vw, vh, false, percent, true);
	const gap = TOUCH_LAYOUT.clusterGap * hudScale;
	for (const panel of TOUCH_ALWAYS_ON_PANELS) {
		const b = HUD_FOOTPRINT[panel];
		const box = cornerRect(b.corner, b.maxW, b.maxH, safeW, safeH, hudScale);
		for (const p of points) if (edgeGap(p, box) < gap - TOP_SLACK) return false;
	}
	return true;
}

function expectOk(where: string, name: string, ok: boolean): void {
	const label = `${where}: ${name}`;
	expect([label, ok]).toEqual([label, true]);
}

describe("touch controls layout", () => {
	it("fits every test screen: on screen, apart, below the HUD panels, big enough, mirrored when left-handed", () => {
		for (const v of TOUCH_TEST_VIEWPORTS) {
			for (const inset of INSETS) {
				const safeW = v.x;
				const safeH = v.y - inset;
				for (const percent of HUD_PERCENTS) {
					for (const size of SIZE_PERCENTS) {
						for (const hand of HANDS) {
							for (const mode of MODES) {
								const where = string.format(
									"%dx%d top %d hud %d size %d %s %s",
									v.x,
									v.y,
									inset,
									percent,
									size,
									hand ? "left" : "right",
									mode,
								);
								const r = touchLayout(v.x, v.y, safeW, safeH, percent, size, hand, mode);
								const points = allPoints(r);

								// 1. Every circle lies inside the safe rect.
								expectOk(
									where,
									"inside",
									points.every((p) => insideRect(p, safeW, safeH)),
								);

								// 2. No two circles overlap.
								let apart = true;
								for (let i = 0; i < points.size(); i++) {
									for (let j = i + 1; j < points.size(); j++) {
										const a = points[i];
										const b = points[j];
										const d = math.sqrt(
											(a.cx - b.cx) * (a.cx - b.cx) + (a.cy - b.cy) * (a.cy - b.cy),
										);
										if (d < a.r + b.r - EPS) apart = false;
									}
								}
								expectOk(where, "apart", apart);

								// 3. No circle comes within the gap of a corner panel's box (checked from footprint, not keepOut).
								expectOk(
									where,
									"clear of the corner panels",
									clearOfPanels(points, v.x, v.y, percent, safeW, safeH),
								);
								expectOk(where, "reported clear", r.clear);

								// 4. Play mode: the move zone is clear of every button and at least 30 % of the width.
								if (mode === "play" && r.moveZone !== undefined) {
									const zone = r.moveZone;
									expectOk(
										where,
										"move zone clear of buttons",
										r.buttons.every((b) => !circleHitsRect(b, zone)),
									);
									expectOk(where, "move zone wide enough", zone.w >= MIN_MOVE_ZONE_SHARE * safeW);
								}

								// 5. Every circle is big enough to hit.
								expectOk(
									where,
									"diameter",
									points.every((p) => 2 * p.r >= TOUCH_LAYOUT.minDiameterPx),
								);

								// 6. Left-handed is the mirror of right-handed.
								if (!hand) {
									const left = touchLayout(v.x, v.y, safeW, safeH, percent, size, true, mode);
									expectOk(where, "left-handed mirror", mirrored(r, left, safeW));
								}

								// 7. The stick radius scales with the controls.
								expectOk(where, "stick radius", r.stickRadiusPx === TOUCH.stickRadiusRef * r.scale);
							}
						}
					}
				}
			}
		}
	});
});

/** The phones the owner plays on (docs/MOBILE.md: the 844 x 390 reference and the 667 x 375 small one). */
const REFERENCE_PHONES: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
	{ x: 844, y: 390 },
	{ x: 667, y: 375 },
];
/** A phone's safe-area insets (pt): the Roblox top bar, the home indicator, a notch on each side. */
const TOP_INSETS: ReadonlyArray<number> = [0, HUD_TEST_TOP_INSET];
const BOTTOM_INSETS: ReadonlyArray<number> = [0, 21];
const SIDE_INSETS: ReadonlyArray<number> = [0, 47];

describe("touch controls and the corner panels", () => {
	it("never overlap on the reference phones: every HUD scale (110 / 125 % too), size, inset, hand and mode", () => {
		for (const v of REFERENCE_PHONES) {
			for (const top of TOP_INSETS) {
				for (const bottom of BOTTOM_INSETS) {
					for (const side of SIDE_INSETS) {
						const safeW = v.x - side * 2;
						const safeH = v.y - top - bottom;
						for (const percent of HUD_SCALE_PERCENTS) {
							for (const size of SIZE_PERCENTS) {
								for (const hand of HANDS) {
									for (const mode of MODES) {
										const where = string.format(
											"%dx%d top %d bottom %d side %d hud %d size %d %s %s",
											v.x,
											v.y,
											top,
											bottom,
											side,
											percent,
											size,
											hand ? "left" : "right",
											mode,
										);
										const r = touchLayout(v.x, v.y, safeW, safeH, percent, size, hand, mode);
										const points = allPoints(r);
										expectOk(where, "clear", r.clear);
										expectOk(
											where,
											"panels",
											clearOfPanels(points, v.x, v.y, percent, safeW, safeH),
										);
										expectOk(
											where,
											"inside",
											points.every((p) => insideRect(p, safeW, safeH)),
										);
										expectOk(
											where,
											"diameter",
											points.every((p) => 2 * p.r >= TOUCH_LAYOUT.minDiameterPx),
										);
									}
								}
							}
						}
					}
				}
			}
		}
	});

	it("used to overlap: the 844 x 390 phone under the top bar and the home indicator at 125 % takes the compact cluster", () => {
		const r = touchLayout(844, 390, 844, 390 - HUD_TEST_TOP_INSET - 21, 125, PERCENT, false, "play");
		expect(r.variant).toBe("compact");
		expect(r.scale >= TOUCH_LAYOUT.minScale - EPS).toBe(true);
		// The old rule (the full-width band, clamped at minScale) put Ember into the score panel's box here.
		const band = r.topBand;
		const oldEmberTop = 390 - HUD_TEST_TOP_INSET - 21 - (260 + 38) * TOUCH_LAYOUT.minScale;
		expect(oldEmberTop < band).toBe(true);
	});

	it("keeps the usual cluster, and the old scale, wherever it fit before", () => {
		const v = TOUCH_TEST_VIEWPORTS[1];
		const r = touchLayout(v.x, v.y, v.x, v.y - HUD_TEST_TOP_INSET, PERCENT, PERCENT, false, "play");
		expect(r.variant).toBe("play");
		const old = (v.y - HUD_TEST_TOP_INSET - r.topBand) / (260 + 38);
		expect(r.scale).toBeCloseTo(math.max(TOUCH_LAYOUT.minScale, math.min(r.hudScale, old)), 5);
	});

	it("follows the HUD's own frame when it sits lower than the touch safe area", () => {
		const v = TOUCH_TEST_VIEWPORTS[1];
		const safeH = v.y - 21;
		const hud = { x: 0, y: HUD_TEST_TOP_INSET, w: v.x, h: safeH - HUD_TEST_TOP_INSET };
		const r = touchLayout(v.x, v.y, v.x, safeH, PERCENT, PERCENT, false, "play", hud);
		const keepOut = touchPanelKeepOut(v.x, v.y, PERCENT, hud);
		expect(r.clear).toBe(true);
		expect(touchControlsClear(allPoints(r), keepOut, v.x, safeH)).toBe(true);
		for (const z of r.keepOut) expect(z.y + z.h > HUD_TEST_TOP_INSET).toBe(true);
	});
});

describe("pickTouchTarget", () => {
	const VIEW = TOUCH_TEST_VIEWPORTS[1];
	const layout = touchLayout(VIEW.x, VIEW.y, VIEW.x, VIEW.y, PERCENT, PERCENT, false, "play");
	function button(id: string): TouchCircle {
		const b = layout.buttons.find((c) => c.id === id);
		if (b === undefined) error(`no ${id}`, 0);
		return b;
	}
	const attack = button("attack");
	const alt = button("alt");

	it("Attack's and Alt's hit squares overlap (why one touch can fire InputBegan on both)", () => {
		const overlapX =
			math.min(attack.cx + attack.r, alt.cx + alt.r) - math.max(attack.cx - attack.r, alt.cx - alt.r);
		const overlapY =
			math.min(attack.cy + attack.r, alt.cy + alt.r) - math.max(attack.cy - attack.r, alt.cy - alt.r);
		expect(overlapX > 0 && overlapY > 0).toBe(true);
	});

	it("gives a touch in both squares to exactly one control, whatever the event order", () => {
		// A point inside both squares (outside both circles), Attack's centre and a point inside Alt's circle.
		const cornerX = alt.cx + alt.r - 1;
		const cornerY = attack.cy - attack.r + 1;
		const first = pickTouchTarget(layout, ["attack", "alt"], cornerX, cornerY);
		expect(pickTouchTarget(layout, ["alt", "attack"], cornerX, cornerY)).toBe(first);
		expect(pickTouchTarget(layout, ["alt", "attack"], attack.cx, attack.cy)).toBe("attack");
		expect(pickTouchTarget(layout, ["attack", "alt"], alt.cx + alt.r * 0.6, alt.cy + alt.r * 0.6)).toBe("alt");
	});

	it("keeps a single candidate as it is", () => {
		expect(pickTouchTarget(layout, ["roll"], 0, 0)).toBe("roll");
		expect(pickTouchTarget(layout, ["move"], 0, 0)).toBe("move");
		expect(pickTouchTarget(layout, [], 0, 0)).toBe(undefined);
	});
});
