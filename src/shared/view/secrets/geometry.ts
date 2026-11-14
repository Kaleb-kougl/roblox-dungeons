/**
 * A secret room's cells for the world views (docs/SECRET_ROOMS.md SR7, Design 7): the pure half of WorldController's
 * crack hole, SecretRenderController's chamber build, VoidController's hold-out and DecorController's keep-out. A LEAF
 * (shared/dungeon types and TileType only): shared/view/voidDecor and shared/view/decor import it by file.
 *
 * Geometry (shared/dungeon FloorSecret): the crack is `cells` far-wall cells from (x, y) along (ax, az), the room's
 * FLOOR at +f = (fx, fz); the chamber's floor is the rectangle [x0, x0 + w) x [y0, y0 + h) behind it; its RING is that
 * rectangle grown by one cell (the back and side walls, and the parent's wall line on the crack's side, the crack
 * itself included). The Forge's grid (EndlessFloorLayout.dungeon, what the view draws until the open) has the chamber
 * and most of the ring as VOID and the crack as WALL; the carved copy (FloorSecret.dungeon, the sim's) has the chamber
 * and the crack FLOOR and the ring WALL.
 *
 *   secretRingRect        the ring's bounding rectangle (inclusive cells): the void hold-out and the decor keep-out
 *   secretCrackIndices    the crack's grid cells (y * W + x): WorldController leaves them out of the wall merge
 *                         (secretWallMergeGrid) and SecretRenderController draws them as their own Part
 *   secretChamberBuild    what SecretRenderController builds HIDDEN at floor load and shows at the open: the chamber
 *                         floor (one rect), the chamber's own walls (the ring cells WALL in the carved grid that are not
 *                         WALL in the Forge's, greedy-merged), two torch spots on the back wall facing in, the chest
 */
import { TileType, tileAt, type Dungeon, type FloorSecret } from "shared/dungeon";
import { greedyRects, type TileRect } from "../tileMerge";

/** A rectangle of grid cells [x0, x1] x [y0, y1], both ends included. */
export interface CellRect {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
}

/** The geometry the helpers read (FloorSecret without its dungeon, so specs can build one by hand). */
export type SecretCells = Pick<
	FloorSecret,
	"x" | "y" | "fx" | "fz" | "ax" | "az" | "cells" | "x0" | "y0" | "w" | "h" | "along" | "chestX" | "chestY"
>;

/** Is grid cell (gx, gy) inside `r`? */
export function inCellRect(r: Readonly<CellRect> | undefined, gx: number, gy: number): boolean {
	return r !== undefined && gx >= r.x0 && gx <= r.x1 && gy >= r.y0 && gy <= r.y1;
}

/** The chamber's ring: the floor rectangle grown by one cell each way (the crack lies on its +f edge). */
export function secretRingRect(plan: Readonly<SecretCells>): CellRect {
	return { x0: plan.x0 - 1, y0: plan.y0 - 1, x1: plan.x0 + plan.w, y1: plan.y0 + plan.h };
}

/** The crack's cells, along the wall from its first. */
export function secretCrackList(plan: Readonly<SecretCells>): Array<{ x: number; y: number }> {
	const out: Array<{ x: number; y: number }> = [];
	for (let c = 0; c < plan.cells; c++) out.push({ x: plan.x + plan.ax * c, y: plan.y + plan.az * c });
	return out;
}

/** The crack's grid cell indices (y * W + x), along the wall from its first. */
export function secretCrackIndices(plan: Readonly<SecretCells>, W: number): number[] {
	const out: number[] = [];
	for (const c of secretCrackList(plan)) out.push(c.y * W + c.x);
	return out;
}

/**
 * A grid value no tile type has: the crack's cells in secretWallMergeGrid's copy, so neither the floor nor the wall
 * merge (tileMerge greedyRectsOf) takes them.
 */
export const SECRET_CRACK_CELL = -1;

/**
 * WorldController's merge grid for a floor with a secret: `grid` (its copy of the Forge's, solid decor already turned
 * to FLOOR) with the crack's cells set to SECRET_CRACK_CELL, so the wall rectangles never span them (the crack is its
 * own Part: it goes at the open). `plan` undefined: `grid` unchanged. Writes `grid` in place and returns it.
 */
export function secretWallMergeGrid(grid: number[], W: number, plan: Readonly<SecretCells> | undefined): number[] {
	if (plan === undefined) return grid;
	for (const c of secretCrackIndices(plan, W)) grid[c] = SECRET_CRACK_CELL;
	return grid;
}

/** A torch spot on a chamber wall: the WALL cell and the face it hangs on (toward the chamber). */
export interface SecretTorchSpot {
	readonly x: number;
	readonly y: number;
	readonly fx: number;
	readonly fz: number;
}

/** What SecretRenderController builds hidden at floor load (see the file comment). Grid cells; world = grid. */
export interface SecretChamberBuild {
	/** The chamber's floor (one rect: [x0, x0 + w) x [y0, y0 + h)). */
	readonly floor: TileRect;
	/** The chamber's own walls: WALL in the carved grid and not WALL in the Forge's (the parent's wall line is not here). */
	readonly walls: ReadonlyArray<TileRect>;
	/** Two torches on the back wall facing in, at the chamber's first and last cell along the wall. */
	readonly torches: ReadonlyArray<SecretTorchSpot>;
	/** The crack's cells (drawn as their own Part until the open, then rubble on them). */
	readonly crack: ReadonlyArray<{ readonly x: number; readonly y: number }>;
	/** The chest's cell and its facing (toward the crack). */
	readonly chestX: number;
	readonly chestY: number;
	readonly chestFx: number;
	readonly chestFz: number;
}

/**
 * The chamber build of `plan` over the Forge's dungeon `forge` and the carved one `carved` (FloorSecret.dungeon). The
 * back wall is the ring row at -f behind the chamber's floor (the row whose +f face the camera, at +X +Z, sees).
 */
export function secretChamberBuild(plan: Readonly<SecretCells>, forge: Dungeon, carved: Dungeon): SecretChamberBuild {
	const ring = secretRingRect(plan);
	const rw = ring.x1 - ring.x0 + 1;
	const rh = ring.y1 - ring.y0 + 1;
	const walls = greedyRects(rw, rh, (x, y) => {
		const gx = ring.x0 + x;
		const gy = ring.y0 + y;
		return tileAt(carved, gx, gy) === TileType.WALL && tileAt(forge, gx, gy) !== TileType.WALL;
	}).map((r) => ({ x: r.x + ring.x0, y: r.y + ring.y0, w: r.w, h: r.h }));
	// The back wall row: the chamber's first cell behind the crack's wall line is x0 / y0 at -f, its back wall one past.
	const backX = plan.fx !== 0 ? plan.x0 - 1 : plan.x0;
	const backY = plan.fz !== 0 ? plan.y0 - 1 : plan.y0;
	const torches: SecretTorchSpot[] = [];
	for (const i of [0, plan.along - 1])
		torches.push({ x: backX + plan.ax * i, y: backY + plan.az * i, fx: plan.fx, fz: plan.fz });
	return {
		floor: { x: plan.x0, y: plan.y0, w: plan.w, h: plan.h },
		walls,
		torches,
		crack: secretCrackList(plan),
		chestX: plan.chestX,
		chestY: plan.chestY,
		chestFx: plan.fx,
		chestFz: plan.fz,
	};
}
