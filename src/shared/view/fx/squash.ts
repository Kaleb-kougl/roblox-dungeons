/**
 * Squash & stretch (docs/FEEL.md J6): brief, small deformations of a sprite around its feet. Pure (plain numbers);
 * the client's SpriteView.setScale draws them and ActorRenderController picks the sources (player roll edges from
 * RollEdgeWatch, tracker `hit` / `spawned` / `killed` for actors, kept per pool slot in SquashBook).
 *
 *   rollStart  the knight takes off                 FEEL_SQUASH.rollStart (1.15 x 0.85, 90 ms)
 *   rollEnd    the roll lands                       FEEL_SQUASH.rollEnd   (1.1 x 0.9, 80 ms)
 *   hit        an enemy pops when hit               FEEL_SQUASH.hit       (1.1 x 0.9, 70 ms)
 *   spawn      a runtime spawn grows in, overshoots FEEL_SQUASH.spawn     (0.6 -> 1.08 -> 1 uniform, 180 ms)
 *   death      an enemy slumps as it falls dead     FEEL_SQUASH.death     (1.12 x 0.88, 100 ms)
 *
 * JD4: no squash axis leaves 1 +- FEEL_SQUASH.maxDeform (15 %), nothing runs past FEEL_SQUASH.maxSec (180 ms), and the
 * drawn cell is a whole number of art pixels on each axis (roundToArtPixels). JD9: under reduced motion (the juice
 * motionScale 0) every curve is 1 x 1. Presentation only: nothing here reaches the sim.
 *
 * @module
 */
import { CAMERA_PITCH_DEG } from "shared/config";
import { MAX_PARTY_SIZE } from "shared/sim";
import { floorClearanceStuds, type SpriteBillboard } from "../sprites";
import { FEEL_SQUASH, type SpawnCurve, type SquashCurve } from "./motionFxConfig";

export type SquashKind = "rollStart" | "rollEnd" | "hit" | "spawn" | "death";

/** A width / height scale (1 x 1: as drawn). Mutable so a caller can reuse one per frame (squashInto). */
export interface SquashScale {
	sx: number;
	sy: number;
}

/** A running squash is cut short only by one of at least its priority (death > spawn > the rest). */
export const SQUASH_PRIORITY: Readonly<Record<SquashKind, number>> = {
	rollStart: 1,
	rollEnd: 1,
	hit: 1,
	spawn: 2,
	death: 3,
};

/** How long `kind` runs, seconds (never past FEEL_SQUASH.maxSec). */
export function squashLengthSec(kind: SquashKind): number {
	const c = FEEL_SQUASH[kind];
	return math.min(c.lengthSec, FEEL_SQUASH.maxSec);
}

function clampDeform(s: number): number {
	return math.clamp(s, 1 - FEEL_SQUASH.maxDeform, 1 + FEEL_SQUASH.maxDeform);
}

/** 0 -> 1 -> 0 envelope of a squash curve at `u` (0..1 of its length): ease out to the peak, then ease back out. */
function envelope(u: number, attack: number): number {
	if (attack > 0 && u < attack) {
		const v = u / attack;
		return 1 - (1 - v) * (1 - v);
	}
	const v = attack < 1 ? (u - attack) / (1 - attack) : 1;
	return (1 - v) * (1 - v);
}

/** The spawn pop's uniform scale at `u` (0..1): ease out from `from` to `peak` by peakAt, smoothstep to 1. */
function spawnScale(c: SpawnCurve, u: number): number {
	const peak = math.min(c.peak, 1 + FEEL_SQUASH.maxDeform);
	if (u < c.peakAt) {
		const v = u / c.peakAt;
		return c.from + (peak - c.from) * (1 - (1 - v) * (1 - v));
	}
	const v = c.peakAt < 1 ? (u - c.peakAt) / (1 - c.peakAt) : 1;
	return peak + (1 - peak) * v * v * (3 - 2 * v);
}

