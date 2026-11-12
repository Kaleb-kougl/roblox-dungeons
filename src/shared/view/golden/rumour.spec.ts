// Goldling rumours (docs/GOLDLING_RUMOURS.md GR5): the phase from hashed state (NONE / FLOOR / ROOM), and the per-client
// clock: the floor cue once per floor after floorDelaySec of unfrozen time (never under a draft or the caller's hold),
// the room cue once on the first unfrozen ROOM frame, the floor cue skipped when the room came first, a new floor
// re-arms (and reset), the chip from the first cue on (hidden while frozen, ROOM after the room clears while it still
// hides, gone once it is out), the view player in its room, and read-only on the state.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import { buildDevRunConfig, buildEndlessRunConfig } from "shared/run";
import { frame } from "shared/run/testing";
import {
	BreakableSource,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	GoldenStatus,
	NO_KIND,
	SimCtx,
	createSimState,
	damageBreakable,
	hashState,
	isDraftOpen,
	simWorldConfig,
	step,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import {
	GOLDEN_RUMOUR_PHASE_NAMES,
	GOLDEN_VIEW,
	GoldenRumourClock,
	GoldenRumourPhase,
	NO_GOLDEN_RUMOUR_CUES,
	goldenRumourInRoom,
	goldenRumourPhase,
} from ".";

const R = GOLDEN_VIEW.rumour;
/** A frame length that sums to floorDelaySec exactly (a power of two: no float drift). */
const DT = 0.25;
const STEPS_TO_FLOOR_CUE = R.floorDelaySec / DT;

/**
 * The first (run seed, floor) from floor 2 whose floor AND the next one rolled a Goldling (the re-arm spec), and the
 * first one whose floor did (the rest).
 */
function findFloors(): { single: [number, number]; pair: [number, number] } {
	let single: [number, number] | undefined;
	for (let seed = 1; seed <= 60; seed++) {
		const setup = buildEndlessRunConfig(seed);
		let prev = false;
		for (let floor = 2; floor <= 8; floor++) {
			const has = setup.endlessFloor(floor).golden !== undefined;
			if (has && single === undefined) single = [seed, floor];
			if (has && prev && single !== undefined) return { single, pair: [seed, floor - 1] };
			prev = has;
		}
	}
	error("no two Goldling floors in a row in run seeds 1-60, floors 2-8", 0);
}

const FLOORS = findFloors();

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
}

/** A god-mode dev run (the dev world sets the Goldling's config). */
function devRun([seed, floor]: [number, number] = FLOORS.single): Run {
	const dev = buildDevRunConfig(seed, { startFloor: floor, invulnerable: true });
	return { config: dev.config, s: createSimState(seed, dev.spawn!.x, dev.spawn!.z, dev.config) };
}

function tick(r: Run, input: InputFrame = EMPTY_INPUT): void {
	step(r.s, input, r.config);
}

/** Player 0 onto a walk-mask cell near the middle of the Goldling room, one tick: the room engages. */
function enterRoom(r: Run): void {
	const f = r.s.golden!.floor!;
	let lx = math.floor(f.w / 2);
	const ly = math.floor(f.h / 2);
	while (f.walk[ly * f.w + lx] !== 1) lx = (lx + 1) % f.w;
	const p = r.s.player;
	p.x = gridToWorld(f.x0 + lx);
	p.z = gridToWorld(f.y0 + ly);
	p.prevX = p.x;
	p.prevZ = p.z;
	tick(r);
	expect(r.s.golden!.engageTick >= 0).toBe(true);
}

/** Steps the clock `n` frames of DT; returns how many floor / room cues it raised. */
function run(c: GoldenRumourClock, s: SimState, n: number, hold = false): [number, number] {
	let floor = 0;
	let room = 0;
	for (let k = 0; k < n; k++) {
		c.step(s, DT, hold);
		if (c.floorCue) floor++;
		if (c.roomCue) room++;
	}
	return [floor, room];
}

