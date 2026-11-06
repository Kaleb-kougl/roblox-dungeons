// Builds BU3 / BU4 (docs/BUILDS.md "Chain reactions", "The three on-kill boons"): the proc engine (the kill hook on
// damageActor's kill line and what never procs, generations through ctx.procGen and effect sources, the GEN_MAX cap, the
// queue's order / per-tick limit / carry-over, the floor-change clear, leavers, co-op credit, the effect budget and the
// weapon reserve), the three on-kill boons at levels I-II (targets, hops, ranges, counts, damage through
// playerHitDamage), a real swarmer pack cascade with its kill ticks pinned, and determinism.
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_ACT1_ID,
	BUILDS_CONFIG,
	BUILD_RULES,
	Boon,
	Boost,
	BossFightState,
	BuildEffect,
	BulletKind,
	BulletPayload,
	Button,
	CHAIN_SPARK_RANGE,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	DROPS_CONFIG,
	DUMMY_KIND,
	EMPTY_INPUT,
	PARTY_LEFT_BUTTON,
	PLAYER_BULLET_CAPACITY,
	Relic,
	SOUL_SHARDS_RANGE,
	SUMMONER,
	SUMMONER_SUMMON_FIRST,
	SWARMER,
	SimCtx,
	TURRET_SPRAYER,
	buildSource,
	createSimState,
	effectBulletsAlive,
	grantCard,
	grantRelic,
	hashState,
	killGenOfSource,
	step,
	stepParty,
	weaponsAt,
	type ActorState,
	type EndlessFloorWorld,
	type EncounterRoom,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const IDLE = EMPTY_INPUT;
/**
 * The swarmer pack cascade's kill tick per swarmer (spawn order; the spec at the end), pinned from the build. Tick 13:
 * the first arrow kills #1 (gen 0), its spark kills #2 (a gen-1 proc, queued while draining); 14: that proc's spark
 * kills #3 (gen 2); 15: the gen-2 spark kills #6 (a gen-3 kill: nothing queued); 16: tick 13's gen-0 bolts kill two
 * of #0 / #4 / #5 / #7 and those gen-1 procs' sparks the other two the same tick (their gen-2 procs wait for 17 and
 * burst into nothing).
 */
const EXPECTED_KILL_TICKS: number[] = [16, 13, 13, 14, 16, 16, 15, 16];

// ---------------------------------------------------------------------------------------------
// Open endless arenas (the greybox square on every floor, no rooms, stairs out of reach), with builds.

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

function configOf(opts: ArenaOpts = {}, extra: Partial<SimConfig> = {}): SimConfig {
	return { endless: { runSeed: SEED, worldForFloor: arena(opts) }, scoring: {}, builds: BUILDS_CONFIG, ...extra };
}

const ARENA = configOf();
const BOW_ARENA = configOf({ loadout: ["weapon.bow"] });
const PARTY2 = configOf({}, { scoring: { partySize: 2 }, party: { size: 2 } });

function fresh(config: SimConfig = ARENA): SimState {
	return createSimState(SEED, 0, 0, config);
}

function ctxOf(s: SimState, config: SimConfig = ARENA): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

