// docs/ENEMY_VARIANTS.md EV4: the Summoner (`summoner`, band PORT_BAND_ENEMIES). Summon caps (EVD3: 3 of ITS summons
// alive, 6 per life), the wither on its death (its own summons only, by id), adoption into its score room, a full
// actor pool, the panic ring's telegraph, and determinism. Hand-built open arenas (no dungeon).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AiState,
	BRUISER,
	EMPTY_INPUT,
	MAX_ACTORS,
	PORT_BAND_ENEMIES,
	SIM_DT,
	SUMMONER,
	SUMMONER_ATTACK_PANIC,
	SUMMONER_ATTACK_SUMMON,
	SUMMONER_BACKOFF,
	SUMMONER_LEFT,
	SUMMONER_SUMMON_FIRST,
	SUMMONER_SUMMON_SLOTS,
	SimCtx,
	V_AGGRO,
	archetypeIds,
	archetypeIndex,
	createSimState,
	hashState,
	step,
	summonerSummonsAlive,
	type ActorSpawn,
	type ActorState,
	type EncounterConfig,
	type EncounterRoom,
	type SimConfig,
	type SimState,
} from "shared/sim";

const enc = (spawns: ActorSpawn[], rooms: EncounterRoom[] = [], entranceRoom = -1): EncounterConfig => ({
	spawns,
	rooms,
	entranceRoom,
	bossRoom: -1,
});

function room(id: number, minX: number, maxX: number, minZ: number, maxZ: number): EncounterRoom {
	return {
		id,
		type: "combat",
		depth: id,
		cx: (minX + maxX) / 2,
		cz: (minZ + maxZ) / 2,
		minX,
		maxX,
		minZ,
		maxZ,
		floorTiles: 1,
	};
}

/** The player can't be hurt (bullets and bodies pass through). */
const ghost = (s: SimState): void => {
	s.player.hurtTicks = 1e6;
};
const summonerOf = (s: SimState): ActorState => {
	const kind = archetypeIndex(SUMMONER.id);
	for (const a of s.combat.actors) if (a.kind === kind) return a;
	error("no summoner", 0);
};
const swarmerKind = (): number => archetypeIndex("swarmer");
const liveSwarmers = (s: SimState): ActorState[] =>
	s.combat.actors.filter((a) => a.kind === swarmerKind() && a.alive === 1);
const kill = (s: SimState, config: SimConfig, a: ActorState): void =>
	new SimCtx().bind(s, config, EMPTY_INPUT).killActor(a);
const summonIds = (a: ActorState): number[] => {
	const out: number[] = [];
	for (let k = 0; k < SUMMONER_SUMMON_SLOTS; k++) out.push(a.v[SUMMONER_SUMMON_FIRST + k]);
	return out;
};
/** Steps until `done` (at most `max` ticks); returns the ticks stepped. */
function runUntil(s: SimState, config: SimConfig, max: number, done: () => boolean): number {
	for (let t = 1; t <= max; t++) {
		step(s, EMPTY_INPUT, config);
		if (done()) return t;
	}
	return -1;
}

describe("summoner: registry and data", () => {
	it("is band PORT_BAND_ENEMIES, after the Demon Lord, and the last band-3 id (index 12 with imp / slime)", () => {
		// In this branch alone the band holds only the summoner; with imp, slime and slime.small registered it is
		// index 12 (compareIds: "slime.small" < "summoner").
		expect(SUMMONER.band).toBe(PORT_BAND_ENEMIES);
		expect(archetypeIndex(SUMMONER.id)).toBeGreaterThan(archetypeIndex("boss.demonlord"));
		const ids = archetypeIds();
		expect(ids[ids.size() - 1]).toBe(SUMMONER.id);
	});

	it("has the plan's body and EVD3 limits, and fires the bruiser's own ring spec", () => {
		const d = SUMMONER.data;
		expect([d.hp, d.radius, d.speed, d.contactDamage, d.spriteId]).toEqual([6, 0.4, 1.8, 0, "enemy.summoner"]);
		expect([d.keepMin, d.keepMax, d.panicRange]).toEqual([6, 9, 3]);
		expect([d.summonPerCast, d.summonMaxAlive, d.summonsPerLife]).toEqual([2, 3, 6]);
		expect(d.summonMaxAlive).toBeLessThanOrEqual(SUMMONER_SUMMON_SLOTS);
		expect([d.summonTelegraphTicks, d.panicTelegraphTicks]).toEqual([60, 30]);
		expect([d.summonCooldownMin, d.summonCooldownMax]).toEqual([270, 330]);
		expect(d.panicRing).toBe(BRUISER.data.ring);
		expect(d.fx!.ring!.state).toBe(AiState.TELEGRAPH);
		expect(d.fx!.ring!.fillTicks).toBe(d.summonTelegraphTicks);
		expect(SUMMONER_ATTACK_SUMMON).never.toBe(SUMMONER_ATTACK_PANIC);
	});
});

