/**
 * Endless mode floors (GDD "Endless mode"): a run is an unbroken descent through Dungeon Forge floors. Everything here
 * is a PURE function of (run seed, floor), so live play and the server's replay build identical floors:
 *
 *   floor seed    floorSeed(runSeed, floor) = ((runSeed >>> 0) ^ Math.imul(floor, 0x85ebca6b)) >>> 0
 *   layout        generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: floorSeed, roomCount: floorRoomCount(floor),
 *                 solidPillars: true, roomScale: 2 }): pillars are real 1-tile walls (cover), and every room is
 *                 twice as wide and tall as M1's (ENDLESS_ROOM_SCALE); endless floors only, never in M1
 *   boss floors   every BOSS_FLOOR_EVERY-th floor: a boss in the boss room (the floor's only initial spawn), picked by
 *                 bossKindFor(floor seed) from ENDLESS_BOSSES (Mother Bramble or the Demon Lord) on its own stream
 *                 hash(floor seed, BOSS_PICK.salt), one draw, so nothing else on the floor depends on the pick
 *   stairwell     the boss room's center floor tile; on other floors the boss room is empty and holds it from the start
 *   roster        the room kinds the run meets on the floor (endlessRoster): swarmers plus seeded kinds, one more
 *                 every ROSTER.floorsPerKind floors, from the run seed's own stream hash(run seed, ROSTER.salt); it
 *                 only closes kinds in the spender, so the layout, digest, props, boss pick, spawn and stairwell never
 *                 depend on it
 *   room enemies  per combat / elite room: ENCOUNTER_BUDGET spent by ENCOUNTER_COST from the room's own encounter rng
 *                 (encounterRoomSeed(dungeon seed, room id), as placeEncounter does) on the kinds open on the floor
 *                 (ENDLESS_ROOM_KINDS fromFloor / maxPerRoom, docs/ENEMY_VARIANTS.md EV5) that are in the run's
 *                 seeded roster (endlessRoster(runSeed, floor), docs/DAILY.md DS1), placed on the M1 populator's
 *                 spawn tiles (enemyRooms.ts). They are NOT spawned at floor start: the sim spawns a room's list when
 *                 the player first walks into that room (deferred), which keeps the live actor count under MAX_ACTORS
 *                 however large the budgets grow.
 *   breakables    barrels and crates in combat / elite / treasure rooms (./breakables.ts, docs/DECOR.md D4), placed
 *                 from their own stream hash(floor seed, BREAKABLE.salt) and kept clear of the room spawns
 *                 (which depend on the party size, so the pieces do too); their cells leave roomSpawnTiles
 *   affixes       elite affixes per planned room spawn (./affixes.ts, docs/ENEMY_VARIANTS.md EV6), last, from their
 *                 own stream hash(floor seed, AFFIXES.salt); nothing above reads them
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
import { SPREAD_TRIES, SWARMER_KIND, isOpenTile, nearestFree, roomSpawnTiles, spreadTile } from "./enemyRooms";
import { encounterCost } from "./encounterCost";
import { placeBreakables, withoutBreakableCells, type BreakablePlacement } from "./breakables";
import { assignAffixes } from "./affixes";
import type { ActorSpawn, EncounterConfig, EncounterRoom, EncounterRoomType } from "./encounterTypes";
import {
	BOSS_FLOOR_EVERY,
	BOSS_PICK,
	ELITE_BUDGET_MULTIPLIER,
	ENDLESS_FIRST_FLOOR,
	ENCOUNTER_BUDGET_BASE,
	ENCOUNTER_BUDGET_PER_FLOOR,
	ENDLESS_BASE_ROOM_COUNT,
	ENDLESS_BOSSES,
	ENDLESS_FLOORS_PER_EXTRA_ROOM,
	ENDLESS_MAX_ROOM_COUNT,
	ENDLESS_PACK_SIZE,
	ENDLESS_ROOM_ACTOR_CAP,
	ENDLESS_ROOM_KINDS,
	ENDLESS_ROOM_SCALE,
	ENDLESS_SOLID_PILLARS,
	FLOOR_SEED_MUL,
	PARTY_BUDGET_MULTIPLIERS,
	ROSTER,
	WIDE_BODY_KINDS,
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

/** Seed of the boss pick's stream: the floor seed with BOSS_PICK.salt mixed in (uint32). */
export function bossPickSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), BOSS_PICK.salt);
}

