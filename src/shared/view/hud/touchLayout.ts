/**
 * Where the touch controls sit (docs/MOBILE.md MB2), pure. Positions are reference px measured from the ACTION side's
 * bottom corner of the safe area (the right edge, or the left when left-handed): x inward from that side edge, y up
 * from the bottom. touchLayout() scales them so no control reaches the status / score panels' budget boxes (plus
 * TOUCH_LAYOUT.clusterGap: touchPanelKeepOut) or, given `hudBoxes`, the touch strip's boxes (touchStripKeepOut: the
 * strip replaces those panels on touch, docs/UI_ART.md "Phones"), never below TOUCH_LAYOUT.minScale; where `play` cannot keep clear at
 * minScale (a short safe area: a phone under a tall top bar, or a HUD scale above 100 %) it takes the lower `compact`
 * cluster, and only below that the scale drops under minScale (never under the smallest tappable circle).
 */
import { TOUCH } from "shared/config";
import { cornerRect, HUD_FOOTPRINT, TOUCH_ALWAYS_ON_PANELS } from "./footprint";
import type { FootprintBox, ScreenRect } from "./footprint";
import { computeHudScale } from "./layout";

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

interface CircleSpec {
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
	/** The move stick's idle ring, from the move side's bottom corner. */
	moveHome: { x: 150, y: 150, r: 60 },
	/** The move stick's idle ring with the `compact` cluster (lower, like it). */
	compactMoveHome: { x: 130, y: 110, r: 60 },
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
	play: [
		{ id: "attack", x: 140, y: 140, r: 75, side: "action" },
		{ id: "roll", x: 280, y: 70, r: 45, side: "action" },
		{ id: "alt", x: 250, y: 230, r: 50, side: "action" },
		{ id: "ember", x: 60, y: 260, r: 38, side: "action" },
		{ id: "flask", x: 380, y: 250, r: 38, side: "action" },
		{ id: "swap", x: 400, y: 110, r: 38, side: "action" },
		{ id: "shrine", x: 480, y: 170, r: 38, side: "action" },
	] as ReadonlyArray<CircleSpec>,
	/**
	 * The short-screen cluster (used when `play` cannot keep clear of the corner panels at minScale or above): at most
	 * 200 reference px tall, so it fits under the score panel at minScale on a 251 pt tall safe area (a 330 pt phone
	 * under the 58 pt top bar and the home indicator). Attack sits lower; Ember moves into the corner below it; Alt and
	 * Roll stand left of Attack, Swap / Flask / Accept left of them.
	 */
	compact: [
		{ id: "attack", x: 130, y: 115, r: 75, side: "action" },
		{ id: "roll", x: 285, y: 48, r: 45, side: "action" },
		{ id: "alt", x: 265, y: 150, r: 50, side: "action" },
		{ id: "ember", x: 40, y: 40, r: 38, side: "action" },
		{ id: "flask", x: 375, y: 60, r: 38, side: "action" },
		{ id: "swap", x: 370, y: 150, r: 38, side: "action" },
		{ id: "shrine", x: 460, y: 110, r: 38, side: "action" },
	] as ReadonlyArray<CircleSpec>,
	spectate: [
		{ id: "spectateNext", x: 140, y: 140, r: 60, side: "action" },
		{ id: "spectatePrev", x: 140, y: 140, r: 60, side: "move" },
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
	return math.min(m, TOUCH_LAYOUT.moveHome.r, TOUCH_LAYOUT.compactMoveHome.r);
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

/** The cluster at scale `s` keeps clear with either hand (so the left-handed layout stays the right-handed's mirror). */
function clusterFits(
	spec: ReadonlyArray<CircleSpec>,
	home: HomeSpec,
	s: number,
	safeW: number,
	safeH: number,
	keepOut: ReadonlyArray<ScreenRect>,
): boolean {
	return (
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
	safeW: number,
	safeH: number,
	keepOut: ReadonlyArray<ScreenRect>,
): number | undefined {
	if (clusterFits(spec, home, want, safeW, safeH, keepOut)) return want;
	if (lo > want || !clusterFits(spec, home, lo, safeW, safeH, keepOut)) return undefined;
	let a = lo;
	let b = want;
	for (let i = 0; i < TOUCH_LAYOUT.fitSteps; i++) {
		const m = (a + b) / 2;
		if (clusterFits(spec, home, m, safeW, safeH, keepOut)) a = m;
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

	// The largest scale up to the setting's that keeps clear: the usual cluster, then the compact one, then the compact
	// one under minScale down to the smallest tappable circle (TOUCH_LAYOUT.minDiameterPx).
	const want = math.max(TOUCH_LAYOUT.minScale, (hudScale * sizePercent) / PERCENT);
	const floorScale = TOUCH_LAYOUT.minDiameterPx / (2 * smallestRadius());
	let variant: TouchLayoutVariant = "play";
	let spec = TOUCH_LAYOUT.play;
	let home: HomeSpec = TOUCH_LAYOUT.moveHome;
	let scale = largestFit(spec, home, want, TOUCH_LAYOUT.minScale, safeW, safeH, keepOut);
	if (scale === undefined) {
		variant = "compact";
		spec = TOUCH_LAYOUT.compact;
		home = TOUCH_LAYOUT.compactMoveHome;
		scale =
			largestFit(spec, home, want, TOUCH_LAYOUT.minScale, safeW, safeH, keepOut) ??
			largestFit(spec, home, TOUCH_LAYOUT.minScale, floorScale, safeW, safeH, keepOut);
	}
	const clear = scale !== undefined;
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
		const zoneTop = math.min(topBand, safeH);
		moveZone = { x: actionRight ? 0 : safeW - zoneW, y: zoneTop, w: zoneW, h: safeH - zoneTop };
		moveHome = { cx: moveX(home.x), cy: safeH - home.y * s, r: home.r * s };
	}

	return {
		scale: s,
		variant,
		keepOut,
		clear,
		hudScale,
		topBand,
		moveZone,
		moveHome,
		buttons,
		stickRadiusPx: TOUCH.stickRadiusRef * s,
	};
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
