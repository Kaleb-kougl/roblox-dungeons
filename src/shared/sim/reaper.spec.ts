// docs/NEW_ENEMIES.md NE4: the Reaper (`reaper`, band PORT_BAND_ENEMIES_2). The cast (two draws: the cooldown, then
// the turn sign), the 0.6 s wind, the spin (12 volleys of 2 = 24 bullets along entries k and k + 8 of the WEB 16 @
// FULL_RING row, k stepping by the turn sign), its drift, the 0.9 s dizzy window, and a determinism pin. Hand-built
// open arena (no dungeon), the player standing at the origin.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AiState,
	EMPTY_INPUT,
	FULL_RING,
	REAPER,
	REAPER_ATTACK_WIND,
	REAPER_DIZZY,
	REAPER_KEEP,
	REAPER_LOST,
	REAPER_PHASE_TICKS,
	REAPER_SPIN,
	REAPER_SPIRAL_COUNT,
	REAPER_SPIRAL_INDEX,
	REAPER_TURN,
	SIM_DT,
	arcTrig,
	archetypeIndex,
	createSimState,
	hashState,
	reaperNearestEntry,
	rngInt,
	rngNext,
	step,
	type ActorSpawn,
	type ActorState,
	type SimConfig,
	type SimState,
} from "shared/sim";

const enc = (spawns: ActorSpawn[]) => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });
const arena = (spawns: ActorSpawn[]): SimConfig => ({ encounter: enc(spawns) });

/** The player can't be hurt (bullets and bodies pass through). */
const ghost = (s: SimState): void => {
	s.player.hurtTicks = 1e6;
};
const reaperOf = (s: SimState): ActorState => {
	const kind = archetypeIndex(REAPER.id);
	for (const a of s.combat.actors) if (a.kind === kind) return a;
	error("no reaper", 0);
};
/** Live enemy bullets as "slot:vx:vz" keys (a new bullet is a key that was not there before the step). */
function bulletKeys(s: SimState): Set<string> {
	const sim = s.combat.enemyBullets;
	const keys = new Set<string>();
	sim.forEachActive((i) => {
		const v = sim.velocityAt(i);
		keys.add(`${i}:${v.x}:${v.z}`);
	});
	return keys;
}
/** The 16-row entry whose (sin, cos) is exactly the velocity / speed, or -1. */
function entryOf(vx: number, vz: number): number {
	const ring = arcTrig(REAPER_SPIRAL_COUNT, FULL_RING);
	const speed = REAPER.data.spiralShot.speed;
	for (let k = 0; k < REAPER_SPIRAL_COUNT; k++)
		if (ring.sin[k] === vx / speed && ring.cos[k] === vz / speed) return k;
	return -1;
}

interface Volley {
	tick: number;
	entries: number[];
}
interface Cast {
	/** Tick of the cast (the telegraph starts). */
	castTick: number;
	rngBefore: number;
	rngAfter: number;
	cooldown: number;
	turn: number;
	/** Ticks (after the step) in each state from the cast to the return to REAPER_KEEP. */
	windTicks: number;
	spinTicks: number;
	dizzyTicks: number;
	volleys: Volley[];
	/** Bullets spawned from the cast tick to the end of the dizzy window. */
	spawned: number;
	/** Bearing entry at the start of the first volley's tick. */
	bearingEntry: number;
	/** Rng draws seen after the cast tick until the return to keep (state changes). */
	drawsAfterCast: number;
	/** Largest per-tick drift during the spin, and whether every spin tick got closer to the player. */
	maxDrift: number;
	alwaysCloser: boolean;
	/** The dizzy window never moved. */
	dizzyStill: boolean;
	attackDuringWind: number;
	attackAfterWind: number;
	distAtCast: number;
}

/** aiState read through a call (no narrowing across steps). */
const stateOf = (a: ActorState): number => a.aiState;

