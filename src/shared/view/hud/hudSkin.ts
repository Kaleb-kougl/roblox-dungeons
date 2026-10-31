/**
 * The in-run HUD's and the touch controls' skin decisions (docs/UI_ART.md UA10-UA13): which art each status pip draws
 * in each state, the dimmed empty pips, the boss bar's pill (its whole-pixel height and fill clip), the weapon slots,
 * the score coin, the minimap frames and the touch rings. Pure and headless (hudSkin.spec.ts); built on skin.ts /
 * skinConfig.ts (UA5), whose skinFor chains decide whether the pack has the art at all. Every function returns
 * undefined (or a flat value) when the art is absent, so the client draws exactly today's flat HUD. Presentation only.
 */
import type { SliceInsets } from "shared/theme";
import { HUD_VIEW } from "./layout";
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
		 * The art's opacity at 100 % touchOpacity (the flat fill's TOUCH_LAYOUT.fillAlpha is 0.55: the art is a frame, not a
		 * see-through disc); a held button is brighter by TOUCH_LAYOUT.pressedFillBoost, capped at opaque.
		 */
		artAlpha: 0.8,
	},
} as const;

/** skinFor's heart state for a heartFills entry: 2 full, 1 half, 0 empty. */
export function heartSkinState(fill: number): "full" | "half" | "empty" {
	return fill >= 2 ? "full" : fill >= 1 ? "half" : "empty";
}

/** What a status pip draws: the art id, its ImageTransparency, and whether it takes the pip's colour role as a tint. */
export interface PipArt {
	readonly id: string;
	readonly transparency: number;
	readonly tinted: boolean;
}

/**
 * The art for a status pip of `kind`, `filled` or not, or undefined (the pack lacks it: the flat Pip):
 *   - flask: ui.flask.full / .empty (skinFor: both or neither);
 *   - ember: ui.candle, an unlit one at HUD_SKIN.emberDimTransparency;
 *   - armor: ui.chip, an empty one at HUD_SKIN.chipDimTransparency;
 *   - aegis: ui.chip.white tinted by its role (always filled: an Aegis pip exists only while held).
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
			const id = skinFor(has, "pip", "armor");
			return id !== undefined
				? { id, transparency: filled ? 0 : HUD_SKIN.chipDimTransparency, tinted: false }
				: undefined;
		}
		case "aegis": {
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
 * The drawn size (screen px) of `artPx`-wide round touch art on a control `diameterPx` across: the nearest whole
 * multiple of the art (at least one), so the ring stays crisp and within half an art step of the control's circle.
 * The touch GUI has no UIScale: its px are screen px.
 */
export function touchArtSize(diameterPx: number, artPx: number): number {
	if (!(artPx > 0)) return 0;
	const k = math.max(UI_ART.minArtScale, math.floor(diameterPx / artPx + 0.5));
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
