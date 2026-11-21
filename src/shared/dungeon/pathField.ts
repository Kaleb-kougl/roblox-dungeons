/**
 * Path fields over the tile grid (docs/TUTORIAL_ARROW.md §1; a Roblox-port feature, no web source): a breadth-first
 * distance field over FLOOR tiles to a target, walking it downhill, and the "the body fits along this straight line"
 * test. Lifted verbatim from the test bots (shared/run/testing endlessBot `distanceField` / `walkDir`, tutorialBot
 * `clearPath`), which now call these, so the bots' recorded runs prove the lift; the tutorial's guidance arrow
 * (shared/tutorial guide.ts) reads them in production. Pure and deterministic: integer BFS, no trig, no Roblox APIs.
 *
 * Units: world (sim) units, which are tiles (TILE_SIZE 1); distances are BFS steps between 4-neighbour tiles.
 * Solid pillars and pits are not FLOOR, so fields already round them. Breakables (`SolidCells`) are not read: the
 * tutorial has none (docs/TUTORIAL.md B7); an endless reuse would have to add them.
 *
 * @module
 */
import { gridToWorld, lineOfSight, worldToGrid, type BulletBlocker } from "./collision";
import { TileType, type Dungeon } from "./forge";

/** A BFS distance field to a target tile (pathField). Never mutated after it is built. */
export interface PathField {
	/** The floor the field was built on. */
	readonly d: Dungeon;
	/** BFS steps to the seed tile per cell (y * W + x); math.huge where unreachable. */
	readonly dist: number[];
	/** The seed tile: the target's own tile, or the FLOOR tile it snapped to (-1, -1 when nothing was in reach). */
	readonly gx: number;
	/** The seed tile's row. */
	readonly gy: number;
	/** The target as given (world): where the last step of a walk aims (pathStep returns -1 on the seed). */
	readonly tx: number;
	/** The target's world z. */
	readonly tz: number;
	/** Cells (y * W + x) left out like walls, e.g. a floor's breakables for the test bots; absent: none. */
	readonly blocked?: ReadonlySet<number>;
}

/** Neighbour order (also the tie-break: the first lowest wins). The BFS uses the first four; walking uses all eight. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1],
];
const STRAIGHT_NEIGHBOURS = 4;

/**
 * A target whose tile is not FLOOR (inside a wall, pillar or pit, or off the grid) seeds the field from the nearest
 * FLOOR tile at most this many tiles away on each axis (pathField).
 */
export const PATH_SNAP_TILES = 3;

/** Tiles this close (world units) to pathField's `avoid` point are left out of the field (the open stairwell). */
export const PATH_AVOID_RADIUS = 2.5;

/** Shorter than this, a direction has no unit vector (clearWalk falls back to no side offset). */
const UNIT_EPS = 1e-9;

function isFloor(d: Dungeon, gx: number, gy: number): boolean {
	return gx >= 0 && gy >= 0 && gx < d.W && gy < d.H && d.grid[gy * d.W + gx] === TileType.FLOOR;
}

/**
 * The seed tile for a target at grid (gx0, gy0): itself when FLOOR, else the FLOOR tile within PATH_SNAP_TILES
 * (Chebyshev) nearest to it (squared tile distance; ties to the first in row order), else undefined.
 */
function snapSeed(d: Dungeon, gx0: number, gy0: number): number | undefined {
	if (isFloor(d, gx0, gy0)) return gy0 * d.W + gx0;
	let best: number | undefined;
	let bestD2 = math.huge;
	for (let oy = -PATH_SNAP_TILES; oy <= PATH_SNAP_TILES; oy++)
		for (let ox = -PATH_SNAP_TILES; ox <= PATH_SNAP_TILES; ox++) {
			const gx = gx0 + ox;
			const gy = gy0 + oy;
			const d2 = ox * ox + oy * oy;
			if (d2 < bestD2 && isFloor(d, gx, gy)) {
				bestD2 = d2;
				best = gy * d.W + gx;
			}
		}
	return best;
}

/**
 * 4-neighbour BFS over FLOOR tiles from the tile of world (tx, tz), snapped to the nearest FLOOR tile within
 * PATH_SNAP_TILES when it is not FLOOR. With `avoid` (world XZ), tiles within PATH_AVOID_RADIUS of it are left out
 * (the seed itself is always in); cells in `blocked` are left out like walls. Allocates the field (one array of W * H);
 * build it once per target tile.
 */
