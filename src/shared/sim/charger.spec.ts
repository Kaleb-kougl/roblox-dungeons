// docs/NEW_ENEMIES.md NE3: the Charger (`charger`, band PORT_BAND_ENEMIES_2, index 14). The lane (heading locked at
// its start, NED6), the charge (11 u/s for up to 9 units, plain mover), blocked -> stun ticks (wall, void, pillar, its
// room's bound at a doorway) vs clear -> recover ticks, a barrel in the lane breaks and the charge goes on, one heavy
// hit per player per charge (co-op 2), Swift scales only its walk and cooldowns (EVD9), exactly one draw per attack
// whatever the layout, never out of its room while it attacks on real endless floors, and determinism pins.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AffixKind,
	TileType,
	actorMover,
	bulletBlocker,
	cellKey,
	isWalkableTile,
	lineOfSight,
	roomAt,
	tileAt,
	worldToGrid,
	type Dungeon,
	type EncounterRoom,
} from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	AFFIX_RULES,
	AXIS_MAX,
	AiState,
	BREAKABLES_CONFIG,
	CHARGER,
	CHARGER_ATTACK_LANE,
	CHARGER_CHARGE,
	CHARGER_DIR_X,
	CHARGER_DIR_Z,
	CHARGER_HIT_BITS,
	CHARGER_KEEP,
	CHARGER_LEFT,
	CHARGER_LOST,
	CHARGER_RECOVER,
	CHARGER_STUN,
	EMPTY_INPUT,
	HIT_HEAVY,
	NOT_BROKEN,
	PORT_BAND_ENEMIES_2,
	Rng,
	SIM_DT,
	SIM_HZ,
	STATE_ENGAGED,
	STATE_RETURN,
	SimCtx,
	V_HOME_X,
	V_HOME_Z,
	archetypeAt,
	archetypeIndex,
	createSimState,
	hashState,
	partySize,
	playerAt,
	scaleTicks,
	solidCells,
	spawnActor,
	step,
	stepParty,
	type ActorSpawn,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";

const KIND = archetypeIndex("charger");
const D = CHARGER.data;

const enc = (spawns: ActorSpawn[], rooms: EncounterRoom[] = []) => ({ spawns, rooms, entranceRoom: -1, bossRoom: -1 });
/** Players can't be hurt (the charge passes through them). */
function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}
function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}
const chargerOf = (s: SimState): ActorState => s.combat.actors.find((a) => a.kind === KIND)!;

// ---------------------------------------------------------------------------------------------
// A hand-built floor (grid = world, TILE_SIZE 1): room A is floor gx / gz 2..20 (box 1.5..20.5) inside a wall ring at
// 1 / 21; a doorway at gx 21, gz 10..12 opens on a corridor to gx 34 (walls at gz 9 / 13 and gx 35); a pillar (WALL)
// at (6, 16); a void hole gx 15..17, gz 5..7.

const W = 40;
function tile(gx: number, gz: number): number {
	if (gx >= 15 && gx <= 17 && gz >= 5 && gz <= 7) return TileType.VOID;
	if (gx === 6 && gz === 16) return TileType.WALL;
	if (gx >= 2 && gx <= 20 && gz >= 2 && gz <= 20) return TileType.FLOOR;
	if (gx >= 21 && gx <= 34 && gz >= 10 && gz <= 12) return TileType.FLOOR;
	if (gx >= 1 && gx <= 21 && gz >= 1 && gz <= 21) return TileType.WALL;
	if (gx >= 21 && gx <= 35 && gz >= 9 && gz <= 13) return TileType.WALL;
	return TileType.VOID;
}
const grid: number[] = [];
for (let gz = 0; gz < W; gz++) for (let gx = 0; gx < W; gx++) grid.push(tile(gx, gz));
const MAP = { W, H: W, grid } as unknown as Dungeon;
const ROOM_A: EncounterRoom = {
	id: 0,
	type: "combat",
	depth: 0,
	cx: 11,
	cz: 11,
	minX: 1.5,
	maxX: 20.5,
	minZ: 1.5,
	maxZ: 20.5,
	floorTiles: 361,
};

