/**
 * The touch HUD strip (docs/UI_ART.md "Phones", owner 2026-10-30): on touch the status and score corner panels give
 * way to ONE slim row in the Roblox top bar, right of Roblox's buttons and the game's pause button: hearts (with the
 * armor / Aegis pips), the flask icon and count, the Ember candle and count, then the score (coin and number) with the
 * multiplier and a thin combo line under it. No panel box: icons and stroked text. Under it one short line of chips
 * (running boosts, then the owned boons / relics / curses, capped with "+N"), and under that the slim boss bar's slot
 * (top centre) and, below it, the touch tutorial prompt. Pure and headless (touchStrip.spec.ts); the client draws it
 * (client/ui/hud TouchStrip) in its own full-screen ScreenGui under a UIScale of `scale`.
 *
 * Collapsing when the free top bar is narrow, in this order: the multiplier's text goes first (the combo line stays),
 * then the hearts become one heart and a count, then the whole strip shrinks down to TOUCH_STRIP.minFit of the HUD
 * scale. If even that does not fit, the strip leaves the top bar for the top of the safe area (it never overlaps the
 * top bar's buttons).
 *
 * Units: screen px (GUI px: points on a phone) for the geometry in and the rects out, reference px (HUD_VIEW's 1280 x
 * 720 design px, under the strip's UIScale) for the sizes in TOUCH_STRIP and the `slots` / widths out.
 */
import { HUD_FOOTPRINT, HUD_TRANSIENT, type ScreenRect } from "./footprint";
import { computeHudScale, HUD_VIEW } from "./layout";
import { fitArt } from "./skin";
import { UI_ART } from "./skinConfig";

export const TOUCH_STRIP = {
	/** The strip's row: every icon and text line sits in it, vertically centred. */
	rowHeight: 28,
	/** Hearts, the flask, the candle and the coin fit their art into this square box (fitArt; = the status rows'). */
	iconBox: UI_ART.iconBox.heart,
	/** The armor / Aegis pips (= the status panel's). */
	pipBox: HUD_VIEW.pipSize,
	/** The flat look's flask / candle / coin stand-ins (pips this size). */
	flatIcon: 16,
	/** Between two hearts or two pips. */
	itemGap: 3,
	/** Between an icon and its count (the flask, the candle, the coin and the score's parts). */
	pairGap: 2,
	/** Between two groups (hearts, flask, Ember, score). */
	groupGap: 12,
	/** The flask / Ember counts and the hearts' count (collapsed). */
	countText: HUD_VIEW.textSize,
	/** The score number and the multiplier. */
	scoreText: HUD_VIEW.titleText,
	multText: HUD_VIEW.textSize,
	/** Characters the multiplier is sized for ("x1.0", HUD_STRINGS.combo). */
	multChars: 4,
	/** The score is sized for at least this many digits (so the strip does not re-collapse at every 10^n early on). */
	minScoreDigits: 5,
	/** The combo line under the score group: its gap from the row and its thickness. */
	comboGap: 2,
	comboHeight: 3,
	/** Arcade's advance per character as a share of its text size (measured ~0.55 on a phone screenshot; padded). */
	charEm: 0.6,
	/** Reference px between the pause button's slot and the strip, and between the strip and the right edge. */
	barGap: 8,
	edge: 8,
	/** Around the strip inside its fade group: the tutorial's highlight ring (3 + 2 px pulse) is never clipped. */
	ringPad: 5,
	/** The smallest share of the HUD scale the strip may shrink to before it leaves the top bar. */
	minFit: 0.8,
	/** Fit steps between 1 and minFit (the largest fit that fits is taken). */
	fitSteps: 20,
	/** The chips line under the strip: its gap, the cell size and text, the boost bar beside its icon. */
	chips: {
		gap: 3,
		cell: 15,
		cellGap: 3,
		text: 10,
		boostIconBarGap: 2,
		boostBarWidth: 20,
		boostBarHeight: 4,
	},
	/** The slim boss bar (top centre, under the chips line): name, bar and phase on one row. */
	boss: {
		gap: 4,
		width: 420,
		height: 16,
		text: HUD_VIEW.smallText,
		barHeight: 6,
		/** Its share of the row for the name; the phase takes phaseWidth; the bar the rest. */
		nameShare: 0.32,
		phaseWidth: 84,
	},
	/**
	 * Reference px between the top-centre slot (the slim boss bar, or the room clear stamp and tally in the same slot:
	 * never both, boss rooms keep no record) and the touch tutorial prompt / the room clear chips under it.
	 */
	belowGap: HUD_VIEW.gap,
} as const;

