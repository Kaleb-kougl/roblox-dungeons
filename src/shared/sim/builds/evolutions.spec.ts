// Builds BU5 (docs/BUILDS.md "Evolutions (level III)"): one spec group per evolution (Storm Crown forks, Cataclysm
// pierces, Soul Swarm steers deterministically and turn-limited, Executioner only at <= 20 % and never on a boss,
// Flurry's crescent and triple arrow, Ricochet's split targets, Lionheart only on PERFECT, Phantom Step only during
// i-frames, Overflowing / Bulwark novas with the guard's goo rules and no parry feed, Momentum once per tier crossing,
// Thrill Seeker every 8 grazes, Jackpot every 15th kill as a build-only score source), and determinism.
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_ACT1_ID,
	BUILDS_CONFIG,
	BossFightState,
	BULWARK_NOVA_RADIUS,
	Boon,
	BuildEffect,
	BulletKind,
	BulletPayload,
	Button,
	DEFAULT_BOUNDS,
	EMPTY_INPUT,
	FlurryKind,
	JACKPOT_KILLS,
	NovaKind,
	OVERFLOWING_NOVA_RADIUS,
	SCORE_SOURCE_COUNT,
	SOUL_SWARM_TURN,
	SWARMER,
	ScoreSource,
	SimCtx,
	buildSource,
	buildsOnGraze,
	createSimState,
	fireBurstRaw,
	grantCard,
	hashLayout,
	hashState,
	packPayload,
	step,
	type ActorState,
	type EncounterRoom,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const IDLE = EMPTY_INPUT;

// ---------------------------------------------------------------------------------------------
// Open endless arenas (procs.spec.ts's): the greybox square on every floor, no rooms, stairs out of reach, builds on.

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

function setLevel(s: SimState, boon: number, level: number, player = 0): void {
	s.builds!.players[player].levels[boon] = level;
}

/** Grants `boon` `level` times through the draft's grant (levels, mods and one-off effects as in play). */
function grantLevels(s: SimState, boon: number, level: number): void {
	for (let k = 0; k < level; k++) grantCard(s, 0, boon);
}

interface Shot {
	kind: number;
	source: number;
	damage: number;
	pierce: number;
	vx: number;
	vz: number;
}

function shots(s: SimState): Shot[] {
	const out: Shot[] = [];
	const sim = s.combat.playerBullets;
	sim.forEachActive((i, _pos, payload) => {
		const v = sim.velocityAt(i);
		out.push({
			kind: BulletPayload.get(payload, "kind"),
			source: BulletPayload.get(payload, "source"),
			damage: BulletPayload.get(payload, "damage"),
			pierce: BulletPayload.get(payload, "pierce"),
			vx: v.x,
			vz: v.z,
		});
		return false;
	});
	return out;
}

/** A stationary (or moving) enemy bullet at (x, z). */
function enemyBullet(s: SimState, x: number, z: number, kind: number = BulletKind.ENEMY, speed = 0, dirX = 0): void {
	const c = s.combat;
	const dirZ = dirX === 0 ? 1 : 0;
	c.enemySpawned += fireBurstRaw(c.enemyBullets, 1, x, z, dirX, dirZ, 1, 0, speed, 3, packPayload(1, kind, 1));
}

/** Live enemy bullets as [x, z, kind]. */
function enemyBullets(s: SimState): Array<[number, number, number]> {
	const out: Array<[number, number, number]> = [];
	s.combat.enemyBullets.forEachActive((_i, pos, payload) => {
		out.push([pos.x, pos.z, BulletPayload.get(payload, "kind")]);
		return false;
	});
	return out;
}

// ---------------------------------------------------------------------------------------------

