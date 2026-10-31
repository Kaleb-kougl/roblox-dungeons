// The imp (docs/ENEMY_VARIANTS.md EV2): the blink's wind-up ring, its safety rules (walls, breakables, its own room,
// sight, SPAWN_SAFE_RADIUS from every living player, its leash), the layout-independent draw count, the landing snap,
// the 5-bullet fan, and determinism on real endless floors (solo and a party of two).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	TileType,
	cellKey,
	isWalkableTile,
	lineOfSight,
	roomAt,
	tileAt,
	worldToGrid,
	type EncounterRoom,
} from "shared/dungeon";
import {
	AXIS_MAX,
	AiState,
	BREAKABLES_CONFIG,
	BulletKind,
	BulletPayload,
	EMPTY_INPUT,
	HIT_NORMAL,
	IMP,
	IMP_ATTACK_BLINK,
	IMP_ATTACK_FAN,
	IMP_AIM_X,
	IMP_AIM_Z,
	IMP_BLINK_TELEGRAPH_TICKS,
	IMP_DEST_X,
	IMP_DEST_Z,
	IMP_FAN_COUNT,
	IMP_FAN_SPREAD,
	IMP_LAND_AIM_TICKS,
	IMP_REPOSITION,
	IMP_RING_RADIUS,
	IMP_STRAFE,
	PORT_BAND_ENEMIES,
	Rng,
	SIM_HZ,
	SNIPER,
	SPAWN_SAFE_RADIUS,
	STATE_ENGAGED,
	SimCtx,
	V_HOME_X,
	V_HOME_Z,
	archetypeAt,
	archetypeIndex,
	createSimState,
	hashState,
	impBlinkValid,
	nearestLivingPlayer,
	partySize,
	playerAt,
	solidCells,
	step,
	stepParty,
	type ActorSpawn,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";

const enc = (spawns: ActorSpawn[], rooms: EncounterRoom[] = []) => ({
	spawns,
	rooms,
	entranceRoom: -1,
	bossRoom: -1,
});
/** Players can't be hurt (enemy bullets pass through them: they are consumed only when a hit lands). */
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
const d2 = (ax: number, az: number, bx: number, bz: number): number => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
const isLanding = (a: Readonly<ActorState>): boolean =>
	a.alive === 1 &&
	a.aiState === AiState.TELEGRAPH &&
	a.attack === IMP_ATTACK_FAN &&
	a.aiTicks === IMP.data.landAimTicks;
const inBlinkWindup = (a: Readonly<ActorState>): boolean =>
	a.alive === 1 && a.aiState === AiState.TELEGRAPH && a.attack === IMP_ATTACK_BLINK;

describe("imp: registry and data", () => {
	it("is kind 9 (band PORT_BAND_ENEMIES, first of its band) with the planned body", () => {
		expect(archetypeIndex("imp")).toBe(9);
		expect(archetypeAt(9)).toBe(IMP);
		expect(IMP.band).toBe(PORT_BAND_ENEMIES);
		const d = IMP.data;
		expect([d.hp, d.radius, d.speed, d.contactDamage, d.spriteId, d.roomEnemy]).toEqual([
			3,
			0.35,
			3.2,
			0,
			"enemy.imp",
			true,
		]);
		expect([d.keepMin, d.keepMax]).toEqual([4, 7]);
		expect([d.blinkCooldownMin, d.blinkCooldownMax]).toEqual([2.4 * SIM_HZ, 3.2 * SIM_HZ]);
		expect([d.blinkTelegraphTicks, IMP_BLINK_TELEGRAPH_TICKS]).toEqual([30, 30]);
		expect([d.landAimTicks, IMP_LAND_AIM_TICKS]).toEqual([21, 21]);
		// Both candidate distances can pass the SPAWN_SAFE_RADIUS rule against the flanked player.
		expect(d.blinkFar).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS);
		expect(d.blinkNear).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS);
		expect(d.blinkNear).toBeLessThan(d.blinkFar);
		// The fan: 5 slow enemy bullets over 0.7 rad, a normal hit.
		const f = d.fan;
		expect([f.count, f.spread, f.kind, f.damage]).toEqual([
			IMP_FAN_COUNT,
			IMP_FAN_SPREAD,
			BulletKind.ENEMY,
			HIT_NORMAL,
		]);
		expect([IMP_FAN_COUNT, IMP_FAN_SPREAD]).toEqual([5, 0.7]);
		expect(f.speed).toBeLessThan(SNIPER.data.shots[2].speed);
		// The ring hint sits on the destination slots, filling over the wind-up, for the blink only.
		const ring = d.fx!.ring!;
		expect([ring.state, ring.attack, ring.xSlot, ring.zSlot, ring.radius, ring.fillTicks]).toEqual([
			AiState.TELEGRAPH,
			IMP_ATTACK_BLINK,
			IMP_DEST_X,
			IMP_DEST_Z,
			IMP_RING_RADIUS,
			IMP_BLINK_TELEGRAPH_TICKS,
		]);
		expect(IMP_RING_RADIUS).toBeGreaterThan(d.radius);
		const aim = d.fx!.aimLine!;
		expect([aim.dirX, aim.dirZ, aim.attack]).toEqual([IMP_AIM_X, IMP_AIM_Z, IMP_ATTACK_FAN]);
		expect(IMP_REPOSITION).toBe(STATE_ENGAGED);
		const slots = [V_HOME_X, V_HOME_Z, IMP_DEST_X, IMP_DEST_Z, IMP_AIM_X, IMP_AIM_Z, IMP_STRAFE];
		expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});
});