function arena(x: number, z: number, withRoom: boolean, extra: Partial<SimConfig> = {}): SimConfig {
	return {
		encounter: enc([{ kind: "charger", x, z }], withRoom ? [ROOM_A] : []),
		actorMover: actorMover(MAP),
		isBulletBlocked: bulletBlocker(MAP),
		...extra,
	};
}

interface ChargeRun {
	/** Ticks the lane (TELEGRAPH) was the state at a tick's end. */
	laneTicks: number;
	/** Position and heading at the lane's start; the target at that tick. */
	startX: number;
	startZ: number;
	dirX: number;
	dirZ: number;
	targetX: number;
	targetZ: number;
	/** Ticks in CHARGE, then the state it ended in and how long that lasted (back to CHARGER_KEEP). */
	chargeTicks: number;
	end: number;
	endTicks: number;
	endX: number;
	endZ: number;
	/** Per-tick charge displacement (world units). */
	steps: number[];
	/** Main-rng draws while it ran (all on the lane's start tick), and the ticks they happened on. */
	draws: number;
	drawTicks: number[];
	laneStartTick: number;
}

/** Steps a fresh state until the first charge ended and its stun / recover ran out (ghost player unless `hurt`). */
function firstCharge(config: SimConfig, px: number, pz: number, seed = 1): { run: ChargeRun; s: SimState } {
	const s = createSimState(seed, px, pz, config);
	ghost(s);
	const a = chargerOf(s);
	const r: ChargeRun = {
		laneTicks: 0,
		startX: 0,
		startZ: 0,
		dirX: 0,
		dirZ: 0,
		targetX: 0,
		targetZ: 0,
		chargeTicks: 0,
		end: -1,
		endTicks: 0,
		endX: 0,
		endZ: 0,
		steps: [],
		draws: 0,
		drawTicks: [],
		laneStartTick: -1,
	};
	let prev = a.aiState;
	for (let t = 0; t < 900; t++) {
		const rng0 = s.rngState;
		const x0 = a.x;
		const z0 = a.z;
		step(s, EMPTY_INPUT, config);
		if (s.rngState !== rng0) {
			r.draws += 1;
			r.drawTicks.push(t);
			const one = new Rng(0);
			one.setState(rng0);
			one.next();
			expect(s.rngState).toBe(one.getState()); // exactly one draw
		}
		const st = a.aiState;
		if (st === AiState.TELEGRAPH) {
			if (prev !== AiState.TELEGRAPH) {
				r.laneStartTick = t;
				r.startX = a.x;
				r.startZ = a.z;
				r.dirX = a.v[CHARGER_DIR_X];
				r.dirZ = a.v[CHARGER_DIR_Z];
				r.targetX = s.player.x;
				r.targetZ = s.player.z;
				expect([a.attack, a.aiTicks, a.v[CHARGER_LEFT], a.v[CHARGER_HIT_BITS]]).toEqual([
					CHARGER_ATTACK_LANE,
					D.laneTicks,
					D.chargeRange,
					0,
				]);
			}
			r.laneTicks += 1;
			expect([a.x, a.z, a.v[CHARGER_DIR_X], a.v[CHARGER_DIR_Z]]).toEqual([r.startX, r.startZ, r.dirX, r.dirZ]);
		} else if (st === CHARGER_CHARGE || (r.laneStartTick >= 0 && r.end < 0 && st !== CHARGER_KEEP)) {
			r.steps.push(math.sqrt((a.x - x0) * (a.x - x0) + (a.z - z0) * (a.z - z0)));
			if (st === CHARGER_CHARGE) r.chargeTicks += 1;
			else {
				r.end = st;
				r.endX = a.x;
				r.endZ = a.z;
				r.chargeTicks += 1; // the tick that ended the charge moved too
				r.endTicks = 1;
			}
		} else if (r.end >= 0 && st === r.end) {
			r.endTicks += 1;
			expect([a.x, a.z]).toEqual([r.endX, r.endZ]); // still
		} else if (r.end >= 0 && st === CHARGER_KEEP) {
			return { run: r, s };
		}
		prev = st;
	}
	error("no complete charge in 900 ticks", 0);
}