describe("Storm Crown (Chain Spark III)", () => {
	function run(level: number): { s: SimState; a: ActorState; f: ActorState } {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, level);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, -3, 1);
		const a = dummy(ctx, 2, -3); // the hop
		const f = dummy(ctx, -3, -3); // 3 from the corpse, 5 from the hop's target: only a fork reaches it
		kill(ctx, victim);
		step(s, IDLE, ARENA);
		return { s, a, f };
	}

	it("each hop forks from its start to the next nearest enemy for floor(3 / 2) = 1", () => {
		const { s, a, f } = run(3);
		expect([a.hp, f.hp]).toEqual([7, 9]);
		const e = s.builds!.events;
		expect([e.sparkX1, e.sparkZ1, e.sparkX2, e.sparkZ2, e.sparkFork]).toEqual([
			[0, 0],
			[-3, -3],
			[2, -3],
			[-3, -3],
			[0, 1],
		]);
	});

	it("level II never forks (every segment sparkFork 0)", () => {
		const { s, a, f } = run(2);
		expect([a.hp, f.hp]).toEqual([8, 10]);
		expect(s.builds!.events.sparkFork).toEqual([0]);
	});

	it("4 hops, never the same enemy twice (forks count as struck)", () => {
		const s = fresh();
		setLevel(s, Boon.CHAIN_SPARK, 3);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, -6, 0, 1);
		const line: ActorState[] = [];
		for (let k = 0; k < 6; k++) line.push(dummy(ctx, -4 + k * 2, 0, 100));
		kill(ctx, victim);
		step(s, IDLE, ARENA);
		const e = s.builds!.events;
		// Hop 1 (from the corpse at -6) strikes -4, its fork -2; hop 2 (from -4) skips -2 and strikes 0, its fork finds
		// nothing new within 4.5; hop 3 (from 0) strikes 2, its fork 4; hop 4 (from 2) strikes 6, nothing left to fork.
		expect([e.sparkX1, e.sparkX2, e.sparkFork]).toEqual([
			[-6, -6, -4, 0, 0, 2],
			[-4, -2, 0, 2, 4, 6],
			[0, 1, 0, 0, 1, 0],
		]);
		expect(line.map((a) => a.hp)).toEqual([97, 99, 97, 97, 99, 97]);
	});
});

describe("Cataclysm (Volatile III)", () => {
	function run(level: number): { s: SimState; b: ActorState; out: Shot[] } {
		const s = fresh();
		setLevel(s, Boon.VOLATILE, level);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 2, -4, 1);
		dummy(ctx, 2, -2.5); // in bolt 0's path
		const b = dummy(ctx, 2, -1.2); // behind it: only a bolt that pierced reaches it
		kill(ctx, victim);
		step(s, IDLE, ARENA);
		const out = shots(s);
		for (let k = 0; k < 30; k++) step(s, IDLE, ARENA);
		return { s, b, out };
	}

	it("16 BURST bolts that pierce 1: the enemy behind the first one is hit", () => {
		const { b, out } = run(3);
		expect(out.size()).toBe(16);
		for (const shot of out) {
			expect([shot.kind, shot.source, shot.pierce]).toEqual([
				BulletKind.BURST,
				buildSource(BuildEffect.VOLATILE, 0),
				1,
			]);
		}
		expect(b.hp).toBe(9);
	});

	it("level II's bolts stop at the first enemy", () => {
		const { b, out } = run(2);
		expect(out.size()).toBe(12);
		expect(b.hp).toBe(10);
	});
});

describe("Soul Swarm (Soul Shards III)", () => {
	const SPEED = 14;
	const MIN_COS = 1 / math.sqrt(1 + SOUL_SWARM_TURN * SOUL_SWARM_TURN);

	/** Velocities of the first live shard per tick, after the target jumps aside on the second tick. */
	function run(level: number): Array<[number, number]> {
		const s = fresh();
		setLevel(s, Boon.SOUL_SHARDS, level);
		const ctx = ctxOf(s);
		const victim = dummy(ctx, 0, -6, 1);
		const t = dummy(ctx, 0, 1, 1000);
		kill(ctx, victim);
		step(s, IDLE, ARENA);
		const out: Array<[number, number]> = [];
		const first = shots(s);
		out.push([first[0].vx, first[0].vz]);
		t.x = 3; // jumps aside: the shards turn toward it
		for (let k = 0; k < 8; k++) {
			step(s, IDLE, ARENA);
			const now = shots(s);
			out.push([now[0].vx, now[0].vz]);
		}
		return out;
	}

	it("fires 4 piercing SHARDs with Soul Swarm's own source", () => {
		const s = fresh();
		setLevel(s, Boon.SOUL_SHARDS, 3);
		const ctx = ctxOf(s);
		kill(ctx, dummy(ctx, 0, -6, 1));
		dummy(ctx, 0, 1, 1000);
		step(s, IDLE, ARENA);
		const out = shots(s);
		expect(out.size()).toBe(4);
		for (const shot of out) {
			expect([shot.kind, shot.source, shot.pierce]).toEqual([
				BulletKind.SHARD,
				buildSource(BuildEffect.SOUL_SWARM, 0),
				1,
			]);
		}
	});

	it("steers toward the nearest enemy, turn-limited (cos >= 1 / sqrt(1 + TURN^2)), at its own speed", () => {
		const v = run(3);
		expect(v[0]).toEqual([0, SPEED]);
		expect(v[1][0] > 0).toBe(true);
		for (let k = 1; k < v.size(); k++) {
			const [ax, az] = v[k - 1];
			const [bx, bz] = v[k];
			expect(math.sqrt(bx * bx + bz * bz)).toBeCloseTo(SPEED, 9);
			const cos = (ax * bx + az * bz) / (SPEED * SPEED);
			expect(cos >= MIN_COS - 1e-12).toBe(true);
		}
	});

	it("is deterministic (two runs, identical velocities) and level II shards fly straight", () => {
		expect(run(3)).toEqual(run(3));
		for (const vel of run(2)) expect(vel).toEqual([0, SPEED]);
	});
});