/**
 * The boss of a boss floor whose floor seed is `floorSeed`: one draw from new EncounterRng(bossPickSeed(floorSeed)),
 * weighted by ENDLESS_BOSSES. Pure; reads no other stream.
 */
export function bossKindFor(floorSeed: number): string {
	let total = 0;
	for (const b of ENDLESS_BOSSES) total += b.weight;
	let r = new EncounterRng(bossPickSeed(floorSeed)).next() * total;
	for (const b of ENDLESS_BOSSES) {
		if (r < b.weight) return b.kind;
		r -= b.weight;
	}
	return ENDLESS_BOSSES[ENDLESS_BOSSES.size() - 1].kind;
}

/**
 * The Forge params of `floor` of the run `runSeed`: the M1 preset plus solid pillars (ENDLESS_SOLID_PILLARS) and
 * rooms ENDLESS_ROOM_SCALE times as large.
 */
export function endlessFloorParams(runSeed: number, floor: number): ForgeParams {
	return {
		...KALEB_VALE_MVP_PARAMS,
		seed: floorSeed(runSeed, floor),
		roomCount: floorRoomCount(floor),
		solidPillars: ENDLESS_SOLID_PILLARS,
		roomScale: ENDLESS_ROOM_SCALE,
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

/** Seed of the roster's stream: the run seed with ROSTER.salt mixed in (uint32). */
export function rosterSeed(runSeed: number): number {
	return bit32.bxor(u32(runSeed), ROSTER.salt);
}

/**
 * The order in which the seeded kinds of run `runSeed` join its roster: the room kinds other than ROSTER.always
 * (ENDLESS_ROOM_KINDS order) after one Fisher-Yates shuffle from new EncounterRng(rosterSeed(runSeed)): for i from
 * the last index down to 1, j = rng.int(0, i), swap i and j (one draw per step: 4 draws for 5 kinds). Pure.
 */
export function rosterOrder(runSeed: number): string[] {
	const order: string[] = [];
	for (const k of ENDLESS_ROOM_KINDS) if (k.kind !== ROSTER.always) order.push(k.kind);
	const rng = new EncounterRng(rosterSeed(runSeed));
	for (let i = order.size() - 1; i >= 1; i--) {
		const j = rng.int(0, i);
		const t = order[i];
		order[i] = order[j];
		order[j] = t;
	}
	return order;
}

/** How many seeded kinds the roster wants on `floor`: 1 + floor((floor - 1) / ROSTER.floorsPerKind), capped at `kinds`. */
export function rosterTargetSize(floor: number, kinds: number): number {
	return math.min(kinds, 1 + math.floor((floor - ENDLESS_FIRST_FLOOR) / ROSTER.floorsPerKind));
}

/** The unlock floor of room kind `kind` (EndlessRoomKind.fromFloor; ENDLESS_FIRST_FLOOR without one). */
function kindUnlockFloor(kind: string): number {
	for (const k of ENDLESS_ROOM_KINDS) if (k.kind === kind) return k.fromFloor ?? ENDLESS_FIRST_FLOOR;
	return ENDLESS_FIRST_FLOOR;
}

/**
 * The seeded roster of run `runSeed` on `floor` (docs/DAILY.md DS1, DSD2 / DSD9): the room kinds its rooms may buy,
 * in join order. ROSTER.always (swarmers) first, always in; then, floor by floor from ENDLESS_FIRST_FLOOR, while the
 * roster holds fewer seeded kinds than rosterTargetSize(f), the first kind of rosterOrder(runSeed) that is not in yet
 * and is unlocked on f (fromFloor) joins; when none is unlocked the roster waits for a later floor. A kind never
 * leaves, so roster(f) starts with roster(f - 1) and the kinds past its length joined on f. Floor 1 holds swarmers
 * and exactly one seeded kind, which is a sniper or a bruiser (the only kinds unlocked there). Pure and cheap (one
 * shuffle, at most floor x kinds steps, none past a full roster); nothing is cached.
 */
export function endlessRoster(runSeed: number, floor: number): string[] {
	const order = rosterOrder(runSeed);
	const roster: string[] = [ROSTER.always];
	for (let f = ENDLESS_FIRST_FLOOR; f <= floor; f++) {
		if (roster.size() > order.size()) break; // every kind is in
		const target = rosterTargetSize(f, order.size());
		while (roster.size() - 1 < target) {
			let joined: string | undefined;
			for (const kind of order) {
				if (!roster.includes(kind) && kindUnlockFloor(kind) <= f) {
					joined = kind;
					break;
				}
			}
			if (joined === undefined) break;
			roster.push(joined);
		}
	}
	return roster;
}

/**
 * True when a room on `floor` that has already bought `bought` (count per kind) may buy kind `k`: from its unlock floor
 * (EndlessRoomKind.fromFloor), below its room maximum (maxPerRoom) and, with a `roster` (endlessRoster), in it.
 * Draws nothing.
 */
function roomKindOpen(
	k: EndlessRoomKind,
	floor: number,
	bought: ReadonlyMap<string, number>,
	roster: ReadonlyArray<string> | undefined,
): boolean {
	if (k.fromFloor !== undefined && floor < k.fromFloor) return false;
	if (roster !== undefined && !roster.includes(k.kind)) return false;
	return k.maxPerRoom === undefined || (bought.get(k.kind) ?? 0) < k.maxPerRoom;
}

/**
 * Spends `budget` on the room enemies of a room on `floor` (archetype ids, in spawn order), at most `cap` of them; the
 * costs never add up to more than the budget. Only the kinds open on the floor take part (roomKindOpen: unlocked, below
 * their room maximum and in `roster` when one is given; a closed kind is skipped in both loops below, so it moves no
 * total and no draw). Every endless floor passes its roster (buildEndlessFloor); without one (specs) every unlocked
 * kind is open, as before the roster. Each pick:
 * the affordable open kinds (ENDLESS_ROOM_KINDS) that cost at least budget-left / slots-left (so a big budget buys
 * dearer enemies instead of running out of slots), drawn by weight with one rng draw; when none of them is that dear,
 * the dearest affordable open kind (no draw). Stops when nothing is affordable or the cap is reached.
 */
export function spendEncounterBudget(
	rng: DungeonRng,
	budget: number,
	floor: number,
	cap: number = ENDLESS_ROOM_ACTOR_CAP,
	roster?: ReadonlyArray<string>,
): string[] {
	const out: string[] = [];
	const bought = new Map<string, number>();
	let left = budget;
	while (out.size() < cap) {
		const need = left / (cap - out.size());
		let total = 0;
		let dearest: EndlessRoomKind | undefined;
		for (const k of ENDLESS_ROOM_KINDS) {
			if (!roomKindOpen(k, floor, bought, roster)) continue;
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
				if (!roomKindOpen(k, floor, bought, roster)) continue;
				const c = encounterCost(k.kind);
				if (c > left || c < need) continue;
				pick = k;
				if (r < k.weight) break;
				r -= k.weight;
			}
		}
		out.push(pick.kind);
		bought.set(pick.kind, (bought.get(pick.kind) ?? 0) + 1);
		left -= encounterCost(pick.kind);
	}
	return out;
}

/**
 * One endless room's enemies on `floor`: spendEncounterBudget(tools.rng, budget, floor, cap, roster), then placement on
 * roomSpawnTiles: swarmers in packs of up to ENDLESS_PACK_SIZE on the free tiles nearest their pack's anchor,
 * everything else (and each new pack's anchor) on a spread-out free tile (spreadTile, same rng). A wide body
 * (WIDE_BODY_KINDS) only takes a tile whose 8 neighbours are FLOOR (isOpenTile); roomSpawnTiles are all such tiles
 * except in a tiny room's fallback, so the filter leaves the candidates, and every draw, as they were. Stops early
 * when the room runs out of tiles (for a wide body: of open ones).
 */
export function populateEndlessRoom(
	room: EncounterRoom,
	tools: RoomTools,
	budget: number,
	floor: number,
	roster?: ReadonlyArray<string>,
): ActorSpawn[] {
	const d = tools.dungeon;
	const rng = tools.rng;
	const kinds = spendEncounterBudget(rng, budget, floor, ENDLESS_ROOM_ACTOR_CAP, roster);
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
			const wide = WIDE_BODY_KINDS.has(kind);
			t = spreadTile(
				rng,
				open.filter((o) => !used.has(o) && (!wide || isOpenTile(d, o))),
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
 * boss room and non-combat rooms), buying only the kinds in `roster` (endlessRoster of the run and floor; every real
 * endless floor passes it, buildEndlessFloor; absent, in specs only: every unlocked kind).
 */
export function endlessRoomSpawns(
	d: Dungeon,
	floor: number,
	partySize = 1,
	roster?: ReadonlyArray<string>,
): ActorSpawn[][] {
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
		out.push(populateEndlessRoom(room, tools, budget, floor, roster));
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
	/**
	 * The boss archetype id in the boss room (bossKindFor(seed) on an endless boss floor; the tutorial's last floor:
	 * Mother Bramble); undefined: no boss.
	 */
	readonly bossKind?: string;
	/**
	 * The run's seeded roster on this floor (endlessRoster(runSeed, floor), docs/DAILY.md DS1): the room kinds its rooms
	 * may buy, in join order (ROSTER.always first; the kinds past endlessRoster(runSeed, floor - 1)'s length joined on
	 * this floor). The stage card reads it (shared/view/hud rosterLine). Absent: no roster (the tutorial's hand-built
	 * floors).
	 */
	readonly roster?: ReadonlyArray<string>;
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
	/**
	 * Breakable barrels and crates (./breakables.ts placeBreakables, docs/DECOR.md D4), tile coordinates; their cells
	 * are already left out of roomSpawnTiles. Absent: none (the tutorial's hand-built floors).
	 */
	readonly breakables?: ReadonlyArray<BreakablePlacement>;
	/**
	 * Elite affixes (./affixes.ts assignAffixes, docs/ENEMY_VARIANTS.md EV6): an affix id (shared/dungeon AffixKind; 0 =
	 * none) per planned room spawn, same shape as roomSpawns. Absent: none (the tutorial's hand-built floors).
	 */
	readonly roomAffixes?: ReadonlyArray<ReadonlyArray<number>>;
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
	const bossKind = bossFloor ? bossKindFor(params.seed) : undefined;
	const encounter = placeEncounter(d, { boss: bossKind });
	const bossRoom = encounter.rooms[d.boss];
	if (bossRoom === undefined) error(`buildEndlessFloor: floor ${floor} (seed ${params.seed}) has no boss room`, 0);
	const spawn = entranceSpawn(d);
	// The roster comes from the run seed's own stream and only closes kinds in the spender: nothing above moves.
	const roster = endlessRoster(runSeed, floor);
	const roomSpawns = endlessRoomSpawns(d, floor, partySize, roster);
	const stairwell = { x: bossRoom.cx, z: bossRoom.cz };
	// Breakables run last, on their own rng stream (./breakables.ts): nothing above moves.
	const breakables = placeBreakables(
		{ seed: params.seed, dungeon: d, encounter, roomSpawns, spawn, stairwell },
		floor,
	);
	// Affixes run after everything else, on their own rng stream (./affixes.ts): nothing above moves.
	const roomAffixes = assignAffixes(params.seed, floor, encounter.rooms, roomSpawns);
	return {
		floor,
		seed: params.seed,
		roomCount: params.roomCount,
		dungeon: d,
		bossFloor,
		bossKind,
		roster,
		encounter,
		roomSpawns,
		roomSpawnTiles: withoutBreakableCells(endlessRoomSpawnTiles(d, roomSpawns), breakables),
		spawn: { x: spawn.x, z: spawn.z },
		stairwell,
		breakables,
		roomAffixes,
	};
}
