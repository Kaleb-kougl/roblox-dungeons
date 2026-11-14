/**
 * The in-run HUD's and the touch controls' skin decisions (docs/UI_ART.md UA10-UA13): which art each status pip draws
 * in each state, the dimmed empty pips, the boss bar's pill (its whole-pixel height and fill clip), the weapon slots,
 * the score coin, the minimap frames and the touch rings. Pure and headless (hudSkin.spec.ts); built on skin.ts /
 * skinConfig.ts (UA5), whose skinFor chains decide whether the pack has the art at all. Every function returns
 * undefined (or a flat value) when the art is absent, so the client draws exactly today's flat HUD. Presentation only.
 */
import { HEART_ICON_IDS, PIP_ICON_IDS, type SliceInsets } from "shared/theme";
import { HEART_FILL, HUD_VIEW, isHalfContainer } from "./layout";
import { fitArt, skinFor, skinPadding, uniformPadding, type ArtFit, type SkinHas, type SkinPadding } from "./skin";
import { UI_ART } from "./skinConfig";
import { TOUCH_LAYOUT, type TouchButtonId } from "./touchLayout";

/** A status pip's kind (StatusPanel rows): flask charges, Ember, armor, Aegis. */
export type HudPipKind = "flask" | "ember" | "armor" | "aegis";

/** A touch control the art can draw: a button, or the move stick's base ("move"). */
export type TouchArtControl = TouchButtonId | "move";