/**
 * Writes `kind`'s scale `ageSec` into it into `out` and returns it: 1 x 1 before 0 (or NaN), after the curve's length
 * and under reduced motion (`motion` 0, the juice motionScale); the deformation is scaled by `motion` in between.
 */
export function squashInto(out: SquashScale, kind: SquashKind, ageSec: number, motion: number): SquashScale {
	out.sx = 1;
	out.sy = 1;
	const len = squashLengthSec(kind);
	const m = math.clamp(motion, 0, 1);
	if (!(m > 0) || !(ageSec >= 0) || !(len > 0) || ageSec >= len) return out;
	const u = ageSec / len;
	if (kind === "spawn") {
		const s = 1 + (spawnScale(FEEL_SQUASH.spawn, u) - 1) * m;
		out.sx = s;
		out.sy = s;
		return out;
	}
	const c: SquashCurve = FEEL_SQUASH[kind];
	const k = envelope(u, c.attack) * m;
	out.sx = clampDeform(1 + (c.sx - 1) * k);
	out.sy = clampDeform(1 + (c.sy - 1) * k);
	return out;
}

function unitScale(out: SquashScale): SquashScale {
	out.sx = 1;
	out.sy = 1;
	return out;
}

/** squashInto into a new object (tests, one-offs; per-frame code reuses one with squashInto). */
export function squashAt(kind: SquashKind, ageSec: number, motion: number): SquashScale {
	return squashInto({ sx: 1, sy: 1 }, kind, ageSec, motion);
}

/**
 * JD4: `scale` snapped so a cell `cellPx` art pixels across draws a whole number of them (at least 1): round(scale x
 * cellPx) / cellPx. 1 stays exactly 1; a bad cell or scale comes back unchanged.
 */
export function roundToArtPixels(scale: number, cellPx: number): number {
	if (!(cellPx > 0) || !(scale > 0)) return scale;
	return math.max(1, math.floor(scale * cellPx + 0.5)) / cellPx;
}

/**
 * The billboard `b` (shared/view spriteBillboard: size and the feet -> centre offset) scaled by `sx` x `sy` around its
 * pivot, the pixel on the feet anchor: the size scales and so does the centre's offset from the pivot (x right, y up),
 * so the pivot stays on the feet. Depth (offsetZ) only grows: a taller cell hangs further below the pivot and needs more
 * floor clearance (floorClearanceStuds); a shorter one keeps the clearance it had (more is harmless, and the billboard
 * does not move in depth while it squashes). 1 x 1 returns `b` itself.
 */
export function squashedBillboard(
	b: Readonly<SpriteBillboard>,
	sx: number,
	sy: number,
	pitchDeg: number = CAMERA_PITCH_DEG,
): SpriteBillboard {
	if (sx === 1 && sy === 1) return b;
	let offsetZ = b.offsetZ;
	if (sy > 1) {
		const below = b.h / 2 - b.offsetY;
		offsetZ += floorClearanceStuds(below * sy, pitchDeg) - floorClearanceStuds(below, pitchDeg);
	}
	return { w: b.w * sx, h: b.h * sy, offsetX: b.offsetX * sx, offsetY: b.offsetY * sy, offsetZ };
}

// ---------------------------------------------------------------------------------------------
// Sources

/** A player's roll edge this frame. */
export type RollEdge = "none" | "start" | "end";

/**
 * Per-player roll edges seen locally from PlayerState.rollTicks (not the audio watch): `start` when it rose (a new
 * roll, even one chained straight off the last), `end` when it reached 0 from above while alive. The first frame a
 * player is seen (and after `reset`, a new run) gives no edge. Preallocated for MAX_PARTY_SIZE players.
 */
export class RollEdgeWatch {
	/** rollTicks last frame, -1 = not seen yet. */
	private readonly prev: number[] = [];

	constructor(readonly capacity: number = MAX_PARTY_SIZE) {
		for (let i = 0; i < capacity; i++) this.prev.push(-1);
	}

	reset(): void {
		for (let i = 0; i < this.capacity; i++) this.prev[i] = -1;
	}

