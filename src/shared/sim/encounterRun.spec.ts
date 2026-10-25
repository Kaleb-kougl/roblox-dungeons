// The encounter checks of src/bullets/enemyRooms.test.ts / setup.test.ts that need the sim's archetype registry (the
// rest is ported actor-free in shared/dungeon/encounter.spec.ts, which checks ids against a hard-coded table): every
// placed kind is a registered archetype (enemyRooms.test.ts `hasArchetype(s.kind)`), the hard-coded table equals the
// registry, and placeEncounter(d, DEFAULT_ENCOUNTER) plugs straight into SimConfig.encounter: createSimState spawns
// spawns[i] into slot i (spawnTick -1, emitter i + 1), with the archetype's data.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_ENCOUNTER,
	KALEB_VALE_MVP_PARAMS,
	TEST_TURRET_KINDS,
	entranceSpawn,
	generateDungeon,
	placeEncounter,
	populateEnemies,
} from "shared/dungeon";
import { archetypeAt, archetypeIds, archetypeIndex, createSimState, hasArchetype, type SimConfig } from "shared/sim";

const SEEDS = [1337, 42, 7, 2024, 1, 2, 3, 99];
const dungeon = (seed: number) => generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });

describe("encounter kinds are registered archetypes", () => {
	it("the registry is the web build's index table (the one shared/dungeon's encounter spec hard-codes)", () => {
		expect([...archetypeIds()]).toEqual([
			"boss.act1",
			"bruiser",
			"sniper",
			"swarmer",
			"turret.caster",
			"turret.sniper",
			"turret.sprayer",
		]);
		for (const k of TEST_TURRET_KINDS) expect([k, hasArchetype(k)]).toEqual([k, true]);
		expect(hasArchetype(DEFAULT_ENCOUNTER.boss!)).toBe(true);
	});

	for (const seed of SEEDS) {
		it(`every room enemy populateEnemies places is a registered archetype (seed ${seed})`, () => {
			const { spawns } = placeEncounter(dungeon(seed), { populate: populateEnemies });
			expect(spawns.size()).toBeGreaterThan(0);
			for (const s of spawns) expect([s.kind, hasArchetype(s.kind)]).toEqual([s.kind, true]);
		});
	}
});

describe("placeEncounter(d, DEFAULT_ENCOUNTER) as SimConfig.encounter", () => {
	for (const seed of [1337, 42]) {
		it(`createSimState spawns every placed actor in order into its own slot (seed ${seed})`, () => {
			const d = dungeon(seed);
			const encounter = placeEncounter(d, DEFAULT_ENCOUNTER);
			const config: SimConfig = { encounter };
			const spawn = entranceSpawn(d);
			const s = createSimState(seed, spawn.x, spawn.z, config);
			const actors = s.combat.actors;
			expect(actors.size()).toBe(encounter.spawns.size());
			for (let i = 0; i < actors.size(); i++) {
				const sp = encounter.spawns[i];
				const a = actors[i];
				const data = archetypeAt(archetypeIndex(sp.kind)).data;
				expect([i, a.kind, a.id, a.spawnTick, a.x, a.z, a.hp, a.radius, a.alive, a.emitterId]).toEqual([
					i,
					archetypeIndex(sp.kind),
					i + 1,
					-1,
					sp.x,
					sp.z,
					data.hp,
					data.radius,
					1,
					i + 1,
				]);
			}
			expect(archetypeAt(actors[actors.size() - 1].kind).id).toBe("boss.act1");
			expect([s.combat.nextActorId, s.combat.enemyEmitters, s.combat.actorsDropped]).toEqual([
				actors.size() + 1,
				actors.size(),
				0,
			]);
		});
	}
});