export const HUD_SKIN = {
	/** Skin ids this file adds to skinConfig's UI_ART.ids (contract.ts uiSkinIds / uiIconIds, all optional). */
	ids: {
		slot: "ui.slot",
		coin: "ui.icon.coin",
		stickRing: "ui.stick.ring",
		touchButton: "ui.touch.button",
	},
	/**
	 * The heart box, reference px (UAD7): HUD_VIEW.heartSize (22 -> 24 with UA10), = UI_ART.iconBox.heart, so an 18 x 15
	 * heart draws at 2 screen px per art px at 1080 p. Square: the tutorial's ghost heart (TutorialFx) takes the same box.
	 */
	heartBox: HUD_VIEW.heartSize,
	/**
	 * The tallest box per pip kind, reference px (fitArt): flasks and candles stand in the hearts' rows (24, = a label
	 * line, so no status row grows), chips are pips (HUD_VIEW.pipSize). The drawn slot is trimmed to the fitted art's
	 * width (pipArtSlot), so three 18 px flasks take no more row than they need.
	 */
	pipBox: {
		flask: UI_ART.iconBox.flask,
		ember: UI_ART.iconBox.ember,
		armor: UI_ART.iconBox.pip,
		aegis: UI_ART.iconBox.pip,
	} satisfies Record<HudPipKind, number>,
	/**
	 * The pack's own armor / Aegis pips (shared/theme PIP_ICON_IDS: shields the hearts' height) take the hearts' whole
	 * square box, reference px, like a heart (not trimmed to the art: pipArtSlot), so they draw at the hearts' density
	 * and sit as far apart as the hearts.
	 */
	shieldPipBox: HUD_VIEW.heartSize,
	/** An unlit Ember pip: the same candle art at this ImageTransparency (there is no unlit candle on the sheet). */
	emberDimTransparency: 0.65,
	/** An empty armor pip: the grey chip at this ImageTransparency (the flat look's empty pip is a dim outline). */
	chipDimTransparency: 0.65,
	/** The score coin's box beside the score number, reference px: the 5 x 6 coin at 4 screen px per art px at 720 p. */
	coinBox: 24,
	/**
	 * The boss bar's pill (ui.bar.track / .fill, 16 art px tall): drawn at the largest whole screen px per art px that
	 * fits HUD_VIEW.bossBarHeight (16 since UA11, was 12: a 16 px pill cannot sit in 12 reference px at any whole scale
	 * at 720 p), i.e. 1 screen px per art px at 720 p and 1080 p, 2 at 1440 p.
	 */
	bossBarBox: HUD_VIEW.bossBarHeight,
	/** A fill fraction below this draws no fill (its clip would be under a screen pixel; 1 / fraction blows up). */
	minFillFraction: 1e-3,
	/** Reference px per art px (before snapping) of the weapon slots' ui.slot frame: the in-run density. */
	slotRefPerArt: UI_ART.hudRefPerArt,
	/**
	 * The corner minimap's frame (UA11): true = the corner Panel's hud skin, with the map host shrunk by the frame's
	 * border so the panel keeps MINIMAP_PANEL's footprint; false = the flat panel (skin "none"). Off until the Studio
	 * check (UA12): the map image is turned 45 degrees and only the corner CanvasGroup clips it, at the panel's OUTER
	 * edge, so it most likely paints over the frame's border; framing it needs its own clip inside the border first.
	 */
	minimapFramed: false,
	/** Reference px per art px (before snapping) of the full map's frame: the in-run density. */
	fullMapRefPerArt: UI_ART.hudRefPerArt,
	touch: {
		/** The controls drawn with ui.stick.ring (the sticks); every other button draws ui.touch.button. */
		sticks: ["move", "attack", "alt"] satisfies ReadonlyArray<TouchArtControl> as ReadonlyArray<TouchArtControl>,
		/**
		 * The art's opacity at 100 % touchOpacity: the flat fill's (TOUCH_LAYOUT.fillAlpha 0.55; was 0.8). Both pieces are
		 * solid dark discs (#1c1c1c inside the red ring), so at 0.8 they hid the floor; at the flat fill's alpha the floor
		 * shows through as it does under the flat circles. A held button is brighter by TOUCH_LAYOUT.pressedFillBoost.
		 */
		artAlpha: TOUCH_LAYOUT.fillAlpha,
		/**
		 * The art's inside, as a share of its radius: the red ring's inner edge (15.5 of 19.5 art px on both 39 px pieces).
		 * Labels and icons stay inside it.
		 */
		artInnerShare: 0.79,
		/** The flat circle's label area, as a share of its radius (a pad inside the round edge). */
		flatInnerShare: 0.9,
		/**
		 * Largest label text, px (UITextSizeConstraint over TextScaled; the touch GUI has no UIScale, so px are screen
		 * px): a stick's word, a button's word (or word and count), a count beside an icon.
		 */
		maxText: { stick: 18, button: 14, count: 14 },
		/** Below this a label is never drawn smaller (UITextSizeConstraint.MinTextSize). */
		minText: 6,
		/**
		 * Buttons that show an icon and their count instead of the word when the control has its art (and the icon
		 * atlas is in: it is all or nothing): Flask the full flask, Ember the candle. The flat look keeps the words.
		 */
		countIcons: { flask: "ui.flask.full", ember: "ui.candle" } as Partial<Record<TouchButtonId, string>>,
		/** The count beside an icon: a badge at the bottom right of the icon's square, as shares of that square. */
		badge: { w: 0.55, h: 0.5 },
		/**
		 * Sticks (Attack / Alt) at rest show their word where the knob would sit; the knob shows only while a finger holds
		 * the stick (the word hides then, under the thumb). The knob covered the word's middle before.
		 */
		knobAtRest: false,
	},
} as const;

/**
 * skinFor's heart state for a heartFills entry: 2 full, 1 half, 0 empty; a half container (docs/SILVER.md SV16) is its
 * whole heart's art: HALF_MAX_FULL full, HALF_MAX_EMPTY empty (heartArt cuts it in half when the pack has no half
 * container art).
 */
export function heartSkinState(fill: number): "full" | "half" | "empty" {
	if (fill === HEART_FILL.HALF_MAX_FULL) return "full";
	if (fill === HEART_FILL.HALF_MAX_EMPTY) return "empty";
	return fill >= HEART_FILL.FULL ? "full" : fill >= HEART_FILL.HALF ? "half" : "empty";
}

/** What a heart draws with the pack's art: the ui id, and whether only its left half shows (the clip fallback). */
export interface HeartArt {
	readonly id: string;
	/** Draw only the art's left half (a half container cut from the whole heart: the pack lacks the container art). */
	readonly leftHalf: boolean;
}

/**
 * The art for a heartFills entry, or undefined (the pack lacks the heart art: the flat heart). A whole heart: skinFor
 * "heart" (full / half / empty, all three or none). A half container (docs/SILVER.md SV16, OC18), only over the whole
 * heart art (a row never mixes art and flat hearts): the pack's own `ui.heart.halfmax` / `.halfmax.empty` when it has
 * both (shared/theme HEART_ICON_IDS), else the whole full / empty heart with `leftHalf` (the client shows its left half:
 * the containers are cut from the hearts the same way).
 */
