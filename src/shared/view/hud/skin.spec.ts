// The UI skin's pure logic (docs/UI_ART.md UA5): whole-screen-pixel art scales, the icon fit, and every skinFor chain.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	PLACEHOLDER_MANIFEST,
	ThemePack,
	uiIconIds,
	uiSkinIds,
	type RobloxAssetId,
	type ThemeManifest,
} from "shared/theme";
import { VALE_IMAGE_LAYOUTS, VALE_UI_ICONS } from "shared/theme/packs/vale";
import {
	DRAFT_REVEAL_VIEW,
	HUD_VIEW,
	UI_ART,
	artDensityBox,
	artPixelScale,
	buttonSkinState,
	contentInsetsOf,
	dividerShown,
	fitArt,
	fitTurnedArt,
	focusCornerBox,
	iconShown,
	isQuarterTurn,
	menuButtonSkin,
	ornamentShown,
	panelHasArt,
	panelHidden,
	panelSkinContext,
	pillBarHeight,
	pillBarSkin,
	skinFor,
	skinHasOf,
	skinPadding,
	skinRefPerArt,
	skinnedButtonTextRole,
	snappedSliceScale,
	uniformPadding,
	volumeIcon,
	type SkinHas,
} from "shared/view/hud";
import { MENU_VIEW } from "shared/view/menu";

/**
 * UIScales the HUD takes: minScale 0.6, a 70 % HUD scale at 720 p (0.7), 720 p (1), 1.25, 1080 p (1.5), maxScale 1.75 and
 * the largest, maxScale at a 125 % HUD scale (2.1875).
 */
const SCALES = [0.6, 0.7, 1, 1.25, 1.5, 1.75, 2.1875];
/** Float slack: SliceScale is a float32 property, the products below never leave float64 by more than this. */
const EPS = 1e-9;
const isWhole = (v: number) => math.abs(v - math.floor(v + 0.5)) < EPS;

const hasOnly =
	(...ids: Array<string>): SkinHas =>
	(id) =>
		ids.includes(id);
const ALL = [...uiSkinIds(), ...uiIconIds()];

describe("artPixelScale / snappedSliceScale", () => {
	it("refPerArt is the draft cards' art scale", () => {
		expect(UI_ART.refPerArt).toBe(DRAFT_REVEAL_VIEW.artScale);
		expect(UI_ART.refPerArt).toBe(2);
	});

	it("give whole screen px per art px at every HUD scale", () => {
		for (const u of SCALES) {
			const k = artPixelScale(u, UI_ART.refPerArt);
			expect([u, k % 1, k >= UI_ART.minArtScale]).toEqual([u, 0, true]);
			const slice = snappedSliceScale(u, UI_ART.refPerArt);
			for (let art = 1; art <= 20; art++) {
				expect([u, art, isWhole(slice * u * art)]).toEqual([u, art, true]);
			}
			expect(math.abs(slice * u - k) < EPS).toBe(true);
		}
	});

	it("round half up, floor at minArtScale", () => {
		expect(SCALES.map((u) => artPixelScale(u))).toEqual([1, 1, 2, 3, 3, 4, 4]);
		expect(artPixelScale(0.2)).toBe(1);
		expect(artPixelScale(0.75)).toBe(2);
		expect(artPixelScale(1, 3)).toBe(3);
	});

	it("equal refPerArt (2) at UIScale 1, 1.5 and 2", () => {
		for (const u of [1, 1.5, 2]) {
			expect([u, snappedSliceScale(u, 2)]).toEqual([u, 2]);
			expect([u, snappedSliceScale(u)]).toEqual([u, 2]);
		}
	});

	it("treat a UIScale that is not a positive number as 1", () => {
		for (const u of [0, -1, 0 / 0, math.huge]) {
			expect([u, artPixelScale(u), snappedSliceScale(u)]).toEqual([u, 2, 2]);
		}
	});
});

