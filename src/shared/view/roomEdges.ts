/**
 * Room edges (docs/ROOM_EDGES.md §1): where a room's floor meets other floor (a corridor, or in principle another
 * room), as straight runs on the cell boundary, so the client can draw a dashed line exactly where `roomIdAt`
 * (shared/dungeon endless.ts) flips from one room to another. Pure: plain integer scanning of the grid and roomId,
 * built once per floor; tunables (dash size, inset) in roomEdgesConfig.ts. Roblox-port feature, no web source.
 *
 * World units: cell (gx, gy) covers [gx - 0.5, gx + 0.5] x [gy - 0.5, gy + 0.5] tiles (collision.ts), x = grid x,
 * z = grid y.
 *
 * @module
 */
import { TILE_SIZE, TileType, gridToWorld, type Dungeon } from "shared/dungeon";

/** One straight run of a room's edge, world units, on the cell boundary; (nx, nz) is the unit normal out of the room. */
export interface RoomEdgeRun {
	/** Room id (index into Dungeon.rooms) whose edge this is; the room's cells are on the -normal side. */
	readonly room: number;
	/** Start of the run (x0 <= x1, z0 <= z1: runs go along +x or +z). */
	readonly x0: number;
	readonly z0: number;
	/** End of the run. */
	readonly x1: number;
	readonly z1: number;
	/** Unit normal out of the room, into the corridor: one of (+-1, 0), (0, +-1). */
	readonly nx: number;
	readonly nz: number;
}

/**
 * Every room edge of one floor, from `roomEdges(dungeon)`: built once per floor, in a fixed order so every client lays
 * the same dashes. The client's RoomEdgeController draws one dashed line per run and recolours a room's runs through
 * `byRoom`.
 */
export interface RoomEdges {
	/**
	 * Every run, in a fixed order: room id, then axis (runs along z, i.e. lines of constant x, first), then line
	 * coordinate, then start.
	 */
	readonly runs: ReadonlyArray<RoomEdgeRun>;
	/** Run indices per room id, one entry per room of Dungeon.rooms (rooms without an edge to other floor: empty). */
	readonly byRoom: ReadonlyArray<ReadonlyArray<number>>;
	/** Unit (one tile long) edges in all runs. */
	readonly unitEdges: number;
}

/** A cell that is not FLOOR (wall, pool / pit, void): never makes an edge, on either side. */
const NOT_FLOOR = -2;
/** A FLOOR cell outside every room (a corridor), as roomIdAt reports it. */
const NO_ROOM = -1;
const HALF_TILE = TILE_SIZE / 2;

/** A run under construction, in grid terms. */
interface RunCells {
	/** 0: a line of constant x (between columns `line` and `line + 1`); 1: a line of constant z (rows). */
	readonly axis: number;
	readonly line: number;
	/** +1: the room is on the low side (column / row `line`), -1: on the high side. */
	readonly sign: number;
	/** First and one past the last cell along the line (rows for axis 0, columns for axis 1). */
	readonly start: number;
	readonly stop: number;
}

/** Per cell: NOT_FLOOR, NO_ROOM, or the room id (normalised exactly like roomIdAt: out-of-range ids are NO_ROOM). */
function cellClasses(d: Dungeon): number[] {
	const rooms = d.rooms.size();
	const out: number[] = [];
	const n = d.W * d.H;
	for (let i = 0; i < n; i++) {
		if (d.grid[i] !== TileType.FLOOR) {
			out.push(NOT_FLOOR);
		} else {
			const id = d.roomId[i];
			out.push(id !== undefined && id >= 0 && id < rooms ? id : NO_ROOM);
		}
	}
	return out;
}

/** Appends `run` to its room's list, keeping (axis, line, start) order (only runs of one line can arrive out of order). */
function insertRun(list: RunCells[], run: RunCells): void {
	let at = list.size();
	while (at > 0) {
		const prev = list[at - 1];
		if (prev.axis !== run.axis || prev.line !== run.line || prev.start < run.start) break;
		at--;
	}
	list.insert(at, run);
}