describe("summoner: summons", () => {
	it("never has more than 3 of its summons alive, never more than 6 per life", () => {
		const config: SimConfig = { encounter: enc([{ kind: SUMMONER.id, x: 0, z: 8 }]) };
		const s = createSimState(5, 0, 0, config);
		ghost(s);
		const a = summonerOf(s);
		const seen = new Set<number>();
		let maxAlive = 0;
		let casts = 0;
		for (let t = 0; t < 60 * 60; t++) {
			const wasCasting = a.aiState === AiState.TELEGRAPH && a.attack === SUMMONER_ATTACK_SUMMON;
			step(s, EMPTY_INPUT, config);
			if (wasCasting && a.aiState !== AiState.TELEGRAPH) casts++;
			const live = liveSwarmers(s);
			for (const o of live) seen.add(o.id);
			expect(live.size()).toBeLessThanOrEqual(SUMMONER.data.summonMaxAlive);
			expect(summonerSummonsAlive(s.combat.actors, a)).toBe(live.size());
			expect(seen.size()).toBeLessThanOrEqual(SUMMONER.data.summonsPerLife);
			if (live.size() > maxAlive) maxAlive = live.size();
			// At the cap: kill them all so it keeps summoning until its per-life budget is spent.
			if (live.size() === SUMMONER.data.summonMaxAlive) for (const o of live) kill(s, config, o);
		}
		expect(a.alive).toBe(1);
		expect(maxAlive).toBe(SUMMONER.data.summonMaxAlive);
		expect(seen.size()).toBe(SUMMONER.data.summonsPerLife);
		expect(a.v[SUMMONER_LEFT]).toBe(0);
		expect(casts).toBeGreaterThanOrEqual(3);
		// Every summon is engaged, homed where it landed (pushed out of the summoner's centre).
		for (const o of liveSwarmers(s)) expect(o.v[V_AGGRO]).toBe(1);
	});

	it("skips the cast (no telegraph) at the alive cap", () => {
		const config: SimConfig = { encounter: enc([{ kind: SUMMONER.id, x: 0, z: 8 }]) };
		const s = createSimState(9, 0, 0, config);
		ghost(s);
		const a = summonerOf(s);
		runUntil(s, config, 60 * 30, () => liveSwarmers(s).size() === SUMMONER.data.summonMaxAlive);
		expect(liveSwarmers(s).size()).toBe(SUMMONER.data.summonMaxAlive);
		for (let t = 0; t < 60 * 15; t++) {
			step(s, EMPTY_INPUT, config);
			expect(a.attack === SUMMONER_ATTACK_SUMMON && a.aiState === AiState.TELEGRAPH).toBe(false);
		}
		expect(liveSwarmers(s).size()).toBe(SUMMONER.data.summonMaxAlive);
	});

	it("its summons wither on its death; unrelated swarmers in the room do not", () => {
		const spawns: ActorSpawn[] = [
			{ kind: SUMMONER.id, x: 0, z: 8 },
			{ kind: "swarmer", x: 3, z: 0 }, // engaged at once: chases the (ghost) player
			{ kind: "swarmer", x: 0, z: 30 }, // far: idle
		];
		const config: SimConfig = { encounter: enc(spawns) };
		const s = createSimState(3, 0, 0, config);
		ghost(s);
		const a = summonerOf(s);
		const others = liveSwarmers(s);
		expect(others.size()).toBe(2);
		runUntil(s, config, 60 * 10, () => summonerSummonsAlive(s.combat.actors, a) >= 2);
		const ids = summonIds(a).filter((id) => id !== 0);
		expect(ids.size()).toBe(2);
		const summons = s.combat.actors.filter((o) => ids.includes(o.id));
		expect(summons.size()).toBe(2);
		kill(s, config, a);
		expect(s.events.actorsKilled).toBe(1 + summons.size());
		for (const o of summons) expect(o.alive).toBe(0);
		for (const o of others) expect([o.id, o.alive]).toEqual([o.id, 1]);
		expect(summonIds(a)).toEqual([0, 0, 0]);
		step(s, EMPTY_INPUT, config);
		for (const o of others) expect(o.alive).toBe(1);
	});
});

