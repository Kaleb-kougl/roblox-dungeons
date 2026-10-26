// Endless floors (shared/dungeon endless.ts): floor seeds, room counts, boss floors, encounter budgets and their
// deterministic spending, deferred room spawns and their candidate spawn tiles, the stairwell.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_ACT1_KIND,
	DEFAULT_ENCOUNTER_COST,
	ENCOUNTER_COST,
	ENDLESS_ROOM_ACTOR_CAP,
	EncounterRng,
	buildEndlessFloor,
	encounterCost,
	endlessFloorParams,
	endlessRoomSpawnTiles,
	withoutBreakableCells,
	endlessRoomSpawns,
	floorRoomCount,
	floorSeed,
	generateDungeon,
	isBossFloor,
	roomEncounterBudget,
	roomFloorTiles,
	roomIdAt,
	spendEncounterBudget,
	type Dungeon,
	type EndlessFloorLayout,
	type ForgeParams,
} from "shared/dungeon";

const generated = new Map<string, Dungeon>();
function dungeonFor(p: ForgeParams): Dungeon {
	const key = `${p.seed}/${p.roomCount}`;
	let d = generated.get(key);
	if (d === undefined) {
		d = generateDungeon(p);
		generated.set(key, d);
	}
	return d;
}

function costOf(kinds: ReadonlyArray<string>): number {
	let c = 0;
	for (const k of kinds) c += encounterCost(k);
	return c;
}

describe("endless floor derivation", () => {
	it("floor seeds are ((runSeed >>> 0) ^ Math.imul(floor, 0x85ebca6b)) >>> 0 (vectors from V8)", () => {
		expect(floorSeed(1337, 1)).toBe(2246823762);
		expect(floorSeed(1337, 2)).toBe(198676975);
		expect(floorSeed(1337, 5)).toBe(2644177198);
		expect(floorSeed(0, 1)).toBe(2246822507);
		expect(floorSeed(4294967295, 7)).toBe(1452111634);
		expect(floorSeed(42, 100)).toBe(1343951334);
		expect(endlessFloorParams(1337, 2).seed).toBe(198676975);
	});

	it("room count: 12 + floor((floor - 1) / 5), capped at 16", () => {
		const want: Array<[number, number]> = [
			[1, 12],
			[5, 12],
			[6, 13],
			[10, 13],
			[11, 14],
			[16, 15],
			[21, 16],
			[26, 16],
			[100, 16],
		];
		for (const [f, n] of want) expect([f, floorRoomCount(f)]).toEqual([f, n]);
		expect(endlessFloorParams(1, 6).roomCount).toBe(13);
	});

	it("boss floors are 5, 10, 15, ...", () => {
		for (let f = 1; f <= 30; f++) expect([f, isBossFloor(f)]).toEqual([f, f % 5 === 0]);
	});

	it("encounter budget: 6 + 1.2 (floor - 1) per combat room, elite x1.5, other rooms none", () => {
		expect(roomEncounterBudget(1, "combat")).toBe(6);
		expect(roomEncounterBudget(3, "combat")).toBe(8.4);
		expect(roomEncounterBudget(3, "elite")).toBe(12.600000000000001);
		expect(roomEncounterBudget(10, "combat")).toBe(16.799999999999997);
		for (const t of ["entrance", "treasure", "shrine", "boss"] as const) expect(roomEncounterBudget(5, t)).toBe(0);
	});

	it("encounter costs (shared with scoring)", () => {
		expect([encounterCost("swarmer"), encounterCost("sniper"), encounterCost("bruiser")]).toEqual([1, 2, 3]);
		expect(encounterCost("turret.caster")).toBe(2);
		expect(encounterCost("nope")).toBe(DEFAULT_ENCOUNTER_COST);
		expect(ENCOUNTER_COST.size()).toBe(6);
	});
});