describe("fitArt", () => {
	it("an 18 x 15 heart in the 24 box: 2 screen px per art px at UIScale 1.5 (1080 p), 1 at 1", () => {
		const box = UI_ART.iconBox.heart;
		expect(box).toBe(24);
		const at1080 = fitArt(18, 15, box, box, 1.5);
		expect(at1080.scale).toBe(2);
		expect(at1080.w).toBe(24);
		expect(at1080.h).toBe(20);
		expect(fitArt(18, 15, box, box, 1).scale).toBe(1);
		expect(fitArt(18, 15, box, box, 2).scale).toBe(2);
		expect(fitArt(18, 15, box, box, 2.25).scale).toBe(3);
	});

	it("never exceeds its box when k >= 2 is chosen, and k is the largest whole scale that fits", () => {
		for (const u of SCALES) {
			for (let artW = 1; artW <= 30; artW++) {
				for (const artH of [1, 7, 15, 23]) {
					for (const box of [12, 16, 24, 36]) {
						const f = fitArt(artW, artH, box, box, u);
						expect([u, artW, artH, box, f.scale % 1, f.scale >= 1]).toEqual([u, artW, artH, box, 0, true]);
						if (f.scale >= 2) {
							expect([u, artW, artH, box, f.w <= box + EPS, f.h <= box + EPS]).toEqual([
								u,
								artW,
								artH,
								box,
								true,
								true,
							]);
						}
						// one more step would overflow (screen px)
						const bigger = f.scale + 1;
						expect([
							u,
							artW,
							artH,
							box,
							artW * bigger > box * u + EPS || artH * bigger > box * u + EPS,
						]).toEqual([u, artW, artH, box, true]);
						// the drawn size is art * k screen px
						expect([u, artW, isWhole(f.w * u), isWhole(f.h * u)]).toEqual([u, artW, true, true]);
					}
				}
			}
		}
	});

	it("draws at k = 1 even when that overflows the box", () => {
		const f = fitArt(40, 20, 24, 24, 0.6);
		expect(f.scale).toBe(1);
		expect(f.w).toBe(40 / 0.6);
		expect(f.w > 24).toBe(true);
	});

	it("degenerate inputs fall back to k = 1", () => {
		expect(fitArt(0, 10, 24, 24, 1).scale).toBe(1);
		expect(fitArt(18, 15, 24, 24, 0)).toEqual({ w: 18, h: 15, scale: 1 });
	});
});