// ---------------------------------------------------------------------------------------------
// An open arena (no walls, no rooms): the imp at (0, 6), the player standing at the origin.

const OPEN: SimConfig = { encounter: enc([{ kind: "imp", x: 0, z: 6 }]) };

describe("imp: the blink in the open", () => {
	it("shows the ring >= 0.5 s before every blink, snaps (prev = new position), then fires 5 at the player", () => {
		const s = createSimState(11, 0, 0, OPEN);
		ghost(s);
		const a = s.combat.actors[0];
		let ring = 0;
		let destX = 0;
		let destZ = 0;
		let blinks = 0;
		let fans = 0;
		let landedTick = -1;
		let lastX = a.x;
		let lastZ = a.z;
		for (let t = 0; t < 900; t++) {
			const spawned = s.combat.enemySpawned;
			step(s, EMPTY_INPUT, OPEN);
			if (inBlinkWindup(a)) {
				ring += 1;
				destX = a.v[IMP_DEST_X];
				destZ = a.v[IMP_DEST_Z];
				expect([a.x, a.z]).toEqual([lastX, lastZ]); // planted while the ring fills
			} else if (isLanding(a)) {
				blinks += 1;
				expect(ring).toBeGreaterThanOrEqual(IMP_BLINK_TELEGRAPH_TICKS);
				expect([a.x, a.z]).toEqual([destX, destZ]);
				expect([a.prevX, a.prevZ]).toEqual([a.x, a.z]);
				expect(d2(a.x, a.z, lastX, lastZ)).toBeGreaterThan(1); // it really moved
				// Flanking: 90 degrees off its old bearing, blinkFar (or blinkNear) from the player.
				const r = math.sqrt(d2(a.x, a.z, s.player.x, s.player.z));
				expect(math.min(math.abs(r - IMP.data.blinkFar), math.abs(r - IMP.data.blinkNear))).toBeLessThan(1e-9);
				landedTick = t;
				ring = 0;
			} else {
				ring = 0;
			}
			const n = s.combat.enemySpawned - spawned;
			if (n > 0) {
				fans += 1;
				expect(n).toBe(IMP_FAN_COUNT);
				expect(t - landedTick).toBe(IMP_LAND_AIM_TICKS);
				expect(a.aiState).toBe(IMP_REPOSITION);
				// Every bullet is the imp's, an ENEMY bullet; the fan's mean direction points at the player.
				let mx = 0;
				let mz = 0;
				let count = 0;
				const b = s.combat.enemyBullets;
				for (let i = 0; i < b.highWater(); i++) {
					if (!b.isLive(i) || b.emitterIdAt(i) !== a.emitterId || b.lifeAt(i) < IMP.data.fan.life - 0.05)
						continue;
					expect(BulletPayload.get(b.payloadAt(i), "kind")).toBe(BulletKind.ENEMY);
					const v = b.velocityAt(i);
					const len = math.sqrt(v.x * v.x + v.z * v.z);
					mx += v.x / len;
					mz += v.z / len;
					count += 1;
				}
				expect(count).toBe(IMP_FAN_COUNT);
				const ml = math.sqrt(mx * mx + mz * mz);
				const tx = s.player.x - a.x;
				const tz = s.player.z - a.z;
				const tl = math.sqrt(tx * tx + tz * tz);
				expect((mx / ml) * (tx / tl) + (mz / ml) * (tz / tl)).toBeGreaterThan(0.9999);
			}
			lastX = a.x;
			lastZ = a.z;
		}
		expect(blinks).toBeGreaterThanOrEqual(3);
		expect(fans).toBe(blinks);
	});

	it("keeps 4-7 units between blinks", () => {
		const near: SimConfig = { encounter: enc([{ kind: "imp", x: 0, z: 2 }]) };
		const s = createSimState(3, 0, 0, near);
		ghost(s);
		const a = s.combat.actors[0];
		for (let t = 0; t < 60; t++) step(s, EMPTY_INPUT, near); // backs off before its first blink (1.2 s)
		const r = math.sqrt(d2(a.x, a.z, 0, 0));
		expect(r).toBeGreaterThanOrEqual(IMP.data.keepMin - 0.1);
		expect(r).toBeLessThanOrEqual(IMP.data.keepMax + 0.1);
		expect(a.aiState).toBe(IMP_REPOSITION);
	});

	it("cancels a blink whose ring went bad (a player walked onto it): no teleport, back to repositioning", () => {
		const s = createSimState(5, 0, 0, OPEN);
		ghost(s);
		const a = s.combat.actors[0];
		let t = 0;
		while (!inBlinkWindup(a) && t < 300) {
			step(s, EMPTY_INPUT, OPEN);
			t++;
		}
		expect(inBlinkWindup(a)).toBe(true);
		const x0 = a.x;
		const z0 = a.z;
		put(s, 0, a.v[IMP_DEST_X], a.v[IMP_DEST_Z]); // stand on the ring
		let telegraphs = 0; // events.telegraphs is per tick
		for (let k = 0; k < IMP_BLINK_TELEGRAPH_TICKS; k++) {
			step(s, EMPTY_INPUT, OPEN);
			telegraphs += s.events.telegraphs;
			expect([a.x, a.z]).toEqual([x0, z0]);
		}
		expect([a.aiState, a.attack]).toEqual([IMP_REPOSITION, 0]);
		expect(telegraphs).toBe(0); // no landing aim
	});
});

