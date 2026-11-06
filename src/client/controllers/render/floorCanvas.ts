import { CAMERA_YAW_DEG } from "shared/config";
import { degToRad } from "shared/view";
import { FX_SPRITE_VIEW } from "shared/view/fx";

/**
 * A Top-face SurfaceGui's canvas comes out turned FX_SPRITE_VIEW.floorCanvasTurnDeg (90) anticlockwise on screen from
 * its Part (an engine quirk: Top-face SurfaceGuis do not follow the Decal convention; owner's Studio check 2026-11-01:
 * the canvas's up is the Part's local -X, its right the Part's local -Z). A flat floor Part carrying one is turned
 * back the same amount (clockwise on screen: negative about +Y) after the camera yaw, and its x / z sizes swapped
 * (floorCanvasPartSize), so the canvas reads screen-up as drawn. Without it a floor text (the combo shout, PARRY!,
 * SYNC!, the vault plate, the pact cards) read sideways, its top to the screen's left.
 */
export const FLOOR_CANVAS_TURN = CFrame.Angles(0, -degToRad(FX_SPRITE_VIEW.floorCanvasTurnDeg), 0);

/** The camera yaw then the canvas turn: the rotation of a flat floor Part whose Top-face canvas reads screen-up. */
export const FLOOR_CANVAS_YAW = CFrame.Angles(0, degToRad(CAMERA_YAW_DEG), 0).mul(FLOOR_CANVAS_TURN);

/**
 * The Size of a Part placed with FLOOR_CANVAS_TURN whose canvas spans `widthStuds` across the screen and `depthStuds`
 * up it: the turned Part's x runs screen-down (the canvas's height), its z screen-left (the canvas's width).
 */
export function floorCanvasPartSize(widthStuds: number, thicknessStuds: number, depthStuds: number): Vector3 {
	return new Vector3(depthStuds, thicknessStuds, widthStuds);
}
