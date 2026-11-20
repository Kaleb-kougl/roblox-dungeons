/**
 * Where the touch controls sit (docs/MOBILE.md MB2), pure. Positions are reference px measured from the ACTION side's
 * bottom corner of the safe area (the right edge, or the left when left-handed): x inward from that side edge, y up
 * from the bottom. The cluster hugs its corner (owner 2026-10-31: "closer to the corners and less spaced out"): Attack
 * near the corner, the other buttons packed on two arcs around it TOUCH_LAYOUT.neighbourGap apart, the move stick's
 * idle home in the other bottom corner. touchLayout() scales them so no control reaches the status / score panels'
 * budget boxes (plus TOUCH_LAYOUT.clusterGap: touchPanelKeepOut) or, given `hudBoxes`, the touch strip's boxes
 * (touchStripKeepOut: the strip replaces those panels on touch, docs/UI_ART.md "Phones"), each side's controls stay in
 * their corner box (TOUCH_LAYOUT.cornerBox) and out of the screen's middle third (TOUCH_LAYOUT.centreBand), never below
 * TOUCH_LAYOUT.minScale; where `play` cannot keep clear at minScale (a short safe area under the corner panels at a
 * large HUD scale) it takes the lower `compact` cluster, and only below that the scale drops under minScale (never
 * under the smallest tappable circle); last of all the corner rules give way (TouchLayoutResult.inCorner).
 *
 * Upright (a safe area taller than wide, docs/PORTRAIT.md PT5) the corner rules are a band instead: the action side's
 * controls within PORTRAIT.actionShare of the width from its side, the move side's (the move home, spectate's Prev)
 * within the rest, all within PORTRAIT.controlBandShare of the height from the bottom; no centre-band rule (the player
 * stands above the band, shared/view cameraFraming's lift). The move zone starts PORTRAIT.moveZoneShare of the height
 * from the bottom. Landscape keeps every rule.
 *
 * @module
 */
import { TOUCH } from "shared/config";
import { cornerRect, HUD_FOOTPRINT, TOUCH_ALWAYS_ON_PANELS } from "./footprint";
import type { FootprintBox, ScreenRect } from "./footprint";
import { computeHudScale } from "./layout";
// By file, as ../iso: the shared/view barrel is the parent of this one.
import { PORTRAIT } from "../portrait";

export type TouchButtonId =
	| "attack"
	| "alt"
	| "roll"
	| "ember"
	| "flask"
	| "swap"
	| "shrine"
	| "spectateNext"
	| "spectatePrev";

export type TouchLayoutMode = "play" | "spectate";

/**
 * One touch button as a circle: centre `x` inward and `y` up from its side's bottom corner of the safe area, radius
 * `r`, all in reference px (before touchLayout() scales them).
 */
export interface CircleSpec {
	readonly id: TouchButtonId;
	readonly x: number;
	readonly y: number;
	readonly r: number;
	/** "action" side (default right) or the "move" side (spectate's Prev). */
	readonly side: "action" | "move";
}

