/**
 * docs/LOCAL_PREDICTION.md LP10: enemy bullets drawn ahead (bulletAhead.ts) against the real sim.
 *
 * Real endless floors (god mode, the party in its busiest room, enemies firing): every HORIZON ticks, each live enemy
 * bullet's pose 1..HORIZON ticks ahead is taken from the merged state, then the state is stepped and the pose compared
 * with the bullet's (prev, cur) at that tick. A bullet the sim still has must match to 1e-9 (the replay is the sim's own
 * arithmetic: the largest difference is printed); one the sim consumed at a wall or a piece must have been drawn stopped
 * at its last free position; one whose life ran out, hidden. The Hourglass runs in a third of the windows. A pool of its
 * own covers the spawn delay, the life and the culling cube; n = 0 is today's pair exactly; a bench at 150 bullets.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BulletKind,
	BulletPayload,
	DEFAULT_SIM_CONFIG,
	SIM_DT,
	createBulletSimulation,
	createSimState,
	packPayload,
	simWorldConfig,
	step,
	type BulletSimulation,
	type BulletSpawnData,
	type SimConfig,
	type SimState,
	type Vec3,
} from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { busiestRoom, denseFighterFrame, placeParty, skipPartyToFloor } from "shared/run/testing";
import { BulletAhead, newAheadPose, type AheadPose } from ".";

const HORIZON = 10;
const WARMUP_TICKS = 120;
const WINDOWS = 40;
const CASES: ReadonlyArray<readonly [number, number]> = [
	[1, 3],
	[2, 6],
	[3, 9],
	[4, 4],
	[5, 8],
	[6, 12],
];
/** Hourglass ticks set at a window's start, by window index mod 3 (0: none; 4: ends inside the window; 15: all of it). */
const HOURGLASS = [0, 4, 15];
const TOLERANCE = 1e-9;
/** The floors must give at least this many poses to compare. */
const MIN_COMPARED = 1000;

interface Sample {
	live: boolean;
	payload: number;
	life: number;
	vx: number;
	vz: number;
	x: number;
	y: number;
	z: number;
	px: number;
	py: number;
	pz: number;
}

function sample(sim: BulletSimulation, i: number, prev: Vec3): Sample {
	const live = sim.isLive(i);
	const p = sim.positionAt(i);
	const v = sim.velocityAt(i);
	sim.previousPositionAt(i, prev);
	return {
		live,
		payload: sim.payloadAt(i),
		life: sim.lifeAt(i),
		vx: v.x,
		vz: v.z,
		x: p.x,
		y: p.y,
		z: p.z,
		px: prev.x,
		py: prev.y,
		pz: prev.z,
	};
}

/** Still the same bullet (its payload may change: the graze flags; a reused slot has a new life and velocity). */
function sameBullet(a: Sample, b: Sample): boolean {
	return b.live && a.vx === b.vx && a.vz === b.vz && b.life < a.life;
}

function diff(pose: AheadPose, s: Sample): number {
	return math.max(
		math.abs(pose.x - s.x),
		math.abs(pose.y - s.y),
		math.abs(pose.z - s.z),
		math.abs(pose.prevX - s.px),
		math.abs(pose.prevY - s.py),
		math.abs(pose.prevZ - s.pz),
	);
}

interface Tally {
	flying: number;
	stopped: number;
	expired: number;
	otherRemoved: number;
	maxDiff: number;
	failures: string[];
}

function fail(t: Tally, msg: string): void {
	if (t.failures.size() < 8) t.failures.push(msg);
}

function prepareFloor(seed: number, floor: number): { s: SimState; config: Readonly<SimConfig> } {
	const setup = buildEndlessRunConfig(seed, 1);
	const config: SimConfig = { ...setup.config, dev: { invulnerable: true } };
	const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, config);
	skipPartyToFloor(s, config, floor);
	const room = busiestRoom(setup, floor);
	const first = setup.endlessFloor(floor).roomSpawns[room][0];
	placeParty(s, first.x, first.z);
	for (let k = 0; k < WARMUP_TICKS; k++) step(s, denseFighterFrame(s, 0), config);
	return { s, config };
}

