// docs/NEW_ENEMIES_2.md NX2: the Bulwark (`bulwark`, band PORT_BAND_ENEMIES_3, index 19). The facing turn (2.5 degrees
// a tick: a player circling faster than 150 deg/s gets behind it, slower never), the shield (a bullet from the front
// never damages it, one from behind does; the cover arc stops a bullet passing in front toward an ally behind it; a
// piercing arrow stops on it; embers pass; a swing from in front does nothing), the guard break (a sword finisher, a
// heavy arrow and a Siege slam stagger it, then it takes full damage; a Wrecker roll does not; a blocked Siege arrow
// never pins), the bash (one hit per player per bash, solo and co-op), the recover with the shield down, and the draws
// (the first cooldown in init, one per bash, nothing else).
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, actorMover, bodyBlocker, bulletBlocker, type Dungeon } from "shared/dungeon";
import {
	AiState,
	BOW_DATA,
	BUILDS_CONFIG,
	BULWARK,
	BULWARK_ATTACK_BASH,
	BULWARK_BASH,
	BULWARK_DIR_X,
	BULWARK_DIR_Z,
	BULWARK_GUARD,
	BULWARK_GUARDING,
	BULWARK_HIT_BITS,
	BULWARK_RECOVER,
	BULWARK_STAGGER,
	BULWARK_TURN_COS,
	Boon,
	BulletKind,
	Button,
	DEFAULT_SIM_CONFIG,
	Duo,
	EMPTY_INPUT,
	PORT_BAND_ENEMIES_3,
	Rng,
	SIEGE_SHOCK_DAMAGE,
	SIM_DT,
	SWORD_FINISHER,
	SWORD_V_LAST,
	SimCtx,
	archetypeIndex,
	createSimState,
	duoCard,
	fireBurstRaw,
	grantCard,
	hashState,
	packPayload,
	partySize,
	playerAt,
	spawnActor,
	step,
	stepParty,
	weaponIndex,
	weaponsAt,
	type ActorState,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const KIND = archetypeIndex("bulwark");
const D = BULWARK.data;
const BOW_SOURCE = weaponIndex("weapon.bow") + 1;
/** A plain bow arrow's damage (1: the stream's) and speed. */
const ARROW_DAMAGE = 1;
const ARROW_SPEED = 16;

// ---------------------------------------------------------------------------------------------
// An open world (the default bounds, no grid): every line of sight is clear.

interface World {
	s: SimState;
	config: SimConfig;
}

function open(loadout: string[] = ["weapon.bow"], party = 1): World {
	const config: SimConfig = { ...DEFAULT_SIM_CONFIG, loadout, party: party > 1 ? { size: party } : undefined };
	const s = createSimState(11, 0, 0, config);
	return { s, config };
}

function ctxOf(w: World): SimCtx {
	return new SimCtx().bind(w.s, w.config, EMPTY_INPUT);
}

function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

/** A Bulwark at (x, z) facing the unit (fx, fz), stepping from this tick on; its bash held off unless `bash`. */
function bulwark(w: World, x: number, z: number, fx: number, fz: number, bash = false): ActorState {
	const a = spawnActor(ctxOf(w), KIND, x, z)!;
	a.spawnTick = -1;
	a.faceX = fx;
	a.faceZ = fz;
	if (!bash) a.cooldown = 1e6;
	return a;
}

/** A stationary `test.dummy` (radius 0.5) with `hp`. */
function dummy(w: World, x: number, z: number, hp = 100): ActorState {
	const a = ctxOf(w).spawnActor("test.dummy", x, z)!;
	a.spawnTick = -1;
	a.hp = hp;
	a.hpMax = hp;
	return a;
}

/** One player bullet from (x, z) along the unit (dirX, dirZ). */
function shoot(
	s: SimState,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	opts: { speed?: number; damage?: number; kind?: number; pierce?: number; owner?: number } = {},
): void {
	const c = s.combat;
	c.playerSpawned += fireBurstRaw(
		c.playerBullets,
		weaponsAt(s, opts.owner ?? 0).emitterId,
		x,
		z,
		dirX,
		dirZ,
		1,
		0,
		opts.speed ?? ARROW_SPEED,
		1,
		packPayload(opts.damage ?? ARROW_DAMAGE, opts.kind ?? BulletKind.PLAYER, BOW_SOURCE, opts.pierce ?? 0),
	);
}

/** A heavy (charged) arrow: the bow's heavy speed, damage and pierce. */
function heavy(s: SimState, x: number, z: number, dirX: number, dirZ: number): void {
	shoot(s, x, z, dirX, dirZ, {
		speed: BOW_DATA.heavySpeed,
		damage: BOW_DATA.heavyDamage,
		pierce: BOW_DATA.heavyPierce,
	});
}

interface Tally {
	blocks: number;
	breaks: number;
	blockSlots: number[];
	breakSlots: number[];
	hits: number;
}

function tally(): Tally {
	return { blocks: 0, breaks: 0, blockSlots: [], breakSlots: [], hits: 0 };
}

function collect(s: SimState, t: Tally): void {
	t.blocks += s.events.shieldBlocks;
	t.breaks += s.events.guardBreaks;
	t.hits += s.events.playerHits;
	const e = s.combat.guardEvents;
	expect(e.blockX.size()).toBe(s.events.shieldBlocks);
	expect(e.breakSlot.size()).toBe(s.events.guardBreaks);
	for (const k of e.blockSlot) t.blockSlots.push(k);
	for (const k of e.breakSlot) t.breakSlots.push(k);
}

function run(w: World, ticks: number, t: Tally, input: InputFrame = EMPTY_INPUT): void {
	for (let k = 0; k < ticks; k++) {
		step(w.s, input, w.config);
		collect(w.s, t);
	}
}

const live = (s: SimState): number => s.combat.playerBullets.activeCount;

// ---------------------------------------------------------------------------------------------

describe("Bulwark: data", () => {
	// Its index (19 in a real run) is pinned by newEnemies2.spec: the test archetypes this file registers number before it.
	it("is band 6; the turn pair is 2.5 degrees (150 deg/s); the front cone ~140 degrees", () => {
		expect(BULWARK.band).toBe(PORT_BAND_ENEMIES_3);
		const rad = (2.5 * math.pi) / 180;
		expect(D.turnCos).toBeCloseTo(math.cos(rad), 14);
		expect(D.turnSin).toBeCloseTo(math.sin(rad), 14);
		expect(D.turnCos * D.turnCos + D.turnSin * D.turnSin).toBeCloseTo(1, 14);
		expect((2 * math.acos(D.frontCos) * 180) / math.pi).toBeCloseTo(140, 0);
	});
});

describe("Bulwark: the shield", () => {
	// Player at the origin, the Bulwark 2.5 north inside its keep band, facing the player (-z).
	const BZ = 2.5;

	it("a bullet from the front never damages it (consumed on the shield, a block event); one from behind does", () => {
		const w = open();
		const a = bulwark(w, 0, BZ, 0, -1);
		const t = tally();
		for (let k = 0; k < 6; k++) {
			shoot(w.s, 0, 0.5, 0, 1);
			run(w, 12, t);
		}
		expect([a.hp, t.blocks, live(w.s)]).toEqual([D.hp, 6, 0]);
		expect(t.blockSlots).toEqual([0, 0, 0, 0, 0, 0]);
		// From behind: a bullet flying south into its back.
		shoot(w.s, 0, BZ + 2, 0, -1);
		run(w, 12, t);
		expect(a.hp).toBe(D.hp - ARROW_DAMAGE);
		expect(t.blocks).toBe(6);
	});

	it("block positions are in front of it, within max(coverRadius, its hit radius)", () => {
		const w = open();
		const a = bulwark(w, 0, BZ, 0, -1);
		for (const x of [-0.7, -0.3, 0, 0.4, 0.8]) shoot(w.s, x, 0.5, 0, 1);
		let seen = 0;
		for (let k = 0; k < 12; k++) {
			step(w.s, EMPTY_INPUT, w.config);
			const e = w.s.combat.guardEvents;
			for (let j = 0; j < e.blockX.size(); j++) {
				const dx = e.blockX[j] - a.x;
				const dz = e.blockZ[j] - a.z;
				const d = math.sqrt(dx * dx + dz * dz);
				expect(d < D.coverRadius).toBe(true);
				expect(dx * a.faceX + dz * a.faceZ >= D.frontCos * d).toBe(true);
				seen++;
			}
		}
		expect([seen, a.hp]).toEqual([5, D.hp]);
	});

	it("the cover arc (NXD6): a bullet passing in front toward an ally behind it stops; one passing wide hits the ally", () => {
		const w = open();
		bulwark(w, 0, BZ, 0, -1);
		// 0.8 off its centre: it misses the body (0.6) but enters the cover radius (1.0) inside the front cone.
		const covered = dummy(w, 0.8, BZ + 1.5);
		const wide = dummy(w, 1.3, BZ + 1.5);
		const t = tally();
		shoot(w.s, 0.8, 0.5, 0, 1);
		shoot(w.s, 1.3, 0.5, 0, 1);
		run(w, 20, t);
		expect([covered.hp, wide.hp, t.blocks]).toEqual([100, 100 - ARROW_DAMAGE, 1]);
	});

	it("a piercing arrow stops on the shield: neither it nor the actors behind it are hit", () => {
		const w = open();
		const a = bulwark(w, 0, BZ, 0, -1);
		const b1 = dummy(w, 0, BZ + 1.2);
		const b2 = dummy(w, 0, BZ + 2.4);
		const t = tally();
		shoot(w.s, 0, 0.5, 0, 1, { pierce: 3 });
		run(w, 20, t);
		expect([a.hp, b1.hp, b2.hp, t.blocks, t.breaks, live(w.s)]).toEqual([D.hp, 100, 100, 1, 0, 0]);
		// Control: the same arrow with the Bulwark turned away pierces it and both dummies.
		const w2 = open();
		const a2 = bulwark(w2, 0, BZ, 0, 1);
		a2.v[0] = 1; // engaged: it would turn to the player, so hold its facing by keeping it busy
		a2.aiState = BULWARK_RECOVER;
		a2.aiTicks = 1e6;
		a2.v[BULWARK_GUARDING] = 0;
		const c1 = dummy(w2, 0, BZ + 1.2);
		const c2 = dummy(w2, 0, BZ + 2.4);
		shoot(w2.s, 0, 0.5, 0, 1, { pierce: 3 });
		run(w2, 20, tally());
		expect([a2.hp, c1.hp, c2.hp]).toEqual([D.hp - ARROW_DAMAGE, 100 - ARROW_DAMAGE, 100 - ARROW_DAMAGE]);
	});

	it("blocks every moving player bullet kind (PLAYER, BURST, SHARD, SPARK_BOLT); an EMBER passes (OC2)", () => {
		for (const [kind, blocked] of [
			[BulletKind.PLAYER, true],
			[BulletKind.BURST, true],
			[BulletKind.SHARD, true],
			[BulletKind.SPARK_BOLT, true],
		] as Array<[number, boolean]>) {
			const w = open();
			const a = bulwark(w, 0, BZ, 0, -1);
			shoot(w.s, 0, 0.5, 0, 1, { kind });
			const t = tally();
			run(w, 12, t);
			expect([kind, a.hp, t.blocks]).toEqual([kind, blocked ? D.hp : D.hp - ARROW_DAMAGE, blocked ? 1 : 0]);
		}
		// A stationary ember laid on its front: it burns it.
		const w = open();
		const a = bulwark(w, 0, BZ, 0, -1);
		shoot(w.s, 0, BZ - 0.4, 0, 1, { kind: BulletKind.EMBER, speed: 0 });
		const t = tally();
		run(w, 2, t);
		expect([a.hp, t.blocks]).toEqual([D.hp - ARROW_DAMAGE, 0]);
	});

	it("a bullet fired from behind that leaves through its front is not stopped on the way out (heading test)", () => {
		const w = open();
		const a = bulwark(w, 0, BZ, 0, -1);
		const ahead = dummy(w, 0, 0.2);
		const t = tally();
		// A piercing arrow from behind: hits its back, flies out through the front and on to the dummy.
		shoot(w.s, 0, BZ + 1.5, 0, -1, { pierce: 2 });
		run(w, 20, t);
		expect([a.hp, ahead.hp, t.blocks]).toEqual([D.hp - ARROW_DAMAGE, 100 - ARROW_DAMAGE, 0]);
	});
});

describe("Bulwark: the facing turn", () => {
	/**
	 * Circles the player round a Bulwark at the origin at `degPerSec` for `ticks` ticks: the first tick the player's
	 * bearing was more than 90 (and 120) degrees off its facing, and the smallest cosine seen.
	 */
	function circle(
		degPerSec: number,
		ticks: number,
	): { behindTick: number; wellBehindTick: number; minDot: number; w: World; a: ActorState } {
		const w = open();
		const r = 2.5;
		put(w.s, 0, 0, -r);
		const a = bulwark(w, 0, 0, 0, -1);
		step(w.s, EMPTY_INPUT, w.config); // engages, facing the player
		const omega = (degPerSec * math.pi) / 180;
		let behindTick = -1;
		let wellBehindTick = -1;
		let minDot = 1;
		let angle = -math.pi / 2;
		for (let t = 0; t < ticks; t++) {
			angle += omega * SIM_DT;
			put(w.s, 0, r * math.cos(angle), r * math.sin(angle));
			step(w.s, EMPTY_INPUT, w.config);
			const p = playerAt(w.s, 0);
			const dx = p.x - a.x;
			const dz = p.z - a.z;
			const d = math.sqrt(dx * dx + dz * dz);
			const dot = (dx * a.faceX + dz * a.faceZ) / d;
			if (dot < minDot) minDot = dot;
			if (behindTick < 0 && dot < 0) behindTick = t;
			if (wellBehindTick < 0 && dot < WELL_BEHIND) wellBehindTick = t;
			// The facing never turns more than 2.5 degrees a tick and stays a unit vector.
			expect(a.faceX * a.faceX + a.faceZ * a.faceZ).toBeCloseTo(1, 12);
		}
		return { behindTick, wellBehindTick, minDot, w, a };
	}
	/** cos 120 degrees: behind it by a margin its turn cannot close while a bullet flies there. */
	const WELL_BEHIND = -0.5;

	it("a player circling at 200 deg/s gets behind it; a bullet from there damages it", () => {
		const { behindTick, w, a } = circle(200, 240);
		expect(behindTick >= 0).toBe(true);
		// Stop where it is well behind (240 deg/s gets there sooner) and shoot its back.
		const fast = circle(240, 240);
		expect(fast.wellBehindTick >= 0).toBe(true);
		const w2 = circle(240, fast.wellBehindTick + 1);
		const p = playerAt(w2.w.s, 0);
		const dx = w2.a.x - p.x;
		const dz = w2.a.z - p.z;
		const d = math.sqrt(dx * dx + dz * dz);
		shoot(w2.w.s, p.x, p.z, dx / d, dz / d);
		const t = tally();
		run(w2.w, 10, t);
		expect([w2.a.hp, t.blocks]).toEqual([D.hp - ARROW_DAMAGE, 0]);
		expect([a.alive, w.s.tick > 0]).toEqual([1, true]);
	});

	it("a player circling at 120 deg/s never leaves its front cone (it keeps up)", () => {
		const { behindTick, minDot } = circle(120, 360);
		expect(behindTick).toBe(-1);
		expect(minDot >= D.frontCos).toBe(true);
	});

	it("it turns at most 2.5 degrees a tick toward a target behind it, then faces it exactly", () => {
		const w = open();
		put(w.s, 0, 0, 3);
		const a = bulwark(w, 0, 0, 0, -1);
		a.v[0] = 1;
		a.aiState = BULWARK_GUARD;
		let turns = 0;
		for (let t = 0; t < 100; t++) {
			const fx = a.faceX;
			const fz = a.faceZ;
			step(w.s, EMPTY_INPUT, w.config);
			const dot = fx * a.faceX + fz * a.faceZ;
			expect(dot >= BULWARK_TURN_COS - 1e-12).toBe(true);
			if (dot < 1 - 1e-12) turns++;
		}
		expect([a.faceX, a.faceZ]).toEqual([0, 1]);
		// 180 / 2.5 = 72 steps (the last one a snap; rounding can leave one more).
		expect(turns === 72 || turns === 73).toBe(true);
	});
});

describe("Bulwark: the guard break (NXD7)", () => {
	const BZ = 2.2;

	it("a sword finisher breaks its guard (swings 1 and 2 are blocked); staggered, it takes full damage", () => {
		const w = open(["weapon.sword"]);
		const a = bulwark(w, 0, BZ, 0, -1);
		const t = tally();
		const hold: InputFrame = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 1000, buttons: Button.FIRE };
		let breakTick = -1;
		let hpAtBreak = -1;
		for (let k = 0; k < 120; k++) {
			step(w.s, hold, w.config);
			collect(w.s, t);
			if (breakTick < 0 && t.breaks > 0) {
				breakTick = k;
				hpAtBreak = a.hp;
				expect([a.aiState, a.aiTicks, a.v[BULWARK_GUARDING]]).toEqual([BULWARK_STAGGER, D.staggerTicks, 0]);
			}
		}
		expect(breakTick >= 0).toBe(true);
		expect([hpAtBreak, t.breaks, t.blocks >= 2]).toEqual([D.hp, 1, true]);
		// The combo goes on into the staggered Bulwark: every hit after the break landed.
		expect(a.hp < D.hp).toBe(true);
	});

	it("a heavy arrow breaks its guard and stops on the shield (the actor behind untouched); the next arrow lands", () => {
		const w = open();
		const a = bulwark(w, 0, BZ, 0, -1);
		const behind = dummy(w, 0, BZ + 1.2);
		const t = tally();
		heavy(w.s, 0, 0.5, 0, 1);
		run(w, 10, t);
		expect([a.hp, behind.hp, t.breaks, t.blocks, a.aiState]).toEqual([D.hp, 100, 1, 0, BULWARK_STAGGER]);
		expect(t.breakSlots).toEqual([0]);
		shoot(w.s, 0, 0.5, 0, 1);
		run(w, 10, t);
		expect(a.hp).toBe(D.hp - ARROW_DAMAGE);
		// It stands for the stagger, then guards again.
		run(w, D.staggerTicks, t);
		expect([a.aiState, a.v[BULWARK_GUARDING]]).toEqual([BULWARK_GUARD, 1]);
		shoot(w.s, 0, 0.5, 0, 1);
		run(w, 10, t);
		expect([a.hp, t.blocks]).toEqual([D.hp - ARROW_DAMAGE, 1]);
	});

	it("a stagger cancels a telegraphed bash (its cooldown stays drawn)", () => {
		const w = open();
		const a = bulwark(w, 0, 1.5, 0, -1, true);
		a.cooldown = 1;
		step(w.s, EMPTY_INPUT, w.config); // engages and telegraphs
		step(w.s, EMPTY_INPUT, w.config);
		expect([a.aiState, a.attack]).toEqual([AiState.TELEGRAPH, BULWARK_ATTACK_BASH]);
		const cd = a.cooldown;
		heavy(w.s, 0, 0.3, 0, 1);
		run(w, 3, tally());
		expect([a.aiState, a.attack, a.cooldown]).toEqual([BULWARK_STAGGER, 0, cd]);
	});
});

