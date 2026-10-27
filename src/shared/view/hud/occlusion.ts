/**
 * The corner panels' occlusion fade (docs/HUD_LAYOUT.md H7): when the watched player, a living enemy, the boss or an
 * enemy bullet is under an always-on corner panel, that panel fades to mostly transparent and comes back once the
 * area has stayed clear for a moment. Pure: screen rects and points in, booleans and transparencies out; the client
 * (HudOcclusionController) projects the world and drives the panels' GroupTransparency bindings.
 */
import type { ScreenRect } from "./footprint";

/** Occlusion fade tunables. Times are real seconds; padPx is reference px (the client multiplies by the HUD scale). */
export const HUD_OCCLUSION = {
	/** Fade from opaque to occludedTransparency (and back) over this long. */
	fadeSeconds: 0.15,
	/** A panel stays faded until its area has been clear this long (so a bullet stream does not flicker it). */
	holdSeconds: 0.4,
	/** GroupTransparency of a fully faded panel. */
	occludedTransparency: 0.75,
	/** The client tests occlusion every this many frames (the fade itself advances every frame). */
	everyFrames: 3,
	/** Enemy bullets tested per pass, at most (any one inside a panel fades it, so no sorting). */
	maxBullets: 64,
	/** A point this close to a panel's edge counts as under it (the sprite's body around its floor point). */
	padPx: 24,
} as const;

/** A screen point in px. */
export interface ScreenPoint {
	x: number;
	y: number;
}

/** True when (px, py) is inside `r` grown by `pad` on every side. */
export function pointInRect(px: number, py: number, r: ScreenRect, pad: number): boolean {
	return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
}

/**
 * For each rect (the mounted panels only: a Luau array cannot hold undefined holes), whether any of the first `count`
 * points lies inside it (grown by `padPx`). Fills and returns `out` (one entry per rect; reuse it across frames).
 */
export function occludedPanels(
	rects: ReadonlyArray<ScreenRect>,
	points: ReadonlyArray<Readonly<ScreenPoint>>,
	count: number,
	padPx: number,
	out: boolean[],
): boolean[] {
	const n = math.min(count, points.size());
	const rectCount = rects.size();
	for (let r = 0; r < rectCount; r++) {
		const rect = rects[r];
		let hit = false;
		for (let i = 0; i < n; i++) {
			const p = points[i];
			if (pointInRect(p.x, p.y, rect, padPx)) {
				hit = true;
				break;
			}
		}
		out[r] = hit;
	}
	return out;
}

/**
 * One panel's fade state. `update(occluded, dt, motion)` returns the panel's GroupTransparency: it fades toward
 * HUD_OCCLUSION.occludedTransparency over fadeSeconds while occluded, holds until the area has been clear for
 * holdSeconds, then fades back to 0. Reduced motion (`motion <= 0`, shared/view/fx motionScale) switches instantly
 * (the hold still applies).
 */
export class OcclusionFader {
	/** 0 = opaque, 1 = fully faded. */
	private amount = 0;
	/** Seconds since the panel was last occluded (starts clear). */
	private clearFor: number = HUD_OCCLUSION.holdSeconds;

	update(occluded: boolean, dt: number, motion: number): number {
		const step = dt > 0 ? dt : 0;
		if (occluded) this.clearFor = 0;
		else this.clearFor = math.min(this.clearFor + step, HUD_OCCLUSION.holdSeconds);
		const target = occluded || this.clearFor < HUD_OCCLUSION.holdSeconds ? 1 : 0;
		if (motion <= 0 || HUD_OCCLUSION.fadeSeconds <= 0) {
			this.amount = target;
		} else {
			const delta = step / HUD_OCCLUSION.fadeSeconds;
			this.amount =
				target > this.amount ? math.min(target, this.amount + delta) : math.max(target, this.amount - delta);
		}
		return this.transparency();
	}

	transparency(): number {
		return this.amount * HUD_OCCLUSION.occludedTransparency;
	}

	/** Back to opaque and clear (a new run, the setting turned off). */
	reset(): void {
		this.amount = 0;
		this.clearFor = HUD_OCCLUSION.holdSeconds;
	}
}
