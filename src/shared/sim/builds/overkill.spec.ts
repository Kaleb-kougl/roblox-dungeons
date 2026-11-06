// docs/LEGENDARIES.md LG2 (Overkill): the carry (damageActor's ctx.killCarry -> BuildProc.excess: the hit after the cap
// minus the hp left, the floor for every kill by the player's own hit (LGD2 revised), an execute's full hit, the minimum
// carry), the streak (nearest living enemy within OVERKILL_RANGE, the carry as is, no playerHitDamage, one generation
// on, GEN_MAX), what never carries (turrets, bosses), a boss strike under its cap, the BuildEvents feed, and
// determinism with Overkill + Chain Spark + Volatile on a real swarmer pack.
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_ACT1_ID,
	BOW_DATA,
	BUILDS_CONFIG,
	BUILD_RULES,
	Boon,
	BossFightState,
	Button,
	Duo,
	DAMAGE_CAP_WINDOW_SECONDS,
	DEFAULT_BOUNDS,
	EMPTY_INPUT,
	EXECUTIONER_HP_PERCENT,
	KillCause,
	OVERKILL_MIN_CARRY,
	OVERKILL_OWN_HIT_MIN,
	OVERKILL_RANGE,
	SWARMER,
	SWORD_DATA,
	SimCtx,
	TURRET_SPRAYER,
	createSimState,
	grantCard,
	hashState,
	overkill,
	step,
	type ActorState,
	type EncounterRoom,
	type EndlessFloorWorld,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const IDLE = EMPTY_INPUT;

interface ArenaOpts {
	loadout?: ReadonlyArray<string>;
	spawns?: ReadonlyArray<{ kind: string; x: number; z: number }>;
}

function arena(opts: ArenaOpts = {}): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					bounds: DEFAULT_BOUNDS,
					loadout: opts.loadout,
					encounter: { spawns: opts.spawns ?? [], rooms: [], entranceRoom: -1, bossRoom: -1 },
				},
				bossFloor: false,
				spawnX: 0,
				spawnZ: 0,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: [],
				roomIdAt: () => -1,
			};
			cache.set(floor, w);
		}
		return w;
	};
}

function configOf(opts: ArenaOpts = {}): SimConfig {
	return { endless: { runSeed: SEED, worldForFloor: arena(opts) }, scoring: {}, builds: BUILDS_CONFIG };
}

const ARENA = configOf();

function fresh(config: SimConfig = ARENA): SimState {
	return createSimState(SEED, 0, 0, config);
}

function ctxOf(s: SimState, config: SimConfig = ARENA): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

