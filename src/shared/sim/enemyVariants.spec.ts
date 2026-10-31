// docs/ENEMY_VARIANTS.md EV1 scaffolding: the port band for the new room enemies (no recorded index moves), the actor
// modifier choke points (a pure refactor today: walkStep / enemyCooldown / enemyCooldownFixed return exactly what the
// raw reads gave, with the same single draw), and the data rows for the new ids.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEFAULT_ENCOUNTER_COST, encounterCost } from "shared/dungeon";
import {
	BRUISER,
	DEFAULT_SIM_CONFIG,
	DROPS,
	EMPTY_INPUT,
	KILL_POINTS,
	PERCENT,
	PORT_BAND_BOSSES,
	PORT_BAND_ENEMIES,
	PORT_BAND_TUTORIAL,
	SIM_DT,
	SNIPER,
	SWARMER,
	SimCtx,
	actorCooldownPercent,
	actorWalkPercent,
	archetypeIds,
	archetypeIndex,
	createSimState,
	enemyCooldown,
	enemyCooldownFixed,
	walkStep,
	type ActorSpawn,
	type ActorState,
	type SimState,
} from "shared/sim";

const SPAWNS: ActorSpawn[] = [
	{ kind: SWARMER.id, x: 4, z: 4 },
	{ kind: SNIPER.id, x: -4, z: 4 },
	{ kind: BRUISER.id, x: 4, z: -4 },
];
const CONFIG = {
	...DEFAULT_SIM_CONFIG,
	encounter: { spawns: SPAWNS, rooms: [], entranceRoom: -1, bossRoom: -1 },
};

function setup(): { s: SimState; ctx: SimCtx; actors: ActorState[] } {
	const s = createSimState(7, 0, 0, CONFIG);
	const ctx = new SimCtx().bind(s, CONFIG, EMPTY_INPUT);
	const actors: ActorState[] = [];
	for (const sp of SPAWNS) for (const a of s.combat.actors) if (a.kind === archetypeIndex(sp.kind)) actors.push(a);
	return { s, ctx, actors };
}

describe("registry: PORT_BAND_ENEMIES", () => {
	it("is band 3, after the bosses; the recorded indices 0..8 are unchanged", () => {
		expect([PORT_BAND_TUTORIAL, PORT_BAND_BOSSES, PORT_BAND_ENEMIES]).toEqual([1, 2, 3]);
		// The first nine (the band-3 enemies of EV2-EV4 number after them).
		const ids = archetypeIds();
		const head: string[] = [];
		for (let i = 0; i < ids.size(); i++) head.push(ids[i]);
		expect(head).toEqual([
			"boss.act1",
			"bruiser",
			"sniper",
			"swarmer",
			"turret.caster",
			"turret.sniper",
			"turret.sprayer",
			"dummy",
			"boss.demonlord",
			"imp", // band PORT_BAND_ENEMIES (docs/ENEMY_VARIANTS.md): indices 9-12
			"slime",
			"slime.small",
			"summoner",
		]);
	});
});

describe("actor modifier choke points (a pure refactor today)", () => {
	it("both percent sources are 100 for every room enemy", () => {
		const { ctx, actors } = setup();
		expect(actors.size()).toBe(3);
		for (const a of actors) {
			expect(actorWalkPercent(ctx, a)).toBe(PERCENT);
			expect(actorCooldownPercent(ctx, a)).toBe(PERCENT);
		}
	});

	it("walkStep is exactly data.speed * SIM_DT", () => {
		const { ctx, actors } = setup();
		for (const a of actors) expect(walkStep(ctx, a)).toBe(ctx.data(a).speed * SIM_DT);
	});

	it("enemyCooldown draws exactly one randomInt(min, max) and returns it; the fixed form draws nothing", () => {
		const a = setup();
		const b = setup();
		expect(a.s.rngState).toBe(b.s.rngState);
		for (let k = 0; k < 20; k++) {
			const actor = a.actors[k % 3];
			const got = enemyCooldown(a.ctx, actor, 60, 144);
			expect(got).toBe(b.ctx.randomInt(60, 144));
			expect(a.s.rngState).toBe(b.s.rngState);
		}
		const before = a.s.rngState;
		expect(enemyCooldownFixed(a.ctx, a.actors[2], BRUISER.data.firstSlam)).toBe(BRUISER.data.firstSlam);
		expect(a.s.rngState).toBe(before);
	});
});

describe("data rows for the new ids", () => {
	it("encounter cost, kill points and drop chance", () => {
		expect(["imp", "slime", "summoner"].map(encounterCost)).toEqual([2, 3, 3]);
		expect(encounterCost("slime.small")).toBe(DEFAULT_ENCOUNTER_COST);
		expect(["imp", "slime", "slime.small", "summoner"].map((id) => KILL_POINTS.get(id))).toEqual([
			120, 150, 40, 200,
		]);
		expect(["imp", "slime", "slime.small", "summoner"].map((id) => DROPS.chanceByArchetype.get(id))).toEqual([
			6, 8, 2, 10,
		]);
	});
});
