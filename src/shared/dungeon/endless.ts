/**
 * Endless mode floors (GDD "Endless mode"): a run is an unbroken descent through Dungeon Forge floors. Everything here
 * is a PURE function of (run seed, floor), so live play and the server's replay build identical floors:
 *
 *   floor seed    floorSeed(runSeed, floor) = ((runSeed >>> 0) ^ Math.imul(floor, 0x85ebca6b)) >>> 0
 *   layout        generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: floorSeed, roomCount: floorRoomCount(floor),
 *                 solidPillars: true }): pillars are real 1-tile walls (cover) on endless floors only, never in M1
 *   boss floors   every BOSS_FLOOR_EVERY-th floor: Mother Bramble in the boss room (the floor's only initial spawn)
 *   stairwell     the boss room's center floor tile; on other floors the boss room is empty and holds it from the start
 *   room enemies  per combat / elite room: ENCOUNTER_BUDGET spent by ENCOUNTER_COST from the room's own encounter rng
 *                 (encounterRoomSeed(dungeon seed, room id), as placeEncounter does), placed on the M1 populator's
 *                 spawn tiles (enemyRooms.ts). They are NOT spawned at floor start: the sim spawns a room's list when
 *                 the player first walks into that room (deferred), which keeps the live actor count under MAX_ACTORS
 *                 however large the budgets grow.
 *
 * Generating the dungeon is left to the caller (`dungeonFor`), so shared/run can cache it (LRU).
 */
import { imul, u32 } from "shared/jsmath";
import { TileType, KALEB_VALE_MVP_PARAMS, type Dungeon, type ForgeParams } from "./forge";
import { entranceSpawn, tileAt, worldToGrid, type WorldXZ } from "./collision";
import {
	EncounterRng,
	encounterRoomSeed,
	encounterRooms,
	placeEncounter,
	roomFloorTiles,
	type DungeonRng,
	type RoomTools,
	type TileXZ,
} from "./encounter";
import { BOSS_ACT1_KIND, SPREAD_TRIES, SWARMER_KIND, nearestFree, roomSpawnTiles, spreadTile } from "./enemyRooms";
import { encounterCost } from "./encounterCost";
import type { ActorSpawn, EncounterConfig, EncounterRoom, EncounterRoomType } from "./encounterTypes";
import {
	BOSS_FLOOR_EVERY,
	ELITE_BUDGET_MULTIPLIER,
	ENCOUNTER_BUDGET_BASE,
	ENCOUNTER_BUDGET_PER_FLOOR,
	ENDLESS_BASE_ROOM_COUNT,
	ENDLESS_FLOORS_PER_EXTRA_ROOM,
	ENDLESS_MAX_ROOM_COUNT,
	ENDLESS_PACK_SIZE,
	ENDLESS_ROOM_ACTOR_CAP,
	ENDLESS_ROOM_KINDS,
	ENDLESS_SOLID_PILLARS,
	FLOOR_SEED_MUL,
	PARTY_BUDGET_MULTIPLIERS,
	type EndlessRoomKind,
} from "./endlessData";

/** The floor's Dungeon Forge seed (uint32). */
export function floorSeed(runSeed: number, floor: number): number {
	return bit32.bxor(u32(runSeed), imul(floor, FLOOR_SEED_MUL));
}

/** Rooms on `floor`: 12 + floor((floor - 1) / 5), capped at 16. */
export function floorRoomCount(floor: number): number {
	return math.min(
		ENDLESS_MAX_ROOM_COUNT,
		ENDLESS_BASE_ROOM_COUNT + math.floor((floor - 1) / ENDLESS_FLOORS_PER_EXTRA_ROOM),
	);
}

/** Floors 5, 10, 15, ... */
export function isBossFloor(floor: number): boolean {
	return floor >= BOSS_FLOOR_EVERY && floor % BOSS_FLOOR_EVERY === 0;
}

/** The Forge params of `floor` of the run `runSeed`: the M1 preset plus solid pillars (ENDLESS_SOLID_PILLARS). */
export function endlessFloorParams(runSeed: number, floor: number): ForgeParams {
	return {
		...KALEB_VALE_MVP_PARAMS,
		seed: floorSeed(runSeed, floor),
		roomCount: floorRoomCount(floor),
		solidPillars: ENDLESS_SOLID_PILLARS,
	};
}

