/**
 * Screen-space geometry of the decor plan (docs/DECOR.md R3): the game camera's true on-screen projection and the
 * convex-polygon helpers the footprint rule and the fade selection use. Plain numbers, so it runs headlessly.
 *
 * Projection. The camera (shared/config view.ts: yaw 45, pitch 55; GAME_CAMERA.fovDeg 7) is a narrow-FOV perspective
 * camera standing in for the web build's orthographic one, so a world point's screen position is its right / up
 * components in the camera basis (isoBasis, as sprites.ts projects facings) and its depth is its forward component
 * (larger = farther from the camera). At a 7 degree FOV the perspective error is negligible next to that. Units are
 * tiles in the camera plane (a BillboardGui `w` tiles wide covers `w` of these); `* PIXELS_PER_TILE` gives the web
 * build's render pixels, the unit of the web decor plan's pixel constants.
 *
 * Polygons are flat arrays [x0, y0, x1, y1, ...] (x = screen right, y = screen up), counter-clockwise.
 */
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { degToRad, isoBasis, type IsoBasis } from "../iso";

/** A flat polygon, [x0, y0, x1, y1, ...], counter-clockwise (x = screen right, y = screen up). */
export type ScreenPolygon = ReadonlyArray<number>;

/** The game camera's basis (yaw CAMERA_YAW_DEG, pitch CAMERA_PITCH_DEG). */
export const DECOR_CAMERA: IsoBasis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));

/** Screen right of world (x, y, z), tiles. */
export function screenX(cam: IsoBasis, x: number, y: number, z: number): number {
	const r = cam.right;
	return r[0] * x + r[1] * y + r[2] * z;
}

/** Screen up of world (x, y, z), tiles. */
export function screenY(cam: IsoBasis, x: number, y: number, z: number): number {
	const u = cam.up;
	return u[0] * x + u[1] * y + u[2] * z;
}

/** View depth of world (x, y, z), tiles along the camera's forward axis (larger = farther). */
export function screenDepth(cam: IsoBasis, x: number, y: number, z: number): number {
	const f = cam.forward;
	return f[0] * x + f[1] * y + f[2] * z;
}

/** The ground point (x, z) at height `y` that projects to screen (sx, sy) (inverse of screenX / screenY). */
export function groundAt(cam: IsoBasis, sx: number, sy: number, y: number): readonly [number, number] {
	// [rx rz; ux uz] [x z]^T = [sx - ry*y; sy - uy*y]
	const rx = cam.right[0];
	const rz = cam.right[2];
	const ux = cam.up[0];
	const uz = cam.up[2];
	const a = sx - cam.right[1] * y;
	const b = sy - cam.up[1] * y;
	const det = rx * uz - rz * ux;
	return [(a * uz - rz * b) / det, (rx * b - a * ux) / det];
}

