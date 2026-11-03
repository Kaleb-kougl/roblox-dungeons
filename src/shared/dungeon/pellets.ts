/**
 * Pellets (docs/PELLETS.md PL1, decisions PD4 / PD5 / PD9; a Roblox-port feature, no web source): where an endless
 * floor's pellets lie, and which one (rarely) is the power pellet. Decided when the floor is built, a PURE function of
 * the floor like the rest of ./endless.ts, so live play, every co-op client, the server's replay and a daily seed see
 * the same pellets and the sim draws no rng for them.
 *
 *   stream   its own: new EncounterRng(pelletSeed(floor seed)) = mulberry32 from (seed ^ PELLETS.salt), run LAST in
 *            the floor build; it only reads the layout, the room spawns, the entrance and the placed breakables, so
 *            the layout, digest, props, spawns, pieces, affixes, loot and boss pick never move.
 *   rooms    every encounter room with deferred enemies (roomSpawns[id] not empty: exactly the rooms that get a score
 *            record; never the entrance, treasure, shrine or boss room, PD9), in room id order. Per room TWO draws:
 *            the pattern rng.int(0, patterns - 1) over PELLETS.patterns, then the inset rng.int(its insetTiles).
 *   cells    pelletPatternCells: the pattern's path over the room's floor rectangle (the bounding box of its own FLOOR
 *            cells) shrunk by the inset, one cell every (its) spacingTiles along the path; a cell is kept when it is a FLOOR
 *            cell of THAT room (pillars, pits, walls and corridor cells drop out), not a breakable's cell, not a
 *            planned spawn's cell, and reachable (4-neighbour BFS over FLOOR minus the breakables' cells from the
 *            entrance spawn); fewer than minPerRoom kept: the room gets none; more than maxPerRoom: trimmed evenly
 *            along the path.
 *   power    from power.fromFloor, when some room got pellets: ONE draw rng.int(0, 99) < chancePercent; on a hit ONE
 *            draw for the room (among the rooms that got pellets, id order) and ONE for which of its pellets (path
 *            order) becomes the power pellet. At most one per floor (PD4).
 *   draws    2 per room with enemies, + (floor >= fromFloor and any pellets ? 1 + (hit ? 2 : 0) : 0).
 *
 * Patterns (inset rectangle x0..x1 by y0..y1 in grid cells; the long axis is x when x1 - x0 >= y1 - y0, else y):
 *   ring     the rectangle's outline, clockwise from its top-left corner (top row, right column, bottom row, left
 *            column); every spacingTiles-th cell of that path
 *   cross    the centre row then the centre column (centre = floor((lo + hi) / 2)), on the cells a multiple of
 *            spacingTiles from the centre (the centre once)
 *   lanes    lines along the long axis: n = floor(short span / laneGapTiles) + 1 of them, spread evenly from one
 *            inset edge to the other (one lane: the centre line), snaking (odd lanes run backwards), every
 *            spacingTiles-th cell from the low end
 *   zigzag   a diagonal bouncing between the two short-axis inset edges while it advances along the long axis one cell
 *            per step; every spacingTiles-th step
 *
 * Output: FloorPellets, pellets in (room id, path) order, world tile centres.
 */
import { u32 } from "shared/jsmath";
import { TileType, type Dungeon } from "./forge";
import { TILE_SIZE, cellKey, gridToWorld, tileAt, worldToGrid } from "./collision";
import { EncounterRng, type TileXZ } from "./encounter";
import type { EncounterRoom } from "./encounterTypes";
import type { BreakableFloorInput, BreakablePlacement } from "./breakables";
import { PELLETS, PELLET_CHANCE_RANGE, pelletPatternDef, type PelletPattern } from "./pelletsData";

/** FloorPellets.power when the floor has no power pellet. */
export const NO_POWER_PELLET = -1;

/** One floor's pellets, as data (EndlessFloorLayout / EndlessFloorWorld.pellets). Never mutated. */
export interface FloorPellets {
	/** Every pellet's world tile centre, in (room id, path) order. */
	readonly tiles: ReadonlyArray<TileXZ>;
	/** The encounter room id of each pellet (same index as `tiles`, ascending). */
	readonly room: ReadonlyArray<number>;
	/** Index into `tiles` of the power pellet, or NO_POWER_PELLET. */
	readonly power: number;
}

/** A floor with no pellets. */
export const NO_PELLETS: FloorPellets = table.freeze({
	tiles: table.freeze([] as TileXZ[]),
	room: table.freeze([] as number[]),
	power: NO_POWER_PELLET,
});

