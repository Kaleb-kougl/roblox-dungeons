// buildRunConfig: the web build's App.tsx run config from a seed, checked against the dungeon fixture's encounter.
import { describe, expect, it } from "@rbxts/jest-globals";
import dungeon1337 from "shared/fixtures-generated/dungeon-1337";
import { DEFAULT_SIM_CONFIG } from "shared/sim";
import {
	DUNGEON_CACHE_SIZE,
	buildRunConfig,
	cachedDungeonSeeds,
	dungeonForSeed,
	isValidRunSeed,
	type RunSetup,
} from "shared/run";

describe("buildRunConfig (the M1 game run)", () => {
	const setup: RunSetup = buildRunConfig(1337);
	const want = dungeon1337.encounter;

	it("places the same encounter as fixtures/dungeon-1337.json (24 room enemies + the boss in slot 24)", () => {
		const e = setup.config.encounter!;
		expect(e).never.toBe(undefined);
		expect(e.spawns.size()).toBe(want.spawns.size());
		expect(e.spawns.size()).toBe(25);
		expect(e.spawns[24]).toEqual({ kind: "boss.act1", x: 14, z: 25 });
		for (let i = 0; i < want.spawns.size(); i++) {
			const [a, b] = [e.spawns[i], want.spawns[i]];
			expect([a.kind, a.x, a.z]).toEqual([b.kind, b.x, b.z]);
		}
		let swarmers = 0;
		for (const s of e.spawns) if (s.kind === "swarmer") swarmers++;
		let wantSwarmers = 0;
		for (const s of want.spawns) if (s.kind === "swarmer") wantSwarmers++;
		expect(swarmers).toBe(wantSwarmers);
		expect(e.rooms.size()).toBe(want.rooms.size());
		expect(e.entranceRoom).toBe(want.entranceRoom);
		expect(e.bossRoom).toBe(want.bossRoom);
	});

	it("spawns at the entrance, or at the boss door when asked", () => {
		expect(setup.spawn).toEqual({ x: dungeon1337.entranceSpawn.x, z: dungeon1337.entranceSpawn.z });
		const boss = buildRunConfig(1337, { atBossDoor: true });
		expect(boss.spawn).toEqual({ x: dungeon1337.bossDoorSpawn.x, z: dungeon1337.bossDoorSpawn.z });
	});

	it("is App.tsx's config: dungeon collision for player / bullets / actors, default loadout, no stress, no bounds", () => {
		const c = setup.config;
		expect(typeIs(c.moveResolver, "function")).toBe(true);
		expect(typeIs(c.isBulletBlocked, "function")).toBe(true);
		expect(typeIs(c.actorMover, "function")).toBe(true);
		expect(c.loadout).toBe(undefined);
		expect(c.stress).toBe(undefined);
		expect(c.bounds).toBe(undefined);
		expect(setup.dungeon?.W).toBe(dungeon1337.W);
		expect(setup.dungeon?.H).toBe(dungeon1337.H);
		expect(setup.dungeon?.name).toBe(dungeon1337.name);
	});

	it("the other worlds: the floor without enemies, and the greybox arena", () => {
		const bare = buildRunConfig(1337, { world: "dungeonNoEncounter" });
		expect(bare.config.encounter).toBe(undefined);
		expect(typeIs(bare.config.moveResolver, "function")).toBe(true);
		const grey = buildRunConfig(1337, { world: "greybox" });
		expect(grey.config).toBe(DEFAULT_SIM_CONFIG);
		expect(grey.spawn).toBe(undefined);
	});

	it("rejects seeds the web build cannot produce", () => {
		for (const bad of [-1, 1.5, 4294967296, 0 / 0, math.huge]) {
			expect(isValidRunSeed(bad)).toBe(false);
			expect(() => buildRunConfig(bad)).toThrow();
		}
		expect(isValidRunSeed(0)).toBe(true);
		expect(isValidRunSeed(4294967295)).toBe(true);
	});

	it("caches one dungeon per seed, least recently used out first", () => {
		const a = dungeonForSeed(1337);
		expect(dungeonForSeed(1337)).toBe(a);
		for (let s = 1; s <= DUNGEON_CACHE_SIZE; s++) dungeonForSeed(s);
		const seeds = cachedDungeonSeeds();
		expect(seeds.size()).toBe(DUNGEON_CACHE_SIZE);
		expect(seeds.includes(1337)).toBe(false);
		expect(seeds[seeds.size() - 1]).toBe(DUNGEON_CACHE_SIZE);
		expect(dungeonForSeed(1337)).never.toBe(a);
	});
});
