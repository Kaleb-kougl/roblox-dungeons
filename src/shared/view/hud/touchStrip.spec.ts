// The touch HUD strip (docs/UI_ART.md "Phones", owner 2026-10-30): one slim row in the Roblox top bar right of its
// buttons and the pause button, a chips line under it, the slim boss bar's slot under that; collapsing when narrow;
// the touch controls keep clear of it and get the corner panels' old room back.
import { describe, expect, it } from "@rbxts/jest-globals";
import { HUD_SCALE_PERCENTS } from "shared/settings";
import { PAUSE_BUTTON_VIEW } from "shared/view/menu";
import {
	HUD_TRANSIENT,
	HUD_VIEW,
	PROGRESSION_VIEW,
	SPECTATE_BAR_VIEW,
	TOUCH_LAYOUT,
	TOUCH_STRIP,
	TOUCH_TUTORIAL_BOX,
	digitCount,
	fitArt,
	heartsCountText,
	rectsOverlap,
	touchControlsClear,
	touchCornerBoxesHeight,
	touchLayout,
	touchStrip,
	touchStripKeepOut,
	touchStripSlots,
	touchStripWidths,
} from ".";
import type { ScreenRect, TouchPoint, TouchStripArt, TouchStripContent, TouchStripGeometry, TouchStripLayout } from ".";

const PERCENT = 100;
const EPS = 1e-6;

/**
 * A landscape screen (pt) and its insets: the Roblox top bar (TOP_BAR tall, its own buttons end `buttons` pt from the
 * left: the Roblox icon and the menu / chat / voice pill, ~208 pt after the side inset), the side notches and the home
 * indicator.
 */
interface Screen {
	readonly name: string;
	readonly w: number;
	readonly h: number;
	readonly side: number;
	readonly bottom: number;
}
const TOP_BAR = 58;
const BUTTONS = 208;

/** The owner's phone (693-714 x 320-330), the small and the reference iPhone, a big phone and a tablet. */
const SCREENS: ReadonlyArray<Screen> = [
	{ name: "phone 693x320", w: 693, h: 320, side: 49, bottom: 21 },
	{ name: "phone 714x330", w: 714, h: 330, side: 49, bottom: 21 },
	{ name: "phone 667x375", w: 667, h: 375, side: 0, bottom: 0 },
	{ name: "phone 844x390", w: 844, h: 390, side: 47, bottom: 21 },
	{ name: "tablet 1024x768", w: 1024, h: 768, side: 0, bottom: 20 },
];
const HANDS: ReadonlyArray<boolean> = [false, true];
const SIZES: ReadonlyArray<number> = [80, 100, 120];

/** The vale pack's art sizes (packs/vale uiIconLayout: heart, full flask, candle, coin, chip). */
const VALE_ART: TouchStripArt = {
	heart: { w: 18, h: 15 },
	flask: { w: 18, h: 23 },
	candle: { w: 17, h: 19 },
	coin: { w: 5, h: 6 },
	pip: { w: 10, h: 10 },
};
const LOOKS: ReadonlyArray<readonly [string, TouchStripArt | undefined]> = [
	["flat", undefined],
	["art", VALE_ART],
];

function content(art: TouchStripArt | undefined, over: Partial<TouchStripContent> = {}): TouchStripContent {
	return {
		heartsMax: 6,
		ghost: false,
		pips: 1,
		flaskMax: 3,
		emberMax: 3,
		scoring: true,
		score: 2158,
		art,
		...over,
	};
}

function safeOf(sc: Screen): ScreenRect {
	return { x: sc.side, y: TOP_BAR, w: sc.w - sc.side * 2, h: sc.h - TOP_BAR - sc.bottom };
}

function geometry(sc: Screen, percent: number, topbar = true): TouchStripGeometry {
	const x = sc.side + BUTTONS;
	return {
		viewportW: sc.w,
		viewportH: sc.h,
		hudPercent: percent,
		safe: safeOf(sc),
		topbar: topbar ? { x, y: 0, w: sc.w - sc.side - x, h: TOP_BAR } : { x: 0, y: 0, w: 0, h: 0 },
		reserveLeft: PAUSE_BUTTON_VIEW.gap + PAUSE_BUTTON_VIEW.size,
	};
}

/** A screen-px rect moved into the touch safe area's space (its origin is the safe area's top left). */
function toSafe(r: ScreenRect, safe: ScreenRect): ScreenRect {
	return { x: r.x - safe.x, y: r.y - safe.y, w: r.w, h: r.h };
}

function expectOk(where: string, name: string, ok: boolean): void {
	const label = `${where}: ${name}`;
	expect([label, ok]).toEqual([label, true]);
}

