/**
 * The in-run HUD's footprint budget (docs/HUD_LAYOUT.md H2): where the HUD may draw, so a panel change that would
 * cover the playfield fails a spec (footprint.spec.ts) instead of a playtest. Pure numbers and rects, headless.
 *
 * Always-on panels (status, score, weapons, the corner minimap: docs/MINIMAP.md M7) live in the screen corners, each inside a budget box (reference px at
 * HUD_VIEW.referenceSize, scaled by computeHudScale like the HUD itself), and never enter HUD_CLEAR_ZONE, the middle of
 * the safe area. Transient panels (boss bar, toasts, tutorial prompt, spectate bar, the fading verdict line) may cross
 * the clear zone while they show; they are listed here so the spec can check they never land on an always-on panel.
 * The first-sighting card (docs/ENEMY_VARIANTS.md EV12) is transient but is held out of the clear zone like an
 * always-on panel: it shows while a new enemy is on screen.
 *
 * What the spec holds (HUD scale <= 100 %, every HUD_TEST_VIEWPORTS entry, ten-foot on and off): no always-on box in
 * the clear zone, the centre column and centre row never covered. Above 100 % (110 / 125 %) a box may reach into the
 * clear zone on some viewports; the spec prints those combinations rather than failing (the player chose a bigger HUD).
 */
import type { HudCorner } from "./corners";
import { PROGRESSION_VIEW, SIGHTING_CARD } from "./progression";
import { computeHudScale, HUD_VIEW } from "./layout";
import { MINIMAP_PANEL } from "./minimapHud";
import { ROOM_CLEAR_VIEW } from "./roomClear";
import { SPECTATE_BAR_VIEW } from "./spectate";
import { TUTORIAL_VIEW } from "./tutorial";

/** The always-on in-run panels, in a fixed order (iterate ALWAYS_ON_PANELS, never the record). */
export type AlwaysOnPanel = "status" | "score" | "weapons" | "minimap";
export const ALWAYS_ON_PANELS: ReadonlyArray<AlwaysOnPanel> = ["status", "score", "weapons", "minimap"];

export interface FootprintBox {
	readonly corner: HudCorner;
	/** Largest size the panel may take, reference px. */
	readonly maxW: number;
	readonly maxH: number;
}

/**
 * Budget boxes of the always-on panels. status is 160 high (not the plan's 130): three label rows, one boost row and
 * one row of owned items (RunItems caps itself at one row) come to 160 (statusEstimate). score is 160 high (not 130):
 * with the endless floor line moved under the combo meter (H4) its estimate was ~154, ~158 since the combo meter grew
 * 6 -> 10 px (docs/COMBO.md CB5, CD8). weapons is 80 high (not 64): the swap hint line, while it shows, puts the
 * compact panel at ~72 (see weaponsEstimate). minimap is the corner map (docs/MINIMAP.md M7, MINIMAP_PANEL =
 * MINIMAP_VIEW.panel: 140 x 140, MD7).
 */
export const HUD_FOOTPRINT = {
	status: { corner: "topLeft", maxW: 240, maxH: 160 },
	score: { corner: "topRight", maxW: 200, maxH: 160 },
	weapons: { corner: "bottomLeft", maxW: 240, maxH: 80 },
	minimap: { corner: "bottomRight", maxW: MINIMAP_PANEL.w, maxH: MINIMAP_PANEL.h },
} as const satisfies Readonly<Record<AlwaysOnPanel, FootprintBox>>;

/** The transient panels, in a fixed order. */
export type TransientPanel =
	| "bossBar"
	| "bossBarLow"
	| "bossBarLowSpectate"
	| "toasts"
	| "tutorial"
	| "spectate"
	| "verdict"
	| "roomClear"
	| "roomClearChip"
	| "sighting";
export const TRANSIENT_PANELS: ReadonlyArray<TransientPanel> = [
	"bossBar",
	"bossBarLow",
	"bossBarLowSpectate",
	"toasts",
	"tutorial",
	"spectate",
	"verdict",
	"roomClear",
	"roomClearChip",
	"sighting",
];

/**
 * Where a transient panel hangs: centred at the top / bottom of the safe area, or in the top-left / top-right /
 * bottom-right corner (topRight: the room clear chips, docs/ROOM_CLEAR.md RC6; topLeft: the first-sighting card).
 */
export type TransientAnchor = "topCentre" | "bottomCentre" | "topLeft" | "topRight" | "bottomRight";

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

/**
 * The toasts at their fullest: maxToasts toasts, each wearing the Codex's chip and its `Added to your Codex` line under
 * it (claude/codex-plan.md CX6: one line plus a small one), and the shrine hint.
 */