describe("Goldling rumours: the phase (GR5)", () => {
	it("NONE without a Goldling; FLOOR while it hides unfound; ROOM once its room engaged; NONE once it is out", () => {
		expect(goldenRumourPhase(createSimState(1, 0, 0))).toBe(GoldenRumourPhase.NONE);
		const r = devRun();
		const g = r.s.golden!;
		expect([g.status, goldenRumourPhase(r.s)]).toEqual([GoldenStatus.WAITING, GoldenRumourPhase.FLOOR]);
		enterRoom(r);
		expect(goldenRumourPhase(r.s)).toBe(GoldenRumourPhase.ROOM);
		damageBreakable(r.s, g.piece, r.s.breakables!.pieces[g.piece].hp, BreakableSource.MELEE, 0);
		tick(r);
		expect([g.status, goldenRumourPhase(r.s)]).toEqual([GoldenStatus.RUNNING, GoldenRumourPhase.NONE]);
		expect(GOLDEN_RUMOUR_PHASE_NAMES.size()).toBe(3);
		expect(GOLDEN_RUMOUR_PHASE_NAMES[GoldenRumourPhase.ROOM]).toBe("ROOM");
	});

	it("the view player in its room: true on its floor cells, false at the spawn; player 0 for a bad index", () => {
		const r = devRun();
		expect(goldenRumourInRoom(r.s, 0)).toBe(false);
		enterRoom(r);
		expect([goldenRumourInRoom(r.s, 0), goldenRumourInRoom(r.s, 7)]).toEqual([true, true]);
		expect(goldenRumourInRoom(createSimState(1, 0, 0), 0)).toBe(false);
	});
});