/**
 * The strip's ScreenGui (client/ui/hud GameHud) and the folder of invisible frames at its `footprint` boxes, which
 * TouchControlsController measures (in its own GUI's space) for the touch controls' keep-out.
 */
export const TOUCH_STRIP_GUI = { gui: "KV_TouchStrip", footprint: "Footprint" } as const;

/** The art sizes (art px) the strip fits, from the theme pack; undefined fields draw the flat stand-ins. */
export interface TouchStripArt {
	readonly heart?: { readonly w: number; readonly h: number };
	readonly flask?: { readonly w: number; readonly h: number };
	readonly candle?: { readonly w: number; readonly h: number };
	readonly coin?: { readonly w: number; readonly h: number };
	readonly pip?: { readonly w: number; readonly h: number };
	/** The pip's whole square box when it is drawn like a heart (shared/view/hud PipArt.box: the pack's own shields). */
	readonly pipBox?: number;
}

/** Where the strip may go, screen px. */
export interface TouchStripGeometry {
	/** camera.ViewportSize (what computeHudScale reads). */
	readonly viewportW: number;
	readonly viewportH: number;
	/** DisplaySettings.hudScale. */
	readonly hudPercent: number;
	/** The HUD's safe area (KV_GameHud, CoreUISafeInsets), screen px. */
	readonly safe: ScreenRect;
	/** The free part of the Roblox top bar (GuiService.TopbarInset), screen px; zero-sized when there is none. */
	readonly topbar: ScreenRect;
	/**
	 * Screen px kept for the game's pause button: from the free top bar's left to the button's right edge (on touch the
	 * allowance for Roblox's voice button, the gap and the size: shared/view/menu pauseButtonSlot), or, with no top
	 * bar, from the screen's left (its fallback margin and size); 0 for none.
	 */
	readonly reserveLeft: number;
}

/** What the strip shows (the snapshot's counts), so its widths can be estimated. */
export interface TouchStripContent {
	/**
	 * Half hearts (heartFills draws ceil(heartsMax / 2) hearts; an odd maximum's last one is a half container,
	 * docs/SILVER.md SV16, in a whole heart slot like the others).
	 */
	readonly heartsMax: number;
	/** The tutorial's ghost half heart after the hearts. */
	readonly ghost: boolean;
	/** Armor slots plus Aegis pips after the hearts. */
	readonly pips: number;
	readonly flaskMax: number;
	readonly emberMax: number;
	/** A scored run shows the score group. */
	readonly scoring: boolean;
	readonly score: number;
	/** The pack's art (undefined: the flat look). */
	readonly art?: TouchStripArt;
}

/** A drawn slot, reference px. */
export interface StripSlot {
	readonly w: number;
	readonly h: number;
}

export interface TouchStripSlots {
	readonly heart: StripSlot;
	readonly pip: StripSlot;
	readonly flask: StripSlot;
	readonly candle: StripSlot;
	readonly coin: StripSlot;
}

/** Each group's estimated width, reference px (0: not shown). */
export interface TouchStripWidths {
	readonly hearts: number;
	readonly flask: number;
	readonly ember: number;
	readonly score: number;
	/** Everything with the gaps between the shown groups. */
	readonly total: number;
}

export type TouchStripPlacement = "topBar" | "belowBar";

