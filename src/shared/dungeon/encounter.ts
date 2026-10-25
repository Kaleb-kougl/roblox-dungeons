/**
 * Encounter placement (Roblox port of project-kaleb-vale src/bullets/encounter.ts and setup.ts roomFloorTile
 * @ 42897e2): a PURE function of the dungeon that decides what stands where at run start and describes every room
 * for AI. The result is SimConfig.encounter, so live play and replays rebuild the same world from the run seed.
 *
 * Spawn order (= actor slot order at run start):
 *   1. options.nearest: one actor per room in the rooms nearest the entrance (corridor depth, then distance, then id),
 *      skipping the entrance (safe spawn) and the boss room, each on its room's center floor tile
 *   2. options.populate(room, tools) for every room except the entrance, in room id order (boss room included, so a
 *      boss populator can add minions / props; the boss itself comes from options.boss)
 *   3. options.boss: the boss archetype on the boss room's center floor tile
 */
import { imul, stableSort, u32 } from "shared/jsmath";
import { TILE_SIZE, entranceRoom, gridToWorld, tileAt } from "./collision";
import { mulberry32Step, TileType, type Dungeon, type Room } from "./forge";
import type { ActorSpawn, EncounterConfig, EncounterRoom } from "./encounterTypes";

/** World position of a tile center. */
export interface TileXZ {
	readonly x: number;
	readonly z: number;
}

/**
 * The per-room generator: mulberry32, the same stream as the sim's `Rng` (src/sim/rng.ts `new Rng(seed)`), so the
 * sim's Rng satisfies this interface structurally. Kept local so the dungeon module never imports the sim.
 */
export interface DungeonRng {
	/** Float in [0, 1). */
	next(): number;
	/** Integer in [min, max], both inclusive (the sim's rngInt: ceil / floor of the bounds). */
	int(min: number, max: number): number;
}

/** `new Rng(seed)` of the sim, without depending on it: seedToState(seed) then mulberry32. */
export class EncounterRng implements DungeonRng {
	private s: number;

	constructor(seed: number) {
		// seedToState: (isFinite(seed) ? trunc(seed) : 0) >>> 0, which is exactly u32
		this.s = u32(seed);
	}

	/** Current uint32 state. */
	getState(): number {
		return this.s;
	}

	next(): number {
		const [s, out] = mulberry32Step(this.s);
		this.s = s;
		return out;
	}

	int(min: number, max: number): number {
		const lo = math.ceil(math.min(min, max));
		const hi = math.floor(math.max(min, max));
		return lo + math.floor(this.next() * (hi - lo + 1));
	}
}

/** What a room populator gets besides the room. */
export interface RoomTools {
	readonly dungeon: Dungeon;
	/** Seeded from (dungeon seed, room id): the same room always draws the same numbers. */
	readonly rng: DungeonRng;
	/** The room's own FLOOR tiles (world tile centers), row by row (z, then x). */
	floor(): ReadonlyArray<TileXZ>;
	/** The room's center floor tile (world). */
	center(): TileXZ;
}

/** Returns the actors to place in one room (kind ids and world positions, usually from tools.floor()). */
export type RoomPopulator = (room: EncounterRoom, tools: RoomTools) => ReadonlyArray<ActorSpawn>;

export interface EncounterOptions {
	/** One actor per room, nearest rooms first (step 1 above). */
	readonly nearest?: ReadonlyArray<string>;
	/** Per-room spawns (step 2 above). */
	readonly populate?: RoomPopulator;
	/** Boss archetype id for the boss room (step 3 above); undefined = no boss. */
	readonly boss?: string;
}

/** The center tile of `room` if it is FLOOR in that room, else the nearest such tile (ring search), else undefined. */
export function roomFloorTile(d: Dungeon, room: Room): { x: number; y: number } | undefined {
	const inRoom = (gx: number, gy: number) =>
		tileAt(d, gx, gy) === TileType.FLOOR && d.roomId[gy * d.W + gx] === room.id;
	if (inRoom(room.cx, room.cy)) return { x: room.cx, y: room.cy };
	const maxRing = math.max(room.w, room.h);
	for (let k = 1; k <= maxRing; k++)
		for (let oy = -k; oy <= k; oy++)
			for (let ox = -k; ox <= k; ox++) {
				if (math.max(math.abs(ox), math.abs(oy)) !== k) continue;
				if (inRoom(room.cx + ox, room.cy + oy)) return { x: room.cx + ox, y: room.cy + oy };
			}
	return undefined;
}

