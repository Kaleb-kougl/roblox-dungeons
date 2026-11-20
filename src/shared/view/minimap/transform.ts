/**
 * Minimap transform (docs/MINIMAP.md §4, task M4): world (x, z) <-> map pixels, the map turned to match the camera's yaw
 * (MD6) so screen up is map up. Plain top-down: the camera's pitch is dropped. Pure numbers (no Vector2 / UDim2), so it
 * runs headlessly. Roblox-port feature, no web source.
 *
 * Map pixels (u, v): offsets from the map's centre point (the watched player on the corner map), u to the right and v
 * DOWN (screen / GuiObject convention), in the same pixels as `pxPerTile`.
 *
 * Camera (shared/view iso.ts isoBasis, shared/config CAMERA_YAW_DEG): screen right on the ground is
 * (cos yaw, -sin yaw) in world (x, z); screen up on the ground is the view direction with the pitch dropped,
 * (-sin yaw, -cos yaw). shared/play screenToWorld maps the Up / Right inputs onto exactly these directions.
 *
 * The map image is drawn in GRID space (pixel (gx, gy) = cell (gx, gy): image +x = world +x, image +y = world +z) and
 * turned as a whole: GuiObject.Rotation (clockwise degrees on screen, about the object's centre) = the yaw.
 * `gridImageLayout` gives that image's centre, size and rotation; `gridCellToMap` places a cell through it, which equals
 * `worldToMap` of the cell's centre, so markers placed by worldToMap sit on the right pixels.
 *
 * @module
 */
import { TILE_SIZE } from "shared/dungeon";

export interface MinimapBasis {
	/** World (x, z) direction of map right (screen right on the ground). */
	readonly rightX: number;
	readonly rightZ: number;
	/** World (x, z) direction of map up (screen up on the ground). */
	readonly upX: number;
	readonly upZ: number;
	/** GuiObject.Rotation for the grid-space map image, degrees clockwise: the yaw. */
	readonly rotationDeg: number;
}

/** A map point, pixels from the map centre (u right, v down). Mutable so callers can reuse one. */
export interface MapPoint {
	u: number;
	v: number;
}

/** A world point on the ground (sim units). Mutable so callers can reuse one. */
export interface MapWorldPoint {
	x: number;
	z: number;
}

/** The map basis for a camera yaw (degrees about +Y; CAMERA_YAW_DEG in play). */
export function minimapBasis(yawDeg: number): MinimapBasis {
	const yaw = math.rad(yawDeg);
	const c = math.cos(yaw);
	const s = math.sin(yaw);
	return { rightX: c, rightZ: -s, upX: -s, upZ: -c, rotationDeg: yawDeg };
}

/**
 * World (x, z) -> map pixels relative to the map centre at world (centreX, centreZ), `pxPerTile` pixels per tile.
 * Writes into `out` when given.
 */
export function worldToMap(
	b: MinimapBasis,
	x: number,
	z: number,
	centreX: number,
	centreZ: number,
	pxPerTile: number,
	out: MapPoint = { u: 0, v: 0 },
): MapPoint {
	const k = pxPerTile / TILE_SIZE;
	const dx = x - centreX;
	const dz = z - centreZ;
	out.u = (dx * b.rightX + dz * b.rightZ) * k;
	out.v = -(dx * b.upX + dz * b.upZ) * k;
	return out;
}

/** The inverse of worldToMap: map pixels (u, v) around the centre at world (centreX, centreZ) -> world (x, z). */
export function mapToWorld(
	b: MinimapBasis,
	u: number,
	v: number,
	centreX: number,
	centreZ: number,
	pxPerTile: number,
	out: MapWorldPoint = { x: 0, z: 0 },
): MapWorldPoint {
	const k = TILE_SIZE / pxPerTile;
	// right and up are orthonormal: world offset = u * right + (-v) * up
	out.x = centreX + (u * b.rightX - v * b.upX) * k;
	out.z = centreZ + (u * b.rightZ - v * b.upZ) * k;
	return out;
}

const scratch: MapPoint = { u: 0, v: 0 };

/** How to place the grid-space map image (an ImageLabel with AnchorPoint (0.5, 0.5)). */
export interface GridImageLayout {
	/** The image's centre, map pixels from the map centre (Position = map centre + (centreU, centreV)). */
	centreU: number;
	centreV: number;
	/** Unrotated size, pixels: W * pxPerTile by H * pxPerTile. */
	width: number;
	height: number;
	/** GuiObject.Rotation, degrees clockwise. */
	rotationDeg: number;
	/** Map pixels per tile (per image pixel). */
	pxPerTile: number;
	/** cos / sin of the rotation (for gridCellToMap). */
	cos: number;
	sin: number;
}

/**
 * The layout of a W x H grid image on the map centred at world (centreX, centreZ). The image covers world
 * [-0.5, W - 0.5] x [-0.5, H - 0.5] tiles, so its centre is world ((W - 1) / 2, (H - 1) / 2) tiles.
 */
export function gridImageLayout(
	b: MinimapBasis,
	W: number,
	H: number,
	centreX: number,
	centreZ: number,
	pxPerTile: number,
	out?: GridImageLayout,
): GridImageLayout {
	const half = scratch;
	worldToMap(b, ((W - 1) / 2) * TILE_SIZE, ((H - 1) / 2) * TILE_SIZE, centreX, centreZ, pxPerTile, half);
	const rot = math.rad(b.rotationDeg);
	const layout = out ?? {
		centreU: 0,
		centreV: 0,
		width: 0,
		height: 0,
		rotationDeg: 0,
		pxPerTile: 1,
		cos: 1,
		sin: 0,
	};
	layout.centreU = half.u;
	layout.centreV = half.v;
	layout.width = W * pxPerTile;
	layout.height = H * pxPerTile;
	layout.rotationDeg = b.rotationDeg;
	layout.pxPerTile = pxPerTile;
	layout.cos = math.cos(rot);
	layout.sin = math.sin(rot);
	return layout;
}

/**
 * Where the centre of grid cell (gx, gy) lands on the map through `layout` (the image's own pixel, turned clockwise by
 * the rotation about the image centre, screen y down). Equals worldToMap of the cell's centre.
 */
export function gridCellToMap(
	layout: GridImageLayout,
	gx: number,
	gy: number,
	out: MapPoint = { u: 0, v: 0 },
): MapPoint {
	// the unturned image: cell (gx, gy) covers [gx, gx + 1] x [gy, gy + 1] image pixels, pxPerTile map pixels each
	const lx = (gx + 0.5) * layout.pxPerTile - layout.width / 2;
	const ly = (gy + 0.5) * layout.pxPerTile - layout.height / 2;
	out.u = layout.centreU + lx * layout.cos - ly * layout.sin;
	out.v = layout.centreV + lx * layout.sin + ly * layout.cos;
	return out;
}