describe("skinFor", () => {
	it("panels: menu -> menu then tall; list -> tall then menu; hud -> hud only", () => {
		const all = hasOnly(...ALL);
		expect(skinFor(all, "panel", "menu")).toBe("ui.panel.menu");
		expect(skinFor(all, "panel", "list")).toBe("ui.panel.tall");
		expect(skinFor(all, "panel", "hud")).toBe("ui.panel.hud");
		expect(skinFor(hasOnly("ui.panel.tall"), "panel", "menu")).toBe("ui.panel.tall");
		expect(skinFor(hasOnly("ui.panel.menu"), "panel", "list")).toBe("ui.panel.menu");
		expect(skinFor(hasOnly("ui.panel.menu", "ui.panel.tall"), "panel", "hud")).toBe(undefined);
		expect(skinFor(hasOnly("ui.panel.hud"), "panel", "menu")).toBe(undefined);
		expect(skinFor(hasOnly("ui.panel.hud"), "panel", "list")).toBe(undefined);
		expect(UI_ART.panels).toEqual({ menu: "ui.panel.menu", hud: "ui.panel.hud", list: "ui.panel.tall" });
	});

	it("buttons: focused and active share the focus art, disabled its own, each falling back to ui.button", () => {
		const all = hasOnly(...ALL);
		expect(skinFor(all, "button", "normal")).toBe("ui.button");
		expect(skinFor(all, "button", "focused")).toBe("ui.button.focus");
		expect(skinFor(all, "button", "active")).toBe("ui.button.focus");
		expect(skinFor(all, "button", "disabled")).toBe("ui.button.disabled");
		const base = hasOnly("ui.button");
		for (const state of ["normal", "focused", "active", "disabled"] as const) {
			expect([state, skinFor(base, "button", state)]).toEqual([state, "ui.button"]);
		}
		// no base button: flat, whatever state art exists
		const noBase = hasOnly("ui.button.focus", "ui.button.disabled");
		for (const state of ["normal", "focused", "active", "disabled"] as const) {
			expect([state, skinFor(noBase, "button", state)]).toEqual([state, undefined]);
		}
	});

	it("options: their own pair, else the button family, else flat", () => {
		expect(skinFor(hasOnly(...ALL), "option", "on")).toBe("ui.option.on");
		expect(skinFor(hasOnly(...ALL), "option", "off")).toBe("ui.option.off");
		const buttons = hasOnly("ui.button", "ui.button.focus", "ui.option.on");
		expect(skinFor(buttons, "option", "on")).toBe("ui.button.focus");
		expect(skinFor(buttons, "option", "off")).toBe("ui.button");
		expect(skinFor(hasOnly("ui.button"), "option", "on")).toBe("ui.button");
		expect(skinFor(hasOnly("ui.option.on", "ui.option.off"), "option", "on")).toBe("ui.option.on");
		expect(skinFor(hasOnly("ui.option.off"), "option", "off")).toBe(undefined);
	});

	it("hearts only as a full set; flasks only as a pair", () => {
		const hearts = hasOnly("ui.heart.full", "ui.heart.half", "ui.heart.empty");
		expect(skinFor(hearts, "heart", "full")).toBe("ui.heart.full");
		expect(skinFor(hearts, "heart", "half")).toBe("ui.heart.half");
		expect(skinFor(hearts, "heart", "empty")).toBe("ui.heart.empty");
		for (const missing of ["ui.heart.full", "ui.heart.half", "ui.heart.empty"]) {
			const has: SkinHas = (id) => id !== missing && hearts(id);
			for (const state of ["full", "half", "empty"] as const) {
				expect([missing, state, skinFor(has, "heart", state)]).toEqual([missing, state, undefined]);
			}
		}
		const flasks = hasOnly("ui.flask.full", "ui.flask.empty");
		expect(skinFor(flasks, "flask", "full")).toBe("ui.flask.full");
		expect(skinFor(flasks, "flask", "empty")).toBe("ui.flask.empty");
		expect(skinFor(hasOnly("ui.flask.full"), "flask", "full")).toBe(undefined);
		expect(skinFor(hasOnly("ui.flask.empty"), "flask", "empty")).toBe(undefined);
	});

	it("pips, bars and ember", () => {
		const all = hasOnly(...ALL);
		expect(skinFor(all, "pip", "armor")).toBe("ui.chip");
		expect(skinFor(all, "pip", "tinted")).toBe("ui.chip.white");
		expect(skinFor(hasOnly("ui.chip"), "pip", "tinted")).toBe(undefined);
		expect(skinFor(hasOnly("ui.chip.white"), "pip", "armor")).toBe(undefined);
		expect(skinFor(all, "bar", "track")).toBe("ui.bar.track");
		expect(skinFor(all, "bar", "fill")).toBe("ui.bar.fill");
		expect(skinFor(hasOnly("ui.bar.track"), "bar", "fill")).toBe(undefined);
		expect(skinFor(hasOnly("ui.bar.track"), "bar", "track")).toBe("ui.bar.track");
		expect(skinFor(hasOnly("ui.bar.fill"), "bar", "fill")).toBe(undefined);
		expect(skinFor(all, "ember", "lit")).toBe("ui.candle");
		expect(skinFor(hasOnly("ui.heart.full"), "ember", "lit")).toBe(undefined);
	});

	it("names only optional ui skin ids", () => {
		const named = new Array<string>();
		for (const [, id] of pairs(UI_ART.ids)) named.push(id);
		for (const [, id] of pairs(UI_ART.panels)) named.push(id);
		expect(named.size()).toBe(32);
		for (const id of named) {
			expect([id, ALL.includes(id)]).toEqual([id, true]);
		}
	});

	it("a pack without the art (an always-false predicate, the placeholder pack) is flat everywhere", () => {
		const none: SkinHas = () => false;
		const placeholder = skinHasOf(new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined }));
		for (const has of [none, placeholder]) {
			for (const s of ["menu", "hud", "list"] as const) expect(skinFor(has, "panel", s)).toBe(undefined);
			for (const s of ["normal", "focused", "active", "disabled"] as const) {
				expect(skinFor(has, "button", s)).toBe(undefined);
			}
			for (const s of ["on", "off"] as const) expect(skinFor(has, "option", s)).toBe(undefined);
			for (const s of ["full", "half", "empty"] as const) expect(skinFor(has, "heart", s)).toBe(undefined);
			for (const s of ["full", "empty"] as const) expect(skinFor(has, "flask", s)).toBe(undefined);
			for (const s of ["armor", "tinted"] as const) expect(skinFor(has, "pip", s)).toBe(undefined);
			for (const s of ["track", "fill"] as const) expect(skinFor(has, "bar", s)).toBe(undefined);
			expect(skinFor(has, "ember", "lit")).toBe(undefined);
		}
	});

	it("skinHasOf reads ThemePack.image", () => {
		const m: ThemeManifest = {
			...PLACEHOLDER_MANIFEST,
			assets: {
				...PLACEHOLDER_MANIFEST.assets,
				"ui.button": { kind: "image", assetId: "test://4030" as unknown as RobloxAssetId, w: 30, h: 14 },
			},
		};
		const has = skinHasOf(new ThemePack(m, { warn: () => undefined }));
		expect(has("ui.button")).toBe(true);
		expect(has("ui.button.focus")).toBe(false);
		expect(has("ui.panel")).toBe(false); // a placeholder is not an image
		expect(skinFor(has, "button", "focused")).toBe("ui.button");
	});
});

