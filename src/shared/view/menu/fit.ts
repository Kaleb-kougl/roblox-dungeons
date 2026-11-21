/**
 * Fitting the menu screens into the safe area on phones (docs/UI_ART.md "Phones"). Pure: client/ui/hud MenuFit
 * measures a screen's panel and the area it centres in and applies the result. Headlessly tested (fit.spec.ts).
 *
 * One mechanism for every full-screen panel (main menu, lobby browser / room, Options, pause, run over, tutorial
 * outro, objective card, leaderboards), in three steps, all of them on a touch device only (menuFitDevice: the
 * last-used device is touch, or the device has a touchscreen, so a phone driven by a keyboard or Studio's device
 * emulator fits too; a desktop without a touchscreen keeps exactly today's layout at every size: fitMenu is the
 * identity there):
 *   1. Compact layouts (menuCompact): a safe area shorter than MENU_FIT.compactBelow reference px (a phone in
 *      landscape) makes the screens take their compact arrangement (two button columns, the run-over breakdown beside
 *      the stats, the Options body scrolling, a lobby room's invite list in place of the member list). Narrow layouts
 *      (menuNarrow): a portrait area (a phone held upright) stacks what sits side by side (the main menu's compact
 *      column, the run over in one column) and lets the panel shrink to the lower MENU_FIT.narrowMinScale. Both are decided from the area alone, never from the panel's measured size, so a
 *      layout never flips back and forth.
 *   2. One flexible list per screen (lobby lists, the leaderboard rows, the compact Options body) shrinks first, to
 *      no less than its `min`, so the panel fits without shrinking any text.
 *   3. What still does not fit is scaled down as a whole (a UIScale on the panel, art re-snapped to whole screen px),
 *      never below MENU_FIT.minScale effective scale (the HUD scale times the factor; narrow: narrowMinScale), so tap
 *      targets stay usable.
 * The bone ornament never leaves the area and never costs the panel any size: it shows only when the panel, as
 * fitted, leaves room above it for the ornament's overhang (the panel moves down by up to half the overhang to make
 * that room); otherwise it is skipped.
 *
 * @module
 */
import { UI_ART, artDensityBox } from "shared/view/hud";
import { GAMEPAD_MENU } from "./config";
// By file: the shared/view barrel is this one's parent.
import { PORTRAIT } from "../portrait";

/**
 * The menu fit's tunables (see the file comment): the margin kept from the safe area's edges, the scale floors a panel
 * may be shrunk to, the height under which a touch screen takes the compact layouts, and the sizes of the compact and
 * narrow arrangements of the main menu, run-over and Options panels. Sizes are reference px at the HUD scale, durations
 * seconds.
 */
export const MENU_FIT = {
	/** Clear space kept from each edge of the safe area, reference px (at the fitted scale). */
	margin: 8,
	/**
	 * The smallest effective UIScale (HUD scale x fit factor) a menu is shrunk to: the desktop floor
	 * (HUD_VIEW.minScale). A 40 reference px button stays 24 pt tall, body text 12 pt. A HUD scale already under it
	 * (a phone at the 70 % HUD scale setting) is never shrunk.
	 */
	minScale: 0.6,
	/**
	 * Touch only: a safe area shorter than this (reference px at the HUD scale) takes the compact layouts: every
	 * landscape phone at 100 % (844 x 390: 415; 932 x 430: 468) and at 70 % (844 x 390: 592), while a 720 p touch
	 * screen (662) and a tablet (1024 x 768: about 860; iPad mini 1133 x 744: about 750) keep the full layouts. The
	 * tallest full layout, a scored run's end, is about 650 tall (a HUD scale under MENU_FIT.minScale cannot shrink).
	 */
	compactBelow: 650,
	/** Treat smaller changes as measuring noise (reference px; fit factor). */
	epsilon: 0.5,
	factorEpsilon: 0.001,
	/** A flexible list never shrinks below this (reference px: two and a half 36 px rows). */
	listMin: 96,
	/** Compact main menu: two button columns (2 x HUD_VIEW.buttonSize.x + gap + 2 x the panel's 16 px padding). */
	mainCompactWidth: 560,
	/**
	 * Compact run over: two columns, the header / stats / exits / verdict on the left, the score breakdown on the
	 * right (HUD_VIEW.breakdownLabelWidth + breakdownValueWidth + gap = 316 wide). Exit buttons this size, side by side.
	 */
	runOverLeftWidth: 400,
	runOverButton: { x: 190, y: 40 },
	/** Compact run over: the breakdown's line gap (HUD_VIEW.gap elsewhere). */
	runOverLineGap: 2,
	/**
	 * Compact Options: the panel's width (OPTIONS_VIEW.width 780 is a few px over a 693 x 320 phone's safe width; the
	 * widest row, the HUD scale's six 76 px steps after its 210 px label, is 702 + the scroll bar) and the most its
	 * scrolling body is drawn (it never draws taller than its content).
	 */
	optionsWidth: 760,
	optionsBodyMax: 330,
	/**
	 * The smallest effective scale a narrow (portrait) screen shrinks to: the widest panels (Options 780, the lobbies
	 * 700) on a 375 pt portrait phone (484 reference px of room at 0.75: 0.47 effective). Body text stays >= 9 pt.
	 */
	narrowMinScale: 0.45,
	/** Narrow run over: one column this wide (the breakdown, 316, and two runOverButton exits side by side fit). */
	runOverNarrowWidth: 480,
	/**
	 * A fit that turns back (grows after a shrink, shrinks after a grow) within this many seconds of the last change is
	 * a flip (stepMenuFit): the panel's size depends on its own scale (snapped frame art, a line that wraps at one factor
	 * only), so the smaller fit is kept.
	 */
	flipSeconds: 1,
} as const;

