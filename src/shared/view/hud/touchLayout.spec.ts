// The touch controls' layout fits every test screen (docs/MOBILE.md MB2): on screen, apart, below the HUD panels,
// big enough, the move zone clear of the buttons, and the left-handed layout the mirror of the right-handed one.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TOUCH } from "shared/config";
import { HUD_SCALE_PERCENTS } from "shared/settings";
import { HUD_TEST_TOP_INSET, TOUCH_LAYOUT, TOUCH_TEST_VIEWPORTS, pickTouchTarget, touchLayout } from ".";
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

								// 3. Every circle's top is below the corner panels' band.
								expectOk(
									where,
									"below the HUD band",
									points.every((p) => p.cy - p.r >= r.topBand - TOP_SLACK),
								);

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