export const TOUCH_LAYOUT = {
	/** Between KV_GameHud (HUD_VIEW.hudDisplayOrder) and the menus (HUD_VIEW.menuDisplayOrder). */
	displayOrder: 11,
	minScale: 0.55,
	/** Reference px between the corner panels' budget boxes and the controls. */
	clusterGap: 8,
	/** The move zone's widest share of the safe area's width. */
	moveZoneWidthShare: 0.4,
	/** The move stick's idle ring, from the move side's bottom corner (both clusters). */
	moveHome: { x: 70, y: 70, r: 60 },
	/**
	 * Each side's controls stay inside a box from their bottom corner of the safe area, as shares of its width and
	 * height (the scale gives way first): the action cluster never spreads over the right half.
	 */
	cornerBox: { w: 0.45, h: 0.75 },
	/**
	 * No control's centre in the middle `centreBand` of the screen's width (the middle third), the safe area taken as
	 * centred in the viewport (a landscape phone's notch insets are symmetric): the player stands there.
	 */
	centreBand: 1 / 3,
	/** Reference px between neighbouring controls in `play` / `compact` (their positions are packed with it). */
	neighbourGap: 4,
	/** Halvings of the scale search (touchLayout: the largest scale that keeps clear, to ~1e-7 of the range). */
	fitSteps: 24,
	/** Smallest circle diameter (px) the spec accepts. */
	minDiameterPx: 40,
	/** Fill alpha at 100 % opacity, and the pressed fill's multiplier (capped at 1). */
	fillAlpha: 0.55,
	pressedFillBoost: 1.6,
	/** The knob's share of its button (Attack / Alt) or of the move base. */
	knobShare: 0.4,
	/** The move stick's idle ring and knob, as a share of the opacity setting (half opacity at rest). */
	idleShare: 0.5,
	/** The move base ring's stroke thickness, px. */
	ringStroke: 2,
	/** Correction (px) added to a touch point's position in GUI space (the MB0 spike measures it); 0 until measured. */
	guiOffset: { x: 0, y: 0 },
	/**
	 * Attack in the corner (10 px from both safe edges); the inner arc around it, Roll (on the bottom edge), Alt, Flask
	 * and Ember (on the side edge); the outer arc, Swap (left of Roll and Alt) and Accept (over Alt and Flask). Every
	 * neighbour TOUCH_LAYOUT.neighbourGap apart (rounded to whole px): 307 x 268 reference px.
	 */
	play: [
		{ id: "attack", x: 85, y: 85, r: 75, side: "action" },
		{ id: "roll", x: 201, y: 52, r: 42, side: "action" },
		{ id: "alt", x: 195, y: 144, r: 46, side: "action" },
		{ id: "flask", x: 124, y: 194, r: 37, side: "action" },
		{ id: "ember", x: 47, y: 195, r: 37, side: "action" },
		{ id: "swap", x: 270, y: 99, r: 37, side: "action" },
		{ id: "shrine", x: 193, y: 231, r: 37, side: "action" },
	] as ReadonlyArray<CircleSpec>,
	/**
	 * The short-screen cluster (used when `play` cannot keep clear of the corner panels' boxes at minScale or above: the
	 * score box takes the top of the action corner): at most 190 reference px tall (`play`: 268), so it fits under the
	 * corner panels at minScale on a 251 pt tall safe area. Attack, Roll and Alt as in `play`; Ember / Swap and Flask /
	 * Accept in two columns of two left of them, every neighbour TOUCH_LAYOUT.neighbourGap apart (399 wide).
	 */
	compact: [
		{ id: "attack", x: 85, y: 85, r: 75, side: "action" },
		{ id: "roll", x: 201, y: 52, r: 42, side: "action" },
		{ id: "alt", x: 195, y: 144, r: 46, side: "action" },
		{ id: "ember", x: 284, y: 47, r: 37, side: "action" },
		{ id: "swap", x: 280, y: 125, r: 37, side: "action" },
		{ id: "flask", x: 362, y: 47, r: 37, side: "action" },
		{ id: "shrine", x: 358, y: 125, r: 37, side: "action" },
	] as ReadonlyArray<CircleSpec>,
	/** Spectating: Next in the action corner, Prev in the move corner (where the move stick rests in play). */
	spectate: [
		{ id: "spectateNext", x: 70, y: 70, r: 60, side: "action" },
		{ id: "spectatePrev", x: 70, y: 70, r: 60, side: "move" },
	] as ReadonlyArray<CircleSpec>,
} as const;

/** The viewports the touch layout spec checks (px). */
export const TOUCH_TEST_VIEWPORTS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
	{ x: 667, y: 375 },
	{ x: 844, y: 390 },
	/** A short phone (the owner's, from a screenshot: the cluster used to clamp at minScale into the score panel). */
	{ x: 714, y: 330 },
	{ x: 932, y: 430 },
	{ x: 1024, y: 768 },
	{ x: 1180, y: 820 },
	{ x: 1366, y: 1024 },
];

/** A placed point (a stick's idle ring has no button id), px, origin at the safe area's top left. */
export interface TouchPoint {
	readonly cx: number;
	readonly cy: number;
	readonly r: number;
}

/** A placed button, px, origin at the safe area's top left. */
export interface TouchCircle extends TouchPoint {
	readonly id: TouchButtonId;
}

/** Which play cluster touchLayout placed: the usual one, or the short-screen one (TOUCH_LAYOUT.compact). */
export type TouchLayoutVariant = "play" | "compact";

