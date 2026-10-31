// Elite affix assignment (docs/ENEMY_VARIANTS.md EV6, EVD6 / EVD7): its own stream after the Forge (layouts, digests,
// spawns, breakables and the boss pick do not move), never on an excluded kind or below an unlock floor, deterministic,
// and exact elite counts (the shares over the census: affixes.census.spec.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	AFFIX_KIND_COUNT,
	AffixKind,
	affixSeed,
	affixThemeIndex,
	assignAffixes,
	bossKindFor,
	buildEndlessFloor,
	eliteAffixCount,
	endlessFloorParams,
	endlessRoomSpawnTiles,
	endlessRoomSpawns,
	entranceSpawn,
	generateDungeon,
	isAffixExcluded,
	isBossFloor,
	placeBreakables,
	placeEncounter,
	unlockedAffixes,
	withoutBreakableCells,
	type ActorSpawn,
	type Dungeon,
	type EncounterRoom,
	type ForgeParams,
} from "shared/dungeon";
import { AFFIX_IDS } from "shared/theme";

const dungeons = new Map<string, Dungeon>();
function dungeonFor(params: ForgeParams): Dungeon {
	const key = `${params.seed}/${params.roomCount}`;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(params);
		dungeons.set(key, d);
	}
	return d;
}

function unlockOf(kind: number): number {
	for (const u of AFFIXES.unlocks) if (u.kind === kind) return u.fromFloor;
	return math.huge;
}

describe("affix ids and tunables", () => {
	it("numeric ids 1..4 follow the theme's AFFIX_IDS order; unlock floors 4 / 4 / 7 / 9", () => {
		expect([AffixKind.HULKING, AffixKind.SWIFT, AffixKind.SHIELDED, AffixKind.VENGEFUL]).toEqual([1, 2, 3, 4]);
		expect(AFFIX_KIND_COUNT).toBe(AFFIX_IDS.size());
		expect([1, 2, 3, 4].map((k) => AFFIX_IDS[affixThemeIndex(k)])).toEqual([
			"hulking",
			"swift",
			"shielded",
			"vengeful",
		]);
		expect([affixThemeIndex(AffixKind.NONE), affixThemeIndex(5)]).toEqual([-1, -1]);
		expect(AFFIXES.unlocks.map((u) => u.fromFloor)).toEqual([4, 4, 7, 9]);
		expect([unlockedAffixes(3), unlockedAffixes(4), unlockedAffixes(8), unlockedAffixes(9)]).toEqual([
			[],
			[1, 2],
			[1, 2, 3],
			[1, 2, 3, 4],
		]);
		expect(AFFIXES.salt % 2).toBe(1);
		expect(affixSeed(1337)).toBe(bit32.bxor(1337, AFFIXES.salt));
	});

	it("excluded kinds: slime.small, dummy, every turret and boss", () => {
		for (const k of ["slime.small", "dummy", "turret.caster", "turret.sniper", "turret.sprayer", "boss.act1"])
			expect(isAffixExcluded(k)).toBe(true);
		expect(isAffixExcluded("boss.demonlord")).toBe(true);
		for (const k of ["swarmer", "sniper", "bruiser", "imp", "slime", "summoner"])
			expect(isAffixExcluded(k)).toBe(false);
	});

	it("elite count: max(1, ceil(35 % of n)), 0 for an empty room", () => {
		expect([0, 1, 2, 3, 4, 5, 6, 8, 10, 16].map(eliteAffixCount)).toEqual([0, 1, 1, 2, 2, 2, 3, 3, 4, 6]);
	});
});