// ---------------------------------------------------------------------------------------------
// No valid spot: a 3-tile-wide corridor along z (|x| >= 1.5 blocked), the imp up it, the player at the origin. Every
// candidate (the player +- 5 / 4.25 along x) is in the wall.

const corridorBlocked = (x: number, z: number): boolean => math.abs(worldToGrid(x)) >= 2;
const CORRIDOR: SimConfig = {
	encounter: enc([{ kind: "imp", x: 0, z: 6 }]),
	isBulletBlocked: corridorBlocked,
	actorMover: (x, z, dx, dz) => (corridorBlocked(x + dx, z + dz) ? { x, z } : { x: x + dx, z: z + dz }),
};

describe("imp: no valid spot", () => {
	it("skips the blink with the same main-rng draws (and the same cooldown) as a blink in the open", () => {
		const open = createSimState(21, 0, 0, OPEN);
		const shut = createSimState(21, 0, 0, CORRIDOR);
		ghost(open);
		ghost(shut);
		const ao = open.combat.actors[0];
		const as = shut.combat.actors[0];
		let decided = -1;
		for (let t = 0; t < 240 && decided < 0; t++) {
			const before = open.rngState;
			step(open, EMPTY_INPUT, OPEN);
			step(shut, EMPTY_INPUT, CORRIDOR);
			expect(shut.rngState).toBe(open.rngState);
			if (inBlinkWindup(ao)) {
				decided = t;
				// Exactly two draws: the side, then the cooldown.
				const two = new Rng(0);
				two.setState(before);
				two.next();
				two.next();
				expect(open.rngState).toBe(two.getState());
				expect(as.aiState).toBe(IMP_REPOSITION);
				expect(as.cooldown).toBe(ao.cooldown);
			}
		}
		expect(decided).toBeGreaterThan(0);
		// It never blinks there: no wind-up, no landing, for several cooldowns.
		let telegraphs = 0; // events.telegraphs is per tick
		let draws = 0;
		for (let t = 0; t < 900; t++) {
			const before = shut.rngState;
			step(shut, EMPTY_INPUT, CORRIDOR);
			telegraphs += shut.events.telegraphs;
			if (shut.rngState !== before) draws += 1;
			expect(inBlinkWindup(as) || isLanding(as)).toBe(false);
			expect(math.abs(as.x)).toBeLessThan(1.5);
		}
		expect(telegraphs).toBe(0);
		expect(draws).toBeGreaterThanOrEqual(4); // it kept deciding (and drawing its cooldown) every 2.4-3.2 s
	});
});

