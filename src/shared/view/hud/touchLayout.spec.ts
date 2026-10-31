// The touch controls' layout fits every test screen (docs/MOBILE.md MB2): on screen, apart, below the HUD panels,
// big enough, the move zone clear of the buttons, and the left-handed layout the mirror of the right-handed one; the
// cluster packed into its corner (owner 2026-10-31), the move stick resting in the other.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TOUCH } from "shared/config";
import { HUD_SCALE_PERCENTS } from "shared/settings";
import { pauseButtonSlot } from "shared/view/menu";
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
	touchStrip,
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

	it("takes the compact cluster under the corner panels where the usual one cannot keep clear at minScale", () => {
		// The 844 x 390 phone under the top bar and the home indicator at 125 %: the score panel's box takes the top of
		// the action corner.
		const r = touchLayout(844, 390, 844, 390 - HUD_TEST_TOP_INSET - 21, 125, PERCENT, false, "play");
		expect(r.variant).toBe("compact");
		expect(r.clear).toBe(true);
		expect(r.scale >= TOUCH_LAYOUT.minScale - EPS).toBe(true);
	});

	it("keeps the usual cluster at the HUD scale where it fits its corner (the tablet)", () => {
		const v = { x: 1024, y: 768 };
		const r = touchLayout(v.x, v.y, v.x, v.y - HUD_TEST_TOP_INSET, PERCENT, PERCENT, false, "play");
		expect(r.variant).toBe("play");
		expect(r.scale).toBeCloseTo(r.hudScale, 6);
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

/** The corner spec's screens (pt): a small iPhone and the owner's phone, the reference phone, a tablet. */
const CORNER_SCREENS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
	{ x: 667, y: 308 },
	{ x: 693, y: 320 },
	{ x: 844, y: 390 },
	{ x: 1024, y: 768 },
];
/** Safe-area insets (pt): none; an iPhone's notches, top bar and home indicator; the owner's Android phone's. */
const CORNER_INSETS: ReadonlyArray<{ readonly side: number; readonly top: number; readonly bottom: number }> = [
	{ side: 0, top: 0, bottom: 0 },
	{ side: 47, top: HUD_TEST_TOP_INSET, bottom: 21 },
	{ side: 49, top: HUD_TEST_TOP_INSET, bottom: 0 },
];
/** The action cluster's box from its corner, as shares of the safe area (owner: <= 45 % wide, <= 75 % tall). */
const CORNER_BOX_W = 0.45;
const CORNER_BOX_H = 0.75;
/** The widest gap (pt) from any control of the cluster to its nearest neighbour ("a few pt"). */
const NEIGHBOUR_GAP_MAX = 6;
/** The move stick's idle ring: at most this far (pt) from both safe edges of its corner. */
const MOVE_HOME_EDGE_MAX = 12;
const THIRD = 1 / 3;
/** The strip's content for its footprint (a full run: hearts, pips, flask, Ember, a six-digit score). */
const STRIP_CONTENT = { heartsMax: 10, ghost: false, pips: 2, flaskMax: 3, emberMax: 3, scoring: true, score: 123456 };

/** The touch strip's footprint in the touch safe area (docs/UI_ART.md "Phones"), the top bar `x` .. the safe right. */
function stripBoxes(vw: number, vh: number, percent: number, side: number, top: number, bottom: number): ScreenRect[] {
	const safe = { x: side, y: top, w: vw - side * 2, h: vh - top - bottom };
	// Roblox's buttons end ~208 pt after the side inset (TopbarInset.Min.X); a bar only when there is one (top > 0).
	const bar = top > 0 ? { x: side + 208, y: 0, w: vw - side * 2 - 208, h: top } : { x: 0, y: 0, w: 0, h: 0 };
	const r = touchStrip(
		{
			viewportW: vw,
			viewportH: vh,
			hudPercent: percent,
			safe,
			topbar: bar,
			reserveLeft: pauseButtonSlot(bar, true).reserveLeft,
		},
		STRIP_CONTENT,
	);
	return r.footprint.map((b) => ({ x: b.x - safe.x, y: b.y - safe.y, w: b.w, h: b.h }));
}

/** Edge-to-edge gap (px) between two circles. */
function circleGap(a: TouchPoint, b: TouchPoint): number {
	return math.sqrt((a.cx - b.cx) * (a.cx - b.cx) + (a.cy - b.cy) * (a.cy - b.cy)) - a.r - b.r;
}

describe("touch controls in the corners", () => {
	it("packs the cluster into its corner and rests the move stick in the other: phones and a tablet, both hands, HUD 70-125 %", () => {
		for (const v of CORNER_SCREENS) {
			for (const ins of CORNER_INSETS) {
				const safeW = v.x - ins.side * 2;
				const safeH = v.y - ins.top - ins.bottom;
				for (const percent of HUD_SCALE_PERCENTS) {
					// The touch HUD: the strip in the top bar (it replaces the corner panels, whose boxes the specs above
					// keep the controls clear of before it mounts; on a short phone those leave no corner room).
					const boxes = stripBoxes(v.x, v.y, percent, ins.side, ins.top, ins.bottom);
					for (const size of SIZE_PERCENTS) {
						for (const hand of HANDS) {
							for (const mode of MODES) {
								const where = string.format(
									"%dx%d side %d top %d bottom %d hud %d size %d %s %s",
									v.x,
									v.y,
									ins.side,
									ins.top,
									ins.bottom,
									percent,
									size,
									hand ? "left" : "right",
									mode,
								);
								const r = touchLayout(
									v.x,
									v.y,
									safeW,
									safeH,
									percent,
									size,
									hand,
									mode,
									undefined,
									boxes,
								);
								expectOk(where, "clear", r.clear);
								expectOk(where, "in its corner", r.inCorner);
								// Distances inward from the action side's edge (right, or left when left-handed).
								const inward = (p: TouchPoint) => (hand ? p.cx : safeW - p.cx);
								let boxW = 0;
								let boxH = 0;
								for (const b of r.buttons) {
									if (b.id === "spectatePrev") continue;
									boxW = math.max(boxW, inward(b) + b.r);
									boxH = math.max(boxH, safeH - b.cy + b.r);
								}
								expectOk(where, "cluster box width", boxW <= CORNER_BOX_W * safeW + EPS);
								expectOk(where, "cluster box height", boxH <= CORNER_BOX_H * safeH + EPS);
								// No centre in the screen's middle third (the safe area sits between equal side insets).
								for (const p of allPoints(r)) {
									const x = ins.side + p.cx;
									expectOk(
										where,
										"out of the middle third",
										x <= v.x * THIRD + EPS || x >= v.x * (1 - THIRD) - EPS,
									);
								}
								if (mode === "play") {
									// Packed: every button's nearest neighbour a few pt away (and not overlapping).
									for (const b of r.buttons) {
										let nearest = math.huge;
										for (const o of r.buttons)
											if (o !== b) nearest = math.min(nearest, circleGap(b, o));
										expectOk(
											where,
											`${b.id} packed`,
											nearest >= -EPS && nearest <= NEIGHBOUR_GAP_MAX,
										);
									}
									const home = r.moveHome!;
									const fromSide = hand ? safeW - home.cx : home.cx;
									expectOk(
										where,
										"move home by its side edge",
										fromSide - home.r <= MOVE_HOME_EDGE_MAX,
									);
									expectOk(
										where,
										"move home by the bottom",
										safeH - home.cy - home.r <= MOVE_HOME_EDGE_MAX,
									);
								}
							}
						}
					}
				}
			}
		}
	});

	it("prints the cluster per screen (pt from the safe area's top left; docs/MOBILE.md)", () => {
		const lines: string[] = [];
		for (const v of [CORNER_SCREENS[0], CORNER_SCREENS[1], CORNER_SCREENS[2]]) {
			for (const ins of [CORNER_INSETS[0], CORNER_INSETS[2]]) {
				const safeW = v.x - ins.side * 2;
				const safeH = v.y - ins.top - ins.bottom;
				const boxes = stripBoxes(v.x, v.y, PERCENT, ins.side, ins.top, ins.bottom);
				for (const hand of HANDS) {
					const r = touchLayout(v.x, v.y, safeW, safeH, PERCENT, PERCENT, hand, "play", undefined, boxes);
					let line = string.format(
						"%dx%d side %d top %d %s: %s x%.3f (safe %dx%d)",
						v.x,
						v.y,
						ins.side,
						ins.top,
						hand ? "left" : "right",
						r.variant,
						r.scale,
						safeW,
						safeH,
					);
					for (const b of r.buttons) line += string.format(" %s (%.0f, %.0f) r%.1f", b.id, b.cx, b.cy, b.r);
					const h = r.moveHome!;
					line += string.format(" move (%.0f, %.0f) r%.1f", h.cx, h.cy, h.r);
					lines.push(line);
				}
			}
		}
		print(`[touchLayout]\n${lines.join("\n")}`);
		expect(lines.size() > 0).toBe(true);
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