// ---------------------------------------------------------------------------------------------
// Builds worlds (Siege Bolt, Wrecker): siege.spec's hand-built floor (floor gx 1..36, gz 1..26 in a wall ring; the east
// wall's face is x = 36.5), the player spawning far west (3, 24): beyond 1.5 x aggroRange, so a calm Bulwark keeps the
// facing it was given.

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
const LANE = 19.8;

function buildsWorld(loadout: string[]): World {
	const floorWorld: EndlessFloorWorld = {
		floor: 1,
		config: {
			loadout,
			actorMover: actorMover(MAP),
			isBulletBlocked: bulletBlocker(MAP),
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
	};
	const config: SimConfig = {
		endless: { runSeed: 42, worldForFloor: () => floorWorld },
		scoring: {},
		builds: BUILDS_CONFIG,
	};
	return { s: createSimState(42, 0, 0, config), config };
}

function buildsCtx(w: World): SimCtx {
	return new SimCtx().bind(w.s, w.config.endless!.worldForFloor(1).config, EMPTY_INPUT);
}

function buildsSpawn(w: World, kind: string, x: number, z: number): ActorState {
	const a = buildsCtx(w).spawnActor(kind, x, z)!;
	a.spawnTick = -1;
	return a;
}

describe("Bulwark: the guard break with builds", () => {
	/** A dummy is pinned at x 26 and slammed on the east wall near (36, LANE); a calm Bulwark stands near the slam. */
	function slam(faceToSlam: boolean): { a: ActorState; t: Tally; slams: number } {
		const w = buildsWorld(["weapon.bow"]);
		for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.BALLISTA);
		const pinned = buildsSpawn(w, "test.dummy", 26, LANE);
		pinned.hp = 100;
		pinned.hpMax = 100;
		// 1.6 off the lane (outside the cover radius: the arrow passes), inside the shock radius of the slam.
		const a = buildsSpawn(w, "bulwark", 35.2, 18.2);
		a.cooldown = 1e6;
		const fx = 0.8;
		const fz = 1.6;
		const len = math.sqrt(fx * fx + fz * fz);
		a.faceX = (faceToSlam ? fx : -fx) / len;
		a.faceZ = (faceToSlam ? fz : -fz) / len;
		const c = w.s.combat;
		c.playerSpawned += fireBurstRaw(
			c.playerBullets,
			weaponsAt(w.s, 0).emitterId,
			23,
			LANE,
			1,
			0,
			1,
			0,
			BOW_DATA.heavySpeed,
			BOW_DATA.heavyLife,
			packPayload(BOW_DATA.heavyDamage, BulletKind.PLAYER, BOW_SOURCE, BOW_DATA.heavyPierce),
		);
		const t = tally();
		let slams = 0;
		for (let k = 0; k < 40; k++) {
			step(w.s, EMPTY_INPUT, w.config);
			collect(w.s, t);
			slams += w.s.builds!.events.slamX.size();
		}
		return { a, t, slams };
	}

	it("a Siege slam's shockwave from in front breaks its guard and deals nothing; from behind it deals the shock", () => {
		const front = slam(true);
		expect([front.slams, front.t.breaks, front.a.hp, front.a.aiState]).toEqual([1, 1, D.hp, BULWARK_STAGGER]);
		const back = slam(false);
		expect([back.slams, back.t.breaks, back.a.hp]).toEqual([1, 0, D.hp - SIEGE_SHOCK_DAMAGE]);
	});

	it("a Siege arrow blocked by a guarding front never pins: the guard breaks and Ballista's back fan fires", () => {
		const w = buildsWorld(["weapon.bow"]);
		for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.BALLISTA);
		const a = buildsSpawn(w, "bulwark", 30, LANE);
		a.cooldown = 1e6;
		a.faceX = -1;
		a.faceZ = 0;
		const behind = buildsSpawn(w, "test.dummy", 31.5, LANE);
		behind.hp = 100;
		heavy(w.s, 26, LANE, 1, 0);
		const t = tally();
		let starts = 0;
		let fans = 0;
		for (let k = 0; k < 20; k++) {
			step(w.s, EMPTY_INPUT, w.config);
			collect(w.s, t);
			const e = w.s.builds!.events;
			starts += e.pinStartSlot.size();
			for (let j = 0; j < e.ballistaWall.size(); j++) if (e.ballistaWall[j] === 1) fans++;
		}
		expect([starts, t.breaks, a.hp, behind.hp, fans]).toEqual([0, 1, D.hp, 100, 1]);
		expect(w.s.builds!.pins.size()).toBe(0);
	});

	it("a carrying Siege arrow stopped by a guarding front: the guard breaks and the slam's shockwave spares it (NXD19)", () => {
		// The pinned dummy is carried east along the lane into a guarding Bulwark facing it: the shield stops the
		// heavy arrow (a guard break, the hit dealing nothing) and the arrow slams its carried dummy right there, in
		// front of the Bulwark and inside the shock radius. The Bulwark whose guard this tick broke takes no shock.
		const w = buildsWorld(["weapon.bow"]);
		for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.BALLISTA);
		const pinned = buildsSpawn(w, "test.dummy", 26, LANE);
		pinned.hp = 100;
		pinned.hpMax = 100;
		const a = buildsSpawn(w, "bulwark", 31, LANE);
		a.cooldown = 1e6;
		a.faceX = -1;
		a.faceZ = 0;
		heavy(w.s, 23, LANE, 1, 0);
		const t = tally();
		let starts = 0;
		let slams = 0;
		for (let k = 0; k < 40; k++) {
			step(w.s, EMPTY_INPUT, w.config);
			collect(w.s, t);
			const e = w.s.builds!.events;
			starts += e.pinStartSlot.size();
			slams += e.slamX.size();
		}
		expect([starts, slams, t.breaks]).toEqual([1, 1, 1]);
		expect([a.hp, a.aiState]).toEqual([D.hp, BULWARK_STAGGER]);
		expect(pinned.hp < 100).toBe(true); // the slam itself landed on the carried dummy
	});

	/**
	 * A Storm Blade knight (Chain Spark + Swift Strikes + the duo) at (20, LANE) swings east at a guarding Bulwark 2.2
	 * away facing it; an ally dummy 2.8 behind it (out of the sword's reach, inside a spark's range). With `side`, an
	 * unshielded dummy in the finisher's arc too (spawned after the Bulwark: the sweep reaches the Bulwark first).
	 * Steps through the first finisher and returns the spark segments' starts and the dummies.
	 */
	function stormBlade(side: boolean): {
		starts: Array<[number, number]>;
		procs: number;
		t: Tally;
		ally: ActorState;
		other?: ActorState;
	} {
		const w = buildsWorld(["weapon.sword"]);
		grantCard(w.s, 0, Boon.CHAIN_SPARK);
		grantCard(w.s, 0, Boon.SWIFT_STRIKES);
		grantCard(w.s, 0, duoCard(Duo.STORM_BLADE));
		put(w.s, 0, 20, LANE);
		const a = buildsSpawn(w, "bulwark", 22.2, LANE);
		a.cooldown = 1e6;
		a.faceX = -1;
		a.faceZ = 0;
		const ally = buildsSpawn(w, "test.dummy", 25, LANE);
		ally.hp = 1000;
		ally.hpMax = 1000;
		let other: ActorState | undefined;
		if (side) {
			other = buildsSpawn(w, "test.dummy", 21.3, LANE + 1.3);
			other.hp = 1000;
			other.hpMax = 1000;
		}
		const swingEast: InputFrame = { moveX: 0, moveZ: 0, aimX: 1000, aimZ: 0, buttons: Button.FIRE };
		const t = tally();
		const starts: Array<[number, number]> = [];
		let procs = 0;
		let finished = -1;
		for (let k = 0; k < 160 && (finished < 0 || k < finished + 15); k++) {
			const tick = w.s.tick;
			step(w.s, finished < 0 ? swingEast : EMPTY_INPUT, w.config);
			collect(w.s, t);
			const wp = w.s.combat.weapons;
			if (finished < 0 && wp.swingTick === tick && wp.sets[wp.activeSet].v[SWORD_V_LAST] === SWORD_FINISHER)
				finished = k;
			const e = w.s.builds!.events;
			for (let j = 0; j < e.sparkX1.size(); j++) starts.push([e.sparkX1[j], e.sparkZ1[j]]);
			for (let j = 0; j < e.duoProcDuo.size(); j++) if (e.duoProcDuo[j] === Duo.STORM_BLADE) procs++;
		}
		expect(finished >= 0).toBe(true);
		return { starts, procs, t, ally, other };
	}

	it("a Storm Blade finisher fully blocked by a guarding front procs nothing (its guard breaks; the ally is untouched)", () => {
		const r = stormBlade(false);
		expect([r.t.breaks, r.procs, r.starts.size(), r.ally.hp]).toEqual([1, 0, 0, 1000]);
	});

	it("a Storm Blade finisher that also hits an unshielded enemy sparks from that enemy", () => {
		const r = stormBlade(true);
		const other = r.other!;
		expect([r.t.breaks, r.procs]).toEqual([1, 1]);
		expect(r.starts.size() > 0).toBe(true);
		expect(r.starts[0]).toEqual([other.x, other.z]);
		expect(other.hp < 1000).toBe(true);
	});

	it("a Wrecker roll into its front does not break the guard (rolls never hit enemies)", () => {
		const w = buildsWorld(["weapon.sword"]);
		grantCard(w.s, 0, Boon.WRECKER);
		put(w.s, 0, 20, LANE);
		const a = buildsSpawn(w, "bulwark", 22.5, LANE);
		a.cooldown = 1e6;
		const t = tally();
		const roll: InputFrame = { moveX: 1000, moveZ: 0, aimX: 0, aimZ: 0, buttons: Button.ROLL };
		const walk: InputFrame = { moveX: 1000, moveZ: 0, aimX: 0, aimZ: 0, buttons: 0 };
		let rolled = false;
		for (let k = 0; k < 40; k++) {
			step(w.s, k === 2 ? roll : walk, w.config);
			collect(w.s, t);
			if (playerAt(w.s, 0).rollTicks > 0) rolled = true;
			expect(a.aiState === BULWARK_STAGGER).toBe(false);
		}
		expect([rolled, t.breaks, a.hp, a.v[BULWARK_GUARDING]]).toEqual([true, 0, D.hp, 1]);
	});
});

