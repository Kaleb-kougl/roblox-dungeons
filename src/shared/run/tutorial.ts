/**
 * The tutorial world ("Practice Descent", docs/TUTORIAL.md "Architecture §2"; a Roblox-port feature, no web source):
 * an endless run with two hand-scripted floors, harmless hits and a wounded start. Pure and Roblox-API-free, like
 * buildEndlessRunConfig, and the seed it is given is ignored: every tutorial run is the same world.
 *
 *   config   { endless: { runSeed: TUTORIAL.runSeed, worldForFloor }, scoring: ENDLESS_SCORING,
 *              tutorial: { harmless: true, startHalfHearts: TUTORIAL.startHalfHearts,
 *              bossHpPercent: TUTORIAL.bossHpPercent, guardLock: TUTORIAL_GUARD_LOCK, pelletLock: TUTORIAL_PELLET_LOCK },
 *              drops: TUTORIAL_DROPS_CONFIG, pellets: PELLETS_CONFIG };
 *            pellets only in combat G on floor 1 (tutorialPellets, docs/PELLETS.md PL11: not placePellets, no power
 *            pellet); no `breakables`
 *            (docs/DECOR.md B7: no barrels or crates in the tutorial, and its hand-built layouts carry none); drops
 *            only as the one guaranteed Fury from combat B's last swarmer (docs/BOOSTS.md B9)
 *   layouts  tutorialForgeParams: an endless floor's Forge params (endlessFloorParams: solid pillars, double-size
 *            rooms, ...) with a fixed seed (floor 1: and the lesson chain); every floor's world is endlessFloorWorld
 *            (the endless floor's movers, bullet blocker and the enemies' steering round pillars), so it plays like a
 *            real floor
 *   floor 1  "The Training Halls": a Forge chain floor (ForgeParams.chain: TUTORIAL_ROOMS in lesson order, one short
 *            corridor from each room to the next and no other way, the TUTORIAL.floor1 seed for the theme and the
 *            decoration), NOT a boss floor (the stairwell is open from the start, in the boss room, the last one).
 *            Its deferred room spawns come from
 *            TUTORIAL_ROOMS (one lesson per room, explicit kinds), not the encounter budget; the treasure and shrine
 *            rooms keep their M2 pedestal and curse shrine (progression keys off the room types); the entrance and
 *            the stairwell room are empty.
 *   floor 2  "Mother Bramble": the TUTORIAL.floor2 layout as a boss floor (the boss is its only spawn; the stairwell
 *            opens on her death). Stepping into it ends the tutorial (the client stops the run on the 2 -> 3 change).
 *   floor 3+ never played (the client stops first), but the sim always asks for the next floor: floor 2's layout,
 *            empty and with an open stairwell, so the change (and a debug skip past it) never throws.
 *
 * Enemy hp and bullet speed scale as on endless floor 1 / Depth 1 on every floor (shared/sim tutorialScalingFloor),
 * so the training dummy has its 8 hp; Mother Bramble is the Depth 1 fight at TUTORIAL.bossHpPercent of her hp (the
 * sim's TutorialSimConfig.bossHpPercent), so the practice boss falls fast. The block lesson's bruiser (combat D) cannot
 * die until the player has blocked a bullet with the sword's guard (TutorialSimConfig.guardLock: TUTORIAL_GUARD_LOCK);
 * the pellet lesson's sniper (combat G) cannot die until every pellet of its room is taken (TutorialSimConfig.pelletLock:
 * TUTORIAL_PELLET_LOCK, docs/PELLETS.md PL12). Solo only: a party throws.
 */
