// The Goldling's payouts (docs/FORTUNE.md GE3, FD12): ScoreSource.GOLDEN (14, Pacts' HORDE 13 padded) only in Goldling
// runs; every damaging hit pays hitPoints x the kills' floor scale without feeding the combo; the catch pays killPoints
// x the floor scale into GOLDEN (not KILLS), feeds the combo once, lands party size + 1 boosts (kinds from its own
// stream, a fixed ring, lowest free slots) and loses what a full ground cannot hold with the same draws; the main rng
// and the drops' stream move exactly as in a no-golden twin; and every endless world sets the config. Test-only
// surgery: teleports, damage and kills through SimCtx, ground slots filled by hand, its piece broken open by a direct
// damageBreakable (docs/GOLDLING_RUMOURS.md GR2: it comes out of its piece).
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { gridToWorld } from "shared/dungeon";
import {
	BOOSTS,
	BOOST_TOTAL_WEIGHT,
	BreakableSource,
	EMPTY_INPUT,
	ENDLESS_GOLDEN_CONFIG,
	GOLDEN_BOOST_RING,
	GOLDEN_SCORE_SOURCE_NAMES,
	GOLDEN_SUBSYSTEM,
	SECRETS_SUBSYSTEM,
	SILVER_SUBSYSTEM,
	GoldenStatus,
	NO_BOOST,
	Rng,
	SCORE_SUBSYSTEM,
	ScoreSource,
	SimCtx,
	awardPoints,
	createSimState,
	damageBreakable,
	floorScalePercent,
	hashLayout,
	landDrop,
	partySize,
	playerAt,
	simWorldConfig,
	step,
	stepParty,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig, buildWorldSetup } from "shared/run";

/** The first (run seed, floor) from floor 2 whose floor rolled a Goldling, for party sizes 1..4 alike. */
function findGoldenFloor(): [number, number] {
	for (let seed = 1; seed <= 80; seed++) {
		for (let floor = 2; floor <= 4; floor++) {
			let all = true;
			for (let n = 1; n <= 4 && all; n++)
				if (buildEndlessRunConfig(seed, n).endlessFloor(floor).golden === undefined) all = false;
			if (all) return [seed, floor];
		}
	}
	error("no Goldling floor for every party size in run seeds 1-80, floors 2-4", 0);
}

const [SEED, FLOOR] = findGoldenFloor();

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
}

/** An endless run of SEED from FLOOR for `n` players (the dev world's floor jump; hearts topped up by tick). */
function run(n = 1, golden = true): Run {
	const setup = n === 1 ? buildDevRunConfig(SEED, { startFloor: FLOOR, invulnerable: true }) : undefined;
	let config: SimConfig;
	let spawn: { x: number; z: number };
	if (setup !== undefined) {
		config = setup.config;
		spawn = setup.spawn!;
	} else {
		const party = buildEndlessRunConfig(SEED, n);
		config = { ...party.config, endless: { ...party.config.endless!, startFloor: FLOOR } };
		const w = party.endlessFloor(FLOOR);
		spawn = { x: w.spawnX, z: w.spawnZ };
	}
	if (!golden) config = { ...config, golden: undefined };
	return { config, s: createSimState(SEED, spawn.x, spawn.z, config) };
}

function tick(r: Run, input: InputFrame = EMPTY_INPUT): void {
	const n = partySize(r.s);
	for (let i = 0; i < n; i++) {
		const p = playerAt(r.s, i);
		if (p.dead === 0) p.hearts = p.heartsMax;
	}
	if (r.s.party === undefined) step(r.s, input, r.config);
	else {
		const frames: InputFrame[] = [];
		for (let i = 0; i < n; i++) frames.push(i === 0 ? input : EMPTY_INPUT);
		stepParty(r.s, frames, r.config);
	}
}

/** Breaks the Goldling's piece open (test surgery, player 0's swing): it comes out at the end of the next tick. */
function breakPiece(r: Run): void {
	const slot = r.config.endless!.worldForFloor(FLOOR).golden!.piece;
	damageBreakable(r.s, slot, r.s.breakables!.pieces[slot].hp, BreakableSource.MELEE, 0);
}

/**
 * Player 0 into the Goldling room (a walk-mask cell near its middle), one tick, then its piece broken open
 * (docs/GOLDLING_RUMOURS.md GR2): one more tick and it is out.
 */
function untilOut(r: Run): ActorState {
	const world = r.config.endless!.worldForFloor(FLOOR);
	const f = world.golden!;
	let lx = math.floor(f.w / 2);
	const ly = math.floor(f.h / 2);
	while (f.walk[ly * f.w + lx] !== 1) lx = (lx + 1) % f.w;
	const p = r.s.player;
	p.x = gridToWorld(f.x0 + lx);
	p.z = gridToWorld(f.y0 + ly);
	tick(r);
	const g = r.s.golden!;
	expect(g.status).toBe(GoldenStatus.WAITING);
	breakPiece(r);
	tick(r);
	expect(g.status).toBe(GoldenStatus.RUNNING);
	return r.s.combat.actors[g.actorSlot];
}