describe("summoner: score room adoption", () => {
	/** Room 0 (the entrance, empty, far away) and room 1 around the summoner and the player. */
	const ROOMS = [room(0, -40, -30, -40, -30), room(1, -15, 15, -15, 15)];
	const config: SimConfig = {
		scoring: {},
		encounter: enc([{ kind: SUMMONER.id, x: 0, z: 8 }], ROOMS, 0),
	};
	const setup = () => {
		const s = createSimState(4, 0, 0, config);
		ghost(s);
		const a = summonerOf(s);
		const r = s.score!.rooms.find((rec) => rec.memberIds.includes(a.id))!;
		runUntil(s, config, 60 * 10, () => summonerSummonsAlive(s.combat.actors, a) >= 2);
		return { s, a, r };
	};

	it("summons join its room record; the room clears only once they are dead", () => {
		const { s, a, r } = setup();
		const ids = summonIds(a).filter((id) => id !== 0);
		expect(ids.size()).toBe(2);
		for (const id of ids) expect(r.memberIds.includes(id)).toBe(true);
		const summons = s.combat.actors.filter((o) => ids.includes(o.id));
		// Test hack: it forgets its summons, so its death withers nothing and they outlive it.
		for (let k = 0; k < SUMMONER_SUMMON_SLOTS; k++) a.v[SUMMONER_SUMMON_FIRST + k] = 0;
		kill(s, config, a);
		for (let t = 0; t < 30; t++) step(s, EMPTY_INPUT, config);
		expect(summons.filter((o) => o.alive === 1).size()).toBe(2);
		expect(r.cleared).toBe(0);
		kill(s, config, summons[0]);
		step(s, EMPTY_INPUT, config);
		expect(r.cleared).toBe(0);
		kill(s, config, summons[1]);
		step(s, EMPTY_INPUT, config);
		expect(r.cleared).toBe(1);
	});

	it("its death withers the summons and the room clears that tick", () => {
		const { s, a, r } = setup();
		expect(r.cleared).toBe(0);
		kill(s, config, a);
		step(s, EMPTY_INPUT, config);
		expect(r.cleared).toBe(1);
	});
});

describe("summoner: a full actor pool", () => {
	it("drops its summons cleanly (no error, actorsDropped counts them, its budget untouched)", () => {
		const spawns: ActorSpawn[] = [{ kind: SUMMONER.id, x: 0, z: 8 }];
		for (let i = 1; i < MAX_ACTORS; i++)
			spawns.push({ kind: "swarmer", x: 100 + 2 * (i % 8), z: 100 + 2 * (i / 8) });
		const config: SimConfig = { encounter: enc(spawns) };
		const s = createSimState(6, 0, 0, config);
		ghost(s);
		expect(s.combat.actors.size()).toBe(MAX_ACTORS);
		expect(s.combat.actorsDropped).toBe(0);
		const a = summonerOf(s);
		let casts = 0;
		for (let t = 0; t < 60 * 10; t++) {
			const wasCasting = a.aiState === AiState.TELEGRAPH && a.attack === SUMMONER_ATTACK_SUMMON;
			step(s, EMPTY_INPUT, config);
			if (wasCasting && a.aiState !== AiState.TELEGRAPH) casts++;
		}
		expect(casts).toBeGreaterThanOrEqual(1);
		expect(s.combat.actorsDropped).toBe(casts * SUMMONER.data.summonPerCast);
		expect(s.combat.actors.size()).toBe(MAX_ACTORS);
		expect(a.v[SUMMONER_LEFT]).toBe(SUMMONER.data.summonsPerLife);
		expect(summonIds(a)).toEqual([0, 0, 0]);
		expect(a.alive).toBe(1);
	});
});