export interface TouchStripLayout {
	/** The strip's UIScale (reference px -> screen px): the touch HUD scale times the fit. */
	readonly scale: number;
	/** The touch HUD scale (computeHudScale with touch). */
	readonly hudScale: number;
	/** The fit (1: full size; down to TOUCH_STRIP.minFit in the top bar). */
	readonly fit: number;
	readonly placement: TouchStripPlacement;
	/** The multiplier's text shows (collapse step 1 hides it). */
	readonly showMult: boolean;
	/** The hearts are one heart and a count (collapse step 2). */
	readonly heartsAsCount: boolean;
	readonly slots: TouchStripSlots;
	readonly widths: TouchStripWidths;
	/** The row's height (TOUCH_STRIP.rowHeight, or taller when an art icon overflows its box), reference px. */
	readonly rowHeight: number;
	/** The widest the strip and the chips line may be, reference px (the free width at `scale`). */
	readonly maxWidth: number;
	/** The strip's fade group (row, combo line, chips line and the ring pad around them), screen px. */
	readonly group: ScreenRect;
	/** The row and the combo line (the strip proper), screen px; `w` is the free width. */
	readonly strip: ScreenRect;
	/** The chips line's slot, screen px (reserved whether or not anything owns a chip). */
	readonly chips: ScreenRect;
	/** The slim boss bar's slot, screen px (reserved: the tutorial prompt sits under it either way). */
	readonly boss: ScreenRect;
	/** Where the score's centre is drawn (estimated), screen px: the room clear tally flies there. */
	readonly scoreAt: { readonly x: number; readonly y: number };
	/** The HUD's box on touch, screen px: the fade group and the boss slot (the touch controls keep clear of both). */
	readonly footprint: ReadonlyArray<ScreenRect>;
	/**
	 * In KV_GameHud's reference px (under its UIScale, from the safe area's top): the top-centre slot's top, where the
	 * slim boss bar and, on touch, the room clear stamp hang.
	 */
	readonly bossTop: number;
	/** The safe area's top left, screen px (KV_GameHud's origin: a point there is (p - hudOrigin) / hudScale). */
	readonly hudOrigin: { readonly x: number; readonly y: number };
	/**
	 * In KV_GameHud's reference px: the first free row under that slot at its tallest (the boss bar or the stamp and
	 * tally, HUD_TRANSIENT.roomClear): the touch tutorial prompt's and the room clear chips' top.
	 */
	readonly belowTop: number;
}

const HALF = 0.5;
/** Hearts per half heart. */
const HALVES = 2;
const DIGIT_BASE = 10;

function textWidth(chars: number, size: number): number {
	return chars * size * TOUCH_STRIP.charEm;
}

/** Digits of a whole non-negative number (at least one). */
export function digitCount(n: number): number {
	let d = 1;
	let v = math.floor(math.abs(n));
	while (v >= DIGIT_BASE) {
		v = math.floor(v / DIGIT_BASE);
		d += 1;
	}
	return d;
}

/** The text of the collapsed hearts' count: whole hearts, with ".5" for a half ("2.5"). */
export function heartsCountText(halfHearts: number): string {
	const h = math.max(0, math.floor(halfHearts));
	const whole = math.floor(h / HALVES);
	return h % HALVES === 0 ? tostring(whole) : `${whole}.5`;
}

/** An art icon's slot in `box` at UIScale `s` (as wide as the fitted art, as tall as the box or the art), or flat. */
function slotOf(art: { readonly w: number; readonly h: number } | undefined, box: number, flat: number, s: number) {
	if (art === undefined || !(art.w > 0 && art.h > 0)) return { w: flat, h: flat };
	const fit = fitArt(art.w, art.h, box, box, s);
	return { w: fit.w, h: math.max(box, fit.h) };
}

/** The icon slots at UIScale `s`. */
export function touchStripSlots(art: TouchStripArt | undefined, s: number): TouchStripSlots {
	const T = TOUCH_STRIP;
	const heart = slotOf(art?.heart, T.iconBox, T.iconBox, s);
	return {
		// A heart keeps the full box (the tutorial's ghost heart takes the same one).
		heart: { w: math.max(heart.w, T.iconBox), h: heart.h },
		pip:
			art?.pip !== undefined && art.pipBox !== undefined
				? { w: art.pipBox, h: art.pipBox }
				: slotOf(art?.pip, T.pipBox, T.pipBox, s),
		flask: slotOf(art?.flask, T.iconBox, T.flatIcon, s),
		candle: slotOf(art?.candle, T.iconBox, T.flatIcon, s),
		coin: slotOf(art?.coin, T.iconBox, T.flatIcon, s),
	};
}

/** `n` slots `w` wide with `gap` between them. */
function run(n: number, w: number, gap: number): number {
	return n > 0 ? n * w + (n - 1) * gap : 0;
}

