/**
 * The in-run HUD's footprint budget (docs/HUD_LAYOUT.md H2): where the HUD may draw, so a panel change that would
 * cover the playfield fails a spec (footprint.spec.ts) instead of a playtest. Pure numbers and rects, headless.
 *
 * Always-on panels (status, score, weapons) live in the screen corners, each inside a budget box (reference px at
 * HUD_VIEW.referenceSize, scaled by computeHudScale like the HUD itself), and never enter HUD_CLEAR_ZONE, the middle of
 * the safe area. Transient panels (boss bar, toasts, tutorial prompt, spectate bar, the fading verdict line) may cross
 * the clear zone while they show; they are listed here so the spec can check they never land on an always-on panel.
 *
 * What the spec holds (HUD scale <= 100 %, every HUD_TEST_VIEWPORTS entry, ten-foot on and off): no always-on box in
 * the clear zone, the centre column and centre row never covered. Above 100 % (110 / 125 %) a box may reach into the
 * clear zone on some viewports; the spec prints those combinations rather than failing (the player chose a bigger HUD).
 */
import { PROGRESSION_VIEW } from "./progression";
import { computeHudScale, HUD_VIEW } from "./layout";
import { SPECTATE_BAR_VIEW } from "./spectate";
import { TUTORIAL_VIEW } from "./tutorial";

/** Screen corners (merge: becomes shared/view/hud HudCorner). */
type FootprintCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** The always-on in-run panels, in a fixed order (iterate ALWAYS_ON_PANELS, never the record). */
export type AlwaysOnPanel = "status" | "score" | "weapons";
export const ALWAYS_ON_PANELS: ReadonlyArray<AlwaysOnPanel> = ["status", "score", "weapons"];

export interface FootprintBox {
	readonly corner: FootprintCorner;
	/** Largest size the panel may take, reference px. */
	readonly maxW: number;
	readonly maxH: number;
}

/**
 * Budget boxes of the always-on panels. score is 160 high (not the plan's 130): with the endless floor line moved
 * under the combo meter (H4) its estimate is ~154. weapons is 80 high (not 64): the swap hint line, while it shows,
 * puts the compact panel at ~72 (see weaponsEstimate).
 */
export const HUD_FOOTPRINT = {
	status: { corner: "topLeft", maxW: 240, maxH: 130 },
	score: { corner: "topRight", maxW: 200, maxH: 160 },
	weapons: { corner: "bottomLeft", maxW: 240, maxH: 80 },
} as const satisfies Readonly<Record<AlwaysOnPanel, FootprintBox>>;

/** The transient panels, in a fixed order. */
export type TransientPanel = "bossBar" | "toasts" | "tutorial" | "spectate" | "verdict";
export const TRANSIENT_PANELS: ReadonlyArray<TransientPanel> = ["bossBar", "toasts", "tutorial", "spectate", "verdict"];

/** Where a transient panel hangs: centred at the top / bottom of the safe area, or in the bottom-right corner. */
export type TransientAnchor = "topCentre" | "bottomCentre" | "bottomRight";

export interface TransientBox {
	readonly anchor: TransientAnchor;
	/** Reference px from the anchored screen edge (top or bottom) to the box's near edge. */
	readonly edge: number;
	readonly width: number;
	/** Estimated height at its fullest (reference px). */
	readonly height: number;
	/** When it shows (documentation only). */
	readonly when: string;
}

/** Inputs of the height estimates (reference px / counts); mirrors client/ui/hud primitives. */
export const FOOTPRINT_ESTIMATE = {
	/** A Text box is its text size + this (primitives LINE_SLACK). */
	lineSlack: 4,
	/** Lines a tutorial prompt wraps to at most (TutorialPanel). */
	tutorialPromptLines: 2,
} as const;

const PANEL_PADS = 2;

/** One Text line's box height (reference px). */
function line(size: number): number {
	return size + FOOTPRINT_ESTIMATE.lineSlack;
}

/** A vertical Panel's height: its children plus a gap between each and the padding. */
function stack(children: ReadonlyArray<number>): number {
	let h = HUD_VIEW.pad * PANEL_PADS;
	for (let i = 0; i < children.size(); i++) h += children[i] + (i > 0 ? HUD_VIEW.gap : 0);
	return h;
}