export interface TouchLayoutResult {
	/** The controls' scale (reference px -> px). */
	readonly scale: number;
	/** The play cluster used (spectate places its own two buttons at the same scale). */
	readonly variant: TouchLayoutVariant;
	/** The corner panels' boxes (and the gap) no control may enter, px in the safe area (touchPanelKeepOut). */
	readonly keepOut: ReadonlyArray<ScreenRect>;
	/**
	 * Every control (both hands) keeps clear of `keepOut` and inside the safe area. False only when even the compact
	 * cluster at the smallest tappable scale cannot (no test screen; the spec holds it true).
	 */
	readonly clear: boolean;
	/**
	 * Every control also stays in its corner (TOUCH_LAYOUT cornerBox / centreBand). False only under the corner panels'
	 * boxes on a short phone at a large HUD scale (the strip, which replaces them on touch, always leaves the room).
	 */
	readonly inCorner: boolean;
	/** The HUD scale the corner panels use on touch (computeHudScale with touch = true). */
	readonly hudScale: number;
	/** px from the safe area's top that the corner panels' boxes (and their gap) take: the lowest keepOut bottom. */
	readonly topBand: number;
	/** The move zone (play mode only). */
	readonly moveZone: ScreenRect | undefined;
	readonly moveHome: TouchPoint | undefined;
	readonly buttons: ReadonlyArray<TouchCircle>;
	readonly stickRadiusPx: number;
}

const PERCENT = 100;

/** True when the circle and the rect share a positive area (a circle touching an edge does not hit it). */
export function circleHitsRect(p: TouchPoint, z: ScreenRect): boolean {
	const nx = math.clamp(p.cx, z.x, z.x + z.w);
	const ny = math.clamp(p.cy, z.y, z.y + z.h);
	const dx = p.cx - nx;
	const dy = p.cy - ny;
	return dx * dx + dy * dy < p.r * p.r;
}

/** A small slack (px) for float noise when a circle exactly touches a box or the safe area's edge. */
const CLEAR_EPS = 1e-6;
const HALF = 0.5;

/** Every point lies inside the `safeW` x `safeH` safe area and enters no `keepOut` rect. */
export function touchControlsClear(
	points: ReadonlyArray<TouchPoint>,
	keepOut: ReadonlyArray<ScreenRect>,
	safeW: number,
	safeH: number,
): boolean {
	for (const p of points) {
		const r = p.r - CLEAR_EPS;
		if (p.cx - r < 0 || p.cy - r < 0 || p.cx + r > safeW || p.cy + r > safeH) return false;
		const q = { cx: p.cx, cy: p.cy, r };
		for (const z of keepOut) if (circleHitsRect(q, z)) return false;
	}
	return true;
}

/**
 * The corner panels' budget boxes on touch (TOUCH_ALWAYS_ON_PANELS: status, score; HUD_FOOTPRINT at the touch HUD
 * scale, HUD_VIEW.margin from the HUD's edges), each grown by TOUCH_LAYOUT.clusterGap on every side, px in the touch
 * safe area. `hud` is the HUD ScreenGui's rect in that space (the client measures it; both sit in CoreUISafeInsets,
 * so it is normally the safe area itself).
 */
export function touchPanelKeepOut(
	viewportW: number,
	viewportH: number,
	hudPercent: number,
	hud: ScreenRect,
): ReadonlyArray<ScreenRect> {
	const hudScale = computeHudScale(viewportW, viewportH, false, hudPercent, true);
	const gap = TOUCH_LAYOUT.clusterGap * hudScale;
	return TOUCH_ALWAYS_ON_PANELS.map((panel) => {
		const b: FootprintBox = HUD_FOOTPRINT[panel];
		const r = cornerRect(b.corner, b.maxW, b.maxH, hud.w, hud.h, hudScale);
		return { x: hud.x + r.x - gap, y: hud.y + r.y - gap, w: r.w + gap * 2, h: r.h + gap * 2 };
	});
}

/**
 * The touch strip's boxes (shared/view/hud touchStrip `footprint`: its fade group and the boss slot, measured in the
 * touch safe area) grown by TOUCH_LAYOUT.clusterGap at the touch HUD scale on every side: the keep-out on touch, where
 * the strip replaces the status and score corner panels (docs/UI_ART.md "Phones").
 */
export function touchStripKeepOut(boxes: ReadonlyArray<ScreenRect>, hudScale: number): ReadonlyArray<ScreenRect> {
	const gap = TOUCH_LAYOUT.clusterGap * hudScale;
	return boxes.map((r) => ({ x: r.x - gap, y: r.y - gap, w: r.w + gap * 2, h: r.h + gap * 2 }));
}

