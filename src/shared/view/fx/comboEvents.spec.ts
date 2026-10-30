// The combo collector (docs/COMBO.md CB1):
//   - real scored M1 states (seed 1337, KV_Scoring's config) stepped through the real score pipeline by hand: a kill
//     (scoreKill), the hit cut (events.playerHits -> stepScore, solo and a party of 3), the timer running out
//     (stepScore) in a live room, after a clear, with the boss awake or dormant
//   - small hand-built score states where exact tick shapes are clearer: two feeds on one tick, a frame of several
//     ticks, grazes, the streak peak across frames, a silent run-out at x1.0
//   - the recorded seed-1337 endless descent replayed at 1-5 ticks per frame: the frame sums equal the ticks' events,
//     frames chain, every streak end matches comboBroken and fightOn; an open boon draft never ends a streak
//   - an unscored run collects nothing
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildRunConfig } from "shared/run";
import { recordEndlessRun } from "shared/run/testing";
import {
	COMBO_MIN,
	EMPTY_INPUT,
	NO_KIND,
	archetypeAt,
	clearScoreEvents,
	createSimState,
	isDraftOpen,
	scoreKill,
	step,
	stepRecorded,
	stepScore,
	type ActorState,
	type SimState,
} from "shared/sim";
import { fightOn } from "../roomEdgeState";
import { ComboEvents, NO_COMBO_EVENTS } from "./comboEvents";

const SEED = 1337;

// ---------------------------------------------------------------------------------------------
// Real states, ticked by hand through the real score pipeline

/** A fresh scored M1 state (party of `partySize`: the co-op combo cut). */
function scoredM1(partySize = 1): SimState {
	const setup = buildRunConfig(SEED, { scoring: {}, partySize });
	return createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
}

/** A living room enemy that scores like a plain kill (no reviver, not the boss). */
function plainEnemy(state: Readonly<SimState>): ActorState {
	for (const a of state.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const def = archetypeAt(a.kind);
		if (def.data.boss !== true && def.stepDead === undefined) return a;
	}
	error("no plain enemy", 0);
}

function bossOf(state: Readonly<SimState>): ActorState {
	for (const a of state.combat.actors) if (a.kind !== NO_KIND && archetypeAt(a.kind).data.boss === true) return a;
	error("no boss", 0);
}

/**
 * One tick by hand, in step()'s score order: the score events clear, `kills` kills score (scoreKill, which feeds the
 * combo as stepCombat's kills do), `hits` landed hits reach stepScore (the cuts, the timer, the rooms), tick += 1. The
 * world itself never moves, so the rooms and the boss stay as the spec sets them.
 */
function tickByHand(state: SimState, kills = 0, hits = 0): void {
	const s = state.score!;
	clearScoreEvents(s);
	state.events.playerHits = hits;
	state.events.bossPhase = 0;
	const victim = plainEnemy(state);
	for (let k = 0; k < kills; k++) scoreKill(state, victim);
	stepScore(state);
	state.events.playerHits = 0;
	state.tick += 1;
}

/** A frame of the run view: reset, then collect after each tick. */
function frameOf(ev: ComboEvents, state: SimState, ticks: ReadonlyArray<[number, number]>): void {
	ev.reset();
	for (const [kills, hits] of ticks) {
		tickByHand(state, kills, hits);
		ev.collect(state);
	}
}

/** Raises the combo to `tenths` with kills, one per tick, in one frame. */
function climb(ev: ComboEvents, state: SimState, tenths: number): void {
	const ticks: Array<[number, number]> = [];
	for (let c = state.score!.combo; c < tenths; c++) ticks.push([1, 0]);
	frameOf(ev, state, ticks);
	expect(state.score!.combo).toBe(tenths);
}

/** Lets the combo timer run out: one tick with the timer at 1 (no kill). */
function runOut(ev: ComboEvents, state: SimState): void {
	state.score!.comboTimer = 1;
	frameOf(ev, state, [[0, 0]]);
}