export function heartArt(has: SkinHas, fill: number): HeartArt | undefined {
	const base = skinFor(has, "heart", heartSkinState(fill));
	if (base === undefined) return undefined;
	if (!isHalfContainer(fill)) return { id: base, leftHalf: false };
	if (has(HEART_ICON_IDS.halfmax) && has(HEART_ICON_IDS.halfmaxEmpty)) {
		const full = fill === HEART_FILL.HALF_MAX_FULL;
		return { id: full ? HEART_ICON_IDS.halfmax : HEART_ICON_IDS.halfmaxEmpty, leftHalf: false };
	}
	return { id: base, leftHalf: true };
}

/** What a status pip draws: the art id, its ImageTransparency, and whether it takes the pip's colour role as a tint. */
export interface PipArt {
	readonly id: string;
	readonly transparency: number;
	readonly tinted: boolean;
	/**
	 * Drawn like a heart: the art in this whole square box (reference px, HUD_SKIN.shieldPipBox); absent, the slot is
	 * pipArtSlot's (the kind's box, trimmed to the fitted art's width).
	 */
	readonly box?: number;
}

/**
 * The art for a status pip of `kind`, `filled` or not, or undefined (the pack lacks it: the flat Pip):
 *   - flask: ui.flask.full / .empty (skinFor: both or neither);
 *   - ember: ui.candle, an unlit one at HUD_SKIN.emberDimTransparency;
 *   - armor: the pack's own armor pips (shared/theme PIP_ICON_IDS: ui.pip.armor / .armor.empty, both or neither, drawn
 *     as is, in the hearts' box HUD_SKIN.shieldPipBox), else ui.chip, an empty one at HUD_SKIN.chipDimTransparency;
 *   - aegis: the pack's own ui.pip.aegis (drawn in its own colours, in the hearts' box), else ui.chip.white tinted by
 *     its role (always filled: an Aegis pip exists only while held).
 */
export function pipArt(has: SkinHas, kind: HudPipKind, filled: boolean): PipArt | undefined {
	switch (kind) {
		case "flask": {
			const id = skinFor(has, "flask", filled ? "full" : "empty");
			return id !== undefined ? { id, transparency: 0, tinted: false } : undefined;
		}
		case "ember": {
			const id = skinFor(has, "ember", "lit");
			return id !== undefined
				? { id, transparency: filled ? 0 : HUD_SKIN.emberDimTransparency, tinted: false }
				: undefined;
		}
		case "armor": {
			if (has(PIP_ICON_IDS.armor) && has(PIP_ICON_IDS.armorEmpty)) {
				return {
					id: filled ? PIP_ICON_IDS.armor : PIP_ICON_IDS.armorEmpty,
					transparency: 0,
					tinted: false,
					box: HUD_SKIN.shieldPipBox,
				};
			}
			const id = skinFor(has, "pip", "armor");
			return id !== undefined
				? { id, transparency: filled ? 0 : HUD_SKIN.chipDimTransparency, tinted: false }
				: undefined;
		}
		case "aegis": {
			if (has(PIP_ICON_IDS.aegis)) {
				return { id: PIP_ICON_IDS.aegis, transparency: 0, tinted: false, box: HUD_SKIN.shieldPipBox };
			}
			const id = skinFor(has, "pip", "tinted");
			return id !== undefined ? { id, transparency: 0, tinted: true } : undefined;
		}
		default:
			return undefined;
	}
}

/** A drawn slot, reference px: the frame an ArtImage fills. */
export interface ArtSlot {
	readonly w: number;
	readonly h: number;
}

/**
 * The slot (reference px) a `artW` x `artH` pip art takes in its row under UIScale `uiScale`: as tall as its kind's box
 * (HUD_SKIN.pipBox, so rows keep their height), as wide as the art fitted into that square box (fitArt: whole screen
 * px per art px), so the pips sit a HUD gap apart like the flat ones. In a very small window the art cannot fit at 1
 * screen px per art px (fitArt draws it at 1 anyway): the slot is then the art's own width, so pips never overlap.
 */
