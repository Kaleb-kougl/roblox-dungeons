// Builds v2 BV4 (docs/BUILDS_V2.md "Siege Bolt", Ballista III): the pin on the first surviving hit, the carry (phase
// 5b) to the wall and the slam (300 %, the shockwave, pieces), never a boss / the Goldling / a turret / the dummy, a held
// actor neither walks nor fires, an expired arrow drops its actor, a pinned actor's death leaves the arrow flying (one pin
// per arrow, BVD6), plowing without spending pierce (BVD7), the drag never inside a wall or a piece, a pillar's slam,
// SIEGE_PINS_MAX, the slot-reuse case, co-op (two archers, one pin); determinism in a dense room with Dragon Bolt.
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	TileType,
	actorMover,
	bodyBlocker,
	bulletBlocker,
	circleOverlapsWall,
	type BreakablePlacement,
	type Dungeon,
} from "shared/dungeon";
import {
	BOW_DATA,
	BREAKABLES_CONFIG,
	BUILDS_CONFIG,
	Boon,
	BulletKind,
	BulletPayload,
	Button,
	CHARGER_CHARGE,
	CHARGER_DIR_X,
	CHARGER_DIR_Z,
	CHARGER_LEFT,
	CHARGER_STUN,
	V_AGGRO,
	Duo,
	EMPTY_INPUT,
	PIN_SPENT,
	SIEGE_PINS_MAX,
	SIEGE_SHOCK_DAMAGE,
	SimCtx,
	createSimState,
	duoCard,
	fireBurstRaw,
	grantCard,
	hashState,
	packPayload,
	playerAt,
	solidCells,
	step,
	stepParty,
	weaponIndex,
	weaponsAt,
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
// A hand-built floor (grid = world, TILE_SIZE 1): floor gx 1..36, gz 1..26 inside a wall ring (the east wall's face is
// x = 36.5), with pillars (WALL cells).

const W = 40;
const H = 30;
const PILLARS: ReadonlyArray<readonly [number, number]> = [
	[20, 6],
	[10, 10],
	[14, 12],
	[18, 9],
	[22, 13],
	[26, 11],
	[12, 16],
	[20, 17],
	[28, 15],
];
function tile(gx: number, gz: number): number {
	for (const [px, pz] of PILLARS) if (gx === px && gz === pz) return TileType.WALL;
	if (gx >= 1 && gx <= 36 && gz >= 1 && gz <= 26) return TileType.FLOOR;
	if (gx >= 0 && gx <= 37 && gz >= 0 && gz <= 27) return TileType.WALL;
	return TileType.VOID;
}
const grid: number[] = [];
for (let gz = 0; gz < H; gz++) for (let gx = 0; gx < W; gx++) grid.push(tile(gx, gz));
const MAP = { W, H, grid } as unknown as Dungeon;
const BODY = bodyBlocker(MAP);
/** A lane clear of pillars (z 19.8: no pillar within a body's reach on it). */
const LANE = 19.8;

interface Opts {
	pieces?: ReadonlyArray<BreakablePlacement>;
	spawns?: ReadonlyArray<{ kind: string; x: number; z: number }>;
	rooms?: EncounterRoom[];
	party?: number;
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
					isBulletBlocked: bulletBlocker(MAP),
					isBodyBlocked: BODY,
					encounter: { spawns: opts.spawns ?? [], rooms: opts.rooms ?? [], entranceRoom: -1, bossRoom: -1 },
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
	const party = opts.party ?? 1;
	return {
		endless: { runSeed: SEED, worldForFloor: world(opts) },
		scoring: party > 1 ? { partySize: party } : {},
		builds: BUILDS_CONFIG,
		breakables: opts.pieces !== undefined ? BREAKABLES_CONFIG : undefined,
		party: party > 1 ? { size: party } : undefined,
	};
}

const MAPPED = configOf();

function fresh(config: SimConfig = MAPPED): SimState {
	return createSimState(SEED, 0, 0, config);
}

function ctxOf(s: SimState, config: SimConfig = MAPPED): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

function spawn(ctx: SimCtx, kind: string, x: number, z: number, hp = 100): ActorState {
	const a = ctx.spawnActor(kind, x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

/** A stationary 'test.dummy' (radius 0.5). */
function dummy(ctx: SimCtx, x: number, z: number, hp = 100): ActorState {
	return spawn(ctx, "test.dummy", x, z, hp);
}

function siege(s: SimState, player = 0): void {
	for (let k = 0; k < 3; k++) grantCard(s, player, Boon.BALLISTA);
}

const BOW_SOURCE = weaponIndex("weapon.bow") + 1;

/** A heavy arrow of `owner` from (x, z) along the unit (dirX, dirZ). Returns its slot. */
function heavy(s: SimState, x: number, z: number, dirX: number, dirZ: number, life = BOW_DATA.heavyLife, owner = 0) {
	const c = s.combat;
	const before = new Set<number>();
	c.playerBullets.forEachActive((i) => {
		before.add(i);
		return false;
	});
	c.playerSpawned += fireBurstRaw(
		c.playerBullets,
		weaponsAt(s, owner).emitterId,
		x,
		z,
		dirX,
		dirZ,
		1,
		0,
		BOW_DATA.heavySpeed,
		life,
		packPayload(BOW_DATA.heavyDamage, BulletKind.PLAYER, BOW_SOURCE, BOW_DATA.heavyPierce),
	);
	let slot = -1;
	c.playerBullets.forEachActive((i) => {
		if (!before.has(i)) slot = i;
		return false;
	});
	return slot;
}

interface Ev {
	starts: number;
	ends: Array<[number, number]>; // [slot, slam]
	slams: Array<[number, number, number]>; // [x, z, struck]
	fans: number;
}

function newEv(): Ev {
	return { starts: 0, ends: [], slams: [], fans: 0 };
}

function collect(s: SimState, ev: Ev): void {
	const e = s.builds!.events;
	ev.starts += e.pinStartSlot.size();
	for (let k = 0; k < e.pinEndSlot.size(); k++) ev.ends.push([e.pinEndSlot[k], e.pinEndSlam[k]]);
	for (let k = 0; k < e.slamX.size(); k++) ev.slams.push([e.slamX[k], e.slamZ[k], e.slamStruck[k]]);
	for (let k = 0; k < e.ballistaWall.size(); k++) if (e.ballistaWall[k] === 1) ev.fans++;
}

/** Every carried actor's body is clear of walls and intact pieces (its centre cell and its circle). */
function bodiesClear(s: SimState): void {
	const solid = solidCells(s);
	for (const pin of s.builds!.pins) {
		if (pin.slot < 0) continue;
		const a = s.combat.actors[pin.slot];
		expect(BODY(a.x, a.z, solid)).toBe(false);
		expect(circleOverlapsWall(MAP, a.x, a.z, a.radius, undefined, solid)).toBe(false);
	}
}

// ---------------------------------------------------------------------------------------------

describe("Siege Bolt: pin, carry, slam", () => {
	it("a dummy hit is carried to the east wall and slams for 300 % (5 + 15); the back fan fires", () => {
		const s = fresh();
		siege(s);
		const ctx = ctxOf(s);
		const a = dummy(ctx, 26, LANE);
		const slot = heavy(s, 23, LANE, 1, 0);
		const ev = newEv();
		let carriedTicks = 0;
		let pinTick = -1;
		for (let t = 0; t < 40; t++) {
			step(s, IDLE, MAPPED);
			collect(s, ev);
			bodiesClear(s);
			if (pinTick < 0 && ev.starts > 0) pinTick = t;
			const pin = s.builds!.pins[0];
			if (
				pin !== undefined &&
				pin.slot >= 0 &&
				pinTick >= 0 &&
				t > pinTick &&
				s.combat.playerBullets.isLive(slot)
			) {
				const p = s.combat.playerBullets.positionAt(slot);
				if (a.x < 35.9) {
					expect(a.x).toBeCloseTo(p.x, 9);
					expect(a.z).toBeCloseTo(p.z, 9);
					carriedTicks++;
				}
			}
		}
		expect(ev.starts).toBe(1);
		expect(carriedTicks > 10).toBe(true);
		expect(ev.ends).toEqual([[s.combat.actors.indexOf(a), 1]]);
		expect(ev.slams.size()).toBe(1);
		expect(ev.slams[0][2]).toBe(1);
		expect(a.hp).toBe(100 - 5 - 15);
		expect(a.x <= 36 + 1e-9 && a.x > 35.5).toBe(true);
		expect(ev.fans).toBe(1);
		expect(s.builds!.pins.size()).toBe(0);
		// The arrow is gone (its slot, if live again, went to a bolt of the back fan).
		const sim = s.combat.playerBullets;
		if (sim.isLive(slot)) expect(BulletPayload.get(sim.payloadAt(slot), "kind")).toBe(BulletKind.BURST);
		// Released: the actor is no longer held and is not dragged any more.
		const x = a.x;
		step(s, IDLE, MAPPED);
		expect(a.x).toBe(x);
	});

	it("the shockwave strikes every other living enemy within 2 tiles (3 each) and breaks the crates there", () => {
		// The slam lands near (36, 19.8): the crate at (35, 21) and the chest at (36, 18) are in the radius.
		const pieces: BreakablePlacement[] = [
			{ x: 35, y: 21, kind: "crate" },
			{ x: 33, y: 17, kind: "crate" },
			{ x: 36, y: 18, kind: "chest" },
		];
		const config = configOf({ pieces });
		const s = fresh(config);
		siege(s);
		const ctx = ctxOf(s, config);
		dummy(ctx, 26, LANE);
		// Outside the back fan's cone (it flies west from the slam), inside the shock radius.
		const near1 = dummy(ctx, 35.2, 18.2);
		const near2 = dummy(ctx, 36, 21.6);
		const far = dummy(ctx, 32, 22);
		heavy(s, 23, LANE, 1, 0);
		const ev = newEv();
		for (let t = 0; t < 40; t++) {
			step(s, IDLE, config);
			collect(s, ev);
		}
		expect(ev.slams.size()).toBe(1);
		expect(ev.slams[0][2]).toBe(3);
		expect([near1.hp, near2.hp, far.hp]).toEqual([100 - SIEGE_SHOCK_DAMAGE, 100 - SIEGE_SHOCK_DAMAGE, 100]);
		const b = s.breakables!.pieces;
		expect([b[0].brokenTick >= 0, b[1].brokenTick >= 0, b[2].brokenTick >= 0]).toEqual([true, false, false]);
	});

	it("a swarmer the first hit kills is not pinned; the next survivor is", () => {
		const s = fresh();
		siege(s);
		const ctx = ctxOf(s);
		const sw = spawn(ctx, "swarmer", 25, LANE, 1);
		const d = dummy(ctx, 28, LANE);
		heavy(s, 22, LANE, 1, 0);
		const ev = newEv();
		let pinnedSlot = -2;
		for (let t = 0; t < 40; t++) {
			step(s, IDLE, MAPPED);
			if (s.builds!.events.pinStartSlot.size() > 0) pinnedSlot = s.builds!.events.pinStartSlot[0];
			collect(s, ev);
		}
		expect(sw.alive).toBe(0);
		expect(ev.starts).toBe(1);
		expect(pinnedSlot).toBe(s.combat.actors.indexOf(d));
		expect(ev.slams.size()).toBe(1);
	});

	it("a boss, the Goldling, a turret and the training dummy are never pinned", () => {
		for (const kind of ["test.boss", "golden", "turret.caster", "dummy"]) {
			const s = fresh();
			siege(s);
			const ctx = ctxOf(s);
			const a = spawn(ctx, kind, 22, LANE, 1000);
			const x = a.x;
			heavy(s, 19, LANE, 1, 0);
			const ev = newEv();
			for (let t = 0; t < 30; t++) {
				step(s, IDLE, MAPPED);
				collect(s, ev);
			}
			expect([kind, ev.starts, a.hp < 1000]).toEqual([kind, 0, true]);
			if (kind !== "golden") expect([kind, a.x]).toEqual([kind, x]);
		}
	});

	it("a pinned actor neither walks nor fires: its AI fields hold while it is carried", () => {
		for (const kind of ["test.chaser", "sniper", "bruiser"]) {
			const s = fresh();
			siege(s);
			// The player stands in sight, near: everything would walk / aim at it.
			const p = playerAt(s, 0);
			p.x = 30;
			p.z = 24;
			p.hurtTicks = 1e6;
			const ctx = ctxOf(s);
			const a = spawn(ctx, kind, 24, LANE, 1000);
			// Let it engage first (unpinned).
			for (let t = 0; t < 30; t++) step(s, IDLE, MAPPED);
			const slot = heavy(s, a.x - 3, a.z, 1, 0);
			let held = 0;
			let fired = 0;
			let ai: number[] | undefined;
			for (let t = 0; t < 40; t++) {
				const enemyBefore = s.combat.enemySpawned;
				step(s, IDLE, MAPPED);
				const pin = s.builds!.pins[0];
				const carrying = pin !== undefined && pin.slot >= 0 && s.builds!.events.pinStartSlot.size() === 0;
				if (carrying) {
					const now = [a.aiState, a.aiTicks, a.cooldown, ...a.v];
					if (ai !== undefined) expect([kind, now]).toEqual([kind, ai]);
					ai = now;
					fired += s.combat.enemySpawned - enemyBefore;
					held++;
					if (s.combat.playerBullets.isLive(slot) && a.x < 35.9) {
						expect(a.x).toBeCloseTo(s.combat.playerBullets.positionAt(slot).x, 9);
					}
				}
			}
			expect([kind, held > 5, fired]).toEqual([kind, true, 0]);
		}
	});

	it("an arrow that expires in the air drops its actor there: no slam, and it steps again", () => {
		const s = fresh();
		siege(s);
		const ctx = ctxOf(s);
		const a = dummy(ctx, 6, 22);
		const slot = heavy(s, 3, 22, 1, 0, 0.3);
		const ev = newEv();
		for (let t = 0; t < 30; t++) {
			step(s, IDLE, MAPPED);
			collect(s, ev);
		}
		expect(s.combat.playerBullets.isLive(slot)).toBe(false);
		expect(ev.starts).toBe(1);
		expect(ev.ends).toEqual([[s.combat.actors.indexOf(a), 0]]);
		expect([ev.slams.size(), ev.fans]).toEqual([0, 0]);
		expect(a.hp).toBe(95);
		expect(a.x > 6).toBe(true);
		expect(s.builds!.pins.size()).toBe(0);
	});

	it("a pinned actor killed by someone else releases the arrow, which flies on and never pins again (BVD6)", () => {
		const s = fresh();
		siege(s);
		const ctx = ctxOf(s);
		const a = dummy(ctx, 6, 20);
		const b = dummy(ctx, 12, 20);
		const slot = heavy(s, 3, 20, 1, 0);
		const ev = newEv();
		for (let t = 0; t < 10; t++) {
			step(s, IDLE, MAPPED);
			collect(s, ev);
		}
		expect(ev.starts).toBe(1);
		// "A teammate" kills it.
		ctxOf(s).damageActor(a, a.hp);
		step(s, IDLE, MAPPED);
		collect(s, ev);
		expect(ev.ends).toEqual([[s.combat.actors.indexOf(a), 0]]);
		const pin = s.builds!.pins[0];
		expect([pin.bullet, pin.slot, pin.id, pin.slam]).toEqual([slot, PIN_SPENT, 0, 0]);
		for (let t = 0; t < 40; t++) {
			step(s, IDLE, MAPPED);
			collect(s, ev);
		}
		// The arrow reached b, hit it as an ordinary heavy arrow (pierce spent) and did not pin it.
		expect(b.hp).toBe(95);
		expect(ev.starts).toBe(1);
		expect(b.x).toBe(12);
		expect(s.builds!.pins.size()).toBe(0);
	});

	it("while carrying it plows: every enemy it enters is hit once, no pierce is spent, the pinned one never", () => {
		const s = fresh();
		siege(s);
		const ctx = ctxOf(s);
		const a = dummy(ctx, 6, 3);
		const lane: ActorState[] = [];
		for (let k = 0; k < 5; k++) lane.push(dummy(ctx, 9 + k * 2, 3));
		const slot = heavy(s, 3, 3, 1, 0);
		for (let t = 0; t < 45; t++) {
			step(s, IDLE, MAPPED);
			if (s.combat.playerBullets.isLive(slot)) {
				expect(BulletPayload.get(s.combat.playerBullets.payloadAt(slot), "pierce")).toBe(BOW_DATA.heavyPierce);
			}
		}
		// Five plowed (more than the arrow's 3 hits), each once; the pinned one only by the pin hit (and no slam yet:
		// the arrow expired at x = 18.4 before the wall).
		expect(lane.map((d) => d.hp)).toEqual([95, 95, 95, 95, 95]);
		expect(a.hp).toBe(95);
	});
});

describe("Siege Bolt: collision", () => {
	it("a Charger held mid-charge waits; dropped outside its room's box, its next charge tick stuns it", () => {
		// Its room: the west part of the floor (x 0.5..20.5).
		const room: EncounterRoom = {
			id: 0,
			type: "combat",
			depth: 0,
			cx: 10,
			cz: 13,
			minX: 0.5,
			maxX: 20.5,
			minZ: 0.5,
			maxZ: 26.5,
			floorTiles: 500,
		};
		const config = configOf({ rooms: [room] });
		const s = fresh(config);
		siege(s);
		const p = playerAt(s, 0);
		p.x = 3;
		p.z = 3;
		p.hurtTicks = 1e6;
		const ctx = ctxOf(s, config);
		const c = spawn(ctx, "charger", 15, LANE, 1000);
		// Engaged and mid-charge, east (the arrow's way), most of its lane left.
		c.v[V_AGGRO] = 1;
		c.aiState = CHARGER_CHARGE;
		c.v[CHARGER_DIR_X] = 1;
		c.v[CHARGER_DIR_Z] = 0;
		c.v[CHARGER_LEFT] = 9;
		const slot = heavy(s, 12, LANE, 1, 0);
		const ev = newEv();
		let held = 0;
		let left = -1;
		for (let t = 0; t < 60 && (s.builds!.pins.size() > 0 || ev.starts === 0); t++) {
			step(s, IDLE, config);
			collect(s, ev);
			const pin = s.builds!.pins[0];
			if (pin !== undefined && pin.slot >= 0 && s.builds!.events.pinStartSlot.size() === 0) {
				expect(c.aiState).toBe(CHARGER_CHARGE);
				if (left >= 0) expect(c.v[CHARGER_LEFT]).toBe(left);
				left = c.v[CHARGER_LEFT];
				held++;
			}
		}
		expect(ev.starts).toBe(1);
		expect(held > 5).toBe(true);
		expect(s.combat.playerBullets.isLive(slot) && s.builds!.pins.size() > 0).toBe(false);
		// Dropped on open floor east of its room's box (no slam).
		expect(ev.slams.size()).toBe(0);
		const releaseX = c.x;
		expect(releaseX > room.maxX).toBe(true);
		step(s, IDLE, config);
		expect(c.aiState).toBe(CHARGER_STUN);
		for (let t = 0; t < 60; t++) {
			step(s, IDLE, config);
			expect(c.x <= releaseX + 1e-9).toBe(true);
		}
	});

	it("a body stopped by a pillar short of the arrow slams there (the arrow passes beside it)", () => {
		const s = fresh();
		siege(s);
		const ctx = ctxOf(s);
		// The pillar (20, 6) spans z 5.5..6.5; the lane z = 5.2 is clear for the arrow, not for a 0.5 body.
		const a = dummy(ctx, 16, 5.2);
		heavy(s, 13, 5.2, 1, 0);
		const ev = newEv();
		for (let t = 0; t < 40; t++) {
			step(s, IDLE, MAPPED);
			collect(s, ev);
			bodiesClear(s);
		}
		expect(ev.slams.size()).toBe(1);
		expect(ev.slams[0][0] < 19.5).toBe(true);
		expect(a.hp).toBe(80);
		expect(ev.fans).toBe(1);
	});

	it("the drag never leaves an actor inside a wall or a piece, every tick, across a room of pillars", () => {
		const pieces: BreakablePlacement[] = [
			{ x: 16, y: 10, kind: "chest" },
			{ x: 24, y: 15, kind: "chest" },
		];
		const config = configOf({ pieces });
		let slams = 0;
		let pins = 0;
		for (let lane = 0; lane < 30; lane++) {
			const z = 8 + lane * 0.35;
			for (const dir of [1, -1]) {
				const s = fresh(config);
				siege(s);
				const ctx = ctxOf(s, config);
				const x0 = dir > 0 ? 5 : 33;
				dummy(ctx, x0 + dir * 1.5, z);
				const len = math.sqrt(1 + 0.04);
				heavy(s, x0, z, dir / len, 0.2 / len);
				const ev = newEv();
				for (let t = 0; t < 45; t++) {
					step(s, IDLE, config);
					collect(s, ev);
					bodiesClear(s);
				}
				pins += ev.starts;
				slams += ev.slams.size();
			}
		}
		expect(pins > 40).toBe(true);
		expect(slams > 10).toBe(true);
	});

	it("four pins at once; a fifth arrow plows only", () => {
		const s = fresh();
		siege(s);
		const ctx = ctxOf(s);
		const zs = [2, 4, 18, 20, 22];
		const targets = zs.map((z) => dummy(ctx, 6, z));
		for (const z of zs) heavy(s, 3, z, 1, 0);
		let most = 0;
		for (let t = 0; t < 20; t++) {
			step(s, IDLE, MAPPED);
			let carrying = 0;
			for (const pin of s.builds!.pins) if (pin.slot >= 0) carrying++;
			if (carrying > most) most = carrying;
		}
		expect(most).toBe(SIEGE_PINS_MAX);
		const moved = targets.filter((a) => a.x !== 6).size();
		expect(moved).toBe(4);
		for (const a of targets) expect(a.hp).toBe(95);
	});

	it("the slot-reuse case: a pinned arrow expiring on the tick a burst spawns never hands its pin to a bolt", () => {
		// Probe 1: the pinned arrow's expiry tick.
		function setupA(s: SimState): { slot: number; a: ActorState } {
			const ctx = ctxOf(s);
			const a = dummy(ctx, 6, 24);
			return { slot: heavy(s, 3, 24, 1, 0, 0.5), a };
		}
		const p1 = fresh();
		siege(p1);
		const pa = setupA(p1);
		let expireTick = -1;
		for (let t = 0; t < 60 && expireTick < 0; t++) {
			step(p1, IDLE, MAPPED);
			if (!p1.combat.playerBullets.isLive(pa.slot)) expireTick = t;
		}
		// Probe 2: ticks from firing to the back fan of an arrow into the east wall.
		const p2 = fresh();
		siege(p2);
		heavy(p2, 33, 2, 1, 0);
		let fanAfter = -1;
		for (let t = 0; t < 30 && fanAfter < 0; t++) {
			step(p2, IDLE, MAPPED);
			if (p2.builds!.events.ballistaX.size() > 0) fanAfter = t;
		}
		expect(expireTick > fanAfter && fanAfter >= 0).toBe(true);
		// The case: both on the same tick.
		const s = fresh();
		siege(s);
		const { slot, a } = setupA(s);
		const ev = newEv();
		for (let t = 0; t <= expireTick; t++) {
			if (t === expireTick - fanAfter) heavy(s, 33, 2, 1, 0);
			step(s, IDLE, MAPPED);
			collect(s, ev);
		}
		expect(ev.fans).toBe(1);
		expect(s.builds!.pins.size()).toBe(0);
		expect(ev.ends).toEqual([[s.combat.actors.indexOf(a), 0]]);
		// The freed slot went to a bolt of the fan (LIFO), which carries nothing.
		expect(s.combat.playerBullets.isLive(slot)).toBe(true);
		expect(BulletPayload.get(s.combat.playerBullets.payloadAt(slot), "kind")).toBe(BulletKind.BURST);
		const x = a.x;
		const z = a.z;
		for (let t = 0; t < 5; t++) step(s, IDLE, MAPPED);
		expect([a.x, a.z]).toEqual([x, z]);
	});
});

describe("Siege Bolt: co-op", () => {
	it("two archers, one actor: one pin; the second arrow hits the pinned actor but does not pin it", () => {
		const config = configOf({ party: 2 });
		const s = fresh(config);
		siege(s, 0);
		siege(s, 1);
		const ctx = ctxOf(s, config);
		const a = dummy(ctx, 10, 12);
		heavy(s, 7, 12, 1, 0, BOW_DATA.heavyLife, 0);
		heavy(s, 7.2, 12, 1, 0, BOW_DATA.heavyLife, 1);
		const ev = newEv();
		const owners: number[] = [];
		for (let t = 0; t < 40; t++) {
			stepParty(s, [IDLE, IDLE], config);
			const e = s.builds!.events;
			for (const o of e.pinStartOwner) owners.push(o);
			collect(s, ev);
			let carrying = 0;
			for (const pin of s.builds!.pins) if (pin.slot >= 0) carrying++;
			expect(carrying <= 1).toBe(true);
		}
		expect(ev.starts).toBe(1);
		expect(owners.size()).toBe(1);
		expect(a.hp < 95).toBe(true);
	});

	it("a departed archer's pin is dropped (no slam) and the actor is released", () => {
		const config = configOf({ party: 2 });
		const s = fresh(config);
		siege(s, 1);
		const ctx = ctxOf(s, config);
		const a = dummy(ctx, 10, 12);
		heavy(s, 7, 12, 1, 0, BOW_DATA.heavyLife, 1);
		const ev = newEv();
		for (let t = 0; t < 10; t++) {
			stepParty(s, [IDLE, IDLE], config);
			collect(s, ev);
		}
		expect(ev.starts).toBe(1);
		s.party!.left[1] = 1;
		stepParty(s, [IDLE, IDLE], config);
		collect(s, ev);
		expect(ev.ends).toEqual([[s.combat.actors.indexOf(a), 0]]);
		expect(s.builds!.pins.size()).toBe(0);
	});
});

describe("Siege Bolt: determinism", () => {
	/** A dense room: bruisers, swarmers and snipers; a bow player with Ballista III + Ember Wake + Dragon Bolt. */
	function dense(): { config: SimConfig; inputAt: (t: number) => InputFrame } {
		const spawns: Array<{ kind: string; x: number; z: number }> = [];
		const kinds = ["bruiser", "swarmer", "sniper", "test.chaser"];
		for (let k = 0; k < 16; k++)
			spawns.push({ kind: kinds[k % 4], x: 14 + (k % 4) * 4, z: 6 + math.floor(k / 4) * 4 });
		const config = configOf({
			spawns,
			pieces: [
				{ x: 33, y: 8, kind: "crate" },
				{ x: 33, y: 14, kind: "barrel" },
			],
		});
		const inputAt = (t: number): InputFrame => {
			const phase = t % 40;
			const az = (math.floor(t / 40) % 5) * 0.2 - 0.4;
			return frame(0, phase === 39 ? 0.3 : 0, phase < 30 ? Button.ALT : 0, 1, az);
		};
		return { config, inputAt };
	}

	function play(): { hashes: string[]; pins: number; slams: number } {
		const { config, inputAt } = dense();
		const s = fresh(config);
		siege(s);
		grantCard(s, 0, Boon.EMBER_WAKE);
		grantCard(s, 0, duoCard(Duo.DRAGON_BOLT));
		const p = playerAt(s, 0);
		p.x = 6;
		p.z = 12;
		const hashes: string[] = [];
		let pins = 0;
		let slams = 0;
		for (let t = 0; t < 600; t++) {
			playerAt(s, 0).hurtTicks = 1e6;
			step(s, inputAt(t), config);
			hashes.push(hashState(s));
			pins += s.builds!.events.pinStartSlot.size();
			slams += s.builds!.events.slamX.size();
		}
		return { hashes, pins, slams };
	}

	it("two runs hash the same every tick (pins and slams happen)", () => {
		const a = play();
		const b = play();
		expect(a.hashes.size()).toBe(600);
		for (let t = 0; t < 600; t++) expect([t, b.hashes[t]]).toEqual([t, a.hashes[t]]);
		expect(a.pins > 0).toBe(true);
		expect(a.slams > 0).toBe(true);
	});
});
