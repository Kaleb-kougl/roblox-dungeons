/**
 * The Goldling's floor roll and its flee field (docs/FORTUNE.md GE1, Design §1 golden half, decisions FD10 / FD13; a
 * Roblox-port feature, no web source). The roll is decided when the floor is built, a PURE function of the floor like
 * the rest of ./endless.ts, so live play, every co-op client, the server's replay and a daily seed agree on it.
 *
 *   stream   its own: new EncounterRng(goldenSeed(floor seed)) = mulberry32 from (seed ^ GOLDEN_PLACE.salt); it only
 *            reads the layout's encounter rooms and the room spawns, so the layout, digest, props, spawns, pieces,
 *            affixes, loot, pellets and boss pick never move.
 *   chance   floors below GOLDEN_PLACE.fromFloor draw nothing. From it, ONE draw rng.int(0, percentRange - 1) <
 *            goldenChancePercent(floor) (the depth band's percent, FD13).
 *   room     on a hit, the eligible rooms (goldenEligibleRooms: id order; a combat / elite room, roomWeights, with planned
 *            spawns and at least minRoomTiles FLOOR cells of its own, never the boss room); none eligible: no Goldling
 *            and no more draws. Else ONE draw rng.int(0, total weight - 1) walks the list by weight.
 *   draws    0 below fromFloor; else 1, + 1 when the chance hit and a room is eligible.
 *   certain  (GoldenForce, docs/FLOOR_MODIFIERS.md FM2: the Gilded floor) the chance draw is still made and its result
 *            ignored, so the room draw is the very draw a natural hit makes: a forced floor whose natural roll hit gets
 *            the natural Goldling. Absent: the floor exactly as before.
 *
 * Output: FloorGolden (EndlessFloorLayout / EndlessFloorWorld.golden): the room and what the sim needs to keep the
 * Goldling inside it without a Dungeon: the room's floor rectangle (roomGridRect) and a walk mask over it (1 = a FLOOR
 * cell of THAT room: pillars, solid decor, pits, walls, corridors and other rooms' cells are 0).
 *
 * The flee field (fleeField, docs/FORTUNE.md "Moves"): allocation-free over a box of w x h cells, given the open mask
 * (the walk mask minus the intact breakables' cells, built by the caller), the source cells (living players' cells) and
 * reusable scratch:
 *   1. a 4-neighbour multi-source BFS from the sources over open cells: D (steps to the nearest player)
 *   2. seeds S = -factor x D (GOLDEN_FLEE.factor 1.2) on every reached cell
 *   3. the re-relax: out = min over reached cells s of (S[s] + steps from s), an exact unit-step Dijkstra (seeds taken in
 *      ascending order, merged with a FIFO of relaxed values). Without it the far corner is the lowest cell and a
 *      chased Goldling walks into it; with it, running past the player to the far side beats the corner.
 * Walking it downhill (fleeStep) moves away from the players along the room. Unreached open cells (no source in their
 * component) and closed cells are math.huge, so a Goldling with no player in its room stands still.
 */
import { u32 } from "shared/jsmath";
import type { Dungeon } from "./forge";
import { TileType } from "./forge";
import { tileAt } from "./collision";
import { EncounterRng } from "./encounter";
import type { ActorSpawn, EncounterConfig, EncounterRoom } from "./encounterTypes";
import { roomGridRect } from "./pellets";
import { GOLDEN_FLEE, GOLDEN_PLACE } from "./goldenData";

/** The Goldling's room on a floor (EndlessFloorLayout / EndlessFloorWorld.golden). Never mutated. */
export interface FloorGolden {
	/** Encounter room id. */
	readonly room: number;
	/** The room's floor rectangle (roomGridRect): grid x0 .. x0 + w - 1 by y0 .. y0 + h - 1. */
	readonly x0: number;
	readonly y0: number;
	readonly w: number;
	readonly h: number;
	/** Per box cell, row-major ((gy - y0) * w + (gx - x0)): 1 for a FLOOR cell of the room, else 0. */
	readonly walk: ReadonlyArray<number>;
}

/** What placeGolden reads of a built floor. */
export interface GoldenFloorInput {
	/** The floor seed (floorSeed(runSeed, floor)). */
	readonly seed: number;
	readonly dungeon: Dungeon;
	readonly encounter: EncounterConfig;
	/** Deferred enemies per room id. */
	readonly roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>;
}

/** Seed of the Goldling's floor stream: the floor seed with GOLDEN_PLACE.salt mixed in (uint32). */
export function goldenSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), GOLDEN_PLACE.salt);
}

