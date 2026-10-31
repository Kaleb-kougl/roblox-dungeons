// The in-run HUD's and the touch controls' skin decisions (docs/UI_ART.md UA10-UA13): pip art per kind and state, the
// pill bar's whole-pixel fit and fill clip, the framed minimap's footprint, the touch rings.
import { describe, expect, it } from "@rbxts/jest-globals";
import { uiIconIds, uiSkinIds } from "shared/theme";
import { VALE_IMAGE_LAYOUTS, VALE_UI_ICONS } from "shared/theme/packs/vale";
import {
	HUD_SKIN,
	HUD_VIEW,
	MINIMAP_PANEL,
	TOUCH_LAYOUT,
	TOUCH_TEST_VIEWPORTS,
	UI_ART,
	fillClip,
	heartSkinState,
	insetSize,
	pillFit,
	pipArt,
	pipArtSlot,
	scoreEstimate,
	HUD_FOOTPRINT,
	skinRefPerArt,
	sliceBorder,
	snappedSliceScale,
	touchArtId,
	touchArtSize,
	touchArtTransparency,
	touchLayout,
	type HudPipKind,
	type SkinHas,
	type TouchArtControl,
} from "shared/view/hud";

/** The UIScales skin.spec.ts checks: minScale, 70 % at 720 p, 720 p, 1.25, 1080 p, maxScale, maxScale at 125 %. */
const SCALES = [0.6, 0.7, 1, 1.25, 1.5, 1.75, 2.1875];
const EPS = 1e-9;
const isWhole = (v: number) => math.abs(v - math.floor(v + 0.5)) < EPS;
const ALL = [...uiSkinIds(), ...uiIconIds()];
const hasAll: SkinHas = (id) => ALL.includes(id);
const hasNone: SkinHas = () => false;
const KINDS: ReadonlyArray<HudPipKind> = ["flask", "ember", "armor", "aegis"];

/** An icon's art size from the vale icon layout. */
function icon(id: string): { w: number; h: number } {
	const r = VALE_UI_ICONS[id].rect;
	return { w: r.w, h: r.h };
}

describe("hud skin ids", () => {
	it("every id HUD_SKIN adds is an optional skin or icon id of the contract", () => {
		for (const [, id] of pairs(HUD_SKIN.ids as unknown as Map<string, string>)) {
			expect([id, ALL.includes(id)]).toEqual([id, true]);
		}
	});

	it("the heart box is 24 (UAD7), the same as UI_ART.iconBox.heart and HUD_VIEW.heartSize", () => {
		expect(HUD_SKIN.heartBox).toBe(24);
		expect(UI_ART.iconBox.heart).toBe(HUD_VIEW.heartSize);
	});

	it("an 18 x 15 heart draws at 2 screen px per art px at 1080 p in the heart box", () => {
		const heart = icon("ui.heart.full");
		const k = math.floor(math.min((HUD_SKIN.heartBox * 1.5) / heart.w, (HUD_SKIN.heartBox * 1.5) / heart.h) + EPS);
		expect(k).toBe(2);
	});
});

describe("heartSkinState / pipArt", () => {
	it("heartFills' 2 / 1 / 0 are full / half / empty", () => {
		expect([heartSkinState(2), heartSkinState(1), heartSkinState(0)]).toEqual(["full", "half", "empty"]);
	});

	it("no art: every pip is flat", () => {
		for (const kind of KINDS) {
			expect([kind, pipArt(hasNone, kind, true), pipArt(hasNone, kind, false)]).toEqual([kind]);
		}
	});

	it("flask: full / spent potions, opaque, untinted; needs both images", () => {
		expect(pipArt(hasAll, "flask", true)).toEqual({ id: "ui.flask.full", transparency: 0, tinted: false });
		expect(pipArt(hasAll, "flask", false)).toEqual({ id: "ui.flask.empty", transparency: 0, tinted: false });
		expect(pipArt((id) => id === "ui.flask.full", "flask", true)).toBe(undefined);
	});

	it("ember: the candle, an unlit one dimmed", () => {
		expect(pipArt(hasAll, "ember", true)).toEqual({ id: "ui.candle", transparency: 0, tinted: false });
		expect(pipArt(hasAll, "ember", false)).toEqual({
			id: "ui.candle",
			transparency: HUD_SKIN.emberDimTransparency,
			tinted: false,
		});
		expect(HUD_SKIN.emberDimTransparency > 0 && HUD_SKIN.emberDimTransparency < 1).toBe(true);
	});

	it("armor: the grey chip, an empty one dimmed; aegis: the white chip, tinted", () => {
		expect(pipArt(hasAll, "armor", true)).toEqual({ id: "ui.chip", transparency: 0, tinted: false });
		expect(pipArt(hasAll, "armor", false)?.transparency).toBe(HUD_SKIN.chipDimTransparency);
		expect(pipArt(hasAll, "aegis", true)).toEqual({ id: "ui.chip.white", transparency: 0, tinted: true });
		expect(HUD_SKIN.chipDimTransparency > 0 && HUD_SKIN.chipDimTransparency < 1).toBe(true);
	});
});

