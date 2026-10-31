// E1.8 actor system (source: src/sim/actors/actors.test.ts): registry numbering and sealing, the pool (spawn order,
// slot reuse, capacity, corpses), damage (flash, death, the per-second cap, filterDamage), contact damage through
// damagePlayer, telegraph / phase events, moveActor through a real dungeon, line of sight, patterns helpers.
import { describe, expect, it } from "@rbxts/jest-globals";
import { stableSort } from "shared/jsmath";
import { TEST_BOSS, TEST_BOSS_ATTACK_RING, TEST_CHASER } from "shared/sim/testing";
import {
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bulletBlocker,
	circleOverlapsWall,
	entranceSpawn,
	generateDungeon,
	isBulletBlocked,
} from "shared/dungeon";
import {
	AiState,
	BOSS_DEMONLORD_ID,
	Button,
	CORPSE_TICKS,
	DAMAGE_CAP_BUCKET_TICKS,
	DUMMY_KIND,
	DAMAGE_CAP_WINDOW_SECONDS,
	EMPTY_INPUT,
	FULL_RING,
	HIT_FLASH_TICKS,
	HIT_HEAVY,
	HIT_NORMAL,
	HURT_INVULN_TICKS,
	MAX_ACTORS,
	NO_KIND,
	PLAYER_RADIUS,
	PORT_BAND_BOSSES,
	PORT_BAND_TUTORIAL,
	Rng,
	SIM_DT,
	SQRT1_2,
	STEER,
	START_HALF_HEARTS,
	SimCtx,
	aimAt,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	createSimState,
	halfRotation,
	hashState,
	lineOfSight,
	moveActor,
	registerArchetype,
	rotateDir,
	runReplay,
	step,
	toPlayer,
	turnDir,
	walkToward,
	webArchetypeIds,
	WEB_ARCHETYPE_BAND,
	type ActorSpawn,
	type ActorState,
	type ArchetypeData,
	type EncounterConfig,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });
const ctxFor = (s: SimState, config: SimConfig = {}): SimCtx => new SimCtx().bind(s, config, EMPTY_INPUT);
const run = (s: SimState, n: number, config: SimConfig = {}): void => {
	for (let i = 0; i < n; i++) step(s, EMPTY_INPUT, config);
};
/** pcall-wrapped call: the error message ("" when it did not throw). */
const thrown = (f: () => void): string => {
	const [ok, err] = pcall(f);
	return ok ? "" : tostring(err);
};
const has = (text: string, part: string): boolean => string.find(text, part, 1, true)[0] !== undefined;

describe("archetype registry", () => {
	it("numbers kinds by (band, sorted id), independent of registration order", () => {
		const ids = archetypeIds();
		const band = (id: string): number => archetypeAt(archetypeIndex(id)).band ?? WEB_ARCHETYPE_BAND;
		const sorted = stableSort([...ids], (a, b) =>
			band(a) !== band(b) ? band(a) - band(b) : a < b ? -1 : a > b ? 1 : 0,
		);
		expect([...ids]).toEqual(sorted);
		expect(ids).toContain("turret.sprayer");
		expect(ids).toContain("test.boss");
		// The port's dummy (band 1) and Demon Lord (band 2) number after every band-0 id, test archetypes included.
		const web = webArchetypeIds();
		// docs/ENEMY_VARIANTS.md's band-3 room enemies (PORT_BAND_ENEMIES) number after both.
		expect([...ids].filter((_, i) => i <= web.size() + 1)).toEqual([...web, DUMMY_KIND, BOSS_DEMONLORD_ID]);
		expect(band(DUMMY_KIND)).toBe(PORT_BAND_TUTORIAL);
		expect(band(BOSS_DEMONLORD_ID)).toBe(PORT_BAND_BOSSES);
		for (let i = 0; i < ids.size(); i++) {
			expect(archetypeIndex(ids[i])).toBe(i);
			expect(archetypeAt(i).id).toBe(ids[i]);
		}
		// Source: toThrow(/Unknown archetype 'nope'.*turret\.sniper/)
		const msg = thrown(() => archetypeIndex("nope"));
		expect(has(msg, "Unknown archetype 'nope'")).toBe(true);
		const [at] = string.find(msg, "Unknown archetype 'nope'", 1, true);
		expect(string.find(msg, "turret.sniper", at, true)[0]).never.toBe(undefined);
	});

	it("validates defs, and seals once a run has started (re-registering an existing id stays allowed)", () => {
		const data: ArchetypeData = { hp: 1, radius: 0.3, speed: 0, contactDamage: 0, spriteId: "enemy.swarmer" };
		expect(
			has(
				thrown(() => registerArchetype({ id: "Bad Id", data, step() {} })),
				"lowercase",
			),
		).toBe(true);
		expect(
			has(
				thrown(() => registerArchetype({ id: "test.bad", data: { ...data, hp: 0 }, step() {} })),
				"hp",
			),
		).toBe(true);
		expect(
			has(
				thrown(() => registerArchetype({ id: "test.bad", band: 0.5, data, step() {} })),
				"band",
			),
		).toBe(true);
		createSimState(1, 0, 0); // seals
		expect(
			has(
				thrown(() => registerArchetype({ id: "test.late", data, step() {} })),
				"sealed",
			),
		).toBe(true);
		const before = archetypeIndex("test.dummy");
		expect(thrown(() => registerArchetype({ ...archetypeAt(before) }))).toBe(""); // hot reload of a known id
		expect(archetypeIndex("test.dummy")).toBe(before);
	});
});

