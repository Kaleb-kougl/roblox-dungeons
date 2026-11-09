// The run-over recap's tally (docs/RUN_RECAP.md RR1):
//   - hand-filled ScoreEvents arrays (as GP1 pushes them): one guard erasing 5 bullets = 1 parry, two guards = 2, the
//     guard window's edge, per player, outside-party records ignored, grazes per player, reset, unscored runs
//   - the same grouping as the NearMissDirector's parry cues (one cue per group) over the same ticks
//   - the run views' wiring: LiveRun and LockstepClient collect every tick and never reset per frame (solo grazes =
//     counts[GRAZES])
//   - docs/RUN_CONTRIBUTION.md CT2: kills / damage / boss damage / hits from the hand-filled feed, pellets (the power
//     pellet too) and ground boosts (not a chest's given boost), deaths / revives / leaves / the last death (ties: the
//     lower index), lastTick, reset, NO_RECAP_TALLY; the wiring's team sums (hits = hitsTaken, kills = pops)
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessRunConfig, buildRunConfig } from "shared/run";
import { defaultJuiceSettings } from "shared/settings";
import {
	Boost,
	EMPTY_INPUT,
	GIVEN_DROP_SLOT,
	SWORD_DATA,
	ScoreSource,
	clearScoreEvents,
	createSimState,
	playerAt,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { LiveRun } from "shared/play";
import { LockstepClient, MergedEncoder } from "shared/lockstep";
import { NearMissEvents } from "./nearMissEvents";
import { NearMissDirector } from "./nearMissRules";
import { NO_RECAP_TALLY, RECAP_ALIVE_TICK, RECAP_NO_FLOOR, RECAP_NO_PLAYER, RecapTally } from "./recapTally";

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

function endlessState(partySize: number): SimState {
	const setup = buildEndlessRunConfig(SEED, partySize);
	return createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
}

/** One contribution entry per hit: [player, amount, boss]. */
type Dealt = readonly [number, number, number];

/** One tick by hand with these feed entries (pops by killer, damage, landed hits), tick += 1. */
function feedTick(
	state: SimState,
	pops: ReadonlyArray<number>,
	dealt: ReadonlyArray<Dealt>,
	hurt: ReadonlyArray<number>,
) {
	const s = state.score!;
	clearScoreEvents(s);
	const e = s.events;
	for (const p of pops) {
		e.popX.push(0);
		e.popZ.push(0);
		e.popPoints.push(10);
		e.popPlayer.push(p);
	}
	e.kills = pops.size();
	for (const [p, amount, boss] of dealt) {
		e.dealtPlayer.push(p);
		e.dealtAmount.push(amount);
		e.dealtBoss.push(boss);
	}
	for (const p of hurt) e.hurtPlayer.push(p);
	state.tick += 1;
}

/** One empty tick by hand that clears the pellets / drops events too (pickups below push into them). */
function pickupTick(state: SimState): void {
	feedTick(state, [], [], []);
	const pe = state.pellets!.events;
	pe.eaten.clear();
	pe.power = undefined;
	state.drops!.events.collected.clear();
}

describe("RecapTally contribution (docs/RUN_CONTRIBUTION.md CT2)", () => {
	it("kills, damage, boss damage and hits per player; outside-party records ignored; arrays sized to the party", () => {
		const state = scoredState(2);
		const t = new RecapTally();
		feedTick(
			state,
			[1, 0, 1, 2, -1],
			[
				[0, 3, 0],
				[1, 5, 1],
				[1, 2, 0],
				[2, 9, 1],
				[-1, 4, 0],
			],
			[1, 1, 0, 3],
		);
		t.collect(state);
		feedTick(state, [1], [[0, 1.5, 1]], [0]);
		t.collect(state);
		expect(t.kills).toEqual([1, 3]);
		expect(t.damage).toEqual([4.5, 7]);
		expect(t.bossDamage).toEqual([1.5, 5]);
		expect(t.hits).toEqual([2, 2]);
		expect([t.killsOf(1), t.damageOf(0), t.bossDamageOf(1), t.hitsOf(0)]).toEqual([3, 4.5, 5, 2]);
		expect([t.killsOf(4), t.damageOf(4), t.bossDamageOf(4), t.hitsOf(4)]).toEqual([0, 0, 0, 0]);
		// Grown to the party at the first collect, every per-player array alike.
		const sizes = [t.parries, t.grazes, t.pellets, t.boosts, t.deathTick, t.deathFloor, t.leftFloor].map((a) =>
			a.size(),
		);
		expect(sizes).toEqual([2, 2, 2, 2, 2, 2, 2]);
		expect([t.deathTick, t.deathFloor, t.leftFloor]).toEqual([
			[RECAP_ALIVE_TICK, RECAP_ALIVE_TICK],
			[RECAP_NO_FLOOR, RECAP_NO_FLOOR],
			[RECAP_NO_FLOOR, RECAP_NO_FLOOR],
		]);
		expect([t.lastDeath, t.lastTick]).toEqual([RECAP_NO_PLAYER, state.tick]);
	});

	it("pellets (the power pellet too) and ground boosts per player; a chest's given boost is no pickup", () => {
		const state = endlessState(2);
		const t = new RecapTally();
		pickupTick(state);
		const pe = state.pellets!.events;
		pe.eaten.push({ index: 0, x: 0, z: 0, player: 1, points: 5 });
		pe.eaten.push({ index: 1, x: 0, z: 0, player: 1, points: 5 });
		pe.eaten.push({ index: 2, x: 0, z: 0, player: 0, points: 5 });
		pe.eaten.push({ index: 3, x: 0, z: 0, player: 3, points: 5 });
		pe.power = { player: 0, x: [], z: [], points: 0 };
		const collected = state.drops!.events.collected;
		collected.push({ player: 0, kind: Boost.FURY, slot: 2, x: 0, z: 0 });
		collected.push({ player: 1, kind: Boost.AEGIS, slot: GIVEN_DROP_SLOT, x: 0, z: 0 });
		collected.push({ player: 1, kind: Boost.FRENZY, slot: 0, x: 0, z: 0 });
		t.collect(state);
		pickupTick(state);
		state.drops!.events.collected.push({ player: 1, kind: Boost.QUICKSTEP, slot: 1, x: 0, z: 0 });
		t.collect(state);
		expect(t.pellets).toEqual([2, 2]);
		expect(t.boosts).toEqual([1, 2]);
	});

	it("deaths, revives and leaves: tick and floor, the last death with the lower index on a tie", () => {
		const state = endlessState(3);
		const t = new RecapTally();
		const floorAt = (f: number) => {
			state.endless!.floor = f;
		};
		floorAt(2);
		pickupTick(state);
		t.collect(state);
		expect([t.deathTick, t.lastDeath]).toEqual([[-1, -1, -1], RECAP_NO_PLAYER]);
		// Player 1 dies on floor 2.
		pickupTick(state);
		playerAt(state, 1).dead = 1;
		t.collect(state);
		const tick1 = state.tick;
		expect([t.deathTick, t.deathFloor, t.lastDeath]).toEqual([[-1, tick1, -1], [0, 2, 0], 1]);
		// Still dead: nothing moves.
		pickupTick(state);
		t.collect(state);
		expect([t.deathTick[1], t.lastDeath]).toEqual([tick1, 1]);
		// Floor 3: player 1 revived (the floor change), alive again.
		floorAt(3);
		pickupTick(state);
		playerAt(state, 1).dead = 0;
		t.collect(state);
		expect([t.deathTick, t.deathFloor, t.lastDeath]).toEqual([[-1, -1, -1], [0, 0, 0], 1]);
		// Player 2 leaves (dead with `left`): a leave, not a death.
		pickupTick(state);
		state.party!.left[2] = 1;
		playerAt(state, 2).dead = 1;
		t.collect(state);
		expect([t.deathTick, t.leftFloor, t.lastDeath]).toEqual([[-1, -1, -1], [0, 0, 3], 1]);
		// Floor 4: players 0 and 1 fall on the same tick (the wipe): the lower index is the last death.
		floorAt(4);
		pickupTick(state);
		playerAt(state, 0).dead = 1;
		playerAt(state, 1).dead = 1;
		t.collect(state);
		const wipe = state.tick;
		expect([t.deathTick, t.deathFloor, t.leftFloor, t.lastDeath]).toEqual([
			[wipe, wipe, -1],
			[4, 4, 0],
			[0, 0, 3],
			0,
		]);
		expect(t.lastTick).toBe(wipe);
		// A death after leaving the floor, then a later leave of a dead player: the death is kept, the leave recorded.
		pickupTick(state);
		state.party!.left[0] = 1;
		t.collect(state);
		expect([t.deathTick[0], t.leftFloor[0], t.lastDeath]).toEqual([wipe, 4, 0]);
	});

	it("an M1 state (no state.endless) records floor 1; reset clears every field", () => {
		const state = scoredState(2);
		const t = new RecapTally();
		feedTick(state, [0], [[0, 2, 0]], [1]);
		playerAt(state, 0).dead = 1;
		t.collect(state);
		expect([t.deathTick[0], t.deathFloor[0], t.lastDeath]).toEqual([state.tick, 1, 0]);
		t.reset();
		const all = [
			t.parries,
			t.grazes,
			t.kills,
			t.damage,
			t.bossDamage,
			t.hits,
			t.pellets,
			t.boosts,
			t.deathTick,
			t.deathFloor,
			t.leftFloor,
		].map((a) => a.size());
		expect(all).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect([t.lastDeath, t.lastTick]).toEqual([RECAP_NO_PLAYER, 0]);
		// After the reset a still-dead player is seen dying again (a new run on the same view starts alive).
		feedTick(state, [], [], []);
		t.collect(state);
		expect(t.lastDeath).toBe(0);
	});

	it("NO_RECAP_TALLY is empty and frozen", () => {
		const n = NO_RECAP_TALLY;
		const sizes = [
			n.parries,
			n.grazes,
			n.kills,
			n.damage,
			n.bossDamage,
			n.hits,
			n.pellets,
			n.boosts,
			n.deathTick,
			n.deathFloor,
			n.leftFloor,
		].map((a) => a.size());
		expect(sizes).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect([n.lastDeath, n.lastTick]).toEqual([RECAP_NO_PLAYER, 0]);
		expect(table.isfrozen(n)).toBe(true);
		expect(table.isfrozen(n.kills)).toBe(true);
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
		// CT2: the team's hits and kills are the score's (no boss on this stretch: every pop is a KILLS award).
		expect(run.recapTally.hitsOf(0)).toBe(run.state.score!.hitsTaken);
		expect(run.recapTally.killsOf(0)).toBe(run.state.score!.counts[ScoreSource.KILLS]);
		expect(run.recapTally.damage.size()).toBe(1);
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
		expect(c.recapTally.hitsOf(0) + c.recapTally.hitsOf(1)).toBe(c.state.score!.hitsTaken);
		expect(c.recapTally.lastTick).toBe(c.state.tick);
	});
});
