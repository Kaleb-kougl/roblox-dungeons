/**
 * Prediction suspended while the local player is hooked (docs/NEW_ENEMIES_2.md Architecture 4, NX7), pure. A
 * Chainhook's drag moves the player inside stepActors, which shared/lockstep predictMotion does not (and must not)
 * mirror, so while MERGED state says a Chainhook drags the local player (shared/sim chainhookHolderOf) the knight is
 * drawn at its merged position; when the drag ends the drawn body blends back to the prediction instead of snapping.
 *
 *   PredictionResume.update(hooked, dt)  the prediction's weight this frame: 0 while hooked (or falling to 0 over
 *                                        suspendSec), then rising to 1 over resumeSec of real time; each frame's step
 *                                        at most blendMaxStep (a long frame never jumps the whole gap). reset(): 1 (a
 *                                        run start, a floor change: nothing to blend from).
 *   blendTowardMerged(out, merged, w)    out (the drawn player as writeDrawnPlayer wrote it) moved to merged + w x
 *                                        (out - merged) on x / z and prevX / prevZ, so a view's lerp(prev, x, alpha) is
 *                                        that blend of the two interpolated poses. w >= 1: untouched (bit-exact).
 *
 * The predictor itself is untouched (predictMotion and its parity spec): only what is drawn changes.
 *
 * @module
 */
import type { PlayerState } from "shared/sim";
import type { PredictionViewTunables } from "./config";

export class PredictionResume {
	private w = 1;

	constructor(private readonly tunables: PredictionViewTunables) {}

	/** The prediction's weight now (0 drawn merged .. 1 drawn predicted). */
	weight(): number {
		return this.w;
	}

	/** Nothing to blend: fully predicted again (a run start, a floor change, a spectate switch). */
	reset(): void {
		this.w = 1;
	}

	/** This frame's weight: `hooked` from merged state, `dt` real seconds since the last frame. */
	update(hooked: boolean, dt: number): number {
		const t = this.tunables;
		const d = math.max(0, dt);
		if (hooked) {
			this.w = t.suspendSec > 0 ? math.max(0, this.w - math.min(d / t.suspendSec, t.blendMaxStep)) : 0;
		} else if (this.w < 1) {
			this.w = t.resumeSec > 0 ? math.min(1, this.w + math.min(d / t.resumeSec, t.blendMaxStep)) : 1;
		}
		return this.w;
	}
}

/** Moves `out`'s position and prev toward `merged`'s: merged + w x (out - merged). w >= 1 leaves `out` as it is. */
export function blendTowardMerged(out: PlayerState, merged: Readonly<PlayerState>, w: number): void {
	if (w >= 1) return;
	const k = math.max(0, w);
	out.x = merged.x + (out.x - merged.x) * k;
	out.z = merged.z + (out.z - merged.z) * k;
	out.prevX = merged.prevX + (out.prevX - merged.prevX) * k;
	out.prevZ = merged.prevZ + (out.prevZ - merged.prevZ) * k;
}
