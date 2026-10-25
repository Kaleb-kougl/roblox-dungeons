/**
 * Encounter placement: the web build's src/bullets/enemyRooms.test.ts and the placeEncounter / encounterRooms parts of
 * src/bullets/setup.test.ts, ported to jest-globals. The sim's archetype registry is not imported (the dungeon module
 * stays independent of the sim): archetype ids are checked against the registry index table of fixtures/README.md.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_ENCOUNTER,
	DOOR_CLEARANCE,
	EMPTY_ENCOUNTER,
	ENEMY_BUDGET,
	KALEB_VALE_MVP_PARAMS,
	ROOM_CAP,
	TEST_TURRET_KINDS,
	TileType,
	criticalPathRooms,
	encounterRooms,
	entranceRoom,
	generateDungeon,
	placeEncounter,
	populateEnemies,
	populatedRooms,
	roomAt,
	roomBudget,
	roomDoorways,
	roomFloorTiles,
	tileAt,
	worldToGrid,
	type ActorSpawn,
	type Dungeon,
	type EncounterRoom,
	type RoomTools,
} from "shared/dungeon";
import { hypot2 } from "shared/jsmath";
import { firstDiff } from "./fixtureDiff";

/** The sim's archetype registry ids (fixtures/README.md porting note 5). */
const ARCHETYPE_IDS = ["boss.act1", "bruiser", "sniper", "swarmer", "turret.caster", "turret.sniper", "turret.sprayer"];

const SEEDS = [1337, 42, 7, 2024, 1, 2, 3, 99];
const dungeon = (seed: number) => generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
const roomOf = (d: Dungeon, s: { x: number; z: number }) => d.roomId[worldToGrid(s.z) * d.W + worldToGrid(s.x)];
const POPULATE_ONLY = { populate: populateEnemies };

function spawnsKey(spawns: ReadonlyArray<ActorSpawn>): string {
	return spawns.map((s) => `${s.kind}@${s.x},${s.z}`).join(";");
}

describe("populateEnemies (the default encounter)", () => {
	it("is the default encounter: room enemies only, no sandbox turrets, no boss from this field", () => {
		expect(DEFAULT_ENCOUNTER.populate).toBe(populateEnemies);
		const e = placeEncounter(dungeon(1337), DEFAULT_ENCOUNTER);
		for (const s of e.spawns) expect(["swarmer", "sniper", "bruiser", DEFAULT_ENCOUNTER.boss]).toContain(s.kind);
	});

	for (const seed of SEEDS) {
		it(`is deterministic per seed (seed ${seed})`, () => {
			const a = placeEncounter(dungeon(seed), POPULATE_ONLY);
			const b = placeEncounter(dungeon(seed), POPULATE_ONLY);
			expect(firstDiff(a, b)).toBeUndefined();
			expect(a.spawns.size()).toBeGreaterThan(0);
		});
	}

	it("different seeds give different encounters", () => {
		const sigs = new Set(SEEDS.map((seed) => spawnsKey(placeEncounter(dungeon(seed), POPULATE_ONLY).spawns)));
		expect(sigs.size()).toBe(SEEDS.size());
	});

	for (const seed of SEEDS) {
		it(`places only in critical-path combat / elite rooms, never entrance or boss, on open floor (seed ${seed})`, () => {
			const d = dungeon(seed);
			const { spawns } = placeEncounter(d, POPULATE_ONLY);
			const path = criticalPathRooms(d);
			const populated = populatedRooms(d);
			const perRoom = new Map<number, number>();
			const seen = new Set<string>();
			for (const s of spawns) {
				expect(ARCHETYPE_IDS).toContain(s.kind);
				const gx = worldToGrid(s.x);
				const gy = worldToGrid(s.z);
				expect([s.x, s.z]).toEqual([gx, gy]); // tile centers (TILE_SIZE 1)
				expect(tileAt(d, gx, gy)).toBe(TileType.FLOOR);
				// Open: all 8 neighbours are floor too (room for the bruiser's body; nothing hugs a wall or a pit).
				for (let oy = -1; oy <= 1; oy++)
					for (let ox = -1; ox <= 1; ox++) expect(tileAt(d, gx + ox, gy + oy)).toBe(TileType.FLOOR);
				const room = roomOf(d, s);
				expect(room).never.toBe(d.entrance);
				expect(room).never.toBe(d.boss);
				expect(path).toContain(room);
				expect(["combat", "elite"]).toContain(d.rooms[room].type);
				perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
				const key = `${s.x},${s.z}`;
				expect(seen.has(key)).toBe(false); // one actor per tile
				seen.add(key);
			}
			// Every populated room got something, within its budget; the floor stays within the total budget.
			expect(perRoom.size()).toBe(populated.size());
			for (const id of populated) {
				const n = perRoom.get(id) ?? 0;
				expect(n <= math.min(ROOM_CAP, roomBudget(d))).toBe(true);
				expect(n).toBeGreaterThan(0);
			}
			expect(spawns.size() <= ENEMY_BUDGET).toBe(true);
		});
	}

	it("keeps spawns away from the doorways, so packs are seen coming", () => {
		let total = 0;
		let clear = 0;
		for (let seed = 1; seed <= 40; seed++) {
			const d = dungeon(seed);
			for (const s of placeEncounter(d, POPULATE_ONLY).spawns) {
				const doors = roomDoorways(d, roomOf(d, s));
				expect(doors.size()).toBeGreaterThan(0); // path rooms always have a way in
				total++;
				if (doors.every((door) => hypot2(door.x - s.x, door.z - s.z) >= DOOR_CLEARANCE)) clear++;
			}
		}
		expect(clear / total).toBeGreaterThan(0.95); // only rooms too cramped for it relax the rule
	});

	it("scales with depth: across many floors every group appears, deeper rooms hold more, early rooms stay light", () => {
		const kinds = new Set<string>();
		let shallow = 0;
		let shallowRooms = 0;
		let deep = 0;
		let deepRooms = 0;
		let bruiserInFirstRoom = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const d = dungeon(seed);
			const { spawns } = placeEncounter(d, POPULATE_ONLY);
			const per = new Map<number, string[]>();
			for (const s of spawns) {
				kinds.add(s.kind);
				const r = roomOf(d, s);
				const list = per.get(r) ?? [];
				list.push(s.kind);
				per.set(r, list);
			}
			for (const [r, list] of per) {
				const diff = d.rooms[r].difficulty;
				if (diff < 0.4) {
					shallow += list.size();
					shallowRooms++;
					if (diff < 0.35 && list.includes("bruiser") && d.rooms[r].type !== "elite") bruiserInFirstRoom++;
				} else if (diff >= 0.6) {
					deep += list.size();
					deepRooms++;
				}
				// A bruiser always comes with its two swarmers; packs are 3..6.
				if (list.includes("bruiser")) expect(list.filter((k) => k === "swarmer").size() >= 2).toBe(true);
			}
		}
		expect(kinds.has("bruiser") && kinds.has("sniper") && kinds.has("swarmer")).toBe(true);
		expect(kinds.size()).toBe(3);
		expect(deep / deepRooms).toBeGreaterThan(shallow / shallowRooms);
		expect(bruiserInFirstRoom).toBe(0); // bruisers only from difficulty 0.35 (or elite rooms)
	});
});

