// Builds v2, wave 1 integration (docs/BUILDS_V2.md BV10): every wave 1 boon at level III and every wave 1 duo at once,
// in co-op, on a walled floor with breakables and a dense room, under scripted inputs (guards into volleys, charged
// heavy arrows, rolls through crates and through bullets, flask drinks): two runs hash the same every tick for several
// hundred ticks, the effect budget and the record caps hold every tick, nothing throws, and each event family fires
// (counter-waves, Thunder Guard sparks, Rebuke rings, Ballista bursts, pins and slams, smashes and Demolition blasts,
// Full Heart beams, Happy Hour). A second, small scenario puts a capped boss in the room for the overcap pops.
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
	BOSS_ACT1_ID,
	BREAKABLES_CONFIG,
	BUILDS_CONFIG,
	Boon,
	BossFightState,
	BulletKind,
	BulletPayload,
	Button,
	DEFAULT_BOUNDS,
	Duo,
	EFFECT_BULLET_KINDS,
	NOT_BROKEN,
	RIPOSTE_WAVES_MAX,
	SIEGE_PINS_MAX,
	SimCtx,
	SparkFork,
	WaveKind,
	createSimState,
	duoCard,
	fireBurstRaw,
	grantCard,
	hashState,
	packPayload,
	playerAt,
	playerBulletOwner,
	stepParty,
	weaponsAt,
	type EncounterRoom,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 77;
const IDLE = frame(0, 0, 0, 1, 0);

// ---------------------------------------------------------------------------------------------
// A hand-built floor (grid = world, TILE_SIZE 1; siege.spec's construction): floor gx 1..36, gz 1..26 inside a wall
// ring (the east wall's face at x = 36.5), a few pillars, and four rows of barrels / crates in the south-west.

const W = 40;
const H = 30;
const PILLARS: ReadonlyArray<readonly [number, number]> = [
	[24, 4],
	[30, 9],
	[26, 16],
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

/** The rows the Wrecker rolls through: z 18 / 20 / 22 / 24, x 8..14, barrels and crates alternating. */
const PIECE_ROWS = [18, 20, 22, 24];
const PIECES: BreakablePlacement[] = [];
for (const gz of PIECE_ROWS)
	for (let gx = 8; gx <= 14; gx++) PIECES.push({ x: gx, y: gz, kind: gx % 2 === 0 ? "crate" : "barrel" });

/** The dense room: bruisers (they survive a heavy arrow, so they pin), snipers (they shoot), swarmers, chasers. */
const KINDS = ["bruiser", "sniper", "swarmer", "test.chaser"];
const SPAWNS: Array<{ kind: string; x: number; z: number }> = [];
for (let k = 0; k < 20; k++) SPAWNS.push({ kind: KINDS[k % 4], x: 17 + (k % 5) * 3, z: 5 + math.floor(k / 5) * 4 });
/** A stationary 10-hp body on each archer lane near the east wall: a heavy arrow pins it and slams it into the wall. */
const LANE_ZS = [5, 7.5, 10, 12.5, 15, 17.5];
for (const z of LANE_ZS) SPAWNS.push({ kind: "test.dummy", x: 31, z });

const PARTY = 3;

function world(): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					loadout: ["weapon.sword", "weapon.bow"],
					actorMover: actorMover(MAP),
					isBulletBlocked: bulletBlocker(MAP),
					isBodyBlocked: bodyBlocker(MAP),
					encounter: { spawns: SPAWNS, rooms: [], entranceRoom: -1, bossRoom: -1 },
				},
				bossFloor: false,
				spawnX: 6,
				spawnZ: 12,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: [],
				roomIdAt: () => -1,
				breakables: PIECES,
			};
			cache.set(floor, w);
		}
		return w;
	};
}

const CONFIG: SimConfig = {
	endless: { runSeed: SEED, worldForFloor: world() },
	scoring: { partySize: PARTY },
	builds: BUILDS_CONFIG,
	breakables: BREAKABLES_CONFIG,
	party: { size: PARTY },
};

function ctxOf(s: SimState, config: SimConfig): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, IDLE);
}

function grantLevels(s: SimState, i: number, boon: number, levels: number): void {
	for (let k = 0; k < levels; k++) grantCard(s, i, boon);
}

function grantDuo(s: SimState, i: number, duo: number): void {
	grantCard(s, i, duoCard(duo));
	expect([i, duo, s.builds!.players[i].duos.includes(duo)]).toEqual([i, duo, true]);
}