// ---------------------------------------------------------------------------------------------
// The rules one by one (impBlinkValid) on a hand-built floor: room 0 is x in [-9.5, 9.5], room 1 x in [10.5, 30.5]
// (both z in [-30.5, 30.5]), a wall at x = 10 with a doorway at |z| <= 2, a pillar at (-2, 0); a crate at (0, -5).
// The imp's home is (0, 6); player 0 stands at the origin, player 1 at (-6, -6).

const room = (id: number, minX: number, maxX: number): EncounterRoom => ({
	id,
	type: "combat",
	depth: id,
	cx: (minX + maxX) / 2,
	cz: 0,
	minX,
	maxX,
	minZ: -30.5,
	maxZ: 30.5,
	floorTiles: 100,
});
const ruleBlocked = (x: number, z: number): boolean => {
	const gx = worldToGrid(x);
	const gz = worldToGrid(z);
	return (gx === 10 && math.abs(gz) > 2) || (gx === -2 && gz === 0);
};
const RULES: SimConfig = {
	encounter: enc([{ kind: "imp", x: 0, z: 6 }], [room(0, -9.5, 9.5), room(1, 10.5, 30.5)]),
	isBulletBlocked: ruleBlocked,
	breakables: { ...BREAKABLES_CONFIG, pieces: [{ x: 0, y: -5, kind: "crate" }] },
	party: { size: 2 },
};

describe("imp: blink safety rules", () => {
	const s = createSimState(1, 0, 0, RULES);
	put(s, 0, 0, 0);
	put(s, 1, -6, -6);
	const ctx = new SimCtx().bind(s, RULES, EMPTY_INPUT);
	const a = s.combat.actors[0];
	const ok = (x: number, z: number): boolean => impBlinkValid(ctx, a, x, z);

	it("accepts open floor in its room, in sight, clear of everyone, within its leash", () => {
		expect(ok(5, 0)).toBe(true);
		expect(ok(1.5, -5)).toBe(true); // next to the crate, body clear of its cell
		expect(ok(0, -8)).toBe(true); // 14 from home (leash 15)
	});

	it("refuses a wall, a body overlapping a wall, the doorway (no room) and the other room", () => {
		expect(ok(10, 6)).toBe(false);
		expect(ok(9.4, 6)).toBe(false); // the body box reaches into x = 10
		expect(ok(10, 0)).toBe(false); // the doorway: open, but in no room
		expect(ok(12, 0)).toBe(false); // in sight through the doorway, but room 1
	});

	it("refuses an intact breakable under the body, and accepts it once broken", () => {
		expect(ok(0, -5)).toBe(false);
		expect(ok(0.7, -5)).toBe(false); // the body box overlaps the crate's cell
		expect(solidCells(s)!.has(cellKey(0, -5))).toBe(true);
		const b = s.breakables!;
		const saved = b.slotByCell;
		b.slotByCell = new Map();
		b.intact = 0;
		expect(ok(0, -5)).toBe(true);
		b.slotByCell = saved;
		b.intact = 1;
	});

	it("refuses a spot out of the target's sight", () => {
		expect(ok(-5, 0)).toBe(false); // the pillar at (-2, 0) is between it and player 0
	});

	it("refuses a spot inside SPAWN_SAFE_RADIUS of ANY living player, and ignores a dead one", () => {
		expect(ok(3, 0)).toBe(false); // player 0
		expect(ok(-4, -3)).toBe(false); // 5 from player 0 but 3.6 from player 1
		playerAt(s, 1).dead = 1;
		expect(ok(-4, -3)).toBe(true);
		playerAt(s, 1).dead = 0;
	});

	it("refuses a spot past its leash from home", () => {
		expect(ok(0, -10)).toBe(false); // 16 from home (leash 15)
	});
});

