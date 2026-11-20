/**
 * Where a vault's pieces go (docs/TREASURE.md TR7): points in front of the chest along its facing, the placeholder
 * cage's bars round the chest's footprint, the floor texts' boxes (the plate and the lines, for the bullet duck) and
 * their SurfaceGui canvases. Plain numbers (sim world units unless named studs), tested headlessly (layout.spec.ts).
 *
 * @module
 */
import { CAMERA_PITCH_DEG } from "shared/config";
import { degToRad } from "../iso";
import { TREASURE_VIEW } from "./config";

/** A point `forward` tiles in front of the chest's centre (x, z) along its facing (fx, fz). */
export function forwardPoint(x: number, z: number, fx: number, fz: number, forward: number): readonly [number, number] {
	return [x + fx * forward, z + fz * forward];
}

/**
 * The placeholder cage's bars: their centres in the chest's local frame (studs; x across the facing, z along it, the
 * chest's centre at 0), round a w x d stud footprint grown by `marginStuds` on every side. Each side gets bars every
 * `length + gap` studs from one corner to the next (the corners once), so the cage closes on all four sides. Empty
 * for a non-positive pitch or footprint.
 */
export function cageBarOffsets(
	w: number,
	d: number,
	length: number,
	gap: number,
	marginStuds: number,
): Array<readonly [number, number]> {
	const out = new Array<readonly [number, number]>();
	const pitch = length + gap;
	const hw = w / 2 + marginStuds;
	const hd = d / 2 + marginStuds;
	if (!(pitch > 0) || !(hw > 0) || !(hd > 0)) return out;
	const along = (span: number) => math.max(1, math.round((2 * span) / pitch));
	const nx = along(hw);
	const nz = along(hd);
	// Front and back rows (corners included), then the sides between them (corners excluded).
	for (let i = 0; i <= nx; i++) {
		const x = -hw + (2 * hw * i) / nx;
		out.push([x, -hd]);
		out.push([x, hd]);
	}
	for (let k = 1; k < nz; k++) {
		const z = -hd + (2 * hd * k) / nz;
		out.push([-hw, z]);
		out.push([hw, z]);
	}
	return out;
}

/**
 * A floor text's box for the bullet duck (the combo shout's ShoutBox shape, shared/view/hud combo.ts, filled here
 * without importing the hud barrel): centre (x, z), the unit floor axis it reads along (rightX, rightZ), half extents.
 */
export interface FloorTextBox {
	x: number;
	z: number;
	rightX: number;
	rightZ: number;
	halfWidth: number;
	halfDepth: number;
}

/** Fills `out` for a widthTiles x depthTiles floor text centred at (x, z) reading along (rightX, rightZ). */
export function floorTextBoxAt(
	out: FloorTextBox,
	x: number,
	z: number,
	rightX: number,
	rightZ: number,
	widthTiles: number,
	depthTiles: number,
): FloorTextBox {
	out.x = x;
	out.z = z;
	out.rightX = rightX;
	out.rightZ = rightZ;
	out.halfWidth = widthTiles / 2;
	out.halfDepth = depthTiles / 2;
	return out;
}

/**
 * A floor text's SurfaceGui CanvasSize (px) for a widthTiles x depthTiles face: canvasPxPerTile per tile across, tall
 * enough that a glyph foreshortened by the camera's pitch reads unsquashed (shoutCanvasSize's rule).
 */
export function floorTextCanvas(
	widthTiles: number,
	depthTiles: number,
	pitchDeg: number = CAMERA_PITCH_DEG,
): readonly [number, number] {
	const w = widthTiles * TREASURE_VIEW.plate.canvasPxPerTile;
	const h = (w * depthTiles * math.sin(degToRad(pitchDeg))) / widthTiles;
	return [math.max(1, math.round(w)), math.max(1, math.round(h))];
}

/**
 * The UNTOUCHED plate's pip row: each pip's centre x as a fraction of the canvas width (0..1, centred row of `total`
 * pips `pipPx` wide, `gapPx` apart on a `canvasW` px canvas).
 */
export function pipCentres(total: number, pipPx: number, gapPx: number, canvasW: number): number[] {
	const out: number[] = [];
	if (total <= 0 || !(canvasW > 0)) return out;
	const row = total * pipPx + (total - 1) * gapPx;
	const left = (canvasW - row) / 2;
	for (let i = 0; i < total; i++) out.push((left + i * (pipPx + gapPx) + pipPx / 2) / canvasW);
	return out;
}
