/**
 * Test support for the wall-slide specs (docs/WALL_SLIDE.md WS0-WS2; never imported by the game): synthetic grids and
 * walkers shared by collision.snag.spec.ts and slide.spec.ts.
 */
import { TileType, cellKey, type Dungeon, type SolidCells, type WorldXZ } from "shared/dungeon";

/** A mover with moveCircle's signature (moveCircle, slideCircle with fixed tuning, ...). */
export type SceneMover = (
	d: Dungeon,
	x: number,
	z: number,
	dx: number,
	dz: number,
	radius: number,
	solid?: SolidCells,
) => WorldXZ;

/** A W x H grid: a WALL border, WALL where `blocked(gx, gy)`, FLOOR elsewhere (only W, H and grid are set). */
export function sceneGrid(W: number, H: number, blocked: (gx: number, gy: number) => boolean): Dungeon {
	const grid: number[] = [];
	for (let gy = 0; gy < H; gy++)
		for (let gx = 0; gx < W; gx++)
			grid.push(
				gx === 0 || gy === 0 || gx === W - 1 || gy === H - 1 || blocked(gx, gy)
					? TileType.WALL
					: TileType.FLOOR,
			);
	return { W, H, grid } as unknown as Dungeon;
}

/** SolidCells holding the given cells. */
export function solidOf(cells: ReadonlyArray<readonly [number, number]>): SolidCells {
	const m = new Map<number, number>();
	cells.forEach(([gx, gy], i) => m.set(cellKey(gx, gy), i));
	return m;
}

/** Walks (dx, dz) per tick from (x, z) until `goal` holds; the tick it first held on, or -1 after `maxTicks`. */
export function ticksTo(
	mover: SceneMover,
	d: Dungeon,
	x: number,
	z: number,
	dx: number,
	dz: number,
	r: number,
	goal: (x: number, z: number) => boolean,
	maxTicks: number,
	solid?: SolidCells,
): number {
	let px = x,
		pz = z;
	for (let t = 1; t <= maxTicks; t++) {
		const p = mover(d, px, pz, dx, dz, r, solid);
		px = p.x;
		pz = p.z;
		if (goal(px, pz)) return t;
	}
	return -1;
}

/** walk()'s result: the end point, and whether the last `stillTicks` positions were bit-identical. */
export interface SceneWalk {
	x: number;
	z: number;
	still: boolean;
}

/** Walks (dx, dz) per tick for `ticks` ticks from (x, z). */
export function walk(
	mover: SceneMover,
	d: Dungeon,
	x: number,
	z: number,
	dx: number,
	dz: number,
	r: number,
	ticks: number,
	stillTicks = 5,
	solid?: SolidCells,
): SceneWalk {
	let px = x,
		pz = z;
	let still = true;
	const from = ticks - stillTicks;
	for (let t = 1; t <= ticks; t++) {
		const p = mover(d, px, pz, dx, dz, r, solid);
		if (t > from && (p.x !== px || p.z !== pz)) still = false;
		px = p.x;
		pz = p.z;
	}
	return { x: px, z: pz, still };
}