/** Each group's width (reference px) with these slots, the multiplier shown or not, the hearts as icons or a count. */
export function touchStripWidths(
	content: TouchStripContent,
	slots: TouchStripSlots,
	showMult: boolean,
	heartsAsCount: boolean,
): TouchStripWidths {
	const T = TOUCH_STRIP;
	const heartCount = math.ceil(math.max(0, content.heartsMax) / HALVES);
	// Hearts: every heart (or one heart and a count like "10.5"), the ghost heart, then the pips.
	let hearts = heartsAsCount
		? slots.heart.w + T.itemGap + textWidth(digitCount(heartCount) + 2, T.countText)
		: run(heartCount, slots.heart.w, T.itemGap);
	if (content.ghost) hearts += T.itemGap + slots.heart.w;
	if (content.pips > 0) hearts += T.itemGap + run(content.pips, slots.pip.w, T.itemGap);
	const flask = slots.flask.w + T.pairGap + textWidth(digitCount(content.flaskMax), T.countText);
	const ember = slots.candle.w + T.pairGap + textWidth(digitCount(content.emberMax), T.countText);
	let score = 0;
	if (content.scoring) {
		const digits = math.max(T.minScoreDigits, digitCount(content.score));
		score = slots.coin.w + T.pairGap + textWidth(digits, T.scoreText);
		if (showMult) score += T.pairGap * 2 + textWidth(T.multChars, T.multText);
	}
	const groups = [hearts, flask, ember, score];
	let total = 0;
	let shown = 0;
	for (const w of groups) {
		if (w <= 0) continue;
		total += w + (shown > 0 ? T.groupGap : 0);
		shown += 1;
	}
	return { hearts, flask, ember, score, total };
}

/** The row's height at these slots: TOUCH_STRIP.rowHeight, or the tallest slot when an icon overflows it. */
function rowHeightOf(slots: TouchStripSlots): number {
	return math.max(TOUCH_STRIP.rowHeight, slots.heart.h, slots.pip.h, slots.flask.h, slots.candle.h, slots.coin.h);
}

interface StripFit {
	readonly fit: number;
	readonly showMult: boolean;
	readonly heartsAsCount: boolean;
	readonly slots: TouchStripSlots;
	readonly widths: TouchStripWidths;
}

/** The collapse steps in order: everything; no multiplier text; hearts as a count. */
const STEPS: ReadonlyArray<readonly [boolean, boolean]> = [
	[true, false],
	[false, false],
	[false, true],
];

/**
 * The first collapse step that fits `availPx` screen px at the HUD scale, else the largest fit in [minFit, 1) of the
 * last step, else undefined (with `anyFit`: the last step at whatever fit it takes, never above 1).
 */
function pickFit(content: TouchStripContent, hud: number, availPx: number, anyFit: boolean): StripFit | undefined {
	const T = TOUCH_STRIP;
	const full = touchStripSlots(content.art, hud);
	for (const [showMult, heartsAsCount] of STEPS) {
		const widths = touchStripWidths(content, full, showMult, heartsAsCount);
		if (widths.total * hud <= availPx) return { fit: 1, showMult, heartsAsCount, slots: full, widths };
	}
	for (let i = 1; i <= T.fitSteps; i++) {
		const fit = 1 - ((1 - T.minFit) * i) / T.fitSteps;
		const s = hud * fit;
		const slots = touchStripSlots(content.art, s);
		const widths = touchStripWidths(content, slots, false, true);
		if (widths.total * s <= availPx) return { fit, showMult: false, heartsAsCount: true, slots, widths };
	}
	if (!anyFit) return undefined;
	const slots = touchStripSlots(content.art, hud * T.minFit);
	const widths = touchStripWidths(content, slots, false, true);
	const fit = widths.total > 0 ? math.min(1, availPx / (widths.total * hud)) : 1;
	const s = hud * fit;
	const fitted = touchStripSlots(content.art, s);
	return {
		fit,
		showMult: false,
		heartsAsCount: true,
		slots: fitted,
		widths: touchStripWidths(content, fitted, false, true),
	};
}

/** The strip's total height under the row (combo line) and the chips line, reference px. */
export function touchStripHeights(rowHeight: number): { strip: number; chips: number } {
	const T = TOUCH_STRIP;
	return { strip: rowHeight + T.comboGap + T.comboHeight, chips: T.chips.gap + T.chips.cell };
}

/**
 * Lays the strip out for a screen and its content. In the top bar when there is one and the strip fits there (after
 * the collapse steps), its row centred on the bar's height, from the pause button's slot to the free bar's right end
 * (or the safe area's, whichever is nearer); otherwise at the top of the safe area, HUD_VIEW.margin in.
 */