/** A vale sliced image's insets (art px). */
function insets(id: string) {
	const s = VALE_IMAGE_LAYOUTS[id].slice;
	expect([id, s !== undefined]).toEqual([id, true]);
	return s!;
}

/** A vale sliced panel's content insets (art px): its visible border, what padding follows. */
function borders(id: string) {
	const s = contentInsetsOf(id, insets(id));
	expect([id, s !== undefined]).toEqual([id, true]);
	return s!;
}

const SIDES = ["left", "top", "right", "bottom"] as const;

describe("panel skins (UA7)", () => {
	it("context: the skin prop, else hud in a corner and menu elsewhere; none is always flat", () => {
		expect(panelSkinContext(undefined, true)).toBe("hud");
		expect(panelSkinContext(undefined, false)).toBe("menu");
		expect(panelSkinContext("none", true)).toBe(undefined);
		expect(panelSkinContext("none", false)).toBe(undefined);
		for (const s of ["menu", "hud", "list"] as const) {
			expect([s, panelSkinContext(s, true), panelSkinContext(s, false)]).toEqual([s, s, s]);
		}
	});

	it("density: hud frames at hudRefPerArt (1), menus and lists at refPerArt (2)", () => {
		expect(UI_ART.hudRefPerArt).toBe(1);
		expect(skinRefPerArt("hud")).toBe(UI_ART.hudRefPerArt);
		expect(skinRefPerArt("menu")).toBe(UI_ART.refPerArt);
		expect(skinRefPerArt("list")).toBe(UI_ART.refPerArt);
	});

	it("ui.panel.hud's border at hudRefPerArt fits under HUD_VIEW.pad: corner panels keep their size", () => {
		const s = insets(UI_ART.panels.hud);
		for (const inset of [s.left, s.top, s.right, s.bottom]) {
			expect(inset * UI_ART.hudRefPerArt <= HUD_VIEW.pad).toBe(true);
		}
		const pad = skinPadding(uniformPadding(HUD_VIEW.pad), s, UI_ART.hudRefPerArt);
		expect(pad).toEqual(uniformPadding(HUD_VIEW.pad));
	});

	it("padding: per side, the larger of the flat pad and the inset at the slice scale", () => {
		const s = { left: 43, top: 11, right: 43, bottom: 8 };
		expect(skinPadding(uniformPadding(8), s, 2)).toEqual({ left: 86, top: 22, right: 86, bottom: 16 });
		expect(skinPadding(uniformPadding(30), s, 2)).toEqual({ left: 86, top: 30, right: 86, bottom: 30 });
		expect(
			skinPadding({ left: 8, top: 0, right: 8, bottom: 0 }, { left: 6, top: 6, right: 6, bottom: 6 }, 1.5),
		).toEqual({ left: 9, top: 9, right: 9, bottom: 9 });
		expect(skinPadding(uniformPadding(8), undefined, 2)).toEqual(uniformPadding(8));
	});

	it("padding never leaves content on the drawn (visible) border at any HUD scale", () => {
		for (const id of [UI_ART.panels.menu, UI_ART.panels.hud, UI_ART.panels.list]) {
			const s = borders(id);
			for (const context of ["menu", "hud", "list"] as const) {
				for (const u of SCALES) {
					const scale = snappedSliceScale(u, skinRefPerArt(context));
					const p = skinPadding(uniformPadding(HUD_VIEW.pad), s, scale);
					// screen px: padding * u >= inset * whole screen px per art px
					const k = artPixelScale(u, skinRefPerArt(context));
					const ok =
						p.left * u + EPS >= s.left * k &&
						p.top * u + EPS >= s.top * k &&
						p.right * u + EPS >= s.right * k &&
						p.bottom * u + EPS >= s.bottom * k;
					expect([id, context, u, ok]).toEqual([id, context, u, true]);
				}
			}
		}
	});

	it("list rows draw the hud frame: ui.panel.tall's borders leave no line in a row at 1080 p, ui.panel.hud's do", () => {
		expect(UI_ART.rowContext).toBe("hud");
		const line = HUD_VIEW.smallText;
		const fits = (id: string, u: number) => {
			const s = borders(id);
			return (s.top + s.bottom) * snappedSliceScale(u, UI_ART.hudRefPerArt) + line <= MENU_VIEW.rowHeight + EPS;
		};
		expect(fits(UI_ART.panels.list, 1.5)).toBe(false);
		for (const u of SCALES) {
			expect([u, fits(skinFor(hasOnly(...ALL), "panel", UI_ART.rowContext)!, u)]).toEqual([u, true]);
		}
	});
});