/** A top-centre transient's rect in KV_GameHud (screen px): `edge` reference px under the safe area's top. */
function hudTopCentre(safe: ScreenRect, hud: number, edge: number, width: number, height: number): ScreenRect {
	const w = width * hud;
	return { x: safe.x + (safe.w - w) / 2, y: safe.y + edge * hud, w, h: height * hud };
}

function bottomOf(r: ScreenRect): number {
	return r.y + r.h;
}

describe("touch strip: layout helpers", () => {
	it("counts digits and writes the collapsed hearts", () => {
		expect(digitCount(0)).toBe(1);
		expect(digitCount(9)).toBe(1);
		expect(digitCount(10)).toBe(2);
		expect(digitCount(1234567)).toBe(7); // check-asset-ids: allow (a 7-digit score)
		expect(heartsCountText(6)).toBe("3");
		expect(heartsCountText(5)).toBe("2.5");
		expect(heartsCountText(0)).toBe("0");
	});

	it("fits the art into its box at whole screen px per art px (fitArt), flat stand-ins otherwise", () => {
		const flat = touchStripSlots(undefined, 0.75);
		expect(flat.heart.w).toBe(TOUCH_STRIP.iconBox);
		expect(flat.flask.w).toBe(TOUCH_STRIP.flatIcon);
		const art = touchStripSlots(VALE_ART, 0.75);
		// 18 x 15 heart in a 24 box at UIScale 0.75 (18 screen px): 1 screen px per art px, exactly the box.
		expect(art.heart.w).toBeCloseTo(TOUCH_STRIP.iconBox, 6);
		expect(art.heart.h).toBeCloseTo(TOUCH_STRIP.iconBox, 6);
		// The 5 x 6 coin draws at 3 screen px per art px there.
		expect(art.coin.w).toBeCloseTo(fitArt(5, 6, TOUCH_STRIP.iconBox, TOUCH_STRIP.iconBox, 0.75).w, 6);
		expect(fitArt(5, 6, TOUCH_STRIP.iconBox, TOUCH_STRIP.iconBox, 0.75).scale).toBe(3);
	});

	it("drops the multiplier's text before anything else, then collapses the hearts", () => {
		const c = content(undefined);
		const slots = touchStripSlots(undefined, 1);
		const full = touchStripWidths(c, slots, true, false);
		const noMult = touchStripWidths(c, slots, false, false);
		const counted = touchStripWidths(content(undefined, { heartsMax: 20 }), slots, false, true);
		const icons = touchStripWidths(content(undefined, { heartsMax: 20 }), slots, false, false);
		expect(noMult.total < full.total).toBe(true);
		expect(noMult.hearts).toBe(full.hearts);
		expect(counted.hearts < icons.hearts).toBe(true);
		// Unscored runs (M1): no score group at all.
		expect(touchStripWidths(content(undefined, { scoring: false }), slots, true, false).score).toBe(0);
	});
});

