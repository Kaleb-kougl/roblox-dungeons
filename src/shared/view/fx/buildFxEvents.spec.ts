// The build effects collector (docs/BUILDS.md BU8, "Presentation feed"):
//   - hand-filled BuildEvents arrays (the sim's BU3 / BU4 pushes): a frame of several ticks keeps every spark, ring,
//     volley and take in order with its tick; reset forgets them; a run without builds collects nothing
//   - embers come from the player bullet simulation (a new EMBER slot, once), owner and gen from the bullet
//   - every BU5 field (sparkFork, novas, executes, Phantom Step, Jackpot, Lionheart, Momentum, Thrill Seeker, Flurry,
//     Ricochet) becomes a record of its list with the right amount / kind, per tick, reset per frame
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
	FlurryKind,
	JACKPOT_KILLS,
	NovaKind,
	OVERFLOWING_NOVA_RADIUS,
	SimCtx,
	clearBuildEvents,
	createSimState,
	fireEffect,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { comboQuiet } from "./comboEvents";
import { BuildFxEvents, NO_BUILD_FX_EVENTS, audibleBuilds, type EffectRecord } from "./buildFxEvents";

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
		// No BU5 entries pushed: no novas, executes, Jackpot pops or releases; hand-pushed sparks without sparkFork are hops.
		expect([ev.novas.size(), ev.executes.size(), ev.jackpots.size(), ev.momentum.size()]).toEqual([0, 0, 0, 0]);
		expect(ev.sparks.map((r) => r.fork)).toEqual([false, false, false]);
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

	it("collects every BU5 field into its list (amount / kind per list, gen 0), per tick, and reset forgets them", () => {
		const state = buildsState(2);
		const ev = new BuildFxEvents();
		const t0 = state.tick;
		const fill = () => {
			const b = state.builds!;
			clearBuildEvents(b);
			const e = b.events;
			e.sparkX1.push(0, 1);
			e.sparkZ1.push(0, 1);
			e.sparkX2.push(1, 2);
			e.sparkZ2.push(1, 2);
			e.sparkOwner.push(0, 0);
			e.sparkGen.push(0, 1);
			e.sparkFork.push(0, 1);
			e.novaX.push(4);
			e.novaZ.push(5);
			e.novaRadius.push(OVERFLOWING_NOVA_RADIUS);
			e.novaOwner.push(1);
			e.novaKind.push(NovaKind.BULWARK);
			e.novaErased.push(7);
			e.execX.push(6, 7);
			e.execZ.push(8, 9);
			e.execOwner.push(0, 1);
			e.phantomX.push(-1);
			e.phantomZ.push(-2);
			e.phantomOwner.push(1);
			e.jackpotX.push(3);
			e.jackpotZ.push(3.5);
			e.jackpotOwner.push(0);
			e.jackpotPoints.push(240);
			e.lionPlayer.push(1);
			e.lionHealed.push(1);
			e.momentumX.push(10);
			e.momentumZ.push(11);
			e.momentumOwner.push(0);
			e.momentumTier.push(3);
			e.momentumFired.push(3);
			e.thrillX.push(12);
			e.thrillZ.push(13);
			e.thrillOwner.push(1);
			e.thrillFired.push(8);
			e.flurryX.push(14);
			e.flurryZ.push(15);
			e.flurryOwner.push(0);
			e.flurryKind.push(FlurryKind.ARROWS);
			e.flurryFired.push(3);
			e.ricochetX.push(16);
			e.ricochetZ.push(17);
			e.ricochetOwner.push(1);
			e.ricochetFired.push(2);
			state.tick += 1;
		};
		const p1 = state.party!.players[1];
		p1.x = 20;
		p1.z = 21;
		fill();
		ev.collect(state);
		const fx = (list: ReadonlyArray<EffectRecord>) => list.map((r) => [r.x, r.z, r.owner, r.gen, r.amount, r.kind]);
		expect(ev.sparks.map((r) => r.fork)).toEqual([false, true]);
		expect(fx(ev.novas)).toEqual([[4, 5, 1, 0, OVERFLOWING_NOVA_RADIUS, NovaKind.BULWARK]]);
		expect(ev.novas[0].erased).toBe(7);
		expect(fx(ev.executes)).toEqual([
			[6, 8, 0, 0, 1, 0],
			[7, 9, 1, 0, 1, 0],
		]);
		expect(fx(ev.phantoms)).toEqual([[-1, -2, 1, 0, 1, 0]]);
		expect(fx(ev.jackpots)).toEqual([[3, 3.5, 0, 0, 240, 0]]);
		// Lionheart: the healed player, where they stood, half hearts restored.
		expect(fx(ev.heals)).toEqual([[20, 21, 1, 0, 1, 0]]);
		expect(fx(ev.momentum)).toEqual([[10, 11, 0, 0, 3, 3]]);
		expect(fx(ev.thrills)).toEqual([[12, 13, 1, 0, 8, 0]]);
		expect(fx(ev.flurries)).toEqual([[14, 15, 0, 0, 3, FlurryKind.ARROWS]]);
		expect(fx(ev.ricochets)).toEqual([[16, 17, 1, 0, 2, 0]]);
		expect(ev.count()).toBe(2 + 1 + 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
		// A second tick in the same frame appends, each record keeping its tick.
		fill();
		ev.collect(state);
		expect([ev.ticks, ev.thrills.size(), ev.thrills[0].tick - t0, ev.thrills[1].tick - t0]).toEqual([2, 2, 1, 2]);
		ev.reset();
		expect([ev.count(), ev.novas.size(), ev.heals.size(), ev.ricochets.size()]).toEqual([0, 0, 0, 0]);
	});

	it("the sim's own pushes: an Executioner kill and a Jackpot pay land in executes / jackpots", () => {
		const setup = buildEndlessRunConfig(7);
		const run = new LiveRun({
			seed: 7,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
			runId: "bu5",
		});
		run.frame(1 / 60, EMPTY_INPUT);
		const state = run.state;
		const levels = state.builds!.players[0].levels;
		levels[Boon.SHARPENED] = 3;
		levels[Boon.BOUNTY] = 3;
		const world = setup.config.endless!.worldForFloor(state.endless!.floor);
		const ctx = new SimCtx().bind(state, world.config, EMPTY_INPUT);
		ctx.actingPlayer(0);
		clearBuildEvents(state.builds!);
		for (let k = 0; k < JACKPOT_KILLS; k++) {
			const a = ctx.spawnActor("test.dummy", state.player.x + 1 + k / 8, state.player.z)!;
			a.hp = 10;
			a.hpMax = 10;
			a.spawnTick = -1;
			ctx.damageActor(a, 8); // leaves 20 %: executed
		}
		const ev = new BuildFxEvents();
		ev.collect(state);
		expect(ev.executes.size()).toBe(JACKPOT_KILLS);
		expect([ev.executes[0].x, ev.executes[0].owner]).toEqual([state.player.x + 1, 0]);
		expect(ev.jackpots.size()).toBe(1);
		expect([ev.jackpots[0].owner, ev.jackpots[0].amount > 0]).toEqual([0, true]);
		expect(ev.jackpots[0].amount).toBe(state.builds!.events.jackpotPoints[0]);
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