interface HomeSpec {
	readonly x: number;
	readonly y: number;
	readonly r: number;
}

/** The smallest radius of any control, reference px (the floor scale keeps it TOUCH_LAYOUT.minDiameterPx across). */
function smallestRadius(): number {
	let m = math.huge;
	for (const list of [TOUCH_LAYOUT.play, TOUCH_LAYOUT.compact, TOUCH_LAYOUT.spectate])
		for (const c of list) m = math.min(m, c.r);
	return math.min(m, TOUCH_LAYOUT.moveHome.r);
}

/**
 * A cluster, its move home and the spectate buttons at scale `s`, the action side on the right (`actionRight`) or
 * the left.
 */
function placeCluster(
	spec: ReadonlyArray<CircleSpec>,
	home: HomeSpec,
	s: number,
	safeW: number,
	safeH: number,
	actionRight: boolean,
): TouchPoint[] {
	const out: TouchPoint[] = [];
	// The spectate buttons too: one scale serves both modes, so it does not jump when a player starts spectating.
	for (const list of [spec, TOUCH_LAYOUT.spectate]) {
		for (const c of list) {
			const inward = (c.side === "action") === actionRight;
			out.push({ cx: inward ? safeW - c.x * s : c.x * s, cy: safeH - c.y * s, r: c.r * s });
		}
	}
	out.push({ cx: actionRight ? home.x * s : safeW - home.x * s, cy: safeH - home.y * s, r: home.r * s });
	return out;
}

/**
 * Every control of the cluster, its move home and the spectate buttons stays in its corner at scale `s`: inside
 * TOUCH_LAYOUT.cornerBox from its side's bottom corner, its centre out of the screen's middle TOUCH_LAYOUT.centreBand
 * (the safe area `safeW` wide taken as centred in the `viewportW` wide screen). The same for either hand.
 */
function clusterInCorner(
	spec: ReadonlyArray<CircleSpec>,
	home: HomeSpec,
	s: number,
	viewportW: number,
	safeW: number,
	safeH: number,
): boolean {
	if (safeH > safeW) return clusterInBand(spec, home, s, safeW, safeH);
	const maxW = TOUCH_LAYOUT.cornerBox.w * safeW + CLEAR_EPS;
	const maxH = TOUCH_LAYOUT.cornerBox.h * safeH + CLEAR_EPS;
	const maxCentre = (safeW - viewportW * TOUCH_LAYOUT.centreBand) * HALF + CLEAR_EPS;
	const ok = (c: HomeSpec) => (c.x + c.r) * s <= maxW && (c.y + c.r) * s <= maxH && c.x * s <= maxCentre;
	for (const list of [spec, TOUCH_LAYOUT.spectate]) for (const c of list) if (!ok(c)) return false;
	return ok(home);
}

/**
 * Upright (docs/PORTRAIT.md PT5): every control within the bottom PORTRAIT.controlBandShare of the safe height, the
 * action side's within PORTRAIT.actionShare of the width from its side, the move side's (home, spectate's Prev)
 * within the rest from theirs, so the two hands never meet.
 */
function clusterInBand(
	spec: ReadonlyArray<CircleSpec>,
	home: HomeSpec,
	s: number,
	safeW: number,
	safeH: number,
): boolean {
	const maxH = PORTRAIT.controlBandShare * safeH + CLEAR_EPS;
	const maxAction = PORTRAIT.actionShare * safeW + CLEAR_EPS;
	const maxMove = (1 - PORTRAIT.actionShare) * safeW + CLEAR_EPS;
	const ok = (c: HomeSpec, maxW: number) => (c.x + c.r) * s <= maxW && (c.y + c.r) * s <= maxH;
	for (const list of [spec, TOUCH_LAYOUT.spectate])
		for (const c of list) if (!ok(c, c.side === "action" ? maxAction : maxMove)) return false;
	return ok(home, maxMove);
}

/** What a fit must hold: the screen, and whether the corner rules (clusterInCorner) apply. */
interface FitArea {
	readonly viewportW: number;
	readonly safeW: number;
	readonly safeH: number;
	readonly keepOut: ReadonlyArray<ScreenRect>;
	readonly corner: boolean;
}

