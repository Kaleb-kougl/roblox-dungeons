// docs/BUILDS_V2.md BV7 (the gap-3 duos): Full Heart (Hearty + Sharpened: at full hearts every finisher and every heavy
// arrow release strikes a beam along the facing / the arrow's aim, every living enemy within FULL_HEART_RADIUS of the
// segment to FULL_HEART_RANGE, slot order, for playerHitDamage(finisherDamage), gen 0) and Happy Hour (Deep Flask +
// Bounty: a drink sets happyHourTicks to HAPPY_HOUR_TICKS; the owner's kill points x HAPPY_HOUR_KILL_PERCENT while it
// runs, folded into Bounty's bonusPercent as one integer percent).
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOW_DATA,
	BUILDS_CONFIG,
	Boon,
	Button,
	DEFAULT_BOUNDS,
	DEFAULT_KILL_POINTS,
	Duo,
	EMPTY_INPUT,
	FLASK_USE_TICKS,
	FULL_HEART_RADIUS,
	FULL_HEART_RANGE,
	HAPPY_HOUR_KILL_PERCENT,
	HAPPY_HOUR_TICKS,
	KILL_POINTS,
	KILL_POINTS_BOON_PERCENTS,
	SKEWER_RADIUS,
	SWARMER,
	SWORD_DATA,
	SimCtx,
	awardPoints,
	createSimState,
	floorScalePercent,
	fullHeartBeam,
	grantCard,
	hashState,
	playerHitDamage,
	scoreFloor,
	step,
	type ActorState,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const IDLE = EMPTY_INPUT;
const HOLD_FIRE = frame(0, 0, Button.FIRE, 0, 1);
const HOLD_ALT = frame(0, 0, Button.ALT, 0, 1);

interface ArenaOpts {
	loadout?: ReadonlyArray<string>;
	spawns?: ReadonlyArray<{ kind: string; x: number; z: number }>;
}

function arena(opts: ArenaOpts = {}): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					bounds: DEFAULT_BOUNDS,
					loadout: opts.loadout,
					encounter: { spawns: opts.spawns ?? [], rooms: [], entranceRoom: -1, bossRoom: -1 },
				},
				bossFloor: false,
				spawnX: 0,
				spawnZ: 0,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: [],
				roomIdAt: () => -1,
			};
			cache.set(floor, w);
		}
		return w;
	};
}

function configOf(opts: ArenaOpts = {}, extra: Partial<SimConfig> = {}): SimConfig {
	return { endless: { runSeed: SEED, worldForFloor: arena(opts) }, scoring: {}, builds: BUILDS_CONFIG, ...extra };
}

const ARENA = configOf();
const BOW_ARENA = configOf({ loadout: ["weapon.bow"] });
const PARTY2 = configOf({}, { scoring: { partySize: 2 }, party: { size: 2 } });

function fresh(config: SimConfig = ARENA): SimState {
	return createSimState(SEED, 0, 0, config);
}

function ctxOf(s: SimState, config: SimConfig = ARENA): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