/** A stationary 'test.dummy' with `hp`, a target from this tick on (spawnTick -1, like the run-start spawns). */
function dummy(ctx: SimCtx, x: number, z: number, hp = 10): ActorState {
	const a = ctx.spawnActor("test.dummy", x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

/** Kills `a` with player damage credited to `owner`. */
function kill(ctx: SimCtx, a: ActorState, owner = 0): void {
	ctx.actingPlayer(owner);
	ctx.damageActor(a, a.hp);
}

function setLevel(s: SimState, boon: number, level: number, player = 0): void {
	s.builds!.players[player].levels[boon] = level;
}

interface Shot {
	kind: number;
	source: number;
	damage: number;
	pierce: number;
	emitter: number;
	vx: number;
	vz: number;
}

/** Every live player bullet (dense order). */
function shots(s: SimState): Shot[] {
	const out: Shot[] = [];
	const sim = s.combat.playerBullets;
	sim.forEachActive((i, _pos, payload, emitter) => {
		const v = sim.velocityAt(i);
		out.push({
			kind: BulletPayload.get(payload, "kind"),
			source: BulletPayload.get(payload, "source"),
			damage: BulletPayload.get(payload, "damage"),
			pierce: BulletPayload.get(payload, "pierce"),
			emitter,
			vx: v.x,
			vz: v.z,
		});
		return false;
	});
	return out;
}

function stepUntilDead(s: SimState, a: ActorState, config: SimConfig = ARENA, maxTicks = 60): number {
	for (let t = 0; t < maxTicks; t++) {
		if (a.alive === 0) return t;
		step(s, IDLE, config);
	}
	return -1;
}

// ---------------------------------------------------------------------------------------------

describe("the kill hook (BU3)", () => {
	it("a kill by player damage queues { x, z, owner, gen, slot, id, excess }; stepCombat resolves it the same tick", () => {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 2, 0, 1);
		const target = dummy(ctx, 5, 0);
		kill(ctx, victim);
		// excess (docs/LEGENDARIES.md LG1): Overkill's carry, 0 until LG2's rule.
		expect(s.builds!.procs).toEqual([{ x: 2, z: 0, owner: 0, gen: 0, slot: 0, id: victim.id, excess: 0 }]);
		step(s, IDLE, ARENA);
		expect(s.builds!.procs.size()).toBe(0);
		expect(target.hp).toBe(8);
		const e = s.builds!.events;
		expect([e.sparkX1, e.sparkZ1, e.sparkX2, e.sparkZ2, e.sparkOwner, e.sparkGen]).toEqual([
			[2],
			[0],
			[5],
			[0],
			[0],
			[0],
		]);
		// The feed is cleared every tick.
		step(s, IDLE, ARENA);
		expect([e.sparkX1.size(), e.burstX.size(), e.shardX.size(), e.effectDropped]).toEqual([0, 0, 0, 0]);
	});

	it("nothing queued without an on-kill boon, and nothing at all without SimConfig.builds", () => {
		const s = fresh();
		grantCard(s, 0, Boon.SHARPENED);
		const ctx = ctxOf(s);
		kill(ctx, dummy(ctx, 2, 0, 1));
		expect(s.builds!.procs.size()).toBe(0);
		const plain = fresh({ ...ARENA, builds: undefined });
		const pctx = ctxOf(plain);
		const a = dummy(pctx, 2, 0, 1);
		kill(pctx, a);
		expect([plain.builds, a.alive]).toEqual([undefined, 0]);
	});

	it("never procs: direct killActor (withers, boss sweeps, debug kills), reviving turrets, the training dummy", () => {
		const s = fresh();
		setLevel(s, Boon.VOLATILE, 1);
		const ctx = ctxOf(s);
		const direct = dummy(ctx, 2, 0);
		ctx.killActor(direct);
		const turret = ctx.spawnActor(TURRET_SPRAYER.id, 4, 0)!;
		kill(ctx, turret);
		const training = ctx.spawnActor(DUMMY_KIND, 6, 0)!;
		kill(ctx, training);
		expect([direct.alive, turret.alive, training.alive]).toEqual([0, 0, 0]);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("a summoner's withered summons never proc: only the summoner's own kill queues", () => {
		const s = fresh();
		setLevel(s, Boon.VOLATILE, 1);
		const ctx = ctxOf(s);
		const summoner = ctx.spawnActor(SUMMONER.id, 3, 3)!;
		const a = ctx.spawnActor(SWARMER.id, 2, 4)!;
		const b = ctx.spawnActor(SWARMER.id, 4, 4)!;
		summoner.v[SUMMONER_SUMMON_FIRST] = a.id;
		summoner.v[SUMMONER_SUMMON_FIRST + 1] = b.id;
		kill(ctx, summoner);
		expect([summoner.alive, a.alive, b.alive]).toEqual([0, 0, 0]);
		expect(s.builds!.procs.map((q) => q.id)).toEqual([summoner.id]);
	});

	it("adds swept at a boss's death never proc: only the boss's own kill queues", () => {
		const s = fresh();
		setLevel(s, Boon.VOLATILE, 1);
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
		const add1 = ctx.spawnActor(SWARMER.id, 2, 2)!;
		const add2 = ctx.spawnActor(SWARMER.id, -2, 2)!;
		boss.aiState = BossFightState.RECOVER; // engaged, final phase: nothing filters the killing hit
		boss.phase = 3;
		boss.hp = 1;
		kill(ctx, boss);
		expect([boss.alive, add1.alive, add2.alive]).toEqual([0, 0, 0]);
		expect(s.builds!.procs.map((q) => q.id)).toEqual([boss.id]);
	});
});

describe("generations (BU3)", () => {
	it("a weapon's bullet kills at gen 0; an effect bullet of generation g at g + 1", () => {
		for (const src of [0, 1, 2, 127]) expect(killGenOfSource(src)).toBe(0);
		for (let g = 0; g < 3; g++) expect(killGenOfSource(buildSource(BuildEffect.VOLATILE, g))).toBe(g + 1);
	});

	it("a spark kill procs one generation on, one hop per tick; a generation-3 kill queues nothing (GEN_MAX)", () => {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const ctx = ctxOf(s);
		const line: ActorState[] = [];
		for (let k = 0; k < 6; k++) line.push(dummy(ctx, -6 + 3 * k, 3, 1));
		kill(ctx, line[0]);
		const gens: number[][] = [];
		const queued: number[][] = [];
		for (let t = 0; t < 5; t++) {
			step(s, IDLE, ARENA);
			gens.push([...s.builds!.events.sparkGen]);
			queued.push(s.builds!.procs.map((q) => q.gen));
		}
		expect(BUILD_RULES.genMax).toBe(3);
		expect(gens).toEqual([[0], [1], [2], [], []]);
		// A spark kill's proc waits for the next tick (created while draining); gen 3 is never queued.
		expect(queued).toEqual([[1], [2], [], [], []]);
		expect(line.map((a) => a.alive)).toEqual([0, 0, 0, 0, 1, 1]);
	});

	it("a Volatile bolt's kill procs at gen 1 (the bolt carries gen 0 in its source)", () => {
		const s = fresh();
		setLevel(s, Boon.VOLATILE, 1);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 3, 1);
		const target = dummy(ctx, 0, 4.5, 1);
		kill(ctx, victim);
		step(s, IDLE, ARENA);
		expect(shots(s).map((b) => b.source)).toEqual(shots(s).map(() => buildSource(BuildEffect.VOLATILE, 0)));
		expect(stepUntilDead(s, target)).toBeGreaterThan(0);
		const e = s.builds!.events;
		expect([e.burstX, e.burstZ, e.burstGen, e.burstOwner]).toEqual([[0], [4.5], [1], [0]]);
	});
});

describe("the queue (BU3)", () => {
	it("oldest first, PROCS_PER_TICK a tick, the rest carried over in order", () => {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const ctx = ctxOf(s);
		const victims: ActorState[] = [];
		for (let k = 0; k < 30; k++) victims.push(dummy(ctx, -6 + (k % 10), -3 - math.floor(k / 10), 1));
		for (const v of victims) kill(ctx, v);
		expect(s.builds!.procs.map((q) => q.id)).toEqual(victims.map((v) => v.id));
		step(s, IDLE, ARENA);
		const rest: number[] = [];
		for (let k = BUILD_RULES.procsPerTick; k < 30; k++) rest.push(victims[k].id);
		expect(s.builds!.procs.map((q) => q.id)).toEqual(rest);
		step(s, IDLE, ARENA);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("the floor change drops what is still queued", () => {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const ctx = ctxOf(s);
		for (let k = 0; k < 60; k++) kill(ctx, dummy(ctx, -6 + (k % 12), -2 - math.floor(k / 12), 1));
		step(s, IDLE, ARENA);
		expect(s.builds!.procs.size()).toBe(60 - BUILD_RULES.procsPerTick);
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		expect(s.events.floorChanged).toBe(2);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("co-op: a player who left has their queued procs dropped, and their kills queue nothing", () => {
		const s = fresh(PARTY2);
		setLevel(s, Boon.CHAIN_SPARK, 1, 0);
		setLevel(s, Boon.CHAIN_SPARK, 1, 1);
		const ctx = ctxOf(s, PARTY2);
		for (let k = 0; k < 60; k++) kill(ctx, dummy(ctx, -6 + (k % 12), -2 - math.floor(k / 12), 1), k % 2);
		stepParty(s, [IDLE, IDLE], PARTY2);
		expect(s.builds!.procs.size()).toBe(36);
		stepParty(s, [IDLE, { ...IDLE, buttons: PARTY_LEFT_BUTTON }], PARTY2);
		// Without the drop 12 would be left; the leaver's 18 went, the other 18 resolved.
		expect(s.builds!.procs.size()).toBe(0);
		kill(ctx, dummy(ctx, 3, 3, 1), 1);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("co-op credit: the owner's emitter, mods and kills (Vampire Fang counts for the owner only)", () => {
		const s = fresh(PARTY2);
		setLevel(s, Boon.VOLATILE, 1, 1);
		grantRelic(s, 0, Relic.VAMPIRE_FANG);
		grantRelic(s, 1, Relic.VAMPIRE_FANG);
		const ctx = ctxOf(s, PARTY2);
		kill(ctx, dummy(ctx, -4, -4, 1), 0); // player 0 owns no on-kill boon
		expect(s.builds!.procs.size()).toBe(0);
		const victim = dummy(ctx, 0, 3, 1);
		const target = dummy(ctx, 0, 4.5, 1);
		kill(ctx, victim, 1);
		expect(s.builds!.procs.map((q) => q.owner)).toEqual([1]);
		stepParty(s, [IDLE, IDLE], PARTY2);
		const owner = weaponsAt(s, 1).emitterId;
		expect(shots(s).map((b) => b.emitter)).toEqual(shots(s).map(() => owner));
		for (let t = 0; t < 60 && target.alive !== 0; t++) stepParty(s, [IDLE, IDLE], PARTY2);
		expect(target.alive).toBe(0);
		expect(s.builds!.events.burstOwner).toEqual([1]);
		expect([s.run!.players[0].fangKills, s.run!.players[1].fangKills]).toEqual([1, 2]);
	});
});

describe("the effect budget (BU3)", () => {
	const FIRE_EAST: InputFrame = frame(0, 0, Button.FIRE, 1, 0);

	it("a 60-kill burst never drops a weapon shot: effects stop at EFFECT_BULLETS_MAX, every drop is an effect's", () => {
		const s = fresh(BOW_ARENA);
		setLevel(s, Boon.VOLATILE, 2);
		const ctx = ctxOf(s, BOW_ARENA);
		for (let k = 0; k < 60; k++) kill(ctx, dummy(ctx, -6 + (k % 12), -2 - math.floor(k / 12), 1));
		let effectDrops = 0;
		let maxEffects = 0;
		let arrows = 0;
		for (let t = 0; t < 40; t++) {
			const before = s.combat.playerSpawned;
			step(s, FIRE_EAST, BOW_ARENA);
			effectDrops += s.builds!.events.effectDropped;
			const fired = s.builds!.events.burstFired.reduce((acc, n) => acc + n, 0);
			arrows += s.combat.playerSpawned - before - fired;
			maxEffects = math.max(maxEffects, effectBulletsAlive(s, 0));
			expect([t, s.combat.dropped]).toEqual([t, effectDrops]);
		}
		expect(maxEffects).toBe(BUILD_RULES.effectBulletsMax);
		expect(effectDrops).toBe(60 * 12 - BUILD_RULES.effectBulletsMax);
		expect(arrows).toBe(4); // 40 ticks of the bow's stream: one arrow every 12 ticks from the press
	});

	it("a party keeps effectWeaponReserve slots per player free of effects (4 players x 160 > the pool)", () => {
		const n = 4;
		const config = configOf({ loadout: ["weapon.bow"] }, { scoring: { partySize: n }, party: { size: n } });
		const s = fresh(config);
		for (let i = 0; i < n; i++) setLevel(s, Boon.VOLATILE, 2, i);
		const ctx = ctxOf(s, config);
		for (let k = 0; k < 60; k++) kill(ctx, dummy(ctx, -6 + (k % 12), -2 - math.floor(k / 12), 1), k % n);
		const inputs: InputFrame[] = [];
		for (let i = 0; i < n; i++) inputs.push(FIRE_EAST);
		const cap = PLAYER_BULLET_CAPACITY - n * BUILD_RULES.effectWeaponReserve;
		let effectDrops = 0;
		let maxEffects = 0;
		for (let t = 0; t < 40; t++) {
			stepParty(s, inputs, config);
			effectDrops += s.builds!.events.effectDropped;
			let effects = 0;
			for (let i = 0; i < n; i++) effects += effectBulletsAlive(s, i);
			maxEffects = math.max(maxEffects, effects);
			expect([t, s.combat.dropped]).toEqual([t, effectDrops]);
		}
		expect(maxEffects <= cap).toBe(true);
		expect(maxEffects > n * BUILD_RULES.effectWeaponReserve).toBe(true);
		expect(effectDrops > 0).toBe(true);
	});

	it("a player's own fire stays within effectWeaponReserve: the fastest bow stream plus Ember Wake rings", () => {
		const config = configOf({ loadout: ["weapon.bow"] }, { drops: DROPS_CONFIG });
		const s = fresh(config);
		for (let k = 0; k < 3; k++) grantCard(s, 0, Boon.SWIFT_STRIKES);
		grantCard(s, 0, Boon.EMBER_WAKE);
		let most = 0;
		for (let t = 0; t < 600; t++) {
			s.drops!.players[0].ticks[Boost.FRENZY] = 100; // Frenzy all along
			const roll = t % 24 === 0 ? Button.ROLL : 0;
			step(s, frame(t % 48 < 24 ? 1 : -1, 0, bit32.bor(Button.FIRE, roll), 0, 1), config);
			most = math.max(most, s.combat.playerBullets.activeCountFor(weaponsAt(s, 0).emitterId));
		}
		expect(most > 16).toBe(true);
		expect(most <= BUILD_RULES.effectWeaponReserve).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------

describe("Chain Spark (BU4)", () => {
	it("the nearest living enemy by squared distance, ties to the lower slot, never the victim", () => {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 3, 1);
		const a = dummy(ctx, 3, 3);
		const b = dummy(ctx, -3, 3);
		const far = dummy(ctx, 0, 6.5);
		kill(ctx, victim);
		step(s, IDLE, ARENA);
		expect([a.hp, b.hp, far.hp]).toEqual([8, 10, 10]);
	});

	it("range: CHAIN_SPARK_RANGE (4.5) reaches, a hair beyond does not", () => {
		expect(CHAIN_SPARK_RANGE).toBe(4.5);
		for (const [dist, hit] of [
			[4.5, true],
			[4.51, false],
		] as const) {
			const s = fresh();
			setLevel(s, Boon.CHAIN_SPARK, 1);
			const ctx = ctxOf(s);
			const victim = dummy(ctx, 0, 0, 1);
			const t = dummy(ctx, 0, dist);
			kill(ctx, victim);
			step(s, IDLE, ARENA);
			expect([dist, t.hp, s.builds!.events.sparkX1.size()]).toEqual([dist, hit ? 8 : 10, hit ? 1 : 0]);
		}
	});

	it("level II hops twice from the last target and never strikes the same enemy twice", () => {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, 2);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 3, 1);
		const a = dummy(ctx, 2, 3, 1); // dies on the first hop; the second starts from it
		const b = dummy(ctx, 6, 3); // 4 from a, 6 from the corpse
		kill(ctx, victim);
		step(s, IDLE, ARENA);
		expect([a.alive, b.hp]).toEqual([0, 8]);
		const e = s.builds!.events;
		expect([e.sparkX1, e.sparkX2]).toEqual([
			[0, 2],
			[2, 6],
		]);
		// A lone enemy is struck once.
		const s2 = fresh();
		setLevel(s2, Boon.CHAIN_SPARK, 2);
		const c2 = ctxOf(s2);
		const v2 = dummy(c2, 0, 3, 1);
		const lone = dummy(c2, 2, 3);
		kill(c2, v2);
		step(s2, IDLE, ARENA);
		expect([lone.hp, s2.builds!.events.sparkX1.size()]).toEqual([8, 1]);
	});

	it("damage goes through playerHitDamage (Sharpened I: 2 x 125 % = 2.5, II: 3)", () => {
		for (const [sharpened, hp] of [
			[1, 7.5],
			[2, 7],
		] as const) {
			const s = fresh();
			setLevel(s, Boon.CHAIN_SPARK, 1);
			for (let k = 0; k < sharpened; k++) grantCard(s, 0, Boon.SHARPENED);
			const ctx = ctxOf(s);
			const victim = dummy(ctx, 0, 3, 1);
			const t = dummy(ctx, 3, 3);
			kill(ctx, victim);
			step(s, IDLE, ARENA);
			expect(t.hp).toBe(hp);
		}
	});
});

describe("Volatile (BU4)", () => {
	it("a ring of 8 (I) / 12 (II) bolts from the corpse: BURST kind, the effect's source, the owner's emitter", () => {
		for (const [level, count] of [
			[1, 8],
			[2, 12],
		] as const) {
			const s = fresh();
			setLevel(s, Boon.VOLATILE, level);
			const ctx = ctxOf(s);
			kill(ctx, dummy(ctx, 0, 3, 1));
			step(s, IDLE, ARENA);
			const out = shots(s);
			expect(out.size()).toBe(count);
			expect(s.combat.playerSpawned).toBe(count);
			for (const b of out) {
				expect([b.kind, b.source, b.damage, b.pierce, b.emitter]).toEqual([
					BulletKind.BURST,
					buildSource(BuildEffect.VOLATILE, 0),
					1,
					0,
					weaponsAt(s, 0).emitterId,
				]);
				expect(b.vx * b.vx + b.vz * b.vz).toBeCloseTo(100, 9);
			}
			expect(out.some((b) => b.vx === 0 && b.vz === 10)).toBe(true); // the first bolt heads +Z
			expect(s.builds!.events.burstFired).toEqual([count]);
		}
	});

	it("a bolt's damage goes through playerHitDamage (Sharpened I: 1.25)", () => {
		const s = fresh();
		setLevel(s, Boon.VOLATILE, 1);
		grantCard(s, 0, Boon.SHARPENED);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 3, 1);
		const t = dummy(ctx, 0, 4.5);
		kill(ctx, victim);
		for (let k = 0; k < 20; k++) step(s, IDLE, ARENA);
		expect(t.hp).toBe(8.75);
	});
});

describe("Soul Shards (BU4)", () => {
	const SPEED = 14;

	function volley(level: number, targets: ReadonlyArray<readonly [number, number]>): Shot[] {
		const s = fresh();
		setLevel(s, Boon.SOUL_SHARDS, level);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 3, 1);
		for (const [x, z] of targets) dummy(ctx, x, z);
		kill(ctx, victim);
		step(s, IDLE, ARENA);
		const out = shots(s);
		for (const b of out) {
			expect([b.kind, b.source, b.damage, b.pierce, b.emitter]).toEqual([
				BulletKind.SHARD,
				buildSource(BuildEffect.SOUL_SHARDS, 0),
				2,
				0,
				weaponsAt(s, 0).emitterId,
			]);
		}
		const fired = s.builds!.events.shardFired;
		expect(fired).toEqual(out.size() > 0 ? [out.size()] : []);
		return out;
	}

	const velocities = (out: Shot[]) => out.map((b) => [b.vx, b.vz]);
	const T = [
		[0, 5],
		[3, 3],
		[-4, 3],
	] as const; // 2, 3 and 4 from the corpse at (0, 3)

	it("I: 2 shards at the 2 nearest; II: 3 at the 3 nearest (aimed at spawn, straight)", () => {
		const one = velocities(volley(1, T));
		expect(one.size()).toBe(2);
		expect(one.some((v) => v[0] === 0 && v[1] === SPEED)).toBe(true);
		expect(one.some((v) => v[0] === SPEED && v[1] === 0)).toBe(true);
		const two = velocities(volley(2, T));
		expect(two.size()).toBe(3);
		expect(two.some((v) => v[0] === -SPEED && v[1] === 0)).toBe(true);
	});

	it("fewer targets than shards: the rest fly at the nearest; aimed by sqrt (no trig)", () => {
		const out = velocities(volley(2, [[3, 7]])); // (3, 4) from the corpse: 5 away
		expect(out).toEqual([
			[SPEED * (3 / 5), SPEED * (4 / 5)],
			[SPEED * (3 / 5), SPEED * (4 / 5)],
			[SPEED * (3 / 5), SPEED * (4 / 5)],
		]);
	});

	it("range: SOUL_SHARDS_RANGE (8) reaches, beyond it nothing is fired; no target, no shard", () => {
		expect(SOUL_SHARDS_RANGE).toBe(8);
		expect(volley(1, [[0, 11]]).size()).toBe(2);
		expect(volley(1, [[0, 11.01]]).size()).toBe(0);
		expect(volley(2, []).size()).toBe(0);
	});

	it("a shard's damage goes through playerHitDamage (Sharpened I: 2.5)", () => {
		const s = fresh();
		setLevel(s, Boon.SOUL_SHARDS, 1);
		grantCard(s, 0, Boon.SHARPENED);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 3, 1);
		const t = dummy(ctx, 0, 6);
		kill(ctx, victim);
		for (let k = 0; k < 20; k++) step(s, IDLE, ARENA);
		expect(t.hp).toBe(10 - 2 * 2.5); // both shards fly at the one target
	});
});

// ---------------------------------------------------------------------------------------------

describe("a swarmer pack cascade (BU3 / BU4)", () => {
	// Eight real swarmers in a pack 5-7 tiles ahead; the player holds the bow's stream at them. Volatile I + Chain
	// Spark I: the first arrow's kill sparks and bursts, and the pack dies in a ripple.
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

	function run(): { killTicks: number[]; hashes: string[]; s: SimState } {
		const s = fresh(config);
		setLevel(s, Boon.VOLATILE, 1);
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const killTicks = PACK.map(() => -1);
		const hashes: string[] = [];
		for (let t = 0; t < 60; t++) {
			step(s, FIRE_NORTH, config);
			hashes.push(hashState(s));
			for (let k = 0; k < PACK.size(); k++) {
				if (killTicks[k] < 0 && s.combat.actors[k].alive === 0) killTicks[k] = s.tick - 1;
			}
		}
		return { killTicks, hashes, s };
	}

	it("dies in a ripple at the expected ticks", () => {
		const r = run();
		expect(r.killTicks).toEqual(EXPECTED_KILL_TICKS);
		expect(r.s.events.playerDied).toBe(0);
	});

	it("is deterministic: two runs hash the same every tick", () => {
		const a = run();
		const b = run();
		expect(a.hashes).toEqual(b.hashes);
		expect(a.killTicks).toEqual(b.killTicks);
	});
});