describe("charger: registry and data", () => {
	it("is kind 14 in band PORT_BAND_ENEMIES_2 with the plan's body and numbers", () => {
		expect(KIND).toBe(14);
		expect(archetypeAt(14)).toBe(CHARGER);
		expect(CHARGER.band).toBe(PORT_BAND_ENEMIES_2);
		expect([D.hp, D.radius, D.speed, D.contactDamage, D.spriteId, D.roomEnemy]).toEqual([
			12,
			0.5,
			2.2,
			0,
			"enemy.charger",
			true,
		]);
		expect([D.keepMin, D.keepMax, D.chargeSpeed, D.chargeRange, D.chargeDamage]).toEqual([5, 9, 11, 9, HIT_HEAVY]);
		expect([D.chargeCooldownMin, D.chargeCooldownMax]).toEqual([3 * SIM_HZ, 4 * SIM_HZ]);
		expect([D.laneTicks, D.stunTicks, D.recoverTicks]).toEqual([45, 84, 36]);
		const aim = D.fx!.aimLine!;
		expect([aim.dirX, aim.dirZ, aim.length, aim.boldTicks, aim.attack]).toEqual([
			CHARGER_DIR_X,
			CHARGER_DIR_Z,
			D.chargeRange,
			D.laneTicks,
			CHARGER_ATTACK_LANE,
		]);
		expect(CHARGER_KEEP).toBe(STATE_ENGAGED);
		expect([
			V_HOME_X,
			V_HOME_Z,
			CHARGER_DIR_X,
			CHARGER_DIR_Z,
			CHARGER_LEFT,
			CHARGER_HIT_BITS,
			CHARGER_LOST,
		]).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});
});

describe("charger: the lane and a clear charge", () => {
	it("locks its heading at the lane's start, stands for laneTicks, charges 9 units at 11 u/s, recovers recoverTicks", () => {
		const { run } = firstCharge(arena(11, 3, true), 11, 9);
		expect(run.laneTicks).toBe(D.laneTicks);
		// The heading is the unit vector to the target at the lane's start.
		const tx = run.targetX - run.startX;
		const tz = run.targetZ - run.startZ;
		const tl = math.sqrt(tx * tx + tz * tz);
		expect(run.dirX).toBeCloseTo(tx / tl, 12);
		expect(run.dirZ).toBeCloseTo(tz / tl, 12);
		// 9 / (11 / 60) = 49.09: 49 full steps and a short last one, then the recover.
		expect(run.end).toBe(CHARGER_RECOVER);
		expect(run.chargeTicks).toBe(50);
		for (let k = 0; k < 49; k++) expect(run.steps[k]).toBeCloseTo(D.chargeSpeed * SIM_DT, 12);
		const moved = math.sqrt((run.endX - run.startX) ** 2 + (run.endZ - run.startZ) ** 2);
		expect(moved).toBeCloseTo(D.chargeRange, 9);
		expect(run.endTicks).toBe(D.recoverTicks);
		// The one draw of the attack is the next cooldown, at the lane's start.
		expect(run.drawTicks).toEqual([run.laneStartTick]);
	});

	it("the lane keeps its heading while the target moves", () => {
		const config = arena(11, 3, true);
		const s = createSimState(2, 11, 9, config);
		ghost(s);
		const a = chargerOf(s);
		let t = 0;
		while (a.aiState !== AiState.TELEGRAPH && t < 600) {
			step(s, EMPTY_INPUT, config);
			t++;
		}
		const dx = a.v[CHARGER_DIR_X];
		const dz = a.v[CHARGER_DIR_Z];
		put(s, 0, 17, 6); // sidestep
		while (a.aiState === AiState.TELEGRAPH) {
			step(s, EMPTY_INPUT, config);
			expect([a.v[CHARGER_DIR_X], a.v[CHARGER_DIR_Z]]).toEqual([dx, dz]);
		}
		expect(a.aiState).toBe(CHARGER_CHARGE);
	});
});

