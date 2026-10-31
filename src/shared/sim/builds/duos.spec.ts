// Builds BU6 (docs/BUILDS.md "Duo boons"): one spec group per duo (Fire Arrows' 4-ember cap per arrow and the ring that
// is no arrow, Blazing Trail's embers along a roll, Storm Blade's finisher and 5th-arrow sparks, Conductor's one hop,
// Shrapnel's bolts, Chain Reaction's cross triggers never past GEN_MAX, Close Call every 3rd graze, Gold Rush's exact
// points, Unshaken keeping the combo), offers (a duo with one boon missing is never offered), and determinism.
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOON_COUNT,
	BUILDS_CONFIG,
	BUILD_RULES,
	Boon,
	BuildEffect,
	BulletKind,
	BulletPayload,
	Button,
	DEFAULT_BOUNDS,
	DEFAULT_KILL_POINTS,
	DUOS,
	DUO_COUNT,
	Duo,
	EMPTY_INPUT,
	KILL_POINTS,
	KillCause,
	Rng,
	SHRAPNEL_CATACLYSM_PIERCE,
	SHRAPNEL_DAMAGE,
	SHRAPNEL_PIERCE,
	STORM_BLADE_ARROW_HITS,
	SWARMER,
	SWORD_FINISHER,
	SWORD_V_LAST,
	ScoreSource,
	SimCtx,
	buildSource,
	buildsOnGraze,
	createSimState,
	drawCardOffers,
	duoAvailable,
	duoCard,
	effectBulletsAlive,
	fireBurstRaw,
	grantCard,
	hashState,
	packPayload,
	step,
	type ActorState,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const IDLE = EMPTY_INPUT;
const FIRE_NORTH = frame(0, 0, Button.FIRE, 0, 1);
const AIM_NORTH = frame(0, 0, 0, 0, 1);

// ---------------------------------------------------------------------------------------------
// Open endless arenas (evolutions.spec.ts's): the greybox square on every floor, no rooms, stairs out of reach.

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
const BOW_ARENA = configOf({ loadout: ["weapon.bow"] });

function fresh(config: SimConfig = ARENA): SimState {
	return createSimState(SEED, 0, 0, config);
}

function ctxOf(s: SimState, config: SimConfig = ARENA): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