/**
 * Encounter budget of a room of `type` on `floor`: 6 + 1.2 (floor - 1) for combat, x1.5 for elite, 0 otherwise; then
 * (co-op) x PARTY_BUDGET_MULTIPLIERS[partySize - 1]. Throws on a party size outside the table.
 */
export function roomEncounterBudget(floor: number, roomType: EncounterRoomType, partySize = 1): number {
	const base = ENCOUNTER_BUDGET_BASE + ENCOUNTER_BUDGET_PER_FLOOR * (floor - 1);
	const budget = roomType === "combat" ? base : roomType === "elite" ? base * ELITE_BUDGET_MULTIPLIER : 0;
	if (partySize === 1) return budget;
	const m = PARTY_BUDGET_MULTIPLIERS[partySize - 1];
	if (m === undefined || partySize % 1 !== 0) error(`roomEncounterBudget: bad party size ${partySize}`, 0);
	return budget * m;
}

/**
 * Spends `budget` on room enemies (archetype ids, in spawn order), at most `cap` of them; the costs never add up to
 * more than the budget. Each pick: the affordable kinds (ENDLESS_ROOM_KINDS) that cost at least budget-left / slots-left
 * (so a big budget buys dearer enemies instead of running out of slots), drawn by weight with one rng draw; when none
 * of them is that dear, the dearest affordable kind (no draw). Stops when nothing is affordable or the cap is reached.
 */
export function spendEncounterBudget(rng: DungeonRng, budget: number, cap: number = ENDLESS_ROOM_ACTOR_CAP): string[] {
	const out: string[] = [];
	let left = budget;
	while (out.size() < cap) {
		const need = left / (cap - out.size());
		let total = 0;
		let dearest: EndlessRoomKind | undefined;
		for (const k of ENDLESS_ROOM_KINDS) {
			const c = encounterCost(k.kind);
			if (c > left) continue;
			if (dearest === undefined || c > encounterCost(dearest.kind)) dearest = k;
			if (c >= need) total += k.weight;
		}
		if (dearest === undefined) break;
		let pick = dearest;
		if (total > 0) {
			let r = rng.next() * total;
			for (const k of ENDLESS_ROOM_KINDS) {
				const c = encounterCost(k.kind);
				if (c > left || c < need) continue;
				pick = k;
				if (r < k.weight) break;
				r -= k.weight;
			}
		}
		out.push(pick.kind);
		left -= encounterCost(pick.kind);
	}
	return out;
}

/**
 * One endless room's enemies: spendEncounterBudget(tools.rng, budget), then placement on roomSpawnTiles: swarmers in
 * packs of up to ENDLESS_PACK_SIZE on the free tiles nearest their pack's anchor, everything else (and each new pack's
 * anchor) on a spread-out free tile (spreadTile, same rng). Stops early when the room runs out of tiles.
 */
export function populateEndlessRoom(room: EncounterRoom, tools: RoomTools, budget: number): ActorSpawn[] {
	const d = tools.dungeon;
	const rng = tools.rng;
	const kinds = spendEncounterBudget(rng, budget);
	const spawns: ActorSpawn[] = [];
	if (kinds.size() === 0) return spawns;
	const open = roomSpawnTiles(d, room, tools);
	const used = new Set<TileXZ>();
	const anchors: TileXZ[] = [];
	let pack: TileXZ | undefined;
	let packLeft = 0;
	for (const kind of kinds) {
		let t: TileXZ | undefined;
		if (kind === SWARMER_KIND && pack !== undefined && packLeft > 0) {
			t = nearestFree(open, used, pack, 1)[0];
			packLeft--;
		} else {
			t = spreadTile(
				rng,
				open.filter((o) => !used.has(o)),
				anchors,
				SPREAD_TRIES,
			);
			if (t !== undefined) {
				anchors.push(t);
				if (kind === SWARMER_KIND) {
					pack = t;
					packLeft = ENDLESS_PACK_SIZE - 1;
				}
			}
		}
		if (t === undefined) break;
		used.add(t);
		spawns.push({ kind, x: t.x, z: t.z });
	}
	return spawns;
}

/**
 * Every room's deferred enemies on `floor` for a party of `partySize` (index = room id; empty for the entrance, the
 * boss room and non-combat rooms).
 */