describe("Executioner (Sharpened III)", () => {
	it("a hit that leaves a non-boss enemy at or below 20 % kills it; above 20 % it does not", () => {
		const s = fresh();
		setLevel(s, Boon.SHARPENED, 3);
		const ctx = ctxOf(s);
		const a = dummy(ctx, 2, 0);
		const b = dummy(ctx, 4, 0);
		ctx.damageActor(a, 8); // leaves 2 of 10: 20 %
		ctx.damageActor(b, 7.9); // leaves 2.1: 21 %
		expect([a.alive, a.hp, b.alive, b.hp]).toEqual([0, 0, 1, 10 - 7.9]);
		const e = s.builds!.events;
		expect([e.execX, e.execZ, e.execOwner]).toEqual([[2], [0], [0]]);
		// Below 20 % already: the next hit, however small, executes.
		ctx.damageActor(b, 0.2);
		expect(b.alive).toBe(0);
	});

	it("an execute is a player kill: it scores and procs", () => {
		const s = fresh();
		setLevel(s, Boon.SHARPENED, 3);
		setLevel(s, Boon.VOLATILE, 1);
		const ctx = ctxOf(s);
		const a = dummy(ctx, 2, 0);
		ctx.damageActor(a, 9);
		expect(a.alive).toBe(0);
		expect(s.score!.counts[ScoreSource.KILLS]).toBe(1);
		expect(s.builds!.procs.size()).toBe(1);
	});

	it("never on a boss, and never below level III", () => {
		const s = fresh();
		setLevel(s, Boon.SHARPENED, 3);
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
		boss.hp = boss.hpMax * 0.15;
		const before = boss.hp;
		ctx.damageActor(boss, 1);
		expect([boss.alive, boss.hp]).toEqual([1, before - 1]);
		expect(s.builds!.events.execX.size()).toBe(0);
		const s2 = fresh();
		setLevel(s2, Boon.SHARPENED, 2);
		const c2 = ctxOf(s2);
		const a = dummy(c2, 2, 0);
		c2.damageActor(a, 9);
		expect([a.alive, a.hp]).toEqual([1, 1]);
	});
});

describe("Flurry (Swift Strikes III)", () => {
	const HOLD_FIRE = frame(0, 0, Button.FIRE, 0, 1);

	it("every finisher releases a 5-bolt crescent (SPARK_BOLT, Flurry's source) along the swing", () => {
		for (const level of [3, 2]) {
			const s = fresh();
			setLevel(s, Boon.SWIFT_STRIKES, level);
			let crescents = 0;
			let bolts = 0;
			for (let t = 0; t < 120; t++) {
				step(s, HOLD_FIRE, ARENA);
				const e = s.builds!.events;
				for (let k = 0; k < e.flurryKind.size(); k++) {
					expect([e.flurryKind[k], e.flurryFired[k]]).toEqual([FlurryKind.CRESCENT, 5]);
					crescents++;
				}
				if (e.flurryKind.size() > 0) {
					const out = shots(s).filter((b) => b.source === buildSource(BuildEffect.FLURRY, 0));
					for (const b of out) expect(b.kind).toBe(BulletKind.SPARK_BOLT);
					bolts += out.size();
				}
			}
			if (level === 3) {
				expect(crescents > 0).toBe(true);
				expect(bolts).toBe(crescents * 5);
			} else expect(crescents).toBe(0);
		}
	});

	it("every 6th stream arrow is fired as 3 (3 @ 0.12)", () => {
		const s = fresh(BOW_ARENA);
		setLevel(s, Boon.SWIFT_STRIKES, 3);
		const volleys: number[] = [];
		for (let t = 0; t < 100 && volleys.size() < 8; t++) {
			const before = s.combat.playerSpawned;
			step(s, HOLD_FIRE, BOW_ARENA);
			const n = s.combat.playerSpawned - before;
			if (n > 0) volleys.push(n);
			const e = s.builds!.events;
			if (n === 3) expect([e.flurryKind, e.flurryFired]).toEqual([[FlurryKind.ARROWS], [3]]);
		}
		expect(volleys).toEqual([1, 1, 1, 1, 1, 3, 1, 1]);
	});
});

