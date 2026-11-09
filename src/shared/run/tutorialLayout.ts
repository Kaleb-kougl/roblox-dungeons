/**
 * Floor-1 layout walks for the tutorial world (docs/TUTORIAL.md "Architecture §2"; a Roblox-port feature, no web
 * source). Pure graph and tile walks over a Dungeon Forge floor:
 *
 *   - shared/run tutorial.ts walks the lesson order with tutorialTour, which gives every lesson room the door the
 *     player arrives through (the world marker's target, and what the spawns are placed away from);
 *   - checkTutorialChain proves the chain floor is what the lessons need: one corridor between each lesson room and
 *     the next and nothing else, every room's floor one region with its door, centre and spawn tiles on it. The lock
 *     spec (tutorial.spec.ts) asserts it finds no problem, so a Forge change that breaks the lessons fails loudly;
 *   - scripts/find-tutorial-seed.js (via scripts/lune/find-tutorial-seed.luau) lists the seeds (theme and
 *     decoration) the chain works with, and scores small floor-2 boss floors with tutorialTour.
 *
 * The tour is the order the player is led through: the entrance, the six combat lessons (A-D, F, G), the treasure room, the
 * shrine, then the boss room (which holds the open stairwell on a non-boss floor). Each leg is the shortest walk over
 * FLOOR tiles (4-neighbour BFS) from one room's centre floor tile to the next; a leg that walks through a later tour
 * room would spawn that room's enemies (and show its prompt) early ("early" rooms; a chain floor has none).
 *
 * Tutorial floors are endless floors (tutorialForgeParams): pillars are solid WALL cells, so the walks go round them.
 */
import {
	EncounterRng,
	TileType,
	encounterRoomSeed,
	encounterRooms,
	gridToWorld,
	roomFloorTiles,
	roomSpawnTiles,
	tileAt,
	worldToGrid,
	type Dungeon,
	type EncounterRoom,
	type RoomTools,
	type TileXZ,
} from "shared/dungeon";

/** One walk of the tour: from rooms[i] to rooms[i + 1]. */
export interface TutorialLeg {
	readonly from: number;
	readonly to: number;
	/** Steps walked (BFS tiles), -1 when unreachable. */
	readonly tiles: number;
	/** The last tile outside `to` on the walk (world tile centre): the doorway the player comes in by. */
	readonly door: TileXZ;
	/** Tour rooms after `to` (or `to`'s later legs) that the walk passes through first (room ids, walk order). */
	readonly early: ReadonlyArray<number>;
}

export interface TutorialTour {
	/** Room ids in tour order. */
	readonly rooms: ReadonlyArray<number>;
	/** rooms.size() - 1 legs. */
	readonly legs: ReadonlyArray<TutorialLeg>;
	/** Sum of the legs' tiles (-1 if any leg is unreachable). */
	readonly tiles: number;
	/** Total early rooms over all legs. */
	readonly earlyRooms: number;
}

/** The RoomTools placeEncounter would hand `room` (its own encounter rng; roomSpawnTiles draws nothing from it). */
export function tutorialRoomTools(d: Dungeon, room: EncounterRoom): RoomTools {
	let tiles: TileXZ[] | undefined;
	return {
		dungeon: d,
		rng: new EncounterRng(encounterRoomSeed(d.seed, room.id)),
		floor() {
			if (!tiles) tiles = roomFloorTiles(d, room.id);
			return tiles;
		},
		center() {
			return { x: room.cx, z: room.cz };
		},
	};
}

interface Bfs {
	readonly dist: number[];
	readonly parent: number[];
}

/** 4-neighbour BFS over FLOOR tiles from grid cell `start` (index y * W + x). */
function floorBfs(d: Dungeon, start: number): Bfs {
	const n = d.W * d.H;
	const dist = new Array<number>(n, -1);
	const parent = new Array<number>(n, -1);
	const queue = [start];
	dist[start] = 0;
	let head = 0;
	const offsets = [1, -1, d.W, -d.W];
	while (head < queue.size()) {
		const at = queue[head++];
		const ax = at % d.W;
		const ay = (at - ax) / d.W;
		for (const off of offsets) {
			const nb = at + off;
			const nx = ax + (off === 1 ? 1 : off === -1 ? -1 : 0);
			const ny = ay + (off === d.W ? 1 : off === -d.W ? -1 : 0);
			if (tileAt(d, nx, ny) !== TileType.FLOOR || dist[nb] >= 0) continue;
			dist[nb] = dist[at] + 1;
			parent[nb] = at;
			queue.push(nb);
		}
	}
	return { dist, parent };
}