describe("actor pool", () => {
	it("spawns the encounter in order (spawnTick -1, acting from tick 0) with archetype data and fresh emitter ids", () => {
		const config: SimConfig = {
			encounter: enc([
				{ kind: "test.dummy", x: 1, z: 2 },
				{ kind: "test.boss", x: -3, z: 4 },
			]),
		};
		const s = createSimState(1, 0, 0, config);
		const [a, b] = [s.combat.actors[0], s.combat.actors[1]];
		expect(a).toMatchObject({
			id: 1,
			kind: archetypeIndex("test.dummy"),
			spawnTick: -1,
			x: 1,
			z: 2,
			hp: 10,
			hpMax: 10,
			radius: 0.5,
			alive: 1,
			emitterId: 1,
		});
		expect(b).toMatchObject({
			id: 2,
			kind: archetypeIndex("test.boss"),
			hp: 60,
			radius: 0.9,
			emitterId: 2,
			phase: 1,
		});
		expect(a.v).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
		expect(s.combat.nextActorId).toBe(3);
		expect(s.combat.enemyEmitters).toBe(2);
	});

	it("runtime spawns take the lowest free slot, are not stepped on their spawn tick, and stop at MAX_ACTORS", () => {
		const s = createSimState(1, 0, 0);
		const ctx = ctxFor(s);
		const a = ctx.spawnActor("test.chaser", 0, 5)!;
		const b = ctx.spawnActor("test.dummy", 2, 5)!;
		expect(s.combat.actors).toEqual([a, b]);
		expect(a.spawnTick).toBe(0);
		ctx.freeActor(a);
		expect(s.combat.actors[0].kind).toBe(NO_KIND);
		expect(s.combat.actors[0].id).toBe(0);
		const c = ctx.spawnActor("test.chaser", 0, 3)!;
		expect(s.combat.actors[0]).toBe(c); // slot 0 reused
		expect(c.id).toBe(3);
		// Spawned on tick 0: the tick-0 actor loop skips it (prev = position untouched, no AI ran, its rng cooldown holds).
		const cooldown = c.cooldown;
		step(s, EMPTY_INPUT, {});
		expect(c.cooldown).toBe(cooldown);
		step(s, EMPTY_INPUT, {});
		expect(c.cooldown).toBe(cooldown - 1); // stepped from tick 1 on
		// Fill the pool.
		for (let i = s.combat.actors.size(); i < MAX_ACTORS; i++) {
			expect(ctx.spawnActor("test.dummy", i, 20)).never.toBe(undefined);
		}
		expect(s.combat.actors.size()).toBe(MAX_ACTORS);
		expect(ctx.spawnActor("test.dummy", 0, 0)).toBe(undefined);
		expect(s.combat.actorsDropped).toBe(1);
	});

	it("a dead actor lingers CORPSE_TICKS (hidden, untouchable), then its slot is freed", () => {
		const config: SimConfig = { encounter: enc([{ kind: "test.dummy", x: 0, z: 3 }]) };
		const s = createSimState(1, 0, 0, config);
		const ctx = ctxFor(s, config);
		const a = s.combat.actors[0];
		expect(ctx.damageActor(a, 4)).toBe(4);
		expect(a.flashTicks).toBe(HIT_FLASH_TICKS);
		expect(s.events.enemyHits).toBe(1);
		expect(s.events.damageDealt).toBe(4);
		expect(ctx.damageActor(a, 100)).toBe(6); // hp floors at 0
		expect(a.alive).toBe(0);
		expect(a.flashTicks).toBe(0);
		expect(s.events.actorsKilled).toBe(1);
		expect(s.events.enemiesKilled).toBe(1);
		expect(ctx.damageActor(a, 1)).toBe(0); // corpses take no damage
		run(s, CORPSE_TICKS - 1, config);
		expect(a.kind).never.toBe(NO_KIND);
		expect(a.deadTicks).toBe(CORPSE_TICKS - 1);
		run(s, 1, config);
		expect(a.kind).toBe(NO_KIND);
	});

	it("caps damage per second for archetypes with damageCapPerSecond (rolling window of buckets)", () => {
		const config: SimConfig = { encounter: enc([{ kind: "test.boss", x: 0, z: 30 }]) }; // far away: asleep
		const s = createSimState(1, 0, 0, config);
		const boss = s.combat.actors[0];
		const cap = TEST_BOSS.data.damageCapPerSecond!;
		const applied: number[] = [];
		for (let t = 0; t < 600; t++) {
			applied.push(ctxFor(s, config).damageActor(boss, 1)); // one point every tick: 60 per second offered
			boss.hp = boss.hpMax; // keep it alive
			step(s, EMPTY_INPUT, config);
		}
		// Never more than cap x 2 s inside any window of 110 ticks (the window is 110..120 ticks long, budget cap x 2).
		expect(DAMAGE_CAP_WINDOW_SECONDS).toBe(2);
		// (`t + 110 <= size` miscompiles to a numeric for over 0..size in roblox-ts: keep the bound a plain expression.)
		const lastStart = applied.size() - 110;
		for (let t = 0; t <= lastStart; t++) {
			let sum = 0;
			for (let k = t; k < t + 110; k++) sum += applied[k];
			expect(sum).toBeLessThanOrEqual(cap * DAMAGE_CAP_WINDOW_SECONDS);
		}
		// And it really lets the cap through every ~second: 10 s -> between 100 and 120.
		let total = 0;
		for (const v of applied) total += v;
		expect(total).toBeGreaterThanOrEqual(cap * 10);
		expect(total).toBeLessThanOrEqual(cap * 12);
		expect(DAMAGE_CAP_BUCKET_TICKS).toBe(10);
	});

	it("a single big hit up to the 2 s budget lands whole (chunky melee is not cut down by the cap)", () => {
		const config: SimConfig = { encounter: enc([{ kind: "test.boss", x: 0, z: 30 }]) };
		const s = createSimState(1, 0, 0, config);
		const boss = s.combat.actors[0];
		const cap = TEST_BOSS.data.damageCapPerSecond!;
		const budget = cap * DAMAGE_CAP_WINDOW_SECONDS;
		expect(ctxFor(s, config).damageActor(boss, budget)).toBe(budget);
		expect(ctxFor(s, config).damageActor(boss, 1)).toBe(0); // the window is full
	});

	it("filterDamage can make an actor immune (the hit still counts)", () => {
		const config: SimConfig = { encounter: enc([{ kind: "test.dummy", x: 0, z: 3 }]) };
		const s = createSimState(1, 0, 0, config);
		const def = archetypeAt(archetypeIndex("test.dummy")) as unknown as {
			filterDamage?: (self: unknown, c: SimCtx, x: ActorState, d: number) => number;
		};
		const a = s.combat.actors[0];
		def.filterDamage = () => 0; // a hook is called as a method (def:filterDamage): self comes first
		try {
			expect(ctxFor(s, config).damageActor(a, 5)).toBe(0);
			expect(a.hp).toBe(10);
			expect(a.flashTicks).toBe(0);
			expect(s.events.enemyHits).toBe(1);
		} finally {
			def.filterDamage = undefined;
		}
	});
});

