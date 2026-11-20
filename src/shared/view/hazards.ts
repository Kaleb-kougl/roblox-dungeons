/**
 * The floor hazards' sprite looks (docs/HAZARD_ART.md HA4), pure: the Stormcaller's strike flash over its life, the
 * scorch it leaves once the bullet is gone (ScorchTracker: the per-slot memory and a small ring of scorches), the
 * ember's burn loop, and the strike's flat size (its art's rim mapped onto the hit radius, no depth stretch: the art
 * is seen from straight above). The ember sizes with gooSpriteSize / gooSpritePlacement (3/4 art, like the goo).
 * Tunables: HAZARD_ART_VIEW (hazardsConfig.ts).
 *
 * @module
 */
import { BUILD_BULLET_VIEW } from "./buildBulletsConfig";
import { HAZARD_ART_VIEW } from "./hazardsConfig";

/** One hazard cell this frame: which cell of its animation, its flips, its transparency (1 = not drawn). */
export interface HazardCellLook {
	cell: number;
	flipX: boolean;
	flipY: boolean;
	transparency: number;
}

/**
 * A fresh HazardCellLook for a pool to keep and hand to `strikeFlashLook` and the other look functions every frame
 * (cell 0, no flips, opaque). The client's HazardSpritePool owns one per pool.
 */
export function newHazardCellLook(): HazardCellLook {
	return { cell: 0, flipX: false, flipY: false, transparency: 0 };
}

/**
 * A strike's flash with `lifeLeft` of its `totalLife` seconds (bullet time), `frames` cells: cell floor(age / life x
 * frames) (clamped), opaque, flipped by the slot's bits (HAZARD_ART_VIEW.strike masks). Writes `out` and returns it.
 */
export function strikeFlashLook(
	lifeLeft: number,
	totalLife: number,
	slot: number,
	frames: number,
	out: HazardCellLook,
): HazardCellLook {
	const n = math.max(1, frames);
	const age = totalLife - lifeLeft;
	const t = totalLife > 0 ? age / totalLife : 1;
	out.cell = math.clamp(math.floor(t * n), 0, n - 1);
	out.flipX = bit32.band(slot, HAZARD_ART_VIEW.strike.flipXMask) !== 0;
	out.flipY = bit32.band(slot, HAZARD_ART_VIEW.strike.flipYMask) !== 0;
	out.transparency = 0;
	return out;
}

/**
 * A scorch `ageSec` old (sim seconds), started by the strike in slot `seed`: the hot cell (0) for scorch.hotSec, then
 * the cold one (1, or 0 for a one-cell scorch); startTransparency until its fade, then to 1 at lifeSec (and 1 after).
 * Flipped by the seed shifted by scorch.seedShift (so it does not copy its flash's flips). Writes `out` and returns it.
 */
export function scorchLook(ageSec: number, seed: number, frames: number, out: HazardCellLook): HazardCellLook {
	const s = HAZARD_ART_VIEW.scorch;
	const k = bit32.rshift(seed, s.seedShift);
	out.cell = ageSec < s.hotSec || frames < 2 ? 0 : 1;
	out.flipX = bit32.band(k, HAZARD_ART_VIEW.strike.flipXMask) !== 0;
	out.flipY = bit32.band(k, HAZARD_ART_VIEW.strike.flipYMask) !== 0;
	if (ageSec >= s.lifeSec || ageSec < 0) {
		out.transparency = 1;
		return out;
	}
	const fadeFrom = s.lifeSec - s.fadeSec;
	const f = s.fadeSec > 0 ? math.clamp((ageSec - fadeFrom) / s.fadeSec, 0, 1) : 0;
	out.transparency = s.startTransparency + (1 - s.startTransparency) * f;
	return out;
}

/**
 * An ember with `lifeLeft` of its `totalLife` seconds (bullet time) in slot `slot`, at sim time `simSec`: its `burn`
 * loop (`frames` cells at `fps`) offset by slot x ember.phaseStep cells, held on that offset when `motion` is off
 * (reduced motion); mirrored by the slot's ember.mirrorMask bit; fading over the disc's last fadeSec
 * (BUILD_BULLET_VIEW.ember). No scale pop (pixel art). Writes `out` and returns it.
 */
export function emberSpriteLook(
	lifeLeft: number,
	slot: number,
	simSec: number,
	frames: number,
	fps: number,
	motion: boolean,
	out: HazardCellLook,
): HazardCellLook {
	const n = math.max(1, frames);
	const phase = slot * HAZARD_ART_VIEW.ember.phaseStep;
	const tick = motion ? math.floor(simSec * fps) : 0;
	out.cell = (((tick + phase) % n) + n) % n;
	out.flipX = bit32.band(slot, HAZARD_ART_VIEW.ember.mirrorMask) !== 0;
	out.flipY = false;
	const fade = BUILD_BULLET_VIEW.ember.fadeSec;
	out.transparency = fade > 0 ? 1 - math.clamp(lifeLeft / fade, 0, 1) : 0;
	return out;
}

/** The strike art's scale: tiles per art px, so its rim (`rimPx`) lies on the hit circle (`hitRadius` tiles). */
export function strikeTilesPerPixel(rimPx: number, hitRadius: number = HAZARD_ART_VIEW.strike.hitRadius): number {
	return rimPx > 0 ? hitRadius / rimPx : 0;
}

/** Where a flat (unstretched) floor cell lies: its size across / up the screen and its centre from the bullet, tiles. */
export interface FlatCellPlacement {
	widthTiles: number;
	depthTiles: number;
	rightTiles: number;
	downTiles: number;
}

