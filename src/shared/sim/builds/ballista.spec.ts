// Builds v2 BV3 (docs/BUILDS_V2.md "Ballista"): the heavy arrow's ring on its last pierce, the back fan at a wall or
// a piece it does not break (from its start-of-tick position, never inside a wall), nothing for an arrow that expires
// in the air, a broken piece, stream / Flurry / Ember Wake ring arrows or effect bolts; levels I / II / III's bolts and
// II's 27-tick charge (the sim's and the view's bowCharge); the burst inside the effect budget. BV6 Dragon Bolt (Ballista
// + Ember Wake): an ember every 3 ticks of a heavy arrow's whole flight, inside the effect budget.
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	TileType,
	actorMover,
	bodyBlocker,
	bulletBlocker,
	type BreakablePlacement,
	type Dungeon,
} from "shared/dungeon";
import {
	BALLISTA_BOLT_COUNTS,
	BOW_DATA,
	BOW_V_CHARGE,
	BREAKABLES_CONFIG,
	BUILDS_CONFIG,
	BUILD_RULES,
	Boon,
	BuildEffect,
	BulletKind,
	BulletPayload,
	Button,
	DRAGON_BOLT_EMBER_TICKS,
	Duo,
	EMPTY_INPUT,
	SIM_DT,
	SimCtx,
	bowCharge,
	bowChargeTicks,
	buildSource,
	createSimState,
	duoCard,
	effectBulletsAlive,
	fireBurstRaw,
	grantCard,
	isHeavyArrow,
	packPayload,
	step,
	weaponIndex,
	weaponsAt,
	type ActorState,
	type EndlessFloorWorld,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const IDLE = EMPTY_INPUT;

// ---------------------------------------------------------------------------------------------
// A hand-built floor (grid = world, TILE_SIZE 1): floor gx 1..36, gz 1..26 inside a wall ring (gx 0 / 37, gz 0 / 27);
// the east wall's face is x = 36.5.

const W = 40;
const H = 30;
function tile(gx: number, gz: number): number {
	if (gx >= 1 && gx <= 36 && gz >= 1 && gz <= 26) return TileType.FLOOR;
	if (gx >= 0 && gx <= 37 && gz >= 0 && gz <= 27) return TileType.WALL;
	return TileType.VOID;
}
const grid: number[] = [];
for (let gz = 0; gz < H; gz++) for (let gx = 0; gx < W; gx++) grid.push(tile(gx, gz));
const MAP = { W, H, grid } as unknown as Dungeon;
const BLOCKED = bulletBlocker(MAP);

interface Opts {
	pieces?: ReadonlyArray<BreakablePlacement>;
}

function world(opts: Opts): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					loadout: ["weapon.bow"],
					actorMover: actorMover(MAP),
					isBulletBlocked: BLOCKED,
					isBodyBlocked: bodyBlocker(MAP),
					encounter: { spawns: [], rooms: [], entranceRoom: -1, bossRoom: -1 },
				},
				bossFloor: false,
				spawnX: 3,
				spawnZ: 24,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: [],
				roomIdAt: () => -1,
				breakables: opts.pieces,
			};
			cache.set(floor, w);
		}
		return w;
	};
}

function configOf(opts: Opts = {}): SimConfig {
	return {
		endless: { runSeed: SEED, worldForFloor: world(opts) },
		scoring: {},
		builds: BUILDS_CONFIG,
		breakables: opts.pieces !== undefined ? BREAKABLES_CONFIG : undefined,
	};
}

const MAPPED = configOf();

function fresh(config: SimConfig = MAPPED): SimState {
	return createSimState(SEED, 0, 0, config);
}

function ctxOf(s: SimState, config: SimConfig = MAPPED): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