/** Steps until the reaper casts, then through its wind, spin and dizzy; records everything. */
function runCast(s: SimState, config: SimConfig, maxTicks = 60 * 20): Cast {
	const a = reaperOf(s);
	let t = 0;
	let rngBefore = s.rngState;
	while (stateOf(a) !== AiState.TELEGRAPH) {
		rngBefore = s.rngState;
		step(s, EMPTY_INPUT, config);
		t++;
		if (t > maxTicks) error("never cast", 0);
	}
	const c: Cast = {
		castTick: t,
		rngBefore,
		rngAfter: s.rngState,
		cooldown: a.cooldown,
		turn: a.v[REAPER_TURN],
		windTicks: 1,
		spinTicks: 0,
		dizzyTicks: 0,
		volleys: [],
		spawned: 0,
		bearingEntry: -1,
		drawsAfterCast: 0,
		maxDrift: 0,
		alwaysCloser: true,
		dizzyStill: true,
		attackDuringWind: a.attack,
		attackAfterWind: -1,
		distAtCast: math.sqrt(a.x * a.x + a.z * a.z),
	};
	while (stateOf(a) !== REAPER_KEEP) {
		const before = bulletKeys(s);
		const spawned0 = s.combat.enemySpawned;
		const rng0 = s.rngState;
		const x0 = a.x;
		const z0 = a.z;
		const state0 = stateOf(a);
		step(s, EMPTY_INPUT, config);
		t++;
		if (s.rngState !== rng0) c.drawsAfterCast++;
		const n = s.combat.enemySpawned - spawned0;
		c.spawned += n;
		if (n > 0) {
			const entries: number[] = [];
			const sim = s.combat.enemyBullets;
			sim.forEachActive((i) => {
				const v = sim.velocityAt(i);
				if (!before.has(`${i}:${v.x}:${v.z}`)) entries.push(entryOf(v.x, v.z));
			});
			entries.sort((p, q) => p < q);
			c.volleys.push({ tick: t, entries });
			if (c.bearingEntry < 0) {
				const d = math.sqrt(x0 * x0 + z0 * z0);
				c.bearingEntry = reaperNearestEntry(REAPER_SPIRAL_COUNT, -x0 / d, -z0 / d);
			}
		}
		const moved = math.sqrt((a.x - x0) * (a.x - x0) + (a.z - z0) * (a.z - z0));
		if (stateOf(a) === AiState.TELEGRAPH) {
			c.windTicks++;
			c.attackDuringWind = a.attack;
		} else if (stateOf(a) === REAPER_SPIN || (state0 === REAPER_SPIN && stateOf(a) === REAPER_DIZZY)) {
			// A spin tick (the wind's last tick and the spin's last tick included).
			if (stateOf(a) === REAPER_SPIN) c.spinTicks++;
			if (c.attackAfterWind < 0) c.attackAfterWind = a.attack;
			if (moved > c.maxDrift) c.maxDrift = moved;
			if (a.x * a.x + a.z * a.z >= x0 * x0 + z0 * z0) c.alwaysCloser = false;
		}
		if (stateOf(a) === REAPER_DIZZY) {
			c.dizzyTicks++;
			if (state0 === REAPER_DIZZY && moved !== 0) c.dizzyStill = false;
		}
		if (t > maxTicks * 2) error("never recovered", 0);
	}
	return c;
}

describe("reaper: data", () => {
	it("has the plan's numbers and free v slots", () => {
		const d = REAPER.data;
		expect([d.firstSpinTicks, d.spinTrigger, d.spinTicks / d.volleyEveryTicks]).toEqual([72, 5, 12]);
		expect([REAPER_PHASE_TICKS, REAPER_SPIRAL_INDEX, REAPER_TURN, REAPER_LOST]).toEqual([3, 4, 5, 6]);
		expect([d.spiralShot.count, d.spiralShot.spread]).toEqual([1, 0]);
		expect(d.fx!.ring!.attack).toBe(REAPER_ATTACK_WIND);
	});

	it("reads its directions from the arc table (no arc table miss)", () => {
		const ring = arcTrig(REAPER.data.spiralCount, FULL_RING);
		expect([ring.count, ring.full, ring.sin.size(), ring.cos.size()]).toEqual([16, true, 16, 16]);
		expect(arcTrig(REAPER.data.spiralShot.count, REAPER.data.spiralShot.spread).count).toBe(1);
		// The entry nearest each table direction is that entry itself.
		for (let k = 0; k < 16; k++) expect(reaperNearestEntry(16, ring.sin[k], ring.cos[k])).toBe(k);
	});
});