describe("touch strip: every screen, HUD scale and look", () => {
	it("sits in the top bar right of the pause button, inside the safe area's sides, its content inside its width", () => {
		for (const sc of SCREENS) {
			for (const percent of HUD_SCALE_PERCENTS) {
				for (const [look, art] of LOOKS) {
					const where = `${sc.name} hud ${percent} ${look}`;
					const geo = geometry(sc, percent);
					const r = touchStrip(geo, content(art));
					const safe = geo.safe;
					expectOk(where, "in the top bar", r.placement === "topBar");
					expectOk(where, "right of the pause button", r.strip.x >= geo.topbar.x + geo.reserveLeft - EPS);
					expectOk(where, "inside the safe sides", r.strip.x + r.strip.w <= safe.x + safe.w + EPS);
					expectOk(where, "content fits", r.widths.total <= r.maxWidth + EPS);
					expectOk(where, "row in the bar", r.strip.y >= 0 && r.strip.y < TOP_BAR);
					expectOk(where, "boss under the chips", r.boss.y >= bottomOf(r.chips) - EPS);
					expectOk(where, "boss in the safe area", r.boss.y >= safe.y);
					// The touch tutorial prompt (top centre) starts under the boss slot and the stamp's.
					const tutorial = hudTopCentre(safe, r.hudScale, r.belowTop, TOUCH_TUTORIAL_BOX.width, 1);
					expectOk(where, "tutorial under the boss slot", tutorial.y >= bottomOf(r.boss) - EPS);
					expectOk(where, "tutorial off the strip", !rectsOverlap(tutorial, r.group));
				}
			}
		}
	});

	it("keeps the transients off the strip: stamp, chips, toasts, the spectate bar", () => {
		for (const sc of SCREENS) {
			for (const percent of HUD_SCALE_PERCENTS) {
				const where = `${sc.name} hud ${percent}`;
				const geo = geometry(sc, percent);
				const r = touchStrip(geo, content(VALE_ART));
				const safe = geo.safe;
				const hud = r.hudScale;
				const rc = HUD_TRANSIENT.roomClear;
				const stamp = hudTopCentre(safe, hud, r.bossTop, rc.width, rc.height);
				expectOk(where, "stamp off the strip", !rectsOverlap(stamp, r.group));
				const chipBox = HUD_TRANSIENT.roomClearChip;
				const chip = {
					x: safe.x + safe.w - (HUD_VIEW.margin + chipBox.width) * hud,
					y: safe.y + r.belowTop * hud,
					w: chipBox.width * hud,
					h: chipBox.height * hud,
				};
				expectOk(where, "room clear chip off the strip", !rectsOverlap(chip, r.group));
				expectOk(where, "room clear chip off the boss slot", !rectsOverlap(chip, r.boss));
				const toasts = hudTopCentre(
					safe,
					hud,
					PROGRESSION_VIEW.toastTop,
					HUD_TRANSIENT.toasts.width,
					HUD_TRANSIENT.toasts.height,
				);
				expectOk(where, "toasts off the strip", !rectsOverlap(toasts, r.group));
				const spectate = HUD_TRANSIENT.spectate;
				const bar = {
					x: safe.x + (safe.w - SPECTATE_BAR_VIEW.width * hud) / 2,
					y: safe.y + safe.h - (spectate.edge + spectate.height) * hud,
					w: SPECTATE_BAR_VIEW.width * hud,
					h: spectate.height * hud,
				};
				expectOk(where, "spectate bar off the strip", !rectsOverlap(bar, r.group));
			}
		}
	});

	it("is slim on the owner's phone (693 x 320, 100 %): strip <= 28 pt, chips <= 14 pt, the HUD under 20 % of the height", () => {
		for (const [look, art] of LOOKS) {
			const sc = SCREENS[0];
			const r = touchStrip(geometry(sc, PERCENT), content(art));
			const chipsLine = bottomOf(r.chips) - bottomOf(r.strip);
			expectOk(look, "strip height", r.strip.h <= 28 + EPS);
			expectOk(look, "chips line", chipsLine <= 14 + EPS);
			const total = r.strip.h + chipsLine + TOUCH_STRIP.boss.gap * r.hudScale + r.boss.h;
			expectOk(look, "strip + chips + boss < 20 %", total / sc.h < 0.2);
			// The corner panels used to reach 138 pt under the top bar; the strip's HUD ends a few pt under it.
			expectOk(
				look,
				"below the bar",
				bottomOf(r.boss) - TOP_BAR < touchCornerBoxesHeight(sc.w, sc.h, PERCENT) / 4,
			);
		}
	});

	it("prints the strip's numbers per screen and HUD scale (docs/UI_ART.md Phones)", () => {
		const lines: string[] = [];
		for (const sc of SCREENS) {
			for (const percent of HUD_SCALE_PERCENTS) {
				const r = touchStrip(geometry(sc, percent), content(VALE_ART));
				const chipsLine = bottomOf(r.chips) - bottomOf(r.strip);
				const total = r.strip.h + chipsLine + TOUCH_STRIP.boss.gap * r.hudScale + r.boss.h;
				lines.push(
					string.format(
						"%s %3d%%: x%.3f fit %.2f%s%s strip %.1f pt, chips %.1f, boss %.1f, total %.1f pt = %.1f %% of %d; HUD ends %.1f pt under the bar (corner boxes: %.1f)",
						sc.name,
						percent,
						r.scale,
						r.fit,
						r.showMult ? "" : " no-mult",
						r.heartsAsCount ? " hearts#" : "",
						r.strip.h,
						chipsLine,
						r.boss.h,
						total,
						(total / sc.h) * PERCENT,
						sc.h,
						bottomOf(r.boss) - TOP_BAR,
						touchCornerBoxesHeight(sc.w, sc.h, percent),
					),
				);
			}
		}
		print(`[touchStrip]\n${lines.join("\n")}`);
		expect(lines.size() > 0).toBe(true);
	});
});