function runFloor(seed: number, floor: number, t: Tally): void {
	const { s, config } = prepareFloor(seed, floor);
	const ahead = new BulletAhead();
	const prev: Vec3 = { x: 0, y: 0, z: 0 };
	for (let w = 0; w < WINDOWS; w++) {
		const me = s.run!.players[0];
		me.hourglassTicks = HOURGLASS[w % HOURGLASS.size()];
		const sim = s.combat.enemyBullets;
		const world = simWorldConfig(s, config);
		const hw = sim.highWater();
		// poses[n - 1][i]: slot i, n ticks ahead (false: hidden).
		const poses: Array<Array<AheadPose | false>> = [];
		const visible: boolean[] = [];
		for (let i = 0; i < hw; i++) {
			const kind = sim.isLive(i) ? BulletPayload.get(sim.payloadAt(i), "kind") : -1;
			visible.push(sim.isVisible(i) && kind !== BulletKind.GOO && kind !== BulletKind.STRIKE);
		}
		for (let n = 1; n <= HORIZON; n++) {
			ahead.prepare(s, world, n);
			const row: Array<AheadPose | false> = [];
			for (let i = 0; i < hw; i++) {
				if (!visible[i]) {
					row.push(false);
					continue;
				}
				const out = newAheadPose();
				row.push(ahead.pose(sim, i, out) ? out : false);
			}
			poses.push(row);
		}
		// The bullets' samples at the window's start and after each tick.
		const samples: Sample[][] = [];
		const row0: Sample[] = [];
		for (let i = 0; i < hw; i++) row0.push(sample(sim, i, prev));
		samples.push(row0);
		for (let k = 1; k <= HORIZON; k++) {
			step(s, denseFighterFrame(s, 0), config);
			const row: Sample[] = [];
			for (let i = 0; i < hw; i++) row.push(sample(s.combat.enemyBullets, i, prev));
			samples.push(row);
		}
		for (let i = 0; i < hw; i++) {
			if (!visible[i]) continue;
			// The first tick the bullet is gone (released, or its slot reused): HORIZON + 1 if it lasts the window.
			let gone = HORIZON + 1;
			for (let k = 1; k <= HORIZON; k++) {
				if (!sameBullet(samples[k - 1][i], samples[k][i])) {
					gone = k;
					break;
				}
			}
			for (let n = 1; n <= HORIZON; n++) {
				const pose = poses[n - 1][i];
				const label = `seed ${seed} floor ${floor} window ${w} slot ${i} n ${n}`;
				if (n < gone) {
					if (pose === false) fail(t, `${label}: hidden, but the sim still has it`);
					else {
						const d = diff(pose, samples[n][i]);
						if (d > t.maxDiff) t.maxDiff = d;
						if (d > TOLERANCE) fail(t, `${label}: off by ${d}`);
						t.flying++;
					}
					continue;
				}
				// Gone at tick `gone` <= n: stopped at its last free position, hidden (life), or removed otherwise.
				const last = samples[gone - 1][i];
				if (pose === false) {
					t.expired++;
					continue;
				}
				const stoppedHere = pose.x === pose.prevX && pose.z === pose.prevZ;
				const atLast =
					math.abs(pose.x - last.x) <= TOLERANCE &&
					math.abs(pose.y - last.y) <= TOLERANCE &&
					math.abs(pose.z - last.z) <= TOLERANCE;
				if (stoppedHere && atLast) t.stopped++;
				else t.otherRemoved++;
			}
		}
	}
}