export function touchStrip(geo: TouchStripGeometry, content: TouchStripContent): TouchStripLayout {
	const T = TOUCH_STRIP;
	const hud = computeHudScale(geo.viewportW, geo.viewportH, false, geo.hudPercent, true);
	const safe = geo.safe;
	const safeRight = safe.x + safe.w;
	const bar = geo.topbar;
	let placement: TouchStripPlacement = "belowBar";
	let picked: StripFit | undefined;
	let x0 = 0;
	let x1 = 0;
	if (bar.w > 0 && bar.h > 0) {
		x0 = math.max(bar.x + geo.reserveLeft + T.barGap * hud, safe.x);
		x1 = math.min(bar.x + bar.w, safeRight) - T.edge * hud;
		picked = x1 > x0 ? pickFit(content, hud, x1 - x0, false) : undefined;
		if (picked !== undefined) placement = "topBar";
	}
	if (picked === undefined) {
		x0 = safe.x + HUD_VIEW.margin * hud;
		// No top bar: the pause button falls back to the screen's top left (reserveLeft covers it there).
		if (!(bar.w > 0 && bar.h > 0)) x0 = math.max(x0, geo.reserveLeft + T.barGap * hud);
		x1 = safeRight - HUD_VIEW.margin * hud;
		picked = pickFit(content, hud, math.max(0, x1 - x0), true)!;
	}
	const s = hud * picked.fit;
	const rowHeight = rowHeightOf(picked.slots);
	const heights = touchStripHeights(rowHeight);
	const rowTop =
		placement === "topBar"
			? math.max(bar.y, bar.y + (bar.h - rowHeight * s) * HALF)
			: safe.y + HUD_VIEW.margin * hud;
	const w = x1 - x0;
	const strip = { x: x0, y: rowTop, w, h: heights.strip * s };
	const chips = { x: x0, y: strip.y + strip.h + T.chips.gap * s, w, h: T.chips.cell * s };
	const pad = T.ringPad * s;
	const group = { x: x0 - pad, y: rowTop - pad, w: w + pad * 2, h: (heights.strip + heights.chips) * s + pad * 2 };

	// The boss slot: a gap under the chips line, under the fade group (its ring pad) and the safe area's top, centred
	// on the safe area.
	const bossW = math.min(T.boss.width, safe.w / hud - HUD_VIEW.margin * 2) * hud;
	const gap = T.boss.gap * hud;
	const bossY = math.max(chips.y + chips.h + gap, group.y + group.h, safe.y + gap);
	const boss = { x: safe.x + (safe.w - bossW) * HALF, y: bossY, w: bossW, h: T.boss.height * hud };
	const bossTop = (boss.y - safe.y) / hud;
	const belowTop = bossTop + math.max(T.boss.height, HUD_TRANSIENT.roomClear.height) + T.belowGap;

	const ws = picked.widths;
	let before = 0;
	for (const g of [ws.hearts, ws.flask, ws.ember]) if (g > 0) before += g + T.groupGap;
	const scoreAt = { x: x0 + (before + ws.score * HALF) * s, y: rowTop + rowHeight * HALF * s };

	return {
		scale: s,
		hudScale: hud,
		fit: picked.fit,
		placement,
		showMult: picked.showMult,
		heartsAsCount: picked.heartsAsCount,
		slots: picked.slots,
		widths: ws,
		rowHeight,
		maxWidth: w / s,
		group,
		strip,
		chips,
		boss,
		scoreAt,
		footprint: [group, boss],
		bossTop,
		hudOrigin: { x: safe.x, y: safe.y },
		belowTop,
	};
}

/**
 * How far below the safe area's top the status / score corner boxes reached on touch before the strip (HUD_VIEW.margin
 * plus the taller HUD_FOOTPRINT box at the touch HUD scale), screen px: the strip spec reports against it.
 */
export function touchCornerBoxesHeight(viewportW: number, viewportH: number, hudPercent: number): number {
	const hud = computeHudScale(viewportW, viewportH, false, hudPercent, true);
	return (HUD_VIEW.margin + math.max(HUD_FOOTPRINT.status.maxH, HUD_FOOTPRINT.score.maxH)) * hud;
}