/** A stationary 'test.dummy' with `hp` (full), a target from this tick on. */
function dummy(ctx: SimCtx, x: number, z: number, hp = 10): ActorState {
	const a = ctx.spawnActor("test.dummy", x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

function setLevel(s: SimState, boon: number, level: number, player = 0): void {
	s.builds!.players[player].levels[boon] = level;
}

/** A hit of `dmg` on `a` by player 0's own weapon (gen 0). */
function hitWith(ctx: SimCtx, a: ActorState, dmg: number): void {
	ctx.actingPlayer(0);
	ctx.damageActor(a, dmg);
}

function overkillOwner(): SimState {
	const s = fresh();
	setLevel(s, Boon.OVERKILL, 1);
	return s;
}

describe("Overkill's carry (LG2)", () => {
	it("a finisher (6) on a 1-hp swarmer carries 5 to the nearest enemy", () => {
		const s = overkillOwner();
		const ctx = ctxOf(s);
		const swarmer = ctx.spawnActor(SWARMER.id, 2, 0)!;
		swarmer.hp = 1;
		swarmer.hpMax = 1;
		const near = dummy(ctx, 4, 0);
		const far = dummy(ctx, 5, 0);
		hitWith(ctx, swarmer, SWORD_DATA.finisherDamage);
		expect(s.builds!.procs.map((q) => q.excess)).toEqual([5]);
		step(s, IDLE, ARENA);
		expect([near.hp, far.hp]).toEqual([5, 10]);
		const e = s.builds!.events;
		expect([e.overkillX1, e.overkillZ1, e.overkillX2, e.overkillZ2]).toEqual([[2], [0], [4], [0]]);
		expect([e.overkillOwner, e.overkillGen, e.overkillCarry]).toEqual([[0], [0], [5]]);
		// The feed is cleared every tick; ctx.killCarry is transient (0 outside the kill line).
		step(s, IDLE, ARENA);
		expect([e.overkillX1.size(), e.overkillCarry.size(), ctx.killCarry]).toEqual([0, 0, 0]);
	});

	it("a bow stream one-shot (1 on a full 1-hp enemy) carries OVERKILL_OWN_HIT_MIN (1)", () => {
		expect(OVERKILL_OWN_HIT_MIN).toBe(1);
		const s = overkillOwner();
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 2, 0, 1);
		const target = dummy(ctx, 4, 0);
		hitWith(ctx, victim, BOW_DATA.damage);
		expect(s.builds!.procs.map((q) => q.excess)).toEqual([1]);
		step(s, IDLE, ARENA);
		expect(target.hp).toBe(9);
	});

	it("every kill by the player's own hit gets the floor, a wounded enemy too (LGD2 revised); a gen-1 kill none", () => {
		const s = overkillOwner();
		const ctx = ctxOf(s);
		// A floor-6 swarmer (2.1 hp) worn to 0.1 hp by earlier arrows, killed by a 1-damage stream arrow: 0.9 over.
		const wounded = dummy(ctx, 2, 0, 2.1);
		wounded.hp = 0.1;
		hitWith(ctx, wounded, BOW_DATA.damage);
		// A wounded 2-hp enemy at 1 hp killed by exactly its hp: 0 over, still the floor.
		const exact = dummy(ctx, 2, 2, 2);
		exact.hp = 1;
		hitWith(ctx, exact, 1);
		const byEffect = dummy(ctx, -2, 0, 1);
		ctx.procGen = 1;
		hitWith(ctx, byEffect, 1);
		ctx.procGen = 0;
		expect(s.builds!.procs.map((q) => [q.gen, q.excess])).toEqual([
			[0, OVERKILL_OWN_HIT_MIN],
			[0, OVERKILL_OWN_HIT_MIN],
			[1, 0],
		]);
	});

	it("a non-full-hp kill by the player's own hit carries 1 to the nearest enemy", () => {
		const s = overkillOwner();
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 2, 0, 4);
		victim.hp = 0.5;
		const target = dummy(ctx, 4, 0);
		hitWith(ctx, victim, 1);
		step(s, IDLE, ARENA);
		expect([target.hp, s.builds!.events.overkillCarry]).toEqual([9, [1]]);
	});

	it("an Executioner execute carries the hit's full damage (LGD3)", () => {
		const s = overkillOwner();
		setLevel(s, Boon.SHARPENED, 3);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 2, 0, 10);
		const target = dummy(ctx, 4, 0, 20);
		// 10 - 8 = 2 hp left = 20 % of 10: executed; the carry is the whole 8, not 8 - 10.
		expect(EXECUTIONER_HP_PERCENT).toBe(20);
		hitWith(ctx, victim, 8);
		expect(victim.alive).toBe(0);
		expect(s.builds!.events.execOwner).toEqual([0]);
		expect(s.builds!.procs.map((q) => q.excess)).toEqual([8]);
		step(s, IDLE, ARENA);
		expect(target.hp).toBe(12);
	});

	it("a 0.5 carry of an effect / streak kill (gen 1, no floor) does nothing (below OVERKILL_MIN_CARRY)", () => {
		expect(OVERKILL_MIN_CARRY).toBe(1);
		const s = overkillOwner();
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 2, 0, 10);
		victim.hp = 1;
		const target = dummy(ctx, 4, 0);
		ctx.procGen = 1;
		hitWith(ctx, victim, 1.5);
		ctx.procGen = 0;
		expect(s.builds!.procs.map((q) => q.excess)).toEqual([0]);
		step(s, IDLE, ARENA);
		expect(target.hp).toBe(10);
		expect(s.builds!.events.overkillX1.size()).toBe(0);
	});

	it("is the carry as is: Sharpened's playerHitDamage is never applied again (LGD4)", () => {
		const s = overkillOwner();
		grantCard(s, 0, Boon.SHARPENED);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 2, 0, 1);
		const target = dummy(ctx, 4, 0);
		hitWith(ctx, victim, 6);
		step(s, IDLE, ARENA);
		expect(target.hp).toBe(5);
	});

	it("only an Overkill owner's procs carry; other on-kill boons see excess 0", () => {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const ctx = ctxOf(s);
		hitWith(ctx, dummy(ctx, 2, 0, 1), 6);
		expect(s.builds!.procs.map((q) => q.excess)).toEqual([0]);
	});
});