/** A stationary 'test.dummy' (radius 0.5) with `hp`, a target from this tick on. */
function dummy(ctx: SimCtx, x: number, z: number, hp = 10): ActorState {
	const a = ctx.spawnActor("test.dummy", x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

function kill(ctx: SimCtx, a: ActorState, owner = 0): void {
	ctx.actingPlayer(owner);
	ctx.damageActor(a, a.hp);
}

/** Grants each of `boons` once (level I, through the draft's grant), then the duo `duo` (undefined: none). */
function build(s: SimState, boons: ReadonlyArray<number>, duo?: number): void {
	for (const b of boons) grantCard(s, 0, b);
	if (duo !== undefined) grantCard(s, 0, duoCard(duo));
}

/** The duo's own boons at level I, then the duo when `withDuo`. */
function duoBuild(s: SimState, duo: number, withDuo = true, extra: ReadonlyArray<number> = []): void {
	build(s, [DUOS[duo].a, DUOS[duo].b, ...extra], withDuo ? duo : undefined);
}

interface Shot {
	kind: number;
	source: number;
	damage: number;
	pierce: number;
	x: number;
	z: number;
	vx: number;
	vz: number;
}

function shots(s: SimState): Shot[] {
	const out: Shot[] = [];
	const sim = s.combat.playerBullets;
	sim.forEachActive((i, pos, payload) => {
		const v = sim.velocityAt(i);
		out.push({
			kind: BulletPayload.get(payload, "kind"),
			source: BulletPayload.get(payload, "source"),
			damage: BulletPayload.get(payload, "damage"),
			pierce: BulletPayload.get(payload, "pierce"),
			x: pos.x,
			z: pos.z,
			vx: v.x,
			vz: v.z,
		});
		return false;
	});
	return out;
}

function embers(s: SimState): Shot[] {
	return shots(s).filter((b) => b.kind === BulletKind.EMBER);
}

/** A moving enemy bullet at (x, z). */
function enemyBullet(s: SimState, x: number, z: number, speed: number, dirX: number): void {
	const c = s.combat;
	const dirZ = dirX === 0 ? 1 : 0;
	c.enemySpawned += fireBurstRaw(
		c.enemyBullets,
		1,
		x,
		z,
		dirX,
		dirZ,
		1,
		0,
		speed,
		3,
		packPayload(1, BulletKind.ENEMY, 1),
	);
}

/** The duoProc entries of this tick as [duo, owner, value]. */
function duoProcs(s: SimState): Array<[number, number, number]> {
	const e = s.builds!.events;
	const out: Array<[number, number, number]> = [];
	for (let k = 0; k < e.duoProcDuo.size(); k++) out.push([e.duoProcDuo[k], e.duoProcOwner[k], e.duoProcValue[k]]);
	return out;
}

// ---------------------------------------------------------------------------------------------

describe("offers", () => {
	it("a duo with one of its boons missing is never offered (even when a duo is guaranteed); with both it is", () => {
		for (let d = 0; d < DUO_COUNT; d++) {
			const def = DUOS[d];
			for (const owned of [[def.a], [def.b], [def.a, def.b]]) {
				const levels: number[] = [];
				for (let b = 0; b < BOON_COUNT; b++) levels.push(owned.includes(b) ? 1 : 0);
				const both = owned.size() === 2;
				expect([d, owned.size(), duoAvailable(levels, [], d)]).toEqual([d, owned.size(), both]);
				for (let k = 1; k <= 40; k++) {
					const offers = drawCardOffers(new Rng(k), BUILD_RULES, levels, [], k % 12, true);
					expect([d, k, offers.includes(duoCard(d))]).toEqual([d, k, both]);
				}
				// Taken: never again.
				if (both)
					expect(drawCardOffers(new Rng(1), BUILD_RULES, levels, [d], 3, true).includes(duoCard(d))).toBe(
						false,
					);
			}
		}
	});
});

describe("Fire Arrows (Ember Wake + Piercing Arrows)", () => {
	/** Fires one stream arrow north (no enemy) and returns the steps that dropped embers and the embers' z. */
	function oneArrow(withDuo: boolean): { s: SimState; steps: number[]; zs: number[] } {
		const s = fresh(BOW_ARENA);
		duoBuild(s, Duo.FIRE_ARROWS, withDuo);
		const steps: number[] = [];
		const zs: number[] = [];
		for (let t = 0; t < 60; t++) {
			step(s, t === 0 ? FIRE_NORTH : AIM_NORTH, BOW_ARENA);
			const e = s.builds!.events;
			for (let k = 0; k < e.emberX.size(); k++) {
				steps.push(t);
				zs.push(e.emberZ[k]);
				expect([e.emberOwner[k], e.emberDuo[k]]).toEqual([0, Duo.FIRE_ARROWS]);
			}
		}
		return { s, steps, zs };
	}

	it("an arrow drops an ember every 6 ticks, at most 4 (its 45-tick life would allow 7)", () => {
		const { steps, zs } = oneArrow(true);
		// Fired on step 0 (age 1 at its end): ages 6, 12, 18, 24.
		expect(steps).toEqual([5, 11, 17, 23]);
		for (let k = 1; k < zs.size(); k++) expect(zs[k] - zs[k - 1]).toBeCloseTo((16 * 6) / 60, 9);
	});

	it("embers are stationary EMBER bullets of the owner (1 damage, effect EMBER gen 0) for 1.2 s, in the budget", () => {
		const s = fresh(BOW_ARENA);
		duoBuild(s, Duo.FIRE_ARROWS);
		for (let t = 0; t < 30; t++) step(s, t === 0 ? FIRE_NORTH : AIM_NORTH, BOW_ARENA);
		const out = embers(s);
		expect(out.size()).toBe(4);
		for (const b of out) {
			expect([b.source, b.damage, b.pierce, b.vx, b.vz]).toEqual([buildSource(BuildEffect.EMBER, 0), 1, 0, 0, 0]);
		}
		expect(effectBulletsAlive(s, 0)).toBe(4);
		// Each ember lives EMBER_BURST.life = 1.2 s = 72 ticks: spawned on step 5, 11, 17, 23, gone 72 steps later.
		const drops: number[] = [];
		let alive = 4;
		for (let t = 30; t < 120; t++) {
			step(s, AIM_NORTH, BOW_ARENA);
			const now = embers(s).size();
			for (let k = now; k < alive; k++) drops.push(t);
			alive = now;
		}
		expect(drops).toEqual([5 + 72, 11 + 72, 17 + 72, 23 + 72]);
	});

	it("an ember is consumed by the first enemy it touches (1 damage, no other)", () => {
		const s = fresh(BOW_ARENA);
		duoBuild(s, Duo.FIRE_ARROWS);
		for (let t = 0; t < 30; t++) step(s, t === 0 ? FIRE_NORTH : AIM_NORTH, BOW_ARENA);
		const first = embers(s).sort((a, b) => a.z < b.z)[0];
		const ctx = ctxOf(s, BOW_ARENA);
		const a = dummy(ctx, first.x, first.z);
		const b = dummy(ctx, first.x, first.z);
		step(s, AIM_NORTH, BOW_ARENA);
		expect([a.hp + b.hp, embers(s).size()]).toEqual([19, 3]);
	});

	it("a heavy arrow drops 4 too; the Ember Wake ring fired with the bow in hand drops none; no duo, no embers", () => {
		const heavy = fresh(BOW_ARENA);
		duoBuild(heavy, Duo.FIRE_ARROWS);
		let n = 0;
		for (let t = 0; t < 120; t++) {
			step(heavy, t < 40 ? frame(0, 0, Button.ALT, 0, 1) : AIM_NORTH, BOW_ARENA);
			n += heavy.builds!.events.emberX.size();
		}
		expect(n).toBe(4);
		const ring = fresh(BOW_ARENA);
		duoBuild(ring, Duo.FIRE_ARROWS);
		const spawned = ring.combat.playerSpawned;
		let fromRing = 0;
		for (let t = 0; t < 30; t++) {
			step(ring, t === 0 ? frame(0, 0, Button.ROLL, 0, 1) : AIM_NORTH, BOW_ARENA);
			fromRing += ring.builds!.events.emberX.size();
		}
		expect(ring.combat.playerSpawned - spawned >= 16).toBe(true);
		expect(fromRing).toBe(0);
		expect(oneArrow(false).steps).toEqual([]);
	});
});

describe("Blazing Trail (Ember Wake + Slippery)", () => {
	it("a roll leaves an ember every 3 ticks where the player stands (6 per roll); no duo, none", () => {
		for (const withDuo of [true, false]) {
			const s = fresh();
			duoBuild(s, Duo.BLAZING_TRAIL, withDuo);
			const at: number[] = [];
			for (let t = 0; t < 30; t++) {
				step(s, frame(1, 0, t === 0 ? Button.ROLL : 0), ARENA);
				const e = s.builds!.events;
				for (let k = 0; k < e.emberX.size(); k++) {
					at.push(t);
					expect([e.emberX[k], e.emberZ[k], e.emberDuo[k]]).toEqual([
						s.player.x,
						s.player.z,
						Duo.BLAZING_TRAIL,
					]);
				}
			}
			expect(at).toEqual(withDuo ? [3, 6, 9, 12, 15, 18] : []);
			expect(embers(s).size()).toBe(withDuo ? 6 : 0);
		}
	});
});

describe("Storm Blade (Chain Spark + Swift Strikes)", () => {
	it("every sword finisher that hits sparks as if it killed (Chain Spark I: 2 damage); the combo swings do not", () => {
		for (const withDuo of [true, false]) {
			const s = fresh();
			duoBuild(s, Duo.STORM_BLADE, withDuo);
			const ctx = ctxOf(s);
			const a = dummy(ctx, 0, 2, 1000); // in the swings' reach
			const b = dummy(ctx, 3.5, 2, 1000); // 3.5 from a, out of every swing's reach
			let finishers = 0;
			let procs = 0;
			for (let t = 0; t < 150; t++) {
				const tick = s.tick;
				step(s, FIRE_NORTH, ARENA);
				const w = s.combat.weapons;
				if (w.swingTick === tick && w.sets[w.activeSet].v[SWORD_V_LAST] === SWORD_FINISHER) finishers++;
				for (const [duo, owner, value] of duoProcs(s)) {
					expect([duo, owner, value]).toEqual([Duo.STORM_BLADE, 0, 1]);
					procs++;
				}
			}
			expect(a.hp < 1000).toBe(true);
			expect(finishers > 0).toBe(true);
			expect(procs).toBe(withDuo ? finishers : 0);
			expect(b.hp).toBe(1000 - 2 * procs);
		}
	});

	it("every 5th arrow hit sparks from the enemy hit; its kill procs at gen 1", () => {
		const s = fresh(BOW_ARENA);
		duoBuild(s, Duo.STORM_BLADE, true, [Boon.VOLATILE]);
		const ctx = ctxOf(s, BOW_ARENA);
		const a = dummy(ctx, 0, 3, 1000);
		const b = dummy(ctx, 3, 3, 1000);
		const sparkGens: number[] = [];
		for (let t = 0; t < 150; t++) {
			step(s, FIRE_NORTH, BOW_ARENA);
			for (const g of s.builds!.events.sparkGen) sparkGens.push(g);
		}
		const hits = 1000 - a.hp;
		expect(hits >= 2 * STORM_BLADE_ARROW_HITS).toBe(true);
		const sparks = math.floor(hits / STORM_BLADE_ARROW_HITS);
		expect([1000 - b.hp, sparks, s.builds!.players[0].bigHits]).toEqual([2 * sparks, sparkGens.size(), hits % 5]);
		for (const g of sparkGens) expect(g).toBe(0);
		// A spark kill: the proc it makes is generation 1 (Volatile's ring at gen 1 from b's corpse).
		b.hp = 2;
		let burstGen = -1;
		for (let t = 0; t < 120 && burstGen < 0; t++) {
			step(s, FIRE_NORTH, BOW_ARENA);
			const e = s.builds!.events;
			if (e.burstX.size() > 0) burstGen = e.burstGen[0];
		}
		expect([b.alive, burstGen]).toEqual([0, 1]);
	});
});

describe("Conductor (Chain Spark + Piercing Arrows)", () => {
	it("an arrow passing through an enemy sparks once to the nearest other enemy for 1; the consuming hit does not", () => {
		for (const withDuo of [true, false]) {
			const s = fresh(BOW_ARENA);
			duoBuild(s, Duo.CONDUCTOR, withDuo); // Piercing Arrows I: the arrow passes through 1
			const ctx = ctxOf(s, BOW_ARENA);
			const a = dummy(ctx, 0, 3, 100); // passed through
			const c = dummy(ctx, 2.5, 3, 100); // nearest other to a (2.5 < 3)
			const b = dummy(ctx, 0, 6, 100); // the arrow's last hit
			const procs: Array<[number, number, number]> = [];
			const gens: number[] = [];
			for (let t = 0; t < 40; t++) {
				step(s, t === 0 ? FIRE_NORTH : AIM_NORTH, BOW_ARENA);
				for (const p of duoProcs(s)) procs.push(p);
				for (const g of s.builds!.events.sparkGen) gens.push(g);
			}
			expect([a.hp, b.hp, c.hp]).toEqual([99, 99, withDuo ? 99 : 100]);
			expect(procs).toEqual(withDuo ? [[Duo.CONDUCTOR, 0, 1]] : []);
			expect(gens).toEqual(withDuo ? [0] : []);
		}
	});
});

describe("Shrapnel (Volatile + Sharpened)", () => {
	function bolts(level: number, withDuo: boolean): Shot[] {
		const s = fresh();
		duoBuild(s, Duo.SHRAPNEL, withDuo);
		for (let k = 1; k < level; k++) grantCard(s, 0, Boon.VOLATILE);
		const ctx = ctxOf(s);
		kill(ctx, dummy(ctx, 0, 3, 1));
		step(s, IDLE, ARENA);
		return shots(s).filter((b) => b.source === buildSource(BuildEffect.VOLATILE, 0));
	}

	it("burst bolts deal 2 and pierce 1; Cataclysm's pierce becomes 2; without the duo 1 and 0", () => {
		const one = bolts(1, true);
		expect(one.size()).toBe(8);
		for (const b of one)
			expect([b.kind, b.damage, b.pierce]).toEqual([BulletKind.BURST, SHRAPNEL_DAMAGE, SHRAPNEL_PIERCE]);
		const three = bolts(3, true);
		expect(three.size()).toBe(16);
		for (const b of three) expect([b.damage, b.pierce]).toEqual([SHRAPNEL_DAMAGE, SHRAPNEL_CATACLYSM_PIERCE]);
		for (const b of bolts(1, false)) expect([b.damage, b.pierce]).toEqual([1, 0]);
	});
});

describe("Chain Reaction (Volatile + Chain Spark)", () => {
	/** A kill of generation `gen` by `cause` (as a spark or a bolt would make it), then one step. */
	function genKill(withDuo: boolean, gen: number, cause: number): { s: SimState; n: ActorState } {
		const s = fresh();
		duoBuild(s, Duo.CHAIN_REACTION, withDuo, [Boon.SOUL_SHARDS]);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, 3, 1);
		const n = dummy(ctx, 2, 3); // a neighbour in spark and shard range
		ctx.actingPlayer(0);
		ctx.procGen = gen;
		ctx.procCause = cause;
		ctx.damageActor(victim, 1);
		ctx.procGen = 0;
		ctx.procCause = KillCause.NONE;
		expect(s.builds!.procs.size()).toBe(0); // a genMax kill never queues a proc
		step(s, IDLE, ARENA);
		return { s, n };
	}

	it("a GEN_MAX spark kill still bursts and a GEN_MAX bolt kill still sparks, AT GEN_MAX, and nothing else", () => {
		const genMax = BUILDS_CONFIG.genMax;
		const spark = genKill(true, genMax, KillCause.SPARK);
		const e = spark.s.builds!.events;
		expect([e.burstGen, e.burstFired, e.sparkX1.size(), e.shardX.size()]).toEqual([[genMax], [8], 0, 0]);
		expect(duoProcs(spark.s)).toEqual([[Duo.CHAIN_REACTION, 0, 8]]);
		const out = shots(spark.s);
		expect(out.size()).toBe(8);
		for (const b of out) expect(b.source).toBe(buildSource(BuildEffect.VOLATILE, genMax));
		const bolt = genKill(true, genMax, KillCause.BURST);
		const f = bolt.s.builds!.events;
		expect([f.sparkGen, f.burstX.size(), f.shardX.size(), bolt.n.hp]).toEqual([[genMax], 0, 0, 8]);
		expect(duoProcs(bolt.s)).toEqual([[Duo.CHAIN_REACTION, 0, 1]]);
	});

	it("never past GEN_MAX: a kill by a GEN_MAX effect, a kill by anything else, or no duo: nothing", () => {
		const genMax = BUILDS_CONFIG.genMax;
		for (const [withDuo, gen, cause] of [
			[true, genMax + 1, KillCause.SPARK],
			[true, genMax + 1, KillCause.BURST],
			[true, genMax, KillCause.NONE],
			[false, genMax, KillCause.SPARK],
			[false, genMax, KillCause.BURST],
		] as const) {
			const { s, n } = genKill(withDuo, gen, cause);
			const e = s.builds!.events;
			expect([gen, cause, e.burstX.size(), e.sparkX1.size(), e.duoProcDuo.size(), shots(s).size(), n.hp]).toEqual(
				[gen, cause, 0, 0, 0, 0, 10],
			);
		}
	});

	it("a spark chain down a line reaches a gen-3 burst only with the duo; no proc is ever queued at GEN_MAX", () => {
		for (const withDuo of [true, false]) {
			const s = fresh();
			duoBuild(s, Duo.CHAIN_REACTION, withDuo);
			const ctx = ctxOf(s);
			// 4.4 apart: inside the spark's 4.5, beyond a bolt's 3.5 + radii; each dies to a spark a tick before any
			// bolt could reach it.
			const line = [-6.6, -2.2, 2.2, 6.6].map((x) => dummy(ctx, x, 4, 1));
			kill(ctx, line[0]);
			const burstGens: number[] = [];
			const sparkGens: number[] = [];
			let maxQueued = -1;
			for (let t = 0; t < 12; t++) {
				step(s, IDLE, ARENA);
				const e = s.builds!.events;
				for (const g of e.burstGen) burstGens.push(g);
				for (const g of e.sparkGen) sparkGens.push(g);
				for (const q of s.builds!.procs) if (q.gen > maxQueued) maxQueued = q.gen;
			}
			for (const a of line) expect(a.alive).toBe(0);
			expect(sparkGens).toEqual([0, 1, 2]);
			expect(burstGens).toEqual(withDuo ? [0, 1, 2, 3] : [0, 1, 2]);
			expect(maxQueued <= BUILDS_CONFIG.genMax - 1).toBe(true);
		}
	});
});

describe("Close Call (Soul Shards + Daredevil)", () => {
	it("every 3rd graze releases one shard at the nearest enemy (effect CLOSE_CALL, gen 0)", () => {
		const s = fresh();
		duoBuild(s, Duo.CLOSE_CALL);
		const ctx = ctxOf(s);
		dummy(ctx, 0, 4);
		for (let k = 0; k < 2; k++) buildsOnGraze(s, 0);
		step(s, IDLE, ARENA);
		expect([s.builds!.players[0].closeGrazes, duoProcs(s).size()]).toEqual([2, 0]);
		buildsOnGraze(s, 0);
		step(s, IDLE, ARENA);
		expect([s.builds!.players[0].closeGrazes, duoProcs(s)]).toEqual([0, [[Duo.CLOSE_CALL, 0, 1]]]);
		const out = shots(s).filter((b) => b.source === buildSource(BuildEffect.CLOSE_CALL, 0));
		expect(out.size()).toBe(1);
		expect([out[0].kind, out[0].vx, out[0].vz > 0]).toEqual([BulletKind.SHARD, 0, true]);
	});

	it("a real graze counts (beside Thrill Seeker's own count); without the duo nothing counts", () => {
		const s = fresh();
		duoBuild(s, Duo.CLOSE_CALL, true, [Boon.DAREDEVIL, Boon.DAREDEVIL]); // Daredevil III: a 1-tile graze ring
		const ctx = ctxOf(s);
		dummy(ctx, 0, 4);
		s.builds!.players[0].closeGrazes = 2;
		enemyBullet(s, -3, 1, 10, 1); // passes 1 tile beside the player
		let released = 0;
		for (let t = 0; t < 60; t++) {
			step(s, IDLE, ARENA);
			released += duoProcs(s).size();
		}
		expect([s.score!.counts[ScoreSource.GRAZES], released, s.builds!.players[0].grazes]).toEqual([1, 1, 1]);
		const none = fresh();
		duoBuild(none, Duo.CLOSE_CALL, false);
		buildsOnGraze(none, 0);
		expect(none.builds!.players[0].closeGrazes).toBe(0);
	});
});

describe("Gold Rush (Bounty + Lingering)", () => {
	function killPoints(withDuo: boolean, combo: number, bountyLevel = 1): number {
		const s = fresh();
		duoBuild(s, Duo.GOLD_RUSH, withDuo);
		for (let k = 1; k < bountyLevel; k++) grantCard(s, 0, Boon.BOUNTY);
		s.score!.combo = combo;
		const ctx = ctxOf(s);
		kill(ctx, dummy(ctx, 1, 2, 1));
		const pops = s.score!.events.popPoints;
		expect(pops.size()).toBe(1);
		const procs = duoProcs(s);
		expect(procs).toEqual(withDuo && combo >= 30 ? [[Duo.GOLD_RUSH, 0, pops[0]]] : []);
		return pops[0];
	}

	/** floor(base x combo/10 x depth x 1 (no curse) x 100 % (floor 1) x bounty/100 x gold/100), exactly. */
	function want(combo: number, bounty: number, gold: number): number {
		const base = KILL_POINTS.get("test.dummy") ?? DEFAULT_KILL_POINTS;
		const depth = fresh().endless!.depth;
		const num = base * combo * depth * bounty * gold;
		const den = 10 * 100 * 100;
		return (num - (num % den)) / den;
	}

	it("a kill at combo x3 or more scores x1.25 after Bounty, exactly; below x3, or without the duo, not", () => {
		expect(killPoints(true, 30)).toBe(want(30, 110, 125));
		expect(killPoints(true, 30, 3)).toBe(want(30, 130, 125));
		expect(killPoints(true, 45)).toBe(want(45, 110, 125));
		expect(killPoints(true, 29)).toBe(want(29, 110, 100));
		expect(killPoints(false, 30)).toBe(want(30, 110, 100));
		// The plain numbers (base 50 at Depth 1): 50 x 3 x 1.1 x 1.25 = 206.25; 50 x 3 x 1.3 x 1.25 = 243.75.
		if (want(30, 110, 125) === 206) expect([want(30, 130, 125), want(30, 110, 100)]).toEqual([243, 165]);
	});
});

describe("Unshaken (Composure + Warding)", () => {
	function hit(withDuo: boolean, armor: boolean): SimState {
		const s = fresh();
		duoBuild(s, Duo.UNSHAKEN, withDuo);
		if (!armor) s.player.armor = 0;
		expect(s.player.armor > 0).toBe(armor);
		s.score!.combo = 30;
		s.score!.comboTimer = 300;
		step(s, frame(0, 0, Button.DEBUG_HIT), ARENA);
		expect(s.score!.hitsTaken).toBe(1);
		return s;
	}

	it("a hit taken on armor never cuts the combo (it still counts as a hit)", () => {
		const s = hit(true, true);
		expect([s.score!.combo, s.score!.events.comboCut, s.builds!.events.unshakenKept]).toEqual([30, 0, 1]);
		expect(duoProcs(s)).toEqual([[Duo.UNSHAKEN, 0, 1]]);
	});

	it("a hit on hearts still cuts it; without the duo an armor hit cuts it (Composure: x 3/4, 30 -> 22)", () => {
		expect(hit(true, false).score!.combo).toBe(22);
		expect(hit(false, true).score!.combo).toBe(22);
		expect(hit(false, true).builds!.events.unshakenKept).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------

describe("duos together: determinism", () => {
	const PACK = [
		[-1.5, 5],
		[-0.5, 5],
		[0.5, 5],
		[1.5, 5],
		[-1, 6],
		[0, 6],
		[1, 6],
		[0, 7],
		[-3, 4],
		[3, 4],
	] as const;
	const config = configOf({ loadout: ["weapon.bow"], spawns: PACK.map(([x, z]) => ({ kind: SWARMER.id, x, z })) });

	function run(): { hashes: string[]; embers: number; procs: number } {
		const s = fresh(config);
		for (const boon of [
			Boon.EMBER_WAKE,
			Boon.PIERCING_ARROWS,
			Boon.SLIPPERY,
			Boon.CHAIN_SPARK,
			Boon.SWIFT_STRIKES,
			Boon.VOLATILE,
			Boon.SHARPENED,
			Boon.SOUL_SHARDS,
			Boon.DAREDEVIL,
			Boon.BOUNTY,
			Boon.LINGERING,
			Boon.COMPOSURE,
			Boon.WARDING,
		]) {
			grantCard(s, 0, boon);
		}
		for (let d = 0; d < DUO_COUNT; d++) grantCard(s, 0, duoCard(d));
		expect(s.builds!.players[0].duos.size()).toBe(DUO_COUNT);
		const hashes: string[] = [];
		let emberCount = 0;
		let procs = 0;
		for (let t = 0; t < 120; t++) {
			const input: InputFrame = frame(0, 0, Button.FIRE + (t % 40 === 20 ? Button.ROLL : 0), 0, 1);
			step(s, input, config);
			hashes.push(hashState(s));
			emberCount += s.builds!.events.emberX.size();
			procs += s.builds!.events.duoProcDuo.size();
		}
		return { hashes, embers: emberCount, procs };
	}

	it("two runs hash the same every tick", () => {
		const a = run();
		const b = run();
		expect(a.hashes).toEqual(b.hashes);
		expect(a.embers > 0).toBe(true);
		expect(a.procs > 0).toBe(true);
	});
});