/** `n` stationary enemy bullets ahead of player `i` along +X: rows of 4 across z from 0.9 ahead, 0.25 apart. */
function volleyAhead(s: SimState, i: number, n: number, ahead = 0.9): void {
	const c = s.combat;
	const p = playerAt(s, i);
	for (let k = 0; k < n; k++) {
		const x = p.x + ahead + 0.25 * math.floor(k / 4);
		const z = p.z - 0.6 + 0.4 * (k % 4);
		c.enemySpawned += fireBurstRaw(c.enemyBullets, 1, x, z, 1, 0, 1, 0, 0, 3, packPayload(1, BulletKind.ENEMY, 1));
	}
}

/** Live effect bullets per player (EFFECT_BULLET_KINDS, owner = emitter - 1) and every live player bullet. */
function effectCounts(s: SimState): { perOwner: number[]; total: number } {
	const perOwner: number[] = [];
	for (let i = 0; i < PARTY; i++) perOwner.push(0);
	let total = 0;
	s.combat.playerBullets.forEachActive((_i, _pos, payload, emitter) => {
		total += 1;
		if (EFFECT_BULLET_KINDS.includes(BulletPayload.get(payload, "kind"))) {
			const o = playerBulletOwner(emitter);
			if (o >= 0 && o < PARTY) perOwner[o] += 1;
		}
		return false;
	});
	return { perOwner, total };
}

interface Tally {
	hashes: string[];
	forward: number;
	rings: number;
	rebukes: number;
	thunder: number;
	ballista: number;
	ballistaWall: number;
	pins: number;
	slams: number;
	smashes: number;
	demolitions: number;
	beams: number;
	happy: number;
	overcap: number;
	dropped: number;
	maxEffects: number;
	maxPins: number;
	maxWaves: number;
	kills: number;
	piecesBroken: number;
}

function newTally(): Tally {
	return {
		hashes: [],
		forward: 0,
		rings: 0,
		rebukes: 0,
		thunder: 0,
		ballista: 0,
		ballistaWall: 0,
		pins: 0,
		slams: 0,
		smashes: 0,
		demolitions: 0,
		beams: 0,
		happy: 0,
		overcap: 0,
		dropped: 0,
		maxEffects: 0,
		maxPins: 0,
		maxWaves: 0,
		kills: 0,
		piecesBroken: 0,
	};
}

/** One tick's events and caps into `t`; the budget and record caps asserted on the spot. */
function collect(s: SimState, t: Tally): void {
	t.hashes.push(hashState(s));
	const e = s.builds!.events;
	for (const k of e.waveKind) {
		if (k === WaveKind.FORWARD) t.forward += 1;
		else if (k === WaveKind.RING) t.rings += 1;
		else if (k === WaveKind.REBUKE) t.rebukes += 1;
	}
	for (const f of e.sparkFork) if (f === SparkFork.THUNDER) t.thunder += 1;
	t.ballista += e.ballistaX.size();
	for (const wall of e.ballistaWall) if (wall === 1) t.ballistaWall += 1;
	t.pins += e.pinStartSlot.size();
	t.slams += e.slamX.size();
	t.smashes += e.smashX.size();
	t.demolitions += e.demolitionX.size();
	t.beams += e.beamOwner.size();
	t.happy += e.happyPlayer.size();
	t.overcap += e.overcapPoints.size();
	t.dropped += e.effectDropped;
	t.kills += s.events.enemiesKilled;
	const counts = effectCounts(s);
	for (const n of counts.perOwner) {
		expect(n <= BUILDS_CONFIG.effectBulletsMax).toBe(true);
		if (n > t.maxEffects) t.maxEffects = n;
	}
	expect(counts.total <= s.combat.playerBullets.capacity).toBe(true);
	let carrying = 0;
	for (const pin of s.builds!.pins) if (pin.slot >= 0) carrying += 1;
	expect(carrying <= SIEGE_PINS_MAX).toBe(true);
	expect(s.builds!.waves.size() <= RIPOSTE_WAVES_MAX).toBe(true);
	if (carrying > t.maxPins) t.maxPins = carrying;
	if (s.builds!.waves.size() > t.maxWaves) t.maxWaves = s.builds!.waves.size();
}

// ---------------------------------------------------------------------------------------------
// Scenario 1: the dense room, three players, 720 ticks.