function toastLines(): number[] {
	const out = repeated(line(HUD_VIEW.textSize) + line(HUD_VIEW.smallText), PROGRESSION_VIEW.maxToasts);
	out.push(line(HUD_VIEW.smallText));
	return out;
}

/**
 * The first-sighting card: the Codex's NEW! chip row (claude/codex-plan.md CX6) and its wrapped bestiary line
 * (SIGHTING_CARD.lines lines at smallText).
 */
function sightingLines(): number[] {
	const out = [line(HUD_VIEW.smallText)];
	for (const h of repeated(line(HUD_VIEW.smallText), SIGHTING_CARD.lines)) out.push(h);
	return out;
}

/** The tutorial prompt (wrapped), its progress line and the pause hint. */
function tutorialLines(): number[] {
	const out = repeated(line(HUD_VIEW.textSize), FOOTPRINT_ESTIMATE.tutorialPromptLines);
	out.push(line(HUD_VIEW.smallText), line(HUD_VIEW.smallText));
	return out;
}

/**
 * Fallback-notice / verdict lines at the bottom right (H6), `edge` reference px above the safe area's bottom: above
 * the corner minimap (docs/MINIMAP.md M7), its height plus a HUD gap over the minimap's margin.
 */
export const VERDICT_BOX = {
	width: 480,
	height: 60,
	edge: HUD_VIEW.margin + MINIMAP_PANEL.h + HUD_VIEW.gap,
} as const;

/** The boss bar's and the spectate bar's heights (reference px), shared by the boxes below. */
const BOSS_BAR_HEIGHT = stack([line(HUD_VIEW.titleText), HUD_VIEW.bossBarHeight]);
const SPECTATE_BAR_HEIGHT = stack([line(HUD_VIEW.textSize), line(HUD_VIEW.smallText), line(HUD_VIEW.smallText)]);

export const HUD_TRANSIENT = {
	bossBar: {
		anchor: "topCentre",
		edge: HUD_VIEW.margin,
		width: HUD_VIEW.bossWidth,
		height: BOSS_BAR_HEIGHT,
		when: "a boss fight",
	},
	/**
	 * The boss bar moved to the bottom centre while the boss is under its top spot (shared/view/hud bossBarPlace.ts;
	 * not on touch). Under the tutorial prompt (TUTORIAL_VIEW.panelBottom).
	 */
	bossBarLow: {
		anchor: "bottomCentre",
		edge: HUD_VIEW.margin,
		width: HUD_VIEW.bossWidth,
		height: BOSS_BAR_HEIGHT,
		when: "a boss fight with the boss near the top of the screen",
	},
	/** bossBarLow while spectating: above the spectate bar (a co-op run has no tutorial prompt). */
	bossBarLowSpectate: {
		anchor: "bottomCentre",
		edge: SPECTATE_BAR_VIEW.bottom + SPECTATE_BAR_HEIGHT + HUD_VIEW.gap,
		width: HUD_VIEW.bossWidth,
		height: BOSS_BAR_HEIGHT,
		when: "spectating a boss fight with the boss near the top of the screen",
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
		height: SPECTATE_BAR_HEIGHT,
		when: "a dead co-op player spectating",
	},
	verdict: {
		anchor: "bottomRight",
		edge: VERDICT_BOX.edge,
		width: VERDICT_BOX.width,
		height: VERDICT_BOX.height,
		when: "a verdict or fallback notice changed (fades after a few seconds)",
	},
	roomClear: {
		anchor: "topCentre",
		edge: HUD_VIEW.margin,
		width: ROOM_CLEAR_VIEW.width,
		height: line(ROOM_CLEAR_VIEW.stampText) + ROOM_CLEAR_VIEW.rowGap + line(ROOM_CLEAR_VIEW.tallyText),
		when: "a room clear's stamp and tally (1.5 s; never with the boss bar: boss rooms have no record)",
	},
	roomClearChip: {
		anchor: "topRight",
		edge: HUD_VIEW.margin + HUD_FOOTPRINT.score.maxH + HUD_VIEW.gap,
		width: HUD_VIEW.scoreWidth,
		height: stack(repeated(line(ROOM_CLEAR_VIEW.chipText), ROOM_CLEAR_VIEW.maxChips)),
		when: "a co-op teammate's room clear far from the view player (1.5 s)",
	},
	sighting: {
		anchor: "topLeft",
		edge: HUD_VIEW.margin + HUD_FOOTPRINT.status.maxH + HUD_VIEW.gap,
		width: SIGHTING_CARD.width,
		height: stack(sightingLines()),
		when: "a first sighting of a new enemy / affix (SIGHTING_VIEW.toastSeconds, once per account)",
	},
} as const satisfies Readonly<Record<TransientPanel, TransientBox>>;

