/**
 * Portrait play (docs/PORTRAIT.md): the view's framing on any aspect, the touch controls' upright band and the
 * backdrop's reach. Plain numbers, so it is specced headlessly (portrait.spec.ts). Presentation only.
 *
 * Framing (PD2, owner 2026-11-02): the screen's SHORT side always shows VIEW_TILES_HIGH tiles. Landscape (wider than
 * tall) is exactly the old view whatever the device; upright, the width shows VIEW_TILES_HIGH and the height
 * VIEW_TILES_HIGH x aspect (capped at PORTRAIT.maxAspect, PD4). The camera moves back to show it at GAME_CAMERA.fovDeg
 * (PD3: spike B's orthographic look); past PORTRAIT.maxDistanceStuds the FOV widens instead.
 *
 * The lift (PD5): upright with the touch controls on, the thumbs cover the bottom PORTRAIT.controlBandShare of the
 * screen, so the view is shifted until the player sits centred in what is left: liftTiles along the camera's up axis.
 *
 * @module
 */
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE, VIEW_TILES_HIGH } from "shared/config";
import { GAME_CAMERA } from "./config";
import { degToRad, distanceForFov, isoBasis, type IsoBasis } from "./iso";

export const PORTRAIT = {
	/** PlayerGui.ScreenOrientation on touch devices (Enum.ScreenOrientation name; PD1: follow the device). */
	screenOrientation: "Sensor",
	/** The tallest aspect (height / width) the view frames in full; taller shows fewer tiles across (PD4: 21.6 : 9). */
	maxAspect: 2.4,
	/** Upright: the touch controls' band, as a share of the safe area's height from its bottom. */
	controlBandShare: 1 / 3,
	/** Upright: the action cluster's share of the safe width from its side (the move home takes the rest). */
	actionShare: 0.62,
	/** Upright: the move zone's share of the safe height from its bottom (the lower half: never the world above). */
	moveZoneShare: 0.5,
	/** Upright pause: the map's share of the safe height at the top (square, inside the width; docs/PORTRAIT.md PT6). */
	pauseMapShare: 0.45,
	/** The camera never stands farther than this (studs); past it the FOV widens (PD3; PT9 may lower it). */
	maxDistanceStuds: 2000,
} as const;

const HALF = 0.5;

/** Taller than wide (a phone held upright, or a tall window). */
export function isPortrait(w: number, h: number): boolean {
	return w > 0 && h > w;
}

/** Tiles the screen shows top to bottom: VIEW_TILES_HIGH on the short side (PD2), the aspect capped (PD4). */
export function viewTilesHigh(w: number, h: number): number {
	if (!(w > 0) || !(h > 0)) return VIEW_TILES_HIGH;
	return VIEW_TILES_HIGH * math.clamp(h / w, 1, PORTRAIT.maxAspect);
}

/** Tiles the screen shows left to right at viewTilesHigh. */
export function viewTilesWide(w: number, h: number): number {
	if (!(w > 0) || !(h > 0)) return VIEW_TILES_HIGH;
	return (viewTilesHigh(w, h) * w) / h;
}

export interface CameraFraming {
	/** Tiles top to bottom (viewTilesHigh). */
	readonly tilesHigh: number;
	/** The camera's distance from its focus, studs. */
	readonly distance: number;
	/** The camera's vertical field of view, degrees (GAME_CAMERA.fovDeg unless the distance cap bites). */
	readonly fovDeg: number;
	/** How far above the screen's centre the followed player sits, tiles along the camera's up axis (PD5). */
	readonly liftTiles: number;
}

/** The game camera's framing for a `w` x `h` viewport; `touchControls`: the touch controls are on screen. */
export function cameraFraming(w: number, h: number, touchControls: boolean): CameraFraming {
	const tilesHigh = viewTilesHigh(w, h);
	const visible = tilesHigh * STUDS_PER_TILE;
	let distance = distanceForFov(GAME_CAMERA.fovDeg, visible);
	let fovDeg: number = GAME_CAMERA.fovDeg;
	if (distance > PORTRAIT.maxDistanceStuds) {
		distance = PORTRAIT.maxDistanceStuds;
		fovDeg = 2 * math.deg(math.atan((visible * HALF) / distance));
	}
	const liftTiles = touchControls && isPortrait(w, h) ? tilesHigh * PORTRAIT.controlBandShare * HALF : 0;
	return { tilesHigh, distance, fovDeg, liftTiles };
}

/** The game camera's basis (yaw CAMERA_YAW_DEG, pitch CAMERA_PITCH_DEG). */
const CAMERA_BASIS: IsoBasis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));

/**
 * How far past the camera's focus (tiles along world x or z, the larger) the screen's four corners reach on a plane
 * `depthTiles` under the floor, for a view `tilesHigh` x `tilesWide` with the player lifted `liftTiles` (the backdrop
 * must reach past the floor's edge by at least this: a player at the edge must never see past it). The narrow-FOV
 * camera is taken as orthographic (the 7 degree error is far under a tile at these sizes).
 */
export function backdropReachTiles(
	tilesHigh: number,
	tilesWide: number,
	liftTiles: number,
	depthTiles: number,
): number {
	const r = CAMERA_BASIS.right;
	const u = CAMERA_BASIS.up;
	const f = CAMERA_BASIS.forward;
	let reach = 0;
	for (const sx of [-tilesWide * HALF, tilesWide * HALF]) {
		for (const sy of [-tilesHigh * HALF, tilesHigh * HALF]) {
			// The corner's ray passes through focus + right * sx + up * (sy - lift) along forward; the focus is (0, 0, 0).
			const vy = sy - liftTiles;
			const qx = r[0] * sx + u[0] * vy;
			const qy = r[1] * sx + u[1] * vy;
			const qz = r[2] * sx + u[2] * vy;
			const t = (-depthTiles - qy) / f[1];
			reach = math.max(reach, math.abs(qx + f[0] * t), math.abs(qz + f[2] * t));
		}
	}
	return reach;
}