/**
 * The cluster at scale `s` keeps clear with either hand (so the left-handed layout stays the right-handed's mirror)
 * and, with `area.corner`, stays in its corners (clusterInCorner).
 */
function clusterFits(spec: ReadonlyArray<CircleSpec>, home: HomeSpec, s: number, area: FitArea): boolean {
	const { viewportW, safeW, safeH, keepOut } = area;
	return (
		(!area.corner || clusterInCorner(spec, home, s, viewportW, safeW, safeH)) &&
		touchControlsClear(placeCluster(spec, home, s, safeW, safeH, true), keepOut, safeW, safeH) &&
		touchControlsClear(placeCluster(spec, home, s, safeW, safeH, false), keepOut, safeW, safeH)
	);
}

/** The largest scale in [lo, want] at which the cluster fits (want itself first), or undefined when lo does not. */
function largestFit(
	spec: ReadonlyArray<CircleSpec>,
	home: HomeSpec,
	want: number,
	lo: number,
	area: FitArea,
): number | undefined {
	if (clusterFits(spec, home, want, area)) return want;
	if (lo > want || !clusterFits(spec, home, lo, area)) return undefined;
	let a = lo;
	let b = want;
	for (let i = 0; i < TOUCH_LAYOUT.fitSteps; i++) {
		const m = (a + b) / 2;
		if (clusterFits(spec, home, m, area)) a = m;
		else b = m;
	}
	return a;
}

export function touchLayout(
	viewportW: number,
	viewportH: number, // camera.ViewportSize (what computeHudScale reads)
	safeW: number,
	safeH: number, // the touch ScreenGui's AbsoluteSize (CoreUISafeInsets)
	hudPercent: number, // DisplaySettings.hudScale
	sizePercent: number, // DisplaySettings.touchSize
	leftHanded: boolean,
	mode: TouchLayoutMode,
	hud?: ScreenRect, // the HUD ScreenGui's rect in the touch safe area (default: the safe area)
	hudBoxes?: ReadonlyArray<ScreenRect>, // the touch strip's footprint in the touch safe area (replaces the corner boxes)
): TouchLayoutResult {
	const hudScale = computeHudScale(viewportW, viewportH, false, hudPercent, true);
	const keepOut =
		hudBoxes !== undefined
			? touchStripKeepOut(hudBoxes, hudScale)
			: touchPanelKeepOut(viewportW, viewportH, hudPercent, hud ?? { x: 0, y: 0, w: safeW, h: safeH });
	let topBand = 0;
	for (const z of keepOut) topBand = math.max(topBand, z.y + z.h);

	// The largest scale up to the setting's that keeps clear and in the corners: the usual cluster, then the compact one,
	// then the compact one under minScale down to the smallest tappable circle (TOUCH_LAYOUT.minDiameterPx); only then
	// the compact one keeping clear without the corner rules (a short phone under the corner panels' boxes at a large
	// HUD scale: the strip that replaces them leaves the corner room).
	const want = math.max(TOUCH_LAYOUT.minScale, (hudScale * sizePercent) / PERCENT);
	const floorScale = TOUCH_LAYOUT.minDiameterPx / (2 * smallestRadius());
	const home: HomeSpec = TOUCH_LAYOUT.moveHome;
	const area: FitArea = { viewportW, safeW, safeH, keepOut, corner: true };
	let variant: TouchLayoutVariant = "play";
	let spec = TOUCH_LAYOUT.play;
	let scale = largestFit(spec, home, want, TOUCH_LAYOUT.minScale, area);
	let inCorner = true;
	if (scale === undefined) {
		variant = "compact";
		spec = TOUCH_LAYOUT.compact;
		scale =
			largestFit(spec, home, want, TOUCH_LAYOUT.minScale, area) ??
			largestFit(spec, home, TOUCH_LAYOUT.minScale, floorScale, area);
	}
	if (scale === undefined) {
		inCorner = false;
		scale = largestFit(spec, home, want, floorScale, { ...area, corner: false });
	}
	const clear = scale !== undefined;
	inCorner = inCorner && clear;
	const s = scale ?? floorScale;

	const actionRight = !leftHanded;
	const actionX = (x: number): number => (actionRight ? safeW - x * s : x * s);
	const moveX = (x: number): number => (actionRight ? x * s : safeW - x * s);
	const place = (c: CircleSpec): TouchCircle => ({
		id: c.id,
		cx: c.side === "action" ? actionX(c.x) : moveX(c.x),
		cy: safeH - c.y * s,
		r: c.r * s,
	});
	const buttons = (mode === "play" ? spec : TOUCH_LAYOUT.spectate).map((c) => place(c));

	let moveZone: ScreenRect | undefined;
	let moveHome: TouchPoint | undefined;
	if (mode === "play") {
		let clusterLeft = 0;
		for (const c of spec) clusterLeft = math.max(clusterLeft, (c.x + c.r) * s);
		const zoneW = math.min(
			safeW * TOUCH_LAYOUT.moveZoneWidthShare,
			safeW - clusterLeft - TOUCH_LAYOUT.clusterGap * s,
		);
		// Upright the zone is the lower part only (docs/PORTRAIT.md PT5): a thumb on the world above never walks.
		const floorTop = safeH > safeW ? safeH * (1 - PORTRAIT.moveZoneShare) : 0;
		const zoneTop = math.min(math.max(topBand, floorTop), safeH);
		moveZone = { x: actionRight ? 0 : safeW - zoneW, y: zoneTop, w: zoneW, h: safeH - zoneTop };
		moveHome = { cx: moveX(home.x), cy: safeH - home.y * s, r: home.r * s };
	}

	return {
		scale: s,
		variant,
		keepOut,
		clear,
		inCorner,
		hudScale,
		topBand,
		moveZone,
		moveHome,
		buttons,
		stickRadiusPx: TOUCH.stickRadiusRef * s,
	};
}

