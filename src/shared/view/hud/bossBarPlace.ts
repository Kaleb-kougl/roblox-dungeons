/**
 * Where the boss bar sits (desktop / console; on touch the slim bar stays in the touch strip): top centre as before,
 * or bottom centre while the boss's sprite is under the top spot, so the bar never hides the boss. Pure: the client's
 * BossBarPlacementController projects the boss and the bar's spots to GUI px and steps one BossBarPlacer.
 *
 * Rule: from the top, the bar drops to the bottom as soon as the boss's screen box comes within `enterPadPx` of the
 * top spot. From the bottom it goes back up once the boss has kept `exitPadPx` clear of the top spot for
 * `holdSeconds` (the wider exit pad and the hold stop a boss pacing along the screen's top edge from flipping the bar
 * back and forth), or at once when the boss reaches the bottom spot while clear of the top one. Presentation only.
 *
 * @module
 */
import type { ScreenRect } from "./footprint";

export const BOSS_BAR_PLACE = {
	/** The client re-tests every this many frames (HUD_OCCLUSION.everyFrames' rate). */
	everyFrames: 3,
	/**
	 * The boss's drawn height above its floor point, in tiles (both bosses' art: bodyTiles 2.5 plus the art's headroom).
	 * Its screen box is the projected floor point to the projected head, widthShare of that height wide.
	 */
	heightTiles: 3,
	widthShare: 0.8,
	/** Reference px (times the HUD scale): how near the top spot the boss's box may come before the bar drops. */
	enterPadPx: 12,
	/** Reference px (times the HUD scale): how clear of the top spot the boss's box must stay for the bar to go up. */
	exitPadPx: 48,
	/** Seconds the boss must stay clear before the bar goes back up. */
	holdSeconds: 0.75,
} as const;

export type BossBarSpot = "top" | "bottom";

/** A writable ScreenRect (the client reuses one per pass). */
export interface MutableScreenRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * The boss's screen box from its projected floor point (`feetX`, `feetY`) and head point (`headX`, `headY`), in GUI px,
 * written to `out`: from the head down to the feet, `widthShare` of that height wide, centred between the two points.
 */
export function bossScreenBox(
	feetX: number,
	feetY: number,
	headX: number,
	headY: number,
	widthShare: number,
	out: MutableScreenRect,
): MutableScreenRect {
	const top = math.min(feetY, headY);
	const h = math.abs(feetY - headY);
	const w = h * widthShare;
	out.x = (feetX + headX) / 2 - w / 2;
	out.y = top;
	out.w = w;
	out.h = h;
	return out;
}

/** True when `a` comes within `pad` px of `b` (shares area with `b` grown by `pad` on every side). */
export function rectNear(a: ScreenRect, b: ScreenRect, pad: number): boolean {
	return a.x < b.x + b.w + pad && b.x - pad < a.x + a.w && a.y < b.y + b.h + pad && b.y - pad < a.y + a.h;
}

/** One boss bar's placement over time (BOSS_BAR_PLACE's rule). Starts at the top. */
export class BossBarPlacer {
	private spotNow: BossBarSpot = "top";
	private clearFor = 0;

	spot(): BossBarSpot {
		return this.spotNow;
	}

	reset(): void {
		this.spotNow = "top";
		this.clearFor = 0;
	}

	/**
	 * Steps `dt` seconds. `boss`: the boss's screen box (undefined: none or behind the camera). `top`: the bar's rect at
	 * the top spot; `bottom`: at the bottom spot (undefined: not known yet). `scale`: the HUD scale (the pads are
	 * reference px). Returns the spot to draw.
	 */
	update(
		boss: ScreenRect | undefined,
		top: ScreenRect,
		bottom: ScreenRect | undefined,
		scale: number,
		dt: number,
	): BossBarSpot {
		const P = BOSS_BAR_PLACE;
		const step = math.max(dt, 0);
		if (this.spotNow === "top") {
			if (boss !== undefined && rectNear(boss, top, P.enterPadPx * scale)) {
				this.spotNow = "bottom";
				this.clearFor = 0;
			}
			return this.spotNow;
		}
		const nearTop = boss !== undefined && rectNear(boss, top, P.exitPadPx * scale);
		if (nearTop) {
			this.clearFor = 0;
			return this.spotNow;
		}
		if (boss !== undefined && bottom !== undefined && rectNear(boss, bottom, P.enterPadPx * scale)) {
			this.reset();
			return this.spotNow;
		}
		this.clearFor += step;
		if (this.clearFor >= P.holdSeconds) this.reset();
		return this.spotNow;
	}
}
