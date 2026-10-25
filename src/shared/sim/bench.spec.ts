// E1.6 done-when (GDD: 1,000 bullets at 60 fps), the sim half (ported from src/sim/combat.bench.test.ts): a full
// step() (player, stress emitter, both bullet simulations, wall and hit tests, the bow stream) with ~1,000 live enemy
// bullets, timed over 600 ticks. Adapted: a synthetic grid blocker (a 24x24 walled room, one array lookup per test,
// like the dungeon's bulletBlocker) and no actors; a second case runs the source's own setup (the seed-1337 floor, its
// encounter of 25 actors, stress rings at the entrance).
// Numbers are printed; the assertion is deliberately generous. The headless runner is a pessimistic host: it loads
// sim modules into a custom environment, which in Lune turns off Luau's builtin fast paths (~1.8x) and native codegen
// (~6x on this kind of loop); Roblox runs the same bytecode in a safe environment.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_ENCOUNTER,
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bulletBlocker,
	circleMover,
	entranceSpawn,
	generateDungeon,
	placeEncounter,
} from "shared/dungeon";
import {
	Button,
	DEFAULT_BOUNDS,
	EMPTY_INPUT,
	PLAYER_RADIUS,
	countActors,
	createSimState,
	step,
	type SimConfig,
} from "shared/sim";

const TARGET = 1000;
const WARMUP_TICKS = 900;
const MEASURE_TICKS = 600;
/** Generous on purpose (shared CI machines); the printed mean is the number to watch. */
const BUDGET_MS_PER_TICK = 2;

const GRID = 32;
const HALF = GRID / 2;
const ROOM = 12; // walls outside |x|, |z| <= 12
const solid: boolean[] = [];
for (let gy = 0; gy < GRID; gy++)
	for (let gx = 0; gx < GRID; gx++) solid.push(math.abs(gx - HALF) > ROOM || math.abs(gy - HALF) > ROOM);

const blocked = (x: number, z: number): boolean => {
	const gx = math.floor(x + 0.5) + HALF;
	const gy = math.floor(z + 0.5) + HALF;
	if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return true;
	return solid[gy * GRID + gx];
};

function percentile(sorted: number[], p: number): number {
	return sorted[math.min(sorted.size() - 1, math.floor(sorted.size() * p))];
}

describe("step() stress benchmark", () => {
	it(`steps ~${TARGET} live enemy bullets well under ${BUDGET_MS_PER_TICK} ms per tick`, () => {
		const config: SimConfig = {
			bounds: DEFAULT_BOUNDS,
			isBulletBlocked: blocked,
			stress: { bullets: TARGET, x: 0, z: 0 },
			loadout: ["weapon.bow", "weapon.sword"],
		};
		const s = createSimState(1337, 0, 0, config);
		// The player stands in the stress rings (they deal no damage) and streams arrows the whole time.
		const input = { ...EMPTY_INPUT, aimX: -1000, buttons: Button.FIRE };
		for (let i = 0; i < WARMUP_TICKS; i++) step(s, input, config);
		expect(s.combat.enemyBullets.activeCount).toBeGreaterThan(TARGET * 0.9);

		// Time the enemy pool's own work inside the real step(): wrap its step / forEachActive (method calls, `:`).
		const pool = s.combat.enemyBullets as unknown as Record<string, (...args: unknown[]) => unknown>;
		let poolTime = 0;
		for (const m of ["step", "forEachActive"]) {
			const original = pool[m];
			pool[m] = (...args: unknown[]) => {
				const t0 = os.clock();
				const r = original(...args);
				poolTime += os.clock() - t0;
				return r;
			};
		}

		const times: number[] = [];
		let minLive = math.huge;
		let sumLive = 0;
		for (let i = 0; i < MEASURE_TICKS; i++) {
			const t0 = os.clock();
			step(s, input, config);
			times.push(os.clock() - t0);
			const n = s.combat.enemyBullets.activeCount;
			minLive = math.min(minLive, n);
			sumLive += n;
		}

		const mean = times.reduce((a, b) => a + b, 0) / times.size();
		const poolMean = poolTime / MEASURE_TICKS;
		times.sort();
		const avgLive = sumLive / MEASURE_TICKS;
		print(
			string.format(
				"[bench] step() with %d live enemy bullets (min %d), %d player bullets: mean %.1f us, p50 %.1f us, " +
					"p99 %.1f us per tick (%.0f ns per bullet); of which enemy pool step() + collision walk (callbacks included) %.1f us",
				math.round(avgLive),
				minLive,
				s.combat.playerBullets.activeCount,
				mean * 1e6,
				percentile(times, 0.5) * 1e6,
				percentile(times, 0.99) * 1e6,
				(mean / avgLive) * 1e9,
				poolMean * 1e6,
			),
		);
		expect(minLive).toBeGreaterThanOrEqual(TARGET * 0.9);
		expect(s.combat.dropped).toBe(0);
		expect(mean * 1000).toBeLessThan(BUDGET_MS_PER_TICK);
	});

	it(`steps ~${TARGET} live enemy bullets in the seed-1337 dungeon with its encounter under ${BUDGET_MS_PER_TICK} ms per tick`, () => {
		const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
		const spawn = entranceSpawn(d);
		const config: SimConfig = {
			moveResolver: circleMover(d, PLAYER_RADIUS),
			isBulletBlocked: bulletBlocker(d),
			actorMover: actorMover(d),
			encounter: placeEncounter(d, DEFAULT_ENCOUNTER),
			stress: { bullets: TARGET, x: spawn.x, z: spawn.z },
		};
		const s = createSimState(1337, spawn.x, spawn.z, config);
		const input = { ...EMPTY_INPUT, aimX: -1000, buttons: Button.FIRE };
		for (let i = 0; i < WARMUP_TICKS; i++) step(s, input, config);
		expect(s.combat.enemyBullets.activeCount).toBeGreaterThan(TARGET * 0.9);
		expect(countActors(s.combat).present).toBeGreaterThan(0);

		const times: number[] = [];
		let minLive = math.huge;
		let sumLive = 0;
		for (let i = 0; i < MEASURE_TICKS; i++) {
			const t0 = os.clock();
			step(s, input, config);
			times.push(os.clock() - t0);
			const n = s.combat.enemyBullets.activeCount;
			minLive = math.min(minLive, n);
			sumLive += n;
		}
		const mean = times.reduce((a, b) => a + b, 0) / times.size();
		times.sort();
		const avgLive = sumLive / MEASURE_TICKS;
		print(
			string.format(
				"[bench] dungeon + %d actors: step() with %d live enemy bullets (min %d): mean %.1f us, p50 %.1f us, " +
					"p99 %.1f us per tick",
				countActors(s.combat).present,
				math.round(avgLive),
				minLive,
				mean * 1e6,
				percentile(times, 0.5) * 1e6,
				percentile(times, 0.99) * 1e6,
			),
		);
		expect(minLive).toBeGreaterThanOrEqual(TARGET * 0.9);
		expect(s.combat.dropped).toBe(0);
		expect(mean * 1000).toBeLessThan(BUDGET_MS_PER_TICK);
	});
});