describe("charger: blocked -> stun, clear -> recover", () => {
	const cases: Array<[string, SimConfig, number, number, number]> = [
		// [what, config, player x, z, the body's stop coordinate along the heading]
		["a wall (no room box)", arena(11, 14, false), 11, 19.5, 20],
		["a wall (room box)", arena(11, 14, true), 11, 19.5, 20],
		["a pillar", arena(6, 7, true), 6, 13, 15],
		["a void hole", arena(16, 14, true), 16, 8.5, 8],
		["its room's bound at a doorway", arena(14, 11, true), 19.8, 11, 20],
	];
	for (const [what, config, px, pz, stop] of cases) {
		it(`${what}: stops short, stunned for stunTicks, still and vulnerable`, () => {
			const { run } = firstCharge(config, px, pz);
			expect(run.end).toBe(CHARGER_STUN);
			expect(run.endTicks).toBe(D.stunTicks);
			const along = math.abs(run.dirX) > 0.5 ? run.endX : run.endZ;
			expect(along).toBeCloseTo(stop, 6);
			const moved = math.sqrt((run.endX - run.startX) ** 2 + (run.endZ - run.startZ) ** 2);
			expect(moved < D.chargeRange).toBe(true);
			expect(run.drawTicks).toEqual([run.laneStartTick]);
			expect(roomAt(config.encounter!, run.endX, run.endZ)?.id ?? -1).toBe(
				config.encounter!.rooms.size() > 0 ? 0 : -1,
			);
		});
	}

	it("the same doorway lane without a room box runs its full range into the corridor and recovers", () => {
		const { run } = firstCharge(arena(14, 11, false), 19.8, 11);
		expect(run.end).toBe(CHARGER_RECOVER);
		expect(run.endTicks).toBe(D.recoverTicks);
		expect(run.endX).toBeCloseTo(23, 9);
	});

	it("takes damage while stunned", () => {
		const config = arena(11, 14, true);
		const s = createSimState(1, 11, 19.5, config);
		ghost(s);
		const a = chargerOf(s);
		let t = 0;
		while (a.aiState !== CHARGER_STUN && t < 900) {
			step(s, EMPTY_INPUT, config);
			t++;
		}
		expect(a.aiState).toBe(CHARGER_STUN);
		const hp = a.hp;
		new SimCtx().bind(s, config, EMPTY_INPUT).damageActor(a, 1);
		expect(a.hp).toBe(hp - 1);
		expect(a.aiState).toBe(CHARGER_STUN); // a hit does not end the stun
	});
});

