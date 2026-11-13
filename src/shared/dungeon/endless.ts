/**
 * Endless mode floors (GDD "Endless mode"): a run is an unbroken descent through Dungeon Forge floors. Everything here
 * is a PURE function of (run seed, floor), so live play and the server's replay build identical floors:
 *
 *   floor seed    floorSeed(runSeed, floor) = ((runSeed >>> 0) ^ Math.imul(floor, 0x85ebca6b)) >>> 0
 *   layout        generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: floorSeed, roomCount: floorRoomCount(floor),
 *                 solidPillars: true, solidDecor: true, roomScale: 2 }): pillars are real 1-tile walls (cover), combat
 *                 and elite rooms get solid tombs and candle stands (docs/DECOR.md "Solid decor"), and every room is
 *                 twice as wide and tall as M1's (ENDLESS_ROOM_SCALE); endless floors only, never in M1
 *   boss floors   every BOSS_FLOOR_EVERY-th floor: a boss in the boss room (the floor's only initial spawn), picked by
 *                 bossKindFor(floor seed) from ENDLESS_BOSSES (Mother Mayhem or the Demon Lord) on its own stream
 *                 hash(floor seed, BOSS_PICK.salt), one draw, so nothing else on the floor depends on the pick
 *   stairwell     the boss room's center floor tile; on other floors the boss room is empty and holds it from the start
 *   roster        the room kinds the run meets on the floor (endlessRoster): swarmers plus seeded kinds, one more
 *                 every ROSTER.floorsPerKind floors, from the run seed's own stream hash(run seed, ROSTER.salt); it
 *                 only closes kinds in the spender, so the layout, digest, props, boss pick, spawn and stairwell never
 *                 depend on it. Every endless world ignores the unlock floors (EndlessFloorOptions.unlockFloors
 *                 false: shared/run rosterUnlockFloors, docs/DAILY.md DSD17 / DSD18): the seed's order alone decides
 *                 which kind joins on each floor
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
 *   affixes       elite affixes per planned room spawn (./affixes.ts, docs/ENEMY_VARIANTS.md EV6), from their own
 *                 stream hash(floor seed, AFFIXES.salt); nothing above reads them
 *   loot          the breakables that hold a boost (./breakableLoot.ts, docs/BREAKABLE_DROPS.md BL1), from their
 *                 own stream hash(floor seed, BREAKABLE_LOOT.salt), reading the placed pieces; nothing above reads it
 *   pellets       the room pellets and the rare power pellet (./pellets.ts, docs/PELLETS.md PL1), from their own
 *                 stream hash(floor seed, PELLETS.salt), reading the layout, spawns and placed pieces; nothing above
 *                 reads it
 *   vault         opt-in (EndlessFloorOptions.vaults; off: no draw, nothing below happens): the floor's vault, if any
 *                 (./vault.ts, docs/TREASURE.md TR1), from its own stream hash(floor seed, VAULT.salt), reading
 *                 the layout, spawns, pieces and pellets; its chest is appended to `breakables` after every piece
 *                 (slot = the pieces before it) and its cell leaves roomSpawnTiles; nothing above reads it, so every
 *                 room, prop, spawn, piece, loot slot, affix, pellet and the boss pick are the option-off floor's
 *   pacts         the shrine room's two pact altars (./pacts.ts, docs/FORTUNE.md PS1): no draw, reading the layout,
 *                 the placed pieces (the chest included) and the pellets; nothing above reads it
 *   golden        the Goldling's room and its barrel or crate, if any (./golden.ts, docs/FORTUNE.md GE1,
 *                 docs/GOLDLING_RUMOURS.md GR1), LAST, from its own stream hash(floor seed, GOLDEN_PLACE.salt), reading
 *                 the layout, spawns, pieces (the chest included), pellets and the vault; its piece is appended to
 *                 `breakables` after every other piece (slot golden.piece) and its cell leaves roomSpawnTiles; nothing
 *                 above reads it
 *   secret        opt-in (EndlessFloorOptions.secrets; off: no draw, nothing below happens): the floor's secret room, if
 *                 any (./secrets.ts, docs/SECRET_ROOMS.md SR1), LAST (after the modifier's re-run and the Goldling's
 *                 piece), from its own stream hash(floor seed, SECRET.salt), reading the layout, the spawns, every piece,
 *                 the vault and the altars; its crack pieces and chest are appended after every other piece and the
 *                 room spawn tiles are left as they were (the crack is on WALL cells, the chest in the void); nothing
 *                 above reads it
 *   modifier      opt-in (EndlessFloorOptions.modifiers; off: no draw, `modifier` NONE, every output above as before):
 *                 the floor's modifier (./modifiers.ts, docs/FLOOR_MODIFIERS.md FM1 / FM2), from its own stream
 *                 hash(floor seed, MODIFIERS.salt) and floor n - 1's chance draw, reading the floor built so far
 *                 (eligibility); a pick re-runs its placer forced (Blood Moon: affixes, Plunder: loot, Feast: pellets,
 *                 Hoard: vault, Gilded: golden) and every placer after it, so the layout, digest, props, spawns, pieces
 *                 and boss pick never move, and a floor without a modifier is the option-off floor exactly
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
import {
	placeBreakables,
	withoutBreakableCells,
	type BreakableFloorInput,
	type BreakablePlacement,
} from "./breakables";
import { assignAffixes } from "./affixes";
import { placeBreakableLoot, type BreakableLoot } from "./breakableLoot";
import { placePellets, type FloorPellets } from "./pellets";
import { placeVault, vaultChest, type VaultOverride, type VaultPlan } from "./vault";
import { placePactAltars, type FloorPacts } from "./pacts";
import { goldenPiece, placeGolden, type FloorGolden } from "./golden";
import { placeSecret, secretPieces, type FloorSecret, type SecretOverride } from "./secrets";
import { FloorModifier, MODIFIERS, type FloorModifierId } from "./modifiersData";
import {
	pickFloorModifier,
	type FloorModifierOverride,
	type FloorModifierPickInput,
	type FloorModifierWorld,
} from "./modifiers";
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
	ENDLESS_SOLID_DECOR,
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
 * The Forge params of `floor` of the run `runSeed`: the M1 preset plus solid pillars (ENDLESS_SOLID_PILLARS), solid
 * decor (ENDLESS_SOLID_DECOR) and rooms ENDLESS_ROOM_SCALE times as large.
 */
