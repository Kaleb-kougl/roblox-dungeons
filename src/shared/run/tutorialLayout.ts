/**
 * Floor-1 layout analysis for the tutorial world (docs/TUTORIAL.md "Architecture §2"; a Roblox-port feature, no web
 * source). Pure graph and tile walks over a Dungeon Forge floor, used three ways:
 *
 *   - scripts/find-tutorial-seed.js (via scripts/lune/find-tutorial-seed.luau) scores candidate seeds with
 *     analyzeTutorialLayout and prints the best ones;
 *   - shared/run tutorial.ts walks the chosen room order with tutorialTour, which gives every lesson room the door
 *     the player arrives through (the world marker's target, and what the spawns are placed away from);
 *   - tutorial.spec.ts re-runs the analysis on the locked seed, so a Forge change that breaks the lessons fails loudly.
 *
 * The tour is the order the player is led through: the entrance, the six combat lessons, the treasure room, the
 * shrine, then the boss room (which holds the open stairwell on a non-boss floor). Each leg is the shortest walk over
 * FLOOR tiles (4-neighbour BFS) from one room's centre floor tile to the next; a leg that walks through a later tour
 * room would spawn that room's enemies (and show its prompt) early, so a good layout has none ("early" rooms).
 *
 * Tutorial floors are endless floors (tutorialForgeParams): pillars are solid WALL cells, so the BFS walks round them,
 * and lesson E's turret sniper stands behind one when the room allows it (coverTiles; the analysis prefers layouts
 * where it does).
 */
import { stableSort } from "shared/jsmath";
import {
	EncounterRng,
	TileType,
	bulletBlocker,
	encounterRoomSeed,
	encounterRooms,
	gridToWorld,
	lineOfSight,
	roomFloorTiles,
	roomSpawnTiles,
	tileAt,
	worldToGrid,
	type Dungeon,
	type EncounterRoom,
	type RoomTools,
	type TileXZ,
} from "shared/dungeon";

/** Combat lessons on floor 1 (docs/TUTORIAL.md lessons 3-8: combat A-F). */
export const TUTORIAL_COMBAT_LESSONS = 6;

/** Score penalty (in walked tiles) per room the tour never visits (a side room to wander into). */
export const LAYOUT_EXTRA_ROOM_PENALTY = 40;
/** Score penalty per loop corridor (more ways round = more ways to skip a lesson room). */
export const LAYOUT_LOOP_PENALTY = 30;
/** Score penalty per tour room a leg walks through before its turn. */
export const LAYOUT_EARLY_ROOM_PENALTY = 200;
/** Score penalty when the shrine comes before the treasure room (the lesson table teaches the pedestal first). */
export const LAYOUT_SHRINE_FIRST_PENALTY = 25;
/** Score penalty when lesson E's room has no cover tile (coverTiles) seen from its door. */
export const LAYOUT_NO_COVER_PENALTY = 60;
/** Lesson E (the turret sniper "behind cover", docs/TUTORIAL.md lesson 7): its index among the combat lessons. */
export const TUTORIAL_COVER_LESSON = 4;
/**
 * A cover tile has a solid pillar at most this many tiles away (Chebyshev). Spawn tiles keep 8 FLOOR neighbours
 * (roomSpawnTiles), so the nearest a spawn can stand to a pillar is 2: one free tile between them.
 */
export const COVER_PILLAR_TILES = 2;

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

/** Grid cells of the solid pillars standing in room `roomId` (pillar props whose cell is WALL), as [gx, gy]. */
function roomPillars(d: Dungeon, roomId: number): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (const pr of d.props) {
		if (pr.kind !== "pillar") continue;
		if (tileAt(d, pr.x, pr.y) !== TileType.WALL || d.roomId[pr.y * d.W + pr.x] !== roomId) continue;
		out.push([pr.x, pr.y]);
	}
	return out;
}

/**
 * Room `roomId`'s spawn tiles (roomSpawnTiles, row order) that are behind cover as seen from `door`: no line of sight
 * from the door (a solid pillar is in the way) and a pillar within COVER_PILLAR_TILES. Empty without solid pillars.
 */
export function coverTiles(d: Dungeon, roomId: number, door: TileXZ): TileXZ[] {
	const room = encounterRooms(d)[roomId];
	const pillars = roomPillars(d, roomId);
	if (room === undefined || pillars.size() === 0) return [];
	const blocked = bulletBlocker(d);
	return roomSpawnTiles(d, room, tutorialRoomTools(d, room)).filter((t) => {
		const gx = worldToGrid(t.x);
		const gy = worldToGrid(t.z);
		let near = false;
		for (const [px, py] of pillars)
			if (math.max(math.abs(px - gx), math.abs(py - gy)) <= COVER_PILLAR_TILES) near = true;
		return near && !lineOfSight(blocked, door.x, door.z, t.x, t.z);
	});
}

