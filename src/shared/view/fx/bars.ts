/**
 * Enemy health bar geometry and per-kind drawn sizes (port of project-kaleb-vale src/fx/bars/barLayout.ts and
 * actorSizes.ts @ 42897e2). Pure pixel layout, no Roblox API (bars.spec.ts).
 *
 * Everything is in RENDER PIXELS relative to the actor's feet anchor, y UP (screen-up). The client draws a bar as a
 * BillboardGui at the feet with a camera-space StudsOffset, so 1 render px = FX_VIEW.pxStuds studs on screen (the web
 * build's 16 px per tile at STUDS_PER_TILE studs per tile).
 *
 *   plate (enemyHealthBack, or enemyHealthElite for elites)    innerW + 2 wide, BAR_FILL_H + 2 tall: 1 px outline
 *   inner (bar: chip + fill, 2 px tall; pips: one quad per hp)  innerW wide, 1 px inside the plate
 *
 * The plate's bottom sits BAR_GAP pixels above the drawn sprite's top.
 *
 * Port change: the web build sized sprites from their sheet frames (16x16 enemies). The Roblox placeholders are 3D
 * primitives seen from the iso camera, so a kind's drawn size is its placeholder's SCREEN extent (placeholderScreenSize):
 * the width across the view and the height of its top edge above the feet, in render px.
 */

/** Bar inner width as a fraction of the drawn sprite width (16 px sprite -> 12 px bar). */
export const BAR_WIDTH_RATIO = 0.75;
/** Narrowest bar (inner width, px). */
export const BAR_MIN_WIDTH = 10;
/** Pixels between the sprite's top edge and the bottom of the bar's plate. */
export const BAR_GAP = 2;
/** Height of the fill / pips (px); the plate adds a 1 px outline around it. */
export const BAR_FILL_H = 2;
/** Enemies with hpMax <= this show one pip per hp instead of a bar. */
export const PIP_MAX_HP = 4;
/** Gap between pips (px; the plate shows through). */
export const PIP_GAP = 1;
/** Float slack: hpMax 4.0000001 still counts as 4 pips; drawn heights never poke through the bar. */
const PX_EPS = 1e-6;
const PIP_EPS = 1e-9;
/** Pip width: 3 px for up to 3 pips, 2 px for 4 (keeps a 4-pip row at 11 px, under the 12 px bar). */
const WIDE_PIP_MAX = 3;
const WIDE_PIP = 3;
const NARROW_PIP = 2;

export function pipWidth(pips: number): number {
	return pips <= WIDE_PIP_MAX ? WIDE_PIP : NARROW_PIP;
}

/** Drawn size of an actor in render pixels. */
export interface DrawnSize {
	w: number;
	h: number;
}

/**
 * The web rule for a sprite: frame size x spriteScale, bosses widened to at least `bossMinPx`. Width rounds; height
 * rounds up (the sprite's top edge never pokes through the bar). Writes `out` and returns it.
 */
export function drawnSpriteSize(
	frameW: number,
	frameH: number,
	spriteScale: number | undefined,
	boss: boolean,
	bossMinPx: number,
	out: DrawnSize,
): DrawnSize {
	let scale = spriteScale ?? 1;
	if (boss && frameW * scale < bossMinPx) scale = bossMinPx / frameW;
	out.w = math.round(frameW * scale);
	out.h = math.ceil(frameH * scale - PX_EPS);
	return out;
}

/**
 * The screen extent of a placeholder primitive of `sizeStuds` [x, y, z] at `scale`, seen by the iso camera pitched
 * `pitchRad` below the horizon, in render px of `pxStuds` studs: width = its widest horizontal side; height = how far
 * its top-back edge sits above the feet on screen (height * cos(pitch) + half the depth * sin(pitch)). Writes `out`.
 */
export function placeholderScreenSize(
	sizeStuds: readonly [number, number, number],
	scale: number,
	pitchRad: number,
	pxStuds: number,
	out: DrawnSize,
): DrawnSize {
	const wide = math.max(sizeStuds[0], sizeStuds[2]) * scale;
	const tall = sizeStuds[1] * scale;
	out.w = math.round(wide / pxStuds);
	out.h = math.ceil((tall * math.cos(pitchRad) + (wide / 2) * math.sin(pitchRad)) / pxStuds - PX_EPS);
	return out;
}