describe("content insets (UA7)", () => {
	it("every sliced panel id has a measured entry, whole art px, never deeper than its slice inset", () => {
		const panels = [UI_ART.panels.menu, UI_ART.panels.hud, UI_ART.panels.list];
		for (const id of panels) {
			const c = UI_ART.contentInsets[id];
			expect([id, c !== undefined]).toEqual([id, true]);
			const s = insets(id);
			for (const side of SIDES) {
				const v = c![side];
				expect([id, side, v >= 0, v % 1, v <= s[side]]).toEqual([id, side, true, 0, true]);
			}
		}
		// Every entry is a sliced panel's (no stale ids).
		for (const [id] of UI_ART.contentInsets as unknown as ReadonlyMap<string, unknown>) {
			expect([id, panels.includes(id)]).toEqual([id, true]);
		}
	});

	it("the measured borders: menu 5 / 11 / 5 / 7, tall 5 / 10 / 5 / 7, hud 2 / 3 / 2 / 3", () => {
		expect(borders(UI_ART.panels.menu)).toEqual({ left: 5, top: 11, right: 5, bottom: 7 });
		expect(borders(UI_ART.panels.list)).toEqual({ left: 5, top: 10, right: 5, bottom: 7 });
		expect(borders(UI_ART.panels.hud)).toEqual({ left: 2, top: 3, right: 2, bottom: 3 });
	});

	it("contentInsetsOf falls back to the slice insets, then to nothing", () => {
		const slice = { left: 4, top: 4, right: 4, bottom: 4 };
		expect(contentInsetsOf("ui.option.on", slice)).toEqual(slice);
		expect(contentInsetsOf("ui.option.on", undefined)).toBe(undefined);
		expect(contentInsetsOf(UI_ART.panels.menu, undefined)).toEqual(UI_ART.contentInsets[UI_ART.panels.menu]);
	});

	it("a menu panel pads by its visible border, not its 43 px slice: 10 at the sides, 22 / 14 top / bottom", () => {
		const menu = borders(UI_ART.panels.menu);
		expect(skinPadding(uniformPadding(HUD_VIEW.pad), menu, 2)).toEqual({
			left: 10,
			top: 22,
			right: 10,
			bottom: 14,
		});
		// The menus' doubled pad (16) already clears the side rails: only the top and bottom grow.
		expect(skinPadding(uniformPadding(HUD_VIEW.pad * 2), menu, 2)).toEqual({
			left: 16,
			top: 22,
			right: 16,
			bottom: 16,
		});
		// The slice insets would have taken 86 reference px per side.
		expect(skinPadding(uniformPadding(HUD_VIEW.pad), insets(UI_ART.panels.menu), 2).left).toBe(86);
	});

	it("a fixed-width menu panel keeps at least the flat panel's content width minus the rails", () => {
		const menu = borders(UI_ART.panels.menu);
		for (const u of SCALES) {
			const scale = snappedSliceScale(u, UI_ART.refPerArt);
			const p = skinPadding(uniformPadding(HUD_VIEW.pad * 2), menu, scale);
			const flat = HUD_VIEW.pad * 2 * 2;
			// At most the rails' 5 art px per side at the largest whole scale (4 screen px per art px at 1.75 / 2.19).
			expect([u, p.left + p.right - flat <= (5 * 2 * 4) / u + EPS]).toEqual([u, true]);
		}
	});
});

