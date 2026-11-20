/**
 * Local prediction's correction smoothing (docs/LOCAL_PREDICTION.md Design 4, LP4), pure: turns the predictor's heads
 * (shared/lockstep LocalPredictor, rebuilt after every pump that stepped) into the pose the views draw, so a corrected
 * guess glides instead of jumping.
 *
 *   feed(head, path)  the latest prediction: its head (the body at the path's last tick, prevX / prevZ a tick before)
 *                     and its path (the position at every replayed tick, by state tick). The smoother keeps the head it
 *                     was last fed and its tick; when the new path disagrees with it at that tick (a newer guess for the
 *                     same moment), the difference old - new is added to the visual offset, so the drawn body stays
 *                     where it was. An old head past the new path's end (the horizon shrank) is compared with the new
 *                     head, one before its start (a catch-up stepped past it) with the path's first (merged) position.
 *                     A difference over snapTiles snaps instead (offset 0, counted), as does `snap()` (a floor change,
 *                     run start, death, revive, a spectate switch, a draft opening or closing: the caller's events) and
 *                     feeding undefined (not predicting: the next prediction starts fresh).
 *   draw(alpha, dt)   the drawn pose: lerp(prev, x, alpha) + offset, after the offset decays by 0.5 ^ (dt / halfLifeSec)
 *                     of real time; never farther than maxOffsetTiles from the prediction. Facing passes through
 *                     unsmoothed (8 sprite facings: a turn is a turn).
 *
 * With no correction the drawn pose is exactly lerp(prev, x, alpha). Tiles throughout (sim units). No allocation.
 *
 * @module
 */
import type { PredictionViewTunables } from "./config";

/** The predicted body the smoother reads (a shared/lockstep LocalPredictor head; any PlayerState fits). */
export interface PredictedBody {
	readonly x: number;
	readonly z: number;
	readonly prevX: number;
	readonly prevZ: number;
	readonly faceX: number;
	readonly faceZ: number;
}

/** A prediction's positions by state tick (shared/lockstep PredictedPath): entry k at tick firstTick + k. */
export interface PredictionPath {
	readonly firstTick: number;
	readonly size: number;
	readonly xs: ReadonlyArray<number>;
	readonly zs: ReadonlyArray<number>;
}

/** The drawn pose (sim units), written in place by draw(). */
export interface DrawnPose {
	x: number;
	z: number;
	faceX: number;
	faceZ: number;
}

/**
 * Turns the local predictor's output into the pose the views draw (see the file comment): `feed` after every pump that
 * stepped, `draw(alpha, dt)` every rendered frame, `snap()` on the caller's hard cuts. Positions are tiles, `dt` real
 * seconds. It also counts its snaps and smoothed corrections for the debug line. Owned by the client's SimController,
 * built with `PREDICTION_VIEW`.
 */
export class PredictionSmoother {
	private head: PredictedBody | undefined;
	/** The head last fed: its tick (-1: none, nothing to compare) and position. */
	private lastTick = -1;
	private lastX = 0;
	private lastZ = 0;
	private offX = 0;
	private offZ = 0;
	private snaps = 0;
	private corrections = 0;
	private readonly drawn: DrawnPose = { x: 0, z: 0, faceX: 0, faceZ: 0 };

	constructor(private readonly tunables: PredictionViewTunables) {}

	/** Snaps: no offset, nothing to glide from. Counted when it drops an offset. */
	snap(): void {
		if (this.offX !== 0 || this.offZ !== 0) this.snaps++;
		this.reset();
	}

	private reset(): void {
		this.offX = 0;
		this.offZ = 0;
		this.lastTick = -1;
	}

	/** The latest prediction (see the file comment); undefined: not predicting (resets the smoothing). */
	feed(head: PredictedBody | undefined, path: PredictionPath | undefined): void {
		this.head = head;
		if (head === undefined || path === undefined || path.size === 0) {
			this.head = undefined;
			this.reset();
			return;
		}
		if (this.lastTick >= 0) {
			let k = this.lastTick - path.firstTick;
			if (k < 0) k = 0;
			else if (k > path.size - 1) k = path.size - 1;
			const dx = this.lastX - path.xs[k];
			const dz = this.lastZ - path.zs[k];
			if (dx !== 0 || dz !== 0) {
				const snap = this.tunables.snapTiles;
				if (dx * dx + dz * dz > snap * snap) {
					this.snaps++;
					this.offX = 0;
					this.offZ = 0;
				} else {
					this.offX += dx;
					this.offZ += dz;
					this.corrections++;
				}
			}
		}
		this.lastTick = path.firstTick + path.size - 1;
		this.lastX = head.x;
		this.lastZ = head.z;
	}

	/** The drawn pose this frame (see the file comment); undefined while nothing is predicted. Reused: read it now. */
	draw(alpha: number, dt: number): Readonly<DrawnPose> | undefined {
		const head = this.head;
		if (head === undefined) return undefined;
		const t = this.tunables;
		if (this.offX !== 0 || this.offZ !== 0) {
			const k = dt > 0 ? math.pow(0.5, dt / t.halfLifeSec) : 1;
			this.offX *= k;
			this.offZ *= k;
			const d2 = this.offX * this.offX + this.offZ * this.offZ;
			const max = t.maxOffsetTiles;
			if (d2 > max * max) {
				const s = max / math.sqrt(d2);
				this.offX *= s;
				this.offZ *= s;
			}
		}
		const p = this.drawn;
		p.x = head.prevX + (head.x - head.prevX) * alpha + this.offX;
		p.z = head.prevZ + (head.z - head.prevZ) * alpha + this.offZ;
		p.faceX = head.faceX;
		p.faceZ = head.faceZ;
		return p;
	}

	/** The visual offset's components now (tiles): drawn = lerp(prev, x, alpha) + (offsetX, offsetZ). */
	offsetX(): number {
		return this.offX;
	}

	offsetZ(): number {
		return this.offZ;
	}

	/** The visual offset now (tiles). */
	offset(): number {
		return math.sqrt(this.offX * this.offX + this.offZ * this.offZ);
	}

	/** Snaps (a jump over snapTiles, or snap() dropping an offset) since the smoother was made. */
	snapCount(): number {
		return this.snaps;
	}

	/** Corrections smoothed (a newer guess for an older head's tick that differed) since the smoother was made. */
	correctionCount(): number {
		return this.corrections;
	}
}