/** A size, reference px. */
export interface MenuSize {
	readonly w: number;
	readonly h: number;
}

/** Safe-area insets, screen px (pt) per side. */
export interface MenuInsets {
	readonly top: number;
	readonly left: number;
	readonly right: number;
	readonly bottom: number;
}

/** A positive finite number, else 1. */
function positive(x: number): number {
	return x > 0 && x < math.huge ? x : 1;
}

/**
 * The area a menu panel centres in, reference px: the viewport minus the safe-area insets (the ScreenGui's
 * CoreUISafeInsets AbsoluteSize), over the HUD scale. The client measures it; this is its formula (specs, and the
 * client's first guess before the first measurement).
 */
export function menuArea(viewportW: number, viewportH: number, insets: MenuInsets, uiScale: number): MenuSize {
	const u = positive(uiScale);
	return {
		w: math.max(0, viewportW - insets.left - insets.right) / u,
		h: math.max(0, viewportH - insets.top - insets.bottom) / u,
	};
}

/**
 * Upright pause (docs/PORTRAIT.md PT6): the map takes the top PORTRAIT.pauseMapShare of the area (square inside the
 * width), and the pause panel fits into the rest, `gap` reference px under it. Reference px, like menuArea. The client
 * draws it as scale + offset (PauseOverlay); this is its formula for the spec.
 */
export function pausePanelArea(area: MenuSize, gap: number): MenuSize {
	return { w: area.w, h: math.max(0, area.h * (1 - PORTRAIT.pauseMapShare) - gap) };
}

/**
 * Whether the menus fit themselves (the `touch` flag of menuCompact / menuNarrow / fitMenu): the last-used device is
 * touch, or the device has a touchscreen (UserInputService.TouchEnabled). The second keeps a phone fitted after a key
 * press (a Bluetooth keyboard; Studio's device emulator, where moving with WASD makes the keyboard the last device);
 * a touchscreen laptop at desktop size fits to the identity anyway (fit.spec.ts).
 */
export function menuFitDevice(lastDeviceTouch: boolean, touchScreen: boolean): boolean {
	return lastDeviceTouch || touchScreen;
}

/** A TV-safe inset, a fraction of the screen on each side (left / right: x, top / bottom: y). */
export interface MenuSafeShare {
	readonly x: number;
	readonly y: number;
}

const NO_INSET: MenuSafeShare = { x: 0, y: 0 };

/** The most a TV-safe inset takes from each side (a quarter: half the screen stays). */
export const MENU_SAFE_MAX_SHARE = 0.25;

/**
 * The menus' TV-safe inset (docs/GAMEPAD_MENUS.md GM12): GAMEPAD_MENU.tvSafe on a ten-foot interface
 * (GuiService:IsTenFootInterface, a console), else none, so a PC or a phone keeps exactly its area. Each side is
 * clamped to 0..0.25 (the area never inverts).
 */