import { TUTORIAL } from "shared/config";
import { stableSort } from "shared/jsmath";
import {
	BOSS_ACT1_KIND,
	BRUISER_KIND,
	ENDLESS_FIRST_FLOOR,
	NO_POWER_PELLET,
	SNIPER_KIND,
	SWARMER_KIND,
	cellKey,
	encounterRooms,
	endlessFloorParams,
	entranceSpawn,
	generateDungeon,
	pelletPatternCells,
	placeEncounter,
	roomSpawnTiles,
	worldToGrid,
	type ActorSpawn,
	type Dungeon,
	type EncounterRoom,
	type EncounterRoomType,
	type EndlessFloorLayout,
	type FloorPellets,
	type ForgeChainDir,
	type ForgeChainRoom,
	type ForgeParams,
	type PelletPattern,
	type RoomShape,
	type TileXZ,
	type WorldXZ,
} from "shared/dungeon";
import {
	Boost,
	DEFAULT_PARTY_SIZE,
	DUMMY_KIND,
	PELLETS_CONFIG,
	guaranteedDropsConfig,
	type DropsConfig,
	type TutorialGuardLock,
	type TutorialPelletLock,
	type SimConfig,
} from "shared/sim";
import { ENDLESS_SCORING, endlessFloorWorld, type EndlessRunFloor, type EndlessRunSetup } from "./endless";
import { coverTiles, tutorialRoomTools, tutorialTour } from "./tutorialLayout";

/** The tutorial's world kind in the run world registry (worlds.ts). Never leaderboard-eligible. */
export const TUTORIAL_WORLD_KIND = "tutorial";

/** Turret archetype ids (the sim's registry; no populator places them, so there is no shared constant). */
export const TURRET_SNIPER_KIND = "turret.sniper";
export const TURRET_SPRAYER_KIND = "turret.sprayer";

/**
 * Floor 1's rooms in lesson order (docs/TUTORIAL.md "Floor 1" table: combat A-F are lessons 3-8; combat G, the pellet
 * lesson, follows F: docs/PELLETS.md PL11, PD13).
 */
export type TutorialLessonId =
	| "entrance"
	| "combatA"
	| "combatB"
	| "combatC"
	| "combatD"
	| "combatE"
	| "combatF"
	| "combatG"
	| "treasure"
	| "shrine"
	| "stairwell";

/**
 * Where a lesson room's spawns stand (on the room's spawn tiles, enemyRooms roomSpawnTiles):
 *   cluster  around the tile nearest the room centre, each at least TUTORIAL.clusterSpacingTiles from the others
 *   far      each on the tile farthest from the door the player comes in by and from the spawns placed before it
 *   cover    "far" among the tiles behind a solid pillar as seen from that door (tutorialLayout coverTiles); "far"
 *            over every spawn tile when the room has none
 */
export type TutorialPlacement = "cluster" | "far" | "cover";

/** One floor-1 room of the tutorial, as data (TUTORIAL_ROOMS): a room of the floor's chain and its lesson. */
export interface TutorialRoomPlan {
	readonly lesson: TutorialLessonId;
	/** Room id on floor 1: the room's place in the chain (the lock spec pins it). */
	readonly roomId: number;
	/**
	 * The Forge room type the lesson needs: the run's pedestals stand in its treasure rooms, its shrine in the first
	 * shrine room, its stairwell in the boss room (shared/sim progression, endless).
	 */
	readonly roomType: EncounterRoomType;
	/**
	 * The room's footprint and shape (ForgeChainRoom: tiles before the endless room scale; combat and elite rooms grow
	 * to the endless minimum, like a rolled room).
	 */
	readonly w: number;
	readonly h: number;
	readonly shape: RoomShape;
	/** Which side of this room the next lesson's room lies on (TUTORIAL.floor1.corridorTiles away); none on the last. */
	readonly next?: ForgeChainDir;
	/** Archetype ids spawned when the player first walks in (deferred), in spawn order. */
	readonly kinds: ReadonlyArray<string>;
	readonly placement: TutorialPlacement;
	/**
	 * The room's pellet pattern (docs/PELLETS.md PL11: combat G only), laid by tutorialPellets at TUTORIAL.pellets'
	 * inset and cap. Absent: no pellets (every other room).
	 */
	readonly pellets?: PelletPattern;
}

