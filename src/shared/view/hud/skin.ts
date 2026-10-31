/**
 * The UI skin's pure logic (docs/UI_ART.md UA5, Architecture 3): whole-screen-pixel art scales for the 9-sliced frames
 * (UAD1), fitting an icon into its box at a whole scale (UAD7), and which theme ui id a primitive draws in a state,
 * along a fallback chain that ends in `undefined` (= today's flat look). Tunables in skinConfig.ts. Presentation only;
 * checked headlessly (skin.spec.ts). The client's primitives (UA6+) read these and draw.
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
 * fitArt for an image drawn turned by `rotation` degrees: a quarter turn fits the art's turned size (h x w) into the
 * box. Returns the label's own (unturned) size, reference px, and the whole scale.
 */
export function fitTurnedArt(
	artW: number,
	artH: number,
	boxW: number,
	boxH: number,
	uiScale: number,
	rotation: number,
): ArtFit {
	if (!isQuarterTurn(rotation)) {
		return fitArt(artW, artH, boxW, boxH, uiScale);
	}
	const turned = fitArt(artH, artW, boxW, boxH, uiScale);
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
	const u = uiScale > 0 && uiScale < math.huge ? uiScale : 1;
	const k = artPixelScale(u, UI_ART.refPerArt);
	const w = (artW * k) / u;
	const h = (artH * k) / u;
	return isQuarterTurn(rotation) ? { w: h, h: w } : { w, h };
}

/**
 * The context a Panel's skin is looked up in (skinFor "panel"), or undefined for "none" (always flat): its `skin`
 * prop, else "hud" for a corner panel and "menu" for every other.
 */
export function panelSkinContext(skin: PanelSkin | undefined, corner: boolean): SkinPanelContext | undefined {
	if (skin === "none") {
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

/**
 * A skinned frame's padding: per side, the larger of the flat padding and the art's inset on that side at the drawn
 * SliceScale (reference px per art px), so content never sits on the frame's border. No slice: the flat padding.
 */
export function skinPadding(
	base: SkinPadding,
	slice: Readonly<SliceInsets> | undefined,
	sliceScale: number,
): SkinPadding {
	if (slice === undefined) {
		return base;
	}
	return {
		left: math.max(base.left, slice.left * sliceScale),
		top: math.max(base.top, slice.top * sliceScale),
		right: math.max(base.right, slice.right * sliceScale),
		bottom: math.max(base.bottom, slice.bottom * sliceScale),
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