describe("Ricochet (Piercing Arrows III)", () => {
	const FIRE_NORTH = frame(0, 0, Button.FIRE, 0, 1);
	const AIM_NORTH = frame(0, 0, 0, 0, 1);

	function run(level: number, lastHp = 1): { s: SimState; d: ActorState; e: ActorState; fired: number[] } {
		const s = fresh(BOW_ARENA);
		grantLevels(s, Boon.PIERCING_ARROWS, level);
		const ctx = ctxOf(s, BOW_ARENA);
		dummy(ctx, 0, 2, 1);
		dummy(ctx, 0, 3, 1);
		dummy(ctx, 0, 4, lastHp); // the arrow's last hit (pierce 2 spent on the two before)
		const d = dummy(ctx, 3, 4.5);
		const e = dummy(ctx, -3.5, 5);
		const fired: number[] = [];
		for (let t = 0; t < 40; t++) {
			step(s, t === 0 ? FIRE_NORTH : AIM_NORTH, BOW_ARENA);
			for (const n of s.builds!.events.ricochetFired) fired.push(n);
		}
		return { s, d, e, fired };
	}

	it("an arrow whose last hit kills splits into 2 arrows at the 2 nearest enemies (never the victim)", () => {
		const { d, e, fired } = run(3);
		expect(fired).toEqual([2]);
		expect([d.hp, e.hp]).toEqual([9, 9]);
	});

	it("the split arrows are Ricochet's SPARK_BOLTs aimed at their targets", () => {
		const s = fresh(BOW_ARENA);
		grantLevels(s, Boon.PIERCING_ARROWS, 3);
		const ctx = ctxOf(s, BOW_ARENA);
		dummy(ctx, 0, 2, 1);
		dummy(ctx, 0, 3, 1);
		dummy(ctx, 0, 4, 1);
		dummy(ctx, 3, 4.5);
		dummy(ctx, -3.5, 5);
		let split: Shot[] = [];
		for (let t = 0; t < 40 && split.size() === 0; t++) {
			step(s, t === 0 ? FIRE_NORTH : AIM_NORTH, BOW_ARENA);
			if (s.builds!.events.ricochetX.size() > 0) {
				split = shots(s).filter((b) => b.source === buildSource(BuildEffect.RICOCHET, 0));
			}
		}
		expect(split.size()).toBe(2);
		for (const b of split) expect(b.kind).toBe(BulletKind.SPARK_BOLT);
		expect(split.some((b) => b.vx > 0)).toBe(true);
		expect(split.some((b) => b.vx < 0)).toBe(true);
	});

	it("no split below level III, or when the last hit does not kill", () => {
		const two = run(2);
		expect(two.fired).toEqual([]);
		expect([two.d.hp, two.e.hp]).toEqual([10, 10]);
		const tough = run(3, 10);
		expect(tough.fired).toEqual([]);
	});
});

describe("Lionheart (Hearty III)", () => {
	function run(level: number, perfect: boolean): number {
		const s = fresh();
		grantLevels(s, Boon.HEARTY, level);
		const p = s.player;
		p.hearts = p.heartsMax - 2;
		const ctx = ctxOf(s);
		const a = dummy(ctx, 3, 3, 1);
		const sc = s.score!;
		if (!perfect) sc.hitsTaken = 1;
		sc.rooms.push({
			room: 0,
			minX: -7,
			maxX: 7,
			minZ: -7,
			maxZ: 7,
			parTicks: 0,
			engageTick: s.tick,
			hitsAtEngage: 0,
			cleared: 0,
			memberSlots: [s.combat.actors.indexOf(a)],
			memberIds: [a.id],
		});
		kill(ctx, a);
		step(s, IDLE, ARENA);
		expect(sc.rooms[0].cleared).toBe(1);
		const e = s.builds!.events;
		return e.lionHealed.size() > 0 ? e.lionHealed[0] : 0;
	}

	it("a PERFECT room clear heals half a heart; a clear with a hit, or level II, does not", () => {
		expect(run(3, true)).toBe(1);
		expect(run(3, false)).toBe(0);
		expect(run(2, true)).toBe(0);
	});
});