	/** Player `index`'s edge from last frame to this one (`rollTicks` now, `dead` now). */
	edge(index: number, rollTicks: number, dead: boolean): RollEdge {
		if (index < 0 || index >= this.capacity) return "none";
		const prev = this.prev[index];
		this.prev[index] = rollTicks;
		if (prev < 0 || dead) return "none";
		if (rollTicks > prev) return "start";
		if (prev > 0 && rollTicks <= 0) return "end";
		return "none";
	}
}

const KIND_NONE = "";

/**
 * The running squash per pool slot, keyed by (slot, id) like the health bar slots (a new actor in the slot drops the
 * old one's). Preallocated; times are the owner's effect clock, set once per frame with `setNow` before any `start` /
 * `lookInto`. A squash started between frames (tracker events arrive before the renderer's frame) begins at the first
 * `lookInto` after it, so its first drawn frame is its peak.
 *
 * Rules: a running squash of higher priority (SQUASH_PRIORITY) is never cut short; a `hit` restarts at most every
 * FEEL_SQUASH.hitMinSec per slot.
 */
export class SquashBook {
	private readonly id: number[] = [];
	private readonly kind: Array<SquashKind | typeof KIND_NONE> = [];
	/** Start time; pending (started since the last frame) until the next lookInto. */
	private readonly startAt: number[] = [];
	private readonly pending: boolean[] = [];
	private readonly lastHitAt: number[] = [];
	private now = 0;

	constructor(readonly capacity: number) {
		for (let i = 0; i < capacity; i++) {
			this.id.push(0);
			this.kind.push(KIND_NONE);
			this.startAt.push(0);
			this.pending.push(false);
			this.lastHitAt.push(-math.huge);
		}
	}

	/** The effect clock now (seconds; call once per frame first). A clock going back (a new run) clears every slot. */
	setNow(now: number): void {
		if (now < this.now) this.clear();
		this.now = now;
	}

	clear(): void {
		for (let i = 0; i < this.capacity; i++) this.clearSlot(i);
	}

	clearSlot(slot: number): void {
		if (slot < 0 || slot >= this.capacity) return;
		this.id[slot] = 0;
		this.kind[slot] = KIND_NONE;
		this.pending[slot] = false;
		this.lastHitAt[slot] = -math.huge;
	}

	/** Is the slot's squash still running (pending, or younger than its length)? */
	private running(slot: number): boolean {
		const k = this.kind[slot];
		if (k === KIND_NONE) return false;
		return this.pending[slot] || this.now - this.startAt[slot] < squashLengthSec(k);
	}

	/** Starts `kind` on (slot, id); false when a rule refused it. */
	start(slot: number, id: number, kind: SquashKind): boolean {
		if (slot < 0 || slot >= this.capacity) return false;
		if (this.id[slot] !== id) {
			this.clearSlot(slot);
			this.id[slot] = id;
		} else {
			const k = this.kind[slot];
			if (k !== KIND_NONE && this.running(slot) && SQUASH_PRIORITY[k] > SQUASH_PRIORITY[kind]) return false;
		}
		if (kind === "hit") {
			if (this.now - this.lastHitAt[slot] < FEEL_SQUASH.hitMinSec) return false;
			this.lastHitAt[slot] = this.now;
		}
		this.kind[slot] = kind;
		this.pending[slot] = true;
		return true;
	}

	/** (slot, id)'s scale now into `out` (1 x 1 when nothing runs there); `motion` is the juice motionScale. */
	lookInto(out: SquashScale, slot: number, id: number, motion: number): SquashScale {
		if (slot < 0 || slot >= this.capacity || this.id[slot] !== id) return unitScale(out);
		const k = this.kind[slot];
		if (k === KIND_NONE) return unitScale(out);
		if (this.pending[slot]) {
			this.pending[slot] = false;
			this.startAt[slot] = this.now;
		}
		const age = this.now - this.startAt[slot];
		if (age >= squashLengthSec(k)) {
			this.kind[slot] = KIND_NONE;
			return unitScale(out);
		}
		return squashInto(out, k, age, motion);
	}
}