/**
 * Floor 1's rooms in tour order: the entrance, combat A-G, the treasure room, the shrine and the boss room (the open
 * stairwell). Floor 1 IS this list: a Forge chain floor (ForgeParams.chain, tutorialChain) with one short corridor
 * from each room to the next and nothing else, laid out as a snake of three rows (entrance -> A -> B east, down to C,
 * C -> D -> E west, down to F, F -> G -> treasure -> shrine -> boss east). Combat G (docs/PELLETS.md PL11, PD13 / PD15):
 * one sniper over a ring of pellets, held by the sweep lock until every pellet is taken.
 */
export const TUTORIAL_ROOMS: ReadonlyArray<TutorialRoomPlan> = table.freeze([
	{
		lesson: "entrance",
		roomId: 0,
		roomType: "entrance",
		w: 6,
		h: 6,
		shape: "rect",
		next: "e",
		kinds: [],
		placement: "far",
	},
	{
		lesson: "combatA",
		roomId: 1,
		roomType: "combat",
		w: 8,
		h: 8,
		shape: "rect",
		next: "e",
		kinds: [DUMMY_KIND, DUMMY_KIND],
		placement: "cluster",
	},
	{
		lesson: "combatB",
		roomId: 2,
		roomType: "combat",
		w: 8,
		h: 8,
		shape: "oct",
		next: "s",
		kinds: [SWARMER_KIND, SWARMER_KIND, SWARMER_KIND],
		placement: "cluster",
	},
	{
		lesson: "combatC",
		roomId: 3,
		roomType: "combat",
		w: 9,
		h: 8,
		shape: "rect",
		next: "w",
		kinds: [SNIPER_KIND],
		placement: "far",
	},
	{
		lesson: "combatD",
		roomId: 4,
		roomType: "elite",
		w: 9,
		h: 9,
		shape: "oct",
		next: "w",
		kinds: [BRUISER_KIND],
		placement: "far",
	},
	{
		lesson: "combatE",
		roomId: 5,
		roomType: "combat",
		w: 9,
		h: 9,
		shape: "rect",
		next: "s",
		kinds: [TURRET_SNIPER_KIND],
		placement: "cover",
	},
	{
		lesson: "combatF",
		roomId: 6,
		roomType: "combat",
		w: 9,
		h: 8,
		shape: "rect",
		next: "e",
		kinds: [TURRET_SPRAYER_KIND, TURRET_SPRAYER_KIND],
		placement: "far",
	},
	{
		lesson: "combatG",
		roomId: 7,
		roomType: "combat",
		w: 9,
		h: 9,
		shape: "rect",
		next: "e",
		kinds: [SNIPER_KIND],
		placement: "far",
		pellets: "ring",
	},
	{
		lesson: "treasure",
		roomId: 8,
		roomType: "treasure",
		w: 6,
		h: 6,
		shape: "ellipse",
		next: "e",
		kinds: [],
		placement: "far",
	},
	{
		lesson: "shrine",
		roomId: 9,
		roomType: "shrine",
		w: 6,
		h: 6,
		shape: "oct",
		next: "e",
		kinds: [],
		placement: "far",
	},
	{ lesson: "stairwell", roomId: 10, roomType: "boss", w: 9, h: 9, shape: "rect", kinds: [], placement: "far" },
]);

function planOf(lesson: TutorialLessonId): TutorialRoomPlan {
	for (const p of TUTORIAL_ROOMS) if (p.lesson === lesson) return p;
	error(`tutorial: no room for lesson ${lesson}`, 0);
}

/** Floor 1's special room ids (from TUTORIAL_ROOMS). */
export const TUTORIAL_ENTRANCE_ROOM = planOf("entrance").roomId;
export const TUTORIAL_TREASURE_ROOM = planOf("treasure").roomId;
export const TUTORIAL_SHRINE_ROOM = planOf("shrine").roomId;
export const TUTORIAL_STAIRWELL_ROOM = planOf("stairwell").roomId;

/**
 * The tutorial's one boost (docs/BOOSTS.md B9): the last of combat B's swarmers always drops a Fury, and nothing
 * else ever drops (guaranteedDropsConfig: no random drops, no pity). The director's `boost` step (funnel step 6)
 * teaches it.
 */
