/**
 * The minimap tiles census (docs/MINIMAP.md M1), shared by tiles.spec.ts and its endless shards
 * (tiles.endless.<n>.spec.ts): checkMinimapFloor checks every MinimapTiles invariant of one floor; minimapCensus runs it
 * over endless run seeds x floors 1..MINIMAP_CENSUS.floors (run seed 1 through the full floor build, so the stairwell
 * is the layout's own). Test support only.
 */
import { TileType, endlessFloorParams, roomIdAt, type Dungeon } from "shared/dungeon";
import { endlessDungeon, endlessRunFloor } from "shared/run";
import { MAP_NO_CELL, MINIMAP_VIEW, MapTile, minimapTiles, type MinimapTiles } from "shared/view";

export const MINIMAP_CENSUS = { runs: 60, floors: 20, shards: 4 } as const;

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

export interface MinimapFloorStats {
	readonly W: number;
	readonly H: number;
	readonly maxRoomCells: number;
	readonly walls: number;
}

/** Every MinimapTiles invariant of `t` on `d` (fails with error() naming `label`), and the floor's numbers. */
export function checkMinimapFloor(d: Dungeon, t: MinimapTiles, label: string): MinimapFloorStats {
	const W = d.W;
	const H = d.H;
	if (t.W !== W || t.H !== H) error(`${label}: map ${t.W} x ${t.H}, floor ${W} x ${H}`);
	if (t.tile.size() !== W * H) error(`${label}: ${t.tile.size()} tiles`);
	if (t.room.size() !== W * H) error(`${label}: ${t.room.size()} room cells`);
	if (t.roomCells.size() !== d.rooms.size()) error(`${label}: ${t.roomCells.size()} room lists`);
	if (t.roomType.size() !== d.rooms.size()) error(`${label}: ${t.roomType.size()} room types`);
	if (t.bossRoom !== d.boss) error(`${label}: boss room ${t.bossRoom}, want ${d.boss}`);
	let walls = 0;
	for (let gy = 0; gy < H; gy++)
		for (let gx = 0; gx < W; gx++) {
			const i = gy * W + gx;
			const g = d.grid[i];
			let touches = false;
			for (const [dx, dy] of NEIGHBOURS_8) {
				const x = gx + dx;
				const y = gy + dy;
				if (x >= 0 && y >= 0 && x < W && y < H && isOpen(d.grid[y * W + x])) touches = true;
			}
			const want =
				g === TileType.FLOOR
					? MapTile.FLOOR
					: g === TileType.POOL
					? MapTile.POOL
					: g === TileType.WALL && touches
					? MapTile.WALL
					: MapTile.NONE;
			if (t.tile[i] !== want) error(`${label}: cell (${gx}, ${gy}) is ${t.tile[i]}, want ${want}`);
			if (want === MapTile.WALL) walls++;
			if (t.room[i] !== roomIdAt(d, gx, gy)) error(`${label}: room of (${gx}, ${gy}) differs from roomIdAt`);
		}
	// membership: each list ascending, every member open with that roomId or a WALL touching one of them
	const listedIn = new Map<number, number>();
	let maxRoomCells = 0;
	for (let r = 0; r < t.roomCells.size(); r++) {
		const list = t.roomCells[r];
		maxRoomCells = math.max(maxRoomCells, list.size());
		for (let k = 0; k < list.size(); k++) {
			const c = list[k];
			if (k > 0 && list[k - 1] >= c) error(`${label}: room ${r} cells out of order at ${k}`);
			const tile = t.tile[c];
			if (tile === MapTile.WALL) {
				const gx = c % W;
				const gy = math.floor(c / W);
				let ok = false;
				for (const [dx, dy] of NEIGHBOURS_8) {
					const x = gx + dx;
					const y = gy + dy;
					if (x < 0 || y < 0 || x >= W || y >= H) continue;
					const j = y * W + x;
					if (isOpen(d.grid[j]) && d.roomId[j] === r) ok = true;
				}
				if (!ok) error(`${label}: wall ${c} in room ${r} touches none of its cells`);
			} else if ((tile === MapTile.FLOOR || tile === MapTile.POOL) && d.roomId[c] === r) {
				listedIn.set(c, (listedIn.get(c) ?? 0) + 1);
			} else error(`${label}: cell ${c} (tile ${tile}) listed in room ${r}`);
		}
	}
	// every room FLOOR cell (the roomIdAt test) in exactly one list
	for (let i = 0; i < W * H; i++) {
		if (t.room[i] === MAP_NO_CELL) continue;
		const count = listedIn.get(i) ?? 0;
		if (count !== 1) error(`${label}: room floor cell ${i} listed ${count} times`);
	}
	return { W, H, maxRoomCells, walls };
}

export interface MinimapCensus {
	readonly floors: number;
	readonly maxW: number;
	readonly maxH: number;
	/** The largest W x H and where. */
	readonly worstArea: string;
	readonly maxRoom: number;
	readonly worstRoom: string;
}

/**
 * Every endless floor of run seeds firstRun..lastRun x floors 1..MINIMAP_CENSUS.floors through checkMinimapFloor; fails
 * with error() on a floor wider or deeper than MINIMAP_VIEW.maxImageSide, or (run seed 1) a stairwell off its room.
 */
export function minimapCensus(firstRun: number, lastRun: number): MinimapCensus {
	const side = MINIMAP_VIEW.maxImageSide;
	let floors = 0;
	let maxW = 0;
	let maxH = 0;
	let maxArea = 0;
	let worstArea = "";
	let maxRoom = 0;
	let worstRoom = "";
	for (let r = firstRun; r <= lastRun; r++)
		for (let floor = 1; floor <= MINIMAP_CENSUS.floors; floor++) {
			const d = endlessDungeon(endlessFloorParams(r, floor));
			const label = `endless ${r} / ${floor}`;
			// run 1: through the full floor build, so the stairwell is the layout's own
			const stairwell = r === 1 ? endlessRunFloor(r, floor).layout.stairwell : undefined;
			const t = minimapTiles(d, stairwell);
			const s = checkMinimapFloor(d, t, label);
			if (stairwell !== undefined) {
				if (t.stairCell === MAP_NO_CELL || t.tile[t.stairCell] !== MapTile.FLOOR)
					error(`${label}: stairwell cell ${t.stairCell} is not floor`);
				if (t.room[t.stairCell] !== d.boss) error(`${label}: stairwell outside the boss room`);
			}
			floors++;
			maxW = math.max(maxW, s.W);
			maxH = math.max(maxH, s.H);
			if (s.W * s.H > maxArea) {
				maxArea = s.W * s.H;
				worstArea = `${s.W} x ${s.H} (${label})`;
			}
			if (s.maxRoomCells > maxRoom) {
				maxRoom = s.maxRoomCells;
				worstRoom = label;
			}
			if (s.W > side || s.H > side) error(`${label}: ${s.W} x ${s.H} exceeds ${side}`);
		}
	return { floors, maxW, maxH, worstArea, maxRoom, worstRoom };
}

/** The census's printed line. */
export function minimapCensusLine(c: MinimapCensus, seconds: number): string {
	return (
		`[minimap] endless census: ${c.floors} floors, max W ${c.maxW}, max H ${c.maxH}, largest area ${c.worstArea}, ` +
		`max ${c.maxRoom} cells per room (${c.worstRoom}); ${string.format("%.1f", seconds)} s`
	);
}