describe("contact damage, telegraphs and phases", () => {
	it("touching a contact-damage actor hurts through damagePlayer and names it as the source; i-frames protect", () => {
		const config: SimConfig = { encounter: enc([{ kind: "test.chaser", x: 0, z: 0.5 }]) };
		const s = createSimState(1, 0, 0, config);
		step(s, EMPTY_INPUT, config);
		expect(s.events.playerHits).toBe(1);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - TEST_CHASER.data.contactDamage);
		expect(s.events.lastHitSource).toBe(archetypeIndex("test.chaser"));
		for (let t = 1; t < HURT_INVULN_TICKS; t++) {
			step(s, EMPTY_INPUT, config);
			expect(s.events.playerHits).toBe(0); // post-hit invulnerability
			expect(s.events.lastHitSource).toBe(-1);
		}
		step(s, EMPTY_INPUT, config);
		expect(s.events.playerHits).toBe(1);
	});

	it("the test boss telegraphs >= 0.5 s before each ring and changes phase as it loses hp", () => {
		const config: SimConfig = { encounter: enc([{ kind: "test.boss", x: 0, z: 4 }]) };
		const s = createSimState(1, 0, 0, config);
		const boss = s.combat.actors[0];
		let telegraphTick = -1;
		let ringTick = -1;
		for (let t = 0; t < 200 && ringTick < 0; t++) {
			const before = s.combat.enemySpawned;
			step(s, EMPTY_INPUT, config);
			if (s.events.telegraphs !== 0) {
				telegraphTick = t;
				expect(boss.aiState).toBe(AiState.TELEGRAPH);
				expect(boss.attack).toBe(TEST_BOSS_ATTACK_RING);
			}
			if (s.combat.enemySpawned > before) ringTick = t;
		}
		expect(telegraphTick).toBeGreaterThanOrEqual(0);
		expect((ringTick - telegraphTick) * SIM_DT).toBeGreaterThanOrEqual(0.5);
		const ctx = ctxFor(s, config);
		boss.hp = 41;
		ctx.damageActor(boss, 2);
		expect(boss.phase).toBe(2);
		expect(s.events.bossPhase).toBe(2);
	});
});