describe("Overkill's streak (LG2)", () => {
	it("reaches OVERKILL_RANGE (4 tiles) and no further; no target, the carry is lost", () => {
		const s = overkillOwner();
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 3, 1);
		const inRange = dummy(ctx, OVERKILL_RANGE, 3);
		hitWith(ctx, victim, 3);
		step(s, IDLE, ARENA);
		expect(inRange.hp).toBe(8);
		const s2 = overkillOwner();
		const ctx2 = ctxOf(s2);
		const v2 = dummy(ctx2, 0, 3, 1);
		const out = dummy(ctx2, OVERKILL_RANGE + 0.01, 3);
		hitWith(ctx2, v2, 3);
		step(s2, IDLE, ARENA);
		expect([out.hp, s2.builds!.events.overkillX1.size()]).toEqual([10, 0]);
	});

	it("a chain: each streak kill carries its own excess one tick later, and stops at GEN_MAX (3 carries)", () => {
		const s = overkillOwner();
		const ctx = ctxOf(s);
		const line: ActorState[] = [];
		for (let k = 0; k < 6; k++) line.push(dummy(ctx, -6 + 3 * k, 3, 1));
		hitWith(ctx, line[0], 10);
		const gens: number[][] = [];
		const carries: number[][] = [];
		for (let t = 0; t < 5; t++) {
			step(s, IDLE, ARENA);
			gens.push([...s.builds!.events.overkillGen]);
			carries.push([...s.builds!.events.overkillCarry]);
		}
		expect(BUILD_RULES.genMax).toBe(3);
		expect(gens).toEqual([[0], [1], [2], [], []]);
		// 10 - 1 = 9, then 9 - 1 = 8 and 8 - 1 = 7 (streak kills are gen >= 1: no floor).
		expect(carries).toEqual([[9], [8], [7], [], []]);
		expect(line.map((a) => a.alive)).toEqual([0, 0, 0, 0, 1, 1]);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("a turret kill never carries (revivers never proc)", () => {
		const s = overkillOwner();
		const ctx = ctxOf(s);
		const turret = ctx.spawnActor(TURRET_SPRAYER.id, 2, 0)!;
		const target = dummy(ctx, 4, 0);
		hitWith(ctx, turret, turret.hp + 10);
		expect(turret.alive).toBe(0);
		expect(s.builds!.procs.size()).toBe(0);
		step(s, IDLE, ARENA);
		expect(target.hp).toBe(10);
	});

	it("a boss strike respects its damage cap, and a boss's own kill never carries", () => {
		const s = overkillOwner();
		const room: EncounterRoom = {
			id: 0,
			type: "boss",
			depth: 1,
			cx: 0,
			cz: 0,
			minX: -7,
			maxX: 7,
			minZ: -7,
			maxZ: 7,
			floorTiles: 196,
		};
		const ctx = new SimCtx().bind(
			s,
			{ bounds: DEFAULT_BOUNDS, encounter: { spawns: [], rooms: [room], entranceRoom: -1, bossRoom: 0 } },
			EMPTY_INPUT,
		);
		const boss = ctx.spawnActor(BOSS_ACT1_ID, 0, 3)!;
		boss.aiState = BossFightState.RECOVER; // engaged, final phase: nothing filters the hit
		boss.phase = 3;
		boss.spawnTick = -1; // a target from this tick on
		const victim = dummy(ctx, 0, 1, 1);
		hitWith(ctx, victim, 100);
		const q = s.builds!.procs[0];
		expect(q.excess).toBe(99);
		const before = boss.hp;
		overkill(ctx, s.builds!, q);
		expect([s.builds!.events.overkillX2, s.builds!.events.overkillZ2]).toEqual([[0], [3]]);
		const cap = 6 * DAMAGE_CAP_WINDOW_SECONDS; // boss.act1 damageCapPerSecond 6
		expect(before - boss.hp).toBe(cap);
		expect(s.builds!.events.overkillCarry).toEqual([99]);
		expect([ctx.procGen, ctx.procCause]).toEqual([0, KillCause.NONE]);
		// The boss's own kill: no carry.
		s.builds!.procs.clear();
		boss.hp = 1;
		boss.capBucket = -1;
		for (let k = 0; k < boss.capWindow.size(); k++) boss.capWindow[k] = 0;
		hitWith(ctx, boss, 5);
		expect(boss.alive).toBe(0);
		expect(s.builds!.procs.map((q2) => q2.excess)).toEqual([0]);
	});

	it("a streak's genMax kill never cross-triggers Chain Reaction (only sparks and Volatile bolts do)", () => {
		const s = overkillOwner();
		s.builds!.players[0].duos.push(Duo.CHAIN_REACTION);
		const ctx = ctxOf(s);
		const target = dummy(ctx, 4, 0, 1);
		const bystander = dummy(ctx, 6, 0);
		s.builds!.procs.push({ x: 2, z: 0, owner: 0, gen: BUILD_RULES.genMax - 1, slot: 0, id: 0, excess: 5 });
		step(s, IDLE, ARENA);
		const e = s.builds!.events;
		expect([target.alive, bystander.hp]).toEqual([0, 10]);
		expect([e.overkillGen, e.duoProcDuo, e.sparkX1, e.burstX]).toEqual([[BUILD_RULES.genMax - 1], [], [], []]);
	});

	it("without SimConfig.builds nothing changes: no state, no proc, the kill as before", () => {
		const plain = fresh({ ...ARENA, builds: undefined });
		const ctx = ctxOf(plain);
		const a = dummy(ctx, 2, 0, 1);
		const b = dummy(ctx, 4, 0);
		hitWith(ctx, a, 6);
		step(plain, IDLE, ARENA);
		expect([plain.builds, a.alive, b.hp, ctx.killCarry]).toEqual([undefined, 0, 10, 0]);
	});
});

describe("Overkill + Chain Spark + Volatile on a swarmer pack (LG2)", () => {
	const PACK = [
		[-1.5, 5],
		[-0.5, 5],
		[0.5, 5],
		[1.5, 5],
		[-1, 6],
		[0, 6],
		[1, 6],
		[0, 7],
	] as const;
	const config = configOf({ loadout: ["weapon.bow"], spawns: PACK.map(([x, z]) => ({ kind: SWARMER.id, x, z })) });
	const FIRE_NORTH = frame(0, 0, Button.FIRE, 0, 1);

	function run(): { hashes: string[]; streaks: number; s: SimState } {
		const s = fresh(config);
		setLevel(s, Boon.VOLATILE, 1);
		setLevel(s, Boon.CHAIN_SPARK, 1);
		setLevel(s, Boon.OVERKILL, 1);
		const hashes: string[] = [];
		let streaks = 0;
		for (let t = 0; t < 60; t++) {
			step(s, FIRE_NORTH, config);
			hashes.push(hashState(s));
			streaks += s.builds!.events.overkillX1.size();
		}
		return { hashes, streaks, s };
	}

	it("streaks, clears the pack, and two runs hash the same every tick", () => {
		const a = run();
		const b = run();
		expect(a.streaks).toBeGreaterThan(0);
		expect(a.streaks).toBe(b.streaks);
		expect(a.hashes).toEqual(b.hashes);
		for (let k = 0; k < PACK.size(); k++) expect(a.s.combat.actors[k].alive).toBe(0);
		expect(a.s.events.playerDied).toBe(0);
	});
});
