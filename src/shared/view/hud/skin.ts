/**
 * The UI skin's pure logic (docs/UI_ART.md UA5, Architecture 3): whole-screen-pixel art scales for the 9-sliced frames
 * (UAD1), fitting an icon into its box at a whole scale (UAD7), and which theme ui id a primitive draws in a state,
 * along a fallback chain that ends in `undefined` (= today's flat look). Tunables in skinConfig.ts. Presentation only;
 * checked headlessly (skin.spec.ts). The client's primitives (UA6+) read these and draw.
 *
 * @module
 */
import type { SliceInsets, ThemePack } from "shared/theme";
import {
	UI_ART,
	type PanelSkin,
	type SkinButtonState,
	type SkinButtonVariant,
	type SkinPanelContext,
} from "./skinConfig";

/** `x` rounded to the nearest integer, halves up (`math.floor(x + 0.5)`; Luau's math.round sends halves away from 0). */
function roundHalfUp(x: number): number {
	return math.floor(x + 0.5);
}

/**
 * Whole screen px per art px for a frame drawn at `refPerArt` reference px per art px under a UIScale of `uiScale`:
 * `max(UI_ART.minArtScale, round(uiScale * refPerArt))`, rounded half up (1.25 x 2 = 2.5 -> 3). A UIScale that is not
 * a positive number counts as 1.
 */
export function artPixelScale(uiScale: number, refPerArt: number = UI_ART.refPerArt): number {
	const u = uiScale > 0 && uiScale < math.huge ? uiScale : 1;
	return math.max(UI_ART.minArtScale, roundHalfUp(u * refPerArt));
}

/**
 * The SliceScale (reference px per art px) whose borders land on whole screen px: `artPixelScale / uiScale`, so
 * `slice * uiScale` is the whole artPixelScale (up to float rounding; the property is float32 anyway). Exactly
 * `refPerArt` at UIScale 1, 1.5 and 2 with refPerArt 2. A UIScale that is not a positive number counts as 1.
 */
export function snappedSliceScale(uiScale: number, refPerArt: number = UI_ART.refPerArt): number {
	const u = uiScale > 0 && uiScale < math.huge ? uiScale : 1;
	return artPixelScale(u, refPerArt) / u;
}

/** An icon's drawn size, reference px, and its whole screen px per art px. */
export interface ArtFit {
	readonly w: number;
	readonly h: number;
	readonly scale: number;
}

/**
 * The largest whole scale k (screen px per art px, at least UI_ART.minArtScale) at which `artW` x `artH` art fits a
 * `boxW` x `boxH` reference-px box under UIScale `uiScale` (art * k <= box * uiScale on screen), returned as reference
 * px (art * k / uiScale) with k. If even k = 1 overflows the box, k = 1 anyway: the art is never drawn below one screen
 * px per art px (blurry), so it overflows its box (the caller centres it). A UIScale that is not a positive number
 * counts as 1; a non-positive art size gives k = 1.
 */
export function fitArt(artW: number, artH: number, boxW: number, boxH: number, uiScale: number): ArtFit {
	const u = uiScale > 0 && uiScale < math.huge ? uiScale : 1;
	let k: number = UI_ART.minArtScale;
	if (artW > 0 && artH > 0) {
		const fit = math.min((boxW * u) / artW, (boxH * u) / artH);
		k = math.max(UI_ART.minArtScale, math.floor(fit + UI_ART.fitEpsilon));
	}
	return { w: (artW * k) / u, h: (artH * k) / u, scale: k };
}

/** Each skin part's states (skinFor). */
export interface SkinStates {
	/** A Panel: where it sits. */
	panel: SkinPanelContext;
	/** A MenuButton / ListRow. */
	button: SkinButtonState;
	/** An Options value: the chosen one, the others. */
	option: "on" | "off";
	/** A heart: heartFills' 2 / 1 / 0. */
	heart: "full" | "half" | "empty";
	/** A flask charge: ready, spent. */
	flask: "full" | "empty";
	/** A pip: armor (the grey chip as drawn); tinted (the white chip, tinted by a role: Aegis, combo shards). */
	pip: "armor" | "tinted";
	/** A pill bar's track, or its (white, role-tinted) fill. */
	bar: "track" | "fill";
	/** An Ember pip: one state. */
	ember: "lit";
}

export type SkinPart = keyof SkinStates;

/** Whether the pack has an uploaded image for a logical ui id. */
export type SkinHas = (id: string) => boolean;

/** `id` when the pack has it, else undefined. */
function pick(has: SkinHas, id: string): string | undefined {
	return has(id) ? id : undefined;
}