describe("BulletAhead (docs/LOCAL_PREDICTION.md LP10)", () => {
	it("draws every enemy bullet where the sim has it n ticks later, on real endless floors (with the Hourglass)", () => {
		const t: Tally = { flying: 0, stopped: 0, expired: 0, otherRemoved: 0, maxDiff: 0, failures: [] };
		for (const [seed, floor] of CASES) runFloor(seed, floor, t);
		print(
			`[bulletAhead] ${t.flying} poses compared (max diff ${t.maxDiff}), ${t.stopped} stopped at a wall / piece, ` +
				`${t.expired} hidden, ${t.otherRemoved} removed otherwise (a hit, an overlap)`,
		);
		expect(t.failures).toEqual([]);
		expect(t.flying).toBeGreaterThan(MIN_COMPARED);
		expect(t.stopped).toBeGreaterThan(0);
		expect(t.maxDiff).toBeLessThanOrEqual(TOLERANCE);
	});

	it("covers the spawn delay, the life and the culling cube (a pool of its own); n = 0 is today's pair", () => {
		const state = createSimState(1, 0, 0, DEFAULT_SIM_CONFIG);
		const world: SimConfig = {};
		const make = () => createBulletSimulation({ maxBullets: 64, boundsLimit: 3, interpolation: true });
		const fire = (sim: BulletSimulation) =>
			sim.fireAt({ x: 0, y: 0, z: 0 }, () => {
				const out: BulletSpawnData[] = [];
				for (let k = 0; k < 24; k++) {
					out.push({
						offset: { x: (k % 5) * 0.3, y: 0, z: (k % 3) * 0.2 },
						velocity: { x: 3 + k * 0.7, y: 0, z: -2 + k * 0.3 },
						acceleration: { x: 0, y: 0, z: 0 },
						delay: (k % 4) * 0.04,
						color: undefined,
						life: 0.05 + (k % 6) * 0.06,
						payload: packPayload(1, BulletKind.SPRAYER, 1),
						scale: 1,
					});
				}
				return out;
			});
		const truth = make();
		const drawn = make();
		fire(truth);
		fire(drawn);
		const ahead = new BulletAhead();
		const prev: Vec3 = { x: 0, y: 0, z: 0 };
		// n = 0: today's pair for every visible slot.
		ahead.prepare(state, world, 0);
		for (let i = 0; i < drawn.highWater(); i++) {
			if (!drawn.isVisible(i)) continue;
			const out = newAheadPose();
			expect(ahead.pose(drawn, i, out)).toBe(true);
			drawn.previousPositionAt(i, prev);
			expect([out.x, out.z, out.prevX, out.prevZ]).toEqual([
				drawn.positionAt(i).x,
				drawn.positionAt(i).z,
				prev.x,
				prev.z,
			]);
		}
		let compared = 0;
		let hidden = 0;
		let delayed = 0;
		for (let n = 1; n <= HORIZON; n++) {
			truth.step(SIM_DT);
			ahead.prepare(state, world, n);
			for (let i = 0; i < drawn.highWater(); i++) {
				if (!drawn.isLive(i)) continue;
				const out = newAheadPose();
				const shown = ahead.pose(drawn, i, out);
				if (drawn.delayAt(i) > 0) delayed++;
				expect(shown).toBe(truth.isVisible(i));
				if (!shown) {
					hidden++;
					continue;
				}
				truth.previousPositionAt(i, prev);
				const d = math.max(
					math.abs(out.x - truth.positionAt(i).x),
					math.abs(out.z - truth.positionAt(i).z),
					math.abs(out.prevX - prev.x),
					math.abs(out.prevZ - prev.z),
				);
				expect(d).toBeLessThanOrEqual(TOLERANCE);
				compared++;
			}
		}
		print(
			`[bulletAhead] own pool: ${compared} exact, ${hidden} hidden (life, cube, still delayed), ${delayed} delayed`,
		);
		expect(compared).toBeGreaterThan(0);
		expect(hidden).toBeGreaterThan(0);
		expect(delayed).toBeGreaterThan(0);
	});

	it("bench: 150 bullets drawn 10 ticks ahead on a real floor's blocker", () => {
		const { s, config } = prepareFloor(1, 3);
		const world = simWorldConfig(s, config);
		const sim = createBulletSimulation({ maxBullets: 256, boundsLimit: math.huge, interpolation: true });
		const p = s.player;
		sim.fireAt({ x: p.x, y: 0, z: p.z }, () => {
			const out: BulletSpawnData[] = [];
			for (let k = 0; k < 150; k++) {
				out.push({
					offset: { x: 0, y: 0, z: 0 },
					velocity: { x: math.cos(k) * 4, y: 0, z: math.sin(k) * 4 },
					acceleration: { x: 0, y: 0, z: 0 },
					delay: 0,
					color: undefined,
					life: 5,
					payload: packPayload(1, BulletKind.SPRAYER, 1),
					scale: 1,
				});
			}
			return out;
		});
		const ahead = new BulletAhead();
		const out = newAheadPose();
		const frames = 500;
		const bench = (w: Readonly<SimConfig>, n: number): number => {
			const t0 = os.clock();
			for (let f = 0; f < frames; f++) {
				ahead.prepare(s, w, n);
				for (let i = 0; i < sim.highWater(); i++) if (sim.isLive(i)) ahead.pose(sim, i, out);
			}
			return ((os.clock() - t0) * 1000) / frames;
		};
		const today = bench(world, 0);
		const open = bench({}, HORIZON);
		const ms = bench(world, HORIZON);
		print(
			`[bulletAhead] bench, 150 bullets a frame (headless): ${string.format(
				"%.4f",
				ms,
			)} ms at ${HORIZON} ticks ` +
				`on the floor's blocker; ${string.format("%.4f", open)} ms with no blocker; ${string.format(
					"%.4f",
					today,
				)} ms for today's pairs (n = 0)`,
		);
		expect(sim.activeCount).toBe(150);
	});
});