/** A stationary 'test.dummy' (radius 0.5) with `hp`, a target from this tick on. */
function dummy(ctx: SimCtx, x: number, z: number, hp = 100): ActorState {
	const a = ctx.spawnActor("test.dummy", x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

/** A Full Heart owner (the duo and Sharpened I, granted as in play). */
function fullHeartOwner(config: SimConfig = ARENA): SimState {
	const s = fresh(config);
	grantCard(s, 0, Boon.SHARPENED);
	s.builds!.players[0].duos.push(Duo.FULL_HEART);
	return s;
}

describe("Full Heart (Hearty + Sharpened, BV7)", () => {
	it("tunables: Skewer's radius, 4 tiles", () => {
		expect([FULL_HEART_RADIUS, FULL_HEART_RANGE]).toEqual([SKEWER_RADIUS, 4]);
	});

	it("a finisher at full hearts strikes the beam: an enemy out of the swing's reach on the line takes the finisher's damage", () => {
		const s = fullHeartOwner();
		const ctx = ctxOf(s);
		const far = dummy(ctx, 0, 4); // past the finisher's reach (2.53 + its radius) after the lunge, inside the beam
		const off = dummy(ctx, 3, 2); // off the line
		const beam = playerHitDamage(s, 0, SWORD_DATA.finisherDamage);
		expect(beam > SWORD_DATA.finisherDamage).toBe(true); // Sharpened applies
		let beams = 0;
		for (let t = 0; t < 120 && beams === 0; t++) {
			step(s, HOLD_FIRE, ARENA);
			const e = s.builds!.events;
			beams += e.beamOwner.size();
			if (e.beamOwner.size() > 0) {
				expect([e.beamOwner, e.beamStruck]).toEqual([[0], [1]]);
				expect([e.beamX1[0], e.beamX2[0]]).toEqual([s.player.x, s.player.x]);
				expect([e.beamZ1[0], e.beamZ2[0]]).toEqual([s.player.z, s.player.z + FULL_HEART_RANGE]);
			}
		}
		expect(beams).toBe(1);
		expect([far.hp, off.hp]).toEqual([100 - beam, 100]);
	});

	it("never below full hearts, without the duo, or for a dead owner", () => {
		function beams(prepare: (s: SimState) => void): number {
			const s = fullHeartOwner();
			const ctx = ctxOf(s);
			dummy(ctx, 0, 4);
			prepare(s);
			let n = 0;
			for (let t = 0; t < 120; t++) {
				step(s, HOLD_FIRE, ARENA);
				n += s.builds!.events.beamOwner.size();
			}
			return n;
		}
		expect(beams(() => undefined) > 0).toBe(true);
		expect(beams((s) => (s.player.hearts = s.player.heartsMax - 1))).toBe(0);
		expect(beams((s) => s.builds!.players[0].duos.clear())).toBe(0);
		const s = fullHeartOwner();
		const ctx = ctxOf(s);
		s.player.dead = 1;
		expect(fullHeartBeam(ctx, 0, 1)).toBe(-1);
		expect(s.builds!.events.beamOwner.size()).toBe(0);
	});

	it("a heavy arrow's release at full hearts strikes the beam along the arrow's aim (the stream never does)", () => {
		function release(full: boolean): { s: SimState; d: ActorState; side: ActorState } {
			const s = fullHeartOwner(BOW_ARENA);
			if (!full) s.player.hearts = s.player.heartsMax - 1;
			const ctx = ctxOf(s, BOW_ARENA);
			const d = dummy(ctx, 0, 3);
			const side = dummy(ctx, -2, 2);
			for (let t = 0; t < BOW_DATA.chargeTicks; t++) {
				step(s, HOLD_ALT, BOW_ARENA);
				expect(s.builds!.events.beamOwner.size()).toBe(0);
			}
			step(s, IDLE, BOW_ARENA); // ALT released: the heavy arrow and the beam
			return { s, d, side };
		}
		const on = release(true);
		const e = on.s.builds!.events;
		expect([e.beamOwner, e.beamStruck, e.beamX2, e.beamZ2]).toEqual([[0], [1], [0], [FULL_HEART_RANGE]]);
		const beam = playerHitDamage(on.s, 0, SWORD_DATA.finisherDamage);
		expect([on.d.hp, on.side.hp]).toEqual([100 - beam, 100]); // the arrow has not reached it yet
		const off = release(false);
		expect([off.s.builds!.events.beamOwner.size(), off.d.hp]).toEqual([0, 100]);
		// The stream (FIRE held) fires no beam.
		const st = fullHeartOwner(BOW_ARENA);
		let n = 0;
		for (let t = 0; t < 60; t++) {
			step(st, HOLD_FIRE, BOW_ARENA);
			n += st.builds!.events.beamOwner.size();
		}
		expect(n).toBe(0);
	});

	it("strikes every enemy on the line in slot order, chosen before any strike; its kills proc at gen 0", () => {
		const s = fullHeartOwner();
		s.builds!.players[0].levels[Boon.CHAIN_SPARK] = 1; // an on-kill boon, so the kills queue procs
		const ctx = ctxOf(s);
		ctx.actingPlayer(0);
		const a = dummy(ctx, 0, 1, 1);
		const b = dummy(ctx, 0.4, 3.9, 1); // inside the radius of the end
		const c = dummy(ctx, 0.6, 2); // 0.6 > SKEWER_RADIUS from the line
		const d = dummy(ctx, 0, -1); // behind
		expect(fullHeartBeam(ctx, 0, 1)).toBe(2);
		expect([a.alive, b.alive, c.hp, d.hp]).toEqual([0, 0, 100, 100]);
		const procs = s.builds!.procs;
		expect(procs.map((q) => [q.slot, q.gen])).toEqual([
			[0, 0],
			[1, 0],
		]);
		expect(ctx.procGen).toBe(0);
	});

	it("co-op: each player's own hearts and duo; the beam is credited to its owner", () => {
		const s = createSimState(SEED, 0, 0, PARTY2);
		s.builds!.players[1].duos.push(Duo.FULL_HEART);
		const ctx = ctxOf(s, PARTY2);
		const target = dummy(ctx, 0, 2);
		ctx.actingPlayer(0);
		expect(fullHeartBeam(ctx, 0, 1)).toBe(-1);
		ctx.actingPlayer(1);
		expect(target.alive).toBe(1);
		expect(fullHeartBeam(ctx, 0, 1) >= 0).toBe(true);
		expect(s.builds!.events.beamOwner).toEqual([1]);
	});
});

describe("Happy Hour (Deep Flask + Bounty, BV7)", () => {
	function owner(bounty: number): SimState {
		const s = fresh();
		for (let k = 0; k < bounty; k++) grantCard(s, 0, Boon.BOUNTY);
		s.builds!.players[0].duos.push(Duo.HAPPY_HOUR);
		s.player.hearts = s.player.heartsMax - 2;
		return s;
	}

	const BASE = KILL_POINTS.get("test.dummy") ?? DEFAULT_KILL_POINTS;

	/**
	 * One fresh dummy's kill by `player` now: [its points, the award at bonusPercent `percent` read just before it (the
	 * kill then feeds the combo)].
	 */
	function kill(s: SimState, percent: number, player = 0, config: SimConfig = ARENA): [number, number] {
		const sc = s.score!;
		const expected = awardPoints(s, sc, BASE, floorScalePercent(scoreFloor(s)), percent);
		const ctx = ctxOf(s, config);
		ctx.actingPlayer(player);
		ctx.damageActor(dummy(ctx, 5 + sc.events.popPoints.size(), 5, 1), 1);
		const pops = sc.events.popPoints;
		return [pops[pops.size() - 1], expected];
	}

	it("a drink starts it: HAPPY_HOUR_TICKS on the drink tick, counted down once a tick, a happyPlayer entry", () => {
		expect([HAPPY_HOUR_TICKS, HAPPY_HOUR_KILL_PERCENT]).toEqual([300, 200]);
		const s = owner(1);
		step(s, frame(0, 0, Button.FLASK), ARENA);
		expect(s.player.flaskTicks).toBe(FLASK_USE_TICKS);
		expect([s.builds!.players[0].happyHourTicks, s.builds!.events.happyPlayer]).toEqual([HAPPY_HOUR_TICKS, [0]]);
		step(s, IDLE, ARENA);
		expect([s.builds!.players[0].happyHourTicks, s.builds!.events.happyPlayer]).toEqual([HAPPY_HOUR_TICKS - 1, []]);
		// Without the duo a drink starts nothing.
		const plain = fresh();
		plain.player.hearts = plain.player.heartsMax - 2;
		step(plain, frame(0, 0, Button.FLASK), ARENA);
		expect([plain.builds!.players[0].happyHourTicks, plain.builds!.events.happyPlayer]).toEqual([0, []]);
	});

	it("doubles the owner's kill points for 300 ticks after a drink, multiplied with Bounty in one integer percent", () => {
		for (const level of [0, 1, 3]) {
			const s = owner(level);
			const bountyPercent = level > 0 ? KILL_POINTS_BOON_PERCENTS[level - 1] : 100;
			const doubled = (bountyPercent * HAPPY_HOUR_KILL_PERCENT) / 100;
			const before = kill(s, bountyPercent);
			expect([level, before[0]]).toEqual([level, before[1]]);
			step(s, frame(0, 0, Button.FLASK), ARENA);
			const first = kill(s, doubled);
			expect([level, first[0]]).toEqual([level, first[1]]);
			for (let t = 1; t < HAPPY_HOUR_TICKS; t++) step(s, IDLE, ARENA);
			expect(s.builds!.players[0].happyHourTicks).toBe(1); // 300 ticks after the drink's, the last one
			const last = kill(s, doubled);
			expect([level, last[0]]).toEqual([level, last[1]]);
			step(s, IDLE, ARENA);
			expect(s.builds!.players[0].happyHourTicks).toBe(0);
			const after = kill(s, bountyPercent);
			expect([level, after[0]]).toEqual([level, after[1]]);
			expect(last[0] > after[0]).toBe(true);
		}
		expect((KILL_POINTS_BOON_PERCENTS[2] * HAPPY_HOUR_KILL_PERCENT) / 100).toBe(260);
	});

	it("co-op: only the drinker's kills; a teammate's kill pays as before", () => {
		const s = createSimState(SEED, 0, 0, PARTY2);
		s.builds!.players[0].duos.push(Duo.HAPPY_HOUR);
		s.builds!.players[0].happyHourTicks = 10;
		const mate = kill(s, 100, 1, PARTY2);
		expect(mate[0]).toBe(mate[1]);
		const own = kill(s, HAPPY_HOUR_KILL_PERCENT, 0, PARTY2);
		expect(own[0]).toBe(own[1]);
	});
});

describe("Full Heart and Happy Hour: determinism in a dense room", () => {
	const PACK = [
		[-1, 2],
		[0, 2.5],
		[1, 2],
		[-2, 3],
		[0, 3.5],
		[2, 3],
		[-1, 4],
		[1, 4],
	] as const;
	const config = configOf({ spawns: PACK.map(([x, z]) => ({ kind: SWARMER.id, x, z })) });

	function run(): { hashes: string[]; beams: number; happy: number } {
		const s = fresh(config);
		for (const boon of [Boon.HEARTY, Boon.SHARPENED, Boon.DEEP_FLASK, Boon.BOUNTY]) grantCard(s, 0, boon);
		s.builds!.players[0].duos.push(Duo.FULL_HEART, Duo.HAPPY_HOUR);
		const hashes: string[] = [];
		let beams = 0;
		let happy = 0;
		for (let t = 0; t < 150; t++) {
			// A drink at tick 100 (a wound first, so the flask can be taken).
			if (t === 99) s.player.hearts = s.player.heartsMax - 1;
			const input: InputFrame = t === 100 ? frame(0, 0, Button.FLASK | Button.FIRE, 0, 1) : HOLD_FIRE;
			step(s, input, config);
			hashes.push(hashState(s));
			beams += s.builds!.events.beamOwner.size();
			happy += s.builds!.events.happyPlayer.size();
		}
		return { hashes, beams, happy };
	}

	it("two runs hash the same every tick", () => {
		const a = run();
		const b = run();
		expect(a.hashes).toEqual(b.hashes);
		expect(a.beams > 0).toBe(true);
		expect(a.happy).toBe(1);
	});
});