describe("assignAffixes on hand-built rooms", () => {
	const room = (id: number, roomType: EncounterRoom["type"]): EncounterRoom => ({
		id,
		type: roomType,
		depth: 1,
		cx: 0,
		cz: 0,
		minX: 0,
		maxX: 1,
		minZ: 0,
		maxZ: 1,
		floorTiles: 1,
	});
	const rooms = [room(0, "entrance"), room(1, "elite"), room(2, "combat"), room(3, "treasure")];
	const sp = (kind: string): ActorSpawn => ({ kind, x: 0, z: 0 });
	const spawns: ActorSpawn[][] = [
		[],
		[sp("swarmer"), sp("turret.sniper"), sp("slime.small"), sp("bruiser"), sp("sniper"), sp("dummy")],
		[sp("swarmer"), sp("swarmer"), sp("sniper"), sp("bruiser"), sp("boss.act1")],
		[sp("swarmer")],
	];

	it("has the room spawns' shape; nothing below floor 4; excluded kinds and other room types never", () => {
		for (let floor = 1; floor <= 30; floor++) {
			for (let seed = 0; seed < 40; seed++) {
				const out = assignAffixes(seed * 7919, floor, rooms, spawns);
				expect(out.map((r) => r.size())).toEqual(spawns.map((r) => r.size()));
				for (let id = 0; id < spawns.size(); id++) {
					for (let i = 0; i < spawns[id].size(); i++) {
						const affix = out[id][i];
						if (floor < AFFIXES.eliteFromFloor || isAffixExcluded(spawns[id][i].kind))
							expect(affix).toBe(0);
						if (id === 0 || id === 3) expect(affix).toBe(0);
						if (id === 2 && floor < AFFIXES.combatFromFloor) expect(affix).toBe(0);
						if (affix !== 0) expect(floor >= unlockOf(affix)).toBe(true);
					}
				}
				// Elite room: exactly eliteAffixCount(eligible = 3) members.
				if (floor >= AFFIXES.eliteFromFloor)
					expect(out[1].filter((a) => a !== 0).size()).toBe(eliteAffixCount(3));
			}
		}
	});

	it("is pure: same inputs, same output; inputs untouched", () => {
		const a = assignAffixes(1234, 12, rooms, spawns);
		const b = assignAffixes(1234, 12, rooms, spawns);
		expect(a).toEqual(b);
		expect(spawns[1].map((s) => s.kind)).toEqual([
			"swarmer",
			"turret.sniper",
			"slime.small",
			"bruiser",
			"sniper",
			"dummy",
		]);
	});
});

describe("buildEndlessFloor with affixes: nothing else moves", () => {
	it("encounter, spawns, spawn tiles, breakables and the boss pick equal the pieces built without assignAffixes", () => {
		for (let run = 1; run <= 6; run++) {
			for (const floor of [1, 3, 4, 5, 7, 9, 10, 11, 14]) {
				for (const party of [1, 3]) {
					const l = buildEndlessFloor(run, floor, dungeonFor, party);
					const params = endlessFloorParams(run, floor);
					const d = dungeonFor(params);
					expect(l.dungeon).toBe(d);
					const bossKind = isBossFloor(floor) ? bossKindFor(params.seed) : undefined;
					expect(l.bossKind).toBe(bossKind);
					const encounter = placeEncounter(d, { boss: bossKind });
					expect(l.encounter).toEqual(encounter);
					const roomSpawns = endlessRoomSpawns(d, floor, party);
					expect(l.roomSpawns).toEqual(roomSpawns);
					const spawn = entranceSpawn(d);
					const bossRoom = encounter.rooms[d.boss];
					const stairwell = { x: bossRoom.cx, z: bossRoom.cz };
					const breakables = placeBreakables(
						{ seed: params.seed, dungeon: d, encounter, roomSpawns, spawn, stairwell },
						floor,
					);
					expect(l.breakables).toEqual(breakables);
					expect(l.roomSpawnTiles).toEqual(
						withoutBreakableCells(endlessRoomSpawnTiles(d, roomSpawns), breakables),
					);
					expect(l.roomAffixes).toEqual(assignAffixes(params.seed, floor, encounter.rooms, roomSpawns));
				}
			}
		}
	});

	it("floors 1-3 carry no affix; it is deterministic (two builds agree)", () => {
		for (let run = 1; run <= 10; run++) {
			for (let floor = 1; floor <= 3; floor++) {
				const l = buildEndlessFloor(run, floor, dungeonFor);
				for (const row of l.roomAffixes!) for (const a of row) expect(a).toBe(AffixKind.NONE);
			}
			const a = buildEndlessFloor(run, 12, dungeonFor, 2);
			const b = buildEndlessFloor(run, 12, dungeonFor, 2);
			expect(a.roomAffixes).toEqual(b.roomAffixes);
		}
	});
});