export const TUTORIAL_BOOST_LESSON: TutorialLessonId = "combatB";
export const TUTORIAL_BOOST_ROOM = planOf(TUTORIAL_BOOST_LESSON).roomId;
export const TUTORIAL_BOOST_KIND: number = Boost.FURY;

/** SimConfig.drops of every tutorial run: only the guaranteed Fury on floor 1's combat B. */
export const TUTORIAL_DROPS_CONFIG: DropsConfig = guaranteedDropsConfig([
	{ floor: ENDLESS_FIRST_FLOOR, room: TUTORIAL_BOOST_ROOM, kind: TUTORIAL_BOOST_KIND },
]);

/**
 * The block lesson (docs/TUTORIAL.md "Decisions" 9): combat D's bruiser is held at 1 hp until the player blocks a
 * bullet with the sword's guard (the sim's TutorialSimConfig.guardLock), so the `guard` step is never waived.
 */
export const TUTORIAL_GUARD_LESSON: TutorialLessonId = "combatD";
export const TUTORIAL_GUARD_ROOM = planOf(TUTORIAL_GUARD_LESSON).roomId;
export const TUTORIAL_GUARD_LOCK: TutorialGuardLock = table.freeze({
	floor: ENDLESS_FIRST_FLOOR,
	room: TUTORIAL_GUARD_ROOM,
});

/**
 * The pellet lesson (docs/PELLETS.md PL11 / PL12, PD13 / PD14): combat G's pellets (tutorialPellets) and its sniper,
 * held at 1 hp until every pellet is taken (the sim's TutorialSimConfig.pelletLock), so the `pellets` step's `sweep`
 * skill is never waived.
 */
export const TUTORIAL_PELLET_LESSON: TutorialLessonId = "combatG";
export const TUTORIAL_PELLET_ROOM = planOf(TUTORIAL_PELLET_LESSON).roomId;
export const TUTORIAL_PELLET_LOCK: TutorialPelletLock = table.freeze({
	floor: ENDLESS_FIRST_FLOOR,
	room: TUTORIAL_PELLET_ROOM,
});

/** A floor-1 room with its geometry: what the director (T4) and the world marker (T6) read. */
export interface TutorialRoom extends TutorialRoomPlan {
	/** The room's centre floor tile (world): the pedestal, the shrine and the stairwell stand here. */
	readonly center: WorldXZ;
	/**
	 * Where the walk from the previous tour room enters this room (world: the last corridor tile before its floor),
	 * the marker's target. The entrance's is its centre (the spawn).
	 */
	readonly door: WorldXZ;
	/** The room's deferred spawns (world positions on its floor tiles), in spawn order. */
	readonly spawns: ReadonlyArray<ActorSpawn>;
}

// ---------------------------------------------------------------------------------------------
// Layouts

/**
 * A tutorial floor's Forge params for a hand-picked (seed, room count): an endless floor's params
 * (`endlessFloorParams`: the M1 preset plus every endless option, e.g. solid pillars and the room scale) with that seed
 * and room count, and on floor 1 the lesson chain (`chain`, then roomCount is its size). Derived, so a change to
 * endless floors reaches the tutorial too (the lock spec's digests flag it). The seed search
 * (scripts/lune/find-tutorial-seed.luau) builds its candidates through this.
 */
export function tutorialForgeParams(
	seed: number,
	roomCount: number,
	chain?: ReadonlyArray<ForgeChainRoom>,
): ForgeParams {
	const params: ForgeParams = { ...endlessFloorParams(TUTORIAL.runSeed, ENDLESS_FIRST_FLOOR), seed, roomCount };
	if (chain !== undefined) params.chain = chain;
	return params;
}

let chain: ReadonlyArray<ForgeChainRoom> | undefined;