const TICKS = 720;
/** The guard's cycle (Bastion's 27-tick guard and the 60-tick cooldown fit). */
const GUARD_CYCLE = 70;
/** The archer's cycle: a 30-tick hold (II-III charge 27), the release, a pause; every 4th a roll through a volley. */
const BOW_CYCLE = 50;
const BOW_HOLD = 30;
/** The archer's x on every cycle's lane: 14.5 tiles from the east wall's face (x 36.5). */
const BOW_LANE_X = 22;
/** The Wrecker's cycle: back to the west end of a row, a walk, a roll, swings, another roll, more swings. */
const WRECK_CYCLE = 120;
/** The Wrecker's drinks (a wound the tick before, so the flask can be taken). */
const DRINKS = [150, 450];

/**
 * Every wave 1 card, on three players:
 * - 0 (sword): Riposte III (Counterstrike), Chain Spark, Composure, Bastion; Thunder Guard, Stillwater, Rebuke.
 * - 1 (bow): Ballista III (Siege Bolt), Ember Wake, Hearty, Sharpened, Bastion, Riposte; Dragon Bolt, Full Heart,
 *   Rebuke (a bow roll's ring).
 * - 2 (sword): Wrecker III (Demolition), Volatile, Soul Shards, Deep Flask, Bounty; Powder Keg, Happy Hour.
 */
function dressed(): SimState {
	const s = createSimState(SEED, 6, 12, CONFIG);
	grantLevels(s, 0, Boon.RIPOSTE, 3);
	grantLevels(s, 0, Boon.CHAIN_SPARK, 1);
	grantLevels(s, 0, Boon.COMPOSURE, 1);
	grantLevels(s, 0, Boon.BASTION, 1);
	grantDuo(s, 0, Duo.THUNDER_GUARD);
	grantDuo(s, 0, Duo.STILLWATER);
	grantDuo(s, 0, Duo.REBUKE);

	grantLevels(s, 1, Boon.BALLISTA, 3);
	grantLevels(s, 1, Boon.EMBER_WAKE, 1);
	grantLevels(s, 1, Boon.HEARTY, 1);
	grantLevels(s, 1, Boon.SHARPENED, 1);
	grantLevels(s, 1, Boon.BASTION, 1);
	grantLevels(s, 1, Boon.RIPOSTE, 1);
	grantDuo(s, 1, Duo.DRAGON_BOLT);
	grantDuo(s, 1, Duo.FULL_HEART);
	grantDuo(s, 1, Duo.REBUKE);

	grantLevels(s, 2, Boon.WRECKER, 3);
	grantLevels(s, 2, Boon.VOLATILE, 1);
	grantLevels(s, 2, Boon.SOUL_SHARDS, 1);
	grantLevels(s, 2, Boon.DEEP_FLASK, 1);
	grantLevels(s, 2, Boon.BOUNTY, 1);
	grantDuo(s, 2, Duo.POWDER_KEG);
	grantDuo(s, 2, Duo.HAPPY_HOUR);

	const at: ReadonlyArray<readonly [number, number]> = [
		[13, 12],
		[BOW_LANE_X, 5],
		[6, PIECE_ROWS[0]],
	];
	for (let i = 0; i < PARTY; i++) {
		const p = playerAt(s, i);
		p.x = at[i][0];
		p.z = at[i][1];
	}
	return s;
}

/** Player 0: a guard into a 10-bullet volley every cycle (armor emptied every other one, so Bastion braces). */
function swordInput(s: SimState, t: number): InputFrame {
	const phase = t % GUARD_CYCLE;
	if (phase === 0) {
		if (math.floor(t / GUARD_CYCLE) % 2 === 1) playerAt(s, 0).armor = 0;
		volleyAhead(s, 0, 10);
		return frame(0, 0, Button.ALT, 1, 0);
	}
	if (phase < 32) return IDLE;
	// swings (and finishers) toward the pack, drifting a little north and south
	return frame(0, phase < 50 ? 0.2 : -0.2, Button.FIRE, 1, 0);
}

/** Player 1: swap to the bow, then charged shots along lanes; every 4th cycle a roll through a volley instead. */
function bowInput(s: SimState, t: number): InputFrame {
	if (t === 0) return frame(0, 0, Button.SWAP, 1, 0);
	const cycle = math.floor(t / BOW_CYCLE);
	const phase = t % BOW_CYCLE;
	if (phase === 0) {
		// a lane whose wall the heavy arrow reaches (15.4 tiles): pins slam, unpinned arrows fan back off the wall
		const p = playerAt(s, 1);
		p.x = BOW_LANE_X;
		p.z = LANE_ZS[cycle % LANE_ZS.size()];
	}
	if (cycle % 4 === 3) {
		if (phase === 10) {
			playerAt(s, 1).armor = 0;
			volleyAhead(s, 1, 12, 0.6);
			return frame(1, 0, Button.ROLL, 1, 0);
		}
		return IDLE;
	}
	const az = ((cycle % 5) - 2) * 0.1;
	if (phase < BOW_HOLD) return frame(0, 0, Button.ALT, 1, az);
	return frame(0, 0, 0, 1, az);
}