function cross(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
	return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/** Convex hull of flat points [x0, y0, ...], counter-clockwise, collinear points dropped (monotone chain). */
export function convexHull(points: ReadonlyArray<number>): number[] {
	const n = math.floor(points.size() / 2);
	const idx: number[] = [];
	for (let i = 0; i < n; i++) idx.push(i);
	// insertion sort by (x, y): small inputs, deterministic
	for (let i = 1; i < n; i++) {
		const k = idx[i];
		let j = i - 1;
		while (j >= 0) {
			const o = idx[j];
			const before =
				points[o * 2] > points[k * 2] ||
				(points[o * 2] === points[k * 2] && points[o * 2 + 1] > points[k * 2 + 1]);
			if (!before) break;
			idx[j + 1] = o;
			j--;
		}
		idx[j + 1] = k;
	}
	if (n < 3) {
		const out: number[] = [];
		for (const i of idx) out.push(points[i * 2], points[i * 2 + 1]);
		return out;
	}
	const hull: number[] = [];
	const push = (i: number) => {
		while (hull.size() >= 2) {
			const h = hull.size();
			const a = hull[h - 2];
			const b = hull[h - 1];
			if (
				cross(
					points[a * 2],
					points[a * 2 + 1],
					points[b * 2],
					points[b * 2 + 1],
					points[i * 2],
					points[i * 2 + 1],
				) > 0
			)
				break;
			hull.pop();
		}
		hull.push(i);
	};
	for (let t = 0; t < n; t++) push(idx[t]);
	const lowerSize = hull.size() + 1;
	for (let t = n - 2; t >= 0; t--) {
		const i = idx[t];
		while (hull.size() >= lowerSize) {
			const h = hull.size();
			const a = hull[h - 2];
			const b = hull[h - 1];
			if (
				cross(
					points[a * 2],
					points[a * 2 + 1],
					points[b * 2],
					points[b * 2 + 1],
					points[i * 2],
					points[i * 2 + 1],
				) > 0
			)
				break;
			hull.pop();
		}
		hull.push(i);
	}
	hull.pop(); // the first point again
	const out: number[] = [];
	for (const i of hull) out.push(points[i * 2], points[i * 2 + 1]);
	return out;
}

/**
 * The part of convex polygon `subject` inside convex counter-clockwise polygon `clip` (Sutherland-Hodgman). Empty when
 * they do not overlap (touching edges may leave a degenerate sliver, which counts as overlap).
 */
export function clipConvex(subject: ScreenPolygon, clip: ScreenPolygon): number[] {
	let out: number[] = [...subject];
	const m = math.floor(clip.size() / 2);
	for (let e = 0; e < m && out.size() > 0; e++) {
		const ax = clip[e * 2];
		const ay = clip[e * 2 + 1];
		const f = (e + 1) % m;
		const bx = clip[f * 2];
		const by = clip[f * 2 + 1];
		const input = out;
		out = [];
		const n = math.floor(input.size() / 2);
		for (let i = 0; i < n; i++) {
			const px = input[i * 2];
			const py = input[i * 2 + 1];
			const j = (i + 1) % n;
			const qx = input[j * 2];
			const qy = input[j * 2 + 1];
			const dp = cross(ax, ay, bx, by, px, py);
			const dq = cross(ax, ay, bx, by, qx, qy);
			if (dp >= 0) out.push(px, py);
			if (dp >= 0 !== dq >= 0) {
				const t = dp / (dp - dq);
				out.push(px + (qx - px) * t, py + (qy - py) * t);
			}
		}
	}
	return out;
}

/** True when (x, y) lies inside convex counter-clockwise `poly` at least `margin` from every edge. */
export function insideBy(poly: ScreenPolygon, x: number, y: number, margin: number): boolean {
	const m = math.floor(poly.size() / 2);
	for (let e = 0; e < m; e++) {
		const ax = poly[e * 2];
		const ay = poly[e * 2 + 1];
		const f = (e + 1) % m;
		const ex = poly[f * 2] - ax;
		const ey = poly[f * 2 + 1] - ay;
		const len = math.sqrt(ex * ex + ey * ey);
		if (len === 0) continue;
		if ((ex * (y - ay) - ey * (x - ax)) / len < margin) return false;
	}
	return true;
}

/**
 * The largest k in [0, 1] for which the axis-aligned rectangle [x - k left, x + k right] x [y - k down, y + k up]
 * (reaches >= 0) lies inside convex counter-clockwise `poly`: 0 when (x, y) is outside it, or on an edge the
 * rectangle reaches across. Each edge bounds k by the room left in front of (x, y) over the rectangle's farthest
 * corner along the edge's outward normal.
 */
export function rectFitScale(
	poly: ScreenPolygon,
	x: number,
	y: number,
	left: number,
	right: number,
	down: number,
	up: number,
): number {
	const m = math.floor(poly.size() / 2);
	if (m < 3) return 0;
	let k = 1;
	for (let e = 0; e < m; e++) {
		const ax = poly[e * 2];
		const ay = poly[e * 2 + 1];
		const f = (e + 1) % m;
		// outward normal of a ccw edge (unnormalised: room and reach share its length)
		const nx = poly[f * 2 + 1] - ay;
		const ny = ax - poly[f * 2];
		const room = nx * (ax - x) + ny * (ay - y);
		if (room < 0) return 0;
		const reach = math.max(nx * right, -nx * left) + math.max(ny * up, -ny * down);
		if (reach > 0) k = math.min(k, room / reach);
	}
	return k > 0 ? k : 0; // never -0 (a point on an edge)
}

/** Axis-aligned bounds of a polygon: [minX, minY, maxX, maxY]. */
export function polygonBounds(poly: ScreenPolygon): readonly [number, number, number, number] {
	let x0 = math.huge;
	let y0 = math.huge;
	let x1 = -math.huge;
	let y1 = -math.huge;
	const n = math.floor(poly.size() / 2);
	for (let i = 0; i < n; i++) {
		const x = poly[i * 2];
		const y = poly[i * 2 + 1];
		if (x < x0) x0 = x;
		if (x > x1) x1 = x;
		if (y < y0) y0 = y;
		if (y > y1) y1 = y;
	}
	return [x0, y0, x1, y1];
}

/**
 * True when the axis-aligned rectangle [x0, x1] x [y0, y1] overlaps convex counter-clockwise `poly` (separating axes:
 * the rectangle's two, then each polygon edge's normal). Allocation-free, for per-frame use.
 */
export function rectOverlapsPolygon(poly: ScreenPolygon, x0: number, y0: number, x1: number, y1: number): boolean {
	const m = math.floor(poly.size() / 2);
	let px0 = math.huge;
	let px1 = -math.huge;
	let py0 = math.huge;
	let py1 = -math.huge;
	for (let i = 0; i < m; i++) {
		const x = poly[i * 2];
		const y = poly[i * 2 + 1];
		if (x < px0) px0 = x;
		if (x > px1) px1 = x;
		if (y < py0) py0 = y;
		if (y > py1) py1 = y;
	}
	if (px1 < x0 || px0 > x1 || py1 < y0 || py0 > y1) return false;
	for (let e = 0; e < m; e++) {
		const ax = poly[e * 2];
		const ay = poly[e * 2 + 1];
		const f = (e + 1) % m;
		const ex = poly[f * 2] - ax;
		const ey = poly[f * 2 + 1] - ay;
		// every rectangle corner strictly outside this edge (right of it, for a ccw polygon) separates them
		const c1 = ex * (y0 - ay) - ey * (x0 - ax);
		const c2 = ex * (y0 - ay) - ey * (x1 - ax);
		const c3 = ex * (y1 - ay) - ey * (x0 - ax);
		const c4 = ex * (y1 - ay) - ey * (x1 - ax);
		if (c1 < 0 && c2 < 0 && c3 < 0 && c4 < 0) return false;
	}
	return true;
}
