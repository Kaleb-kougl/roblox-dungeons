// The run-over recap's tally (docs/RUN_RECAP.md RR1):
//   - hand-filled ScoreEvents arrays (as GP1 pushes them): one guard erasing 5 bullets = 1 parry, two guards = 2, the
//     guard window's edge, per player, outside-party records ignored, grazes per player, reset, unscored runs
//   - the same grouping as the NearMissDirector's parry cues (one cue per group) over the same ticks
//   - the run views' wiring: LiveRun and LockstepClient collect every tick and never reset per frame (solo grazes =
//     counts[GRAZES])
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessRunConfig, buildRunConfig } from "shared/run";
import { defaultJuiceSettings } from "shared/settings";
import {
	EMPTY_INPUT,
	SWORD_DATA,
	ScoreSource,
	clearScoreEvents,
	createSimState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { LiveRun } from "shared/play";
import { LockstepClient, MergedEncoder } from "shared/lockstep";
import { NearMissEvents } from "./nearMissEvents";
import { NearMissDirector } from "./nearMissRules";
import { NO_RECAP_TALLY, RecapTally } from "./recapTally";

const SEED = 1337;

function scoredState(partySize = 1): SimState {
	const setup = buildRunConfig(SEED, { scoring: {}, partySize });
	return createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
}

/** One tick by hand: the score events clear, these grazers / guards are pushed (one entry per bullet), tick += 1. */
function tickWith(state: SimState, grazers: ReadonlyArray<number>, guards: ReadonlyArray<number>): void {
	const s = state.score!;
	clearScoreEvents(s);
	const e = s.events;
	for (const p of grazers) {
		e.grazeX.push(1);
		e.grazeZ.push(1);
		e.grazeVX.push(1);
		e.grazeVZ.push(0);
		e.grazePlayer.push(p);
	}
	e.grazes = grazers.size();
	for (const p of guards) {
		e.guardX.push(2);
		e.guardZ.push(0);
		e.guardPlayer.push(p);
	}
	e.guardCancels = guards.size();
	state.tick += 1;
}

/** `ticks` empty ticks (each collected). */
function idle(state: SimState, tally: RecapTally, ticks: number): void {
	for (let i = 0; i < ticks; i++) {
		tickWith(state, [], []);
		tally.collect(state);
	}
}

describe("RecapTally", () => {
	it("one guard erasing 5 bullets over several ticks is 1 parry; a second guard makes 2", () => {
		const state = scoredState();
		const t = new RecapTally();
		tickWith(state, [], [0, 0, 0]);
		t.collect(state);
		idle(state, t, 3);
		tickWith(state, [], [0, 0]);
		t.collect(state);
		expect(t.parriesOf(0)).toBe(1);
		idle(state, t, SWORD_DATA.guardTicks);
		tickWith(state, [], [0]);
		t.collect(state);
		expect(t.parriesOf(0)).toBe(2);
		expect(t.parries).toEqual([2]);
	});

	it("the guard window's edge: guardTicks - 1 after the first erase is the same guard, guardTicks a new one", () => {
		const state = scoredState();
		const t = new RecapTally();
		tickWith(state, [], [0]);
		t.collect(state);
		idle(state, t, SWORD_DATA.guardTicks - 2);
		tickWith(state, [], [0]); // first + guardTicks - 1
		t.collect(state);
		expect(t.parriesOf(0)).toBe(1);
		tickWith(state, [], [0]); // first + guardTicks
		t.collect(state);
		expect(t.parriesOf(0)).toBe(2);
	});

	it("counts per player; records outside the party are ignored; grazes per grazer", () => {
		const state = scoredState(2);
		const t = new RecapTally();
		tickWith(state, [0, 1, 1, 2, -1], [1, 1, 0, 2, -1]);
		t.collect(state);
		idle(state, t, SWORD_DATA.guardTicks);
		tickWith(state, [1], [1]);
		t.collect(state);
		expect(t.parries).toEqual([1, 2]);
		expect(t.grazes).toEqual([1, 3]);
		expect([t.parriesOf(5), t.grazesOf(5)]).toEqual([0, 0]);
	});

	it("reset starts over; an unscored state collects nothing", () => {
		const state = scoredState();
		const t = new RecapTally();
		tickWith(state, [0], [0]);
		t.collect(state);
		t.reset();
		expect([t.parries.size(), t.grazes.size()]).toEqual([0, 0]);
		// A new group right after the reset, even within the old window.
		tickWith(state, [], [0]);
		t.collect(state);
		expect(t.parriesOf(0)).toBe(1);
		const setup = buildRunConfig(SEED);
		const unscored = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		const u = new RecapTally();
		u.collect(unscored);
		expect(u.parries.size()).toBe(0);
		expect(NO_RECAP_TALLY.parries.size()).toBe(0);
	});

	it("groups exactly as the NearMissDirector's parry cues (one cue per group) over the same ticks", () => {
		const state = scoredState(2);
		const t = new RecapTally();
		const ev = new NearMissEvents();
		const d = new NearMissDirector();
		const settings = defaultJuiceSettings();
		const cues = [0, 0];
		// Erase pattern per tick (player list): bursts, gaps at and around the guard window, both players.
		const pattern: number[][] = [];
		for (let k = 0; k < 120; k++) {
			const guards: number[] = [];
			if (k % 7 === 0 || k % 23 === 1) guards.push(0);
			if (k % 11 === 3 || k % 18 === 0) guards.push(1, 1);
			pattern.push(guards);
		}
		let clock = 0;
		for (let k = 0; k < pattern.size(); k++) {
			ev.reset();
			tickWith(state, [], pattern[k]);
			ev.collect(state);
			t.collect(state);
			clock += 1 / 60;
			const out = d.frame(ev, state, 0, false, settings, clock);
			for (const c of out.parryCues) cues[c.player] += 1;
		}
		expect(cues[0] > 1 && cues[1] > 1).toBe(true);
		expect(t.parries).toEqual(cues);
	});
});

describe("RunView.recapTally wiring", () => {
	it("LiveRun collects every tick and never resets per frame (solo grazes = counts[GRAZES])", () => {
		const setup = buildRunConfig(SEED, { scoring: {} });
		let guards = 0;
		const run = new LiveRun({
			seed: SEED,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
			runId: "recap-tally",
			segmentCutAfterTick: (s) => {
				guards += s.score!.events.guardPlayer.size();
				return false;
			},
		});
		const input: InputFrame = { ...EMPTY_INPUT, moveX: 600 };
		for (let n = 0; n < 240; n++) run.frame(1 / 60, input);
		expect(run.recapTally.grazesOf(0)).toBe(run.state.score!.counts[ScoreSource.GRAZES]);
		// Never more parries than erased bullets, and a parry for any erase.
		expect(run.recapTally.parriesOf(0) <= guards).toBe(true);
		expect(run.recapTally.parriesOf(0) > 0).toBe(guards > 0);
	});

	it("LockstepClient collects every pumped tick (team grazes = counts[GRAZES])", () => {
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
		for (let k = 0; k < 20 && c.backlog() > 0; k++) c.pump(1 / 60, () => EMPTY_INPUT);
		expect(c.state.tick > 0).toBe(true);
		expect(c.recapTally.grazesOf(0) + c.recapTally.grazesOf(1)).toBe(c.state.score!.counts[ScoreSource.GRAZES]);
	});
});