describe("charger: breakables", () => {
	it("breaks a barrel in its lane and keeps going (no stun), drawing exactly as in the open", () => {
		const pieces = [{ x: 11, y: 7, kind: "barrel" as const }];
		const config = arena(11, 3, true, { breakables: { ...BREAKABLES_CONFIG, pieces } });
		const { run, s } = firstCharge(config, 11, 9);
		expect(s.breakables!.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(run.end).toBe(CHARGER_RECOVER);
		expect(run.chargeTicks).toBe(50);
		const moved = math.sqrt((run.endX - run.startX) ** 2 + (run.endZ - run.startZ) ** 2);
		expect(moved).toBeCloseTo(D.chargeRange, 9);
		const open = firstCharge(arena(11, 3, true), 11, 9).run;
		expect([run.draws, run.laneStartTick]).toEqual([open.draws, open.laneStartTick]);
	});

	it("an intact barrel would have stopped it: the piece's cell is solid until the charge reaches it", () => {
		const pieces = [{ x: 11, y: 7, kind: "barrel" as const }];
		const config = arena(11, 3, true, { breakables: { ...BREAKABLES_CONFIG, pieces } });
		const s = createSimState(1, 11, 9, config);
		ghost(s);
		expect(solidCells(s)!.size()).toBe(1);
		// The plain mover against the intact piece: the body stops at the cell's face.
		const r = actorMover(MAP)(11, 5.9, 0, 0.3, D.radius, solidCells(s));
		expect(r.z).toBeCloseTo(6, 9);
	});
});

describe("charger: a vault's chest (docs/TREASURE.md TR2)", () => {
	it("stops it like a wall: stunned at the chest's face, the chest intact (the charge's break pass skips it)", () => {
		const pieces = [{ x: 11, y: 7, kind: "chest" as const }];
		const config = arena(11, 3, true, { breakables: { ...BREAKABLES_CONFIG, pieces } });
		const { run, s } = firstCharge(config, 11, 9);
		expect(s.breakables!.pieces[0].brokenTick).toBe(NOT_BROKEN);
		expect(s.events.breakableHits).toBe(0);
		expect(run.end).toBe(CHARGER_STUN);
		expect(run.endTicks).toBe(D.stunTicks);
		expect(run.endZ).toBeCloseTo(7 - 0.5 - D.radius, 6);
	});
});

describe("charger: one heavy hit per player per charge (co-op 2)", () => {
	it("each living player in the lane loses HIT_HEAVY exactly once, even with post-hit invulnerability cleared", () => {
		const config = arena(11, 3, true, { party: { size: 2 } });
		const s = createSimState(3, 11, 9, config);
		put(s, 0, 11, 9);
		put(s, 1, 11.3, 10.5);
		const a = chargerOf(s);
		const hearts0 = [playerAt(s, 0).hearts, playerAt(s, 1).hearts];
		for (let i = 0; i < 2; i++) playerAt(s, i).armor = 0;
		let hits = 0;
		let sawCharge = false;
		for (let t = 0; t < 900; t++) {
			for (let i = 0; i < 2; i++) playerAt(s, i).hurtTicks = 0;
			stepParty(s, [EMPTY_INPUT, EMPTY_INPUT], config);
			if (s.events.playerHits > 0) {
				hits += s.events.playerHits;
				expect(s.events.lastHitSource).toBe(KIND);
				expect(a.aiState).toBe(CHARGER_CHARGE);
			}
			if (a.aiState === CHARGER_CHARGE) sawCharge = true;
			if (sawCharge && a.aiState !== CHARGER_CHARGE) break;
		}
		expect(sawCharge).toBe(true);
		expect(hits).toBe(2);
		expect([playerAt(s, 0).hearts, playerAt(s, 1).hearts]).toEqual([
			hearts0[0] - HIT_HEAVY,
			hearts0[1] - HIT_HEAVY,
		]);
		expect(a.v[CHARGER_HIT_BITS]).toBe(3);
	});

	it("a dead player is never hit (and takes no bit)", () => {
		const config = arena(11, 3, true, { party: { size: 2 } });
		const s = createSimState(3, 11, 9, config);
		put(s, 0, 11, 9);
		put(s, 1, 11.3, 10.5);
		playerAt(s, 1).dead = 1;
		const a = chargerOf(s);
		let sawCharge = false;
		for (let t = 0; t < 900; t++) {
			playerAt(s, 0).hurtTicks = 0;
			stepParty(s, [EMPTY_INPUT, EMPTY_INPUT], config);
			if (a.aiState === CHARGER_CHARGE) sawCharge = true;
			if (sawCharge && a.aiState !== CHARGER_CHARGE) break;
		}
		expect(a.v[CHARGER_HIT_BITS]).toBe(1);
	});
});

describe("charger: Swift scales only its walk and cooldowns (EVD9)", () => {
	it("lane, charge speed, stun and recover ticks are the raw values; the drawn cooldown is scaled", () => {
		const config: SimConfig = { ...arena(11, 14, true, { affixes: AFFIXES_CONFIG }), encounter: enc([], [ROOM_A]) };
		const s = createSimState(5, 11, 19.5, config);
		ghost(s);
		const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
		const rng0 = s.rngState;
		const a = spawnActor(ctx, KIND, 11, 14, AffixKind.SWIFT)!;
		const probe = new Rng(0);
		probe.setState(rng0);
		const raw = probe.int(D.chargeCooldownMin, D.chargeCooldownMax);
		expect(a.cooldown).toBe(scaleTicks(raw, AFFIX_RULES.swiftCooldownPercent));
		expect(a.cooldown < raw).toBe(true);
		let lane = 0;
		let stun = 0;
		const steps: number[] = [];
		let sawStun = false;
		for (let t = 0; t < 900; t++) {
			const x0 = a.x;
			const z0 = a.z;
			step(s, EMPTY_INPUT, config);
			if (a.aiState === AiState.TELEGRAPH) lane += 1;
			else if (a.aiState === CHARGER_CHARGE) steps.push(math.sqrt((a.x - x0) ** 2 + (a.z - z0) ** 2));
			else if (a.aiState === CHARGER_STUN) {
				stun += 1;
				sawStun = true;
			} else if (sawStun) break;
		}
		expect(lane).toBe(D.laneTicks);
		expect(stun).toBe(D.stunTicks);
		expect(steps.size() > 10).toBe(true);
		for (const d of steps) expect(d).toBeCloseTo(D.chargeSpeed * SIM_DT, 12);
	});
});

// ---------------------------------------------------------------------------------------------
// Real endless floors (run WITHOUT endless mode, the floor's breakables as config pieces): a charger and wandering
// ghost players in a combat room.

interface Scene {
	readonly fl: EndlessRunFloor;
	readonly config: SimConfig;
	readonly players: ReadonlyArray<readonly [number, number]>;
}

const d2 = (ax: number, az: number, bx: number, bz: number): number => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

function roomTiles(fl: EndlessRunFloor, id: number): Array<readonly [number, number]> {
	const d = fl.dungeon;
	const out: Array<readonly [number, number]> = [];
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++)
			if (d.roomId[gy * d.W + gx] === id && tileAt(d, gx, gy) === TileType.FLOOR) out.push([gx, gy]);
	return out;
}