function repeated(value: number, n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(value);
	return out;
}

/** The toasts at their fullest: maxToasts one-line toasts and the shrine hint. */
function toastLines(): number[] {
	const out = repeated(line(HUD_VIEW.textSize), PROGRESSION_VIEW.maxToasts);
	out.push(line(HUD_VIEW.smallText));
	return out;
}

/** The tutorial prompt (wrapped), its progress line and the pause hint. */
function tutorialLines(): number[] {
	const out = repeated(line(HUD_VIEW.textSize), FOOTPRINT_ESTIMATE.tutorialPromptLines);
	out.push(line(HUD_VIEW.smallText), line(HUD_VIEW.smallText));
	return out;
}

/** Fallback-notice / verdict lines at the bottom right (H6). */
const VERDICT_BOX = { width: 480, height: 60 } as const;

export const HUD_TRANSIENT = {
	bossBar: {
		anchor: "topCentre",
		edge: HUD_VIEW.margin,
		width: HUD_VIEW.bossWidth,
		height: stack([line(HUD_VIEW.titleText), HUD_VIEW.bossBarHeight]),
		when: "a boss fight",
	},
	toasts: {
		anchor: "topCentre",
		edge: PROGRESSION_VIEW.toastTop,
		width: PROGRESSION_VIEW.toastWidth,
		height: stack(toastLines()),
		when: "progression toasts (a few seconds), the shrine hint",
	},
	tutorial: {
		anchor: "bottomCentre",
		edge: TUTORIAL_VIEW.panelBottom,
		width: TUTORIAL_VIEW.panelWidth,
		height: stack(tutorialLines()),
		when: "a tutorial step's prompt",
	},
	spectate: {
		anchor: "bottomCentre",
		edge: SPECTATE_BAR_VIEW.bottom,
		width: SPECTATE_BAR_VIEW.width,
		height: stack([line(HUD_VIEW.textSize), line(HUD_VIEW.smallText), line(HUD_VIEW.smallText)]),
		when: "a dead co-op player spectating",
	},
	verdict: {
		anchor: "bottomRight",
		edge: HUD_VIEW.margin,
		width: VERDICT_BOX.width,
		height: VERDICT_BOX.height,
		when: "a verdict or fallback notice changed (fades after a few seconds)",
	},
} as const satisfies Readonly<Record<TransientPanel, TransientBox>>;

/** The middle of the safe area always-on panels never enter, as fractions of its width and height. */
export const HUD_CLEAR_ZONE = { x0: 0.25, x1: 0.75, y0: 0.22, y1: 0.78 } as const;

export const HUD_FOOTPRINT_LIMITS = {
	/** The always-on boxes together cover at most this share of the safe area (HUD scale 100 %). */
	maxCoverShare: 0.12,
} as const;

/** Viewports the spec checks (px): 16:9 at three sizes, 16:10, 4:3, 21:9 and a landscape phone. */
export const HUD_TEST_VIEWPORTS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
	{ x: 1280, y: 720 },
	{ x: 1920, y: 1080 },
	{ x: 2560, y: 1440 },
	{ x: 1920, y: 1200 },
	{ x: 1024, y: 768 },
	{ x: 2560, y: 1080 },
	{ x: 844, y: 390 },
];

/** A screen rect in px, origin at the safe area's top left. */
export interface ScreenRect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

const HALF = 0.5;

/** A reference-size box placed in a corner, `HUD_VIEW.margin` from both edges, scaled by `scale`. */
export function cornerRect(
	corner: FootprintCorner,
	w: number,
	h: number,
	vw: number,
	vh: number,
	scale: number,
): ScreenRect {
	const m = HUD_VIEW.margin * scale;
	const sw = w * scale;
	const sh = h * scale;
	const left = corner === "topLeft" || corner === "bottomLeft";
	const top = corner === "topLeft" || corner === "topRight";
	return { x: left ? m : vw - m - sw, y: top ? m : vh - m - sh, w: sw, h: sh };
}