/** Player 2: rolls through crate rows, swings at what stands, drinks twice. */
function wreckInput(s: SimState, t: number): InputFrame {
	const p = playerAt(s, 2);
	if (DRINKS.includes(t + 1)) p.hearts = p.heartsMax - 1;
	if (DRINKS.includes(t)) return frame(0, 0, Button.FLASK, 1, 0);
	const cycle = math.floor(t / WRECK_CYCLE);
	const phase = t % WRECK_CYCLE;
	if (phase === 0) {
		p.x = 6;
		p.z = PIECE_ROWS[cycle % PIECE_ROWS.size()];
	}
	if (phase < 6) return frame(1, 0, 0, 1, 0);
	if (phase === 6 || phase === 60) return frame(1, 0, Button.ROLL, 1, 0);
	if (phase < 30) return frame(1, 0, 0, 1, 0);
	return frame(phase < 90 ? 0.4 : 0, 0, Button.FIRE, 1, 0);
}

function playDense(): Tally {
	const s = dressed();
	const tally = newTally();
	for (let t = 0; t < TICKS; t++) {
		// god mode by i-frames (Full Heart needs full hearts; Bastion's braces still see the armor emptied above)
		for (let i = 0; i < PARTY; i++) playerAt(s, i).hurtTicks = 1e6;
		const inputs = [swordInput(s, t), bowInput(s, t), wreckInput(s, t)];
		stepParty(s, inputs, CONFIG);
		collect(s, tally);
	}
	expect(weaponsAt(s, 1).activeSet).toBe(1);
	let broken = 0;
	for (const piece of s.breakables!.pieces) if (piece.brokenTick !== NOT_BROKEN) broken += 1;
	tally.piecesBroken = broken;
	return tally;
}

// ---------------------------------------------------------------------------------------------
// Scenario 2: a capped boss in an open arena, two players (a guard's counter and Siege Bolt's heavy arrows).

const BOSS_ROOM: EncounterRoom = {
	id: 0,
	type: "boss",
	depth: 1,
	cx: 0,
	cz: 0,
	minX: -9,
	maxX: 9,
	minZ: -9,
	maxZ: 9,
	floorTiles: 324,
};
const BOSS_WORLD = {
	bounds: DEFAULT_BOUNDS,
	loadout: ["weapon.sword", "weapon.bow"],
	encounter: { spawns: [], rooms: [BOSS_ROOM], entranceRoom: -1, bossRoom: 0 },
};

function bossArena(): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: BOSS_WORLD,
				bossFloor: false,
				spawnX: 0,
				spawnZ: -4,
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

const BOSS_CONFIG: SimConfig = {
	endless: { runSeed: SEED, worldForFloor: bossArena() },
	scoring: { partySize: 2 },
	builds: BUILDS_CONFIG,
	party: { size: 2 },
};
const BOSS_TICKS = 480;

/** A unit-ish aim from player `i` at the boss (the frame quantizes it). */
function aimAt(s: SimState, i: number, bx: number, bz: number): [number, number] {
	const p = playerAt(s, i);
	const dx = bx - p.x;
	const dz = bz - p.z;
	const d = math.sqrt(dx * dx + dz * dz);
	return d > 1e-6 ? [dx / d, dz / d] : [0, 1];
}