/** The per-floor chance (percent) on `floor`: 0 below fromFloor, else its depth band's (FD13). */
export function goldenChancePercent(floor: number): number {
	if (floor < GOLDEN_PLACE.fromFloor) return 0;
	let percent = 0;
	for (const b of GOLDEN_PLACE.bands) if (floor >= b.fromFloor) percent = b.chancePercent;
	return percent;
}

/** The weight of room type `roomType` in the room pick (0: never). */
export function goldenRoomWeight(roomType: string): number {
	for (const w of GOLDEN_PLACE.roomWeights) if (w.type === roomType) return w.weight;
	return 0;
}

/**
 * The rooms a Goldling can run in on a built floor, in id order: a weighted type (combat / elite), planned spawns, at
 * least minRoomTiles FLOOR cells of its own, never the boss room (the Dungeon's or the encounter's). Pure; no draw.
 */
export function goldenEligibleRooms(input: GoldenFloorInput): EncounterRoom[] {
	const out: EncounterRoom[] = [];
	const d = input.dungeon;
	for (const room of input.encounter.rooms) {
		if (room.id === d.boss || room.id === input.encounter.bossRoom) continue;
		if (goldenRoomWeight(room.type) <= 0 || room.floorTiles < GOLDEN_PLACE.minRoomTiles) continue;
		const spawns = input.roomSpawns[room.id];
		if (spawns === undefined || spawns.size() === 0) continue;
		out.push(room);
	}
	return out;
}

/** `room`'s floor rectangle and walk mask (see FloorGolden). Pure. */
export function goldenRoomMask(d: Dungeon, room: Readonly<EncounterRoom>): FloorGolden {
	const [x0, y0, x1, y1] = roomGridRect(room);
	const w = x1 - x0 + 1;
	const h = y1 - y0 + 1;
	const walk: number[] = [];
	for (let ly = 0; ly < h; ly++)
		for (let lx = 0; lx < w; lx++) {
			const gx = x0 + lx;
			const gy = y0 + ly;
			const own = tileAt(d, gx, gy) === TileType.FLOOR && d.roomId[gy * d.W + gx] === room.id;
			walk.push(own ? 1 : 0);
		}
	return { room: room.id, x0, y0, w, h, walk };
}

/** placeGolden's force flag (docs/FLOOR_MODIFIERS.md FM2). Absent or empty: the natural roll. */
export interface GoldenForce {
	/** The chance draw always hits (it is still made: the room draw stays the natural hit's). Gilded floors. */
	readonly certain?: boolean;
}

/**
 * The Goldling of the built endless floor `input` (floor `floor`), or undefined: see the file comment. Pure and
 * deterministic: the same floor always gets the same answer. `force.certain`: the Gilded floor (file comment).
 */
export function placeGolden(input: GoldenFloorInput, floor: number, force?: GoldenForce): FloorGolden | undefined {
	if (floor < GOLDEN_PLACE.fromFloor) return undefined;
	const rng = new EncounterRng(goldenSeed(input.seed));
	const hit = rng.int(0, GOLDEN_PLACE.percentRange - 1) < goldenChancePercent(floor);
	if (!hit && force?.certain !== true) return undefined;
	const rooms = goldenEligibleRooms(input);
	if (rooms.size() === 0) return undefined;
	let total = 0;
	for (const r of rooms) total += goldenRoomWeight(r.type);
	let roll = rng.int(0, total - 1);
	for (const r of rooms) {
		const w = goldenRoomWeight(r.type);
		if (roll < w) return goldenRoomMask(input.dungeon, r);
		roll -= w;
	}
	return goldenRoomMask(input.dungeon, rooms[rooms.size() - 1]); // unreachable: the roll is below the total
}

// ---------------------------------------------------------------------------------------------
// The flee field

/** Reusable buffers of fleeField for a box of up to `cells` cells (newFleeScratch). */
export interface FleeScratch {
	/** Per cell: BFS steps to the nearest source (math.huge: unreached). */
	readonly dist: number[];
	/** BFS order (reached cells, nondecreasing D). */
	readonly order: number[];
	/** The re-relax FIFO: cells and their values (at most 4 pushes per cell). */
	readonly queue: number[];
	readonly queueValue: number[];
	/** Per cell: 1 once its re-relaxed value is final. */
	readonly done: number[];
}

/** Relaxed pushes per cell at most (one per 4-neighbour). */
const PUSHES_PER_CELL = 4;

/** Scratch for fleeField over a box of `cells` cells (allocate once per room; fleeField never allocates). */
export function newFleeScratch(cells: number): FleeScratch {
	const dist = new Array<number>(cells, math.huge);
	const order = new Array<number>(cells, 0);
	const queue = new Array<number>(cells * PUSHES_PER_CELL, 0);
	const queueValue = new Array<number>(cells * PUSHES_PER_CELL, 0);
	const done = new Array<number>(cells, 0);
	return { dist, order, queue, queueValue, done };
}