describe("moveActor and line of sight in a dungeon", () => {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
	const spawn = entranceSpawn(d);
	const config: SimConfig = { actorMover: actorMover(d), isBulletBlocked: bulletBlocker(d) };

	it("walls stop actors of any radius, and long moves are sub-stepped like the player", () => {
		const s = createSimState(1, spawn.x, spawn.z, config);
		const ctx = ctxFor(s, config);
		const rng = new Rng(5);
		for (const radius of [0.3, 0.6, 1.2]) {
			const a = ctx.spawnActor("test.dummy", spawn.x, spawn.z)!;
			a.radius = radius;
			let overlaps = 0;
			for (let i = 0; i < 2000; i++) {
				const dx = (rng.next() - 0.5) * 0.8;
				const dz = (rng.next() - 0.5) * 0.8;
				moveActor(ctx, a, dx, dz); // up to ~0.57 per call: several sub-steps
				if (circleOverlapsWall(d, a.x, a.z, radius)) overlaps++;
			}
			expect([radius, overlaps]).toEqual([radius, 0]);
		}
	});

	it("walkToward(..., steer) moves with actorSteerMover when the config has one; everything else keeps actorMover", () => {
		const calls: string[] = [];
		const steerConfig: SimConfig = {
			actorMover: (x, z, dx, dz) => {
				calls.push("mover");
				return { x: x + dx, z: z + dz };
			},
			actorSteerMover: (x, z, dx, dz) => {
				calls.push("steer");
				return { x: x + dx, z: z + dz };
			},
		};
		const s = createSimState(1, 0, 0, steerConfig);
		const ctx = ctxFor(s, steerConfig);
		const a = ctx.spawnActor("test.dummy", 0, 0)!;
		walkToward(ctx, a, 1, 0, 0.05, STEER);
		moveActor(ctx, a, 0.05, 0);
		// a walk without `steer` (the boss's charge and reposition) keeps the plain mover
		walkToward(ctx, a, 1, 0, 0.05);
		walkToward(ctx, a, 1, 0, 0.05, false);
		expect(calls).toEqual(["steer", "mover", "mover", "mover"]);
		// without a steering mover, a steered walk uses actorMover (M1, every golden fixture)
		calls.clear();
		const plain: SimConfig = { actorMover: steerConfig.actorMover };
		walkToward(ctxFor(s, plain), a, 1, 0, 0.05, STEER);
		expect(calls).toEqual(["mover"]);
	});

	it("without a mover, the bounds clamp applies, else movement is free", () => {
		const s = createSimState(1, 0, 0);
		const a = ctxFor(s).spawnActor("test.dummy", 0, 0)!;
		moveActor(ctxFor(s, { bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } }), a, 5, -0.5);
		expect([a.x, a.z]).toEqual([1, -0.5]);
		moveActor(ctxFor(s), a, 5, 0);
		expect(a.x).toBe(6);
	});

	it("line of sight never sees through a wall tile (dense sampling agrees), and is free without a blocker", () => {
		const rng = new Rng(11);
		let seen = 0;
		let blocked = 0;
		let wrong = 0;
		for (let i = 0; i < 400; i++) {
			const x0 = spawn.x + (rng.next() - 0.5) * 30;
			const z0 = spawn.z + (rng.next() - 0.5) * 30;
			const x1 = x0 + (rng.next() - 0.5) * 16;
			const z1 = z0 + (rng.next() - 0.5) * 16;
			const los = lineOfSight(config.isBulletBlocked, x0, z0, x1, z1);
			let sampledBlock = false;
			for (let k = 0; k <= 400; k++) {
				const t = k / 400;
				if (isBulletBlocked(d, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) sampledBlock = true;
			}
			if (los) {
				seen++;
				if (sampledBlock) wrong++;
			} else {
				blocked++;
			}
		}
		expect(wrong).toBe(0);
		expect(seen).toBeGreaterThan(20);
		expect(blocked).toBeGreaterThan(20);
		expect(lineOfSight(undefined, 0, 0, 100, 100)).toBe(true);
		// Exactly diagonal through a corner between two blocked tiles: blocked.
		const corner = (x: number, z: number): boolean => (x === 1 && z === 0) || (x === 0 && z === 1);
		expect(lineOfSight(corner, 0, 0, 1, 1)).toBe(false);
		expect(lineOfSight(corner, 0, 0, -1, -1)).toBe(true);
	});

	it("toPlayer gives distance and a unit direction", () => {
		const s = createSimState(1, 3, 4);
		const a = ctxFor(s).spawnActor("test.dummy", 0, 0)!;
		const tp = toPlayer(ctxFor(s), a);
		expect([tp.dx, tp.dz, tp.dist2, tp.dist, tp.dirX, tp.dirZ]).toEqual([3, 4, 25, 5, 0.6, 0.8]);
	});
});