describe("summoner: panic", () => {
	it("fires the bruiser's gapped ring after a >= 30-tick telegraph when the player is close, then backs off", () => {
		const config: SimConfig = { encounter: enc([{ kind: SUMMONER.id, x: 0, z: 2.5 }]) };
		const s = createSimState(2, 0, 0, config);
		ghost(s);
		const a = summonerOf(s);
		let teleTick = -1;
		let fireTick = -1;
		let firstAttack = 0;
		for (let t = 0; t < 60 * 5 && fireTick < 0; t++) {
			// Keep the player 2.5 units in front of it (it backs off from a close player before its cooldown is up).
			s.player.x = a.x;
			s.player.z = a.z - 2.5;
			s.player.prevX = s.player.x;
			s.player.prevZ = s.player.z;
			const before = s.combat.enemySpawned;
			step(s, EMPTY_INPUT, config);
			if (teleTick < 0 && a.aiState === AiState.TELEGRAPH) {
				teleTick = t;
				firstAttack = a.attack;
			}
			if (s.combat.enemySpawned > before) {
				fireTick = t;
				expect(s.combat.enemySpawned - before).toBe(BRUISER.data.ring.count);
			}
		}
		expect(firstAttack).toBe(SUMMONER_ATTACK_PANIC);
		expect(teleTick).toBeGreaterThanOrEqual(0);
		expect(fireTick - teleTick).toBeGreaterThanOrEqual(30);
		expect(fireTick - teleTick).toBe(SUMMONER.data.panicTelegraphTicks);
		expect(a.aiState).toBe(SUMMONER_BACKOFF);
		// Backing off: straight away from the (now still) player, one walk step per tick.
		const p = s.player;
		const d0 = math.sqrt((a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z));
		for (let t = 0; t < SUMMONER.data.backoffTicks; t++) step(s, EMPTY_INPUT, config);
		const d1 = math.sqrt((a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z));
		expect(d1 - d0).toBeCloseTo(SUMMONER.data.backoffTicks * SUMMONER.data.speed * SIM_DT, 6);
		expect(a.aiState).never.toBe(SUMMONER_BACKOFF);
	});
});

describe("summoner: determinism", () => {
	it("two runs from the same seed give identical hashes every tick (summons, panics, wither)", () => {
		const config: SimConfig = {
			encounter: enc([
				{ kind: SUMMONER.id, x: 0, z: 8 },
				{ kind: SUMMONER.id, x: 6, z: -6 },
			]),
		};
		const play = (): string[] => {
			const s = createSimState(1234, 0, 0, config);
			ghost(s);
			const hashes: string[] = [];
			for (let t = 0; t < 60 * 30; t++) {
				// The player strolls in and out of panic range of the first summoner.
				const a = s.combat.actors[0];
				if (t % 300 === 150 && a.alive === 1) {
					s.player.x = a.x + 1;
					s.player.z = a.z - 1.5;
					s.player.prevX = s.player.x;
					s.player.prevZ = s.player.z;
				}
				if (t === 60 * 25 && a.alive === 1) kill(s, config, a);
				step(s, EMPTY_INPUT, config);
				hashes.push(hashState(s));
			}
			return hashes;
		};
		const one = play();
		const two = play();
		expect(one.size()).toBe(two.size());
		for (let t = 0; t < one.size(); t++) if (one[t] !== two[t]) expect([t, one[t]]).toEqual([t, two[t]]);
	});
});