describe("pipArtSlot", () => {
	const artOf: Record<HudPipKind, string> = {
		flask: "ui.flask.full",
		ember: "ui.candle",
		armor: "ui.chip",
		aegis: "ui.chip.white",
	};

	it("keeps its kind's box height, art at whole screen px, within the box whenever 1 screen px per art px fits", () => {
		for (const kind of KINDS) {
			const a = icon(artOf[kind]);
			const box = HUD_SKIN.pipBox[kind];
			for (const u of SCALES) {
				const slot = pipArtSlot(kind, a.w, a.h, u);
				const k = (slot.w * u) / a.w;
				const fits = a.w <= box * u && a.h <= box * u;
				expect([kind, u, slot.h, isWhole(k), k >= 1, !fits || slot.w <= box + EPS]).toEqual([
					kind,
					u,
					box,
					true,
					true,
					true,
				]);
			}
		}
	});

	it("flasks and candles stand in a label line's height; chips in a pip's", () => {
		expect(HUD_SKIN.pipBox.flask).toBe(HUD_VIEW.heartSize);
		expect(HUD_SKIN.pipBox.ember).toBe(HUD_VIEW.heartSize);
		expect(HUD_SKIN.pipBox.armor).toBe(HUD_VIEW.pipSize);
	});

	it("an 18 px flask takes 18 reference px at 720 p and 12 at 1080 p (1 screen px per art px: 23 tall in 36)", () => {
		const a = icon("ui.flask.full");
		expect(pipArtSlot("flask", a.w, a.h, 1).w).toBe(18);
		expect(pipArtSlot("flask", a.w, a.h, 1.5).w).toBeCloseTo(12, 9);
	});
});

describe("pillFit (boss bar)", () => {
	const pillH = VALE_IMAGE_LAYOUTS["ui.bar.track"].h;

	it("the vale pill is 16 art px tall and the boss bar row is 16 (12 before UA11)", () => {
		expect(pillH).toBe(16);
		expect(VALE_IMAGE_LAYOUTS["ui.bar.fill"].h).toBe(pillH);
		expect(HUD_VIEW.bossBarHeight).toBe(16);
		expect(HUD_SKIN.bossBarBox).toBe(HUD_VIEW.bossBarHeight);
	});

	it("draws at whole screen px per art px (height and end caps) at every scale", () => {
		for (const u of SCALES) {
			const p = pillFit(pillH, HUD_SKIN.bossBarBox, u);
			expect([u, isWhole((p.h * u) / pillH), isWhole(p.sliceScale * u), p.scale >= 1]).toEqual([
				u,
				true,
				true,
				true,
			]);
			expect((p.h * u) / pillH).toBeCloseTo(p.scale, 9);
		}
	});

	it("fits the row from 720 p up (1 / 1 / 2 screen px per art px at 720 / 1080 / 1440 p), overflows only below", () => {
		expect(pillFit(pillH, HUD_SKIN.bossBarBox, 1)).toEqual({ h: 16, sliceScale: 1, scale: 1 });
		expect(pillFit(pillH, HUD_SKIN.bossBarBox, 1.5).scale).toBe(1);
		expect(pillFit(pillH, HUD_SKIN.bossBarBox, 2).scale).toBe(2);
		for (const u of SCALES) {
			if (u >= 1) expect(pillFit(pillH, HUD_SKIN.bossBarBox, u).h).toBeLessThanOrEqual(HUD_SKIN.bossBarBox + EPS);
		}
		expect(pillFit(pillH, HUD_SKIN.bossBarBox, 0.6).scale).toBe(1);
	});
});

describe("fillClip", () => {
	it("clips to the fraction and draws the art at the whole track's width inside (clip x inner = 1)", () => {
		for (const f of [0.01, 0.25, 0.5, 0.66, 1]) {
			const c = fillClip(f);
			expect([f, c.visible, c.clip]).toEqual([f, true, f]);
			expect(c.clip * c.inner).toBeCloseTo(1, 12);
		}
	});

	it("shows nothing at 0, below minFillFraction, negative or NaN; clamps above 1", () => {
		for (const f of [0, HUD_SKIN.minFillFraction / 2, -1, 0 / 0]) expect(fillClip(f).visible).toBe(false);
		expect(fillClip(2)).toEqual({ clip: 1, inner: 1, visible: true });
	});
});