/** A stationary 'test.dummy' (radius 0.5) with `hp`, a target from this tick on. */
function dummy(ctx: SimCtx, x: number, z: number, hp = 100): ActorState {
	const a = ctx.spawnActor("test.dummy", x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

/** Ballista at `level` (through the draft's grant, so the run mods follow). */
function ballista(s: SimState, level: number, player = 0): void {
	for (let k = 0; k < level; k++) grantCard(s, player, Boon.BALLISTA);
}

const BOW_SOURCE = weaponIndex("weapon.bow") + 1;

/** One bow-sourced PLAYER bullet of `owner` from (x, z) along (dirX, dirZ): the heavy arrow by default. */
function arrow(
	s: SimState,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	speed = BOW_DATA.heavySpeed,
	life = BOW_DATA.heavyLife,
	pierce = BOW_DATA.heavyPierce,
	owner = 0,
	kind: number = BulletKind.PLAYER,
	source = BOW_SOURCE,
): void {
	const c = s.combat;
	c.playerSpawned += fireBurstRaw(
		c.playerBullets,
		weaponsAt(s, owner).emitterId,
		x,
		z,
		dirX,
		dirZ,
		1,
		0,
		speed,
		life,
		packPayload(BOW_DATA.heavyDamage, kind, source, pierce),
	);
}

interface Shot {
	kind: number;
	source: number;
	x: number;
	z: number;
	vx: number;
	vz: number;
}

function shots(s: SimState, kind: number): Shot[] {
	const out: Shot[] = [];
	const sim = s.combat.playerBullets;
	sim.forEachActive((i, pos, payload) => {
		if (BulletPayload.get(payload, "kind") !== kind) return false;
		const v = sim.velocityAt(i);
		out.push({ kind, source: BulletPayload.get(payload, "source"), x: pos.x, z: pos.z, vx: v.x, vz: v.z });
		return false;
	});
	return out;
}

interface Burst {
	tick: number;
	x: number;
	z: number;
	fired: number;
	wall: number;
}

/** Steps `ticks` idle ticks, collecting the Ballista burst events. */
function run(s: SimState, ticks: number, config: SimConfig = MAPPED): Burst[] {
	const out: Burst[] = [];
	for (let t = 0; t < ticks; t++) {
		step(s, IDLE, config);
		const e = s.builds!.events;
		for (let k = 0; k < e.ballistaX.size(); k++) {
			expect(e.ballistaOwner[k]).toBe(0);
			out.push({
				tick: t,
				x: e.ballistaX[k],
				z: e.ballistaZ[k],
				fired: e.ballistaFired[k],
				wall: e.ballistaWall[k],
			});
		}
	}
	return out;
}

// ---------------------------------------------------------------------------------------------

describe("Ballista: the last pierce's ring", () => {
	it("a heavy arrow through 3 enemies bursts 6 on the third (a ring of BURST bolts, effect BALLISTA gen 0)", () => {
		const s = fresh();
		ballista(s, 1);
		const ctx = ctxOf(s);
		const hit = [dummy(ctx, 5, 10), dummy(ctx, 10, 10), dummy(ctx, 16, 10)];
		const behind = dummy(ctx, 25, 10);
		arrow(s, 3, 10, 1, 0);
		const bursts = run(s, 40);
		expect(bursts.size()).toBe(1);
		const b = bursts[0];
		expect([b.fired, b.wall, b.x, b.z]).toEqual([6, 0, 16, 10]);
		// The ring starts on the third enemy's hit circle and flies outward: the survivor does not soak it.
		expect(hit.map((a) => a.hp)).toEqual([95, 95, 95]);
		expect(behind.hp).toBe(100);
		const bolts = shots(s, BulletKind.BURST);
		expect(bolts.size()).toBe(6);
		for (const bolt of bolts) {
			expect(bolt.source).toBe(buildSource(BuildEffect.BALLISTA, 0));
			const dx = bolt.x - 16;
			const dz = bolt.z - 10;
			expect(dx * bolt.vx + dz * bolt.vz > 0).toBe(true);
		}
	});

	it("the ring's bolts hit other enemies near the burst", () => {
		const s = fresh();
		ballista(s, 1);
		const ctx = ctxOf(s);
		dummy(ctx, 5, 10, 2);
		dummy(ctx, 10, 10, 2);
		dummy(ctx, 16, 10, 2);
		// Twelve small targets 2 tiles round the third enemy (every 30 degrees, none on the arrow's own lane west).
		const near: ActorState[] = [];
		const dirs: Array<[number, number]> = [
			[1, 0],
			[0.866, 0.5],
			[0.5, 0.866],
			[0, 1],
			[-0.5, 0.866],
			[-0.5, -0.866],
			[0, -1],
			[0.5, -0.866],
			[0.866, -0.5],
		];
		for (const [dx, dz] of dirs) near.push(dummy(ctx, 16 + dx * 2, 10 + dz * 2, 3));
		arrow(s, 3, 10, 1, 0);
		run(s, 40);
		let lost = 0;
		for (const a of near) lost += 3 - a.hp;
		expect(lost > 0 && lost <= 6).toBe(true);
	});

	it("levels II and III burst 10; without Ballista nothing bursts (the arrow just stops)", () => {
		for (const level of [0, 1, 2, 3]) {
			const s = fresh();
			ballista(s, level);
			const ctx = ctxOf(s);
			dummy(ctx, 6, 10, 2);
			dummy(ctx, 9, 10, 2);
			dummy(ctx, 12, 10, 2);
			arrow(s, 3, 10, 1, 0);
			const fired = run(s, 40).map((b) => b.fired);
			expect([level, fired]).toEqual([level, level === 0 ? [] : [BALLISTA_BOLT_COUNTS[level - 1]]]);
		}
	});

	it("an arrow that expires in the air bursts nothing; one that pierces fewer than 3 does not burst either", () => {
		const s = fresh();
		ballista(s, 1);
		const ctx = ctxOf(s);
		dummy(ctx, 6, 10);
		arrow(s, 3, 10, 1, 0);
		expect(run(s, 60)).toEqual([]);
		expect(s.combat.playerBullets.activeCount).toBe(0);
	});
});

describe("Ballista: the back fan", () => {
	it("into a wall: 6 bolts back into the room from the arrow's start-of-tick position, none inside the wall", () => {
		const s = fresh();
		ballista(s, 1);
		arrow(s, 30, 12, 1, 0);
		const bursts = run(s, 30);
		expect(bursts.size()).toBe(1);
		const b = bursts[0];
		expect([b.fired, b.wall, b.z]).toEqual([6, 1, 12]);
		expect(b.x < 36.5 && b.x > 36.5 - BOW_DATA.heavySpeed * SIM_DT * 2).toBe(true);
		expect(BLOCKED(b.x, b.z)).toBe(false);
	});

	it("the fan's bolts fly back along the arrow's flight (within the 1.6 rad spread) and never start in a wall", () => {
		const s = fresh();
		ballista(s, 2);
		const len = math.sqrt(0.8 * 0.8 + 0.6 * 0.6);
		arrow(s, 28, 14, 0.8 / len, 0.6 / len);
		let fan: Shot[] = [];
		for (let t = 0; t < 30 && fan.size() === 0; t++) {
			step(s, IDLE, MAPPED);
			if (s.builds!.events.ballistaX.size() > 0) fan = shots(s, BulletKind.BURST);
		}
		expect(fan.size()).toBe(10);
		const cosHalf = math.cos(0.8 + 1e-9); // spec only (no sim trig): the fan's half spread
		for (const bolt of fan) {
			expect(BLOCKED(bolt.x, bolt.z)).toBe(false);
			const speed = math.sqrt(bolt.vx * bolt.vx + bolt.vz * bolt.vz);
			const c = -(bolt.vx * 0.8 + bolt.vz * 0.6) / len / speed;
			expect(c >= cosHalf).toBe(true);
		}
	});

	it("an arrow fired point blank into a wall (its start position blocked) fans nothing", () => {
		const s = fresh();
		ballista(s, 1);
		// Starts inside the east wall: its first walk visit consumes it with a blocked start.
		arrow(s, 36.8, 12, 1, 0);
		expect(run(s, 5)).toEqual([]);
	});

	it("a piece it does not break (the vault chest) fans back; a crate it breaks lets it fly on, no burst there", () => {
		const chest = configOf({ pieces: [{ x: 20, y: 12, kind: "chest" }] });
		const s = fresh(chest);
		ballista(s, 1);
		arrow(s, 15, 12, 1, 0);
		const bursts = run(s, 30, chest);
		expect(bursts.size()).toBe(1);
		expect([bursts[0].wall, bursts[0].fired]).toEqual([1, 6]);
		expect(bursts[0].x < 19.5).toBe(true);

		const crate = configOf({ pieces: [{ x: 32, y: 12, kind: "crate" }] });
		const c = fresh(crate);
		ballista(c, 1);
		arrow(c, 28, 12, 1, 0);
		const ended = run(c, 30, crate);
		expect(c.breakables!.pieces[0].brokenTick >= 0).toBe(true);
		// It broke the crate and flew on to the east wall: one back fan, at the wall.
		expect(ended.size()).toBe(1);
		expect(ended[0].x > 35).toBe(true);
	});
});

describe("Ballista: which arrows", () => {
	it("stream arrows, Flurry arrows (stream specs), the Ember Wake ring and effect bolts never burst", () => {
		const cases: Array<[number, number, number, number]> = [
			// speed, pierce, kind, source
			[BOW_DATA.speed, 2, BulletKind.PLAYER, BOW_SOURCE], // a stream / Flurry arrow with Piercing Arrows
			[BOW_DATA.speed, 0, BulletKind.PLAYER, BOW_SOURCE],
			[12, 0, BulletKind.PLAYER, BOW_SOURCE], // the Ember Wake ring fired with the bow in hand
			[BOW_DATA.heavySpeed, 2, BulletKind.SPARK_BOLT, buildSource(BuildEffect.RICOCHET, 0)], // a Ricochet split
		];
		for (const [speed, pierce, kind, source] of cases) {
			const s = fresh();
			ballista(s, 3);
			const ctx = ctxOf(s);
			dummy(ctx, 31, 12, 2);
			dummy(ctx, 32, 12, 2);
			dummy(ctx, 33, 12, 2);
			arrow(s, 29, 12, 1, 0, speed, 2, pierce, 0, kind, source);
			expect([speed, kind, run(s, 40)]).toEqual([speed, kind, []]);
			expect(s.builds!.pins.size()).toBe(0);
		}
		expect(isHeavyArrow(packPayload(5, BulletKind.PLAYER, BOW_SOURCE, 2), 0, BOW_DATA.heavySpeed)).toBe(true);
		expect(isHeavyArrow(packPayload(5, BulletKind.PLAYER, BOW_SOURCE, 2), 0, BOW_DATA.speed)).toBe(false);
	});

	it("a real charged shot bursts at the wall; the stream does not", () => {
		const s = fresh();
		ballista(s, 1);
		s.player.x = 28;
		s.player.z = 12;
		const east = frame(0, 0, Button.ALT, 1, 0);
		const aim = frame(0, 0, 0, 1, 0);
		let bursts = 0;
		for (let t = 0; t < 120; t++) {
			step(s, t < BOW_DATA.chargeTicks + 1 ? east : aim, MAPPED);
			bursts += s.builds!.events.ballistaX.size();
		}
		expect(bursts).toBe(1);
		const stream = fresh();
		ballista(stream, 1);
		stream.player.x = 28;
		stream.player.z = 12;
		let none = 0;
		for (let t = 0; t < 120; t++) {
			step(stream, frame(0, 0, Button.FIRE, 1, 0), MAPPED);
			none += stream.builds!.events.ballistaX.size();
		}
		expect(none).toBe(0);
	});
});

describe("Ballista II: the charge", () => {
	it("bowChargeTicks is 36 without Ballista and at I, 27 at II and III; the view's bowCharge reads it", () => {
		const s = fresh();
		expect(bowChargeTicks(s, 0)).toBe(36);
		const want = [36, 27, 27];
		for (let level = 1; level <= 3; level++) {
			grantCard(s, 0, Boon.BALLISTA);
			expect(bowChargeTicks(s, 0)).toBe(want[level - 1]);
		}
		const slot = weaponsAt(s, 0).sets[0];
		slot.v[BOW_V_CHARGE] = 27;
		expect(bowCharge(slot, bowChargeTicks(s, 0))).toBe(1);
		expect(bowCharge(slot) < 1).toBe(true);
	});

	it("at II a 27-tick hold releases a heavy arrow, 26 does not; at I it takes 36", () => {
		function released(level: number, hold: number): boolean {
			const s = fresh();
			ballista(s, level);
			const before = s.combat.playerSpawned;
			for (let t = 0; t < hold; t++) step(s, frame(0, 0, Button.ALT, 1, 0), MAPPED);
			step(s, frame(0, 0, 0, 1, 0), MAPPED);
			return s.combat.playerSpawned > before;
		}
		expect([released(2, 27), released(2, 26), released(1, 27), released(1, 36), released(3, 27)]).toEqual([
			true,
			false,
			false,
			true,
			true,
		]);
	});
});

describe("Ballista: the effect budget", () => {
	it("a full budget drops the burst's bolts (effectDropped), never the owner's weapon fire", () => {
		const s = fresh();
		ballista(s, 1);
		// Fill the owner's effect budget with long-lived bolts far from anything.
		const c = s.combat;
		const emitter = weaponsAt(s, 0).emitterId;
		for (let k = 0; k < BUILD_RULES.effectBulletsMax; k++) {
			c.playerSpawned += fireBurstRaw(
				c.playerBullets,
				emitter,
				2 + (k % 30),
				2,
				0,
				1,
				1,
				0,
				0,
				30,
				packPayload(1, BulletKind.BURST, buildSource(BuildEffect.VOLATILE, 0)),
			);
		}
		expect(effectBulletsAlive(s, 0)).toBe(BUILD_RULES.effectBulletsMax);
		arrow(s, 30, 12, 1, 0);
		let dropped = 0;
		let bursts = 0;
		for (let t = 0; t < 30; t++) {
			step(s, IDLE, MAPPED);
			dropped += s.builds!.events.effectDropped;
			bursts += s.builds!.events.ballistaX.size();
		}
		expect([bursts, dropped]).toEqual([0, 6]);
		expect(effectBulletsAlive(s, 0)).toBe(BUILD_RULES.effectBulletsMax);
	});
});

describe("Dragon Bolt (Ballista + Ember Wake)", () => {
	function dragon(withDuo: boolean, fireArrows = false): SimState {
		const s = fresh();
		grantCard(s, 0, Boon.BALLISTA);
		grantCard(s, 0, Boon.EMBER_WAKE);
		if (withDuo) grantCard(s, 0, duoCard(Duo.DRAGON_BOLT));
		if (fireArrows) {
			grantCard(s, 0, Boon.PIERCING_ARROWS);
			grantCard(s, 0, duoCard(Duo.FIRE_ARROWS));
		}
		return s;
	}

	/** One heavy arrow from (3, 6) east (15.4 tiles: dies in the air); the ember ticks and their duo. */
	function embers(s: SimState): Array<[number, number]> {
		arrow(s, 3, 6, 1, 0);
		const out: Array<[number, number]> = [];
		for (let t = 0; t < 60; t++) {
			step(s, IDLE, MAPPED);
			const e = s.builds!.events;
			for (let k = 0; k < e.emberX.size(); k++) out.push([t, e.emberDuo[k]]);
		}
		return out;
	}

	it("a heavy arrow drops an ember every 3 ticks of its whole flight (past Fire Arrows' 4), duo DRAGON_BOLT", () => {
		const out = embers(dragon(true));
		// Injected before step 0 (age 1 at its end); 0.7 s = 42 ticks of flight: ages 3, 6, ..., 42.
		const ticks = out.map(([t]) => t);
		const want: number[] = [];
		for (let age = DRAGON_BOLT_EMBER_TICKS; age <= 42; age += DRAGON_BOLT_EMBER_TICKS) want.push(age - 1);
		expect(ticks.size() > 4).toBe(true);
		expect(ticks.size() >= want.size() - 1).toBe(true);
		for (let k = 0; k < ticks.size(); k++) expect(ticks[k]).toBe(want[k]);
		for (const [, duo] of out) expect(duo).toBe(Duo.DRAGON_BOLT);
	});

	it("no duo: no embers; with Fire Arrows too the heavy arrow keeps Dragon Bolt's schedule (no doubled ember)", () => {
		expect(embers(dragon(false))).toEqual([]);
		const both = embers(dragon(true, true));
		const ticks = both.map(([t]) => t);
		for (let k = 1; k < ticks.size(); k++) expect(ticks[k] > ticks[k - 1]).toBe(true);
		for (const [, duo] of both) expect(duo).toBe(Duo.DRAGON_BOLT);
	});

	it("stream arrows get no Dragon Bolt embers", () => {
		const s = dragon(true);
		arrow(s, 3, 6, 1, 0, BOW_DATA.speed, BOW_DATA.life, 0);
		let n = 0;
		for (let t = 0; t < 60; t++) {
			step(s, IDLE, MAPPED);
			n += s.builds!.events.emberX.size();
		}
		expect(n).toBe(0);
	});

	it("the embers stay inside the owner's effect budget (a full budget drops them)", () => {
		const s = dragon(true);
		const c = s.combat;
		const emitter = weaponsAt(s, 0).emitterId;
		const room = BUILD_RULES.effectBulletsMax - 3;
		for (let k = 0; k < room; k++) {
			c.playerSpawned += fireBurstRaw(
				c.playerBullets,
				emitter,
				2 + (k % 30),
				20,
				0,
				1,
				1,
				0,
				0,
				30,
				packPayload(1, BulletKind.BURST, buildSource(BuildEffect.VOLATILE, 0)),
			);
		}
		arrow(s, 3, 6, 1, 0);
		let spawned = 0;
		let dropped = 0;
		for (let t = 0; t < 45; t++) {
			step(s, IDLE, MAPPED);
			spawned += s.builds!.events.emberX.size();
			dropped += s.builds!.events.effectDropped;
			expect(effectBulletsAlive(s, 0) <= BUILD_RULES.effectBulletsMax).toBe(true);
		}
		expect(spawned).toBe(3);
		expect(dropped > 0).toBe(true);
	});
});