/** Floor 1's Forge chain (ForgeParams.chain): TUTORIAL_ROOMS in order, TUTORIAL.floor1.corridorTiles apart. */
export function tutorialChain(): ReadonlyArray<ForgeChainRoom> {
	if (chain === undefined) {
		chain = table.freeze(
			TUTORIAL_ROOMS.map(
				(p): ForgeChainRoom => ({
					type: p.roomType,
					w: p.w,
					h: p.h,
					shape: p.shape,
					next: p.next,
					gap: p.next !== undefined ? TUTORIAL.floor1.corridorTiles : undefined,
				}),
			),
		);
	}
	return chain;
}

/** The Forge params of tutorial floor `floor` (the first: TUTORIAL.floor1's chain, every later one: TUTORIAL.floor2). */
export function tutorialFloorParams(floor: number): ForgeParams {
	if (floor === ENDLESS_FIRST_FLOOR) {
		const c = tutorialChain();
		return tutorialForgeParams(TUTORIAL.floor1.seed, c.size(), c);
	}
	return tutorialForgeParams(TUTORIAL.floor2.seed, TUTORIAL.floor2.roomCount);
}

const dungeons = new Map<number, Dungeon>();

/** Tutorial floor `floor`'s dungeon (every floor after the first shares TUTORIAL.floor2's). Generated once, never mutated. */
export function tutorialDungeon(floor: number): Dungeon {
	const key = floor === ENDLESS_FIRST_FLOOR ? ENDLESS_FIRST_FLOOR : TUTORIAL.lastFloor;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(tutorialFloorParams(key));
		dungeons.set(key, d);
	}
	return d;
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

/** `plan`'s spawns on `open` (row order; see TutorialPlacement). Ties go to the earlier tile. Pure. */
function placeLesson(
	plan: TutorialRoomPlan,
	room: EncounterRoom,
	open: ReadonlyArray<TileXZ>,
	door: WorldXZ,
): ActorSpawn[] {
	const out: ActorSpawn[] = [];
	const used = new Set<TileXZ>();
	if (plan.placement === "cluster") {
		let anchor: TileXZ | undefined;
		for (const t of open)
			if (anchor === undefined || dist2(t.x, t.z, room.cx, room.cz) < dist2(anchor.x, anchor.z, room.cx, room.cz))
				anchor = t;
		if (anchor === undefined) return out;
		const a = anchor;
		const byAnchor = stableSort(
			open.map((t, i) => ({ t, i, d: dist2(t.x, t.z, a.x, a.z) })),
			(p, q) => (p.d !== q.d ? p.d - q.d : p.i - q.i),
		);
		const minD2 = TUTORIAL.clusterSpacingTiles * TUTORIAL.clusterSpacingTiles;
		for (const kind of plan.kinds) {
			let pick: TileXZ | undefined;
			for (const c of byAnchor) {
				if (used.has(c.t)) continue;
				let apart = true;
				for (const s of out) if (dist2(c.t.x, c.t.z, s.x, s.z) < minD2) apart = false;
				if (apart) {
					pick = c.t;
					break;
				}
			}
			if (pick === undefined) break;
			used.add(pick);
			out.push({ kind, x: pick.x, z: pick.z });
		}
		return out;
	}
	for (const kind of plan.kinds) {
		let pick: TileXZ | undefined;
		let best = -1;
		for (const t of open) {
			if (used.has(t)) continue;
			let m = dist2(t.x, t.z, door.x, door.z);
			for (const s of out) m = math.min(m, dist2(t.x, t.z, s.x, s.z));
			if (m > best) {
				best = m;
				pick = t;
			}
		}
		if (pick === undefined) break;
		used.add(pick);
		out.push({ kind, x: pick.x, z: pick.z });
	}
	return out;
}

interface Floor1Plan {
	readonly rooms: ReadonlyArray<TutorialRoom>;
	readonly roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>;
	readonly roomSpawnTiles: ReadonlyArray<ReadonlyArray<TileXZ>>;
	readonly pellets: FloorPellets;
}

let floor1Plan: Floor1Plan | undefined;