export function pipArtSlot(kind: HudPipKind, artW: number, artH: number, uiScale: number): ArtSlot {
	const box = HUD_SKIN.pipBox[kind];
	const fit = fitArt(artW, artH, box, box, uiScale);
	return { w: fit.w, h: box };
}

/** The boss bar pill: its drawn height (reference px), the SliceScale of its end caps, and the whole scale. */
export interface PillFit {
	readonly h: number;
	readonly sliceScale: number;
	readonly scale: number;
}

/**
 * A pill bar `artH` art px tall drawn in a `boxH` reference px tall row under UIScale `uiScale`: the largest whole
 * screen px per art px k whose pill fits the box (fitArt; never below 1, so a very small window overflows the box),
 * the height artH * k / uiScale and the SliceScale k / uiScale (the end caps at the same k). The bar's width is the
 * row's: the pill's centre stretches horizontally only, where it is uniform.
 */
export function pillFit(artH: number, boxH: number, uiScale: number): PillFit {
	const fit: ArtFit = fitArt(artH, artH, boxH, boxH, uiScale);
	const u = uiScale > 0 && uiScale < math.huge ? uiScale : 1;
	return { h: fit.h, sliceScale: fit.scale / u, scale: fit.scale };
}

/**
 * A pill fill clipped to a fraction (no squashed pill end): the clip frame's width share `clip` (ClipsDescendants)
 * and the art's width share of the clip, `inner` = 1 / clip, so the art inside is always the whole track's width.
 * Below HUD_SKIN.minFillFraction (or not a number) nothing shows.
 */
export interface FillClip {
	readonly clip: number;
	readonly inner: number;
	readonly visible: boolean;
}

export function fillClip(fraction: number): FillClip {
	const f = fraction > 0 ? math.min(fraction, 1) : 0;
	if (f < HUD_SKIN.minFillFraction) return { clip: 0, inner: 1, visible: false };
	return { clip: f, inner: 1 / f, visible: true };
}

/**
 * A frame's border on each side, reference px, at SliceScale `sliceScale`, from `insets` (pass the measured visible
 * border, skin.ts contentInsetsOf, so it matches the Panel's padding; none: 0).
 */
export function sliceBorder(slice: Readonly<SliceInsets> | undefined, sliceScale: number): SkinPadding {
	return skinPadding(uniformPadding(0), slice, sliceScale);
}

/** A `w` x `h` box less a border on every side (never negative): the corner minimap's host inside its frame. */
export function insetSize(w: number, h: number, border: SkinPadding): ArtSlot {
	return { w: math.max(0, w - border.left - border.right), h: math.max(0, h - border.top - border.bottom) };
}

/** The art a touch control draws, or undefined (the flat circle): sticks ui.stick.ring, buttons ui.touch.button. */
export function touchArtId(has: SkinHas, control: TouchArtControl): string | undefined {
	const id = HUD_SKIN.touch.sticks.includes(control) ? HUD_SKIN.ids.stickRing : HUD_SKIN.ids.touchButton;
	return has(id) ? id : undefined;
}

/**
 * The drawn size (screen px) of `artPx`-wide round touch art on a control `diameterPx` across: the largest whole
 * multiple of the art that fits inside the control's circle (at least one), so the ring stays crisp, never draws past
 * the circle the layout keeps clear of the corner panels and of its neighbours, and never rounds UP to the next, much
 * chunkier multiple (it used to take the nearest: a 98 px Attack drew 117 px at 3 px per art px). The hit circle may
 * then be up to one art step wider than the drawing (a forgiving touch). The touch GUI has no UIScale: px are screen px.
 */
export function touchArtSize(diameterPx: number, artPx: number): number {
	if (!(artPx > 0)) return 0;
	const k = math.max(UI_ART.minArtScale, math.floor(diameterPx / artPx + UI_ART.fitEpsilon));
	return artPx * k;
}

/**
 * The touch art's ImageTransparency at `alpha` (the opacity setting as a share, or the move stick's idle share of it):
 * 1 - alpha * HUD_SKIN.touch.artAlpha, a held control brighter by TOUCH_LAYOUT.pressedFillBoost, capped at opaque.
 */
export function touchArtTransparency(alpha: number, held: boolean): number {
	const a = alpha * HUD_SKIN.touch.artAlpha * (held ? TOUCH_LAYOUT.pressedFillBoost : 1);
	return 1 - math.clamp(a, 0, 1);
}

