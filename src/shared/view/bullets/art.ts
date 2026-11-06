import { degToRad, isoBasis } from "../iso";
import { BULLET_ART_VIEW } from "./config";

const FULL_TURN_DEG = 360;
const QUARTER_TURN_DEG = 90;
/** cos / sin of the quarter turns 0, 90, 180, 270 degrees, exactly (math.cos(pi / 2) is 6e-17, not 0). */
const QUARTER_COS: ReadonlyArray<number> = [1, 0, -1, 0];
const QUARTER_SIN: ReadonlyArray<number> = [0, 1, 0, -1];

/** cos / sin of `deg`: exact on whole quarter turns, math.cos / math.sin otherwise. */
function turnCosSin(deg: number): readonly [number, number] {
	const q = deg / QUARTER_TURN_DEG;
	if (q === math.floor(q)) {
		const k = q % 4;
		return [QUARTER_COS[k], QUARTER_SIN[k]];
	}
	const r = degToRad(deg);
	return [math.cos(r), math.sin(r)];
}

const [TURN_COS, TURN_SIN] = turnCosSin(BULLET_ART_VIEW.canvasTurnDeg);
/** The canvas's up runs along the part's local X (a quarter or three-quarter turn) rather than its local Z. */
const CANVAS_UP_ALONG_X = math.round(BULLET_ART_VIEW.canvasTurnDeg / QUARTER_TURN_DEG) % 2 === 1;
/** A bullet with no velocity points screen-up: sin / cos of the camera's yaw (the yaw of screen-up on the floor). */
const [IDLE_COS, IDLE_SIN] = turnCosSin(BULLET_ART_VIEW.cameraYawDeg);
const BASIS = isoBasis(degToRad(BULLET_ART_VIEW.cameraYawDeg), degToRad(BULLET_ART_VIEW.cameraPitchDeg));

function wrapDeg(deg: number): number {
	const a = deg - math.floor(deg / FULL_TURN_DEG) * FULL_TURN_DEG;
	// A tiny negative angle wraps to 360 in float64 (360 - 1e-15 rounds up): that is 0 too.
	return a === 0 || a >= FULL_TURN_DEG ? 0 : a;
}

/**
 * The flicker frame of the bullet in pool slot `slot` at `seconds` of sim time: the loop at `fps` (BULLET_ART_VIEW.fps
 * when the sprite has none), each slot's phase shifted by its index (slot mod frames) so a ring of bullets in
 * consecutive slots does not pulse in step (PAD8). One frame: always 0; reduced motion: BULLET_ART_VIEW.reducedMotionFrame
 * (held, never animated).
 */
export function bulletFrame(seconds: number, slot: number, frames: number, fps: number, reduced: boolean): number {
	const n = math.floor(frames);
	if (n <= 1) return 0;
	if (reduced) return math.min(BULLET_ART_VIEW.reducedMotionFrame, n - 1);
	const rate = fps > 0 ? fps : BULLET_ART_VIEW.fps;
	const step = math.floor(math.max(0, seconds) * rate);
	return (step + slot) % n;
}

/** The anchor's yaw as cos / sin (CFrame.Angles(0, yaw, 0) = rotation matrix [[c, 0, s], [0, 1, 0], [-s, 0, c]]). */
export interface BulletYawAxes {
	c: number;
	s: number;
}

/**
 * The yaw of a floor-flat sprite's anchor Part, as cos / sin, for a bullet with ground velocity (vx, vz) (sim units
 * and studs share their axes). Writes `out` and returns it; no trig.
 *
 * Convention: the sprite's art points UP on its canvas (the pack's art points screen-up, its direction of travel), and
 * the Top-face canvas's up is the part's local -Z turned BULLET_ART_VIEW.canvasTurnDeg anticlockwise seen from above
 * (90: local -X). The part turned by this yaw about +Y has that canvas up along the velocity, so the art's nose leads.
 * A bullet with no ground velocity points screen-up (along the camera's view on the floor, like an unturned effect).
 *
 * Derivation: CFrame.Angles(0, a, 0) turns local -Z onto (-sin a, -cos a) on the ground, so a direction (dx, dz) has
 * yaw a with sin a = -dx, cos a = -dz; the anchor's yaw is a - turn.
 */
export function bulletYawAxes(vx: number, vz: number, out: BulletYawAxes): BulletYawAxes {
	const len = math.sqrt(vx * vx + vz * vz);
	let sa: number;
	let ca: number;
	if (len > 0) {
		sa = -vx / len;
		ca = -vz / len;
	} else {
		sa = IDLE_SIN;
		ca = IDLE_COS;
	}
	out.c = ca * TURN_COS + sa * TURN_SIN;
	out.s = sa * TURN_COS - ca * TURN_SIN;
	return out;
}