function ctxOf(r: Run): SimCtx {
	return new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
}

describe("golden: the score source (GE3)", () => {
	it("GOLDEN is source 14 after treasure's TREASURE (12) and Pacts' HORDE (13); a Goldling run pads every gated source up to it", () => {
		expect([ScoreSource.TREASURE, ScoreSource.HORDE, ScoreSource.GOLDEN]).toEqual([12, 13, 14]);
		expect([...GOLDEN_SCORE_SOURCE_NAMES]).toEqual(["golden"]);
		const r = run();
		const sc = r.s.score!;
		// 15 up to GOLDEN, then the builds run's OVERCAP (docs/BUILDS_V2.md BV9): 16, then SECRET (docs/SECRET_ROOMS.md
		// SR4, every endless world): 17.
		expect([sc.points.size(), sc.counts.size()]).toEqual([17, 17]);
		const layout = hashLayout(r.s, true);
		const score = layout.groups.find((gr) => gr.name === SCORE_SUBSYSTEM)!;
		const names: string[] = [];
		for (let i = score.start; i < score.finish; i++) names.push(layout.names[i]);
		expect(names.includes("score.points.horde")).toBe(true);
		expect(names.includes("score.points.golden")).toBe(true);
		expect(names.includes("score.counts.golden")).toBe(true);
		expect(layout.groups[layout.groups.size() - 3].name).toBe(GOLDEN_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 2].name).toBe(SECRETS_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 1].name).toBe(SILVER_SUBSYSTEM); // docs/SILVER.md SC2
		// Without the config: every endless world sets builds and secrets, so since docs/BUILDS_V2.md BV9 it pads GOLDEN
		// (0) on its way to OVERCAP and SECRET: 17 sources, GOLDEN never paid.
		const off = run(1, false).s.score!;
		expect([off.points.size(), off.points[ScoreSource.GOLDEN], off.counts[ScoreSource.GOLDEN]]).toEqual([17, 0, 0]);
	});

	it("every endless world sets ENDLESS_GOLDEN_CONFIG (solo, co-op, daily, dev)", () => {
		expect(buildEndlessRunConfig(1).config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
		expect(buildEndlessRunConfig(1, 3).config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
		expect(buildDevRunConfig(1).config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
		expect(buildWorldSetup("daily", 1, { atBossDoor: false }).config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
		expect(buildWorldSetup("endless", 1, { atBossDoor: false }).config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
		expect(buildWorldSetup("dev", 1, { atBossDoor: false }).config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
	});
});

describe("golden: hits and the catch (GE3)", () => {
	it("a damaging hit pays hitPoints x the floor scale into GOLDEN and never feeds the combo", () => {
		const r = run();
		const a = untilOut(r);
		const sc = r.s.score!;
		const g = r.s.golden!;
		const comboBefore = sc.combo;
		const timerBefore = sc.comboTimer;
		const expected = awardPoints(r.s, sc, ENDLESS_GOLDEN_CONFIG.hitPoints, floorScalePercent(FLOOR));
		const total0 = sc.total;
		const ctx = ctxOf(r);
		const dealt = ctx.damageActor(a, 1);
		expect(dealt).toBe(1);
		expect(sc.points[ScoreSource.GOLDEN]).toBe(expected);
		expect(sc.counts[ScoreSource.GOLDEN]).toBe(1);
		expect(sc.total - total0).toBe(expected);
		expect([sc.combo, sc.comboTimer, sc.events.comboFed]).toEqual([comboBefore, timerBefore, 0]);
		expect([g.coins, g.hits]).toEqual([expected, 1]);
		expect(g.events.hits.size()).toBe(1);
		expect(g.events.hits[0].points).toBe(expected);
		// A hit that deals nothing (0 damage) books nothing.
		ctx.damageActor(a, 0);
		expect(sc.counts[ScoreSource.GOLDEN]).toBe(1);
	});

	it("the catch pays killPoints x the floor scale into GOLDEN (not KILLS) and feeds the combo once", () => {
		const r = run();
		const a = untilOut(r);
		const sc = r.s.score!;
		const g = r.s.golden!;
		const kills0 = sc.points[ScoreSource.KILLS];
		const combo0 = sc.combo;
		const expected = awardPoints(r.s, sc, ENDLESS_GOLDEN_CONFIG.killPoints, floorScalePercent(FLOOR));
		ctxOf(r).killActor(a);
		expect(sc.points[ScoreSource.GOLDEN]).toBe(expected);
		expect(sc.points[ScoreSource.KILLS]).toBe(kills0);
		expect(sc.combo).toBe(combo0 + 1);
		expect([g.status, g.caught, g.escaped]).toEqual([GoldenStatus.CAUGHT, 1, 0]);
		expect(g.events.caught!.points).toBe(expected);
		expect(sc.events.popPoints[sc.events.popPoints.size() - 1]).toBe(expected);
		// It stays caught: the corpse never escapes.
		for (let k = 0; k < 700; k++) tick(r);
		expect([g.status, g.escaped]).toEqual([GoldenStatus.CAUGHT, 0]);
	});

	it("lands party size + 1 boosts (parties of 1-4) on the ring, kinds from its own stream; a full ground loses the rest", () => {
		for (let n = 1; n <= 4; n++) {
			const r = run(n);
			const a = untilOut(r);
			const g = r.s.golden!;
			const d = r.s.drops!;
			for (const gr of d.ground) expect(gr.kind).toBe(NO_BOOST);
			// The twin of the kind draws: ONE weighted pick each from the Goldling's stream.
			const twin = new Rng(0);
			twin.setState(g.rngState);
			const kinds: number[] = [];
			for (let i = 0; i < n + 1; i++) {
				let roll = twin.int(0, BOOST_TOTAL_WEIGHT - 1);
				let k = 0;
				while (roll >= BOOSTS[k].weight) {
					roll -= BOOSTS[k].weight;
					k++;
				}
				kinds.push(k);
			}
			const ax = a.x;
			const az = a.z;
			ctxOf(r).killActor(a);
			const caught = g.events.caught!;
			const landed = math.min(n + 1, d.ground.size());
			expect([n, caught.boosts.size(), caught.lost]).toEqual([n, landed, n + 1 - landed]);
			expect(g.rngState).toBe(twin.getState());
			for (let i = 0; i < landed; i++) {
				const gr = d.ground[caught.boosts[i]];
				expect([n, i, gr.kind]).toEqual([n, i, kinds[i]]);
				const off = GOLDEN_BOOST_RING[i];
				const onRing = gr.x === ax + off[0] && gr.z === az + off[1];
				const onPoint = gr.x === ax && gr.z === az;
				expect([n, i, onRing || onPoint]).toEqual([n, i, true]);
				expect(gr.spawnTick).toBe(r.s.tick);
			}
		}
	});

	it("a full ground: every boost lost, the same draws taken", () => {
		const r = run();
		const a = untilOut(r);
		const g = r.s.golden!;
		const d = r.s.drops!;
		for (let slot = 0; slot < d.ground.size(); slot++) landDrop(d, slot, 0, a.x, a.z, r.s.tick);
		const twin = new Rng(0);
		twin.setState(g.rngState);
		twin.int(0, BOOST_TOTAL_WEIGHT - 1);
		twin.int(0, BOOST_TOTAL_WEIGHT - 1);
		ctxOf(r).killActor(a);
		expect([g.events.caught!.boosts.size(), g.events.caught!.lost]).toEqual([0, 2]);
		expect(g.rngState).toBe(twin.getState());
	});
});

describe("golden: the rng streams (GE3)", () => {
	it("main rng and drops' stream tick by tick equal a no-golden twin, through its appearance, hits and catch", () => {
		const on = run(1, true);
		const off = run(1, false);
		const f = on.config.endless!.worldForFloor(FLOOR).golden!;
		let lx = math.floor(f.w / 2);
		const ly = math.floor(f.h / 2);
		while (f.walk[ly * f.w + lx] !== 1) lx = (lx + 1) % f.w;
		for (const r of [on, off]) {
			r.s.player.x = gridToWorld(f.x0 + lx);
			r.s.player.z = gridToWorld(f.y0 + ly);
		}
		const g = on.s.golden!;
		let hitAt = -1;
		for (let k = 0; k < 400; k++) {
			// Its piece broken open in both runs (the twin's is an ordinary piece) on the same tick.
			if (k === 180) for (const r of [on, off]) breakPiece(r);
			if (g.status === GoldenStatus.RUNNING) {
				const a = on.s.combat.actors[g.actorSlot];
				if (hitAt < 0) hitAt = k;
				if (k === hitAt + 10) ctxOf(on).damageActor(a, 1);
				if (k === hitAt + 20) ctxOf(on).killActor(a);
			}
			tick(on);
			tick(off);
			expect([k, on.s.rngState, on.s.drops!.rngState]).toEqual([k, off.s.rngState, off.s.drops!.rngState]);
		}
		expect(g.status).toBe(GoldenStatus.CAUGHT);
		expect(g.events.caught === undefined).toBe(true); // cleared on later ticks
		expect(on.s.score!.points[ScoreSource.GOLDEN]).toBeGreaterThan(0);
	});
});