describe("spendEncounterBudget", () => {
	it("is deterministic from the rng and never spends more than the budget or the cap", () => {
		for (let seed = 1; seed <= 200; seed++) {
			const budget = 6 + (seed % 40) * 1.7;
			const a = spendEncounterBudget(new EncounterRng(seed), budget);
			const b = spendEncounterBudget(new EncounterRng(seed), budget);
			expect(a).toEqual(b);
			expect(costOf(a) <= budget).toBe(true);
			expect(a.size() <= ENDLESS_ROOM_ACTOR_CAP).toBe(true);
			// Nothing affordable is left unless the cap stopped it.
			if (a.size() < ENDLESS_ROOM_ACTOR_CAP) expect(budget - costOf(a) < 1).toBe(true);
		}
	});

	it("a budget the cap cannot hold in cheap enemies buys dear ones", () => {
		const big = spendEncounterBudget(new EncounterRng(7), 3 * ENDLESS_ROOM_ACTOR_CAP);
		expect(big.size()).toBe(ENDLESS_ROOM_ACTOR_CAP);
		for (const k of big) expect(k).toBe("bruiser");
		expect(spendEncounterBudget(new EncounterRng(7), 0.5)).toEqual([]);
	});
});

describe("buildEndlessFloor", () => {
	const floors: EndlessFloorLayout[] = [];
	for (let f = 1; f <= 6; f++) floors.push(buildEndlessFloor(1337, f, dungeonFor));

	it("generates the floor from its seed and room count", () => {
		for (const fl of floors) {
			expect(fl.seed).toBe(floorSeed(1337, fl.floor));
			expect(fl.dungeon.params.roomCount).toBe(floorRoomCount(fl.floor));
			expect(fl.dungeon.rooms.size()).toBe(fl.roomSpawns.size());
		}
		expect(floors[5].roomCount).toBe(13);
	});

	it("only boss floors place Mother Bramble, on the boss room's center tile; the stairwell is there too", () => {
		for (const fl of floors) {
			const boss = fl.encounter.rooms[fl.dungeon.boss];
			expect([fl.stairwell.x, fl.stairwell.z]).toEqual([boss.cx, boss.cz]);
			expect(roomIdAt(fl.dungeon, fl.stairwell.x, fl.stairwell.z)).toBe(fl.dungeon.boss);
			if (isBossFloor(fl.floor)) {
				expect(fl.bossFloor).toBe(true);
				expect(fl.encounter.spawns).toEqual([{ kind: BOSS_ACT1_KIND, x: boss.cx, z: boss.cz }]);
			} else {
				expect(fl.bossFloor).toBe(false);
				expect(fl.encounter.spawns.size()).toBe(0);
			}
		}
	});

	it("deferred room enemies: combat / elite rooms only, within each room's budget, on the room's own floor", () => {
		let total = 0;
		for (const fl of floors) {
			const d = fl.dungeon;
			for (let id = 0; id < fl.roomSpawns.size(); id++) {
				const spawns = fl.roomSpawns[id];
				const room = fl.encounter.rooms[id];
				const budget = roomEncounterBudget(fl.floor, room.type);
				if (id === d.entrance || id === d.boss || budget === 0) {
					expect(spawns.size()).toBe(0);
					continue;
				}
				const kinds = spawns.map((s) => s.kind);
				expect(costOf(kinds) <= budget).toBe(true);
				expect(spawns.size() <= ENDLESS_ROOM_ACTOR_CAP).toBe(true);
				for (const s of spawns) expect(roomIdAt(d, s.x, s.z)).toBe(id);
				total += spawns.size();
			}
		}
		expect(total).toBeGreaterThan(0);
	});

	it("is pure: the same floor twice gives the same layout", () => {
		const again = buildEndlessFloor(1337, 3, (p) => generateDungeon(p));
		expect(again.roomSpawns).toEqual(floors[2].roomSpawns);
		expect(again.spawn).toEqual(floors[2].spawn);
		expect(again.stairwell).toEqual(floors[2].stairwell);
	});
});