describe("Bulwark: the bash", () => {
	interface Bash {
		hits: number;
		telegraphTicks: number;
		bashTicks: number;
		recoverTicks: number;
		lunge: number;
		bits: number;
	}

	/** Players at `at` (all the same tick, i-frames cleared every tick), the Bulwark 1.5 north, its cooldown out. */
	function bash(at: Array<[number, number]>): Bash {
		const w = open(["weapon.bow"], at.size());
		for (let i = 0; i < at.size(); i++) put(w.s, i, at[i][0], at[i][1]);
		const a = bulwark(w, 0, 1.5, 0, -1, true);
		a.cooldown = 0;
		const out: Bash = { hits: 0, telegraphTicks: 0, bashTicks: 0, recoverTicks: 0, lunge: 0, bits: 0 };
		const inputs: InputFrame[] = at.map(() => EMPTY_INPUT);
		let z0 = -1;
		for (let t = 0; t < 120; t++) {
			for (let i = 0; i < partySize(w.s); i++) playerAt(w.s, i).hurtTicks = 0;
			if (at.size() > 1) stepParty(w.s, inputs, w.config);
			else step(w.s, EMPTY_INPUT, w.config);
			out.hits += w.s.events.playerHits;
			if (a.aiState === AiState.TELEGRAPH) {
				out.telegraphTicks++;
				z0 = a.z;
			}
			if (a.aiState === BULWARK_BASH) out.bashTicks++;
			if (a.aiState === BULWARK_RECOVER) {
				if (out.recoverTicks === 0) {
					out.lunge = z0 - a.z;
					out.bits = a.v[BULWARK_HIT_BITS];
					expect(a.v[BULWARK_GUARDING]).toBe(0);
				}
				out.recoverTicks++;
			}
		}
		return out;
	}

	it("telegraph 0.45 s, a 1.4 lunge over 9 ticks, one hit per bash, then 0.6 s with the shield down", () => {
		const b = bash([[0, 0]]);
		// The telegraph's last tick already lunges (the Charger's lane rule), so a tick's end shows the bash one tick less.
		expect([b.telegraphTicks, b.bashTicks + 1, b.recoverTicks]).toEqual([
			D.bashTelegraphTicks,
			D.bashLungeTicks,
			D.recoverTicks,
		]);
		expect(b.lunge).toBeCloseTo(D.bashLunge, 9);
		expect([b.hits, b.bits]).toEqual([1, 1]);
	});

	it("co-op: two players in the lunge are each hit exactly once", () => {
		const b = bash([
			[-0.3, 0],
			[0.3, 0],
		]);
		expect([b.hits, b.bits]).toEqual([2, 3]);
	});

	it("the locked heading is the target's bearing at the telegraph's start", () => {
		const w = open();
		put(w.s, 0, 0.9, 0);
		const a = bulwark(w, 0.9, 1.5, 0, -1, true);
		a.cooldown = 0;
		for (let t = 0; t < 3; t++) step(w.s, EMPTY_INPUT, w.config);
		expect([a.aiState, a.v[BULWARK_DIR_X], a.v[BULWARK_DIR_Z]]).toEqual([AiState.TELEGRAPH, 0, -1]);
	});
});