function buildFloor1Plan(): Floor1Plan {
	const d = tutorialDungeon(ENDLESS_FIRST_FLOOR);
	const rooms = encounterRooms(d);
	const order = TUTORIAL_ROOMS.map((p) => p.roomId);
	const tour = tutorialTour(d, order);
	const roomSpawns: ActorSpawn[][] = [];
	const spawnTiles: TileXZ[][] = [];
	for (let i = 0; i < rooms.size(); i++) {
		roomSpawns.push([]);
		spawnTiles.push([]);
	}
	const out: TutorialRoom[] = [];
	for (let i = 0; i < TUTORIAL_ROOMS.size(); i++) {
		const plan = TUTORIAL_ROOMS[i];
		const room = rooms[plan.roomId];
		if (room === undefined || room.type !== plan.roomType) {
			error(`tutorial: floor 1 room ${plan.roomId} (${plan.lesson}) is not a ${plan.roomType} room`, 0);
		}
		const center = { x: room.cx, z: room.cz };
		const door = i === 0 ? center : tour.legs[i - 1].door;
		let spawns: ActorSpawn[] = [];
		if (plan.kinds.size() > 0) {
			const open = roomSpawnTiles(d, room, tutorialRoomTools(d, room));
			// "cover": the far rule over the tiles behind a pillar from the door (all spawn tiles when there are none).
			const cover = plan.placement === "cover" ? coverTiles(d, plan.roomId, door) : [];
			spawns = placeLesson(plan, room, cover.size() > 0 ? cover : open, door);
			if (spawns.size() !== plan.kinds.size()) error(`tutorial: room ${plan.roomId} has too few spawn tiles`, 0);
			roomSpawns[plan.roomId] = spawns;
			spawnTiles[plan.roomId] = open;
		}
		out.push({ ...plan, center, door: { x: door.x, z: door.z }, spawns });
	}
	return { rooms: out, roomSpawns, roomSpawnTiles: spawnTiles, pellets: tutorialPellets(d, rooms, roomSpawns) };
}

/**
 * Floor 1's pellets (docs/PELLETS.md PL11): every TUTORIAL_ROOMS room with a `pellets` pattern (combat G) lays it with
 * the endless pattern walker (shared/dungeon pelletPatternCells) at TUTORIAL.pellets.insetTiles, capped at
 * TUTORIAL.pellets.max, on the room's FLOOR cells but its spawns' cells (the room's floor is one region,
 * checkTutorialChain, so every pellet is reachable). Not placePellets: no pattern or inset draw, no minimum, no power
 * pellet (PD16). Rooms in TUTORIAL_ROOMS order (room id order). Pure.
 */
export function tutorialPellets(
	d: Dungeon,
	rooms: ReadonlyArray<EncounterRoom>,
	roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>,
): FloorPellets {
	const tiles: TileXZ[] = [];
	const ids: number[] = [];
	for (const plan of TUTORIAL_ROOMS) {
		const pattern = plan.pellets;
		const room = rooms[plan.roomId];
		if (pattern === undefined || room === undefined) continue;
		const spawnCells = new Set<number>();
		for (const s of roomSpawns[plan.roomId] ?? []) spawnCells.add(cellKey(worldToGrid(s.x), worldToGrid(s.z)));
		const cells = pelletPatternCells(
			d,
			room,
			pattern,
			TUTORIAL.pellets.insetTiles,
			TUTORIAL.pellets.max,
			(gx, gy) => !spawnCells.has(cellKey(gx, gy)),
		);
		for (const c of cells) {
			tiles.push(c);
			ids.push(plan.roomId);
		}
	}
	return { tiles, room: ids, power: NO_POWER_PELLET };
}

function plan1(): Floor1Plan {
	if (floor1Plan === undefined) floor1Plan = buildFloor1Plan();
	return floor1Plan;
}

/** Floor 1's rooms in tour order, with their geometry and spawns (generated once). */
export function tutorialRooms(): ReadonlyArray<TutorialRoom> {
	return plan1().rooms;
}

/** The floor-1 room of `lesson`. */
export function tutorialRoom(lesson: TutorialLessonId): TutorialRoom {
	for (const r of tutorialRooms()) if (r.lesson === lesson) return r;
	error(`tutorial: no room for lesson ${lesson}`, 0);
}