/** Grid cell index of each room's centre floor tile (encounterRooms' cx / cz). */
function roomCells(d: Dungeon): number[] {
	return encounterRooms(d).map((r) => worldToGrid(r.cz) * d.W + worldToGrid(r.cx));
}

function cellWorld(d: Dungeon, cell: number): TileXZ {
	const gx = cell % d.W;
	return { x: gridToWorld(gx), z: gridToWorld((cell - gx) / d.W) };
}

/**
 * Walks `order` (room ids) leg by leg (see the file comment). Pure; a few BFS passes over the grid, so callers that
 * need it at run time cache the result.
 */
export function tutorialTour(d: Dungeon, order: ReadonlyArray<number>): TutorialTour {
	const cells = roomCells(d);
	const legs: TutorialLeg[] = [];
	let total = 0;
	let early = 0;
	const lastLeg = order.size() - 1;
	for (let i = 0; i < lastLeg; i++) {
		const from = order[i];
		const to = order[i + 1];
		const bfs = floorBfs(d, cells[from]);
		const goal = cells[to];
		const tiles = bfs.dist[goal];
		// The walk from the goal back to the start, then forwards: rooms entered and the door into `to`.
		const walk: number[] = [];
		for (let c = goal; c >= 0; c = bfs.parent[c]) walk.push(c);
		const later = new Set<number>();
		for (let k = i + 2; k < order.size(); k++) later.add(order[k]);
		const seen: number[] = [];
		let door = cellWorld(d, cells[to]);
		let outside = true;
		for (let k = walk.size() - 1; k >= 0; k--) {
			const cell = walk[k];
			const id = d.roomId[cell];
			if (id === to) {
				if (outside && k + 1 < walk.size()) door = cellWorld(d, walk[k + 1]);
				outside = false;
				continue;
			}
			if (id >= 0 && later.has(id) && !seen.includes(id)) seen.push(id);
		}
		legs.push({ from, to, tiles, door, early: seen });
		total = tiles < 0 || total < 0 ? -1 : total + tiles;
		early += seen.size();
	}
	return { rooms: [...order], legs, tiles: total, earlyRooms: early };
}

// ---------------------------------------------------------------------------------------------
// The chain check

/** One corridor of the floor: a 4-connected region of corridor floor (FLOOR cells outside every room). */
export interface TutorialCorridor {
	/** Room ids whose floor it touches (4-neighbours), ascending. */
	readonly rooms: ReadonlyArray<number>;
	/** Its FLOOR cells. */
	readonly cells: number;
	/** Its length: the longer side of its bounding box, in tiles. */
	readonly length: number;
}

export interface TutorialChainReport {
	/** Empty when the floor is a strict chain in `order` (see checkTutorialChain). */
	readonly problems: ReadonlyArray<string>;
	/** Every corridor region, in grid row order of its first cell. */
	readonly corridors: ReadonlyArray<TutorialCorridor>;
	/** Per tour leg (order[i] -> order[i + 1]): the length of the one corridor between them (-1 when not exactly one). */
	readonly legCorridors: ReadonlyArray<number>;
	/** The tour over `order` (tutorialTour). */
	readonly tour: TutorialTour;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

function isFloor(d: Dungeon, gx: number, gy: number): boolean {
	return tileAt(d, gx, gy) === TileType.FLOOR;
}

/** The 4-connected regions of the cells `inside(gx, gy)` accepts (each region a list of cell indices). */
function regions(d: Dungeon, inside: (gx: number, gy: number) => boolean): number[][] {
	const seen = new Array<boolean>(d.W * d.H, false);
	const out: number[][] = [];
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			const c0 = gy * d.W + gx;
			if (seen[c0] || !inside(gx, gy)) continue;
			seen[c0] = true;
			const cells = [c0];
			let head = 0;
			while (head < cells.size()) {
				const c = cells[head++];
				const cx = c % d.W;
				const cy = (c - cx) / d.W;
				for (const [ox, oy] of NEIGHBOURS) {
					const nx = cx + ox;
					const ny = cy + oy;
					if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
					const n = ny * d.W + nx;
					if (seen[n] || !inside(nx, ny)) continue;
					seen[n] = true;
					cells.push(n);
				}
			}
			out.push(cells);
		}
	return out;
}