/** What decides whether a placed button shows this frame. */
export interface TouchButtonFacts {
	/** The local player stands on the shrine / a pact altar (the snapshot's atShrine): Accept shows. */
	readonly atShrine: boolean;
	/** There is a weapon set to swap to (weaponSets hasSwapTarget on the snapshot's weapons): Swap shows. */
	readonly swapTarget: boolean;
}

/**
 * Whether placed button `id` shows (docs/MOBILE.md: Accept only at a shrine; docs/ARCHER.md AR9: Swap only with a set to
 * swap to, never for a Knight or an Archer). A hidden button keeps its place: touchLayout places every button of the
 * cluster whatever shows, so hiding one never moves or resizes another (and a hidden button takes no touch).
 */
export function touchButtonShown(id: TouchButtonId, facts: TouchButtonFacts): boolean {
	if (id === "shrine") return facts.atShrine;
	if (id === "swap") return facts.swapTarget;
	return true;
}

/** The layout's buttons that show (touchButtonShown), each exactly where the layout placed it. */
export function shownTouchButtons(layout: TouchLayoutResult, facts: TouchButtonFacts): TouchCircle[] {
	const out: TouchCircle[] = [];
	for (const b of layout.buttons) if (touchButtonShown(b.id, facts)) out.push(b);
	return out;
}

/** What a touch can begin on: a button or the move zone. */
export type TouchTargetId = TouchButtonId | "move";

/**
 * The one control a touch belongs to. A TextButton takes input over its whole bounding square (the UICorner only
 * rounds the drawing), so neighbouring circles' squares overlap at their corners (Attack and Alt do at every size) and
 * one touch there fires InputBegan on both. `candidates` are the controls it fired on; the winner is the button whose
 * circle centre is nearest relative to its radius (distance / r), the move zone only when the point is inside it (it
 * never meets a button's square). (x, y) is the touch in the layout's space (origin at the safe area's top left).
 * Undefined only for no candidates; a candidate this layout does not place scores last.
 */
export function pickTouchTarget(
	layout: TouchLayoutResult,
	candidates: ReadonlyArray<TouchTargetId>,
	x: number,
	y: number,
): TouchTargetId | undefined {
	if (candidates.size() === 1) return candidates[0];
	let best: TouchTargetId | undefined;
	let bestScore = math.huge;
	for (const id of candidates) {
		let score = math.huge;
		if (id === "move") {
			const z = layout.moveZone;
			if (z !== undefined && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) score = 0;
		} else {
			for (const b of layout.buttons) {
				if (b.id !== id || !(b.r > 0)) continue;
				const dx = x - b.cx;
				const dy = y - b.cy;
				score = (dx * dx + dy * dy) / (b.r * b.r);
			}
		}
		if (best === undefined || score < bestScore) {
			best = id;
			bestScore = score;
		}
	}
	return best;
}