function playBoss(): Tally {
	const s = createSimState(SEED, 0, -4, BOSS_CONFIG);
	grantLevels(s, 0, Boon.RIPOSTE, 3);
	grantLevels(s, 0, Boon.SHARPENED, 3);
	grantLevels(s, 1, Boon.BALLISTA, 3);
	grantLevels(s, 1, Boon.SHARPENED, 3);
	playerAt(s, 1).x = 3;
	const boss = new SimCtx().bind(s, BOSS_WORLD, IDLE).spawnActor(BOSS_ACT1_ID, 0, 3)!;
	boss.aiState = BossFightState.RECOVER;
	boss.phase = 3;
	boss.hp = 100000;
	boss.hpMax = 100000;
	boss.spawnTick = -1;
	const tally = newTally();
	for (let t = 0; t < BOSS_TICKS; t++) {
		for (let i = 0; i < 2; i++) playerAt(s, i).hurtTicks = 1e6;
		const [ax0, az0] = aimAt(s, 0, boss.x, boss.z);
		const [ax1, az1] = aimAt(s, 1, boss.x, boss.z);
		const phase = t % GUARD_CYCLE;
		let a: InputFrame;
		if (phase === 0) {
			// a 10-bullet volley at the guard's arc, the counter the boss eats at the guard's end
			const c = s.combat;
			const p = playerAt(s, 0);
			for (let k = 0; k < 10; k++)
				c.enemySpawned += fireBurstRaw(
					c.enemyBullets,
					1,
					p.x + ax0 * (0.9 + 0.1 * k),
					p.z + az0 * (0.9 + 0.1 * k),
					1,
					0,
					1,
					0,
					0,
					3,
					packPayload(1, BulletKind.ENEMY, 1),
				);
			a = frame(0, 0, Button.ALT, ax0, az0);
		} else if (phase < 22) a = frame(0, 0, 0, ax0, az0);
		else a = frame(0, 0, Button.FIRE, ax0, az0);
		const bp = t % BOW_CYCLE;
		const b =
			t === 0
				? frame(0, 0, Button.SWAP, ax1, az1)
				: bp < BOW_HOLD
				? frame(0, 0, Button.ALT, ax1, az1)
				: frame(0, 0, 0, ax1, az1);
		stepParty(s, [a, b], BOSS_CONFIG);
		collect(s, tally);
	}
	return tally;
}

// ---------------------------------------------------------------------------------------------

describe("builds v2, wave 1: everything at once (BV10)", () => {
	it("a co-op dense room with every wave 1 boon at III and every wave 1 duo: two runs hash the same every tick", () => {
		const a = playDense();
		const b = playDense();
		expect(a.hashes.size()).toBe(TICKS);
		for (let t = 0; t < TICKS; t++) expect([t, b.hashes[t]]).toEqual([t, a.hashes[t]]);
		print(
			`[wave1] dense: forward ${a.forward} ring ${a.rings} rebuke ${a.rebukes} thunder ${a.thunder} ballista ${
				a.ballista
			} (wall ${a.ballistaWall}) pins ${a.pins} slams ${a.slams} smashes ${a.smashes} demolitions ${
				a.demolitions
			} beams ${a.beams} happy ${a.happy} dropped ${a.dropped} maxEffects ${a.maxEffects} maxPins ${
				a.maxPins
			} maxWaves ${a.maxWaves} kills ${a.kills} pieces ${a.piecesBroken}/${PIECES.size()}`,
		);
		// Riposte: Counterstrike's rings (10 erased), Thunder Guard's sparks, Rebuke's rings (guard and bow roll braces)
		expect(a.rings + a.forward > 0).toBe(true);
		expect(a.thunder > 0).toBe(true);
		expect(a.rebukes > 0).toBe(true);
		// Ballista: bursts, Siege Bolt's pins and slams
		expect(a.ballista > 0).toBe(true);
		expect(a.pins > 0).toBe(true);
		expect(a.slams > 0).toBe(true);
		// Wrecker: smashes and Demolition's blasts
		expect(a.smashes > 0).toBe(true);
		expect(a.demolitions > 0).toBe(true);
		expect(a.piecesBroken > 0).toBe(true);
		// Full Heart's beams and both Happy Hour drinks
		expect(a.beams > 0).toBe(true);
		expect(a.happy).toBe(DRINKS.size());
		// no boss: no overcap
		expect(a.overcap).toBe(0);
		expect([b.forward, b.rings, b.rebukes, b.pins, b.slams, b.smashes, b.beams, b.kills]).toEqual([
			a.forward,
			a.rings,
			a.rebukes,
			a.pins,
			a.slams,
			a.smashes,
			a.beams,
			a.kills,
		]);
	});

	it("a capped boss under counters and heavy arrows pays overcap points; two runs hash the same every tick", () => {
		const a = playBoss();
		const b = playBoss();
		expect(a.hashes.size()).toBe(BOSS_TICKS);
		for (let t = 0; t < BOSS_TICKS; t++) expect([t, b.hashes[t]]).toEqual([t, a.hashes[t]]);
		print(
			`[wave1] boss: forward ${a.forward} ring ${a.rings} ballista ${a.ballista} pins ${a.pins} overcap ${a.overcap} dropped ${a.dropped}`,
		);
		expect(a.overcap > 0).toBe(true);
		expect(a.rings + a.forward > 0).toBe(true);
		// a boss is never pinned (the heavy arrows pierce it and fly on: no wall in this arena, so no burst either)
		expect(a.pins).toBe(0);
		expect(b.overcap).toBe(a.overcap);
	});
});