describe("reaper: one cast", () => {
	const config = arena([{ kind: REAPER.id, x: 0, z: 7 }]);
	const play = (seed: number): Cast => {
		const s = createSimState(seed, 0, 0, config);
		ghost(s);
		return runCast(s, config);
	};

	it("draws nothing before its first cast, then exactly the cooldown and the turn sign, then nothing", () => {
		for (let seed = 1; seed <= 6; seed++) {
			const s = createSimState(seed, 0, 0, config);
			ghost(s);
			const rng0 = s.rngState;
			const c = runCast(s, config);
			expect(c.rngBefore).toBe(rng0);
			const h = { rngState: c.rngBefore };
			const cooldown = rngInt(h, REAPER.data.spinCooldownMin, REAPER.data.spinCooldownMax);
			const turn = rngNext(h) < 0.5 ? -1 : 1;
			expect([seed, c.rngAfter, c.cooldown, c.turn]).toEqual([seed, h.rngState, cooldown, turn]);
			expect([seed, c.drawsAfterCast]).toEqual([seed, 0]);
		}
	});

	it("casts only within spinTrigger, winds 36 ticks under the ring (attack WIND), then clears the attack", () => {
		const c = play(3);
		expect(c.distAtCast <= REAPER.data.spinTrigger).toBe(true);
		expect(c.windTicks).toBe(REAPER.data.windTicks);
		expect(c.attackDuringWind).toBe(REAPER_ATTACK_WIND);
		expect(c.attackAfterWind).toBe(0);
	});

	it("fires exactly 24 bullets: 2 per volley, every 8 ticks from the wind's end, along entries k and k + 8", () => {
		for (let seed = 1; seed <= 6; seed++) {
			const c = play(seed);
			expect([seed, c.spawned, c.volleys.size()]).toEqual([seed, 24, 12]);
			const first = c.castTick + REAPER.data.windTicks;
			let k = c.bearingEntry;
			for (let j = 0; j < c.volleys.size(); j++) {
				const v = c.volleys[j];
				const pair = [k, (k + 8) % 16];
				pair.sort((p, q) => p < q);
				expect([seed, j, v.tick, v.entries]).toEqual([seed, j, first + j * REAPER.data.volleyEveryTicks, pair]);
				k = (k + c.turn + 16) % 16;
			}
		}
	});

	it("turns both ways across casts (the turn sign is the draw)", () => {
		const turns = new Set<number>();
		for (let seed = 1; seed <= 12; seed++) turns.add(play(seed).turn);
		expect(turns.has(1) && turns.has(-1)).toBe(true);
	});

	it("drifts toward its target at spinDriftSpeed during the spin", () => {
		const c = play(2);
		expect(c.spinTicks).toBe(REAPER.data.spinTicks - 1); // the first spin tick is the wind's last
		expect(c.maxDrift <= REAPER.data.spinDriftSpeed * SIM_DT + 1e-12).toBe(true);
		expect(c.maxDrift > 0).toBe(true);
		expect(c.alwaysCloser).toBe(true);
	});

	it("stands dizzy for exactly dizzyTicks, still and firing nothing, then closes in again", () => {
		const s = createSimState(4, 0, 0, config);
		ghost(s);
		const c = runCast(s, config);
		expect(c.dizzyTicks).toBe(REAPER.data.dizzyTicks);
		expect(c.dizzyStill).toBe(true);
		const lastVolley = c.volleys[c.volleys.size() - 1].tick;
		expect(c.castTick + c.windTicks + REAPER.data.spinTicks - 1).toBe(
			lastVolley + REAPER.data.volleyEveryTicks - 1,
		);
		expect(reaperOf(s).aiState).toBe(REAPER_KEEP);
		// The next cast waits for the drawn cooldown (counted while closing in) and draws two more.
		const again = runCast(s, config);
		expect(again.spawned).toBe(24);
	});
});

describe("reaper: determinism", () => {
	const config = arena([
		{ kind: REAPER.id, x: 0, z: 7 },
		{ kind: REAPER.id, x: -6, z: -3 },
	]);
	const play = (): string[] => {
		const s = createSimState(4242, 0, 0, config);
		ghost(s);
		const hashes: string[] = [];
		for (let t = 0; t < 60 * 15; t++) {
			// The player steps aside every 2 s.
			if (t % 120 === 60) {
				s.player.x += 1.5;
				s.player.prevX = s.player.x;
			}
			step(s, EMPTY_INPUT, config);
			hashes.push(hashState(s));
		}
		return hashes;
	};

	it("two runs from the same seed give identical hashes every tick", () => {
		const one = play();
		const two = play();
		expect(one.size()).toBe(two.size());
		for (let t = 0; t < one.size(); t++) if (one[t] !== two[t]) expect([t, one[t]]).toEqual([t, two[t]]);
	});

	it("pins the outcome of seed 4242 (900 ticks)", () => {
		const s = createSimState(4242, 0, 0, config);
		ghost(s);
		for (let t = 0; t < 60 * 15; t++) {
			if (t % 120 === 60) {
				s.player.x += 1.5;
				s.player.prevX = s.player.x;
			}
			step(s, EMPTY_INPUT, config);
		}
		const kind = archetypeIndex(REAPER.id);
		const reapers = s.combat.actors.filter((a) => a.kind === kind);
		// Four spins (96 bullets); both reapers are closing in again at tick 900.
		expect([s.combat.enemySpawned, s.rngState, hashState(s)]).toEqual([96, 1767628858, "0ec6037b"]);
		expect(reapers.map((a) => [a.aiState, a.cooldown, a.v[REAPER_TURN], a.v[REAPER_SPIRAL_INDEX]])).toEqual([
			[REAPER_KEEP, 35, -1, 9],
			[REAPER_KEEP, 33, -1, 8],
		]);
		const pos = [6.535224505845854, 0.529674693519282, 6.503877330601063, -0.17607842319806824];
		const got = [reapers[0].x, reapers[0].z, reapers[1].x, reapers[1].z];
		for (let i = 0; i < pos.size(); i++) expect(got[i]).toBeCloseTo(pos[i], 12);
	});
});