/**
 * Checks that `d` is a strict chain of lesson rooms in `order` (room ids), the tutorial's floor-1 contract:
 *
 *   rooms      exactly `order` (every room once, no other room) and no FLOOR cell of a room 4-touches another room's;
 *   corridors  exactly one corridor region per consecutive pair (order[i], order[i + 1]), touching those two rooms
 *              and no other (so no loop, no side corridor or dead end, and room i's exits lead only to i - 1 and
 *              i + 1); the Forge graph agrees (one non-loop edge per pair, no other edge);
 *   floor      each room's walkable floor (FLOOR cells of the room: solid pillars and pits are not) is ONE 4-connected
 *              region, its centre tile on it, and it holds every spawn tile (roomSpawnTiles), reached from the door
 *              the tour comes in by (every room but the first) and from the door it leaves by (every room but the last).
 *
 * Pure; `problems` is empty when all of it holds.
 */
export function checkTutorialChain(d: Dungeon, order: ReadonlyArray<number>): TutorialChainReport {
	const problems: string[] = [];
	const n = order.size();
	const rooms = encounterRooms(d);
	if (rooms.size() !== n) problems.push(`${rooms.size()} rooms, the chain has ${n}`);
	const pos = new Map<number, number>();
	for (let i = 0; i < n; i++) {
		if (pos.has(order[i]) || rooms[order[i]] === undefined)
			problems.push(`order: bad or repeated room ${order[i]}`);
		pos.set(order[i], i);
	}

	// Rooms never touch each other directly.
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			const id = d.roomId[gy * d.W + gx];
			if (id < 0 || !isFloor(d, gx, gy)) continue;
			for (const [ox, oy] of NEIGHBOURS) {
				const nx = gx + ox;
				const ny = gy + oy;
				if (!isFloor(d, nx, ny)) continue;
				const other = d.roomId[ny * d.W + nx];
				if (other >= 0 && other !== id) problems.push(`room ${id} touches room ${other} at (${gx}, ${gy})`);
			}
		}

	// Corridor regions and the rooms each one touches.
	const corridors: TutorialCorridor[] = [];
	const legCorridors: number[] = [];
	const perLeg: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		legCorridors.push(-1);
		perLeg.push(0);
	}
	const corridorCell = (gx: number, gy: number) => d.roomId[gy * d.W + gx] < 0 && isFloor(d, gx, gy);
	for (const cells of regions(d, corridorCell)) {
		const touched: number[] = [];
		let x0 = math.huge;
		let x1 = -math.huge;
		let y0 = math.huge;
		let y1 = -math.huge;
		for (const c of cells) {
			const gx = c % d.W;
			const gy = (c - gx) / d.W;
			x0 = math.min(x0, gx);
			x1 = math.max(x1, gx);
			y0 = math.min(y0, gy);
			y1 = math.max(y1, gy);
			for (const [ox, oy] of NEIGHBOURS) {
				if (!isFloor(d, gx + ox, gy + oy)) continue;
				const id = d.roomId[(gy + oy) * d.W + gx + ox];
				if (id >= 0 && !touched.includes(id)) touched.push(id);
			}
		}
		touched.sort();
		const length = math.max(x1 - x0, y1 - y0) + 1;
		corridors.push({ rooms: touched, cells: cells.size(), length });
		const a = touched.size() === 2 ? pos.get(touched[0]) : undefined;
		const b = touched.size() === 2 ? pos.get(touched[1]) : undefined;
		if (a === undefined || b === undefined || math.abs(a - b) !== 1) {
			problems.push(`a corridor joins rooms [${touched.join(", ")}], not two neighbours of the chain`);
			continue;
		}
		const leg = math.min(a, b);
		perLeg[leg] += 1;
		legCorridors[leg] = length;
	}
	for (let i = 0; i < n - 1; i++) {
		if (perLeg[i] !== 1) {
			problems.push(`${perLeg[i]} corridors between rooms ${order[i]} and ${order[i + 1]}`);
			legCorridors[i] = -1;
		}
	}
	// The Forge's own graph says the same: one edge per neighbour pair, nothing else.
	if (d.edges.size() !== n - 1) problems.push(`${d.edges.size()} Forge edges, the chain has ${n - 1}`);
	for (const e of d.edges) {
		const a = pos.get(e.a);
		const b = pos.get(e.b);
		if (e.isLoop || a === undefined || b === undefined || math.abs(a - b) !== 1) {
			problems.push(`Forge edge ${e.a}-${e.b} is not a chain link`);
		}
	}

	// Every room's floor: one region holding its centre, its spawn tiles and both doors.
	const tour = tutorialTour(d, order);
	for (let i = 0; i < n; i++) {
		const room = rooms[order[i]];
		if (room === undefined) continue;
		const id = room.id;
		const floorRegions = regions(d, (gx, gy) => d.roomId[gy * d.W + gx] === id && isFloor(d, gx, gy));
		if (floorRegions.size() !== 1) {
			problems.push(`room ${id}: its floor is ${floorRegions.size()} regions`);
			continue;
		}
		const region = new Set<number>(floorRegions[0]);
		const onFloor = (x: number, z: number) => region.has(worldToGrid(z) * d.W + worldToGrid(x));
		if (!onFloor(room.cx, room.cz)) problems.push(`room ${id}: the centre tile is not on its floor`);
		for (const t of roomSpawnTiles(d, room, tutorialRoomTools(d, room)))
			if (!onFloor(t.x, t.z)) problems.push(`room ${id}: spawn tile (${t.x}, ${t.z}) is off its floor`);
		// The doors: the tour's corridor tile into this room, and the next leg's last tile in it (its way out).
		const doors: TileXZ[] = [];
		if (i > 0) doors.push(tour.legs[i - 1].door);
		if (i < n - 1) doors.push(exitDoor(d, tour.legs[i].door, id) ?? { x: room.cx, z: room.cz });
		for (const door of doors) {
			const gx = worldToGrid(door.x);
			const gy = worldToGrid(door.z);
			let touches = region.has(gy * d.W + gx);
			for (const [ox, oy] of NEIGHBOURS) if (region.has((gy + oy) * d.W + gx + ox)) touches = true;
			if (!touches) problems.push(`room ${id}: the door at (${door.x}, ${door.z}) does not reach its floor`);
		}
	}
	for (const leg of tour.legs) if (leg.tiles < 0) problems.push(`no walk from room ${leg.from} to ${leg.to}`);
	if (tour.earlyRooms > 0) problems.push(`${tour.earlyRooms} tour room(s) walked through early`);
	return { problems, corridors, legCorridors, tour };
}

/**
 * The corridor tile next to room `roomId` on the corridor that holds `door` (the next room's way in), or undefined:
 * a corridor cell of door's corridor region that 4-touches roomId's floor.
 */
function exitDoor(d: Dungeon, door: TileXZ, roomId: number): TileXZ | undefined {
	const start = worldToGrid(door.z) * d.W + worldToGrid(door.x);
	const corridorCell = (gx: number, gy: number) => d.roomId[gy * d.W + gx] < 0 && isFloor(d, gx, gy);
	for (const cells of regions(d, corridorCell)) {
		if (!cells.includes(start)) continue;
		for (const c of cells) {
			const gx = c % d.W;
			const gy = (c - gx) / d.W;
			for (const [ox, oy] of NEIGHBOURS) {
				if (!isFloor(d, gx + ox, gy + oy)) continue;
				if (d.roomId[(gy + oy) * d.W + gx + ox] === roomId) return { x: gridToWorld(gx), z: gridToWorld(gy) };
			}
		}
	}
	return undefined;
}