describe("Goldling rumours: the clock (GR5)", () => {
	it("the floor cue once per floor after floorDelaySec of unfrozen time; the chip from then on", () => {
		const r = devRun();
		const c = new GoldenRumourClock();
		expect([R.floorDelaySec, R.floorVolume, R.roomVolume]).toEqual([1, 0.45, 0.8]);
		expect(run(c, r.s, STEPS_TO_FLOOR_CUE - 1)).toEqual([0, 0]);
		expect([c.chip(), c.heard(), c.phase()]).toEqual([GoldenRumourPhase.NONE, false, GoldenRumourPhase.FLOOR]);
		c.step(r.s, DT);
		expect([c.floorCue, c.roomCue, c.chip(), c.heard()]).toEqual([true, false, GoldenRumourPhase.FLOOR, true]);
		// the edge is for its one step only; never again on this floor
		expect(run(c, r.s, 200)).toEqual([0, 0]);
		expect(c.chip()).toBe(GoldenRumourPhase.FLOOR);
		// odd frame times add up the same way
		const c2 = new GoldenRumourClock();
		c2.step(r.s, 0.6);
		expect(c2.floorCue).toBe(false);
		c2.step(r.s, -1); // a bad dt counts nothing
		c2.step(r.s, 0.4);
		expect(c2.floorCue).toBe(true);
	});

	it("never under a draft: no time counts and no cue while a draft is open; the chip hides there too", () => {
		const r = devRun();
		const c = new GoldenRumourClock();
		const me = r.s.run!.players[0];
		me.draftOpen = 1; // test surgery: the world is frozen under a draft
		expect(run(c, r.s, 40)).toEqual([0, 0]);
		expect([c.floorSec(), c.chip()]).toEqual([0, GoldenRumourPhase.NONE]);
		me.draftOpen = 0;
		expect(run(c, r.s, STEPS_TO_FLOOR_CUE)).toEqual([1, 0]);
		expect(c.chip()).toBe(GoldenRumourPhase.FLOOR);
		me.draftOpen = 1;
		c.step(r.s, DT);
		expect(c.chip()).toBe(GoldenRumourPhase.NONE);
		me.draftOpen = 0;
		c.step(r.s, DT);
		expect(c.chip()).toBe(GoldenRumourPhase.FLOOR);
	});

	it("the caller's hold (stage cover, pause, run over) freezes it the same way", () => {
		const r = devRun();
		const c = new GoldenRumourClock();
		expect(run(c, r.s, 40, true)).toEqual([0, 0]);
		expect([c.floorSec(), c.chip()]).toEqual([0, GoldenRumourPhase.NONE]);
		expect(run(c, r.s, STEPS_TO_FLOOR_CUE)).toEqual([1, 0]);
		c.step(r.s, DT, true);
		expect(c.chip()).toBe(GoldenRumourPhase.NONE);
	});

	it("room before the floor cue: the room cue on its first frame, the floor cue skipped for good", () => {
		const r = devRun();
		const c = new GoldenRumourClock();
		expect(run(c, r.s, STEPS_TO_FLOOR_CUE - 2)).toEqual([0, 0]);
		enterRoom(r);
		c.step(r.s, DT);
		expect([c.floorCue, c.roomCue, c.chip(), c.heard()]).toEqual([false, true, GoldenRumourPhase.ROOM, true]);
		expect(run(c, r.s, 200)).toEqual([0, 0]);
	});

	it("floor, then room: both cues once each; the room cue waits for the draft to close", () => {
		const r = devRun();
		const c = new GoldenRumourClock();
		expect(run(c, r.s, STEPS_TO_FLOOR_CUE)).toEqual([1, 0]);
		enterRoom(r);
		const me = r.s.run!.players[0];
		me.draftOpen = 1;
		expect(run(c, r.s, 10)).toEqual([0, 0]);
		me.draftOpen = 0;
		c.step(r.s, DT);
		expect([c.floorCue, c.roomCue, c.chip()]).toEqual([false, true, GoldenRumourPhase.ROOM]);
		expect(run(c, r.s, 50)).toEqual([0, 0]);
	});

	it("the chip stays ROOM after the room clears while it hides; it goes once the Goldling is out", () => {
		const r = devRun();
		const c = new GoldenRumourClock();
		enterRoom(r);
		c.step(r.s, DT);
		expect(c.roomCue).toBe(true);
		const g = r.s.golden!;
		const rec = r.s.score!.rooms[g.record];
		const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
		for (let k = 0; k < 20 && rec.cleared === 0; k++) {
			for (let m = 0; m < rec.memberSlots.size(); m++) {
				const a = r.s.combat.actors[rec.memberSlots[m]];
				if (a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) ctx.killActor(a);
			}
			tick(r);
			c.step(r.s, DT);
		}
		expect(rec.cleared).toBe(1);
		for (let k = 0; k < 120; k++) {
			tick(r);
			c.step(r.s, DT);
			expect([c.floorCue, c.roomCue]).toEqual([false, false]);
		}
		expect([g.status, c.chip()]).toEqual([GoldenStatus.WAITING, GoldenRumourPhase.ROOM]);
		damageBreakable(r.s, g.piece, r.s.breakables!.pieces[g.piece].hp, BreakableSource.MELEE, 0);
		tick(r);
		c.step(r.s, DT);
		expect([g.status, c.chip(), c.phase()]).toEqual([
			GoldenStatus.RUNNING,
			GoldenRumourPhase.NONE,
			GoldenRumourPhase.NONE,
		]);
	});

	it("a second floor re-arms it: its own floor cue after its own delay; reset re-arms the same floor", () => {
		const r = devRun(FLOORS.pair);
		const c = new GoldenRumourClock();
		expect(run(c, r.s, STEPS_TO_FLOOR_CUE)).toEqual([1, 0]);
		const floor = r.s.endless!.floor;
		tick(r, frame(0, 0, DEBUG_FLOOR_BUTTON));
		expect(r.s.endless!.floor).toBe(floor + 1);
		expect(goldenRumourPhase(r.s)).toBe(GoldenRumourPhase.FLOOR);
		// re-armed at once: nothing heard on the new floor, no time carried over (its boon draft, open on arrival, holds
		// the clock: closed here by test surgery, the clock only reads it)
		expect(isDraftOpen(r.s)).toBe(true);
		c.step(r.s, DT);
		expect([c.floorCue, c.chip(), c.heard(), c.floorSec()]).toEqual([false, GoldenRumourPhase.NONE, false, 0]);
		for (const p of r.s.run!.players) p.draftOpen = 0;
		expect(run(c, r.s, STEPS_TO_FLOOR_CUE - 1)).toEqual([0, 0]);
		c.step(r.s, DT);
		expect(c.floorCue).toBe(true);
		expect(c.chip()).toBe(GoldenRumourPhase.FLOOR);
		// a new run on the same floor number: reset
		c.reset();
		expect([c.chip(), c.heard(), c.floorCue, c.roomCue]).toEqual([GoldenRumourPhase.NONE, false, false, false]);
		expect(run(c, r.s, STEPS_TO_FLOOR_CUE)).toEqual([1, 0]);
	});

	it("a floor without a Goldling: no cue, no chip", () => {
		const s = createSimState(1, 0, 0);
		const c = new GoldenRumourClock();
		expect(run(c, s, 100)).toEqual([0, 0]);
		expect(c.chip()).toBe(GoldenRumourPhase.NONE);
		expect([NO_GOLDEN_RUMOUR_CUES.floorCue, NO_GOLDEN_RUMOUR_CUES.roomCue]).toEqual([false, false]);
	});

	it("read-only on the state: stepping the clock changes no hashed field", () => {
		const r = devRun();
		enterRoom(r);
		const before = hashState(r.s);
		const tickBefore = r.s.tick;
		const c = new GoldenRumourClock();
		run(c, r.s, 50);
		run(c, r.s, 10, true);
		expect([hashState(r.s), r.s.tick]).toEqual([before, tickBefore]);
	});
});