export function menuSafeShare(tenFoot: boolean): MenuSafeShare {
	if (!tenFoot) return NO_INSET;
	return {
		x: math.clamp(GAMEPAD_MENU.tvSafe.x, 0, MENU_SAFE_MAX_SHARE),
		y: math.clamp(GAMEPAD_MENU.tvSafe.y, 0, MENU_SAFE_MAX_SHARE),
	};
}

/**
 * Whether a menu panel is fitted (fitMenu's `touch`, MenuFit's measuring): on a touch device (menuFitDevice), and on a
 * ten-foot interface so a panel that does not fit inside the TV-safe area shrinks into it (GM12). The compact and
 * narrow layouts stay touch only (menuCompact / menuNarrow are given menuFitDevice alone). Not ten-foot: exactly
 * menuFitDevice.
 */
export function menuFitOn(touch: boolean, tenFoot: boolean): boolean {
	return touch || tenFoot;
}

/** Whether the screens take their compact layouts: touch, and an area shorter than MENU_FIT.compactBelow. */
export function menuCompact(areaH: number, touch: boolean): boolean {
	return touch && areaH > 0 && areaH < MENU_FIT.compactBelow;
}

/**
 * Whether the screens take their narrow layouts: touch, and a portrait area (taller than wide). Every portrait phone
 * is far narrower than the full layouts (375-430 pt: 500-573 reference px at the touch scale, 625-717 at the desktop
 * floor 0.6), and a landscape phone at any HUD scale stays on its compact layouts (693 x 320 at 125 %: 635 x 279).
 * Phones and tablets turn either way (TouchControlsController: Sensor, docs/PORTRAIT.md PD1).
 */
export function menuNarrow(areaW: number, areaH: number, touch: boolean): boolean {
	return touch && areaW > 0 && areaW < areaH;
}

/**
 * How far the bone ornament rises above the panel's top edge, in the panel's own reference px: its art height at the
 * menu frames' whole screen-px density (artDensityBox, refPerArt) for the effective scale, times the part above the
 * edge (its anchor's y, UI_ART.ornament.anchorY, sits on the edge; 0.5: half above).
 */
export function ornamentOverhang(artH: number, effectiveScale: number): number {
	return artDensityBox(1, artH, positive(effectiveScale), UI_ART.refPerArt).h * UI_ART.ornament.anchorY;
}

/** One flexible list: its height now (as drawn), and the range it may take, reference px. */
export interface MenuFlex {
	readonly current: number;
	readonly min: number;
	readonly max: number;
}

/**
 * What `fitMenu` fits: a panel's measured size at fit factor 1, the area it centres in, the HUD scale, whether this is
 * a touch device and a narrow layout, the bone ornament it would draw, and its flexible list if it has one. The
 * client's MenuFit measures these and passes them in.
 */
export interface MenuFitInput {
	/** The panel's size as drawn now, at fit factor 1 (reference px), with its flexible list at `flex.current`. */
	readonly w: number;
	readonly h: number;
	/** The area it centres in (menuArea / the measured ScreenGui), reference px at the HUD scale. */
	readonly areaW: number;
	readonly areaH: number;
	/** The HUD scale (the ScreenGui's UIScale). */
	readonly uiScale: number;
	/** A touch device (menuFitDevice): only then is anything fitted. */
	readonly touch: boolean;
	/** The narrow layouts are on (menuNarrow): the floor is MENU_FIT.narrowMinScale instead of minScale. */
	readonly narrow?: boolean;
	/** The panel draws the bone ornament (asked for, on menu art, the pack has it), and that art's height, art px. */
	readonly ornament: boolean;
	readonly ornamentArtH: number;
	readonly flex?: MenuFlex;
}

/**
 * What `fitMenu` decided for a panel: the scale factor to apply on top of the HUD scale, whether the ornament is drawn
 * and how far the panel moves down to make room for it, the flexible list's height, and whether it still overflows at
 * the floor. The client's MenuFit applies it.
 */