export function pathField(
	d: Dungeon,
	tx: number,
	tz: number,
	avoid?: readonly [number, number],
	blocked?: ReadonlySet<number>,
): PathField {
	const dist = new Array<number>(d.W * d.H, math.huge);
	const avoided = (gx: number, gy: number) => {
		if (avoid === undefined) return false;
		const dx = gridToWorld(gx) - avoid[0];
		const dz = gridToWorld(gy) - avoid[1];
		return dx * dx + dz * dz <= PATH_AVOID_RADIUS * PATH_AVOID_RADIUS;
	};
	const seed = snapSeed(d, worldToGrid(tx), worldToGrid(tz));
	if (seed === undefined) return { d, dist, gx: -1, gy: -1, tx, tz };
	const queue: number[] = [seed];
	dist[seed] = 0;
	let head = 0;
	while (head < queue.size()) {
		const i = queue[head++];
		const gx = i % d.W;
		const gy = math.floor(i / d.W);
		for (let k = 0; k < STRAIGHT_NEIGHBOURS; k++) {
			const [ox, oy] = NEIGHBOURS[k];
			const nx = gx + ox;
			const ny = gy + oy;
			if (!isFloor(d, nx, ny) || avoided(nx, ny)) continue;
			const j = ny * d.W + nx;
			if (blocked !== undefined && blocked.has(j)) continue;
			if (dist[j] <= dist[i] + 1) continue;
			dist[j] = dist[i] + 1;
			queue.push(j);
		}
	}
	return { d, dist, gx: seed % d.W, gy: math.floor(seed / d.W), tx, tz, blocked };
}

/** Path distance (BFS steps, tiles) from the tile of world (x, z) to the field's seed; math.huge when unreachable. */
export function pathDistance(f: PathField, x: number, z: number): number {
	const gx = worldToGrid(x);
	const gy = worldToGrid(z);
	if (gx < 0 || gy < 0 || gx >= f.d.W || gy >= f.d.H) return math.huge;
	return f.dist[gy * f.d.W + gx];
}

/** FLOOR and not one of the field's blocked cells (no closure: pathStep runs every frame, garbage-free). */
function openCell(f: PathField, x: number, y: number): boolean {
	if (!isFloor(f.d, x, y)) return false;
	const b = f.blocked;
	return b === undefined || !b.has(y * f.d.W + x);
}

/**
 * One step downhill from grid (gx, gy): the cell index (y * W + x) of the 8-neighbour open tile (FLOOR, not blocked)
 * with the lowest distance below this tile's (diagonals only past open corners; ties to the first in neighbour order),
 * or -1 on the seed, where no neighbour is lower, or where nothing is reachable.
 */
export function pathStep(f: PathField, gx: number, gy: number): number {
	const d = f.d;
	let best = f.dist[gy * d.W + gx] ?? math.huge;
	let nextCell = -1;
	if (best > 0) {
		for (const [ox, oy] of NEIGHBOURS) {
			const nx = gx + ox;
			const ny = gy + oy;
			if (!openCell(f, nx, ny)) continue;
			// Diagonals only past open corners.
			if (ox !== 0 && oy !== 0 && (!openCell(f, gx + ox, gy) || !openCell(f, gx, gy + oy))) continue;
			const v = f.dist[ny * d.W + nx];
			if (v < best) {
				best = v;
				nextCell = ny * d.W + nx;
			}
		}
	}
	return nextCell;
}

/**
 * Walks the field downhill (pathStep) from the tile of world (x, z) for at most `steps` tiles and writes the world
 * centres of the tiles stepped onto into `out` as x, z pairs (out[0], out[1] is the first step; entries past the
 * returned count are left as they were, so `out` can be reused without allocating). Returns the number of tiles
 * written: fewer than `steps` when the seed (or a dead end) comes first, 0 on the seed or when unreachable.
 */
export function pathAhead(f: PathField, x: number, z: number, steps: number, out: number[]): number {
	let gx = worldToGrid(x);
	let gy = worldToGrid(z);
	let n = 0;
	while (n < steps) {
		const nextCell = pathStep(f, gx, gy);
		if (nextCell < 0) break;
		gx = nextCell % f.d.W;
		gy = math.floor(nextCell / f.d.W);
		out[2 * n] = gridToWorld(gx);
		out[2 * n + 1] = gridToWorld(gy);
		n++;
	}
	return n;
}

/**
 * True when a body of `radius` fits along the straight line (x0, z0) -> (x1, z1): the centre line and the two lines
 * `radius` to either side are all clear by `blocked` (lineOfSight, tile centres). With `bulletBlocker(d)` it is the
 * tutorial bot's walk test (walls and solid pillars block, pits do not); walkBlocker(d) also stops at pits.
 */
export function clearWalk(
	blocked: BulletBlocker,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	radius: number,
): boolean {
	const dx = x1 - x0;
	const dz = z1 - z0;
	const len = math.sqrt(dx * dx + dz * dz);
	const ux = len > UNIT_EPS ? dx / len : 0;
	const uz = len > UNIT_EPS ? dz / len : 0;
	const ox = -uz * radius;
	const oz = ux * radius;
	return (
		lineOfSight(blocked, x0, z0, x1, z1) &&
		lineOfSight(blocked, x0 + ox, z0 + oz, x1 + ox, z1 + oz) &&
		lineOfSight(blocked, x0 - ox, z0 - oz, x1 - ox, z1 - oz)
	);
}

/** A blocker for clearWalk that stops at every tile a body cannot stand on (anything but FLOOR, off the grid too). */
export function walkBlocker(d: Dungeon): BulletBlocker {
	return (x, z) => !isFloor(d, worldToGrid(x), worldToGrid(z));
}