/**
 * A `frameW` x `frameH` cell whose pivot (cell px from its top-left) lies on the bullet, drawn at `tilesPerPixel` both
 * ways (top-down art: the camera's foreshortening does the rest), flipped: its size and centre offset (screen-right,
 * screen-down along the floor). Writes `out` (a new table when absent) and returns it.
 */
export function flatCellPlacement(
	frameW: number,
	frameH: number,
	pivotX: number,
	pivotY: number,
	tilesPerPixel: number,
	flipX: boolean,
	flipY: boolean,
	out: FlatCellPlacement = { widthTiles: 0, depthTiles: 0, rightTiles: 0, downTiles: 0 },
): FlatCellPlacement {
	out.widthTiles = frameW * tilesPerPixel;
	out.depthTiles = frameH * tilesPerPixel;
	const right = (frameW / 2 - pivotX) * tilesPerPixel;
	const down = (frameH / 2 - pivotY) * tilesPerPixel;
	out.rightTiles = flipX ? -right : right;
	out.downTiles = flipY ? -down : down;
	return out;
}

/**
 * The scorches the strikes leave (HAD3), pure view state: per bullet slot the strike it showed last frame, and a ring
 * of at most scorch.maxScorches scorches (spot in sim units, start in sim seconds, the slot as seed). Per frame:
 * `begin(floorKey, nowSec)` (a different floor or `reset()` drops everything without a scorch), `seen(slot, x, z)` for
 * every slot that shows a strike, then `finish(nowSec)`: a slot that showed a strike last frame and does not now (it
 * ended or hit someone), or shows one at another spot (its slot was reused), leaves a scorch where it was. A full
 * ring reuses its oldest scorch. `live(k, nowSec)` is false once a scorch is past scorch.lifeSec.
 */
export class ScorchTracker {
	readonly x = new Array<number>();
	readonly z = new Array<number>();
	readonly start = new Array<number>();
	readonly seed = new Array<number>();
	readonly active = new Array<boolean>();
	private readonly wasX = new Array<number>();
	private readonly wasZ = new Array<number>();
	private readonly wasStamp = new Array<number>();
	private readonly nowX = new Array<number>();
	private readonly nowZ = new Array<number>();
	private readonly nowStamp = new Array<number>();
	private stamp = 1;
	private floorKey: number | undefined;

	constructor(readonly capacity: number = HAZARD_ART_VIEW.scorch.maxScorches) {
		for (let k = 0; k < capacity; k++) {
			this.x.push(0);
			this.z.push(0);
			this.start.push(0);
			this.seed.push(0);
			this.active.push(false);
		}
	}

	/** Drops every scorch and the slot memory (a new run). */
	reset(): void {
		for (let k = 0; k < this.capacity; k++) this.active[k] = false;
		this.wasStamp.clear();
		this.nowStamp.clear();
		this.floorKey = undefined;
	}

	begin(floorKey: number, nowSec: number): void {
		if (this.floorKey !== undefined && floorKey !== this.floorKey) this.reset();
		this.floorKey = floorKey;
		this.stamp += 1;
		for (let k = 0; k < this.capacity; k++) {
			if (this.active[k] && nowSec - this.start[k] >= HAZARD_ART_VIEW.scorch.lifeSec) this.active[k] = false;
		}
	}

	seen(slot: number, x: number, z: number): void {
		while (this.nowStamp.size() <= slot) {
			this.nowStamp.push(0);
			this.nowX.push(0);
			this.nowZ.push(0);
		}
		this.nowStamp[slot] = this.stamp;
		this.nowX[slot] = x;
		this.nowZ[slot] = z;
	}

	finish(nowSec: number): void {
		const prev = this.stamp - 1;
		for (let i = 0; i < this.wasStamp.size(); i++) {
			if (this.wasStamp[i] !== prev) continue;
			const now = i < this.nowStamp.size() && this.nowStamp[i] === this.stamp;
			if (!now || this.nowX[i] !== this.wasX[i] || this.nowZ[i] !== this.wasZ[i]) {
				this.add(this.wasX[i], this.wasZ[i], i, nowSec);
			}
		}
		for (let i = 0; i < this.nowStamp.size(); i++) {
			while (this.wasStamp.size() <= i) {
				this.wasStamp.push(0);
				this.wasX.push(0);
				this.wasZ.push(0);
			}
			if (this.nowStamp[i] === this.stamp) {
				this.wasStamp[i] = this.stamp;
				this.wasX[i] = this.nowX[i];
				this.wasZ[i] = this.nowZ[i];
			}
		}
	}

	/** True while scorch `k` shows at `nowSec`. */
	live(k: number, nowSec: number): boolean {
		return this.active[k] && nowSec - this.start[k] < HAZARD_ART_VIEW.scorch.lifeSec;
	}

	/** Scorches showing at `nowSec`. */
	liveCount(nowSec: number): number {
		let n = 0;
		for (let k = 0; k < this.capacity; k++) if (this.live(k, nowSec)) n++;
		return n;
	}

	private add(x: number, z: number, seed: number, nowSec: number): void {
		let pick = -1;
		let oldest = 0;
		for (let k = 0; k < this.capacity; k++) {
			if (!this.active[k]) {
				pick = k;
				break;
			}
			if (pick < 0 || this.start[k] < oldest) {
				pick = k;
				oldest = this.start[k];
			}
		}
		if (pick < 0) return;
		this.x[pick] = x;
		this.z[pick] = z;
		this.start[pick] = nowSec;
		this.seed[pick] = seed;
		this.active[pick] = true;
	}
}