const yawScratch: BulletYawAxes = { c: 1, s: 0 };

/** bulletYawAxes as an angle: radians about +Y (CFrame.Angles(0, yaw, 0)), in (-pi, pi]. */
export function bulletYaw(vx: number, vz: number): number {
	const a = bulletYawAxes(vx, vz, yawScratch);
	return math.atan2(a.s, a.c);
}

/**
 * The anchor Part's Size (x, y, z studs) for a sprite `alongStuds` long (the art's height: along its travel) and
 * `acrossStuds` wide, `thicknessStuds` thin: the canvas's up runs along local X under a quarter turn
 * (BULLET_ART_VIEW.canvasTurnDeg 90 / 270), along local Z otherwise. The canvas spans the whole Top face, so the
 * ImageLabel filling it takes the face's aspect.
 */
export function bulletPartSize(
	alongStuds: number,
	acrossStuds: number,
	thicknessStuds: number = BULLET_ART_VIEW.thicknessStuds,
): readonly [number, number, number] {
	return CANVAS_UP_ALONG_X ? [alongStuds, thicknessStuds, acrossStuds] : [acrossStuds, thicknessStuds, alongStuds];
}

/**
 * The drawn size key of a bullet with draw `scale` and end-of-life `fade` (sim fadeAt): their product in
 * BULLET_ART_VIEW.sizeQuantum steps, never under one step (the neon parts' rule). A renderer writes sizes only when
 * the key changes.
 */
export function bulletSizeKey(scale: number, fade: number): number {
	const q = BULLET_ART_VIEW.sizeQuantum;
	return math.max(q, math.round((scale * fade) / q) * q);
}

/**
 * The drawn size key of a sprite bullet whose art stands for draw scale `referenceScale` (bulletArtReferenceScale):
 * bulletSizeKey of scale / referenceScale, so the art draws at its own size at its reference scale.
 */
export function bulletArtSizeKey(scale: number, referenceScale: number, fade: number): number {
	return bulletSizeKey(referenceScale > 0 ? scale / referenceScale : scale, fade);
}

/** A pixel offset on a floor canvas (x right, y down), written by floorCanvasOffset. */
export interface FloorCanvasPoint {
	x: number;
	y: number;
}

/**
 * A ground offset (dx, dz) studs from the centre of a flat, UNTURNED Part (identity rotation) to the pixel offset from
 * its Top-face canvas's centre, at `pxPerStud` canvas pixels a stud (x right, y down): the same canvas convention as
 * bulletYawAxes (the canvas's up is the part's -Z turned BULLET_ART_VIEW.canvasTurnDeg anticlockwise seen from above;
 * 90: up = world -X, right = world -Z). For one canvas carrying many sprites (spike PA0's option C). Writes `out`.
 */
export function floorCanvasOffset(dx: number, dz: number, pxPerStud: number, out: FloorCanvasPoint): FloorCanvasPoint {
	// Canvas right = (cos t, -sin t) and down = (sin t, cos t) on the ground (x, z).
	out.x = (dx * TURN_COS - dz * TURN_SIN) * pxPerStud;
	out.y = (dx * TURN_SIN + dz * TURN_COS) * pxPerStud;
	return out;
}

/**
 * ImageLabel.Rotation (degrees clockwise on the canvas, in (-180, 180]) that turns a sprite's art-up onto the ground
 * velocity (vx, vz) on an unturned Part's Top-face canvas (floorCanvasOffset's convention), the canvas counterpart of
 * bulletYawAxes. No ground velocity: screen-up, as bulletYawAxes.
 */
export function floorCanvasRotation(vx: number, vz: number): number {
	let dx = vx;
	let dz = vz;
	if (dx === 0 && dz === 0) {
		dx = -IDLE_SIN;
		dz = -IDLE_COS;
	}
	const hx = dx * TURN_COS - dz * TURN_SIN;
	const hy = dx * TURN_SIN + dz * TURN_COS;
	return math.deg(math.atan2(hx, -hy));
}

/**
 * The screen-space heading of a ground velocity (vx, vz) through the iso camera basis (yaw / pitch from
 * BULLET_ART_VIEW): degrees CLOCKWISE from screen-up in [0, 360) (ImageLabel.Rotation's sense), for a camera-facing
 * billboard whose art points up. The projection drops perspective (the direction at the screen centre). No ground
 * velocity: 0 (screen-up). Floor-flat sprites use bulletYawAxes instead (the camera foreshortens them itself).
 */
export function screenHeading(vx: number, vz: number): number {
	const right = BASIS.right;
	const up = BASIS.up;
	const sx = vx * right[0] + vz * right[2];
	const sy = vx * up[0] + vz * up[2];
	if (sx === 0 && sy === 0) return 0;
	return wrapDeg(math.deg(math.atan2(sx, sy)));
}
