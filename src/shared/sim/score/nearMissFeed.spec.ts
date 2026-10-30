// docs/GRAZE_PARRY.md GP1: the unhashed near-miss feed in ScoreEvents. Grazes report the bullet's position and
// velocity at the award and the grazing player (solo 0, co-op the nearest living player); a sword guard reports each
// erased bullet's position and the guarding player (swing deletes and unscored runs report nothing); the Mirror Cloak
// still reflects exactly as without the feed; clones copy the arrays; the state hash ignores them.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	BULLET_Y,
	BulletKind,
	BulletPayload,
	Button,
	DEFAULT_BOUNDS,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	HIT_NORMAL,
	Relic,
	SOLO_PLAYER,
	ScoreSource,
	cloneScoreState,
	compose,
	createSimState,
	fireBurstRaw,
	gen,
	grantRelic,
	hashLayout,
	hashState,
	mod,
	packPayload,
	playerAt,
	step,
	stepParty,
	type BulletSimulation,
	type EndlessFloorWorld,
	type InputFrame,
	type ScoreEvents,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SCORED: SimConfig = { ...DEFAULT_SIM_CONFIG, scoring: {} };
const DUO: SimConfig = { ...DEFAULT_SIM_CONFIG, party: { size: 2 }, scoring: { partySize: 2 } };
const IDLE: InputFrame = { ...EMPTY_INPUT };
const GUARD: InputFrame = { ...EMPTY_INPUT, buttons: Button.ALT };
const SWING: InputFrame = { ...EMPTY_INPUT, buttons: Button.FIRE };

/** One enemy bullet at (x, z) heading +Z at `speed` (score.spec.ts's shoot). */
function shoot(s: SimState, x: number, z: number, speed: number): void {
	const payload = BulletPayload.pack({ damage: HIT_NORMAL, kind: BulletKind.SNIPER });
	s.combat.enemyBullets.fireAt({ x, y: BULLET_Y, z }, () => compose(gen.arc(1, 0, speed, 0), mod.payload(payload)));
}

/** One enemy bullet from (x, z) along the unit direction (dirX, dirZ) at `speed` (progression.spec.ts's). */
function enemyBullet(s: SimState, x: number, z: number, dirX: number, dirZ: number, speed: number): void {
	const c = s.combat;
	c.enemySpawned += fireBurstRaw(c.enemyBullets, 0, x, z, dirX, dirZ, 1, 0, speed, 5, packPayload(1, 5, 0));
}

function onlyBullet(sim: BulletSimulation): number {
	let slot = -1;
	sim.forEachActive((i) => {
		slot = i;
		return false;
	});
	return slot;
}

/** The live enemy bullets' positions in the bullet walk's order (the order a sweep visits them). */
function walkPositions(sim: BulletSimulation): [number[], number[]] {
	const xs: number[] = [];
	const zs: number[] = [];
	sim.forEachActive((_i, pos) => {
		xs.push(pos.x);
		zs.push(pos.z);
		return false;
	});
	return [xs, zs];
}