/**
 * The tutorial prompt on touch (docs/MOBILE.md MBD8, MB10): top centre under the boss bar, at TUTORIAL_VIEW.touchPanelWidth.
 * Its height is the bottom prompt's estimate scaled to that width, so the same wrapped lines fit.
 */
export const TOUCH_TUTORIAL_BOX: TransientBox = {
	anchor: "topCentre",
	edge: HUD_TRANSIENT.bossBar.edge + HUD_TRANSIENT.bossBar.height + HUD_VIEW.gap,
	width: TUTORIAL_VIEW.touchPanelWidth,
	height: math.ceil((HUD_TRANSIENT.tutorial.height * TUTORIAL_VIEW.panelWidth) / TUTORIAL_VIEW.touchPanelWidth),
	when: "a tutorial step's prompt on touch",
};

/**
 * The first-sighting card on touch: the status panel is the touch strip in the top bar there, so the card takes the
 * safe area's top left (the client moves it under the strip when the strip hangs below the top bar).
 */
export const TOUCH_SIGHTING_BOX: TransientBox = { ...HUD_TRANSIENT.sighting, edge: HUD_VIEW.margin };

/** The middle of the safe area always-on panels never enter, as fractions of its width and height. */
export const HUD_CLEAR_ZONE = { x0: 0.25, x1: 0.75, y0: 0.22, y1: 0.78 } as const;

export const HUD_FOOTPRINT_LIMITS = {
	/**
	 * The always-on boxes together cover at most this share of the safe area (HUD scale 100 %). 0.12 until the corner
	 * minimap (docs/MINIMAP.md MD7, owner 2026-10-27: 140 x 140, cap raised 0.12 -> 0.145).
	 */
	maxCoverShare: 0.145,
} as const;

/**
 * The Roblox top bar's height (screen px): the HUD's ScreenGui sits inside CoreUISafeInsets, so on most clients the
 * safe area starts this far below the viewport's top. The spec checks the budget with and without it.
 */
export const HUD_TEST_TOP_INSET = 58;

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

/** A screen rect in px, origin at the viewport's top left. */
export interface ScreenRect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

const HALF = 0.5;

/** A reference-size box placed in a corner, `HUD_VIEW.margin` from both edges, scaled by `scale`. */
export function cornerRect(corner: HudCorner, w: number, h: number, vw: number, vh: number, scale: number): ScreenRect {
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
	if (box.anchor === "topLeft") return { x: HUD_VIEW.margin * scale, y: edge, w, h };
	if (box.anchor === "topRight") return { x: vw - HUD_VIEW.margin * scale - w, y: edge, w, h };
	if (box.anchor === "bottomCentre") return { x: vw * HALF - w * HALF, y: vh - edge - h, w, h };
	return { x: vw - edge - w, y: vh - edge - h, w, h };
}

export interface PanelRect<P> {
	readonly panel: P;
	readonly rect: ScreenRect;
}

/** `r` moved down by `dy` px. */
function shiftDown(r: ScreenRect, dy: number): ScreenRect {
	return { x: r.x, y: r.y + dy, w: r.w, h: r.h };
}

/**
 * Screen rects (px) of every always-on panel's budget box, at the HUD scale the client would use (useHudScale scales
 * by the whole viewport). `topInset` (screen px, default 0): the safe area starts that far down (the Roblox top bar,
 * HUD_TEST_TOP_INSET), and the boxes sit in the safe area.
 */
export function footprintRects(
	vw: number,
	vh: number,
	tenFoot: boolean,
	userPercent: number,
	topInset = 0,
): ReadonlyArray<PanelRect<AlwaysOnPanel>> {
	const scale = computeHudScale(vw, vh, tenFoot, userPercent);
	const sh = vh - topInset;
	return ALWAYS_ON_PANELS.map((panel) => {
		const b: FootprintBox = HUD_FOOTPRINT[panel];
		return { panel, rect: shiftDown(cornerRect(b.corner, b.maxW, b.maxH, vw, sh, scale), topInset) };
	});
}

