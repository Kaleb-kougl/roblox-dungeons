/** Sprite facings and the animation clock helpers (docs/CODEBASE_SCALE.md DX8: a pure move out of view/sprites.ts). Import from "shared/view" or "./sprites", never from this file. */
import type { SpriteAnimationDef, SpriteFacings } from "shared/theme";
import { degToRad, isoBasis, type IsoBasis } from "../iso";
import { CAMERA_PITCH_DEG } from "shared/config";
import { SIM_HZ } from "shared/sim";
import { SPRITE_VIEW } from "../config";

const FULL_TURN = 360;
const HALF = 0.5;

/** Where the choosers look animations up: a theme `SpriteSet` / `SpriteSetLayout` (exact names, no warning). */
export interface SpriteAnimSource {
	animation(anim: string): SpriteAnimationDef | undefined;
}

// ---------------------------------------------------------------------------------------------
// Facing

function wrapDeg(deg: number): number {
	let a = deg - math.floor(deg / FULL_TURN) * FULL_TURN;
	if (a >= FULL_TURN) a -= FULL_TURN; // -tiny + 360 rounds to 360
	return a === 0 ? 0 : a; // no -0
}

/**
 * Screen angle, degrees in [0, 360), of the ground direction (faceX, faceZ) as `basis` frames it: 0 = screen right,
 * 90 = screen up (away from the camera), 270 = screen down (towards the camera). Uses the true projection (right
 * and up components), see the file comment. A zero vector gives 0.
 */
export function screenAngleFromBasis(faceX: number, faceZ: number, basis: IsoBasis): number {
	const r = basis.right;
	const u = basis.up;
	const sx = faceX * r[0] + faceZ * r[2];
	const sy = faceX * u[0] + faceZ * u[2];
	if (sx === 0 && sy === 0) return 0;
	return wrapDeg((math.atan2(sy, sx) * 180) / math.pi);
}

/** screenAngleFromBasis for a camera at `yawDeg` / `pitchDeg` (the client caches the basis instead). */
export function screenAngleDeg(
	faceX: number,
	faceZ: number,
	yawDeg: number,
	pitchDeg: number = CAMERA_PITCH_DEG,
): number {
	return screenAngleFromBasis(faceX, faceZ, isoBasis(degToRad(yawDeg), degToRad(pitchDeg)));
}

/**
 * The facing (row) index in [0, count) nearest to screen angle `angleDeg`. Facing d points at zeroDeg + d * 360 /
 * count, counter-clockwise when `ccw` (clockwise otherwise). An angle exactly halfway between two facings goes to the
 * NEXT one in row order (d + 1, wrapping to 0). Count 1 -> 0.
 */
export function facingIndex(angleDeg: number, facings: SpriteFacings): number {
	const count = facings.count;
	if (count <= 1) return 0;
	const rel = wrapDeg(facings.ccw ? angleDeg - facings.zeroDeg : facings.zeroDeg - angleDeg);
	const index = math.floor((rel * count) / FULL_TURN + HALF);
	return index >= count ? index - count : index;
}

/**
 * The facing index for the sim facing (faceX, faceZ) under `basis`; `previous` when the facing is the zero vector
 * (an actor that has never turned keeps its row).
 */
export function spriteFacing(
	faceX: number,
	faceZ: number,
	facings: SpriteFacings,
	basis: IsoBasis,
	previous: number,
): number {
	if (faceX === 0 && faceZ === 0) return previous;
	return facingIndex(screenAngleFromBasis(faceX, faceZ, basis), facings);
}

// ---------------------------------------------------------------------------------------------
// Animation choice

/**
 * What to play. `progress` set: a one-shot stretched over a gameplay timer (0 at its start, 1 at its end). Unset:
 * clock-driven at the animation's fps times `rate` (loops, and one-shots without a gameplay timer).
 */
export interface SpriteAnimChoice {
	readonly anim: string;
	readonly progress?: number;
	readonly rate: number;
	/** With `progress`: the part of the animation the progress spans (a wind-up, a release, ...); all of it when unset. */
	readonly segment?: AnimSegment;
}

/**
 * A part of an animation as fractions of its frame count (SPRITE_ANIM_MARKS): frames [round(from * n), round(to * n))
 * of an n-frame animation, clamped to it, at least one frame (segmentStart / segmentLength).
 */
export interface AnimSegment {
	readonly from: number;
	readonly to: number;
}

/** Ground speed, world units / s, from one tick's position delta (PlayerState / ActorState prevX, prevZ, x, z). */
export function tickSpeed(prevX: number, prevZ: number, x: number, z: number): number {
	const dx = x - prevX;
	const dz = z - prevZ;
	return math.sqrt(dx * dx + dz * dz) * SIM_HZ;
}

/** Remaining-ticks timer of `total` ticks -> elapsed ticks, render-interpolated (the roll tumble's formula). */
export function elapsedOf(total: number, remaining: number, alpha: number): number {
	return total - remaining + alpha;
}

export function stretched(anim: string, elapsed: number, total: number): SpriteAnimChoice {
	return { anim, progress: total > 0 ? elapsed / total : 1, rate: 1 };
}

export function clocked(anim: string, rate: number): SpriteAnimChoice {
	return { anim, rate };
}

/** Run / move loop: undefined when standing (below SPRITE_VIEW.moveMinFraction of the reference speed). */
export function moveChoice(anim: string, speed: number, refSpeed: number): SpriteAnimChoice | undefined {
	if (!(refSpeed > 0) || !(speed >= refSpeed * SPRITE_VIEW.moveMinFraction)) return undefined;
	const rate = math.min(SPRITE_VIEW.loopRateMax, math.max(SPRITE_VIEW.loopRateMin, speed / refSpeed));
	return clocked(anim, rate);
}

export const IDLE: SpriteAnimChoice = { anim: "idle", rate: 1 };
export const ATTACK = "attack";