/** A box inside a touch control, px from the control's top left (its 2r x 2r button). */
export interface TouchBox {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** The icon a count button shows instead of its word (HUD_SKIN.touch.countIcons), or undefined (the word). */
export function touchCountIcon(has: SkinHas, control: TouchButtonId, skinned: boolean): string | undefined {
	if (!skinned) return undefined;
	const id = HUD_SKIN.touch.countIcons[control];
	return id !== undefined && has(id) ? id : undefined;
}

/** A control's face: its label (a word, a word and count, or a count beside an icon) and where each part sits. */
export interface TouchFace {
	/** "word": the name; "wordCount": the name and count, wrapped (flat Flask / Ember); "iconCount": icon + count. */
	readonly kind: "word" | "wordCount" | "iconCount";
	/** The text's box (the count badge for iconCount). TextScaled inside it, capped at maxText. */
	readonly text: TouchBox;
	readonly maxText: number;
	/** The text may wrap (wordCount: name over count). */
	readonly wrap: boolean;
	/** iconCount: the icon's drawn box, a whole multiple of its art (at least one), centred. */
	readonly icon: TouchBox | undefined;
}

const COS_30 = math.sqrt(3) / 2;
const SIN_30 = 0.5;
const SQRT_HALF = math.sqrt(0.5);

/**
 * Where a touch control's label goes (docs/UI_ART.md UA13), px from its button's top left (`diameterPx` square).
 * Everything sits inside the drawn disc's inside: the art's (`artSizePx`, touchArtSize, up to its red ring:
 * HUD_SKIN.touch.artInnerShare) or, flat (`artSizePx` undefined), the circle's (flatInnerShare), centred.
 *   - a word: the widest box of 2:1-ish proportions inscribed in that circle (30 degrees: w = sqrt 3 r, h = r);
 *   - a word and its count (flat Flask / Ember): the inscribed square, wrapped onto two lines;
 *   - an icon and its count (`icon` = the icon art's size, art px: touchCountIcon): the icon at the largest whole
 *     multiple fitting the inscribed square (at least one), the count as a badge at that square's bottom right.
 * The text is TextScaled inside its box with the kind's maxText (sticks larger), so it can never spill.
 */
export function touchFace(
	control: TouchButtonId,
	diameterPx: number,
	artSizePx: number | undefined,
	hasCount: boolean,
	icon: { readonly w: number; readonly h: number } | undefined,
): TouchFace {
	const t = HUD_SKIN.touch;
	const disc = artSizePx ?? diameterPx;
	const inner = (disc / 2) * (artSizePx !== undefined ? t.artInnerShare : t.flatInnerShare);
	const c = diameterPx / 2;
	const stick = HUD_SKIN.touch.sticks.includes(control);
	const square = 2 * inner * SQRT_HALF;
	const centred = (w: number, h: number): TouchBox => ({ x: c - w / 2, y: c - h / 2, w, h });
	if (icon !== undefined && hasCount && icon.w > 0 && icon.h > 0) {
		const k = math.max(
			UI_ART.minArtScale,
			math.floor(math.min(square / icon.w, square / icon.h) + UI_ART.fitEpsilon),
		);
		const bw = square * t.badge.w;
		const bh = square * t.badge.h;
		const edge = c + square / 2;
		return {
			kind: "iconCount",
			text: { x: edge - bw, y: edge - bh, w: bw, h: bh },
			maxText: t.maxText.count,
			wrap: false,
			icon: centred(icon.w * k, icon.h * k),
		};
	}
	if (hasCount) {
		return {
			kind: "wordCount",
			text: centred(square, square),
			maxText: t.maxText.button,
			wrap: true,
			icon: undefined,
		};
	}
	return {
		kind: "word",
		text: centred(2 * inner * COS_30, 2 * inner * SIN_30),
		maxText: stick ? t.maxText.stick : t.maxText.button,
		wrap: false,
		icon: undefined,
	};
}

/** What a stick (Attack / Alt) shows: its knob while held (or always, HUD_SKIN.touch.knobAtRest), its word otherwise. */
export function touchStickParts(held: boolean): { readonly knob: boolean; readonly label: boolean } {
	return { knob: held || HUD_SKIN.touch.knobAtRest, label: !held };
}