/** Screen rects (px) of every transient panel at its fullest (`topInset` as in footprintRects). */
export function transientRects(
	vw: number,
	vh: number,
	tenFoot: boolean,
	userPercent: number,
	topInset = 0,
): ReadonlyArray<PanelRect<TransientPanel>> {
	const scale = computeHudScale(vw, vh, tenFoot, userPercent);
	const sh = vh - topInset;
	return TRANSIENT_PANELS.map((panel) => ({
		panel,
		rect: shiftDown(transientRect(HUD_TRANSIENT[panel], vw, sh, scale), topInset),
	}));
}

/** HUD_CLEAR_ZONE in px for a viewport: fractions of the safe area below `topInset`. */
export function clearZoneRect(vw: number, vh: number, topInset = 0): ScreenRect {
	const z = HUD_CLEAR_ZONE;
	const sh = vh - topInset;
	return { x: vw * z.x0, y: topInset + sh * z.y0, w: vw * (z.x1 - z.x0), h: sh * (z.y1 - z.y0) };
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

/** Each always-on box against the clear zone and its share of the safe area (`topInset` as in footprintRects). */
export function footprintReport(
	vw: number,
	vh: number,
	tenFoot: boolean,
	userPercent: number,
	topInset = 0,
): FootprintReport {
	const zone = clearZoneRect(vw, vh, topInset);
	const area = vw * (vh - topInset);
	let total = 0;
	let any = false;
	const panels = footprintRects(vw, vh, tenFoot, userPercent, topInset).map((p) => {
		const intrudes = rectsOverlap(p.rect, zone);
		const coverShare = area > 0 ? (p.rect.w * p.rect.h) / area : 0;
		total += coverShare;
		any = any || intrudes;
		return { panel: p.panel, intrudes, coverShare };
	});
	return { panels, totalShare: total, intrudes: any };
}

/**
 * The always-on panels on touch (MBD8): the weapons panel and the corner minimap are hidden (the full map opens from
 * the pause overlay instead), so only the two top corners stay.
 */
export const TOUCH_ALWAYS_ON_PANELS: ReadonlyArray<AlwaysOnPanel> = ["status", "score"];

/**
 * footprintRects on touch: the HUD scale floors at HUD_VIEW.touchMinScale (computeHudScale with touch) and only
 * TOUCH_ALWAYS_ON_PANELS are placed. `topInset` as in footprintRects.
 */
export function touchFootprintRects(
	vw: number,
	vh: number,
	userPercent: number,
	topInset = 0,
): ReadonlyArray<PanelRect<AlwaysOnPanel>> {
	const scale = computeHudScale(vw, vh, false, userPercent, true);
	const sh = vh - topInset;
	return TOUCH_ALWAYS_ON_PANELS.map((panel) => {
		const b: FootprintBox = HUD_FOOTPRINT[panel];
		return { panel, rect: shiftDown(cornerRect(b.corner, b.maxW, b.maxH, vw, sh, scale), topInset) };
	});
}

/** A transient box's screen rect on touch (the touch HUD scale floor), `topInset` as in footprintRects. */
export function touchTransientRect(
	box: TransientBox,
	vw: number,
	vh: number,
	userPercent: number,
	topInset = 0,
): ScreenRect {
	const scale = computeHudScale(vw, vh, false, userPercent, true);
	return shiftDown(transientRect(box, vw, vh - topInset, scale), topInset);
}

/** The touch tutorial prompt's screen rect (TOUCH_TUTORIAL_BOX at the touch HUD scale; `topInset` as in footprintRects). */
export function touchTutorialRect(vw: number, vh: number, userPercent: number, topInset = 0): ScreenRect {
	return touchTransientRect(TOUCH_TUTORIAL_BOX, vw, vh, userPercent, topInset);
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

/** Label rows of the StatusPanel (HP, Flask, Ember). */
const STATUS_LABEL_ROWS = 3;

/**
 * The StatusPanel's height at its usual fullest, reference px: the three label rows (a label line or a heart,
 * whichever is taller), ONE boost row (`boostRowH`: shared/view/boosts BOOST_VIEW.iconSize; four boosts running at
 * once wrap to a second row, rare and brief) and one row of owned items (RunItems caps itself at one row). Width: the
 * footprint's own (rows wrap or cap at statusRowMaxWidth). An unscored endless run's floor line is not counted:
 * endless runs are scored, so the line sits in the ScorePanel.
 */
export function statusEstimate(boostRowH: number): { w: number; h: number } {
	const rows = repeated(math.max(line(HUD_VIEW.textSize), HUD_VIEW.heartSize), STATUS_LABEL_ROWS);
	rows.push(boostRowH, PROGRESSION_VIEW.iconSize);
	return { w: HUD_FOOTPRINT.status.maxW, h: stack(rows) };
}