describe("ComboEvents: real score states", () => {
	it("a kill: one tick, one kill, the combo up a step", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		frameOf(ev, state, [[1, 0]]);
		expect([ev.ticks, ev.startCombo, ev.endCombo, ev.peak, ev.kills, ev.grazes]).toEqual([1, 10, 11, 11, 1, 0]);
		expect(ev.cuts.size()).toBe(0);
		expect(ev.ended).toBe(undefined);
	});

	it("two kills on one tick: kills 2, one feed tick (comboFed 1), +0.2", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		frameOf(ev, state, [[2, 0]]);
		expect(state.score!.events.comboFed).toBe(1);
		expect([ev.ticks, ev.startCombo, ev.endCombo, ev.peak, ev.kills]).toEqual([1, 10, 12, 12, 2]);
	});

	it("a frame of several ticks: start before the first, end after the last, peak at a tick end", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		climb(ev, state, 30);
		frameOf(ev, state, [
			[1, 0],
			[2, 0],
			[0, 1],
			[1, 0],
		]);
		expect([ev.ticks, ev.startCombo, ev.peak, ev.endCombo, ev.kills]).toEqual([4, 30, 33, 17, 4]);
		expect(ev.cuts).toEqual([{ before: 33, after: 16 }]);
	});

	it("a hit cut: before / after, solo halves; a party of 3 takes a third", () => {
		const solo = scoredM1();
		const a = new ComboEvents();
		climb(a, solo, 30);
		frameOf(a, solo, [[0, 1]]);
		expect(a.cuts).toEqual([{ before: 30, after: 15 }]);
		expect([a.startCombo, a.endCombo, a.peak]).toEqual([30, 15, 30]);

		const party = scoredM1(3);
		expect(party.score!.partySize).toBe(3);
		const b = new ComboEvents();
		climb(b, party, 30);
		frameOf(b, party, [[0, 1]]);
		expect(b.cuts).toEqual([{ before: 30, after: 20 }]);
	});

	it("two hits on one tick make one cut; a kill and a hit on one tick: the cut starts from the tick's start", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		climb(ev, state, 40);
		frameOf(ev, state, [[0, 2]]);
		expect(ev.cuts).toEqual([{ before: 40, after: 10 }]);
		climb(ev, state, 20);
		frameOf(ev, state, [[1, 1]]);
		expect(ev.cuts).toEqual([{ before: 20, after: 10 }]);
	});

	it("a hit at x1.0 records no cut (the sim counts comboCut, the combo stays at COMBO_MIN)", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		frameOf(ev, state, [[0, 1]]);
		expect(state.score!.events.comboCut > 0).toBe(true);
		expect(state.score!.combo).toBe(COMBO_MIN);
		expect(ev.cuts.size()).toBe(0);
	});

	it("a kill and a hit on one tick that net no loss record no cut", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		// x1.0: the kill feeds 10 -> 11, the hit cuts it back to max(10, floor(11 / 2)) = 10.
		frameOf(ev, state, [[1, 1]]);
		expect(state.score!.events.comboCut > 0).toBe(true);
		expect([ev.startCombo, ev.endCombo, ev.kills]).toEqual([10, 10, 1]);
		expect(ev.cuts.size()).toBe(0);
	});

	it("a streak end in a live room is a fight; after the room cleared (nothing live) it is not", () => {
		const live = scoredM1();
		live.score!.rooms[0].engageTick = 0;
		expect(fightOn(live)).toBe(true);
		const a = new ComboEvents();
		climb(a, live, 34);
		runOut(a, live);
		expect(live.score!.events.comboBroken).toBe(1);
		expect([a.startCombo, a.endCombo]).toEqual([34, 10]);
		expect(a.ended).toEqual({ lost: 34, peak: 34, fight: true });

		const lapse = scoredM1();
		lapse.score!.rooms[0].engageTick = 0;
		lapse.score!.rooms[0].cleared = 1;
		expect(fightOn(lapse)).toBe(false);
		const b = new ComboEvents();
		climb(b, lapse, 34);
		runOut(b, lapse);
		expect(b.ended).toEqual({ lost: 34, peak: 34, fight: false });
	});

	it("a boss awake (phase > 0) is a fight; dormant (phase 0) it is not", () => {
		const state = scoredM1();
		const boss = bossOf(state);
		expect(boss.phase).toBe(0);
		const ev = new ComboEvents();
		climb(ev, state, 25);
		runOut(ev, state);
		expect(ev.ended?.fight).toBe(false);

		boss.phase = 1;
		climb(ev, state, 25);
		runOut(ev, state);
		expect(ev.ended).toEqual({ lost: 25, peak: 25, fight: true });
	});

	it("no streak end while the timer runs, and none when it runs out at x1.0", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		climb(ev, state, 12);
		frameOf(ev, state, [
			[0, 0],
			[0, 0],
		]);
		expect(ev.ended).toBe(undefined);
		frameOf(ev, state, [[0, 1]]);
		expect(state.score!.combo).toBe(COMBO_MIN);
		runOut(ev, state);
		expect(state.score!.comboTimer).toBe(0);
		expect(ev.ended).toBe(undefined);
	});

	it("the streak peak spans frames: highest since the last end, reset after it", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		climb(ev, state, 25);
		frameOf(ev, state, [[0, 1]]); // 25 -> 12
		expect(ev.peak).toBe(25);
		climb(ev, state, 14);
		expect([ev.startCombo, ev.peak]).toEqual([12, 14]);
		runOut(ev, state);
		expect(ev.ended).toEqual({ lost: 14, peak: 25, fight: false });

		climb(ev, state, 13);
		runOut(ev, state);
		expect(ev.ended).toEqual({ lost: 13, peak: 13, fight: false });
	});

	it("a frame with no tick: start, end and peak are the last combo seen, nothing else", () => {
		const state = scoredM1();
		const ev = new ComboEvents();
		climb(ev, state, 18);
		ev.reset();
		expect([ev.ticks, ev.startCombo, ev.endCombo, ev.peak, ev.kills, ev.grazes]).toEqual([0, 18, 18, 18, 0, 0]);
		expect([ev.cuts.size(), ev.ended]).toEqual([0, undefined]);
	});

	it("an unscored run collects nothing", () => {
		const setup = buildRunConfig(SEED);
		const state = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		expect(state.score).toBe(undefined);
		const ev = new ComboEvents();
		ev.reset();
		for (let t = 0; t < 30; t++) {
			step(state, EMPTY_INPUT, setup.config);
			ev.collect(state);
		}
		expect([ev.ticks, ev.startCombo, ev.endCombo, ev.peak, ev.kills, ev.grazes]).toEqual([0, 10, 10, 10, 0, 0]);
		expect([ev.cuts.size(), ev.ended]).toEqual([0, undefined]);
	});

	it("NO_COMBO_EVENTS is an empty, frozen source", () => {
		const n = NO_COMBO_EVENTS;
		expect([n.ticks, n.startCombo, n.endCombo, n.peak, n.kills, n.grazes]).toEqual([0, 10, 10, 10, 0, 0]);
		expect([n.cuts.size(), n.ended]).toEqual([0, undefined]);
		expect(table.isfrozen(n)).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
// Hand-built score states (only the fields the collector reads)

interface FakeEvents {
	kills: number;
	grazes: number;
	comboBroken: number;
	comboCut: number;
	comboStart: number;
	comboFed: number;
}

interface Fake {
	score: { combo: number; comboTimer: number; rooms: never[]; events: FakeEvents };
	combat: { actors: never[] };
}

function fake(): Fake {
	return {
		score: {
			combo: COMBO_MIN,
			comboTimer: 0,
			rooms: [],
			events: { kills: 0, grazes: 0, comboBroken: 0, comboCut: 0, comboStart: COMBO_MIN, comboFed: 0 },
		},
		combat: { actors: [] },
	};
}

/** One tick: the start combo, the end combo / timer and the tick's events. */
function fakeTick(ev: ComboEvents, f: Fake, combo: number, timer: number, e: Partial<FakeEvents> = {}): void {
	const s = f.score;
	s.events = {
		kills: e.kills ?? 0,
		grazes: e.grazes ?? 0,
		comboBroken: e.comboBroken ?? 0,
		comboCut: e.comboCut ?? 0,
		comboStart: s.combo,
		comboFed: (e.kills ?? 0) + (e.grazes ?? 0) > 0 ? 1 : 0,
	};
	s.combo = combo;
	s.comboTimer = timer;
	ev.collect(f as unknown as SimState);
}

describe("ComboEvents: hand-built ticks", () => {
	it("sums kills and grazes over a frame; a graze feeds like a kill", () => {
		const ev = new ComboEvents();
		const f = fake();
		ev.reset();
		fakeTick(ev, f, 12, 180, { kills: 1, grazes: 1 });
		fakeTick(ev, f, 13, 180, { grazes: 1 });
		fakeTick(ev, f, 13, 179);
		expect([ev.ticks, ev.startCombo, ev.endCombo, ev.peak, ev.kills, ev.grazes]).toEqual([3, 10, 13, 13, 1, 2]);
	});

	it("records a cut only when the tick ended below its start", () => {
		const ev = new ComboEvents();
		const f = fake();
		f.score.combo = 30;
		ev.reset();
		fakeTick(ev, f, 30, 180, { kills: 2, comboCut: 1 }); // 30 -> 32 -> 30: nothing lost
		fakeTick(ev, f, 31, 180, { kills: 3, comboCut: 1 }); // 30 -> 33 -> 31: a net gain
		expect(ev.cuts.size()).toBe(0);
		fakeTick(ev, f, 15, 180, { comboCut: 1 });
		expect(ev.cuts).toEqual([{ before: 31, after: 15 }]);
	});

	it("reuses its cut records across frames (no allocation once warm)", () => {
		const ev = new ComboEvents();
		const f = fake();
		f.score.combo = 40;
		ev.reset();
		fakeTick(ev, f, 20, 100, { comboCut: 1 });
		const first = ev.cuts[0];
		ev.reset();
		fakeTick(ev, f, 10, 99, { comboCut: 1 });
		expect(ev.cuts[0]).toBe(first);
		expect(ev.cuts).toEqual([{ before: 20, after: 10 }]);
	});

	it("the streak peak counts a value reached only inside a tick (fed, then cut on the same tick)", () => {
		const ev = new ComboEvents();
		const f = fake();
		f.score.combo = 29;
		ev.reset();
		fakeTick(ev, f, 15, 180, { kills: 1, comboCut: 1 }); // 29 -> 30 -> 15
		expect(ev.peak).toBe(29);
		ev.reset();
		fakeTick(ev, f, 10, 0, { comboBroken: 1 });
		expect(ev.ended).toEqual({ lost: 15, peak: 30, fight: false });
	});

	it("keeps the frame's last streak end; the peak after it starts over", () => {
		const ev = new ComboEvents();
		const f = fake();
		ev.reset();
		fakeTick(ev, f, 14, 1, { kills: 4 });
		fakeTick(ev, f, 10, 0, { comboBroken: 1 });
		fakeTick(ev, f, 11, 180, { kills: 1 });
		fakeTick(ev, f, 10, 0, { comboBroken: 1 });
		expect(ev.ended).toEqual({ lost: 11, peak: 11, fight: false });
		expect([ev.startCombo, ev.peak, ev.endCombo]).toEqual([10, 14, 10]);
	});
});

// ---------------------------------------------------------------------------------------------
// The recorded endless descent

/** Ticks per frame, cycled. */
const FRAME_TICKS = [1, 2, 3, 4, 5];

describe("ComboEvents: the recorded seed-1337 endless descent", () => {
	const r = recordEndlessRun(SEED);
	const setup = r.setup;
	const total = r.recording.frames.size();

	const state = createSimState(r.seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	const ev = new ComboEvents();
	let frames = 0;
	let chainBreaks = 0;
	let sumMismatch = 0;
	let tickKills = 0;
	let frameKills = 0;
	let tickGrazes = 0;
	let frameGrazes = 0;
	let tickCuts = 0;
	let frameCuts = 0;
	let brokenTicks = 0;
	let ends = 0;
	let badEnds = 0;
	let frozenTicks = 0;
	let frozenWithTimer = 0;
	let frozenEnds = 0;
	let prevEnd = COMBO_MIN;
	let t = 0;
	while (t < total) {
		ev.reset();
		const n = FRAME_TICKS[frames % FRAME_TICKS.size()];
		let fKills = 0;
		let fGrazes = 0;
		let fCuts = 0;
		let broken = 0;
		let lost = 0;
		let fight = false;
		let peak = state.score!.combo;
		let frozenOnly = true;
		for (let k = 0; k < n && t < total; k++) {
			const frozen = isDraftOpen(state);
			const timerBefore = state.score!.comboTimer;
			stepRecorded(state, r.recording, t, setup.config);
			ev.collect(state);
			const e = state.score!.events;
			fKills += e.kills;
			fGrazes += e.grazes;
			if (e.comboCut > 0 && state.score!.combo < e.comboStart) fCuts++;
			if (e.comboBroken !== 0) {
				broken++;
				lost = e.comboStart;
				fight = fightOn(state);
			}
			peak = math.max(peak, state.score!.combo);
			if (frozen) {
				frozenTicks++;
				if (timerBefore > 0) frozenWithTimer++;
				if (state.score!.comboTimer !== timerBefore || e.comboBroken !== 0) frozenEnds++;
			} else frozenOnly = false;
			t++;
		}
		frames++;
		if (ev.startCombo !== prevEnd || ev.endCombo !== state.score!.combo) chainBreaks++;
		prevEnd = ev.endCombo;
		if (ev.kills !== fKills || ev.grazes !== fGrazes || ev.cuts.size() !== fCuts || ev.peak !== peak) sumMismatch++;
		tickKills += fKills;
		frameKills += ev.kills;
		tickGrazes += fGrazes;
		frameGrazes += ev.grazes;
		tickCuts += fCuts;
		frameCuts += ev.cuts.size();
		brokenTicks += broken;
		if (ev.ended !== undefined) {
			ends++;
			const done = ev.ended;
			if (done.lost !== lost || done.fight !== fight || done.lost <= COMBO_MIN || done.peak < done.lost)
				badEnds++;
		}
		if (frozenOnly && ev.ended !== undefined) frozenEnds++;
	}
	print(
		`[comboEvents] descent: ${frames} frames, ${tickKills} kills, ${tickGrazes} grazes, ${tickCuts} cut ticks, ` +
			`${brokenTicks} streak ends, ${frozenTicks} frozen draft ticks (${frozenWithTimer} with the timer running), ` +
			`best x${state.score!.maxCombo / 10}`,
	);

	it("the frames chain (start = the last frame's end) and sum their ticks' events", () => {
		expect([chainBreaks, sumMismatch]).toEqual([0, 0]);
		expect([frameKills, frameGrazes, frameCuts]).toEqual([tickKills, tickGrazes, tickCuts]);
		expect(tickKills > 0).toBe(true);
	});

	it("every streak end is a comboBroken tick, with its lost value, a peak >= it and fightOn at that tick", () => {
		expect(ends).toBe(brokenTicks);
		expect(badEnds).toBe(0);
	});

	it("an open boon draft never ends a streak: the timer does not count down", () => {
		expect(frozenTicks > 0).toBe(true);
		expect(frozenEnds).toBe(0);
	});

	it("a draft opened with a combo about to run out holds it until the draft closes", () => {
		const s = createSimState(r.seed, setup.spawn!.x, setup.spawn!.z, setup.config);
		const c = new ComboEvents();
		let i = 0;
		while (i < total && !isDraftOpen(s)) {
			stepRecorded(s, r.recording, i, setup.config);
			i++;
		}
		expect(isDraftOpen(s)).toBe(true);
		s.score!.combo = 30;
		s.score!.comboTimer = 1;
		let held = 0;
		while (i < total && isDraftOpen(s)) {
			c.reset();
			stepRecorded(s, r.recording, i, setup.config);
			c.collect(s);
			i++;
			if (!isDraftOpen(s)) break; // the pick tick: the draft just closed
			if (c.ended === undefined && s.score!.combo === 30 && s.score!.comboTimer === 1) held++;
			else error(`draft tick ${s.tick}: combo ${s.score!.combo} timer ${s.score!.comboTimer}`, 0);
		}
		expect(held > 0).toBe(true);
	});
});