/** The button family: art only with the base `ui.button`; a missing state image falls back to it. */
function buttonSkin(has: SkinHas, state: SkinButtonState): string | undefined {
	const ids = UI_ART.ids;
	if (!has(ids.button)) {
		return undefined;
	}
	switch (state) {
		case "focused":
		case "active":
			return pick(has, ids.buttonFocus) ?? ids.button;
		case "disabled":
			return pick(has, ids.buttonDisabled) ?? ids.button;
		default:
			return ids.button;
	}
}

/**
 * The theme ui id a primitive draws for `part` in `state`, or undefined: the pack lacks the art, draw the flat look.
 * Chains (so a row never mixes art and flat pieces, and art never lies about a state):
 *   - panel: menu -> `ui.panel.menu`, then `ui.panel.tall`; list -> `ui.panel.tall`, then `ui.panel.menu`; hud ->
 *     `ui.panel.hud` only (in a run no red-rimmed menu frame, UAD2);
 *   - button: needs `ui.button`; focused / active -> `ui.button.focus`, disabled -> `ui.button.disabled`, each falling
 *     back to `ui.button`;
 *   - option: `ui.option.on` / `.off` when the pack has both, else the button family (on = active, off = normal);
 *   - heart: `ui.heart.full` / `.half` / `.empty` only when the pack has all three (a half heart is never drawn full);
 *   - flask: `ui.flask.full` / `.empty` only when it has both;
 *   - pip: armor -> `ui.chip`; tinted -> `ui.chip.white` (a grey chip cannot be tinted to a role's colour);
 *   - bar: track -> `ui.bar.track`; fill -> `ui.bar.fill`, only over an art track;
 *   - ember -> `ui.candle`.
 * Takes a predicate, not a pack, so it is trivially testable (skinHasOf builds one from a ThemePack).
 */
export function skinFor<P extends SkinPart>(has: SkinHas, part: P, state: SkinStates[P]): string | undefined {
	const ids = UI_ART.ids;
	const panels = UI_ART.panels;
	switch (part) {
		case "panel": {
			const context = state as SkinPanelContext;
			if (context === "hud") {
				return pick(has, panels.hud);
			}
			const first = context === "list" ? panels.list : panels.menu;
			const second = context === "list" ? panels.menu : panels.list;
			return pick(has, first) ?? pick(has, second);
		}
		case "button":
			return buttonSkin(has, state as SkinButtonState);
		case "option": {
			const on = state === "on";
			if (has(ids.optionOn) && has(ids.optionOff)) {
				return on ? ids.optionOn : ids.optionOff;
			}
			return buttonSkin(has, on ? "active" : "normal");
		}
		case "heart": {
			if (!has(ids.heartFull) || !has(ids.heartHalf) || !has(ids.heartEmpty)) {
				return undefined;
			}
			return state === "full" ? ids.heartFull : state === "half" ? ids.heartHalf : ids.heartEmpty;
		}
		case "flask": {
			if (!has(ids.flaskFull) || !has(ids.flaskEmpty)) {
				return undefined;
			}
			return state === "full" ? ids.flaskFull : ids.flaskEmpty;
		}
		case "pip":
			return pick(has, state === "tinted" ? ids.chipWhite : ids.chip);
		case "bar": {
			if (!has(ids.barTrack)) {
				return undefined;
			}
			return state === "track" ? ids.barTrack : pick(has, ids.barFill);
		}
		case "ember":
			return pick(has, ids.candle);
		default:
			return undefined;
	}
}

/** skinFor's predicate for a theme pack: the id is an uploaded image (ThemePack.image). */
export function skinHasOf(pack: Pick<ThemePack, "image">): SkinHas {
	return (id) => pack.image(id) !== undefined;
}

// ---- The client primitives' decisions (docs/UI_ART.md UA6 / UA7): Panel, MenuButton, ListRow, ArtImage, FocusCorners.

/** Whether a rotation (degrees) is an odd quarter turn: the image's width and height swap on screen. */
export function isQuarterTurn(rotation: number): boolean {
	return math.abs(rotation % UI_ART.halfTurn) === UI_ART.quarterTurn;
}

/**
 * fitArt, except that art which overflows its box even at one screen px per art px shrinks to fit it exactly (a
 * fractional `scale` below UI_ART.minArtScale; Pixelated resampling drops a few art rows). For an icon whose box is
 * the room it has, not a layout slot it may spill over (the spectate bar's ghost on a small screen). Whenever a whole
 * scale fits, exactly fitArt's result.
 */