describe("Phantom Step (Slippery III)", () => {
	const ROLL = frame(0, 0, Button.ROLL);

	function rolling(level: number): SimState {
		const s = fresh();
		grantLevels(s, Boon.SLIPPERY, level);
		step(s, ROLL, ARENA); // the roll starts (i-frames run)
		return s;
	}

	it("erases enemy bullets overlapping the rolling player while its i-frames run (no hit, no score)", () => {
		const s = rolling(3);
		const p = s.player;
		enemyBullet(s, p.x, p.z);
		const hearts = p.hearts;
		const total = s.score!.total;
		step(s, IDLE, ARENA);
		expect(enemyBullets(s).size()).toBe(0);
		expect([p.hearts, s.score!.total, s.score!.events.grazes, s.score!.events.guardX.size()]).toEqual([
			hearts,
			total,
			0,
			0,
		]);
		expect(s.builds!.events.phantomOwner).toEqual([0]);
	});

	it("goo too, quietly (the guard's goo rule: no spark entry)", () => {
		const s = rolling(3);
		enemyBullet(s, s.player.x, s.player.z, BulletKind.GOO);
		step(s, IDLE, ARENA);
		expect(enemyBullets(s).size()).toBe(0);
		expect(s.builds!.events.phantomX.size()).toBe(0);
	});

	it("only during i-frames: a roll without them takes the hit; level II's roll lets the bullet pass", () => {
		const s = rolling(3);
		const p = s.player;
		p.iframeTicks = 0;
		enemyBullet(s, p.x, p.z);
		const hearts = p.hearts;
		step(s, IDLE, ARENA);
		expect(p.hearts).toBe(hearts - 1);
		expect(s.builds!.events.phantomX.size()).toBe(0);
		const two = rolling(2);
		enemyBullet(two, two.player.x, two.player.z);
		step(two, IDLE, ARENA);
		expect(enemyBullets(two).size()).toBe(1);
		expect(two.builds!.events.phantomX.size()).toBe(0);
	});
});

describe("novas: Overflowing (Deep Flask III) and Bulwark (Warding III)", () => {
	function setup(boon: number, level: number): SimState {
		const s = fresh();
		grantLevels(s, boon, level);
		enemyBullet(s, 2, 0); // inside both radii
		enemyBullet(s, 0, -2.8); // inside Overflowing's 3, outside Bulwark's 2.5
		enemyBullet(s, -3.2, 0); // outside both
		enemyBullet(s, 0, 1.5, BulletKind.GOO); // goo inside both
		return s;
	}

	it("a flask drink releases a 3-tile nova: enemy bullets and goo erased, no guard points, no parry feed", () => {
		const s = setup(Boon.DEEP_FLASK, 3);
		s.player.hearts = s.player.heartsMax - 2;
		step(s, frame(0, 0, Button.FLASK), ARENA);
		expect(enemyBullets(s)).toEqual([[-3.2, 0, BulletKind.ENEMY]]);
		const e = s.builds!.events;
		expect([e.novaKind, e.novaRadius, e.novaOwner, e.novaErased]).toEqual([
			[NovaKind.OVERFLOWING],
			[OVERFLOWING_NOVA_RADIUS],
			[0],
			[3],
		]);
		expect([s.score!.points[ScoreSource.GUARD], s.score!.events.guardX.size()]).toEqual([0, 0]);
	});

	it("an armor pip breaking releases a 2.5-tile nova", () => {
		const s = setup(Boon.WARDING, 3);
		expect(s.player.armor > 0).toBe(true);
		const armor = s.player.armor;
		step(s, frame(0, 0, Button.DEBUG_HIT), ARENA);
		expect(s.player.armor).toBe(armor - 1);
		const left = enemyBullets(s);
		expect(left.size()).toBe(2);
		const e = s.builds!.events;
		expect([e.novaKind, e.novaRadius, e.novaErased]).toEqual([[NovaKind.BULWARK], [BULWARK_NOVA_RADIUS], [2]]);
		expect([s.score!.points[ScoreSource.GUARD], s.score!.events.guardX.size()]).toEqual([0, 0]);
		expect(s.builds!.players[0].bulwarkPending).toBe(0);
	});

	it("no nova below level III, and none for a hit on hearts", () => {
		const flask = setup(Boon.DEEP_FLASK, 2);
		flask.player.hearts = flask.player.heartsMax - 2;
		step(flask, frame(0, 0, Button.FLASK), ARENA);
		expect([enemyBullets(flask).size(), flask.builds!.events.novaX.size()]).toEqual([4, 0]);
		const ward = setup(Boon.WARDING, 3);
		ward.player.armor = 0;
		step(ward, frame(0, 0, Button.DEBUG_HIT), ARENA);
		expect([enemyBullets(ward).size(), ward.builds!.events.novaX.size()]).toEqual([4, 0]);
	});
});