export interface MenuFitResult {
	/** The panel's UIScale (1: as designed). */
	readonly factor: number;
	/** Draw the ornament. */
	readonly ornament: boolean;
	/** Move the panel down by this much from the area's centre, reference px at the HUD scale (room for the ornament). */
	readonly offsetY: number;
	/** The flexible list's height, reference px (undefined without one). */
	readonly flex: number | undefined;
	/** The panel, as fitted, does not fit even at the floor (it overflows its area; the screen should be compacted). */
	readonly overflow: boolean;
}

/**
 * Fits a menu panel into its area (see the file comment). Not touch: the identity (factor 1, the ornament as asked,
 * no offset, the flexible list at its max): every desktop / console layout is exactly today's. Touch:
 *   - flex: `clamp(current + spare, min, max)` where spare = the area's height less the margins less the panel's;
 *   - factor: `min(1, room / size)` per axis (room = area - 2 x margin), never below MENU_FIT.minScale / uiScale
 *     (narrow: MENU_FIT.narrowMinScale / uiScale; nor above 1); a panel bigger than its room at that floor overflows
 *     (`overflow`);
 *   - ornament: shown when `(h + overhang) x factor` fits the room height, the overhang at the fitted scale
 *     (ornamentOverhang); centred as is when `(h + 2 x overhang) x factor` fits, else moved down by `overhang x
 *     factor / 2` so the ornament's top and the panel's bottom sit an equal margin from the area's edges.
 */
export function fitMenu(input: MenuFitInput): MenuFitResult {
	const flex = input.flex;
	if (!input.touch) {
		return { factor: 1, ornament: input.ornament, offsetY: 0, flex: flex?.max, overflow: false };
	}
	const u = positive(input.uiScale);
	const roomW = math.max(0, input.areaW - 2 * MENU_FIT.margin);
	const roomH = math.max(0, input.areaH - 2 * MENU_FIT.margin);
	let h = input.h;
	let flexOut: number | undefined;
	if (flex !== undefined) {
		const lo = math.min(flex.min, flex.max);
		flexOut = math.clamp(flex.current + (roomH - h), lo, flex.max);
		h += flexOut - flex.current;
	}
	const w = input.w;
	const fitW = w > 0 ? roomW / w : 1;
	const fitH = h > 0 ? roomH / h : 1;
	const floor = math.min(1, (input.narrow === true ? MENU_FIT.narrowMinScale : MENU_FIT.minScale) / u);
	const factor = math.max(floor, math.min(1, fitW, fitH));
	const overflow = w * factor > roomW + MENU_FIT.epsilon || h * factor > roomH + MENU_FIT.epsilon;
	let ornament = false;
	let offsetY = 0;
	if (input.ornament && !overflow) {
		const over = ornamentOverhang(input.ornamentArtH, u * factor);
		if ((h + over) * factor <= roomH) {
			ornament = true;
			if ((h + 2 * over) * factor > roomH) offsetY = (over * factor) / 2;
		}
	}
	return { factor, ornament, offsetY, flex: flexOut, overflow };
}

/** Whether two fits differ by more than measuring noise (the client re-renders only then). */
export function menuFitChanged(a: MenuFitResult, b: MenuFitResult): boolean {
	if (a.ornament !== b.ornament || a.overflow !== b.overflow) return true;
	if (math.abs(a.factor - b.factor) > MENU_FIT.factorEpsilon) return true;
	if (math.abs(a.offsetY - b.offsetY) > MENU_FIT.epsilon) return true;
	if ((a.flex === undefined) !== (b.flex === undefined)) return true;
	return a.flex !== undefined && b.flex !== undefined && math.abs(a.flex - b.flex) > MENU_FIT.epsilon;
}

/**
 * What MenuFit remembers between measurements: the fit drawn now and the one drawn before it, which way the factor last
 * moved (`direction`: +1 grew, -1 shrank, 0 not yet) and when (`changedAt`, seconds, any clock), the area it was fitted
 * into, the panel's size at the last measurement and the factor it was drawn at then (`size` / `sizeAt`), and whether a
 * flip was caught (`held`: the fit may shrink but not grow).
 */
export interface MenuFitTrail {
	readonly shown: MenuFitResult;
	readonly previous: MenuFitResult | undefined;
	readonly direction: number;
	readonly changedAt: number;
	readonly area: MenuSize;
	readonly size: MenuSize | undefined;
	readonly sizeAt: number;
	readonly held: boolean;
}