/** Seed of the pellet stream: the floor seed with PELLETS.salt mixed in (uint32). */
export function pelletSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), PELLETS.salt);
}

/** Grid cell (gx, gy) of a path. */
type Cell = readonly [number, number];

/** The first value >= lo on the grid anchor + k x step (k any integer). */
function firstOnGrid(lo: number, anchor: number, step: number): number {
	return anchor - step * math.floor((anchor - lo) / step);
}

/** A triangle wave: t = 0..span climbs 0..span, then back down, period 2 span (span 0: always 0). */
function bounce(t: number, span: number): number {
	if (span <= 0) return 0;
	const m = t % (2 * span);
	return m <= span ? m : 2 * span - m;
}

/**
 * The path of `pattern` over the inset rectangle x0..x1 by y0..y1 (grid cells, both inclusive; see the file comment),
 * already thinned to one cell every `spacing`. Empty when the rectangle is (x0 > x1 or y0 > y1). Pure geometry: reads
 * no grid. Cells are distinct.
 */
export function pelletPatternPath(
	pattern: PelletPattern,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	spacing: number = pelletPatternDef(pattern).spacingTiles,
	laneGap: number = PELLETS.laneGapTiles,
): Cell[] {
	const out: Cell[] = [];
	if (x0 > x1 || y0 > y1) return out;
	const alongX = x1 - x0 >= y1 - y0;
	// (a, b): a along the long axis, b across it.
	const a0 = alongX ? x0 : y0;
	const a1 = alongX ? x1 : y1;
	const b0 = alongX ? y0 : x0;
	const b1 = alongX ? y1 : x1;
	const cell = (a: number, b: number): Cell => (alongX ? [a, b] : [b, a]);
	if (pattern === "ring") {
		const path: Cell[] = [];
		for (let x = x0; x <= x1; x++) path.push([x, y0]);
		for (let y = y0 + 1; y <= y1; y++) path.push([x1, y]);
		if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) path.push([x, y1]);
		if (x1 > x0) for (let y = y1 - 1; y > y0; y--) path.push([x0, y]);
		for (let k = 0; k < path.size(); k++) if (k % spacing === 0) out.push(path[k]);
	} else if (pattern === "cross") {
		const cx = math.floor((x0 + x1) / 2);
		const cy = math.floor((y0 + y1) / 2);
		for (let x = firstOnGrid(x0, cx, spacing); x <= x1; x += spacing) out.push([x, cy]);
		for (let y = firstOnGrid(y0, cy, spacing); y <= y1; y += spacing) if (y !== cy) out.push([cx, y]);
	} else if (pattern === "lanes") {
		const span = b1 - b0;
		const n = math.floor(span / laneGap) + 1;
		for (let k = 0; k < n; k++) {
			const b = n === 1 ? math.floor((b0 + b1) / 2) : b0 + math.floor((k * span) / (n - 1));
			const lane: Cell[] = [];
			for (let a = a0; a <= a1; a += spacing) lane.push(cell(a, b));
			if (k % 2 === 0) for (const c of lane) out.push(c);
			else for (let i = lane.size() - 1; i >= 0; i--) out.push(lane[i]);
		}
	} else {
		const span = b1 - b0;
		for (let a = a0; a <= a1; a += spacing) out.push(cell(a, b0 + bounce(a - a0, span)));
	}
	return out;
}

/** The grid rectangle of `room`'s own FLOOR cells (its EncounterRoom bounds), as [x0, y0, x1, y1]. */
export function roomGridRect(room: Readonly<EncounterRoom>): [number, number, number, number] {
	const half = TILE_SIZE / 2;
	return [
		worldToGrid(room.minX + half),
		worldToGrid(room.minZ + half),
		worldToGrid(room.maxX - half),
		worldToGrid(room.maxZ - half),
	];
}

/**
 * One room's pellet cells for `pattern` at `insetTiles` (see the file comment): the pattern's path (its def's
 * spacingTiles) over the room's floor rectangle shrunk by the inset, keeping the FLOOR cells of `room` for which `usable(gx, gy)` (optional) holds,
 * trimmed evenly along the path to at most `maxCount`. World tile centres, path order. No minimum, no rng: placePellets
 * applies minPerRoom; the tutorial (docs/PELLETS.md PL11) lays one room's pattern with its own cap. Pure.
 */