/**
 * Scans the boundary lines of one axis. Line `line` separates the cells (lo, k) and (hi, k) for k = 0 .. len - 1;
 * `cellOf(line, k)` and `cellOf(line + 1, k)` give their indices. Each side keeps one open run that grows while the
 * same room keeps an edge on that side of the line.
 */
function scanAxis(
	classes: ReadonlyArray<number>,
	axis: number,
	lines: number,
	len: number,
	cellOf: (across: number, along: number) => number,
	perRoom: RunCells[][],
): void {
	const lastLine = lines - 2;
	for (let line = 0; line <= lastLine; line++) {
		let loRoom = NO_ROOM;
		let loStart = 0;
		let hiRoom = NO_ROOM;
		let hiStart = 0;
		for (let k = 0; k <= len; k++) {
			let edgeLo = NO_ROOM;
			let edgeHi = NO_ROOM;
			if (k < len) {
				const lo = classes[cellOf(line, k)];
				const hi = classes[cellOf(line + 1, k)];
				if (lo >= 0 && hi !== NOT_FLOOR && hi !== lo) edgeLo = lo;
				if (hi >= 0 && lo !== NOT_FLOOR && lo !== hi) edgeHi = hi;
			}
			if (edgeLo !== loRoom) {
				if (loRoom !== NO_ROOM) insertRun(perRoom[loRoom], { axis, line, sign: 1, start: loStart, stop: k });
				loRoom = edgeLo;
				loStart = k;
			}
			if (edgeHi !== hiRoom) {
				if (hiRoom !== NO_ROOM) insertRun(perRoom[hiRoom], { axis, line, sign: -1, start: hiStart, stop: k });
				hiRoom = edgeHi;
				hiStart = k;
			}
		}
	}
}

/**
 * Every room's edge to other floor: one unit edge on the shared side of each FLOOR cell with roomId r >= 0 and each
 * 4-neighbour FLOOR cell with roomId !== r (a corridor, or another room: then each room gets its own run), merged
 * per (room, axis, line, side) into runs that touch end to end. Non-FLOOR cells (walls, solid pillars, pools, void)
 * never make edges.
 */
export function roomEdges(d: Dungeon): RoomEdges {
	const W = d.W;
	const H = d.H;
	const roomCount = d.rooms.size();
	const classes = cellClasses(d);
	const perRoom: RunCells[][] = [];
	for (let r = 0; r < roomCount; r++) perRoom.push([]);
	// axis 0: lines of constant x between columns (across = column, along = row); axis 1: constant z between rows
	scanAxis(classes, 0, W, H, (gx, gy) => gy * W + gx, perRoom);
	scanAxis(classes, 1, H, W, (gy, gx) => gy * W + gx, perRoom);

	const runs: RoomEdgeRun[] = [];
	const byRoom: number[][] = [];
	let unitEdges = 0;
	for (let r = 0; r < roomCount; r++) {
		const ids: number[] = [];
		for (const c of perRoom[r]) {
			const across = gridToWorld(c.line) + HALF_TILE;
			const from = gridToWorld(c.start) - HALF_TILE;
			const to = gridToWorld(c.stop - 1) + HALF_TILE;
			ids.push(runs.size());
			runs.push(
				c.axis === 0
					? { room: r, x0: across, z0: from, x1: across, z1: to, nx: c.sign, nz: 0 }
					: { room: r, x0: from, z0: across, x1: to, z1: across, nx: 0, nz: c.sign },
			);
			unitEdges += c.stop - c.start;
		}
		byRoom.push(ids);
	}
	return { runs, byRoom, unitEdges };
}

/**
 * The drawn line of `run`: the run moved `insetTiles` along its normal (out of the room, into the corridor), written
 * to out[0..3] as x0, z0, x1, z1 (world units). With roomEdgeInsetTiles() the dash's inner edge lies on the boundary.
 */
export function roomEdgeLine(run: RoomEdgeRun, insetTiles: number, out: number[]): void {
	const ox = run.nx * insetTiles * TILE_SIZE;
	const oz = run.nz * insetTiles * TILE_SIZE;
	out[0] = run.x0 + ox;
	out[1] = run.z0 + oz;
	out[2] = run.x1 + ox;
	out[3] = run.z1 + oz;
}