describe("panel decisions (UA7)", () => {
	it("a fully transparent panel (a layout box) is always flat; a binding or a visible fill is not", () => {
		expect(panelHidden(1)).toBe(true);
		expect(panelHidden(2)).toBe(true);
		expect(panelHidden(0)).toBe(false);
		expect(panelHidden(HUD_VIEW.panelTransparency)).toBe(false);
		expect(panelHidden(undefined)).toBe(false);
		expect(panelHidden({})).toBe(false);
		expect(panelSkinContext(undefined, false, true)).toBe(undefined);
		expect(panelSkinContext("menu", false, true)).toBe(undefined);
		expect(panelSkinContext("hud", true, true)).toBe(undefined);
		expect(panelSkinContext("menu", false, false)).toBe("menu");
	});

	it("panelHasArt follows skinFor; no context is never art", () => {
		const all = hasOnly(...ALL);
		expect(panelHasArt(all, "menu")).toBe(true);
		expect(panelHasArt(all, undefined)).toBe(false);
		expect(panelHasArt(hasOnly(UI_ART.panels.hud), "menu")).toBe(false);
		expect(panelHasArt(hasOnly(UI_ART.panels.list), "menu")).toBe(true);
	});

	it("the ornament: asked for, a menu panel on art, and the ornament art", () => {
		const all = hasOnly(...ALL);
		expect(ornamentShown(all, "menu", true)).toBe(true);
		expect(ornamentShown(all, "menu", false)).toBe(false);
		expect(ornamentShown(all, "hud", true)).toBe(false);
		expect(ornamentShown(all, "list", true)).toBe(false);
		expect(ornamentShown(all, undefined, true)).toBe(false);
		expect(ornamentShown(hasOnly(UI_ART.panels.menu), "menu", true)).toBe(false);
		expect(ornamentShown(hasOnly(UI_ART.ids.ornament), "menu", true)).toBe(false);
		expect(UI_ART.ids.ornament).toBe("ui.ornament.bones");
	});

	it("the ornament is 89 x 13 art at the menu density: whole screen px, centred on the top edge", () => {
		const art = VALE_UI_ICONS[UI_ART.ids.ornament].rect;
		expect([art.w, art.h]).toEqual([89, 13]);
		for (const u of SCALES) {
			const box = artDensityBox(art.w, art.h, u, UI_ART.refPerArt);
			const k = artPixelScale(u, UI_ART.refPerArt);
			expect([u, math.abs(box.w * u - art.w * k) < EPS, math.abs(box.h * u - art.h * k) < EPS]).toEqual([
				u,
				true,
				true,
			]);
			// Its lower part sits inside the menu panel's top border padding (never over a content row).
			const below = box.h * (1 - UI_ART.ornament.anchorY);
			const pad = skinPadding(uniformPadding(HUD_VIEW.pad * 2), borders(UI_ART.panels.menu), k / u);
			expect([u, below <= pad.top + EPS]).toEqual([u, true]);
		}
	});

	it("dividers only on a panel drawn on art with the stripe; 3 art px tall at the menu density", () => {
		const all = hasOnly(...ALL);
		expect(dividerShown(all, "menu")).toBe(true);
		expect(dividerShown(all, undefined)).toBe(false);
		expect(dividerShown(hasOnly(UI_ART.ids.divider), "menu")).toBe(false);
		expect(dividerShown(hasOnly(UI_ART.panels.menu), "menu")).toBe(false);
		const art = VALE_UI_ICONS[UI_ART.ids.divider].rect;
		for (const u of SCALES) {
			const h = artDensityBox(art.w, art.h, u).h;
			expect([u, isWhole(h * u), h * u + EPS >= art.h]).toEqual([u, true, true]);
		}
	});
});