function emptyPerRoom<T>(n: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < n; i++) out.push([]);
	return out;
}

/** Builds tutorial floor `floor` (uncached). */
function buildTutorialFloor(floor: number): EndlessRunFloor {
	const d = tutorialDungeon(floor);
	const bossFloor = floor === TUTORIAL.lastFloor;
	// Mother Bramble, always (the endless boss pick, bossKindFor, is not used here).
	const bossKind = bossFloor ? BOSS_ACT1_KIND : undefined;
	const encounter = placeEncounter(d, { boss: bossKind });
	const bossRoom = encounter.rooms[d.boss];
	if (bossRoom === undefined) error(`tutorial: floor ${floor} has no boss room`, 0);
	const plan = floor === ENDLESS_FIRST_FLOOR ? plan1() : undefined;
	const n = encounter.rooms.size();
	const roomSpawns = plan !== undefined ? plan.roomSpawns : emptyPerRoom<ActorSpawn>(n);
	const spawnTiles = plan !== undefined ? plan.roomSpawnTiles : emptyPerRoom<TileXZ>(n);
	const spawn = entranceSpawn(d);
	const params = tutorialFloorParams(floor);
	const layout: EndlessFloorLayout = {
		floor,
		seed: params.seed,
		roomCount: params.roomCount,
		dungeon: d,
		bossFloor,
		bossKind,
		encounter,
		roomSpawns,
		roomSpawnTiles: spawnTiles,
		spawn: { x: spawn.x, z: spawn.z },
		stairwell: { x: bossRoom.cx, z: bossRoom.cz },
		// Combat G's pellets on floor 1 (tutorialPellets); none on any later floor.
		pellets: plan !== undefined ? plan.pellets : undefined,
	};
	// The endless floor's world (movers, bullet blocker, the enemies' steering mover, ...) on the tutorial layout.
	return endlessFloorWorld(layout);
}

/** Floors 1 and 2 are kept; past the last floor only the floor asked for last (a debug skip may keep going). */
function tutorialFloorCache(): (floor: number) => EndlessRunFloor {
	const kept = new Map<number, EndlessRunFloor>();
	let last: EndlessRunFloor | undefined;
	return (floor) => {
		if (last !== undefined && last.floor === floor) return last;
		let w = kept.get(floor);
		if (w === undefined) {
			w = buildTutorialFloor(floor);
			if (floor <= TUTORIAL.lastFloor) kept.set(floor, w);
		}
		last = w;
		return w;
	};
}

/**
 * The tutorial run's SimConfig and spawn (see the file comment); hands out each floor like an endless setup. Pure:
 * every call builds an identical world (the dungeons are shared, the floor cache is per setup). Throws for a party.
 */
export function buildTutorialRunConfig(partySize: number = DEFAULT_PARTY_SIZE): EndlessRunSetup {
	if (partySize !== DEFAULT_PARTY_SIZE) {
		error(`buildTutorialRunConfig: the tutorial is solo only, got party size ${tostring(partySize)}`, 0);
	}
	const worldForFloor = tutorialFloorCache();
	const first = worldForFloor(ENDLESS_FIRST_FLOOR);
	const config: SimConfig = {
		endless: { runSeed: TUTORIAL.runSeed, worldForFloor },
		scoring: ENDLESS_SCORING,
		tutorial: {
			harmless: true,
			startHalfHearts: TUTORIAL.startHalfHearts,
			bossHpPercent: TUTORIAL.bossHpPercent,
			guardLock: TUTORIAL_GUARD_LOCK,
			pelletLock: TUTORIAL_PELLET_LOCK,
		},
		drops: TUTORIAL_DROPS_CONFIG,
		pellets: PELLETS_CONFIG,
	};
	return {
		config,
		spawn: { x: first.spawnX, z: first.spawnZ },
		dungeon: first.dungeon,
		endlessFloor: worldForFloor,
	};
}