// ---------------------------------------------------------------------------------------------
// Real endless floors (run WITHOUT endless mode, the floor's breakables as config pieces): an imp and wandering ghost
// players in a combat room; every landing is checked against the floor itself.

interface Scene {
	readonly fl: EndlessRunFloor;
	readonly config: SimConfig;
	readonly impX: number;
	readonly impZ: number;
	readonly players: ReadonlyArray<readonly [number, number]>;
}

/** Floor tiles of room `id` (grid coords), row order. */
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
	const rng = new Rng(runSeed * 31 + floor);
	const blocked = fl.config.isBulletBlocked!;
	for (let tries = 0; tries < 40; tries++) {
		const r = rooms[rng.int(0, rooms.size() - 1)];
		if (r.type !== "combat" && r.type !== "elite") continue;
		const tiles = roomTiles(fl, r.id);
		if (tiles.size() < 30) continue;
		const imp = tiles[rng.int(0, tiles.size() - 1)];
		const players: Array<readonly [number, number]> = [];
		for (let k = 0; k < 20 && players.size() < party; k++) {
			const p = tiles[rng.int(0, tiles.size() - 1)];
			const dd = d2(p[0], p[1], imp[0], imp[1]);
			if (dd >= 25 && dd <= 64 && lineOfSight(blocked, imp[0], imp[1], p[0], p[1])) players.push(p);
		}
		if (players.size() < party) continue;
		const config: SimConfig = {
			...fl.config,
			encounter: { ...fl.config.encounter!, spawns: [{ kind: "imp", x: imp[0], z: imp[1] }] },
			breakables: { ...BREAKABLES_CONFIG, pieces: fl.breakables ?? [] },
			party: party > 1 ? { size: party } : undefined,
		};
		return { fl, config, impX: imp[0], impZ: imp[1], players };
	}
	return undefined;
}

/** A wandering player: a random 8-way move (or standing) held for 10-40 ticks. */
function wanderer(seed: number): () => InputFrame {
	const rng = new Rng(seed);
	let hold = 0;
	let cur: InputFrame = EMPTY_INPUT;
	const axes = [-AXIS_MAX, 0, AXIS_MAX];
	return () => {
		if (hold <= 0) {
			hold = rng.int(10, 40);
			cur = { ...EMPTY_INPUT, moveX: axes[rng.int(0, 2)], moveZ: axes[rng.int(0, 2)] };
		}
		hold--;
		return cur;
	};
}

interface Played {
	readonly landings: number;
	readonly hashes: string[];
}

