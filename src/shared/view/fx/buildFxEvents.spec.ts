// The build effects collector (docs/BUILDS.md BU8, "Presentation feed"):
//   - hand-filled BuildEvents arrays (the sim's BU3 / BU4 pushes): a frame of several ticks keeps every spark, ring,
//     volley and take in order with its tick; reset forgets them; a run without builds collects nothing
//   - embers come from the player bullet simulation (a new EMBER slot, once), owner and gen from the bullet
//   - BU5's nova / execute fields are read when the feed carries them (the plan's names), else nothing
//   - audibleBuilds' quiet gate
//   - the run views' wiring: LiveRun collects a real Chain Spark + Volatile proc tick by tick; LockstepClient per pump
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import { LockstepClient, MergedEncoder } from "shared/lockstep";
import { LiveRun } from "shared/play";
import { buildEndlessRunConfig } from "shared/run";
import {
	BUILDS_CONFIG,
	Boon,
	BuildEffect,
	EMBER_BURST,
	EMPTY_INPUT,
	SimCtx,
	clearBuildEvents,
	createSimState,
	fireEffect,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { comboQuiet } from "./comboEvents";
import { BuildFxEvents, NO_BUILD_FX_EVENTS, audibleBuilds } from "./buildFxEvents";

const SEED = 4242;

function buildsState(players = 1): SimState {
	const config: SimConfig =
		players > 1 ? { builds: BUILDS_CONFIG, party: { size: players } } : { builds: BUILDS_CONFIG };
	return createSimState(SEED, 0, 0, config);
}

interface Hop {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	gen: number;
}

/** One tick by hand: the build events clear, these are pushed (as stepBuilds / grantCard do), tick += 1. */
function tickWith(
	state: SimState,
	hops: ReadonlyArray<Hop>,
	bursts: ReadonlyArray<[number, number, number, number, number]> = [],
	evolved: ReadonlyArray<[number, number]> = [],
): void {
	const b = state.builds!;
	clearBuildEvents(b);
	const e = b.events;
	for (const h of hops) {
		e.sparkX1.push(h.x1);
		e.sparkZ1.push(h.z1);
		e.sparkX2.push(h.x2);
		e.sparkZ2.push(h.z2);
		e.sparkOwner.push(h.owner);
		e.sparkGen.push(h.gen);
	}
	for (const [x, z, owner, gen, fired] of bursts) {
		e.burstX.push(x);
		e.burstZ.push(z);
		e.burstOwner.push(owner);
		e.burstGen.push(gen);
		e.burstFired.push(fired);
		e.shardX.push(-x);
		e.shardZ.push(-z);
		e.shardOwner.push(owner);
		e.shardGen.push(gen + 1);
		e.shardFired.push(fired + 1);
	}
	for (const [p, boon] of evolved) {
		e.evolvedPlayer.push(p);
		e.evolvedBoon.push(boon);
		e.duoPlayer.push(p);
		e.duoTaken.push(boon + 1);
	}
	state.tick += 1;
}

describe("BuildFxEvents", () => {
	it("keeps every hop, ring, volley and take of a multi-tick frame, in order, with its tick", () => {
		const state = buildsState(2);
		const ev = new BuildFxEvents();
		ev.reset();
		const t0 = state.tick;
		tickWith(
			state,
			[
				{ x1: 1, z1: 2, x2: 3, z2: 4, owner: 0, gen: 0 },
				{ x1: 3, z1: 4, x2: 5, z2: 6, owner: 0, gen: 1 },
			],
			[[7, 8, 1, 0, 8]],
		);
		ev.collect(state);
		tickWith(state, []);
		ev.collect(state);
		tickWith(state, [{ x1: -1, z1: -2, x2: -3, z2: -4, owner: 1, gen: 2 }], [], [[1, Boon.VOLATILE]]);
		ev.collect(state);
		expect(ev.ticks).toBe(3);
		expect(ev.sparks.map((s) => [s.x1, s.z1, s.x2, s.z2, s.owner, s.gen, s.tick - t0])).toEqual([
			[1, 2, 3, 4, 0, 0, 1],
			[3, 4, 5, 6, 0, 1, 1],
			[-1, -2, -3, -4, 1, 2, 3],
		]);
		expect(ev.bursts.map((r) => [r.x, r.z, r.owner, r.gen, r.amount, r.tick - t0])).toEqual([[7, 8, 1, 0, 8, 1]]);
		expect(ev.shards.map((r) => [r.x, r.z, r.owner, r.gen, r.amount])).toEqual([[-7, -8, 1, 1, 9]]);
		expect(ev.evolved.map((t) => [t.player, t.index, t.tick - t0])).toEqual([[1, Boon.VOLATILE, 3]]);
		expect(ev.duos.map((t) => [t.player, t.index])).toEqual([[1, Boon.VOLATILE + 1]]);
		expect(ev.count()).toBe(3 + 1 + 1 + 1 + 1);
		// No BU5 fields in this feed yet (or empty ones): no novas, executes or Jackpot pops.
		expect([ev.novas.size(), ev.executes.size(), ev.jackpots.size()]).toEqual([0, 0, 0]);
	});

	it("reset forgets the frame and reuses its records", () => {
		const state = buildsState();
		const ev = new BuildFxEvents();
		tickWith(state, [{ x1: 0, z1: 0, x2: 1, z2: 1, owner: 0, gen: 0 }]);
		ev.collect(state);
		const first = ev.sparks[0];
		ev.reset();
		expect([ev.ticks, ev.count()]).toEqual([0, 0]);
		tickWith(state, [{ x1: 2, z1: 2, x2: 3, z2: 3, owner: 0, gen: 1 }]);
		ev.collect(state);
		expect(ev.sparks[0]).toBe(first);
		expect([ev.sparks[0].x1, ev.sparks[0].gen]).toEqual([2, 1]);
	});

	it("collects nothing without builds (M1, the tutorial, fixtures)", () => {
		const state = createSimState(SEED, 0, 0, {});
		expect(state.builds).toBe(undefined);
		const ev = new BuildFxEvents();
		state.tick += 1;
		ev.collect(state);
		expect([ev.ticks, ev.count()]).toEqual([0, 0]);
	});

	it("an ember is collected once, on the tick it appears, with its owner and generation", () => {
		const state = buildsState(2);
		const ctx = new SimCtx().bind(state, { builds: BUILDS_CONFIG, party: { size: 2 } }, EMPTY_INPUT);
		const ev = new BuildFxEvents();
		expect(fireEffect(ctx, 1, 2, 3, 0, 1, EMBER_BURST, BuildEffect.EMBER, 1)).toBe(1);
		ev.collect(state);
		expect(ev.embers.map((r) => [r.x, r.z, r.owner, r.gen, r.amount])).toEqual([[2, 3, 1, 1, 1]]);
		// The same ember a tick later (life falling): not new.
		ev.reset();
		state.combat.playerBullets.step(1 / 60);
		ev.collect(state);
		expect(ev.embers.size()).toBe(0);
		// Unchanged life (a frozen tick): still not new. A second ember: new.
		ev.collect(state);
		expect(ev.embers.size()).toBe(0);
		fireEffect(ctx, 0, -1, -1, 0, 1, EMBER_BURST, BuildEffect.EMBER, 0);
		ev.collect(state);
		expect(ev.embers.map((r) => [r.x, r.z, r.owner, r.gen])).toEqual([[-1, -1, 0, 0]]);
	});

	it("reads BU5's nova and execute fields when the feed carries them (the plan's names)", () => {
		const state = buildsState();
		const ev = new BuildFxEvents();
		const e = state.builds!.events as unknown as Record<string, number[]>;
		e.novaX = [4];
		e.novaZ = [5];
		e.novaRadius = [3];
		e.novaOwner = [0];
		e.novaKind = [1];
		e.execX = [6, 7];
		e.execZ = [8, 9];
		state.tick += 1;
		ev.collect(state);
		expect(ev.novas.map((r) => [r.x, r.z, r.owner, r.amount, r.kind])).toEqual([[4, 5, 0, 3, 1]]);
		expect(ev.executes.map((r) => [r.x, r.z])).toEqual([
			[6, 8],
			[7, 9],
		]);
	});

	it("audibleBuilds passes the source through, or nothing while quiet (stage cover, run over)", () => {
		const ev = new BuildFxEvents();
		expect(audibleBuilds(ev, comboQuiet(false, false))).toBe(ev);
		expect(audibleBuilds(ev, comboQuiet(true, false))).toBe(NO_BUILD_FX_EVENTS);
		expect(audibleBuilds(ev, comboQuiet(false, true))).toBe(NO_BUILD_FX_EVENTS);
		expect([NO_BUILD_FX_EVENTS.ticks, NO_BUILD_FX_EVENTS.sparks.size(), NO_BUILD_FX_EVENTS.evolved.size()]).toEqual(
			[0, 0, 0],
		);
	});
});

describe("RunView.builds wiring", () => {
	it("LiveRun collects a real proc's hop and ring on the tick they resolve, and resets per frame", () => {
		const runSeed = 7;
		const setup = buildEndlessRunConfig(runSeed);
		let sparks = 0;
		let bursts = 0;
		const run = new LiveRun({
			seed: runSeed,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
			runId: "builds",
			segmentCutAfterTick: (s) => {
				sparks += s.builds!.events.sparkX1.size();
				bursts += s.builds!.events.burstX.size();
				return false;
			},
		});
		run.frame(1 / 60, EMPTY_INPUT);
		expect(run.builds.ticks).toBe(1);
		const state = run.state;
		const levels = state.builds!.players[0].levels;
		levels[Boon.CHAIN_SPARK] = 1;
		levels[Boon.VOLATILE] = 1;
		const world = setup.config.endless!.worldForFloor(state.endless!.floor);
		const ctx = new SimCtx().bind(state, world.config, EMPTY_INPUT);
		const px = state.player.x;
		const pz = state.player.z;
		const victim = ctx.spawnActor("test.dummy", px + 1, pz)!;
		const target = ctx.spawnActor("test.dummy", px + 2, pz)!;
		for (const a of [victim, target]) {
			a.hp = 10;
			a.hpMax = 10;
			a.spawnTick = -1;
		}
		ctx.actingPlayer(0);
		ctx.damageActor(victim, victim.hp);
		const input: InputFrame = { ...EMPTY_INPUT };
		let totalSparks = 0;
		let totalBursts = 0;
		const deltas = [1 / 60, 3 / 60, 2 / 60];
		for (let n = 0; n < 6; n++) {
			sparks = 0;
			bursts = 0;
			const ticks = run.frame(deltas[n % deltas.size()], input);
			expect(run.builds.ticks).toBe(ticks);
			expect([run.builds.sparks.size(), run.builds.bursts.size()]).toEqual([sparks, bursts]);
			totalSparks += sparks;
			totalBursts += bursts;
		}
		expect(totalSparks >= 1).toBe(true);
		expect(totalBursts >= 1).toBe(true);
		run.frame(0, input);
		expect([run.builds.ticks, run.builds.count()]).toEqual([0, 0]);
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
			expect(c.builds.ticks).toBe(r.stepped);
			total += r.stepped;
		}
		expect(total).toBe(c.state.tick);
		expect(total > 0).toBe(true);
		c.pump(1 / 60, () => EMPTY_INPUT);
		expect(c.builds.ticks).toBe(0);
	});
});