describe("icons (UA8)", () => {
	it("beside a label only on art, only with the icon", () => {
		const all = hasOnly(...ALL);
		expect(iconShown(all, true, UI_ART.ids.iconGear)).toBe(UI_ART.ids.iconGear);
		expect(iconShown(all, false, UI_ART.ids.iconGear)).toBe(undefined);
		expect(iconShown(all, true, undefined)).toBe(undefined);
		expect(iconShown(hasOnly(UI_ART.ids.button), true, UI_ART.ids.iconGear)).toBe(undefined);
	});

	it("audio rows: mute at 0, the speaker above", () => {
		expect(volumeIcon(0)).toBe(UI_ART.ids.iconMute);
		expect(volumeIcon(-1)).toBe(UI_ART.ids.iconMute);
		expect(volumeIcon(10)).toBe(UI_ART.ids.iconSpeaker);
		expect(volumeIcon(100)).toBe(UI_ART.ids.iconSpeaker);
	});

	it("every icon id the screens use is an optional ui id with an icon-atlas cut", () => {
		const ids = UI_ART.ids;
		for (const id of [
			ids.iconPause,
			ids.iconCheck,
			ids.iconCross,
			ids.iconGear,
			ids.iconHome,
			ids.iconSpeaker,
			ids.iconMute,
			ids.iconSkull,
			ids.iconSkullCurse,
			ids.iconGhost,
			ids.iconRip,
			ids.ornament,
			ids.divider,
		]) {
			expect([id, ALL.includes(id), VALE_UI_ICONS[id] !== undefined]).toEqual([id, true, true]);
		}
	});

	it("glyphs fit their box at 1080 p at 2 screen px per art px; the header and ghost boxes hold their art", () => {
		const icons = VALE_UI_ICONS;
		for (const id of [UI_ART.ids.iconGear, UI_ART.ids.iconSpeaker, UI_ART.ids.iconMute]) {
			const r = icons[id].rect;
			const f = fitArt(r.w, r.h, UI_ART.iconBox.glyph, UI_ART.iconBox.glyph, 1.5);
			expect([id, f.scale]).toEqual([id, 2]);
		}
		for (const u of [1, 1.25, 1.5, 1.75, 2.1875]) {
			for (const [id, box] of [
				[UI_ART.ids.iconSkull, UI_ART.iconBox.header],
				[UI_ART.ids.iconRip, UI_ART.iconBox.header],
				[UI_ART.ids.iconGhost, UI_ART.iconBox.ghost],
			] as const) {
				const r = icons[id].rect;
				const f = fitArt(r.w, r.h, box, box, u);
				expect([id, u, f.w <= box + EPS && f.h <= box + EPS]).toEqual([id, u, true]);
			}
		}
	});
});

describe("pill progress bar (UA9)", () => {
	it("needs both the track and the fill", () => {
		expect(pillBarSkin(hasOnly(...ALL))).toEqual({ track: UI_ART.ids.barTrack, fill: UI_ART.ids.barFill });
		expect(pillBarSkin(hasOnly(UI_ART.ids.barTrack))).toBe(undefined);
		expect(pillBarSkin(hasOnly(UI_ART.ids.barFill))).toBe(undefined);
		expect(pillBarSkin(() => false)).toBe(undefined);
	});

	it("is the pill's art height at barRefPerArt, whole screen px: 16 at 720 p", () => {
		const h = VALE_IMAGE_LAYOUTS[UI_ART.ids.barTrack].h;
		expect(h).toBe(16);
		expect(pillBarHeight(h, 1)).toBe(16);
		for (const u of SCALES) {
			const k = artPixelScale(u, UI_ART.barRefPerArt);
			expect([u, math.abs(pillBarHeight(h, u) * u - h * k) < EPS]).toEqual([u, true]);
			// Its round ends (8 art px, sliced) keep their shape: the bar is at least the ends' height.
			expect([u, pillBarHeight(h, u) * u >= insets(UI_ART.ids.barTrack).left * 2 - EPS]).toEqual([u, true]);
		}
	});
});

