// The grazes / guard erases collector (docs/GRAZE_PARRY.md GP2):
//   - hand-filled ScoreEvents arrays (the sim's GP1 pushes are written in parallel): a frame of several ticks keeps
//     every record in order with its tick; reset forgets them and reuses the records; unscored states collect nothing
//   - the run views' wiring: LiveRun (scored M1, several ticks per frame) collects every tick exactly once and resets
//     per frame, matching each tick's ScoreEvents arrays; LockstepClient collects every pumped tick
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessRunConfig, buildRunConfig } from "shared/run";
import { EMPTY_INPUT, clearScoreEvents, createSimState, type InputFrame, type SimState } from "shared/sim";
import { LiveRun } from "shared/play";
import { LockstepClient, MergedEncoder } from "shared/lockstep";
import { NO_NEAR_MISS_EVENTS, NearMissEvents } from "./nearMissEvents";

const SEED = 1337;

function scoredState(partySize = 1): SimState {
	const setup = buildRunConfig(SEED, { scoring: {}, partySize });
	return createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
}

interface Graze {
	x: number;
	z: number;
	vx: number;
	vz: number;
	p: number;
}
interface Erase {
	x: number;
	z: number;
	p: number;
}

/** One tick by hand: the score events clear, these grazes / erases are pushed (as GP1 does), tick += 1. */
function tickWith(state: SimState, grazes: ReadonlyArray<Graze>, erases: ReadonlyArray<Erase>): void {
	const s = state.score!;
	clearScoreEvents(s);
	const e = s.events;
	for (const g of grazes) {
		e.grazeX.push(g.x);
		e.grazeZ.push(g.z);
		e.grazeVX.push(g.vx);
		e.grazeVZ.push(g.vz);
		e.grazePlayer.push(g.p);
	}
	e.grazes = grazes.size();
	for (const c of erases) {
		e.guardX.push(c.x);
		e.guardZ.push(c.z);
		e.guardPlayer.push(c.p);
	}
	e.guardCancels = erases.size();
	state.tick += 1;
}

describe("NearMissEvents", () => {
	it("keeps every graze and erase of a multi-tick frame, in order, with its tick", () => {
		const state = scoredState(2);
		const ev = new NearMissEvents();
		ev.reset();
		const t0 = state.tick;
		tickWith(
			state,
			[
				{ x: 1, z: 2, vx: 3, vz: 4, p: 0 },
				{ x: 5, z: 6, vx: 7, vz: 8, p: 1 },
			],
			[{ x: 9, z: 10, p: 1 }],
		);
		ev.collect(state);
		tickWith(state, [], []);
		ev.collect(state);
		tickWith(
			state,
			[{ x: -1, z: -2, vx: -3, vz: -4, p: 1 }],
			[
				{ x: 11, z: 12, p: 0 },
				{ x: 13, z: 14, p: 0 },
			],
		);
		ev.collect(state);

		expect(ev.ticks).toBe(3);
		expect(ev.grazes.map((g) => [g.x, g.z, g.vx, g.vz, g.player, g.tick - t0])).toEqual([
			[1, 2, 3, 4, 0, 1],
			[5, 6, 7, 8, 1, 1],
			[-1, -2, -3, -4, 1, 3],
		]);
		expect(ev.erases.map((c) => [c.x, c.z, c.player, c.tick - t0])).toEqual([
			[9, 10, 1, 1],
			[11, 12, 0, 3],
			[13, 14, 0, 3],
		]);
	});

	it("reset forgets the last frame and reuses its records (no allocation in steady state)", () => {
		const state = scoredState();
		const ev = new NearMissEvents();
		ev.reset();
		tickWith(state, [{ x: 1, z: 1, vx: 1, vz: 0, p: 0 }], [{ x: 2, z: 2, p: 0 }]);
		ev.collect(state);
		const g0 = ev.grazes[0];
		const c0 = ev.erases[0];

		ev.reset();
		expect(ev.ticks).toBe(0);
		expect(ev.grazes.size()).toBe(0);
		expect(ev.erases.size()).toBe(0);

		tickWith(state, [{ x: 7, z: 8, vx: 0, vz: 1, p: 0 }], [{ x: 9, z: 9, p: 0 }]);
		ev.collect(state);
		expect(ev.grazes[0]).toBe(g0);
		expect(ev.erases[0]).toBe(c0);
		expect([g0.x, g0.z, g0.vx, g0.vz]).toEqual([7, 8, 0, 1]);
		expect([c0.x, c0.z]).toEqual([9, 9]);
	});

	it("collects nothing from an unscored run (unscored M1, GPD2)", () => {
		const setup = buildRunConfig(SEED, {});
		const state = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		expect(state.score).toBe(undefined);
		const ev = new NearMissEvents();
		ev.reset();
		state.tick += 1;
		ev.collect(state);
		expect(ev.ticks).toBe(0);
		expect(ev.grazes.size()).toBe(0);
		expect(ev.erases.size()).toBe(0);
	});

	it("NO_NEAR_MISS_EVENTS is empty", () => {
		expect(NO_NEAR_MISS_EVENTS.ticks).toBe(0);
		expect(NO_NEAR_MISS_EVENTS.grazes.size()).toBe(0);
		expect(NO_NEAR_MISS_EVENTS.erases.size()).toBe(0);
	});
});

describe("RunView.nearMiss wiring", () => {
	it("LiveRun collects every tick of a frame once, matching each tick's ScoreEvents, and resets per frame", () => {
		const setup = buildRunConfig(SEED, { scoring: {} });
		let grazes = 0;
		let erases = 0;
		const run = new LiveRun({
			seed: SEED,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
			runId: "near-miss",
			// Called after every tick, after the run's collectors: what that tick's arrays held.
			segmentCutAfterTick: (s) => {
				grazes += s.score!.events.grazeX.size();
				erases += s.score!.events.guardX.size();
				return false;
			},
		});
		const input: InputFrame = { ...EMPTY_INPUT, moveX: 600 };
		const deltas = [1 / 60, 3 / 60, 0, 5 / 60, 2 / 60];
		let collected = 0;
		for (let n = 0; n < 60; n++) {
			grazes = 0;
			erases = 0;
			const ticks = run.frame(deltas[n % deltas.size()], input);
			expect(run.nearMiss.ticks).toBe(ticks);
			expect(run.nearMiss.grazes.size()).toBe(grazes);
			expect(run.nearMiss.erases.size()).toBe(erases);
			collected += run.nearMiss.ticks;
		}
		expect(collected).toBe(run.state.tick);
	});

	it("LockstepClient collects every tick a pump steps and resets per pump", () => {
		const setup = buildEndlessRunConfig(31337, 2);
		const c = new LockstepClient({
			runId: "coop",
			seed: 31337,
			spawn: setup.spawn!,
			config: setup.config,
			players: 2,
			localIndex: 0,
		});
		const enc = new MergedEncoder(2);
		const frames: InputFrame[][] = [];
		for (let t = 0; t < 12; t++) frames.push([{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }]);
		expect(c.receive(0, enc.encode(frames))).toBe(true);
		let total = 0;
		for (let k = 0; k < 20 && c.backlog() > 0; k++) {
			const r = c.pump(1 / 60, () => EMPTY_INPUT);
			expect(c.nearMiss.ticks).toBe(r.stepped);
			total += r.stepped;
		}
		expect(total).toBe(c.state.tick);
		expect(total > 0).toBe(true);
		const r = c.pump(1 / 60, () => EMPTY_INPUT);
		expect(r.stepped).toBe(0);
		expect(c.nearMiss.ticks).toBe(0);
	});
});