function scene(runSeed: number, floor: number, party: number): Scene | undefined {
	const fl = endlessRunFloor(runSeed, floor, party);
	const rooms = fl.config.encounter!.rooms;
	const rng = new Rng(runSeed * 37 + floor);
	const blocked = fl.config.isBulletBlocked!;
	const solid = new Set<number>();
	for (const p of fl.breakables ?? []) solid.add(cellKey(p.x, p.y));
	for (let tries = 0; tries < 40; tries++) {
		const r = rooms[rng.int(0, rooms.size() - 1)];
		if (r.type !== "combat" && r.type !== "elite") continue;
		const tiles = roomTiles(fl, r.id);
		if (tiles.size() < 30) continue;
		const c = tiles[rng.int(0, tiles.size() - 1)];
		if (solid.has(cellKey(c[0], c[1]))) continue;
		const players: Array<readonly [number, number]> = [];
		for (let k = 0; k < 20 && players.size() < party; k++) {
			const p = tiles[rng.int(0, tiles.size() - 1)];
			const dd = d2(p[0], p[1], c[0], c[1]);
			if (dd >= 25 && dd <= 64 && lineOfSight(blocked, c[0], c[1], p[0], p[1])) players.push(p);
		}
		if (players.size() < party) continue;
		const config: SimConfig = {
			...fl.config,
			encounter: { ...fl.config.encounter!, spawns: [{ kind: "charger", x: c[0], z: c[1] }] },
			breakables: { ...BREAKABLES_CONFIG, pieces: fl.breakables ?? [] },
			party: party > 1 ? { size: party } : undefined,
		};
		return { fl, config, players };
	}
	return undefined;
}

/** A wandering player: a random 8-way move (or standing) held for 20-60 ticks. */
function wanderer(seed: number): () => InputFrame {
	const rng = new Rng(seed);
	let hold = 0;
	let cur: InputFrame = EMPTY_INPUT;
	const axes = [-AXIS_MAX, 0, AXIS_MAX];
	return () => {
		if (hold <= 0) {
			hold = rng.int(20, 60);
			cur = { ...EMPTY_INPUT, moveX: axes[rng.int(0, 2)], moveZ: axes[rng.int(0, 2)] };
		}
		hold--;
		return cur;
	};
}