function place(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

function kill(s: SimState, i: number): void {
	const p = playerAt(s, i);
	p.dead = 1;
	p.hearts = 0;
}

function events(s: SimState): ScoreEvents {
	return s.score!.events;
}

/** The parallel-array invariant of one tick's events. */
function expectSizes(e: ScoreEvents): void {
	expect([e.grazeX.size(), e.grazeZ.size(), e.grazeVX.size(), e.grazeVZ.size(), e.grazePlayer.size()]).toEqual([
		e.grazes,
		e.grazes,
		e.grazes,
		e.grazes,
		e.grazes,
	]);
	expect([e.guardX.size(), e.guardZ.size(), e.guardPlayer.size()]).toEqual([
		e.guardCancels,
		e.guardCancels,
		e.guardCancels,
	]);
}

interface GrazeLog {
	x: number[];
	z: number[];
	vx: number[];
	vz: number[];
	player: number[];
	/** Per logged graze: the bullet's live position / velocity right after the award tick. */
	liveX: number[];
	liveZ: number[];
	liveVX: number[];
	liveVZ: number[];
}

/** Steps `n` ticks with `advance`, collecting every tick's graze entries (and the lone bullet's state at the award). */
function collectGrazes(s: SimState, n: number, advance: (s: SimState) => void): GrazeLog {
	const log: GrazeLog = { x: [], z: [], vx: [], vz: [], player: [], liveX: [], liveZ: [], liveVX: [], liveVZ: [] };
	const sim = s.combat.enemyBullets;
	for (let k = 0; k < n; k++) {
		advance(s);
		const e = events(s);
		expectSizes(e);
		for (let j = 0; j < e.grazes; j++) {
			log.x.push(e.grazeX[j]);
			log.z.push(e.grazeZ[j]);
			log.vx.push(e.grazeVX[j]);
			log.vz.push(e.grazeVZ[j]);
			log.player.push(e.grazePlayer[j]);
			const slot = onlyBullet(sim);
			if (slot >= 0) {
				log.liveX.push(sim.positionAt(slot).x);
				log.liveZ.push(sim.positionAt(slot).z);
				log.liveVX.push(sim.velocityAt(slot).x);
				log.liveVZ.push(sim.velocityAt(slot).z);
			}
		}
	}
	return log;
}

const soloStep = (s: SimState) => step(s, IDLE, SCORED);
const duoStep = (s: SimState) => stepParty(s, [IDLE, IDLE], DUO);

describe("graze feed", () => {
	it("solo: one entry with the bullet's position and velocity at the award tick, player 0", () => {
		const s = createSimState(1, 0, 0, SCORED);
		shoot(s, 0.7, -5, 6);
		const log = collectGrazes(s, 150, soloStep);
		expect(s.score!.counts[ScoreSource.GRAZES]).toBe(1);
		expect(log.player).toEqual([SOLO_PLAYER]);
		// Nothing moves the bullet after the collision walk, so its live state after the tick is the award's.
		expect(log.x).toEqual(log.liveX);
		expect(log.z).toEqual(log.liveZ);
		expect(log.vx).toEqual(log.liveVX);
		expect(log.vz).toEqual(log.liveVZ);
		expect(log.x[0]).toBe(0.7);
		expect(log.z[0]).toBeGreaterThan(0); // it has passed the player and just left the ring
		expect(log.vz[0]).toBeGreaterThan(0);
	});

	it("solo: a bullet that hits and a dead player's near miss record nothing", () => {
		const hit = createSimState(1, 0, 0, SCORED);
		shoot(hit, 0, -5, 6);
		expect(collectGrazes(hit, 150, soloStep).x).toEqual([]);
		expect(hit.score!.hitsTaken).toBe(1);

		const dead = createSimState(1, 0, 0, SCORED);
		kill(dead, 0);
		shoot(dead, 0.7, -5, 6);
		expect(collectGrazes(dead, 150, soloStep).x).toEqual([]);
	});

	it("co-op: the nearest living player's index is recorded", () => {
		for (const grazer of [0, 1]) {
			const s = createSimState(1, 0, 0, DUO);
			const other = 1 - grazer;
			place(s, grazer, 0, 0);
			place(s, other, 4, 0);
			shoot(s, 0.7, -5, 6);
			const log = collectGrazes(s, 150, duoStep);
			expect(log.player).toEqual([grazer]);
			expect(log.x).toEqual(log.liveX);
			expect(log.z).toEqual(log.liveZ);
			expect(log.vx).toEqual(log.liveVX);
			expect(log.vz).toEqual(log.liveVZ);
		}
	});

	it("co-op: a dead player is skipped; the bullet grazes the nearest living one", () => {
		const s = createSimState(1, 0, 0, DUO);
		place(s, 0, 0, 0);
		place(s, 1, 1.4, 0);
		kill(s, 0);
		shoot(s, 0.7, -5, 6); // 0.7 from both: the living player 1 grazes it
		expect(collectGrazes(s, 150, duoStep).player).toEqual([1]);
	});
});

// ---------------------------------------------------------------------------------------------

/** Three slow bullets in front of the player at (px, pz) (default facing +X +Z), inside the guard's reach. */
function bulletsInFront(s: SimState, px: number, pz: number): void {
	shoot(s, px + 0.7, pz + 0.7, 0.5);
	shoot(s, px + 0.8, pz + 0.6, 0.5);
	shoot(s, px + 0.6, pz + 0.8, 0.5);
}

describe("guard feed", () => {
	it("solo: the erased bullets' positions (the walk's order), player 0, sizes match guardCancels", () => {
		const s = createSimState(1, 0, 0, SCORED);
		bulletsInFront(s, 0, 0);
		// The weapons run before this tick's bullet move, so the erase sees the positions as they are now.
		const [xs, zs] = walkPositions(s.combat.enemyBullets);
		step(s, GUARD, SCORED);
		const e = events(s);
		expect(e.guardCancels).toBe(3);
		expectSizes(e);
		expect(e.guardX).toEqual(xs);
		expect(e.guardZ).toEqual(zs);
		expect(e.guardPlayer).toEqual([0, 0, 0]);
		// The next tick (the guard still up, nothing left to erase) starts empty.
		step(s, IDLE, SCORED);
		expect(events(s).guardCancels).toBe(0);
		expectSizes(events(s));
	});

	it("a plain sword swing deleting bullets records nothing", () => {
		const s = createSimState(1, 0, 0, SCORED);
		bulletsInFront(s, 0, 0);
		step(s, SWING, SCORED);
		expect(s.events.bulletsDeleted).toBeGreaterThan(0);
		const e = events(s);
		expect(e.guardCancels).toBe(0);
		expectSizes(e);
	});

	it("an unscored run records nothing and never touches an earlier scored state's arrays", () => {
		const scored = createSimState(1, 0, 0, SCORED);
		bulletsInFront(scored, 0, 0);
		step(scored, GUARD, SCORED);
		const before = [...events(scored).guardX];

		const plain = createSimState(1, 0, 0, DEFAULT_SIM_CONFIG);
		bulletsInFront(plain, 0, 0);
		step(plain, GUARD, DEFAULT_SIM_CONFIG);
		expect(plain.events.bulletsDeleted).toBe(3);
		expect(plain.score).toBe(undefined);
		expect(events(scored).guardX).toEqual(before);
		expect(events(scored).guardPlayer.size()).toBe(3);
	});

	it("co-op: two players guarding on one tick, each erase tagged with its guard's player", () => {
		const s = createSimState(1, 0, 0, DUO);
		place(s, 0, 0, 0);
		place(s, 1, -4, -4);
		bulletsInFront(s, 0, 0);
		shoot(s, -4 + 0.7, -4 + 0.7, 0.5);
		shoot(s, -4 + 0.6, -4 + 0.8, 0.5);
		const [xs, zs] = walkPositions(s.combat.enemyBullets);
		stepParty(s, [GUARD, GUARD], DUO);
		const e = events(s);
		expect(e.guardCancels).toBe(5);
		expectSizes(e);
		// The weapons phase runs in player index order: player 0's three erases, then player 1's two.
		expect(e.guardPlayer).toEqual([0, 0, 0, 1, 1]);
		// Each entry is one of the erased bullets, and each erased bullet appears once.
		const seen = new Map<string, number>();
		for (let k = 0; k < xs.size(); k++) seen.set(`${xs[k]},${zs[k]}`, (seen.get(`${xs[k]},${zs[k]}`) ?? 0) + 1);
		for (let k = 0; k < e.guardX.size(); k++) {
			const key = `${e.guardX[k]},${e.guardZ[k]}`;
			expect(seen.get(key)).toBe(1);
			seen.set(key, 0);
			// Player 0's erases are near (0, 0), player 1's near (-4, -4).
			expect(e.guardX[k] > -2).toBe(e.guardPlayer[k] === 0);
		}
	});
});

// ---------------------------------------------------------------------------------------------
// Mirror Cloak (an endless arena: relics live in the run state)

const arenaWorlds = new Map<number, EndlessFloorWorld>();
function arenaWorld(floor: number): EndlessFloorWorld {
	let w = arenaWorlds.get(floor);
	if (w === undefined) {
		w = {
			floor,
			config: { bounds: DEFAULT_BOUNDS, encounter: { spawns: [], rooms: [], entranceRoom: -1, bossRoom: -1 } },
			bossFloor: false,
			spawnX: 0,
			spawnZ: 0,
			stairX: 1000,
			stairZ: 1000,
			roomSpawns: [],
			roomIdAt: () => -1,
		};
		arenaWorlds.set(floor, w);
	}
	return w;
}

const ARENA_SEED = 42;
const ENDLESS = { runSeed: ARENA_SEED, worldForFloor: arenaWorld };

interface Reflected {
	erased: number;
	px: number[];
	pz: number[];
	vx: number[];
	vz: number[];
}

function reflectedBullets(s: SimState, erased: number): Reflected {
	const out: Reflected = { erased, px: [], pz: [], vx: [], vz: [] };
	const sim = s.combat.playerBullets;
	sim.forEachActive((i, pos) => {
		out.px.push(pos.x);
		out.pz.push(pos.z);
		out.vx.push(sim.velocityAt(i).x);
		out.vz.push(sim.velocityAt(i).z);
		return false;
	});
	return out;
}

/** Two players with the Mirror Cloak guard into bullets flying at them; scored or not. */
function mirrorGuard(scoring: boolean): [SimState, Reflected] {
	const config: SimConfig = scoring
		? { endless: ENDLESS, party: { size: 2 }, scoring: { partySize: 2 } }
		: { endless: ENDLESS, party: { size: 2 } };
	const s = createSimState(ARENA_SEED, 0, 0, config);
	place(s, 0, 0, 0);
	place(s, 1, -4, -4);
	grantRelic(s, 0, Relic.MIRROR_CLOAK);
	grantRelic(s, 1, Relic.MIRROR_CLOAK);
	const face: InputFrame = { ...EMPTY_INPUT, aimX: AXIS_MAX, aimZ: 0 }; // face +X
	stepParty(s, [face, face], config);
	enemyBullet(s, 1.5, 0, -1, 0, 4);
	enemyBullet(s, 1.2, 0.3, -1, 0, 3);
	enemyBullet(s, -4 + 1.5, -4, -1, 0, 4);
	const guard: InputFrame = { ...face, buttons: Button.ALT };
	stepParty(s, [guard, guard], config);
	return [s, reflectedBullets(s, s.events.bulletsDeleted)];
}

describe("Mirror Cloak guard", () => {
	it("still reflects every erased bullet exactly as an unscored run does, and records the erases", () => {
		const [plain, plainOut] = mirrorGuard(false);
		const [scored, scoredOut] = mirrorGuard(true);
		expect(plain.score).toBe(undefined);
		expect(plainOut.erased).toBe(3);
		expect(plainOut.px.size()).toBe(3);
		expect(scoredOut).toEqual(plainOut);
		const e = events(scored);
		expect(e.guardCancels).toBe(3);
		expectSizes(e);
		expect(e.guardPlayer).toEqual([0, 0, 1]);
	});
});

// ---------------------------------------------------------------------------------------------

/** A scored state whose near-miss arrays are filled by hand. */
function filled(): SimState {
	const s = createSimState(1, 0, 0, SCORED);
	const e = events(s);
	e.grazeX.push(1.5);
	e.grazeZ.push(-2.25);
	e.grazeVX.push(3);
	e.grazeVZ.push(-4);
	e.grazePlayer.push(0);
	e.guardX.push(0.5);
	e.guardZ.push(0.75);
	e.guardPlayer.push(0);
	return s;
}

describe("clone and hash", () => {
	it("cloneScoreState deep-copies the near-miss arrays", () => {
		const s = filled();
		const c = cloneScoreState(s.score!);
		const ce = c.events;
		ce.grazeX.push(9);
		ce.grazeZ[0] = 9;
		ce.grazeVX.clear();
		ce.grazeVZ.push(9);
		ce.grazePlayer[0] = 1;
		ce.guardX.push(9);
		ce.guardZ[0] = 9;
		ce.guardPlayer.clear();
		const e = events(s);
		expect([e.grazeX, e.grazeZ, e.grazeVX, e.grazeVZ, e.grazePlayer]).toEqual([[1.5], [-2.25], [3], [-4], [0]]);
		expect([e.guardX, e.guardZ, e.guardPlayer]).toEqual([[0.5], [0.75], [0]]);
	});

	it("the state hash does not depend on the near-miss arrays", () => {
		const s = createSimState(1, 0, 0, SCORED);
		const h0 = hashState(s);
		const v0 = hashLayout(s).values;
		const f = filled();
		expect(hashState(f)).toBe(h0);
		expect(hashLayout(f).values).toEqual(v0);
	});
});
