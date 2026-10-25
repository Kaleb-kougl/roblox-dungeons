/**
 * Iso camera math in plain numbers (no Vector3 / CFrame), so it runs under the headless runner.
 *
 * Mirrors project-kaleb-vale `src/render/iso.ts` @ 42897e2 (isoBasis, snapToTexelGrid), adapted
 * from an orthographic to a narrow-FOV perspective camera: Roblox has no orthographic projection,
 * so the "zoom" is a distance chosen to show the same world height at the focus point.
 *
 * Conventions match three.js and Roblox alike: right-handed, +Y up, the camera looks down -Z.
 * Orientation = yaw about +Y, then pitch down about the camera's right axis
 * (three's Euler(-pitch, yaw, 0, "YXZ") == Roblox's CFrame.fromOrientation(-pitch, yaw, 0)).
 */

export type Vec3 = readonly [number, number, number];

/** Unit vectors of the camera frame in world space. `forward` points from the camera into the scene. */
export interface IsoBasis {
	readonly right: Vec3;
	readonly up: Vec3;
	readonly forward: Vec3;
}

export function degToRad(degrees: number): number {
	return (degrees * math.pi) / 180;
}

export function isoBasis(yawRad: number, pitchRad: number): IsoBasis {
	const sy = math.sin(yawRad);
	const cy = math.cos(yawRad);
	const sp = math.sin(pitchRad);
	const cp = math.cos(pitchRad);
	return {
		right: [cy, 0, -sy],
		up: [-sy * sp, cp, -cy * sp],
		forward: [-sy * cp, -sp, -cy * cp],
	};
}

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Distance from the focus point at which a perspective camera with vertical field of view
 * `fovDeg` shows `visibleHeight` world units top to bottom (measured at the focus point).
 */
export function distanceForFov(fovDeg: number, visibleHeight: number): number {
	return visibleHeight / (2 * math.tan(degToRad(fovDeg) / 2));
}

/** Camera position `distance` behind `focus` along the view direction. */
export function cameraPosition(focus: Vec3, basis: IsoBasis, distance: number): Vec3 {
	const f = basis.forward;
	return [focus[0] - f[0] * distance, focus[1] - f[1] * distance, focus[2] - f[2] * distance];
}

/**
 * Snap a point so its right/up coordinates are whole multiples of `grid` (forward kept). With the
 * camera on this grid every static world point keeps the same sub-grid phase from frame to frame,
 * so the scene moves in whole steps instead of shimmering. `grid <= 0` returns the point as is.
 */
export function snapToGrid(position: Vec3, basis: IsoBasis, grid: number): Vec3 {
	if (grid <= 0) {
		return position;
	}
	const r = math.round(dot(position, basis.right) / grid) * grid;
	const u = math.round(dot(position, basis.up) / grid) * grid;
	const f = dot(position, basis.forward);
	const { right, up, forward } = basis;
	return [
		right[0] * r + up[0] * u + forward[0] * f,
		right[1] * r + up[1] * u + forward[1] * f,
		right[2] * r + up[2] * u + forward[2] * f,
	];
}

/**
 * Frame-rate independent exponential follow: the fraction of the remaining gap to close this
 * frame for a time constant `tauSec` (0 = snap to the target).
 */
export function followAlpha(dtSec: number, tauSec: number): number {
	if (tauSec <= 0) {
		return 1;
	}
	return 1 - math.exp(-dtSec / tauSec);
}