describe("touch strip: collapsing", () => {
	it("collapses in order when the free top bar narrows, and never overlaps the bar's buttons", () => {
		const sc = SCREENS[0];
		const c = content(VALE_ART, { heartsMax: 12, pips: 3, score: 1234567 }); // check-asset-ids: allow (a 7-digit score)
		let lastStep = 0;
		for (let cut = 0; cut <= 400; cut += 10) {
			const geo = geometry(sc, PERCENT);
			const g = { ...geo, topbar: { ...geo.topbar, w: math.max(0, geo.topbar.w - cut) } };
			const r = touchStrip(g, c);
			const step = r.placement === "belowBar" ? 4 : r.fit < 1 ? 3 : r.heartsAsCount ? 2 : r.showMult ? 0 : 1;
			expectOk(`cut ${cut}`, "steps in order", step >= lastStep);
			lastStep = step;
			if (r.placement === "topBar") {
				expectOk(`cut ${cut}`, "right of the pause button", r.strip.x >= g.topbar.x + g.reserveLeft - EPS);
				expectOk(`cut ${cut}`, "inside the free bar", r.strip.x + r.strip.w <= g.topbar.x + g.topbar.w + EPS);
				expectOk(`cut ${cut}`, "fit floor", r.fit >= TOUCH_STRIP.minFit - EPS);
			} else {
				expectOk(`cut ${cut}`, "under the bar", r.group.y >= g.safe.y);
			}
			expectOk(`cut ${cut}`, "content fits", r.widths.total <= r.maxWidth + EPS);
		}
		expect(lastStep).toBe(4);
	});

	it("goes to the top of the safe area when there is no top bar", () => {
		const sc = SCREENS[3];
		const geo = geometry(sc, PERCENT, false);
		const r = touchStrip(geo, content(undefined));
		expect(r.placement).toBe("belowBar");
		expect(r.strip.y >= geo.safe.y).toBe(true);
		expect(r.boss.y >= bottomOf(r.chips)).toBe(true);
	});
});

/** Every touch control (buttons and the move home). */
function points(layout: ReturnType<typeof touchLayout>): TouchPoint[] {
	const out: TouchPoint[] = [...layout.buttons];
	if (layout.moveHome !== undefined) out.push(layout.moveHome);
	return out;
}

function stripLayout(sc: Screen, percent: number): [TouchStripLayout, ScreenRect, ReadonlyArray<ScreenRect>] {
	const geo = geometry(sc, percent);
	const r = touchStrip(geo, content(VALE_ART, { heartsMax: 10, pips: 2, score: 123456 }));
	return [r, geo.safe, r.footprint.map((b) => toSafe(b, geo.safe))];
}

describe("touch strip and the touch controls", () => {
	it("the controls keep clear of the strip and the boss slot: every screen, HUD scale, size, hand and mode", () => {
		for (const sc of SCREENS) {
			for (const percent of HUD_SCALE_PERCENTS) {
				const [, safe, boxes] = stripLayout(sc, percent);
				for (const size of SIZES) {
					for (const hand of HANDS) {
						for (const mode of ["play", "spectate"] as const) {
							const where = `${sc.name} hud ${percent} size ${size} ${hand ? "left" : "right"} ${mode}`;
							const l = touchLayout(
								sc.w,
								sc.h,
								safe.w,
								safe.h,
								percent,
								size,
								hand,
								mode,
								undefined,
								boxes,
							);
							expectOk(where, "clear", l.clear);
							const keepOut = touchStripKeepOut(boxes, l.hudScale);
							expectOk(where, "off the strip", touchControlsClear(points(l), keepOut, safe.w, safe.h));
							expectOk(
								where,
								"diameter",
								points(l).every((p) => 2 * p.r >= TOUCH_LAYOUT.minDiameterPx),
							);
						}
					}
				}
			}
		}
	});

	it("the owner's phones get the usual cluster back at the HUD scale (they took the compact one under the corner panels)", () => {
		for (const sc of [SCREENS[0], SCREENS[1]]) {
			const [, safe, boxes] = stripLayout(sc, PERCENT);
			for (const hand of HANDS) {
				const before = touchLayout(sc.w, sc.h, safe.w, safe.h, PERCENT, PERCENT, hand, "play");
				const after = touchLayout(sc.w, sc.h, safe.w, safe.h, PERCENT, PERCENT, hand, "play", undefined, boxes);
				expect(before.variant).toBe("compact");
				expect(after.variant).toBe("play");
				expect(after.scale).toBeCloseTo(after.hudScale, 6);
				print(
					string.format(
						"[touchStrip] %s %s: cluster %s x%.3f -> %s x%.3f (move zone top %.1f -> %.1f pt)",
						sc.name,
						hand ? "left" : "right",
						before.variant,
						before.scale,
						after.variant,
						after.scale,
						before.moveZone?.y ?? 0,
						after.moveZone?.y ?? 0,
					),
				);
			}
		}
	});
});