export function fitArtWithin(artW: number, artH: number, boxW: number, boxH: number, uiScale: number): ArtFit {
	const u = uiScale > 0 && uiScale < math.huge ? uiScale : 1;
	if (artW <= 0 || artH <= 0 || boxW <= 0 || boxH <= 0) return fitArt(artW, artH, boxW, boxH, uiScale);
	const fit = math.min((boxW * u) / artW, (boxH * u) / artH);
	if (fit + UI_ART.fitEpsilon >= UI_ART.minArtScale) return fitArt(artW, artH, boxW, boxH, uiScale);
	return { w: (artW * fit) / u, h: (artH * fit) / u, scale: fit };
}

/**
 * fitArt for an image drawn turned by `rotation` degrees: a quarter turn fits the art's turned size (h x w) into the
 * box. Returns the label's own (unturned) size, reference px, and the whole scale. `shrink`: fitArtWithin instead.
 */
export function fitTurnedArt(
	artW: number,
	artH: number,
	boxW: number,
	boxH: number,
	uiScale: number,
	rotation: number,
	shrink: boolean = false,
): ArtFit {
	const fitter = shrink ? fitArtWithin : fitArt;
	if (!isQuarterTurn(rotation)) {
		return fitter(artW, artH, boxW, boxH, uiScale);
	}
	const turned = fitter(artH, artW, boxW, boxH, uiScale);
	return { w: turned.h, h: turned.w, scale: turned.scale };
}

/** A box's size, reference px. */
export interface SkinBox {
	readonly w: number;
	readonly h: number;
}

/**
 * The on-screen box (reference px) of one focus bracket: `artW` x `artH` art at the menu frames' whole screen-px scale
 * (artPixelScale at UI_ART.refPerArt, the button art's border density), turned by `rotation` (a quarter turn swaps w
 * and h). ArtImage fits the art into exactly this box at that scale.
 */
export function focusCornerBox(artW: number, artH: number, uiScale: number, rotation: number): SkinBox {
	const box = artDensityBox(artW, artH, uiScale, UI_ART.refPerArt);
	return isQuarterTurn(rotation) ? { w: box.h, h: box.w } : box;
}

/**
 * `artW` x `artH` art at a frame density's whole screen-px scale (artPixelScale(uiScale, refPerArt)), as reference px:
 * the box a fixed-size piece drawn beside the frames takes (the menu ornament, a divider's height, the pill bar's
 * height), so its pixels match the frame's. A UIScale that is not a positive number counts as 1.
 */
export function artDensityBox(
	artW: number,
	artH: number,
	uiScale: number,
	refPerArt: number = UI_ART.refPerArt,
): SkinBox {
	const u = uiScale > 0 && uiScale < math.huge ? uiScale : 1;
	const k = artPixelScale(u, refPerArt);
	return { w: (artW * k) / u, h: (artH * k) / u };
}

/**
 * The context a Panel's skin is looked up in (skinFor "panel"), or undefined for "none" (always flat): its `skin`
 * prop, else "hud" for a corner panel and "menu" for every other. A `hidden` panel (a fully transparent layout box:
 * the Options tabs' bodies, the run-over stats) is always flat: it shows no fill, so it shows no frame either, and its
 * padding never grows.
 */
export function panelSkinContext(
	skin: PanelSkin | undefined,
	corner: boolean,
	hidden: boolean = false,
): SkinPanelContext | undefined {
	if (skin === "none" || hidden) {
		return undefined;
	}
	return skin ?? (corner ? "hud" : "menu");
}

/** Reference px per art px (before snapping) of a frame in `context`: hud -> UI_ART.hudRefPerArt, else refPerArt. */
export function skinRefPerArt(context: SkinPanelContext): number {
	return context === "hud" ? UI_ART.hudRefPerArt : UI_ART.refPerArt;
}