/** A fresh trail: `shown` drawn in `area` since `now`, nothing measured yet. */
export function menuFitTrail(shown: MenuFitResult, area: MenuSize, now: number): MenuFitTrail {
	return { shown, previous: undefined, direction: 0, changedAt: now, area, size: undefined, sizeAt: 0, held: false };
}

/** Whether two sizes differ by more than measuring noise (MENU_FIT.epsilon on either side). */
function sizeChanged(a: MenuSize, b: MenuSize): boolean {
	return math.abs(a.w - b.w) > MENU_FIT.epsilon || math.abs(a.h - b.h) > MENU_FIT.epsilon;
}

/** Which way `to`'s factor moves from `from`'s: +1, -1, or 0 (within MENU_FIT.factorEpsilon). */
function fitDirection(from: MenuFitResult, to: MenuFitResult): number {
	if (to.factor > from.factor + MENU_FIT.factorEpsilon) return 1;
	if (to.factor < from.factor - MENU_FIT.factorEpsilon) return -1;
	return 0;
}

/**
 * Takes a new fit (fitMenu for the latest measurement) into the trail, so a fitted panel never cycles between sizes.
 * A panel's size depends on its own scale: its frame art snaps to whole screen px per art px (artPixelScale steps at
 * every half step of the effective scale, so the skinned padding jumps), and a wrapped line can wrap at one factor and
 * not at another. Shrinking to fit can then make it fit at a larger factor, where it no longer fits, and so on: a
 * cycle of two, three or more fits that never repeats exactly (the run over of a record run on a landscape phone
 * jittered every other frame). `size` is the panel as measured (reference px at the factor it is drawn at), `drawnAt`
 * that factor (the UIScale's Scale). The rules:
 *   - the same factor drawn as at the last measurement and a new size (more than MENU_FIT.epsilon on either side) is a
 *     content change: the trail starts afresh (no direction, no hold), so new content always gets its fit;
 *   - a new area (rotating the phone, a new HUD scale: more than MENU_FIT.epsilon on either side) does the same;
 *   - a fit that does not differ from the one shown (menuFitChanged) changes nothing;
 *   - a reversal within MENU_FIT.flipSeconds of the last change (a grow after a shrink, a shrink after a grow; a change
 *     with no factor move that returns to the fit before) is a flip: the smaller fit is kept (it fits: it was fitted to
 *     the larger arrangement, or measured with room to spare) and the trail is `held`;
 *   - while held, a fit may shrink (it no longer fits) but not grow or change without shrinking.
 * Returns a trail whose `shown` is a new object exactly when the panel must be redrawn.
 */
export function stepMenuFit(
	trail: MenuFitTrail,
	fitted: MenuFitResult,
	area: MenuSize,
	size: MenuSize,
	drawnAt: number,
	now: number,
): MenuFitTrail {
	let t = trail;
	const contentChanged =
		t.size !== undefined && math.abs(drawnAt - t.sizeAt) <= MENU_FIT.factorEpsilon && sizeChanged(size, t.size);
	if (contentChanged || sizeChanged(area, t.area)) {
		t = menuFitTrail(t.shown, area, t.changedAt);
	}
	t = { ...t, size, sizeAt: drawnAt };
	if (!menuFitChanged(fitted, t.shown)) return t;
	const direction = fitDirection(t.shown, fitted);
	if (t.held && direction >= 0) return t;
	const soon = now - t.changedAt <= MENU_FIT.flipSeconds;
	const flip =
		soon &&
		(direction !== 0
			? t.direction === -direction
			: t.previous !== undefined && !menuFitChanged(fitted, t.previous));
	if (flip && direction >= 0) return { ...t, held: true };
	return {
		...t,
		shown: fitted,
		previous: t.shown,
		direction: direction !== 0 ? direction : t.direction,
		changedAt: now,
		held: t.held || flip,
	};
}

/**
 * The lobby room's compact arrangement while the invite list is open (MENU_FIT): the invite panel takes the member
 * list's place and the host's visibility row hides (both come back when it closes). Not compact: everything shows.
 */
export function lobbyRoomParts(compact: boolean, inviting: boolean): { members: boolean; hostControls: boolean } {
	const replaced = compact && inviting;
	return { members: !replaced, hostControls: !replaced };
}