describe("framed minimap", () => {
	const slice = VALE_IMAGE_LAYOUTS["ui.panel.hud"].slice;

	it("the host plus the frame's border is exactly MINIMAP_PANEL at every scale (the footprint holds)", () => {
		for (const u of SCALES) {
			const border = sliceBorder(slice, snappedSliceScale(u, skinRefPerArt("hud")));
			const host = insetSize(MINIMAP_PANEL.w, MINIMAP_PANEL.h, border);
			expect(host.w + border.left + border.right).toBeCloseTo(MINIMAP_PANEL.w, 9);
			expect(host.h + border.top + border.bottom).toBeCloseTo(MINIMAP_PANEL.h, 9);
			expect(isWhole(border.left * u)).toBe(true);
		}
	});

	it("at 720 p the 6 art px border leaves a 128 px map; no slice leaves the whole panel", () => {
		const border = sliceBorder(slice, snappedSliceScale(1, skinRefPerArt("hud")));
		expect(insetSize(MINIMAP_PANEL.w, MINIMAP_PANEL.h, border)).toEqual({ w: 128, h: 128 });
		expect(insetSize(MINIMAP_PANEL.w, MINIMAP_PANEL.h, sliceBorder(undefined, 1))).toEqual({
			w: MINIMAP_PANEL.w,
			h: MINIMAP_PANEL.h,
		});
	});
});

describe("combo meter (UA11: keeps its flat track)", () => {
	it("a 16 art px pill cannot fit the 10 px meter at a whole scale, and a 16 px meter would break the score budget", () => {
		const pillH = VALE_IMAGE_LAYOUTS["ui.bar.track"].h;
		expect(pillFit(pillH, HUD_VIEW.comboBarHeight, 1).h).toBeGreaterThan(HUD_VIEW.comboBarHeight);
		expect(scoreEstimate().h + pillH - HUD_VIEW.comboBarHeight).toBeGreaterThan(HUD_FOOTPRINT.score.maxH);
	});
});

describe("touch art", () => {
	const ring = icon("ui.stick.ring");
	const button = icon("ui.touch.button");

	it("sticks draw the ring, buttons the round button; nothing without the art", () => {
		const controls: TouchArtControl[] = ["move"];
		for (const c of TOUCH_LAYOUT.play) controls.push(c.id);
		for (const c of TOUCH_LAYOUT.spectate) controls.push(c.id);
		for (const c of controls) {
			const stick = c === "move" || c === "attack" || c === "alt";
			expect([c, touchArtId(hasAll, c)]).toEqual([c, stick ? HUD_SKIN.ids.stickRing : HUD_SKIN.ids.touchButton]);
			expect([c, touchArtId(hasNone, c)]).toEqual([c]);
		}
	});

	it("the ring and the button are 39 px round art", () => {
		expect([ring.w, ring.h, button.w, button.h]).toEqual([39, 39, 39, 39]);
	});

	it("draws a whole multiple of the art within half an art step of every laid-out circle", () => {
		for (const v of TOUCH_TEST_VIEWPORTS) {
			for (const size of [75, 100, 150]) {
				const layout = touchLayout(v.x, v.y, v.x, v.y, 100, size, false, "play");
				const circles = [...layout.buttons];
				if (layout.moveHome !== undefined) circles.push({ ...layout.moveHome, id: "attack" });
				for (const c of circles) {
					const d = c.r * 2;
					const s = touchArtSize(d, button.w);
					expect([v.x, size, s % button.w, s >= button.w]).toEqual([v.x, size, 0, true]);
					if (d >= button.w) expect(math.abs(s - d)).toBeLessThanOrEqual(button.w / 2 + EPS);
				}
			}
		}
		expect(touchArtSize(10, 39)).toBe(39);
		expect(touchArtSize(100, 0)).toBe(0);
	});

	it("follows the opacity setting, brighter when held, always in [0, 1]", () => {
		expect(touchArtTransparency(1, false)).toBeCloseTo(1 - HUD_SKIN.touch.artAlpha, 9);
		expect(touchArtTransparency(0, false)).toBe(1);
		expect(touchArtTransparency(0.5, true)).toBeLessThan(touchArtTransparency(0.5, false));
		for (const o of [0, 0.25, 0.5, 1]) {
			for (const held of [false, true]) {
				const t = touchArtTransparency(o, held);
				expect(t >= 0 && t <= 1).toBe(true);
			}
		}
	});
});