describe("Bulwark: draws and determinism", () => {
	it("one draw in init, exactly one per bash (on the telegraph's start tick), none otherwise", () => {
		const w = open();
		const ctx = ctxOf(w);
		const rng0 = w.s.rngState;
		const a = spawnActor(ctx, KIND, 0, 1.5)!;
		const one = new Rng(0);
		one.setState(rng0);
		one.next();
		expect(w.s.rngState).toBe(one.getState());
		a.cooldown = 0;
		let draws = 0;
		let starts = 0;
		let prev = a.aiState;
		for (let t = 0; t < 900; t++) {
			// The player stays 1.5 in front of it, never hurt: it bashes whenever its cooldown runs out.
			put(w.s, 0, a.x, a.z - 1.5);
			playerAt(w.s, 0).hurtTicks = 1e6;
			const before = w.s.rngState;
			step(w.s, EMPTY_INPUT, w.config);
			if (a.aiState === AiState.TELEGRAPH && prev !== AiState.TELEGRAPH) starts++;
			if (w.s.rngState !== before) {
				draws++;
				const probe = new Rng(0);
				probe.setState(before);
				probe.next();
				expect(w.s.rngState).toBe(probe.getState());
				expect(a.aiState).toBe(AiState.TELEGRAPH);
			}
			prev = a.aiState;
		}
		expect(starts >= 3).toBe(true);
		expect(draws).toBe(starts);
	});

	it("two runs with blocks, breaks and bashes hash the same every tick", () => {
		function play(): string[] {
			const w = open(["weapon.sword"]);
			const a = bulwark(w, 0, 2.2, 0, -1, true);
			a.cooldown = 30;
			const out: string[] = [];
			for (let t = 0; t < 300; t++) {
				if (t % 7 === 0) shoot(w.s, 0.2, 0.3, 0, 1);
				if (t === 40) heavy(w.s, -0.2, 0.3, 0, 1);
				const input: InputFrame = {
					moveX: 0,
					moveZ: 0,
					aimX: 0,
					aimZ: 1000,
					buttons: t % 90 < 50 ? Button.FIRE : 0,
				};
				step(w.s, input, w.config);
				out.push(hashState(w.s));
			}
			return out;
		}
		expect(play()).toEqual(play());
	});
});