describe("Momentum (Lingering III)", () => {
	/** Raises the combo across tier `tier` inside one step (a spark kill), with an enemy for the shards. */
	function cross(s: SimState, ctx: SimCtx, tier: number, x: number): void {
		s.score!.combo = tier * 10 - 2;
		kill(ctx, dummy(ctx, x, -4, 1)); // -> tier x 10 - 1 before the step
		dummy(ctx, x + 1, -4, 1); // the spark's kill inside the step: -> tier x 10
	}

	it("each tier crossing x2 .. x5 fires that many shards once (gen 0, without owning Soul Shards)", () => {
		const s = fresh();
		grantLevels(s, Boon.LINGERING, 3);
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const ctx = ctxOf(s);
		dummy(ctx, 0, 5, 1000);
		for (let tier = 2; tier <= 5; tier++) {
			cross(s, ctx, tier, -6 + tier * 2);
			const before = s.combat.playerSpawned;
			step(s, IDLE, ARENA);
			const e = s.builds!.events;
			expect([e.momentumTier, e.momentumFired]).toEqual([[tier], [tier]]);
			expect(s.combat.playerSpawned - before).toBe(tier);
			const out = shots(s).filter((b) => b.source === buildSource(BuildEffect.MOMENTUM, 0));
			for (const b of out) expect(b.kind).toBe(BulletKind.SHARD);
			// Staying at or above the tier fires nothing more.
			step(s, IDLE, ARENA);
			expect(s.builds!.events.momentumTier.size()).toBe(0);
		}
	});

	it("a combo that drops and rises again crosses again; level II never fires", () => {
		const s = fresh();
		grantLevels(s, Boon.LINGERING, 3);
		setLevel(s, Boon.CHAIN_SPARK, 1);
		const ctx = ctxOf(s);
		dummy(ctx, 0, 5, 1000);
		cross(s, ctx, 2, -4);
		step(s, IDLE, ARENA);
		cross(s, ctx, 2, 0);
		step(s, IDLE, ARENA);
		expect(s.builds!.events.momentumTier).toEqual([2]);
		const two = fresh();
		grantLevels(two, Boon.LINGERING, 2);
		setLevel(two, Boon.CHAIN_SPARK, 1);
		const c2 = ctxOf(two);
		dummy(c2, 0, 5, 1000);
		cross(two, c2, 2, -4);
		step(two, IDLE, ARENA);
		expect(two.builds!.events.momentumTier.size()).toBe(0);
	});
});

describe("Thrill Seeker (Daredevil III)", () => {
	it("every 8 grazes release a ring of 8 SPARK_BOLTs around the player", () => {
		const s = fresh();
		grantLevels(s, Boon.DAREDEVIL, 3);
		s.builds!.players[0].grazes = 7;
		enemyBullet(s, -3, 1, BulletKind.ENEMY, 10, 1); // passes 1 tile beside the player (inside III's graze ring)
		let rings = 0;
		for (let t = 0; t < 60; t++) {
			step(s, IDLE, ARENA);
			const e = s.builds!.events;
			if (e.thrillFired.size() > 0) {
				expect([e.thrillFired, e.thrillOwner]).toEqual([[8], [0]]);
				const out = shots(s).filter((b) => b.source === buildSource(BuildEffect.THRILL_SEEKER, 0));
				expect(out.size()).toBe(8);
				for (const b of out) expect(b.kind).toBe(BulletKind.SPARK_BOLT);
				rings++;
			}
		}
		expect(rings).toBe(1);
		expect(s.score!.counts[ScoreSource.GRAZES]).toBe(1);
		expect(s.builds!.players[0].grazes).toBe(0);
	});

	it("grazes count only at level III", () => {
		const s = fresh();
		setLevel(s, Boon.DAREDEVIL, 2);
		buildsOnGraze(s, 0);
		expect(s.builds!.players[0].grazes).toBe(0);
		setLevel(s, Boon.DAREDEVIL, 3);
		buildsOnGraze(s, 0);
		expect(s.builds!.players[0].grazes).toBe(1);
	});
});