interface Played {
	lanes: number;
	stuns: number;
	recovers: number;
	draws: number;
	broken: number;
	hashes: string[];
}

function play(sc: Scene, seed: number, ticks: number, check: boolean): Played {
	const party = sc.players.size();
	const s = createSimState(seed, sc.players[0][0], sc.players[0][1], sc.config);
	for (let i = 0; i < party; i++) put(s, i, sc.players[i][0], sc.players[i][1]);
	ghost(s);
	const walkers: Array<() => InputFrame> = [];
	for (let i = 0; i < party; i++) walkers.push(wanderer(seed * 7 + i));
	const a = chargerOf(s);
	const d = sc.fl.dungeon;
	const encounter = sc.config.encounter!;
	const home = roomAt(encounter, a.v[V_HOME_X], a.v[V_HOME_Z])!;
	const out: Played = { lanes: 0, stuns: 0, recovers: 0, draws: 0, broken: 0, hashes: [] };
	let prev = a.aiState;
	for (let t = 0; t < ticks; t++) {
		const rng0 = s.rngState;
		if (party > 1) {
			const inputs: InputFrame[] = [];
			for (let i = 0; i < party; i++) inputs.push(walkers[i]());
			stepParty(s, inputs, sc.config);
		} else step(s, walkers[0](), sc.config);
		out.hashes.push(hashState(s));
		const st = a.aiState;
		if (s.rngState !== rng0) out.draws += 1;
		if (st === AiState.TELEGRAPH && prev !== AiState.TELEGRAPH) out.lanes += 1;
		if (st === CHARGER_STUN && prev !== CHARGER_STUN) out.stuns += 1;
		if (st === CHARGER_RECOVER && prev !== CHARGER_RECOVER) out.recovers += 1;
		if (
			check &&
			(st === AiState.TELEGRAPH || st === CHARGER_CHARGE || st === CHARGER_STUN || st === CHARGER_RECOVER)
		) {
			// Attacking: inside its own room's box, its body on open floor.
			expect([t, roomAt(encounter, a.x, a.z)?.id]).toEqual([t, home.id]);
			expect(a.x >= home.minX + a.radius - 1e-9 && a.x <= home.maxX - a.radius + 1e-9).toBe(true);
			expect(a.z >= home.minZ + a.radius - 1e-9 && a.z <= home.maxZ - a.radius + 1e-9).toBe(true);
			const gx = worldToGrid(a.x);
			const gz = worldToGrid(a.z);
			expect([gx, gz, isWalkableTile(tileAt(d, gx, gz))]).toEqual([gx, gz, true]);
		}
		prev = st;
	}
	for (const p of s.breakables!.pieces) if (p.brokenTick !== NOT_BROKEN) out.broken += 1;
	return out;
}

describe("charger: on real endless floors", () => {
	it("solo: never leaves its room's box while attacking; one draw per lane (+1 in init) whatever the layout", () => {
		let lanes = 0;
		let stuns = 0;
		let recovers = 0;
		let scenes = 0;
		for (let run = 1; run <= 8; run++) {
			const sc = scene(run, 2 + (run % 3), 1);
			if (sc === undefined) continue;
			scenes += 1;
			const p = play(sc, run, 1200, true);
			expect(p.draws).toBe(p.lanes); // init's draw happened in createSimState
			lanes += p.lanes;
			stuns += p.stuns;
			recovers += p.recovers;
		}
		expect(scenes).toBeGreaterThanOrEqual(6);
		expect(lanes).toBeGreaterThanOrEqual(12);
		expect(stuns + recovers).toBeGreaterThanOrEqual(lanes - scenes); // every lane but a leashed last one ends
	});

	it("co-op (2): the same rules", () => {
		let lanes = 0;
		for (let run = 21; run <= 24; run++) {
			const sc = scene(run, 3, 2);
			if (sc === undefined) continue;
			const p = play(sc, run, 1200, true);
			expect(p.draws).toBe(p.lanes);
			lanes += p.lanes;
		}
		expect(lanes).toBeGreaterThanOrEqual(4);
	});
});