/** Bar inner width for a sprite drawn `drawnW` px wide: BAR_WIDTH_RATIO of it, even, >= BAR_MIN_WIDTH. */
export function barInnerWidth(drawnW: number): number {
	return math.max(BAR_MIN_WIDTH, 2 * math.round((drawnW * BAR_WIDTH_RATIO) / 2));
}

/** Number of pips for hpMax (0 = draw a bar). */
export function pipCount(hpMax: number): number {
	const n = math.ceil(hpMax - PIP_EPS);
	return n >= 1 && n <= PIP_MAX_HP ? n : 0;
}

/** One actor's bar layout (px, relative to the feet anchor, y up). Reused: barGeometry() writes it in place. */
export interface BarGeometry {
	/** 0 for a bar, else the number of pips. */
	pips: number;
	/** Pip width (pips only). */
	pipW: number;
	/** Inner (fill / pip row) width and its left edge. */
	innerW: number;
	innerLeft: number;
	/** Bottom of the inner row. */
	innerBottom: number;
	/** Plate (outline) rect: one pixel around the inner row. */
	plateLeft: number;
	plateBottom: number;
	plateW: number;
	plateH: number;
	/** Top edge of the plate (where things above the bar can start). */
	top: number;
}

export function createBarGeometry(): BarGeometry {
	return {
		pips: 0,
		pipW: 0,
		innerW: 0,
		innerLeft: 0,
		innerBottom: 0,
		plateLeft: 0,
		plateBottom: 0,
		plateW: 0,
		plateH: 0,
		top: 0,
	};
}

/** Lays out the bar (or pip row) for a sprite drawn `drawnW` x `drawnH` px with `hpMax`. Writes `out` and returns it. */
export function barGeometry(drawnW: number, drawnH: number, hpMax: number, out: BarGeometry): BarGeometry {
	const pips = pipCount(hpMax);
	out.pips = pips;
	if (pips > 0) {
		out.pipW = pipWidth(pips);
		out.innerW = pips * out.pipW + (pips - 1) * PIP_GAP;
	} else {
		out.pipW = 0;
		out.innerW = barInnerWidth(drawnW);
	}
	out.innerLeft = -math.floor(out.innerW / 2);
	out.plateLeft = out.innerLeft - 1;
	out.plateBottom = drawnH + BAR_GAP;
	out.plateW = out.innerW + 2;
	out.plateH = BAR_FILL_H + 2;
	out.innerBottom = out.plateBottom + 1;
	out.top = out.plateBottom + out.plateH;
	return out;
}

/** Left edge of pip i (0 = leftmost). */
export function pipLeft(g: Readonly<BarGeometry>, i: number): number {
	return g.innerLeft + i * (g.pipW + PIP_GAP);
}

/** Width in px of a bar segment worth `value` of `max` (whole pixels; anything above 0 shows at least 1 px). */
export function segmentWidth(innerW: number, value: number, max: number): number {
	if (!(value > 0) || !(max > 0)) return 0;
	const w = math.round((innerW * math.min(value, max)) / max);
	return w < 1 ? 1 : w;
}

// ---------------------------------------------------------------------------------------------
// Per-kind size cache (web actorSizes.ts)

/** A kind's drawn size and boss flag. */
export interface KindSize {
	/** Drawn size, render px. */
	readonly w: number;
	readonly h: number;
	readonly boss: boolean;
}

const FALLBACK: KindSize = { w: 16, h: 16, boss: false };

/** Lazily filled, one entry per kind; make a new cache when the theme pack changes. The lookup is injected. */
export class ActorSizeCache {
	private readonly sizes = new Map<number, KindSize>();
	constructor(private readonly describe: (kind: number) => KindSize) {}

	/** Size of `kind` (a 16 x 16 plain enemy for unknown kinds or a failing lookup). */
	get(kind: number): KindSize {
		if (kind < 0) return FALLBACK;
		let s = this.sizes.get(kind);
		if (s === undefined) {
			const [ok, result] = pcall(() => this.describe(kind));
			s = ok ? (result as KindSize) : FALLBACK;
			this.sizes.set(kind, s);
		}
		return s;
	}
}