describe("endlessRoomSpawnTiles (where a too-close spawn may move to)", () => {
	const layouts: EndlessFloorLayout[] = [];
	for (const seed of [1337, 42, 7]) for (let f = 1; f <= 6; f++) layouts.push(buildEndlessFloor(seed, f, dungeonFor));

	it("is indexed by room id like roomSpawns, and empty exactly where a room has no deferred enemies", () => {
		for (const fl of layouts) {
			expect(fl.roomSpawnTiles.size()).toBe(fl.roomSpawns.size());
			for (let id = 0; id < fl.roomSpawns.size(); id++)
				expect([id, fl.roomSpawnTiles[id].size() > 0]).toEqual([id, fl.roomSpawns[id].size() > 0]);
		}
	});

	it("holds every planned spawn position, and at least as many tiles as the room has enemies", () => {
		for (const fl of layouts)
			for (let id = 0; id < fl.roomSpawns.size(); id++) {
				const tiles = fl.roomSpawnTiles[id];
				expect(tiles.size() >= fl.roomSpawns[id].size()).toBe(true);
				for (const sp of fl.roomSpawns[id]) expect(tiles.some((t) => t.x === sp.x && t.z === sp.z)).toBe(true);
			}
	});

	it("only lists the room's own floor tiles, once each, in row order (z, then x)", () => {
		for (const fl of layouts) {
			const d = fl.dungeon;
			for (let id = 0; id < fl.roomSpawnTiles.size(); id++) {
				const tiles = fl.roomSpawnTiles[id];
				const floorTiles = roomFloorTiles(d, id);
				for (let i = 0; i < tiles.size(); i++) {
					const t = tiles[i];
					expect(roomIdAt(d, t.x, t.z)).toBe(id);
					expect(floorTiles.some((f) => f.x === t.x && f.z === t.z)).toBe(true);
					if (i > 0) {
						const prev = tiles[i - 1];
						expect(prev.z < t.z || (prev.z === t.z && prev.x < t.x)).toBe(true);
					}
				}
			}
		}
	});

	it("is pure and leaves the planned spawns unchanged", () => {
		const fl = layouts[2];
		const again = buildEndlessFloor(1337, 3, (p) => generateDungeon(p));
		expect(again.roomSpawnTiles).toEqual(fl.roomSpawnTiles);
		// Computing the tiles draws from no rng: the spawns are what endlessRoomSpawns gives on its own.
		expect(fl.roomSpawns).toEqual(endlessRoomSpawns(fl.dungeon, fl.floor));
		// The floor's spawn tiles are these minus the cells its breakables stand on (docs/DECOR.md D4).
		expect(withoutBreakableCells(endlessRoomSpawnTiles(fl.dungeon, fl.roomSpawns), fl.breakables ?? [])).toEqual(
			fl.roomSpawnTiles,
		);
	});

	it("a bigger party gets the same candidate tiles for the same rooms (only budgets scale)", () => {
		const solo = buildEndlessFloor(42, 2, dungeonFor);
		const eight = buildEndlessFloor(42, 2, dungeonFor, 8);
		const soloTiles = endlessRoomSpawnTiles(solo.dungeon, solo.roomSpawns);
		const eightTiles = endlessRoomSpawnTiles(eight.dungeon, eight.roomSpawns);
		for (let id = 0; id < solo.roomSpawns.size(); id++)
			if (solo.roomSpawns[id].size() > 0 && eight.roomSpawns[id].size() > 0)
				expect(eightTiles[id]).toEqual(soloTiles[id]);
		// Breakables keep clear of the party's own spawns, so each floor drops its own pieces' cells from them.
		expect(eight.roomSpawnTiles).toEqual(withoutBreakableCells(eightTiles, eight.breakables ?? []));
		expect(solo.roomSpawnTiles).toEqual(withoutBreakableCells(soloTiles, solo.breakables ?? []));
	});
});