export interface TutorialLayoutReport {
	/** Meets the hard criteria: 6 combat lessons, a treasure room, a shrine, and no leg walks through a later room. */
	readonly ok: boolean;
	/** Why not (empty when ok). */
	readonly problems: ReadonlyArray<string>;
	/** The entrance -> boss route (critical-path room ids, in walk order). */
	readonly criticalPath: ReadonlyArray<number>;
	/** The six lesson rooms (combat / elite), in tour order. */
	readonly lessons: ReadonlyArray<number>;
	readonly treasure: number;
	readonly shrine: number;
	/** The best tour found (entrance, lessons, treasure / shrine in the better order, boss). */
	readonly tour: TutorialTour | undefined;
	/** Rooms the tour never visits. */
	readonly extraRooms: number;
	/** Loop corridors. */
	readonly loops: number;
	/** Lesson E's cover tiles (coverTiles from the tour's door into it); 0 costs LAYOUT_NO_COVER_PENALTY. */
	readonly coverTiles: number;
	/** BFS tiles straight from the entrance to the boss room. */
	readonly directTiles: number;
	/** Lower is better: tour tiles + the penalties above. math.huge when there is no tour. */
	readonly score: number;
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

/** The critical path's rooms, entrance first (Forge edges with isCritical). */
function criticalPathOf(d: Dungeon): number[] {
	const out = [d.entrance];
	const used = new Set<number>([d.entrance]);
	let at = d.entrance;
	while (at !== d.boss) {
		let nextRoom = -1;
		for (const e of d.edges) {
			if (!e.isCritical) continue;
			const other = e.a === at ? e.b : e.b === at ? e.a : -1;
			if (other >= 0 && !used.has(other)) {
				nextRoom = other;
				break;
			}
		}
		if (nextRoom < 0) break;
		out.push(nextRoom);
		used.add(nextRoom);
		at = nextRoom;
	}
	return out;
}

/**
 * Scores `d` as the tutorial's floor 1 (see the file comment): lessons = the six shallowest combat / elite rooms
 * (depth, then BFS tiles from the entrance, then id), then every (treasure, shrine) pair in both orders; the
 * lowest-scoring tour wins. Pure.
 */
export function analyzeTutorialLayout(d: Dungeon): TutorialLayoutReport {
	const problems: string[] = [];
	const rooms = encounterRooms(d);
	const cells = roomCells(d);
	const fromEntrance = floorBfs(d, cells[d.entrance]);
	const candidates: number[] = [];
	const treasures: number[] = [];
	const shrines: number[] = [];
	for (const r of rooms) {
		if (r.type === "combat" || r.type === "elite") candidates.push(r.id);
		else if (r.type === "treasure") treasures.push(r.id);
		else if (r.type === "shrine") shrines.push(r.id);
	}
	stableSort(candidates, (a, b) => {
		const byDepth = rooms[a].depth - rooms[b].depth;
		if (byDepth !== 0) return byDepth;
		const byWalk = fromEntrance.dist[cells[a]] - fromEntrance.dist[cells[b]];
		return byWalk !== 0 ? byWalk : a - b;
	});
	const lessons: number[] = [];
	for (let i = 0; i < math.min(TUTORIAL_COMBAT_LESSONS, candidates.size()); i++) lessons.push(candidates[i]);
	if (lessons.size() < TUTORIAL_COMBAT_LESSONS) problems.push(`only ${lessons.size()} combat / elite rooms`);
	if (treasures.size() === 0) problems.push("no treasure room");
	if (shrines.size() === 0) problems.push("no shrine room");

	let loops = 0;
	for (const e of d.edges) if (e.isLoop) loops++;
	const directTiles = fromEntrance.dist[cells[d.boss]];

	let best: TutorialTour | undefined;
	let bestScore = math.huge;
	let bestTreasure = treasures.size() > 0 ? treasures[0] : -1;
	let bestShrine = shrines.size() > 0 ? shrines[0] : -1;
	if (problems.size() === 0) {
		for (const t of treasures)
			for (const s of shrines)
				for (const shrineFirst of [false, true]) {
					const order = [d.entrance, ...lessons];
					if (shrineFirst) order.push(s, t);
					else order.push(t, s);
					order.push(d.boss);
					const tour = tutorialTour(d, order);
					if (tour.tiles < 0) continue;
					const extra = rooms.size() - order.size();
					const score =
						tour.tiles +
						LAYOUT_EXTRA_ROOM_PENALTY * extra +
						LAYOUT_LOOP_PENALTY * loops +
						LAYOUT_EARLY_ROOM_PENALTY * tour.earlyRooms +
						(shrineFirst ? LAYOUT_SHRINE_FIRST_PENALTY : 0);
					if (score < bestScore) {
						bestScore = score;
						best = tour;
						bestTreasure = t;
						bestShrine = s;
					}
				}
		if (best === undefined) problems.push("no reachable tour");
		else if (best.earlyRooms > 0) problems.push(`${best.earlyRooms} tour room(s) walked through early`);
	}
	// Lesson E's cover (the lessons come before the treasure / shrine pair, so every tour has the same door into it).
	let cover = 0;
	if (best !== undefined) {
		cover = coverTiles(d, best.rooms[1 + TUTORIAL_COVER_LESSON], best.legs[TUTORIAL_COVER_LESSON].door).size();
		if (cover === 0) bestScore += LAYOUT_NO_COVER_PENALTY;
	}
	return {
		ok: problems.size() === 0,
		problems,
		criticalPath: criticalPathOf(d),
		lessons,
		treasure: bestTreasure,
		shrine: bestShrine,
		tour: best,
		extraRooms: best !== undefined ? rooms.size() - best.rooms.size() : rooms.size(),
		loops,
		coverTiles: cover,
		directTiles,
		score: bestScore,
	};
}