function play(sc: Scene, seed: number, ticks: number, check: boolean): Played {
	const party = sc.players.size();
	const s = createSimState(seed, sc.players[0][0], sc.players[0][1], sc.config);
	for (let i = 0; i < party; i++) put(s, i, sc.players[i][0], sc.players[i][1]);
	ghost(s);
	const walkers: Array<() => InputFrame> = [];
	for (let i = 0; i < party; i++) walkers.push(wanderer(seed * 7 + i));
	const a = s.combat.actors[0];
	const d = sc.fl.dungeon;
	const blocked = sc.config.isBulletBlocked!;
	const encounter = sc.config.encounter!;
	const homeRoom = roomAt(encounter, a.v[V_HOME_X], a.v[V_HOME_Z])!;
	let ring = 0;
	let destX = 0;
	let destZ = 0;
	let lastX = a.x;
	let lastZ = a.z;
	let landings = 0;
	const hashes: string[] = [];
	for (let t = 0; t < ticks; t++) {
		if (party > 1) {
			const inputs: InputFrame[] = [];
			for (let i = 0; i < party; i++) inputs.push(walkers[i]());
			stepParty(s, inputs, sc.config);
		} else step(s, walkers[0](), sc.config);
		hashes.push(hashState(s));
		if (!check) continue;
		if (inBlinkWindup(a)) {
			ring += 1;
			destX = a.v[IMP_DEST_X];
			destZ = a.v[IMP_DEST_Z];
		} else if (isLanding(a)) {
			landings += 1;
			expect(ring).toBeGreaterThanOrEqual(IMP_BLINK_TELEGRAPH_TICKS);
			expect([a.x, a.z, a.prevX, a.prevZ]).toEqual([destX, destZ, destX, destZ]);
			// Floor under the whole body box, no intact breakable there.
			const solid = solidCells(s);
			for (let gz = worldToGrid(a.z - a.radius); gz <= worldToGrid(a.z + a.radius); gz++)
				for (let gx = worldToGrid(a.x - a.radius); gx <= worldToGrid(a.x + a.radius); gx++) {
					expect([gx, gz, isWalkableTile(tileAt(d, gx, gz))]).toEqual([gx, gz, true]);
					expect([gx, gz, solid !== undefined && solid.has(cellKey(gx, gz))]).toEqual([gx, gz, false]);
				}
			// Its own room.
			expect(roomAt(encounter, a.x, a.z)?.id).toBe(homeRoom.id);
			// In sight of its target (the nearest living player to where it stood), clear of every living player.
			const target = playerAt(s, nearestLivingPlayer(s, lastX, lastZ));
			expect(lineOfSight(blocked, a.x, a.z, target.x, target.z)).toBe(true);
			for (let i = 0; i < party; i++) {
				const p = playerAt(s, i);
				if (p.dead === 0)
					expect(d2(a.x, a.z, p.x, p.z)).toBeGreaterThanOrEqual(SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS);
			}
			ring = 0;
		} else ring = 0;
		lastX = a.x;
		lastZ = a.z;
	}
	return { landings, hashes };
}

describe("imp: blinks on real endless floors", () => {
	it("solo: never lands in a wall, a breakable, another room, out of sight or near the player (12 floors)", () => {
		let landings = 0;
		let scenes = 0;
		for (let run = 1; run <= 12; run++) {
			const sc = scene(run, 2 + (run % 3), 1);
			if (sc === undefined) continue;
			scenes += 1;
			landings += play(sc, run, 900, true).landings;
		}
		expect(scenes).toBeGreaterThanOrEqual(10);
		expect(landings).toBeGreaterThanOrEqual(20);
	});

	it("co-op (2): clear of BOTH living players and in sight of its target (6 floors)", () => {
		let landings = 0;
		for (let run = 21; run <= 26; run++) {
			const sc = scene(run, 3, 2);
			if (sc === undefined) continue;
			landings += play(sc, run, 900, true).landings;
		}
		expect(landings).toBeGreaterThanOrEqual(8);
	});

	it("is deterministic: two identical runs give identical state hashes every tick (solo and co-op)", () => {
		for (const [run, party] of [
			[4, 1],
			[23, 2],
		]) {
			const sc = scene(run, 3, party)!;
			const first = play(sc, run, 600, false);
			const second = play(scene(run, 3, party)!, run, 600, false);
			expect(first.hashes.size()).toBe(600);
			expect(second.hashes).toEqual(first.hashes);
		}
	});
});