export function endlessFloorParams(runSeed: number, floor: number): ForgeParams {
	return {
		...KALEB_VALE_MVP_PARAMS,
		seed: floorSeed(runSeed, floor),
		roomCount: floorRoomCount(floor),
		solidPillars: ENDLESS_SOLID_PILLARS,
		solidDecor: ENDLESS_SOLID_DECOR,
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
 * the last index down to 1, j = rng.int(0, i), swap i and j (one draw per step: 9 draws for the 10 seeded kinds since
 * docs/NEW_ENEMIES.md NE7, which reshuffled every run's order). Pure.
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
 *
 * `unlockFloors` false (every endless world since docs/DAILY.md DSD18: shared/run rosterUnlockFloors): the unlock
 * floors are ignored, so each join is simply the next kind of rosterOrder(runSeed) and floor 1's seeded kind may be
 * any of them; the roster never waits. True (the default, specs and tools only): exactly the rule above.
 */
export function endlessRoster(runSeed: number, floor: number, unlockFloors = true): string[] {
	const order = rosterOrder(runSeed);
	const roster: string[] = [ROSTER.always];
	for (let f = ENDLESS_FIRST_FLOOR; f <= floor; f++) {
		if (roster.size() > order.size()) break; // every kind is in
		const target = rosterTargetSize(f, order.size());
		while (roster.size() - 1 < target) {
			let joined: string | undefined;
			for (const kind of order) {
				if (!roster.includes(kind) && (!unlockFloors || kindUnlockFloor(kind) <= f)) {
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
 * True when a room on `floor` that has already bought `bought` (count per kind; `boughtTotal` enemies in all) may buy
 * kind `k`: from its unlock floor (EndlessRoomKind.fromFloor), below its room maximum (maxPerRoom), not as the room's
 * first buy when it needsCompany (docs/NEW_ENEMIES.md NED9) and, with a `roster` (endlessRoster), in it. Draws nothing.
 * `unlockFloors` false (every endless world): the unlock floor is not checked (the roster alone gates the kind).
 */
function roomKindOpen(
	k: EndlessRoomKind,
	floor: number,
	bought: ReadonlyMap<string, number>,
	boughtTotal: number,
	roster: ReadonlyArray<string> | undefined,
	unlockFloors: boolean,
): boolean {
	if (unlockFloors && k.fromFloor !== undefined && floor < k.fromFloor) return false;
	if (k.needsCompany === true && boughtTotal < 1) return false;
	if (roster !== undefined && !roster.includes(k.kind)) return false;
	return k.maxPerRoom === undefined || (bought.get(k.kind) ?? 0) < k.maxPerRoom;
}

/**
 * Spends `budget` on the room enemies of a room on `floor` (archetype ids, in spawn order), at most `cap` of them; the
 * costs never add up to more than the budget. Only the kinds open on the floor take part (roomKindOpen: unlocked, below
 * their room maximum, not first when it needs company, and in `roster` when one is given; a closed kind is skipped in
 * both loops below, so it moves no total and no draw). Every endless floor passes its roster (buildEndlessFloor);
 * without one (specs) every unlocked kind is open, as before the roster. Each pick:
 * the affordable open kinds (ENDLESS_ROOM_KINDS) that cost at least budget-left / slots-left (so a big budget buys
 * dearer enemies instead of running out of slots), drawn by weight with one rng draw; when none of them is that dear,
 * the dearest affordable open kind (no draw). Stops when nothing is affordable or the cap is reached.
 * `unlockFloors` false (every endless world, with its roster): kinds open whatever their unlock floor; true (default):
 * as above.
 */
export function spendEncounterBudget(
	rng: DungeonRng,
	budget: number,
	floor: number,
	cap: number = ENDLESS_ROOM_ACTOR_CAP,
	roster?: ReadonlyArray<string>,
	unlockFloors = true,
): string[] {
	const out: string[] = [];
	const bought = new Map<string, number>();
	let left = budget;
	while (out.size() < cap) {
		const need = left / (cap - out.size());
		let total = 0;
		let dearest: EndlessRoomKind | undefined;
		for (const k of ENDLESS_ROOM_KINDS) {
			if (!roomKindOpen(k, floor, bought, out.size(), roster, unlockFloors)) continue;
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
				if (!roomKindOpen(k, floor, bought, out.size(), roster, unlockFloors)) continue;
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
 * One endless room's enemies on `floor`: spendEncounterBudget(tools.rng, budget, floor, cap, roster, unlockFloors), then
 * placement on
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
	unlockFloors = true,
): ActorSpawn[] {
	const d = tools.dungeon;
	const rng = tools.rng;
	const kinds = spendEncounterBudget(rng, budget, floor, ENDLESS_ROOM_ACTOR_CAP, roster, unlockFloors);
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
 * endless floor passes it, buildEndlessFloor; absent, in specs only: every unlocked kind). `unlockFloors` false: every
 * endless world's rule since docs/DAILY.md DSD18 (spendEncounterBudget).
 */
export function endlessRoomSpawns(
	d: Dungeon,
	floor: number,
	partySize = 1,
	roster?: ReadonlyArray<string>,
	unlockFloors = true,
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
		out.push(populateEndlessRoom(room, tools, budget, floor, roster, unlockFloors));
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
	 * Mother Mayhem); undefined: no boss.
	 */
	readonly bossKind?: string;
	/**
	 * The run's seeded roster on this floor (endlessRoster(runSeed, floor, unlockFloors), docs/DAILY.md DS1): the room kinds its rooms
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
	/**
	 * The breakables that hold a boost (./breakableLoot.ts placeBreakableLoot, docs/BREAKABLE_DROPS.md BL1): { slot into
	 * `breakables`, Boost index }, slot order. Absent: none (the tutorial's hand-built floors).
	 */
	readonly breakableLoot?: ReadonlyArray<BreakableLoot>;
	/**
	 * The floor's pellets and its power pellet, if any (./pellets.ts placePellets, docs/PELLETS.md PL1). Absent: none
	 * (the tutorial's hand-built floors).
	 */
	readonly pellets?: FloorPellets;
	/**
	 * The floor's vault (./vault.ts placeVault, docs/TREASURE.md TR1): its chest is `breakables[vault.slot]` (after the
	 * clutter; only the Goldling's piece, when there is one, comes after it). Absent: no vault (option off, below VAULT.fromFloor, a miss, no eligible room, the tutorial's floors).
	 */
	readonly vault?: VaultPlan;
	/**
	 * The shrine room's pact altars (./pacts.ts placePactAltars, docs/FORTUNE.md PS1). Absent: no shrine room, no fit
	 * (the classic shrine stays), or the tutorial's hand-built floors.
	 */
	readonly pactAltars?: FloorPacts;
	/**
	 * The floor's Goldling room, if it rolled one (./golden.ts placeGolden, docs/FORTUNE.md GE1): the room id, its floor
	 * rectangle and walk mask, and its hiding place (docs/GOLDLING_RUMOURS.md GR1): `breakables[golden.piece]`, the last
	 * piece. Absent: no Goldling on this floor (and always on the tutorial's hand-built floors).
	 */
	readonly golden?: FloorGolden;
	/**
	 * The floor's modifier (./modifiers.ts pickFloorModifier, docs/FLOOR_MODIFIERS.md FM1): a FloorModifier id,
	 * FloorModifier.NONE when none (EndlessFloorOptions.modifiers off, a plain floor, the tutorial's floors). Its
	 * effect is already in the parts above (the forced placer); the view reads the id (the card, the chip).
	 */
	readonly modifier: FloorModifierId;
	/**
	 * The floor's secret room, if it rolled one (./secrets.ts placeSecret, docs/SECRET_ROOMS.md SR1): the crack
	 * (`breakables[secret.crackSlot ..]`, kind `crackedWall`), the chamber, the chest (`breakables[secret.chestSlot]`, the
	 * last piece) and the carved dungeon the sim steps on (`secret.dungeon`; `dungeon` above stays the Forge's). Absent:
	 * none (EndlessFloorOptions.secrets off, below SECRET.fromFloor, a miss, no candidate, the tutorial's floors).
	 */
	readonly secret?: FloorSecret;
}

/** Opt-in parts of an endless floor (buildEndlessFloor). Absent or empty: the floor exactly as before them. */
export interface EndlessFloorOptions {
	/** Roll the floor's vault (docs/TREASURE.md): the endless worlds with SimConfig.treasure (TR5) set it. */
	readonly vaults?: boolean;
	/** With `vaults`: the dev world's KV_TreasureDebug override (correction 12). Ignored without `vaults`. */
	readonly vaultOverride?: VaultOverride;
	/**
	 * False: the roster ignores the room kinds' unlock floors (endlessRoster / spendEncounterBudget `unlockFloors`):
	 * every endless world (shared/run rosterUnlockFloors, docs/DAILY.md DSD17 / DSD18). Absent or true: the DSD9 rule
	 * (specs and tools).
	 */
	readonly unlockFloors?: boolean;
	/**
	 * Pick the floor's modifier (docs/FLOOR_MODIFIERS.md FM2: ./modifiers.ts): the world's sim parts, so a modifier is
	 * only picked where its effect will show (the vaults come from `vaults`). Every endless world sets it (shared/run
	 * ENDLESS_MODIFIER_WORLD: all on). Absent: no draw, `modifier` NONE, the floor exactly as before.
	 */
	readonly modifiers?: FloorModifierWorld;
	/** With `modifiers`: the dev world's KV_FloorModifier (FloorModifierOverride). Ignored without `modifiers`. */
	readonly modifierOverride?: FloorModifierOverride;
	/**
	 * Roll the floor's secret room (docs/SECRET_ROOMS.md: ./secrets.ts): the endless worlds with SimConfig.secrets set
	 * it (shared/run endlessRunFloor). Absent: no draw, no `secret`, the floor exactly as before.
	 */
	readonly secrets?: boolean;
	/** With `secrets`: the dev world's KV_SecretDebug override. Ignored without `secrets`. */
	readonly secretOverride?: SecretOverride;
}

/** What the modifier pick reads of floor `floor`'s place in the run `runSeed` (its seed, floor n - 1's seed). Pure. */
export function floorModifierPickInput(runSeed: number, floor: number): FloorModifierPickInput {
	return {
		floor,
		seed: floorSeed(runSeed, floor),
		bossFloor: isBossFloor(floor),
		prevSeed: floorSeed(runSeed, floor - 1),
		prevBossFloor: isBossFloor(floor - 1),
	};
}

/** The floor parts placed after the breakables, in build order (placeFloorParts). */
interface FloorParts {
	readonly roomAffixes: number[][];
	readonly breakableLoot: BreakableLoot[];
	readonly pellets: FloorPellets;
	readonly vault: VaultPlan | undefined;
	/** The breakables with the vault's chest appended, if any. */
	readonly pieces: ReadonlyArray<BreakablePlacement>;
	readonly pactAltars: FloorPacts | undefined;
	readonly golden: FloorGolden | undefined;
}

/** Build order of the parts placeFloorParts re-runs (a modifier re-runs its placer and every one after it). */
const PART_STEP = { affixes: 0, loot: 1, pellets: 2, vault: 3, pacts: 4, golden: 5 } as const;

/** The first part a modifier re-runs (its forced placer); NONE: none. */
function modifierFirstStep(modifier: number): number {
	if (modifier === FloorModifier.BLOOD_MOON) return PART_STEP.affixes;
	if (modifier === FloorModifier.PLUNDER) return PART_STEP.loot;
	if (modifier === FloorModifier.FEAST) return PART_STEP.pellets;
	if (modifier === FloorModifier.HOARD) return PART_STEP.vault;
	if (modifier === FloorModifier.GILDED) return PART_STEP.golden;
	return math.huge;
}

/**
 * The parts after the breakables (affixes, loot, pellets, vault, pact altars, Goldling), each on its own stream. Without
 * `natural`: every part as built today (no force flag). With `natural` (the parts of the same floor built without a
 * modifier): the parts before `modifier`'s placer are kept, its placer runs with its force flag and every later one
 * runs again on the forced outputs.
 */
function placeFloorParts(
	input: BreakableFloorInput,
	floor: number,
	breakables: ReadonlyArray<BreakablePlacement>,
	options: EndlessFloorOptions | undefined,
	modifier: number,
	natural?: FloorParts,
): FloorParts {
	const from = natural === undefined ? 0 : modifierFirstStep(modifier);
	const seed = input.seed;
	const encounter = input.encounter;
	// Affixes run after everything else, on their own rng stream (./affixes.ts): nothing above moves.
	const roomAffixes =
		natural === undefined || from <= PART_STEP.affixes
			? assignAffixes(
					seed,
					floor,
					encounter.rooms,
					input.roomSpawns,
					modifier === FloorModifier.BLOOD_MOON
						? { sharePercent: MODIFIERS.bloodMoon.sharePercent }
						: undefined,
			  )
			: natural.roomAffixes;
	// Loot reads the placed pieces, on its own rng stream (./breakableLoot.ts): nothing above moves.
	const breakableLoot =
		natural === undefined || from <= PART_STEP.loot
			? placeBreakableLoot(
					seed,
					floor,
					breakables,
					encounter,
					modifier === FloorModifier.PLUNDER ? { everyRoom: true } : undefined,
			  )
			: natural.breakableLoot;
	// Pellets run last, on their own rng stream (./pellets.ts), reading the layout and the placed pieces: nothing
	// above moves.
	const pellets =
		natural === undefined || from <= PART_STEP.pellets
			? placePellets(
					input,
					floor,
					breakables,
					modifier === FloorModifier.FEAST ? { powerCertain: true } : undefined,
			  )
			: natural.pellets;
	// The vault runs next, on its own rng stream (./vault.ts), reading everything above: nothing above moves. Its chest
	// is appended after every piece, so loot slots and pellet cells never include it. Hoard: `every` (the dev world's
	// tier / lock kept).
	const devVault = options?.vaultOverride;
	const vaultOverride: VaultOverride | undefined =
		modifier !== FloorModifier.HOARD
			? devVault
			: devVault !== undefined
			? { ...devVault, every: true }
			: { every: true };
	const vault =
		natural === undefined || from <= PART_STEP.vault
			? options?.vaults === true
				? placeVault(input, floor, breakables, pellets, vaultOverride)
				: undefined
			: natural.vault;
	const pieces = vault !== undefined ? [...breakables, vaultChest(vault)] : breakables;
	// Pact altars, drawing nothing, reading the layout, the pieces (the chest included) and the pellets: nothing above
	// moves.
	const pactAltars =
		natural === undefined || from <= PART_STEP.pacts ? placePactAltars(input, pieces, pellets) : natural.pactAltars;
	// The Goldling runs last, on its own rng stream (./golden.ts), reading the layout, the room spawns, the pieces (the
	// chest included), the pellets and the vault: nothing above moves. Its barrel or crate is appended by the caller.
	const golden =
		natural === undefined || from <= PART_STEP.golden
			? placeGolden(
					{ ...input, pieces, pellets, vault },
					floor,
					modifier === FloorModifier.GILDED ? { certain: true } : undefined,
			  )
			: natural.golden;
	return { roomAffixes, breakableLoot, pellets, vault, pieces, pactAltars, golden };
}

/**
 * Builds floor `floor` of the run `runSeed` for a party of `partySize` (room budgets scale with it; the layout does
 * not); `dungeonFor` generates (or returns the cached) layout for the params. `options` turns on the opt-in parts
 * (vaults); without them the floor is exactly what it was before they existed.
 */
export function buildEndlessFloor(
	runSeed: number,
	floor: number,
	dungeonFor: (params: ForgeParams) => Dungeon,
	partySize = 1,
	options?: EndlessFloorOptions,
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
	const unlockFloors = options?.unlockFloors !== false;
	const roster = endlessRoster(runSeed, floor, unlockFloors);
	const roomSpawns = endlessRoomSpawns(d, floor, partySize, roster, unlockFloors);
	const stairwell = { x: bossRoom.cx, z: bossRoom.cz };
	// Breakables run last, on their own rng stream (./breakables.ts): nothing above moves.
	const breakables = placeBreakables(
		{ seed: params.seed, dungeon: d, encounter, roomSpawns, spawn, stairwell },
		floor,
	);
	// Affixes, loot, pellets, the vault, the pact altars and the Goldling, each on its own stream (placeFloorParts).
	const input = { seed: params.seed, dungeon: d, encounter, roomSpawns, spawn, stairwell };
	let parts = placeFloorParts(input, floor, breakables, options, FloorModifier.NONE);
	// The modifier reads the floor built so far, on its own stream (./modifiers.ts); a pick re-runs its placer forced and
	// every placer after it. Off: no draw, nothing moves.
	let modifier: FloorModifierId = FloorModifier.NONE;
	const world = options?.modifiers;
	if (world !== undefined) {
		const natural = { ...input, floor, breakables, ...parts };
		modifier = pickFloorModifier(
			floorModifierPickInput(runSeed, floor),
			natural,
			{ ...world, vaults: options?.vaults === true },
			options?.modifierOverride,
		);
		if (modifier !== FloorModifier.NONE)
			parts = placeFloorParts(input, floor, breakables, options, modifier, parts);
	}
	const { roomAffixes, breakableLoot, pellets, vault, pieces, pactAltars, golden } = parts;
	// The Goldling's own barrel or crate (docs/GOLDLING_RUMOURS.md RD11) is appended after every other piece, so every
	// earlier slot (loot's, the chest's) keeps its index; only the room spawn tiles below lose its cell.
	const floorPieces = golden !== undefined ? [...pieces, goldenPiece(golden)] : pieces;
	// The secret room (docs/SECRET_ROOMS.md SR1) runs last, on its own stream (./secrets.ts), reading every piece above:
	// nothing above moves. Its crack pieces and chest are appended after every other piece; the room spawn tiles keep
	// the list without them (the crack stands on WALL cells and the chest in the void: no spawn tile holds either).
	const secret =
		options?.secrets === true
			? placeSecret({ ...input, pieces: floorPieces, vault, pactAltars }, floor, options.secretOverride)
			: undefined;
	const allPieces = secret !== undefined ? [...floorPieces, ...secretPieces(secret)] : floorPieces;
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
		roomSpawnTiles: withoutBreakableCells(endlessRoomSpawnTiles(d, roomSpawns), floorPieces),
		spawn: { x: spawn.x, z: spawn.z },
		stairwell,
		breakables: allPieces,
		roomAffixes,
		breakableLoot,
		pellets,
		vault,
		pactAltars,
		golden,
		modifier,
		secret,
	};
}
