/**
 * Minimap sight (docs/MINIMAP.md §2, task M2): symmetric shadowcasting on the map grid, after Albert Ford's
 * "Symmetric Shadowcasting" (https://www.albertford.com/shadowcasting/), with exact rational slopes. Pure: integer and
 * rational maths only (no trig), no allocation per call (the row stack and the visited stamps live on the instance).
 *
 * Rules:
 *   - WALL and NONE cells block (and so does everything off the grid); FLOOR and POOL are transparent. Breakables are
 *     not map tiles, so they never block; solid pillars are WALL.
 *   - A cell is lit when its centre is within `radius` of the origin's centre (dx^2 + dy^2 <= radius^2) and Ford's
 *     rules light it: a transparent cell when its centre is inside the unblocked slope range (symmetric: A sees B iff
 *     B sees A), a blocking cell whenever any part of it is (so the walls that stop the light are lit too).
 *   - No light through diagonal wall corners (an addition to Ford's rules): a transparent cell whose neighbour toward
 *     the origin (one row back) and whose neighbour toward the quadrant's centre line (one column in) both block can
 *     only be reached through a single corner point, so it stays dark and blocks like a wall.
 *   - Every lit cell is visited exactly once per call (cells on the quadrants' diagonals are scanned twice and
 *     de-duplicated), the origin first. An origin off the grid lights nothing.
 * Roblox-port feature, no web source.
 */
import { MapTile, type MinimapTiles } from "./tiles";

/** Called once per lit cell (cell index y * W + x). */
export type SightVisit = (cell: number) => void;

/** Previous-cell classes of a row scan. */
const PREV_NONE = 0;
const PREV_BLOCKED = 1;
const PREV_OPEN = 2;

/** Quadrants: (depth, col) -> (dx, dy). 0 north (-y), 1 east (+x), 2 south (+y), 3 west (-x). */
const QUADRANTS = 4;

/** True when a map tile blocks sight (WALL, NONE). */
export function blocksSight(tile: number): boolean {
	return tile === MapTile.WALL || tile === MapTile.NONE;
}

/** A reusable shadowcaster: one per caller (the fog owns one); `cast` never allocates once its arrays have grown. */
export class Shadowcaster {
	/** Per cell: the call generation that last visited it. */
	private readonly stamp: number[] = [];
	private generation = 0;
	/** The row stack: depth and the start / end slopes as numerator / denominator (denominators > 0). */
	private readonly stackDepth: number[] = [];
	private readonly stackStartNum: number[] = [];
	private readonly stackStartDen: number[] = [];
	private readonly stackEndNum: number[] = [];
	private readonly stackEndDen: number[] = [];
	private top = 0;
	// The current call's inputs (set by cast).
	private tile: ReadonlyArray<number> = [];
	private W = 0;
	private H = 0;
	private ox = 0;
	private oy = 0;
	private quadrant = 0;

	/**
	 * Lights the cells `tiles` shows from cell (ox, oy) within `radius` tiles (rules in the file comment) and calls
	 * `visit` once per lit cell. Returns the number of cells visited.
	 */
	cast(tiles: MinimapTiles, ox: number, oy: number, radius: number, visit: SightVisit): number {
		const W = tiles.W;
		const H = tiles.H;
		if (ox < 0 || oy < 0 || ox >= W || oy >= H) return 0;
		const n = W * H;
		const stamp = this.stamp;
		while (stamp.size() < n) stamp.push(0);
		this.generation++;
		const gen = this.generation;
		this.tile = tiles.tile;
		this.W = W;
		this.H = H;
		this.ox = ox;
		this.oy = oy;
		const r = math.max(0, math.floor(radius));
		const r2 = radius * radius;

		const origin = oy * W + ox;
		stamp[origin] = gen;
		visit(origin);
		let count = 1;
		if (r < 1) return count;

		for (let q = 0; q < QUADRANTS; q++) {
			this.quadrant = q;
			this.top = 0;
			this.push(1, -1, 1, 1, 1);
			while (this.top > 0) {
				this.top--;
				const k = this.top;
				const depth = this.stackDepth[k];
				let sn = this.stackStartNum[k];
				let sd = this.stackStartDen[k];
				const en = this.stackEndNum[k];
				const ed = this.stackEndDen[k];
				// round half up (depth * start) .. round half down (depth * end); exact for these small integers
				const minCol = math.floor((2 * depth * sn + sd) / (2 * sd));
				const maxCol = math.ceil((2 * depth * en - ed) / (2 * ed));
				let prev = PREV_NONE;
				for (let col = minCol; col <= maxCol; col++) {
					const cell = this.cellAt(depth, col);
					const wall = cell < 0 || this.blocksCell(cell);
					const pinched =
						!wall &&
						col !== 0 &&
						this.blocksAt(depth - 1, col) &&
						this.blocksAt(depth, col > 0 ? col - 1 : col + 1);
					if (cell >= 0 && depth * depth + col * col <= r2 && stamp[cell] !== gen) {
						const symmetric = col * sd >= depth * sn && col * ed <= depth * en;
						if (wall || (!pinched && symmetric)) {
							stamp[cell] = gen;
							visit(cell);
							count++;
						}
					}
					const blocked = wall || pinched;
					if (prev === PREV_BLOCKED && !blocked) {
						sn = 2 * col - 1;
						sd = 2 * depth;
					}
					if (prev === PREV_OPEN && blocked && depth < r)
						this.push(depth + 1, sn, sd, 2 * col - 1, 2 * depth);
					prev = blocked ? PREV_BLOCKED : PREV_OPEN;
				}
				if (prev === PREV_OPEN && depth < r) this.push(depth + 1, sn, sd, en, ed);
			}
		}
		return count;
	}

	private push(depth: number, sn: number, sd: number, en: number, ed: number): void {
		const k = this.top;
		this.stackDepth[k] = depth;
		this.stackStartNum[k] = sn;
		this.stackStartDen[k] = sd;
		this.stackEndNum[k] = en;
		this.stackEndDen[k] = ed;
		this.top = k + 1;
	}

	/** The cell at (depth, col) of the current quadrant, or -1 off the grid. */
	private cellAt(depth: number, col: number): number {
		const q = this.quadrant;
		let x: number;
		let y: number;
		if (q === 0) {
			x = this.ox + col;
			y = this.oy - depth;
		} else if (q === 1) {
			x = this.ox + depth;
			y = this.oy + col;
		} else if (q === 2) {
			x = this.ox + col;
			y = this.oy + depth;
		} else {
			x = this.ox - depth;
			y = this.oy + col;
		}
		if (x < 0 || y < 0 || x >= this.W || y >= this.H) return -1;
		return y * this.W + x;
	}

	private blocksCell(cell: number): boolean {
		return blocksSight(this.tile[cell]);
	}

	/** True when (depth, col) of the current quadrant blocks (off the grid included). */
	private blocksAt(depth: number, col: number): boolean {
		const cell = this.cellAt(depth, col);
		return cell < 0 || this.blocksCell(cell);
	}
}

const sharedCaster = new Shadowcaster();

/**
 * One cast on a module-wide Shadowcaster (docs/MINIMAP.md §2's `shadowcast`); not re-entrant (do not cast again from
 * inside `visit`). Returns the number of cells visited.
 */
export function shadowcast(tiles: MinimapTiles, ox: number, oy: number, radius: number, visit: SightVisit): number {
	return sharedCaster.cast(tiles, ox, oy, radius, visit);
}