describe("patterns helpers", () => {
	it("rotate, turn, halve and aim without trig", () => {
		const out = { x: 0, z: 0 };
		rotateDir(0, 1, 0, 1, out); // +90 degrees: +Z -> +X
		expect(out.x).toBeCloseTo(1, 15);
		expect(out.z).toBeCloseTo(0, 15);
		turnDir(0, 1, out);
		expect(out.x).toBeCloseTo(math.sin(math.atan2(16, 63)), 15);
		halfRotation(0, out); // half of 90 degrees
		expect(out.x).toBeCloseTo(SQRT1_2, 15);
		expect(out.z).toBeCloseTo(SQRT1_2, 15);
		expect(aimAt(1, 1, 4, 5, out)).toBe(true);
		expect(out.x).toBeCloseTo(0.6, 15);
		expect(out.z).toBeCloseTo(0.8, 15);
		expect(aimAt(1, 1, 1, 1, out, 0, -1)).toBe(false);
		expect([out.x, out.z]).toEqual([0, -1]);
		expect(FULL_RING).toBe(math.pi * 2);
	});
});

describe("actor determinism", () => {
	it("runtime spawns, rng draws and actor state replay exactly, and every actor field is in the hash", () => {
		const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 42 });
		const spawn = entranceSpawn(d);
		const mover = actorMover(d);
		const config: SimConfig = {
			moveResolver: (x, z, dx, dz) => mover(x, z, dx, dz, PLAYER_RADIUS),
			actorMover: mover,
			isBulletBlocked: bulletBlocker(d),
			encounter: enc([
				{ kind: "test.boss", x: spawn.x + 3, z: spawn.z },
				{ kind: "test.chaser", x: spawn.x - 3, z: spawn.z },
			]),
		};
		const s = createSimState(42, spawn.x, spawn.z, config);
		const frames: InputFrame[] = [];
		const rng = new Rng(3);
		for (let t = 0; t < 1200; t++) {
			const moveX = rng.int(-1000, 1000);
			const moveZ = rng.int(-1000, 1000);
			const buttons = rng.next() < 0.5 ? Button.FIRE : 0;
			const f: InputFrame = { ...EMPTY_INPUT, moveX, moveZ, aimX: 1000, buttons };
			frames.push(f);
			step(s, f, config);
		}
		expect(s.combat.nextActorId).toBeGreaterThan(2);
		const replayed = runReplay({ seed: 42, spawn: { x: spawn.x, z: spawn.z }, frames }, config);
		expect(hashState(replayed)).toBe(hashState(s));
		expect(replayed.combat.actors).toEqual(s.combat.actors);
		expect(HIT_HEAVY).toBe(TEST_BOSS.data.contactDamage);
		expect(HIT_NORMAL).toBe(TEST_CHASER.data.contactDamage);
	});
});