/** Every room of the dungeon in world units (index = room id). Pure. */
export function encounterRooms(d: Dungeon): EncounterRoom[] {
	const n = d.rooms.size();
	const minGx = new Array<number>(n, math.huge);
	const maxGx = new Array<number>(n, -math.huge);
	const minGy = new Array<number>(n, math.huge);
	const maxGy = new Array<number>(n, -math.huge);
	const count = new Array<number>(n, 0);
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			const id = d.roomId[gy * d.W + gx];
			if (id < 0 || id >= n || tileAt(d, gx, gy) !== TileType.FLOOR) continue;
			if (gx < minGx[id]) minGx[id] = gx;
			if (gx > maxGx[id]) maxGx[id] = gx;
			if (gy < minGy[id]) minGy[id] = gy;
			if (gy > maxGy[id]) maxGy[id] = gy;
			count[id]++;
		}
	const half = TILE_SIZE / 2;
	return d.rooms.map((room, id) => {
		const c = roomFloorTile(d, room) ?? { x: room.cx, y: room.cy };
		const has = count[id] > 0;
		return {
			id,
			type: room.type,
			depth: room.depth,
			cx: gridToWorld(c.x),
			cz: gridToWorld(c.y),
			minX: has ? gridToWorld(minGx[id]) - half : gridToWorld(c.x) - half,
			maxX: has ? gridToWorld(maxGx[id]) + half : gridToWorld(c.x) + half,
			minZ: has ? gridToWorld(minGy[id]) - half : gridToWorld(c.y) - half,
			maxZ: has ? gridToWorld(maxGy[id]) + half : gridToWorld(c.y) + half,
			floorTiles: count[id],
		};
	});
}

/** The room's FLOOR tiles (world centers), row by row. */
export function roomFloorTiles(d: Dungeon, roomId: number): TileXZ[] {
	const out: TileXZ[] = [];
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			if (d.roomId[gy * d.W + gx] === roomId && tileAt(d, gx, gy) === TileType.FLOOR) {
				out.push({ x: gridToWorld(gx), z: gridToWorld(gy) });
			}
		}
	return out;
}

/** Rooms by distance from the entrance: corridor depth, then straight-line distance, then id. */
export function roomsNearestFirst(d: Dungeon): Room[] {
	const entrance = entranceRoom(d);
	const dist2 = (r: Room) =>
		(r.cx - entrance.cx) * (r.cx - entrance.cx) + (r.cy - entrance.cy) * (r.cy - entrance.cy);
	const rooms = d.rooms.filter((r) => r.id !== entrance.id && r.id !== d.boss);
	// total order (ids are unique), so stability does not matter; stableSort keeps JS's comparator semantics
	return stableSort(rooms, (a, b) => {
		const byDepth = a.depth - b.depth;
		if (byDepth !== 0) return byDepth;
		const byDist = dist2(a) - dist2(b);
		if (byDist !== 0) return byDist;
		return a.id - b.id;
	});
}

/** Per-room rng seed from the dungeon seed and the room id: `((seed >>> 0) ^ Math.imul(roomId + 1, 0x9e3779b1)) >>> 0`. */
export function encounterRoomSeed(dungeonSeed: number, roomId: number): number {
	return bit32.bxor(u32(dungeonSeed), imul(roomId + 1, ROOM_SEED_MUL));
}

const ROOM_SEED_MUL = 0x9e3779b1;

/** Builds SimConfig.encounter for `d` (see the spawn order at the top of this file). Pure. */
export function placeEncounter(d: Dungeon, options: EncounterOptions): EncounterConfig {
	const rooms = encounterRooms(d);
	const spawns: ActorSpawn[] = [];

	const nearest = options.nearest ?? [];
	if (nearest.size() > 0) {
		let k = 0;
		for (const room of roomsNearestFirst(d)) {
			if (k >= nearest.size()) break;
			const tile = roomFloorTile(d, room);
			if (!tile) continue;
			spawns.push({ kind: nearest[k++], x: gridToWorld(tile.x), z: gridToWorld(tile.y) });
		}
	}

	const populate = options.populate;
	if (populate) {
		for (const room of rooms) {
			if (room.id === d.entrance) continue;
			let floor: TileXZ[] | undefined;
			const tools: RoomTools = {
				dungeon: d,
				rng: new EncounterRng(encounterRoomSeed(d.seed, room.id)),
				floor() {
					if (!floor) floor = roomFloorTiles(d, room.id);
					return floor;
				},
				center() {
					return { x: room.cx, z: room.cz };
				},
			};
			for (const s of populate(room, tools)) spawns.push({ kind: s.kind, x: s.x, z: s.z });
		}
	}

	if (options.boss !== undefined && options.boss !== "") {
		const boss = rooms[d.boss];
		if (boss) spawns.push({ kind: options.boss, x: boss.cx, z: boss.cz });
	}

	return { spawns, rooms, entranceRoom: d.entrance, bossRoom: d.boss };
}