export function endlessRoomSpawns(d: Dungeon, floor: number, partySize = 1): ActorSpawn[][] {
	const rooms = encounterRooms(d);
	const out: ActorSpawn[][] = [];
	for (const room of rooms) {
		const budget = roomEncounterBudget(floor, room.type, partySize);
		if (budget <= 0 || room.id === d.entrance || room.id === d.boss) {
			out.push([]);
			continue;
		}
		let tiles: TileXZ[] | undefined;
		const tools: RoomTools = {
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
		out.push(populateEndlessRoom(room, tools, budget));
	}
	return out;
}

/**
 * Every room's candidate spawn tiles (index = room id): roomSpawnTiles for a room that has deferred enemies in
 * `spawns`, else empty. The sim moves a spawn that would land too close to a player onto one of these when the room's
 * enemies spawn (shared/sim endless.ts, SPAWN_SAFE_RADIUS). Row order. Pure; draws nothing from any rng.
 */
export function endlessRoomSpawnTiles(d: Dungeon, spawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>): TileXZ[][] {
	const out: TileXZ[][] = [];
	for (const room of encounterRooms(d)) {
		const s = spawns[room.id];
		if (s === undefined || s.size() === 0) {
			out.push([]);
			continue;
		}
		let tiles: TileXZ[] | undefined;
		const tools: RoomTools = {
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
		out.push(roomSpawnTiles(d, room, tools));
	}
	return out;
}

/** The room id of the FLOOR tile under world (x, z), or -1 (corridors, walls, outside the grid). Pure. */
export function roomIdAt(d: Dungeon, x: number, z: number): number {
	const gx = worldToGrid(x);
	const gy = worldToGrid(z);
	if (tileAt(d, gx, gy) !== TileType.FLOOR) return -1;
	const id = d.roomId[gy * d.W + gx];
	return id !== undefined && id >= 0 && id < d.rooms.size() ? id : -1;
}

/** One endless floor, as data. Never mutated. */
export interface EndlessFloorLayout {
	readonly floor: number;
	/** floorSeed(runSeed, floor). */
	readonly seed: number;
	readonly roomCount: number;
	readonly dungeon: Dungeon;
	readonly bossFloor: boolean;
	/** SimConfig.encounter of the floor: rooms, entrance / boss room, and the initial spawns (only the boss, if any). */
	readonly encounter: EncounterConfig;
	/** Deferred enemies per room id (see the file comment). */
	readonly roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>;
	/** Candidate spawn tiles per room id (endlessRoomSpawnTiles): where a too-close spawn is moved to. */
	readonly roomSpawnTiles: ReadonlyArray<ReadonlyArray<TileXZ>>;
	/** Where the player arrives: the entrance spawn. */
	readonly spawn: WorldXZ;
	/** The stairwell: the boss room's center floor tile (world). */
	readonly stairwell: WorldXZ;
}

/**
 * Builds floor `floor` of the run `runSeed` for a party of `partySize` (room budgets scale with it; the layout does
 * not); `dungeonFor` generates (or returns the cached) layout for the params.
 */
export function buildEndlessFloor(
	runSeed: number,
	floor: number,
	dungeonFor: (params: ForgeParams) => Dungeon,
	partySize = 1,
): EndlessFloorLayout {
	const params = endlessFloorParams(runSeed, floor);
	const d = dungeonFor(params);
	const bossFloor = isBossFloor(floor);
	const encounter = placeEncounter(d, { boss: bossFloor ? BOSS_ACT1_KIND : undefined });
	const bossRoom = encounter.rooms[d.boss];
	if (bossRoom === undefined) error(`buildEndlessFloor: floor ${floor} (seed ${params.seed}) has no boss room`, 0);
	const spawn = entranceSpawn(d);
	const roomSpawns = endlessRoomSpawns(d, floor, partySize);
	return {
		floor,
		seed: params.seed,
		roomCount: params.roomCount,
		dungeon: d,
		bossFloor,
		encounter,
		roomSpawns,
		roomSpawnTiles: endlessRoomSpawnTiles(d, roomSpawns),
		spawn: { x: spawn.x, z: spawn.z },
		stairwell: { x: bossRoom.cx, z: bossRoom.cz },
	};
}