/** Per-side padding, reference px (UIPadding). */
export interface SkinPadding {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** The same padding on all four sides. */
export function uniformPadding(pad: number): SkinPadding {
	return { left: pad, top: pad, right: pad, bottom: pad };
}

/** Whether a Panel's fill transparency hides it entirely (a number >= 1; a binding fades a visible panel). */
export function panelHidden(transparency: unknown): boolean {
	return typeIs(transparency, "number") && transparency >= 1;
}

/**
 * The art px per side content keeps clear of on frame `id` (docs/UI_ART.md UA7): its measured visible border
 * (UI_ART.contentInsets), else its slice insets, else undefined (no border).
 */
export function contentInsetsOf(
	id: string,
	slice: Readonly<SliceInsets> | undefined,
): Readonly<SliceInsets> | undefined {
	return UI_ART.contentInsets[id] ?? slice;
}

/**
 * A skinned frame's padding: per side, the larger of the flat padding and the art's border on that side (`insets`,
 * art px: contentInsetsOf, the visible border, never the slice insets of a frame that has a measured one) at the drawn
 * SliceScale (reference px per art px), so content never sits on the frame's border. No insets: the flat padding.
 */
export function skinPadding(
	base: SkinPadding,
	insets: Readonly<SliceInsets> | undefined,
	sliceScale: number,
): SkinPadding {
	if (insets === undefined) {
		return base;
	}
	return {
		left: math.max(base.left, insets.left * sliceScale),
		top: math.max(base.top, insets.top * sliceScale),
		right: math.max(base.right, insets.right * sliceScale),
		bottom: math.max(base.bottom, insets.bottom * sliceScale),
	};
}

/** A MenuButton's state for skinFor: disabled wins, then active (chosen), then focused (hover / gamepad selection). */
export function buttonSkinState(active: boolean, focused: boolean, disabled: boolean): SkinButtonState {
	if (disabled) {
		return "disabled";
	}
	if (active) {
		return "active";
	}
	return focused ? "focused" : "normal";
}

/**
 * The art a MenuButton draws, or undefined (flat): the button family in its state, or for an Options value
 * (`variant` "option") the option bars, on = active.
 */
export function menuButtonSkin(
	has: SkinHas,
	variant: SkinButtonVariant,
	active: boolean,
	focused: boolean,
	disabled: boolean,
): string | undefined {
	if (variant === "option") {
		return skinFor(has, "option", active ? "on" : "off");
	}
	return skinFor(has, "button", buttonSkinState(active, focused, disabled));
}

/** A skinned MenuButton's text colour: uiText when focused or active (on the red fill), uiTextDim otherwise. */
export function skinnedButtonTextRole(active: boolean, focused: boolean): "uiText" | "uiTextDim" {
	return active || focused ? "uiText" : "uiTextDim";
}

// ---- Menus, overlays, icons and the loading bar (docs/UI_ART.md UA7 / UA8 / UA9).

/** Whether the pack draws a panel in `context` on art (skinFor "panel"). */
export function panelHasArt(has: SkinHas, context: SkinPanelContext | undefined): boolean {
	return context !== undefined && skinFor(has, "panel", context) !== undefined;
}

/**
 * Whether a panel in `context` carries the bone ornament (UAD8): asked for (`wanted`: the main menu and pause panels,
 * shared/view/menu screenOrnament), a menu panel, drawn on art, and the pack has the ornament.
 */
export function ornamentShown(has: SkinHas, context: SkinPanelContext | undefined, wanted: boolean): boolean {
	return wanted && context === "menu" && panelHasArt(has, context) && has(UI_ART.ids.ornament);
}

/** Whether a divider (ui.divider) is drawn in a panel in `context`: only on a skinned panel with the art (else nothing). */
export function dividerShown(has: SkinHas, context: SkinPanelContext | undefined): boolean {
	return panelHasArt(has, context) && has(UI_ART.ids.divider);
}

/**
 * The icon drawn beside a label (UAD9: beside, never instead of, the text: a MenuButton's, a screen header's, an audio
 * row's), or undefined: only when its host is drawn on art (`onArt`: the skinned button or panel; the flat look stays
 * exactly today's) and the pack has the icon.
 */
export function iconShown(has: SkinHas, onArt: boolean, icon: string | undefined): string | undefined {
	return onArt && icon !== undefined && has(icon) ? icon : undefined;
}

/** An audio volume row's icon: the struck-through speaker at 0, the speaker otherwise. */
export function volumeIcon(volume: number): string {
	return volume <= 0 ? UI_ART.ids.iconMute : UI_ART.ids.iconSpeaker;
}

/** The pill bar's two images (UA9), or undefined: the flat bar. Both or neither (an art track never holds a flat fill). */
export function pillBarSkin(has: SkinHas): { readonly track: string; readonly fill: string } | undefined {
	const track = skinFor(has, "bar", "track");
	const fill = skinFor(has, "bar", "fill");
	return track !== undefined && fill !== undefined ? { track, fill } : undefined;
}

/** The pill bar's drawn height, reference px: its art height at UI_ART.barRefPerArt's whole screen-px scale. */
export function pillBarHeight(artH: number, uiScale: number): number {
	return artDensityBox(1, artH, uiScale, UI_ART.barRefPerArt).h;
}