export function pelletPatternCells(
	d: Dungeon,
	room: Readonly<EncounterRoom>,
	pattern: PelletPattern,
	insetTiles: number,
	maxCount: number = PELLETS.maxPerRoom,
	usable?: (gx: number, gy: number) => boolean,
): TileXZ[] {
	const [rx0, ry0, rx1, ry1] = roomGridRect(room);
	const path = pelletPatternPath(pattern, rx0 + insetTiles, ry0 + insetTiles, rx1 - insetTiles, ry1 - insetTiles);
	const kept: TileXZ[] = [];
	for (const [gx, gy] of path) {
		if (tileAt(d, gx, gy) !== TileType.FLOOR || d.roomId[gy * d.W + gx] !== room.id) continue;
		if (usable !== undefined && !usable(gx, gy)) continue;
		kept.push({ x: gridToWorld(gx), z: gridToWorld(gy) });
	}
	const n = kept.size();
	if (n <= maxCount) return kept;
	const out: TileXZ[] = [];
	for (let j = 0; j < maxCount; j++) out.push(kept[math.floor((j * n) / maxCount)]);
	return out;
}

const DIRS4: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

/**
 * Cells reachable on foot from world (x, z): a 4-neighbour BFS over FLOOR cells that are not in `solid` (cellKey).
 * Indexed y * W + x. Pure.
 */
export function reachableFloor(d: Dungeon, x: number, z: number, solid: ReadonlySet<number>): boolean[] {
	const seen = new Array<boolean>(d.W * d.H, false);
	const gx = worldToGrid(x);
	const gy = worldToGrid(z);
	if (tileAt(d, gx, gy) !== TileType.FLOOR || solid.has(cellKey(gx, gy))) return seen;
	const qx: number[] = [gx];
	const qy: number[] = [gy];
	seen[gy * d.W + gx] = true;
	let head = 0;
	while (head < qx.size()) {
		const cx = qx[head];
		const cy = qy[head];
		head++;
		for (const [dx, dy] of DIRS4) {
			const nx = cx + dx;
			const ny = cy + dy;
			if (tileAt(d, nx, ny) !== TileType.FLOOR) continue;
			const i = ny * d.W + nx;
			if (seen[i] || solid.has(cellKey(nx, ny))) continue;
			seen[i] = true;
			qx.push(nx);
			qy.push(ny);
		}
	}
	return seen;
}

/**
 * Every pellet of the built endless floor `input` (floor `floor`, its placed breakables `pieces`): see the file
 * comment. Pure and deterministic: the same floor always gets the same pellets, in the same order.
 */
export function placePellets(
	input: BreakableFloorInput,
	floor: number,
	pieces: ReadonlyArray<BreakablePlacement>,
): FloorPellets {
	const d = input.dungeon;
	const rng = new EncounterRng(pelletSeed(input.seed));
	const solid = new Set<number>();
	for (const b of pieces) solid.add(cellKey(b.x, b.y));
	const spawnCells = new Set<number>();
	for (const list of input.roomSpawns)
		for (const s of list) spawnCells.add(cellKey(worldToGrid(s.x), worldToGrid(s.z)));
	const reach = reachableFloor(d, input.spawn.x, input.spawn.z, solid);
	const usable = (gx: number, gy: number) =>
		reach[gy * d.W + gx] && !solid.has(cellKey(gx, gy)) && !spawnCells.has(cellKey(gx, gy));
	const tiles: TileXZ[] = [];
	const rooms: number[] = [];
	const firsts: number[] = [];
	const counts: number[] = [];
	for (const room of input.encounter.rooms) {
		const spawns = input.roomSpawns[room.id];
		if (spawns === undefined || spawns.size() === 0) continue;
		const def = PELLETS.patterns[rng.int(0, PELLETS.patterns.size() - 1)];
		const inset = rng.int(def.insetTiles[0], def.insetTiles[1]);
		const cells = pelletPatternCells(d, room, def.pattern, inset, PELLETS.maxPerRoom, usable);
		if (cells.size() < PELLETS.minPerRoom) continue;
		firsts.push(tiles.size());
		counts.push(cells.size());
		for (const c of cells) {
			tiles.push(c);
			rooms.push(room.id);
		}
	}
	let power = NO_POWER_PELLET;
	if (floor >= PELLETS.power.fromFloor && firsts.size() > 0) {
		if (rng.int(0, PELLET_CHANCE_RANGE - 1) < PELLETS.power.chancePercent) {
			const r = rng.int(0, firsts.size() - 1);
			power = firsts[r] + rng.int(0, counts[r] - 1);
		}
	}
	return { tiles, room: rooms, power };
}