describe("Jackpot (Bounty III)", () => {
	it("every 15th kill pays 100 x floor points (through the multipliers) into its own source", () => {
		const s = fresh();
		setLevel(s, Boon.BOUNTY, 3);
		const ctx = ctxOf(s);
		const sc = s.score!;
		for (let k = 0; k < JACKPOT_KILLS - 1; k++) kill(ctx, dummy(ctx, -6 + k * 0.8, 0, 1));
		expect(sc.counts[ScoreSource.JACKPOT]).toBe(0);
		kill(ctx, dummy(ctx, 5, 3, 1));
		// The combo after 14 kills is x2.4: 100 x 1 (floor) x 2.4 x the Depth.
		const want = 240 * s.endless!.depth;
		expect([sc.points[ScoreSource.JACKPOT], sc.counts[ScoreSource.JACKPOT]]).toEqual([want, 1]);
		const e = s.builds!.events;
		expect([e.jackpotX, e.jackpotZ, e.jackpotOwner, e.jackpotPoints]).toEqual([[5], [3], [0], [want]]);
		expect(s.builds!.players[0].kills).toBe(0);
		for (let k = 0; k < JACKPOT_KILLS - 1; k++) kill(ctx, dummy(ctx, -6 + k * 0.8, 2, 1));
		expect(sc.counts[ScoreSource.JACKPOT]).toBe(1);
	});

	it("level II pays nothing; the source exists (and hashes) only in builds runs", () => {
		const s = fresh();
		setLevel(s, Boon.BOUNTY, 2);
		const ctx = ctxOf(s);
		for (let k = 0; k < JACKPOT_KILLS; k++) kill(ctx, dummy(ctx, -6 + k * 0.8, 0, 1));
		expect(s.score!.counts[ScoreSource.JACKPOT]).toBe(0);
		// JACKPOT right after the always-on sources; since docs/BUILDS_V2.md BV9 a builds run pads on to OVERCAP.
		expect(s.score!.points.size()).toBe(ScoreSource.OVERCAP + 1);
		expect(ScoreSource.JACKPOT).toBe(SCORE_SOURCE_COUNT);
		const plain = fresh({ ...ARENA, builds: undefined });
		expect([plain.score!.points.size(), plain.score!.counts.size()]).toEqual([
			SCORE_SOURCE_COUNT,
			SCORE_SOURCE_COUNT,
		]);
		for (const st of [s, plain]) {
			const layout = hashLayout(st, true);
			expect(layout.names.size()).toBe(layout.values.size());
		}
		expect(hashLayout(s, true).names.includes("score.points.jackpot")).toBe(true);
		expect(hashLayout(plain, true).names.includes("score.points.jackpot")).toBe(false);
	});
});

// ---------------------------------------------------------------------------------------------

describe("evolutions together: determinism", () => {
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

	function run(): { hashes: string[]; forks: number; s: SimState } {
		const s = fresh(config);
		for (const boon of [
			Boon.CHAIN_SPARK,
			Boon.VOLATILE,
			Boon.SOUL_SHARDS,
			Boon.SHARPENED,
			Boon.SWIFT_STRIKES,
			Boon.PIERCING_ARROWS,
			Boon.LINGERING,
			Boon.BOUNTY,
			Boon.DAREDEVIL,
		]) {
			grantLevels(s, boon, 3);
		}
		const hashes: string[] = [];
		let forks = 0;
		for (let t = 0; t < 90; t++) {
			const input: InputFrame = frame(0, 0, Button.FIRE, 0, 1);
			step(s, input, config);
			hashes.push(hashState(s));
			for (const f of s.builds!.events.sparkFork) forks += f;
		}
		return { hashes, forks, s };
	}

	it("two runs hash the same every tick", () => {
		const a = run();
		const b = run();
		expect(a.hashes).toEqual(b.hashes);
		expect(a.forks > 0).toBe(true);
	});
});