describe("button skins (UA7)", () => {
	it("state: disabled, then active, then focused", () => {
		expect(buttonSkinState(false, false, false)).toBe("normal");
		expect(buttonSkinState(false, true, false)).toBe("focused");
		expect(buttonSkinState(true, false, false)).toBe("active");
		expect(buttonSkinState(true, true, false)).toBe("active");
		expect(buttonSkinState(true, true, true)).toBe("disabled");
		expect(buttonSkinState(false, true, true)).toBe("disabled");
	});

	it("menuButtonSkin: the button family by state, the option bars for an option (on = active)", () => {
		const all = hasOnly(...ALL);
		expect(menuButtonSkin(all, "button", false, false, false)).toBe("ui.button");
		expect(menuButtonSkin(all, "button", false, true, false)).toBe("ui.button.focus");
		expect(menuButtonSkin(all, "button", true, false, false)).toBe("ui.button.focus");
		expect(menuButtonSkin(all, "button", false, true, true)).toBe("ui.button.disabled");
		expect(menuButtonSkin(all, "option", true, false, false)).toBe("ui.option.on");
		expect(menuButtonSkin(all, "option", false, true, false)).toBe("ui.option.off");
		const none: SkinHas = () => false;
		for (const variant of ["button", "option"] as const) {
			for (const a of [false, true]) {
				for (const f of [false, true]) {
					expect([variant, a, f, menuButtonSkin(none, variant, a, f, false)]).toEqual([
						variant,
						a,
						f,
						undefined,
					]);
				}
			}
		}
	});

	it("skinned text: uiText when focused or active, uiTextDim otherwise", () => {
		expect(skinnedButtonTextRole(false, false)).toBe("uiTextDim");
		expect(skinnedButtonTextRole(false, true)).toBe("uiText");
		expect(skinnedButtonTextRole(true, false)).toBe("uiText");
		expect(skinnedButtonTextRole(true, true)).toBe("uiText");
	});
});

describe("turned art and focus brackets (UA6)", () => {
	it("quarter turns", () => {
		expect([0, 90, 180, 270, -90, 360, 45].map(isQuarterTurn)).toEqual([
			false,
			true,
			false,
			true,
			true,
			false,
			false,
		]);
	});

	it("fitTurnedArt fits the turned size and returns the label's own size", () => {
		for (const u of SCALES) {
			expect(fitTurnedArt(8, 9, 30, 20, u, 0)).toEqual(fitArt(8, 9, 30, 20, u));
			const turned = fitTurnedArt(8, 9, 30, 20, u, 90);
			const plain = fitArt(9, 8, 30, 20, u);
			expect([u, turned.scale, turned.w, turned.h]).toEqual([u, plain.scale, plain.h, plain.w]);
		}
	});

	it("four brackets, one per corner, turned clockwise from the top-left L", () => {
		expect(UI_ART.focusCorners.map((c) => [c.rotation, c.ax, c.ay])).toEqual([
			[0, 0, 0],
			[90, 1, 0],
			[180, 1, 1],
			[270, 0, 1],
		]);
		expect(UI_ART.ids.focusCorner).toBe("ui.focus.corner");
	});

	it("a bracket's box is the art at the menu frames' whole scale; ArtImage refits it at the same scale", () => {
		for (const u of SCALES) {
			const k = artPixelScale(u, UI_ART.refPerArt);
			for (const c of UI_ART.focusCorners) {
				const box = focusCornerBox(8, 9, u, c.rotation);
				const turned = isQuarterTurn(c.rotation);
				expect([u, c.rotation, isWhole(box.w * u), isWhole(box.h * u)]).toEqual([u, c.rotation, true, true]);
				expect([u, c.rotation, math.abs(box.w * u - (turned ? 9 : 8) * k) < EPS]).toEqual([
					u,
					c.rotation,
					true,
				]);
				const fit = fitTurnedArt(8, 9, box.w, box.h, u, c.rotation);
				expect([u, c.rotation, fit.scale]).toEqual([u, c.rotation, k]);
			}
		}
	});
});