function transientRect(box: TransientBox, vw: number, vh: number, scale: number): ScreenRect {
	const w = box.width * scale;
	const h = box.height * scale;
	const edge = box.edge * scale;
	if (box.anchor === "topCentre") return { x: vw * HALF - w * HALF, y: edge, w, h };
	if (box.anchor === "bottomCentre") return { x: vw * HALF - w * HALF, y: vh - edge - h, w, h };
	return { x: vw - edge - w, y: vh - edge - h, w, h };
}

export interface PanelRect<P> {
	readonly panel: P;
	readonly rect: ScreenRect;
}

/** Screen rects (px) of every always-on panel's budget box, at the HUD scale the client would use. */
export function footprintRects(
	vw: number,
	vh: number,
	tenFoot: boolean,
	userPercent: number,
): ReadonlyArray<PanelRect<AlwaysOnPanel>> {
	const scale = computeHudScale(vw, vh, tenFoot, userPercent);
	return ALWAYS_ON_PANELS.map((panel) => {
		const b: FootprintBox = HUD_FOOTPRINT[panel];
		return { panel, rect: cornerRect(b.corner, b.maxW, b.maxH, vw, vh, scale) };
	});
}

/** Screen rects (px) of every transient panel at its fullest. */
export function transientRects(
	vw: number,
	vh: number,
	tenFoot: boolean,
	userPercent: number,
): ReadonlyArray<PanelRect<TransientPanel>> {
	const scale = computeHudScale(vw, vh, tenFoot, userPercent);
	return TRANSIENT_PANELS.map((panel) => ({ panel, rect: transientRect(HUD_TRANSIENT[panel], vw, vh, scale) }));
}

/** HUD_CLEAR_ZONE in px for a viewport. */
export function clearZoneRect(vw: number, vh: number): ScreenRect {
	const z = HUD_CLEAR_ZONE;
	return { x: vw * z.x0, y: vh * z.y0, w: vw * (z.x1 - z.x0), h: vh * (z.y1 - z.y0) };
}

/** True when the two rects share a positive area (touching edges do not overlap). */
export function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface FootprintEntry {
	readonly panel: AlwaysOnPanel;
	/** The budget box reaches into HUD_CLEAR_ZONE. */
	readonly intrudes: boolean;
	/** Its share of the safe area. */
	readonly coverShare: number;
}

export interface FootprintReport {
	readonly panels: ReadonlyArray<FootprintEntry>;
	/** Every always-on box together (they never overlap each other). */
	readonly totalShare: number;
	/** Any box intrudes. */
	readonly intrudes: boolean;
}

export function footprintReport(vw: number, vh: number, tenFoot: boolean, userPercent: number): FootprintReport {
	const zone = clearZoneRect(vw, vh);
	const area = vw * vh;
	let total = 0;
	let any = false;
	const panels = footprintRects(vw, vh, tenFoot, userPercent).map((p) => {
		const intrudes = rectsOverlap(p.rect, zone);
		const coverShare = area > 0 ? (p.rect.w * p.rect.h) / area : 0;
		total += coverShare;
		any = any || intrudes;
		return { panel: p.panel, intrudes, coverShare };
	});
	return { panels, totalShare: total, intrudes: any };
}

/** Text lines under the weapon slots (the swap hint). */
const WEAPON_HINT_LINES = 1;
/** Weapon sets side by side. */
const WEAPON_SETS = 2;

/** The WeaponPanel's size from HUD_VIEW (two slots side by side, the swap hint under them), reference px. */
export function weaponsEstimate(): { w: number; h: number } {
	const slot = HUD_VIEW.weaponSlotSize;
	const w = WEAPON_SETS * slot.x + (WEAPON_SETS - 1) * HUD_VIEW.gap + HUD_VIEW.pad * PANEL_PADS;
	const lines: number[] = [slot.y];
	for (let i = 0; i < WEAPON_HINT_LINES; i++) lines.push(line(HUD_VIEW.smallText));
	return { w, h: stack(lines) };
}

/** The ScorePanel's size from HUD_VIEW: label, score, combo, combo meter and the endless floor line (H4). */
export function scoreEstimate(): { w: number; h: number } {
	return {
		w: HUD_VIEW.scoreWidth,
		h: stack([
			line(HUD_VIEW.smallText),
			line(HUD_VIEW.bigText),
			line(HUD_VIEW.titleText),
			HUD_VIEW.comboBarHeight,
			line(HUD_VIEW.smallText),
		]),
	};
}