describe("charger: determinism", () => {
	it("two identical runs give identical state hashes every tick (solo and co-op)", () => {
		for (const [run, party] of [
			[4, 1],
			[23, 2],
		]) {
			const first = play(scene(run, 3, party)!, run, 900, false);
			const second = play(scene(run, 3, party)!, run, 900, false);
			expect(second.hashes).toEqual(first.hashes);
		}
	});

	it("pins a seed: run 4 floor 3 solo, 1800 ticks", () => {
		const p = play(scene(4, 3, 1)!, 4, 1800, false);
		expect([p.lanes, p.stuns, p.recovers, p.draws, p.broken]).toEqual(PIN_COUNTS);
		expect(p.hashes[1799]).toBe(PIN_HASH);
	});

	it("pins the hand-built arena: seed 9, 1500 ticks, a wandering player", () => {
		const config = arena(11, 3, true, {
			breakables: { ...BREAKABLES_CONFIG, pieces: [{ x: 11, y: 7, kind: "barrel" }] },
		});
		const s = createSimState(9, 11, 9, config);
		ghost(s);
		const walk = wanderer(9);
		for (let t = 0; t < 1500; t++) step(s, walk(), config);
		const a = chargerOf(s);
		expect([a.hp, a.aiState, a.x, a.z, s.rngState]).toEqual(PIN_ARENA);
		expect(hashState(s)).toBe(PIN_ARENA_HASH);
	});
});

const PIN_COUNTS = [3, 0, 2, 3, 0];
// Re-recorded for docs/NEW_ENEMIES.md NE7: the reshuffled roster moves floor 3's room spawns and so its breakables
// (they keep clear of planned spawns); the counts did not move. Before: f77607dc.
// Re-recorded for the merge of solid decor and docs/NEW_ENEMIES.md: floor 3's tombs / candle stands (WALL cells) move
// its room spawn tiles and breakables; lanes / stuns / recovers / draws / broken (PIN_COUNTS) did not move. Before:
// 69817698.
// Re-recorded for the merge of room themes (docs/DECOR.md "Room themes"): floor 3 lays out differently, so the pinned
// charger meets other walls: lanes and draws are unchanged, one stun became a clean recover. Before: 30bf1d50, counts
// [3, 1, 1, 3, 0].
// Re-recorded for bookcases and the library theme (docs/BOOKSHELVES.md): floor 3 lays out differently again, and the
// pinned charger now takes 4 lanes with 2 stuns and breaks 3 pieces. Before: 4860eb56, counts [3, 0, 2, 3, 0].
// Re-recorded for the merge of main (bookcases) into docs/TREASURE.md: run 4's floor 3 holds a vault (room 1, a crypt,
// Legendary SWIFT; its chest one more breakables slot) on the bookcase layout; the counts (main's) did not move.
// Before: acd2ce64 (main, no vaults), c5df44a4 (treasure rooms, no bookcases).
// Re-recorded for the wall slide (docs/WALL_SLIDE.md WS4): the scene's player moves with the slide, so the pinned
// charger meets it in other places: 5 lanes (5 draws) with 4 stuns and 1 clean recover, still 3 pieces broken; the
// layout is unchanged. Before: e54ef63f, counts [4, 2, 2, 4, 3].
// Re-recorded for Kenney decor's Forge pieces (docs/KENNEY_DECOR.md KN5-KN8): floor 3 lays out differently (library v2,
// mess halls, store stock; free-standing pieces clear solid pillars), so the pinned charger meets other walls: 3 lanes
// (3 draws) with 2 clean recovers, no stun, no piece broken. Before: 3422aa24, counts [5, 4, 1, 5, 3].
const PIN_HASH = "1a65fa83"; // check-asset-ids: allow (state hash)
const PIN_ARENA = [12, STATE_RETURN, 11.062568325627446, 8, 3663131635];
const PIN_ARENA_HASH = "80069968"; // check-asset-ids: allow (state hash)