/** 4-neighbour offsets (BFS and re-relax order). */
const DX4: ReadonlyArray<number> = [1, -1, 0, 0];
const DY4: ReadonlyArray<number> = [0, 0, 1, -1];
/** 8-neighbour offsets (fleeStep: straight first, then diagonals; also the tie-break). */
const DX8: ReadonlyArray<number> = [1, -1, 0, 0, 1, 1, -1, -1];
const DY8: ReadonlyArray<number> = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * The flee field over a box of `w` x `h` cells (see the file comment). `open[i]` (row-major, i = ly * w + lx) is 1 for a
 * cell the Goldling can stand on; `sources[0 .. sourceCount - 1]` are box cell indices (an index out of the box or on
 * a closed cell is ignored; repeats are fine); `out[0 .. w h - 1]` receives the field; `scratch` comes from
 * newFleeScratch(>= w h). Allocates nothing. Deterministic: fixed scan orders, IEEE + - x only.
 */
export function fleeField(
	open: ReadonlyArray<number>,
	w: number,
	h: number,
	sources: ReadonlyArray<number>,
	sourceCount: number,
	out: number[],
	scratch: FleeScratch,
	factor: number = GOLDEN_FLEE.factor,
): void {
	const n = w * h;
	const dist = scratch.dist;
	const order = scratch.order;
	const done = scratch.done;
	for (let i = 0; i < n; i++) {
		dist[i] = math.huge;
		done[i] = 0;
		out[i] = math.huge;
	}
	// 1. Multi-source BFS.
	let tail = 0;
	for (let k = 0; k < sourceCount; k++) {
		const s = sources[k];
		if (!(s >= 0 && s < n) || open[s] !== 1 || dist[s] === 0) continue;
		dist[s] = 0;
		order[tail++] = s;
	}
	let head = 0;
	while (head < tail) {
		const c = order[head++];
		const cx = c % w;
		const cy = (c - cx) / w;
		const nd = dist[c] + 1;
		for (let k = 0; k < 4; k++) {
			const nx = cx + DX4[k];
			const ny = cy + DY4[k];
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const j = ny * w + nx;
			if (open[j] !== 1 || dist[j] <= nd) continue;
			dist[j] = nd;
			order[tail++] = j;
		}
	}
	// 2 + 3. Seeds -factor x D in ascending order (the BFS order backwards), merged with the relaxed FIFO.
	const queue = scratch.queue;
	const queueValue = scratch.queueValue;
	let seedAt = tail - 1;
	let qHead = 0;
	let qTail = 0;
	while (seedAt >= 0 || qHead < qTail) {
		let c: number;
		let v: number;
		const seedValue = seedAt >= 0 ? -factor * dist[order[seedAt]] : math.huge;
		if (qHead < qTail && queueValue[qHead] < seedValue) {
			c = queue[qHead];
			v = queueValue[qHead];
			qHead++;
		} else {
			c = order[seedAt];
			v = seedValue;
			seedAt--;
		}
		if (done[c] !== 0) continue;
		done[c] = 1;
		out[c] = v;
		const cx = c % w;
		const cy = (c - cx) / w;
		const nv = v + 1;
		for (let k = 0; k < 4; k++) {
			const nx = cx + DX4[k];
			const ny = cy + DY4[k];
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const j = ny * w + nx;
			if (done[j] !== 0 || dist[j] === math.huge) continue;
			queue[qTail] = j;
			queueValue[qTail] = nv;
			qTail++;
		}
	}
}

/**
 * One step downhill on a flee field from box cell (lx, ly): the box cell index of the 8-neighbour open cell with the
 * lowest value strictly below this cell's (diagonals only past two open corners; ties to the first in DX8 / DY8
 * order), or -1 where no neighbour is lower (a safe spot, or nothing reached). Allocates nothing.
 */
export function fleeStep(
	open: ReadonlyArray<number>,
	w: number,
	h: number,
	field: ReadonlyArray<number>,
	lx: number,
	ly: number,
): number {
	if (lx < 0 || ly < 0 || lx >= w || ly >= h) return -1;
	let best = field[ly * w + lx];
	let pick = -1;
	for (let k = 0; k < 8; k++) {
		const ox = DX8[k];
		const oy = DY8[k];
		const nx = lx + ox;
		const ny = ly + oy;
		if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
		const j = ny * w + nx;
		if (open[j] !== 1) continue;
		if (ox !== 0 && oy !== 0 && (open[ly * w + nx] !== 1 || open[ny * w + lx] !== 1)) continue;
		if (field[j] < best) {
			best = field[j];
			pick = j;
		}
	}
	return pick;
}
