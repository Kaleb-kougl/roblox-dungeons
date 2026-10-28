/**
 * Where the touch controls sit (docs/MOBILE.md MB2), pure. Positions are reference px measured from the ACTION side's
 * bottom corner of the safe area (the right edge, or the left when left-handed): x inward from that side edge, y up
 * from the bottom. touchLayout() scales them so the cluster never reaches the status / score panels, never below
 * TOUCH_LAYOUT.minScale.
 */
import { TOUCH } from "shared/config";
import { HUD_FOOTPRINT } from "./footprint";
import type { ScreenRect } from "./footprint";
import { computeHudScale, HUD_VIEW } from "./layout";

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
	/** Smallest circle diameter (px) the spec accepts. */
	minDiameterPx: 40,
	/** Fill alpha at 100 % opacity, and the pressed fill's multiplier (capped at 1). */
	fillAlpha: 0.55,
	pressedFillBoost: 1.6,
	play: [
		{ id: "attack", x: 140, y: 140, r: 75, side: "action" },
		{ id: "roll", x: 280, y: 70, r: 45, side: "action" },
		{ id: "alt", x: 250, y: 230, r: 50, side: "action" },
		{ id: "ember", x: 60, y: 260, r: 38, side: "action" },
		{ id: "flask", x: 380, y: 250, r: 38, side: "action" },
		{ id: "swap", x: 400, y: 110, r: 38, side: "action" },
		{ id: "shrine", x: 480, y: 170, r: 38, side: "action" },
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

export interface TouchLayoutResult {
	/** The controls' scale (reference px -> px). */
	readonly scale: number;
	/** The HUD scale the corner panels use on touch (computeHudScale with touch = true). */
	readonly hudScale: number;
	/** px from the safe area's top that the corner panels' boxes (and their gap) take. */
	readonly topBand: number;
	/** The move zone (play mode only). */
	readonly moveZone: ScreenRect | undefined;
	readonly moveHome: TouchPoint | undefined;
	readonly buttons: ReadonlyArray<TouchCircle>;
	readonly stickRadiusPx: number;
}

const PERCENT = 100;

/** The largest value of `f` over the play circles. */
function maxOverPlay(f: (c: CircleSpec) => number): number {
	let m = 0;
	for (const c of TOUCH_LAYOUT.play) m = math.max(m, f(c));
	return m;
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
): TouchLayoutResult {
	const hudScale = computeHudScale(viewportW, viewportH, false, hudPercent, true);
	const topBand =
		(HUD_VIEW.margin + math.max(HUD_FOOTPRINT.status.maxH, HUD_FOOTPRINT.score.maxH) + TOUCH_LAYOUT.clusterGap) *
		hudScale;
	const clusterTop = maxOverPlay((c) => c.y + c.r);
	const fit = (safeH - topBand) / clusterTop;
	const scale = math.max(TOUCH_LAYOUT.minScale, math.min((hudScale * sizePercent) / PERCENT, fit));

	const actionRight = !leftHanded;
	const actionX = (x: number): number => (actionRight ? safeW - x * scale : x * scale);
	const moveX = (x: number): number => (actionRight ? x * scale : safeW - x * scale);
	const place = (c: CircleSpec): TouchCircle => ({
		id: c.id,
		cx: c.side === "action" ? actionX(c.x) : moveX(c.x),
		cy: safeH - c.y * scale,
		r: c.r * scale,
	});
	const buttons = (mode === "play" ? TOUCH_LAYOUT.play : TOUCH_LAYOUT.spectate).map((c) => place(c));

	let moveZone: ScreenRect | undefined;
	let moveHome: TouchPoint | undefined;
	if (mode === "play") {
		const clusterLeft = maxOverPlay((c) => (c.x + c.r) * scale);
		const zoneW = math.min(
			safeW * TOUCH_LAYOUT.moveZoneWidthShare,
			safeW - clusterLeft - TOUCH_LAYOUT.clusterGap * scale,
		);
		moveZone = { x: actionRight ? 0 : safeW - zoneW, y: topBand, w: zoneW, h: safeH - topBand };
		moveHome = {
			cx: moveX(TOUCH_LAYOUT.moveHome.x),
			cy: safeH - TOUCH_LAYOUT.moveHome.y * scale,
			r: TOUCH_LAYOUT.moveHome.r * scale,
		};
	}

	return {
		scale,
		hudScale,
		topBand,
		moveZone,
		moveHome,
		buttons,
		stickRadiusPx: TOUCH.stickRadiusRef * scale,
	};
}