describe("placeEncounter (the sandbox turrets, setup.test.ts)", () => {
	const TURRETS = { nearest: TEST_TURRET_KINDS };
	for (const seed of [1337, 42, 7, 2024]) {
		it(`puts one turret of each kind on a floor tile in the nearest rooms (seed ${seed})`, () => {
			const d = dungeon(seed);
			const turrets = placeEncounter(d, TURRETS).spawns;
			expect(turrets.map((t) => t.kind)).toEqual([...TEST_TURRET_KINDS]);
			const entrance = entranceRoom(d);
			const rooms = turrets.map((t) => d.roomId[worldToGrid(t.z) * d.W + worldToGrid(t.x)]);
			expect(new Set(rooms).size()).toBe(turrets.size()); // one per room
			let lastDepth = 0;
			for (let i = 0; i < turrets.size(); i++) {
				const t = turrets[i];
				expect(tileAt(d, worldToGrid(t.x), worldToGrid(t.z))).toBe(TileType.FLOOR);
				expect(math.floor(t.x) === t.x && math.floor(t.z) === t.z).toBe(true); // tile centers
				const room = d.rooms[rooms[i]];
				expect(room.id).never.toBe(entrance.id);
				expect(room.id).never.toBe(d.boss);
				expect(room.depth >= lastDepth).toBe(true); // nearest (by corridor depth) first
				lastDepth = room.depth;
			}
			expect(d.rooms[rooms[0]].depth).toBe(1);
		});
	}

	it("is pure: the same dungeon gives the same encounter", () => {
		const a = placeEncounter(dungeon(99), TURRETS);
		const b = placeEncounter(dungeon(99), TURRETS);
		expect(firstDiff(a, b)).toBeUndefined();
		expect(
			firstDiff(placeEncounter(dungeon(99), DEFAULT_ENCOUNTER), placeEncounter(dungeon(99), DEFAULT_ENCOUNTER)),
		).toBeUndefined();
		expect(placeEncounter(dungeon(99), { nearest: ["turret.caster"] }).spawns).toEqual([
			{ kind: "turret.caster", x: a.spawns[0].x, z: a.spawns[0].z },
		]);
	});

	it("places the boss on the boss room center and runs the room populator per room, seeded per room", () => {
		const d = dungeon(1337);
		const seen: number[] = [];
		const options = {
			populate: (room: EncounterRoom, tools: RoomTools): ReadonlyArray<ActorSpawn> => {
				seen.push(room.id);
				if (room.type !== "combat") return [];
				const floor = tools.floor();
				const tile = floor[math.floor(tools.rng.next() * floor.size())];
				return [{ kind: "swarmer", x: tile.x, z: tile.z }];
			},
			boss: "boss.test",
		};
		const e = placeEncounter(d, options);
		const again = placeEncounter(d, options);
		expect(firstDiff(e, again)).toBeUndefined();
		expect(seen.includes(d.entrance)).toBe(false); // the entrance is never populated
		const boss = e.spawns[e.spawns.size() - 1];
		expect(boss.kind).toBe("boss.test");
		expect(e.bossRoom).toBe(d.boss);
		expect([boss.x, boss.z]).toEqual([e.rooms[d.boss].cx, e.rooms[d.boss].cz]);
		const swarmers = e.spawns.filter((s) => s.kind === "swarmer");
		expect(swarmers.size()).toBe(d.rooms.filter((r) => r.type === "combat").size());
		for (const s of swarmers) expect(tileAt(d, worldToGrid(s.x), worldToGrid(s.z))).toBe(TileType.FLOOR);
	});
});

