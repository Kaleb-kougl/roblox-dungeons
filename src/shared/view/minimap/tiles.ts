/**
 * Minimap tiles (docs/MINIMAP.md §1, task M1): the floor as the map draws it, built once per floor from the dungeon.
 * Pure: plain integer scanning of `Dungeon.grid` / `roomId`. Solid pillars are already WALL in the grid, so they draw as
 * walls (and block sight) with no special case; walls deep inside rock (no FLOOR / POOL 8-neighbour) are NONE, so the
 * map reads as outlines, not blocks. Roblox-port feature, no web source.
 *
 * Grid cell (gx, gy) is index gy * W + gx and covers world [gx - 0.5, gx + 0.5] x [gy - 0.5, gy + 0.5] tiles
 * (shared/dungeon collision.ts: x = grid x, z = grid y).
 *
 * @module
 */
import { TileType, worldToGrid, type Dungeon, type RoomType, type WorldXZ } from "shared/dungeon";

/** One map cell's kind. NONE: void, or a wall that touches no FLOOR / POOL (never drawn, blocks sight). */
export const MapTile = { NONE: 0, FLOOR: 1, WALL: 2, POOL: 3 } as const;
export type MapTile = (typeof MapTile)[keyof typeof MapTile];

/** No room / no cell. */
export const MAP_NO_CELL = -1;

export interface MinimapTiles {
	readonly W: number;
	readonly H: number;
	/** MapTile per cell, y * W + x. WALL only where the wall touches FLOOR / POOL (8-neighbour), else NONE. */
	readonly tile: ReadonlyArray<number>;
	/**
	 * Room id per cell exactly as `roomIdAt` (shared/dungeon endless.ts) reports it at the cell's centre: the dungeon's
	 * roomId on FLOOR cells (when it is a valid room index), MAP_NO_CELL everywhere else (corridors, pools, walls, void).
	 * The fog's "a source stands in a room" test and the paint's room tint read it.
	 */
	readonly room: ReadonlyArray<number>;
	/**
	 * Cell indices per room id: the FLOOR / POOL cells whose dungeon roomId is that room, plus their wall ring (every
	 * MapTile.WALL cell 8-adjacent to one of them; a wall between two rooms is in both lists), ascending cell index.
	 */
	readonly roomCells: ReadonlyArray<ReadonlyArray<number>>;
	/** Room type per room id (marks for treasure / shrine). */
	readonly roomType: ReadonlyArray<RoomType>;
	/** The boss room's id (`Dungeon.boss`, the encounter's bossRoom), for the fog's late attach. */
	readonly bossRoom: number;
	/** The stairwell's cell (endless; from `EndlessFloorLayout.stairwell`), MAP_NO_CELL without one or off the grid. */
	readonly stairCell: number;
}

/** The 8 neighbours (dx, dy), fixed order. */
const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
	[-1, -1],
	[0, -1],
	[1, -1],
	[-1, 0],
	[1, 0],
	[-1, 1],
	[0, 1],
	[1, 1],
];

function isOpen(t: number | undefined): boolean {
	return t === TileType.FLOOR || t === TileType.POOL;
}

/**
 * The map tiles of `d` (see MinimapTiles); `stairwell` is the endless floor's stairwell (world), absent on M1 and other
 * floors without one.
 */
export function minimapTiles(d: Dungeon, stairwell?: WorldXZ): MinimapTiles {
	const W = d.W;
	const H = d.H;
	const n = W * H;
	const roomCount = d.rooms.size();
	const grid = d.grid;

	// The dungeon room of an open (FLOOR / POOL) cell, or MAP_NO_CELL.
	const openRoom: number[] = [];
	const room: number[] = [];
	for (let i = 0; i < n; i++) {
		const t = grid[i];
		const id = d.roomId[i];
		const valid = id !== undefined && id >= 0 && id < roomCount;
		openRoom.push(isOpen(t) && valid ? id : MAP_NO_CELL);
		room.push(t === TileType.FLOOR && valid ? id : MAP_NO_CELL);
	}

	const roomCells: number[][] = [];
	for (let r = 0; r < roomCount; r++) roomCells.push([]);
	const tile: number[] = [];
	// Distinct rooms around one wall cell (at most 8).
	const around: number[] = [];
	for (let gy = 0; gy < H; gy++) {
		for (let gx = 0; gx < W; gx++) {
			const i = gy * W + gx;
			const t = grid[i];
			if (t === TileType.FLOOR || t === TileType.POOL) {
				tile.push(t === TileType.FLOOR ? MapTile.FLOOR : MapTile.POOL);
				const r = openRoom[i];
				if (r !== MAP_NO_CELL) roomCells[r].push(i);
				continue;
			}
			if (t !== TileType.WALL) {
				tile.push(MapTile.NONE);
				continue;
			}
			let touches = false;
			around.clear();
			for (const [dx, dy] of NEIGHBOURS_8) {
				const x = gx + dx;
				const y = gy + dy;
				if (x < 0 || y < 0 || x >= W || y >= H) continue;
				const j = y * W + x;
				if (!isOpen(grid[j])) continue;
				touches = true;
				const r = openRoom[j];
				if (r !== MAP_NO_CELL && !around.includes(r)) around.push(r);
			}
			tile.push(touches ? MapTile.WALL : MapTile.NONE);
			for (const r of around) roomCells[r].push(i);
		}
	}

	const roomType: RoomType[] = [];
	for (const r of d.rooms) roomType.push(r.type);

	let stairCell = MAP_NO_CELL;
	if (stairwell !== undefined) {
		const sx = worldToGrid(stairwell.x);
		const sy = worldToGrid(stairwell.z);
		if (sx >= 0 && sy >= 0 && sx < W && sy < H) stairCell = sy * W + sx;
	}
	return { W, H, tile, room, roomCells, roomType, bossRoom: d.boss, stairCell };
}