describe("DEFAULT_ENCOUNTER (the game's run, setup.test.ts)", () => {
	for (const seed of [1337, 42, 7, 2024]) {
		it(`room enemies from populateEnemies, no sandbox turrets, then boss.act1 on the boss room center (seed ${seed})`, () => {
			const d = dungeon(seed);
			expect(DEFAULT_ENCOUNTER.nearest).toEqual([]);
			expect(DEFAULT_ENCOUNTER.populate).toBe(populateEnemies);
			expect(DEFAULT_ENCOUNTER.boss).toBe("boss.act1");
			const e = placeEncounter(d, DEFAULT_ENCOUNTER);
			const kinds = e.spawns.map((sp) => sp.kind);
			for (const k of kinds) expect(TEST_TURRET_KINDS.includes(k)).toBe(false);
			// Exactly the populator's room enemies (each room is seeded on its own), the boss appended last.
			const rooms = placeEncounter(d, POPULATE_ONLY).spawns;
			expect(e.spawns.size()).toBe(rooms.size() + 1);
			expect(
				firstDiff(
					rooms,
					e.spawns.filter((_s, i) => i < rooms.size()),
				),
			).toBeUndefined();
			expect(rooms.size()).toBeGreaterThan(10);
			expect(rooms.size() <= ENEMY_BUDGET).toBe(true);
			for (const s of rooms) expect(["swarmer", "sniper", "bruiser"]).toContain(s.kind);
			const boss = e.spawns[e.spawns.size() - 1];
			expect(boss.kind).toBe("boss.act1");
			expect(e.bossRoom).toBe(d.boss);
			expect([boss.x, boss.z]).toEqual([e.rooms[d.boss].cx, e.rooms[d.boss].cz]);
		});
	}
});

describe("encounterRooms (setup.test.ts) and roomAt", () => {
	for (const seed of [1337, 42]) {
		it(`gives every room its world bounds, center floor tile and type (seed ${seed})`, () => {
			const d = dungeon(seed);
			const rooms = encounterRooms(d);
			expect(rooms.size()).toBe(d.rooms.size());
			for (const r of rooms) {
				const src = d.rooms[r.id];
				expect(r.type).toBe(src.type);
				expect(r.depth).toBe(src.depth);
				const tiles = roomFloorTiles(d, r.id);
				expect(tiles.size()).toBe(r.floorTiles);
				expect(r.floorTiles).toBeGreaterThan(0);
				for (const t of tiles) expect(t.x > r.minX && t.x < r.maxX && t.z > r.minZ && t.z < r.maxZ).toBe(true);
				expect(tileAt(d, worldToGrid(r.cx), worldToGrid(r.cz))).toBe(TileType.FLOOR);
				expect(d.roomId[worldToGrid(r.cz) * d.W + worldToGrid(r.cx)]).toBe(r.id);
				expect(roomAt({ ...EMPTY_ENCOUNTER, rooms }, r.cx, r.cz)).toBeDefined();
			}
			expect(rooms[d.boss].type).toBe("boss");
			expect(roomAt(EMPTY_ENCOUNTER, 0, 0)).toBeUndefined();
		});
	}
});
