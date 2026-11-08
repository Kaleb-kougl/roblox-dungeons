// Builds v2, wave 1's pure view core (docs/BUILDS_V2.md BV11):
//   - BuildFxEvents collects every wave 1 BuildEvents list per tick (frame reset, the tick each came from, owner),
//     Thunder Guard's sparks flagged (never a fork), Dragon Bolt's embers and Powder Keg's / Thunder Guard's duo procs
//     in the v1 lists; NO_BUILD_FX_EVENTS has every list
//   - CounterWaveFx: the radius is the sim's sweep (speed x age, capped), the fade, the arc / ring, Reduced, owners,
//     COUNTER xN for the view player only, quiet / new run, frame pacing (several ticks in one frame keep every wave)
//   - the parry ladder (semitones per bullet, cap) and FLOOR_SHOUT_PRIORITY's new entries
//   - BowFx: Ballista ring / fan, pins (start / end / the sim's records), the streak, the slam's ring (Full only),
//     freeze (solo, view player, freezeFrameOn) and PINNED / SLAM
//   - WreckerFx: smash pops and chips (Full only), Demolition rings on DEMOLITION_RADIUS, the chain's pitch
//   - HeartBeamFx: life, fade, Reduced, owners
//   - HappyHourFx: the local toast, the window from the drink tick, the pop tone; OvercapPops: the 0.25 s merge
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BUILDS_CONFIG,
	Boon,
	DEMOLITION_RADIUS,
	Duo,
	HAPPY_HOUR_TICKS,
	NOVA_HALF_ANGLE_COS,
	RIPOSTE_WAVE_HALF_ANGLE_COS,
	RIPOSTE_WAVE_RANGE,
	RIPOSTE_WAVE_SPEED,
	SIEGE_SHOCK_RADIUS,
	SIM_DT,
	SparkFork,
	WaveKind,
	clearBuildEvents,
	createSimState,
	playerAt,
	type BuildEvents,
	type SimState,
} from "shared/sim";
import { defaultJuiceSettings, type BuildFxLevel, type JuiceSettings } from "shared/settings";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { semitonesToSpeed } from "../hud/comboConfig";
import { FLOOR_SHOUT_PRIORITY } from "../hud/dailyRankConfig";
import { GOLDEN_VIEW } from "../golden/config";
import { buildGenSpeed } from "./buildFxRules";
import { BuildFxEvents, NO_BUILD_FX_EVENTS } from "./buildFxEvents";
import { BUILDS_V2_FX, OVERCAP_POP_MERGE_SEC } from "./buildsV2FxConfig";
import {
	FULL_RING_HALF_ANGLE,
	fanSegments,
	floorShoutText,
	isRiposteOwner,
	ownerOpacity,
	waveOneAgeSec,
} from "./buildsV2Fx";
import {
	CounterWaveFx,
	counterShoutFor,
	counterWaveFade,
	counterWaveHalfAngle,
	counterWaveLifeSec,
	counterWaveRadius,
	counterWaveSegments,
	riposteParrySemitones,
	riposteParrySpeed,
} from "./counterWaveFx";
import { BowFx, pinStreak, slamFreezeMs, type PinStreak } from "./siegeFx";
import { WreckerFx, smashChainLength, smashChipShape, smashSemitones, smashSpeed } from "./wreckerFx";
import { HeartBeamFx, heartBeamFade, heartBeamWidth } from "./heartBeamFx";
import {
	HappyHourFx,
	OVERCAP_POP_MERGE_TICKS,
	OvercapPops,
	happyHourOn,
	happyPopTone,
	overcapPopRise,
} from "./overcapFx";
import { SCORE_POP_LIFE, ScorePopTone, scorePopRise } from "./scorePops";

const SEED = 77;

function state(players = 1): SimState {
	return createSimState(
		SEED,
		0,
		0,
		players > 1 ? { builds: BUILDS_CONFIG, party: { size: players } } : { builds: BUILDS_CONFIG },
	);
}

function settings(buildFx: BuildFxLevel = "full", juice: Partial<JuiceSettings> = {}) {
	return { juice: { ...defaultJuiceSettings(), ...juice }, buildFx };
}

/** One tick by hand: the build events clear, `fill` pushes (as the sim's rules do), tick += 1, collect. */
function tick(s: SimState, ev: BuildFxEvents, fill: (e: BuildEvents) => void = () => undefined): void {
	const b = s.builds!;
	clearBuildEvents(b);
	fill(b.events);
	s.tick += 1;
	ev.collect(s);
}

function pushWave(e: BuildEvents, owner: number, count: number, kind: number = WaveKind.FORWARD, x = 0, z = 0): void {
	e.waveX.push(x);
	e.waveZ.push(z);
	e.waveDirX.push(1);
	e.waveDirZ.push(0);
	e.waveHalfCos.push(kind === WaveKind.FORWARD ? RIPOSTE_WAVE_HALF_ANGLE_COS : NOVA_HALF_ANGLE_COS);
	e.waveRange.push(RIPOSTE_WAVE_RANGE);
	e.waveSpeed.push(RIPOSTE_WAVE_SPEED);
	e.waveOwner.push(owner);
	e.waveDamage.push(math.min(count, 6));
	e.waveKind.push(kind);
	e.counterCount.push(count);
}

function pushPinStart(e: BuildEvents, slot: number, owner: number, x = 3, z = 4): void {
	e.pinStartSlot.push(slot);
	e.pinStartOwner.push(owner);
	e.pinStartX.push(x);
	e.pinStartZ.push(z);
}

function pushPinEnd(e: BuildEvents, slot: number, owner: number, carried: number, slam: boolean): void {
	e.pinEndSlot.push(slot);
	e.pinEndOwner.push(owner);
	e.pinEndCarried.push(carried);
	e.pinEndSlam.push(slam ? 1 : 0);
}

function pushSlam(e: BuildEvents, owner: number, x = 9, z = 4): void {
	e.slamX.push(x);
	e.slamZ.push(z);
	e.slamOwner.push(owner);
	e.slamStruck.push(2);
}

/** A carrying Siege Bolt record in the sim's state (what BowFx holds its pins to). */
function carry(s: SimState, slot: number, owner: number): void {
	s.builds!.pins.push({ bullet: 5, owner, slot, id: 100 + slot, x0: 3, z0: 4, slam: 0 });
}

/** A FloorShoutStrings fake (method syntax: interface methods are called with `:`). */
const STR = {
	str(k: string, v?: Readonly<Record<string, string | number>>): string {
		return v !== undefined ? `${k}|n=${v.n}` : k;
	},
};

describe("BuildFxEvents: builds v2, wave 1's lists (BV11)", () => {
	it("collects every wave 1 list per tick with its tick and owner; a frame of three ticks keeps them all", () => {
		const s = state(2);
		playerAt(s, 1).x = 10;
		playerAt(s, 1).z = 0;
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => {
			pushWave(e, 0, 4);
			e.ballistaX.push(4);
			e.ballistaZ.push(0);
			e.ballistaOwner.push(1);
			e.ballistaFired.push(10);
			e.ballistaWall.push(1);
			pushPinStart(e, 7, 1);
			e.smashX.push(2.5);
			e.smashZ.push(3.5);
			e.smashOwner.push(0);
			e.smashGen.push(0);
			e.smashFired.push(5);
			e.happyPlayer.push(0);
		});
		tick(s, ev, (e) => {
			pushWave(e, 1, 8, WaveKind.REBUKE);
			pushPinEnd(e, 7, 1, 4.5, true);
			pushSlam(e, 1);
			e.smashX.push(3.5);
			e.smashZ.push(3.5);
			e.smashOwner.push(0);
			e.smashGen.push(1);
			e.smashFired.push(5);
			e.demolitionX.push(3.5);
			e.demolitionZ.push(3.5);
			e.demolitionOwner.push(0);
		});
		tick(s, ev, (e) => {
			e.beamX1.push(0);
			e.beamZ1.push(0);
			e.beamX2.push(4);
			e.beamZ2.push(0);
			e.beamOwner.push(1);
			e.beamStruck.push(0);
			e.overcapX.push(6);
			e.overcapZ.push(6);
			e.overcapOwner.push(0);
			e.overcapPoints.push(23);
		});
		expect(ev.ticks).toBe(3);
		expect(ev.waves.map((w) => [w.owner, w.count, w.kind, w.tick, w.range, w.speed])).toEqual([
			[0, 4, WaveKind.FORWARD, 1, RIPOSTE_WAVE_RANGE, RIPOSTE_WAVE_SPEED],
			[1, 8, WaveKind.REBUKE, 2, RIPOSTE_WAVE_RANGE, RIPOSTE_WAVE_SPEED],
		]);
		expect([ev.waves[0].halfCos, ev.waves[1].halfCos]).toEqual([RIPOSTE_WAVE_HALF_ANGLE_COS, NOVA_HALF_ANGLE_COS]);
		// The fan's facing guess: toward the archer (player 1 at x = 10).
		const b = ev.ballistas[0];
		expect([b.owner, b.amount, b.kind, b.tick, b.dirX, b.dirZ]).toEqual([1, 10, 1, 1, 1, 0]);
		expect(ev.pinStarts.map((p) => [p.slot, p.owner, p.x, p.z, p.tick])).toEqual([[7, 1, 3, 4, 1]]);
		expect(ev.pinEnds.map((p) => [p.slot, p.owner, p.carried, p.slam, p.tick])).toEqual([[7, 1, 4.5, true, 2]]);
		expect(ev.slams.map((r) => [r.owner, r.amount, r.tick])).toEqual([[1, 2, 2]]);
		expect(ev.smashes.map((r) => [r.owner, r.gen, r.amount, r.tick])).toEqual([
			[0, 0, 5, 1],
			[0, 1, 5, 2],
		]);
		expect(ev.demolitions.map((r) => [r.x, r.owner, r.tick])).toEqual([[3.5, 0, 2]]);
		expect(ev.heartBeams.map((r) => [r.x2, r.owner, r.struck, r.tick])).toEqual([[4, 1, 0, 3]]);
		expect(ev.happyHours.map((r) => [r.player, r.tick])).toEqual([[0, 1]]);
		expect(ev.overcaps.map((r) => [r.owner, r.amount, r.tick])).toEqual([[0, 23, 3]]);
		expect(ev.count()).toBe(2 + 1 + 1 + 1 + 1 + 2 + 1 + 1 + 1 + 1);
		ev.reset();
		expect([ev.ticks, ev.count(), ev.waves.size(), ev.overcaps.size(), ev.pinStarts.size()]).toEqual([
			0, 0, 0, 0, 0,
		]);
	});

	it("Thunder Guard's sparks are flagged `thunder` and never a fork; Storm Crown's fork stays a fork", () => {
		const s = state();
		const ev = new BuildFxEvents();
		tick(s, ev, (e) => {
			for (const fork of [SparkFork.HOP, SparkFork.FORK, SparkFork.THUNDER]) {
				e.sparkX1.push(0);
				e.sparkZ1.push(0);
				e.sparkX2.push(1);
				e.sparkZ2.push(1);
				e.sparkOwner.push(0);
				e.sparkGen.push(0);
				e.sparkFork.push(fork);
			}
		});
		expect(ev.sparks.map((r) => [r.fork, r.thunder])).toEqual([
			[false, false],
			[true, false],
			[false, true],
		]);
	});

	it("Dragon Bolt's embers and Powder Keg's / Thunder Guard's duo procs land in the v1 lists", () => {
		const s = state();
		const ev = new BuildFxEvents();
		tick(s, ev, (e) => {
			e.emberX.push(1);
			e.emberZ.push(1);
			e.emberOwner.push(0);
			e.emberDuo.push(Duo.DRAGON_BOLT);
			for (const duo of [Duo.POWDER_KEG, Duo.THUNDER_GUARD]) {
				e.duoProcDuo.push(duo);
				e.duoProcOwner.push(0);
				e.duoProcX.push(2);
				e.duoProcZ.push(2);
				e.duoProcValue.push(1);
			}
		});
		expect(ev.embers.map((r) => r.kind)).toEqual([Duo.DRAGON_BOLT]);
		expect(ev.duoProcs.map((r) => r.kind)).toEqual([Duo.POWDER_KEG, Duo.THUNDER_GUARD]);
	});

	it("collects nothing without builds; NO_BUILD_FX_EVENTS holds every list, empty", () => {
		const s = createSimState(SEED, 0, 0);
		const ev = new BuildFxEvents();
		ev.collect(s);
		expect([ev.ticks, ev.count()]).toEqual([0, 0]);
		const none = NO_BUILD_FX_EVENTS;
		for (const l of [
			none.waves,
			none.ballistas,
			none.pinStarts,
			none.pinEnds,
			none.slams,
			none.smashes,
			none.demolitions,
			none.heartBeams,
			none.happyHours,
			none.overcaps,
		])
			expect(l.size()).toBe(0);
	});
});

describe("CounterWaveFx (BV11)", () => {
	const S = RIPOSTE_WAVE_SPEED;
	const R = RIPOSTE_WAVE_RANGE;

	it("the radius is the sim's sweep: speed x age capped at the range; it fades over fadeSec after reaching it", () => {
		expect(counterWaveRadius(S, R, 0)).toBe(0);
		expect(counterWaveRadius(S, R, SIM_DT)).toBeCloseTo(S * SIM_DT, 9);
		expect(counterWaveRadius(S, R, 10 * SIM_DT)).toBeCloseTo(4, 9);
		expect(counterWaveRadius(S, R, 1)).toBe(R);
		const grow = R / S;
		expect(counterWaveFade(S, R, grow)).toBe(1);
		expect(counterWaveFade(S, R, grow + BUILDS_V2_FX.counter.fadeSec / 2)).toBeCloseTo(0.5, 9);
		expect(counterWaveFade(S, R, grow + BUILDS_V2_FX.counter.fadeSec)).toBe(0);
		expect(counterWaveLifeSec(S, R)).toBeCloseTo(grow + BUILDS_V2_FX.counter.fadeSec, 9);
		// The sim removes a wave after the tick its radius reached the range: 18 ticks; the view's growth fits in it.
		expect(math.ceil(grow / SIM_DT)).toBe(18);
	});

	it("draws each wave on the sim's numbers: at tick + alpha the edge is the sim's radius between its two ticks", () => {
		const s = state();
		const ev = new BuildFxEvents();
		const fx = new CounterWaveFx();
		ev.reset();
		tick(s, ev, (e) => pushWave(e, 0, 4));
		const born = s.tick;
		// alpha 0 on its own tick: the bodies show the tick before, the wave 0; alpha 1: its first growth (0.4).
		let out = fx.frame(ev, s, 0, false, settings(), 0);
		expect(out.waves.size()).toBe(1);
		expect(out.waves[0].radius).toBe(0);
		out = fx.frame(NO_BUILD_FX_EVENTS, s, 0, false, settings(), 1);
		expect(out.waves[0].radius).toBeCloseTo(S * SIM_DT, 9);
		// k ticks later (alpha 0): the sim's radius at the end of the tick before, k x speed x SIM_DT.
		for (let k = 1; k <= 5; k++) {
			s.tick = born + k;
			out = fx.frame(NO_BUILD_FX_EVENTS, s, 0, false, settings(), 0.5);
			expect(out.waves[0].radius).toBeCloseTo((k + 0.5) * S * SIM_DT, 9);
			expect(out.waves[0].ageSec).toBeCloseTo(waveOneAgeSec(born, born + k, 0.5), 9);
		}
		// Gone once its life passed (sim time).
		s.tick = born + math.ceil(counterWaveLifeSec(S, R) / SIM_DT) + 1;
		expect(fx.frame(NO_BUILD_FX_EVENTS, s, 0, false, settings(), 0).waves.size()).toBe(0);
	});

	it("shape: FORWARD is a 120-degree crescent, RING / REBUKE full rings; Full a wide band and a glow, Reduced thin, none", () => {
		expect(counterWaveHalfAngle(RIPOSTE_WAVE_HALF_ANGLE_COS)).toBeCloseTo(math.pi / 3, 9);
		expect(counterWaveHalfAngle(NOVA_HALF_ANGLE_COS)).toBe(FULL_RING_HALF_ANGLE);
		const c = BUILDS_V2_FX.counter;
		expect(counterWaveSegments(FULL_RING_HALF_ANGLE, "full")).toBe(c.segments);
		expect(counterWaveSegments(FULL_RING_HALF_ANGLE, "reduced")).toBe(c.segments / 2);
		expect(counterWaveSegments(math.pi / 3, "full")).toBe(math.ceil(c.segments / 3));
		expect(counterWaveSegments(0.01, "full")).toBe(c.minArcSegments);
		const s = state();
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => {
			pushWave(e, 0, 4, WaveKind.FORWARD);
			pushWave(e, 0, 6, WaveKind.RING);
		});
		const full = new CounterWaveFx().frame(ev, s, 0, false, settings(), 0.9);
		expect(full.waves.map((w) => [w.kind, w.fullRing, w.glow, w.role])).toEqual([
			[WaveKind.FORWARD, false, true, "build.counter"],
			[WaveKind.RING, true, true, "build.counter"],
		]);
		// The band never wider than the radius (0.36 at alpha 0.9 < bandTiles).
		expect(full.waves[0].bandTiles).toBeCloseTo(math.min(c.bandTiles, 0.9 * S * SIM_DT), 9);
		const reduced = new CounterWaveFx().frame(ev, s, 0, false, settings("reduced"), 0.9);
		expect(reduced.waves.map((w) => [w.glow, w.bandTiles <= c.reducedBandTiles])).toEqual([
			[false, true],
			[false, true],
		]);
	});

	it("co-op: a teammate's wave is drawn at teammateOpacity and asks for no COUNTER; yours does, the highest count", () => {
		const s = state(2);
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => {
			pushWave(e, 1, 9);
			pushWave(e, 0, 3);
			pushWave(e, 0, 5);
		});
		const out = new CounterWaveFx().frame(ev, s, 0, false, settings(), 0);
		expect(out.waves.map((w) => [w.owner, w.mine, w.fade])).toEqual([
			[1, false, BUILDS_V2_FX.teammateOpacity],
			[0, true, 1],
			[0, true, 1],
		]);
		const shout = out.shout!;
		expect([shout.key, shout.vars?.n, shout.role, shout.priority, shout.player]).toEqual([
			"fx.counter.text",
			5,
			"build.counter",
			FLOOR_SHOUT_PRIORITY.counter,
			0,
		]);
		expect(floorShoutText(STR, shout)).toBe("fx.counter.text|n=5");
		expect(counterShoutFor(ev.waves, 1)?.vars?.n).toBe(9);
		expect(counterShoutFor(ev.waves, 2)).toBe(undefined);
		// The placeholder string reads COUNTER x5.
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		expect(floorShoutText(pack, shout)).toBe("COUNTER x5");
		// A player outside the party is ignored.
		const solo = state();
		const ev2 = new BuildFxEvents();
		tick(solo, ev2, (e) => pushWave(e, 3, 4));
		expect(new CounterWaveFx().frame(ev2, solo, 0, false, settings(), 0).waves.size()).toBe(0);
	});

	it("frame pacing: three ticks collected in one frame keep every wave, each aged by its own tick", () => {
		const s = state();
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => pushWave(e, 0, 1));
		tick(s, ev, (e) => pushWave(e, 0, 2));
		tick(s, ev, (e) => pushWave(e, 0, 3));
		const out = new CounterWaveFx().frame(ev, s, 0, false, settings(), 0);
		expect(out.waves.map((w) => w.count)).toEqual([1, 2, 3]);
		expect(out.waves[0].radius).toBeCloseTo(2 * S * SIM_DT, 9);
		expect(out.waves[1].radius).toBeCloseTo(S * SIM_DT, 9);
		expect(out.waves[2].radius).toBe(0);
		expect(out.shout?.vars?.n).toBe(3);
	});

	it("quiet forgets every wave and asks for nothing; a new run (another state, or the tick going back) too", () => {
		const s = state();
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => pushWave(e, 0, 4));
		const fx = new CounterWaveFx();
		expect(fx.frame(ev, s, 0, false, settings(), 0).waves.size()).toBe(1);
		const q = fx.frame(ev, s, 0, true, settings(), 0);
		expect([q.waves.size(), q.shout]).toEqual([0, undefined]);
		fx.frame(ev, s, 0, false, settings(), 0);
		expect(fx.frame(NO_BUILD_FX_EVENTS, state(), 0, false, settings(), 0).waves.size()).toBe(0);
		fx.frame(ev, s, 0, false, settings(), 0);
		s.tick -= 1;
		expect(fx.frame(NO_BUILD_FX_EVENTS, s, 0, false, settings(), 0).waves.size()).toBe(0);
	});

	it("the parry ladder: +semitoneStep per bullet after the first, capped at maxSemitones", () => {
		const l = BUILDS_V2_FX.parryLadder;
		expect([
			riposteParrySemitones(0),
			riposteParrySemitones(1),
			riposteParrySemitones(2),
			riposteParrySemitones(4),
		]).toEqual([0, 0, l.semitoneStep, 3 * l.semitoneStep]);
		expect(riposteParrySemitones(50)).toBe(l.maxSemitones);
		expect(riposteParrySpeed(4)).toBeCloseTo(semitonesToSpeed(3 * l.semitoneStep), 9);
		expect(riposteParrySpeed(1)).toBe(semitonesToSpeed(0));
	});

	it("isRiposteOwner reads the build's levels (false without builds or for an unknown player)", () => {
		const s = state(2);
		expect(isRiposteOwner(s, 0)).toBe(false);
		s.builds!.players[1].levels[Boon.RIPOSTE] = 1;
		expect([isRiposteOwner(s, 0), isRiposteOwner(s, 1), isRiposteOwner(s, 5)]).toEqual([false, true, false]);
		expect(isRiposteOwner(createSimState(SEED, 0, 0), 0)).toBe(false);
	});

	it("FLOOR_SHOUT_PRIORITY: COUNTER / PINNED / SLAM over BRACED and a tier, under every piece of news", () => {
		const P = FLOOR_SHOUT_PRIORITY;
		for (const p of [P.counter, P.pinned, P.slam]) {
			expect(p > P.brace && p > P.comboTier).toBe(true);
			expect(p < P.rankThreshold && p < P.goldenEscaped && p < P.horde && p < P.newBest).toBe(true);
		}
		expect(P.slam).toBe(P.pinned); // a tie: the later (the SLAM) wins
	});
});

describe("BowFx: Ballista and Siege Bolt (BV11)", () => {
	function ballista(e: BuildEvents, owner: number, wall: boolean, x = 4, z = 0): void {
		e.ballistaX.push(x);
		e.ballistaZ.push(z);
		e.ballistaOwner.push(owner);
		e.ballistaFired.push(6);
		e.ballistaWall.push(wall ? 1 : 0);
	}

	it("a ring for the last pierce, a fan facing the archer for a wall (a ring when the guess is 0 / 0)", () => {
		const s = state();
		playerAt(s, 0).x = 0;
		playerAt(s, 0).z = 0;
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => {
			ballista(e, 0, false);
			ballista(e, 0, true);
			ballista(e, 0, true, 0, 0);
		});
		const b = BUILDS_V2_FX.ballista;
		const out = new BowFx().frame(ev, s, 0, false, settings(), 0);
		expect(out.rings.size()).toBe(3);
		const [ring, fan, flat] = [out.rings[0], out.rings[1], out.rings[2]];
		expect([ring.block, ring.halfAngleRad, ring.segments, ring.role]).toEqual([
			b.ring,
			FULL_RING_HALF_ANGLE,
			b.ring.segments,
			"build.burst",
		]);
		expect([fan.block, fan.dirX, fan.dirZ, fan.halfAngleRad]).toEqual([b.fan, -1, 0, b.fanHalfAngleRad]);
		expect(fan.segments).toBe(fanSegments(b.fan.segments, b.fanHalfAngleRad));
		expect([flat.block, flat.halfAngleRad]).toEqual([b.fan, FULL_RING_HALF_ANGLE]);
		// Reduced: buildFxCount's segments; reduced motion: the ring sits at r1.
		const red = new BowFx().frame(ev, s, 0, false, settings("reduced", { reducedMotion: true }), 0);
		expect(red.rings[0].segments).toBe(b.ring.segments / 2);
		expect(red.rings[0].radius).toBe(b.ring.r1Tiles);
		// Aged on sim time: gone after its life.
		const fx = new BowFx();
		fx.frame(ev, s, 0, false, settings(), 0);
		s.tick += math.ceil(b.ring.sec / SIM_DT);
		expect(fx.frame(NO_BUILD_FX_EVENTS, s, 0, false, settings(), 0).rings.size()).toBe(0);
	});

	it("pins: held from pinStart to pinEnd, kept only while the sim carries them; PINNED once per view player pin", () => {
		const s = state(2);
		const ev = new BuildFxEvents();
		const fx = new BowFx();
		ev.reset();
		tick(s, ev, (e) => {
			pushPinStart(e, 7, 0);
			pushPinStart(e, 9, 1);
		});
		carry(s, 7, 0);
		carry(s, 9, 1);
		let out = fx.frame(ev, s, 0, false, settings(), 0.5);
		expect(out.pins.map((p) => [p.slot, p.owner, p.mine, p.sinceTick, p.x0, p.z0])).toEqual([
			[7, 0, true, s.tick, 3, 4],
			[9, 1, false, s.tick, 3, 4],
		]);
		expect(out.pins[0].ageSec).toBeCloseTo(0.5 * SIM_DT, 9);
		expect([out.shout?.key, out.shout?.priority, out.shout?.player]).toEqual([
			"fx.pinned.text",
			FLOOR_SHOUT_PRIORITY.pinned,
			0,
		]);
		// Next frame: no new start, no shout; the pins stay.
		ev.reset();
		tick(s, ev);
		out = fx.frame(ev, s, 0, false, settings(), 0);
		expect([out.pins.size(), out.shout]).toEqual([2, undefined]);
		// The sim drops player 1's record without an event (a departed archer): its pin ends.
		s.builds!.pins.remove(1);
		out = fx.frame(NO_BUILD_FX_EVENTS, s, 0, false, settings(), 0);
		expect(out.pins.map((p) => p.slot)).toEqual([7]);
		// pinEnd (a slam): ends; the slam's ring (Full), SLAM over PINNED, the freeze (solo only: none in co-op).
		ev.reset();
		tick(s, ev, (e) => {
			pushPinEnd(e, 7, 0, 5, true);
			pushSlam(e, 0);
		});
		s.builds!.pins.clear();
		out = fx.frame(ev, s, 0, false, settings(), 0);
		expect(out.pins.size()).toBe(0);
		expect(out.shout?.key).toBe("fx.slam.text");
		expect(out.freezeMs).toBe(0);
		const slamRing = out.rings[out.rings.size() - 1];
		expect([slamRing.block, slamRing.role]).toEqual([BUILDS_V2_FX.slam.ring, "build.burst"]);
	});

	it("frame pacing: a pin that starts and ends in one multi-tick frame never shows; one that starts after an end does", () => {
		const s = state();
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => pushPinStart(e, 4, 0));
		tick(s, ev, (e) => pushPinEnd(e, 4, 0, 1, false));
		tick(s, ev, (e) => pushPinStart(e, 4, 0, 8, 8));
		carry(s, 4, 0);
		const out = new BowFx().frame(ev, s, 0, false, settings(), 0);
		expect(out.pins.map((p) => [p.slot, p.sinceTick, p.x0])).toEqual([[4, s.tick, 8]]);
		const ev2 = new BuildFxEvents();
		const s2 = state();
		tick(s2, ev2, (e) => pushPinStart(e, 4, 0));
		tick(s2, ev2, (e) => pushPinEnd(e, 4, 0, 1, false));
		expect(new BowFx().frame(ev2, s2, 0, false, settings(), 0).pins.size()).toBe(0);
	});

	it("the slam: SIEGE_SHOCK_RADIUS ring (Full only), the Goldling catch's solo freeze for the view player only", () => {
		expect(BUILDS_V2_FX.slam.freezeMs).toBe(GOLDEN_VIEW.catchFreezeMs);
		const s = state();
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => pushSlam(e, 0));
		const fx = new BowFx();
		const out = fx.frame(ev, s, 0, false, settings("full", { reducedMotion: true }), 0);
		expect([out.rings.size(), out.rings[0].radius, out.shout?.key]).toEqual([
			1,
			SIEGE_SHOCK_RADIUS,
			"fx.slam.text",
		]);
		// Reduced motion: no freeze (freezeFrameOn); Freeze frame on: the freeze.
		expect(out.freezeMs).toBe(0);
		expect(new BowFx().frame(ev, s, 0, false, settings(), 0).freezeMs).toBe(BUILDS_V2_FX.slam.freezeMs);
		// Reduced: no shock ring; SLAM and the freeze stay.
		const red = new BowFx().frame(ev, s, 0, false, settings("reduced"), 0);
		expect([red.rings.size(), red.shout?.key, red.freezeMs]).toEqual([
			0,
			"fx.slam.text",
			BUILDS_V2_FX.slam.freezeMs,
		]);
		const juice = defaultJuiceSettings();
		expect([slamFreezeMs(0, 0, 1, juice), slamFreezeMs(1, 0, 1, juice), slamFreezeMs(0, 0, 2, juice)]).toEqual([
			BUILDS_V2_FX.slam.freezeMs,
			0,
			0,
		]);
		expect(slamFreezeMs(0, 0, 1, { ...juice, freezeFrame: false })).toBe(0);
		// A teammate's slam: its ring at teammateOpacity, no SLAM for you.
		const co = state(2);
		const ev2 = new BuildFxEvents();
		tick(co, ev2, (e) => pushSlam(e, 1));
		const coop = new BowFx().frame(ev2, co, 0, false, settings(), 0);
		expect([coop.shout, coop.rings[0].mine, coop.rings[0].fade]).toEqual([
			undefined,
			false,
			BUILDS_V2_FX.teammateOpacity,
		]);
	});

	it("the drag streak: from the pin's start toward the body, at most streakTiles; none before streakMinTiles", () => {
		const p = BUILDS_V2_FX.pin;
		const out: PinStreak = { visible: false, x1: 0, z1: 0, x2: 0, z2: 0, widthStuds: 0 };
		pinStreak(0, 0, 1, 0, "full", out);
		expect([out.visible, out.x1, out.x2, out.widthStuds]).toEqual([true, 0, 1, p.streakWidthStuds]);
		pinStreak(0, 0, 10, 0, "reduced", out);
		expect([out.x1, out.z1, out.x2, out.widthStuds]).toEqual([
			10 - p.streakTiles,
			0,
			10,
			p.reducedStreakWidthStuds,
		]);
		pinStreak(2, 2, 2.05, 2, "full", out);
		expect(out.visible).toBe(false);
	});

	it("quiet forgets everything and asks for nothing", () => {
		const s = state();
		const ev = new BuildFxEvents();
		tick(s, ev, (e) => {
			pushPinStart(e, 2, 0);
			pushSlam(e, 0);
		});
		carry(s, 2, 0);
		const fx = new BowFx();
		const q = fx.frame(ev, s, 0, true, settings(), 0);
		expect([q.rings.size(), q.pins.size(), q.shout, q.freezeMs]).toEqual([0, 0, undefined, 0]);
	});
});

describe("WreckerFx: smash pops and Demolition (BV11)", () => {
	function smash(e: BuildEvents, owner: number, gen: number, x = 2.5): void {
		e.smashX.push(x);
		e.smashZ.push(2.5);
		e.smashOwner.push(owner);
		e.smashGen.push(gen);
		e.smashFired.push(3);
	}
	function demolition(e: BuildEvents, owner: number): void {
		e.demolitionX.push(2.5);
		e.demolitionZ.push(2.5);
		e.demolitionOwner.push(owner);
	}

	it("a pop per smash, chips Full only, a blast ring on DEMOLITION_RADIUS per Demolition record", () => {
		const s = state();
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => {
			smash(e, 0, 0);
			demolition(e, 0);
		});
		tick(s, ev, (e) => {
			smash(e, 0, 1, 3.5);
			demolition(e, 0);
		});
		const out = new WreckerFx().frame(ev, s, 0, false, settings("full", { reducedMotion: true }), 0);
		expect(out.rings.map((r) => [r.block === BUILDS_V2_FX.smash.ring, r.role])).toEqual([
			[true, "build.shard"],
			[true, "build.shard"],
			[false, "build.ember"],
			[false, "build.ember"],
		]);
		expect(out.rings[2].radius).toBe(DEMOLITION_RADIUS);
		expect(out.chips.map((c) => c.x)).toEqual([2.5, 3.5]);
		expect(out.chipShape.bits).toBe(BUILDS_V2_FX.smash.chips.bits);
		// Reduced: the rings stay, the pops' particles go.
		const red = new WreckerFx().frame(ev, s, 0, false, settings("reduced"), 0);
		expect([red.rings.size(), red.chips.size(), red.chipShape.bits, red.chipShape.sparks]).toEqual([4, 0, 0, 0]);
		expect(smashChipShape("reduced").chunks).toBe(0);
		// Particles off: no chips.
		expect(new WreckerFx().frame(ev, s, 0, false, settings("full", { particles: "off" }), 0).chips.size()).toBe(0);
		expect(smashChainLength(ev.smashes)).toBe(2);
	});

	it("the chain's pitch is the build voice's ladder (+2 semitones a generation, capped)", () => {
		for (let g = 0; g <= 4; g++) expect(smashSpeed(g)).toBe(buildGenSpeed(g));
		expect([smashSemitones(0), smashSemitones(1), smashSemitones(2), smashSemitones(9)]).toEqual([0, 2, 4, 6]);
	});

	it("chips: the view player's first, at most chipsPerFrame; a teammate's ring at teammateOpacity", () => {
		const s = state(2);
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => {
			for (let k = 0; k < 5; k++) smash(e, 1, 0, 10 + k);
			for (let k = 0; k < 5; k++) smash(e, 0, 0, k);
		});
		const out = new WreckerFx().frame(ev, s, 0, false, settings(), 0);
		const cap = BUILDS_V2_FX.smash.chipsPerFrame;
		expect(out.chips.size()).toBe(cap);
		expect(out.chips.map((c) => c.owner)).toEqual([0, 0, 0, 0, 0, 1].filter((_, i) => i < cap));
		// The smash rings are capped at maxAlive (the oldest go first).
		expect(out.rings.size()).toBe(math.min(10, BUILDS_V2_FX.smash.ring.maxAlive));
		const teammate = out.rings.find((r) => r.owner === 1);
		expect(teammate?.fade).toBe(BUILDS_V2_FX.teammateOpacity);
		expect(ownerOpacity(1, 0)).toBe(BUILDS_V2_FX.teammateOpacity);
	});
});

describe("HeartBeamFx (BV11)", () => {
	function beam(e: BuildEvents, owner: number): void {
		e.beamX1.push(0);
		e.beamZ1.push(0);
		e.beamX2.push(4);
		e.beamZ2.push(0);
		e.beamOwner.push(owner);
		e.beamStruck.push(1);
	}

	it("a segment per beam, opaque for its hold, fading, gone after heartBeam.sec; Reduced thinner, no core", () => {
		const b = BUILDS_V2_FX.heartBeam;
		expect(heartBeamFade(0)).toBe(1);
		expect(heartBeamFade(b.sec * b.hold)).toBe(1);
		expect(heartBeamFade(b.sec)).toBe(0);
		expect(heartBeamFade(b.sec * (b.hold + (1 - b.hold) / 2))).toBeCloseTo(0.5, 9);
		expect([heartBeamWidth("full"), heartBeamWidth("reduced")]).toEqual([b.widthStuds, b.reducedWidthStuds]);
		const s = state(2);
		const ev = new BuildFxEvents();
		ev.reset();
		tick(s, ev, (e) => {
			beam(e, 0);
			beam(e, 1);
		});
		const fx = new HeartBeamFx();
		const out = fx.frame(ev, s, 0, false, settings(), 0);
		expect(out.map((v) => [v.owner, v.mine, v.fade, v.core, v.x2, v.role])).toEqual([
			[0, true, 1, true, 4, "boon.duo"],
			[1, false, BUILDS_V2_FX.teammateOpacity, true, 4, "boon.duo"],
		]);
		const red = new HeartBeamFx().frame(ev, s, 0, false, settings("reduced"), 0);
		expect([red[0].core, red[0].widthStuds]).toEqual([false, b.reducedWidthStuds]);
		s.tick += math.ceil(b.sec / SIM_DT);
		expect(fx.frame(NO_BUILD_FX_EVENTS, s, 0, false, settings(), 0).size()).toBe(0);
		expect(fx.frame(ev, s, 0, true, settings(), 0).size()).toBe(0);
	});
});

describe("HappyHourFx and OvercapPops (BV11)", () => {
	it("the toast for the local player's drink only; the window from the drink tick for HAPPY_HOUR_TICKS", () => {
		const s = state(2);
		const ev = new BuildFxEvents();
		const fx = new HappyHourFx();
		ev.reset();
		tick(s, ev, (e) => e.happyPlayer.push(1));
		expect(fx.frame(ev, s, 0, false)).toBe(false);
		const drink = s.tick;
		expect([fx.isOn(1, drink), fx.isOn(0, drink), fx.ticksLeft(1, drink)]).toEqual([true, false, HAPPY_HOUR_TICKS]);
		ev.reset();
		tick(s, ev, (e) => e.happyPlayer.push(0));
		expect(fx.frame(ev, s, 0, false)).toBe(true);
		expect(fx.frame(NO_BUILD_FX_EVENTS, s, 0, false)).toBe(false);
		expect([fx.isOn(1, drink + HAPPY_HOUR_TICKS - 1), fx.isOn(1, drink + HAPPY_HOUR_TICKS)]).toEqual([true, false]);
		expect(fx.ticksLeft(1, drink + HAPPY_HOUR_TICKS)).toBe(0);
		expect([happyHourOn(undefined, 5), happyHourOn(10, 9), happyHourOn(10, 10)]).toEqual([false, false, true]);
		// A drink while it runs restarts it.
		ev.reset();
		s.tick = drink + 200;
		tick(s, ev, (e) => e.happyPlayer.push(1));
		fx.frame(ev, s, 0, false);
		expect(fx.isOn(1, drink + HAPPY_HOUR_TICKS + 50)).toBe(true);
		// Quiet: no toast (the window is still recorded); a new run forgets every window.
		const s2 = state();
		const ev2 = new BuildFxEvents();
		tick(s2, ev2, (e) => e.happyPlayer.push(0));
		const fx2 = new HappyHourFx();
		expect(fx2.frame(ev2, s2, 0, true)).toBe(false);
		expect(fx2.isOn(0, s2.tick)).toBe(true);
		fx2.frame(NO_BUILD_FX_EVENTS, state(), 0, false);
		expect(fx2.isOn(0, s2.tick)).toBe(false);
	});

	it("happyPopTone tints kill pops only; the toast's key and the pop role", () => {
		expect([
			happyPopTone(ScorePopTone.KILL, true),
			happyPopTone(ScorePopTone.KILL, false),
			happyPopTone(ScorePopTone.GOLD_RUSH, true),
			happyPopTone(ScorePopTone.HORDE, true),
		]).toEqual([ScorePopTone.HAPPY, ScorePopTone.KILL, ScorePopTone.GOLD_RUSH, ScorePopTone.HORDE]);
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		const key = BUILDS_V2_FX.happyHour.toast.key;
		expect([pack.hasString(key), pack.str(key)]).toEqual([true, "Happy Hour: double kill points"]);
		for (const k of [BUILDS_V2_FX.counter.shout.key, BUILDS_V2_FX.pin.shout.key, BUILDS_V2_FX.slam.shout.key])
			expect([k, pack.hasString(k)]).toEqual([k, true]);
		expect([pack.str("fx.pinned.text"), pack.str("fx.slam.text")]).toEqual(["PINNED", "SLAM"]);
	});

	function overcap(e: BuildEvents, owner: number, points: number, x = 6, z = 6): void {
		e.overcapX.push(x);
		e.overcapZ.push(z);
		e.overcapOwner.push(owner);
		e.overcapPoints.push(points);
	}

	it("merges every payout within OVERCAP_POP_MERGE_SEC of a pop's first one, near it, into one +N", () => {
		expect(OVERCAP_POP_MERGE_TICKS).toBe(math.round(OVERCAP_POP_MERGE_SEC / SIM_DT));
		expect(OVERCAP_POP_MERGE_SEC).toBe(0.25);
		const s = state(2);
		const ev = new BuildFxEvents();
		const pops = new OvercapPops();
		// Ticks 1..15: one pop; tick 16 starts a new one (first tick 1 + 15).
		let out = pops.frame(NO_BUILD_FX_EVENTS, s, 0, false, 0);
		for (let k = 1; k <= OVERCAP_POP_MERGE_TICKS + 1; k++) {
			ev.reset();
			tick(s, ev, (e) => overcap(e, k === 3 ? 1 : 0, 10, 6 + k * 0.05));
			out = pops.frame(ev, s, 0, false, 0);
		}
		expect(out.map((p) => [p.points, p.firstTick, p.lastTick, p.mine])).toEqual([
			[10 * OVERCAP_POP_MERGE_TICKS, 1, OVERCAP_POP_MERGE_TICKS, true],
			[10, OVERCAP_POP_MERGE_TICKS + 1, OVERCAP_POP_MERGE_TICKS + 1, true],
		]);
		expect(out[0].version).toBe(OVERCAP_POP_MERGE_TICKS);
		// Far apart (another boss / place): its own pop, even inside the window.
		ev.reset();
		tick(s, ev, (e) => overcap(e, 1, 7, 30, 30));
		out = pops.frame(ev, s, 0, false, 0);
		expect(out.size()).toBe(3);
		expect([out[2].points, out[2].mine]).toEqual([7, false]);
		// A pop lives SCORE_POP_LIFE of sim time from its first payout.
		s.tick = 1 + math.ceil(SCORE_POP_LIFE / SIM_DT);
		out = pops.frame(NO_BUILD_FX_EVENTS, s, 0, false, 0);
		expect(out.map((p) => p.firstTick)).toEqual([OVERCAP_POP_MERGE_TICKS + 1, OVERCAP_POP_MERGE_TICKS + 2]);
	});

	it("frame pacing: payouts of several ticks in one frame merge exactly as one a frame; at most maxAlive pops", () => {
		const one = new OvercapPops();
		const many = new OvercapPops();
		const s1 = state();
		const s2 = state();
		const ev2 = new BuildFxEvents();
		ev2.reset();
		for (let k = 1; k <= 40; k++) {
			const ev1 = new BuildFxEvents();
			tick(s1, ev1, (e) => overcap(e, 0, k));
			one.frame(ev1, s1, 0, false, 0);
			tick(s2, ev2, (e) => overcap(e, 0, k));
		}
		const a = one.frame(NO_BUILD_FX_EVENTS, s1, 0, false, 0);
		const b = many.frame(ev2, s2, 0, false, 0);
		expect(b.map((p) => [p.points, p.firstTick])).toEqual(a.map((p) => [p.points, p.firstTick]));
		expect(a.size()).toBe(3); // ticks 1-15, 16-30, 31-40
		const flood = new OvercapPops();
		const s3 = state();
		const ev3 = new BuildFxEvents();
		tick(s3, ev3, (e) => {
			for (let k = 0; k < 10; k++) overcap(e, 0, 1, k * 5, 0);
		});
		expect(flood.frame(ev3, s3, 0, false, 0).size()).toBe(BUILDS_V2_FX.overcap.maxAlive);
		expect(flood.frame(ev3, s3, 0, true, 0).size()).toBe(0);
	});

	it("the shape rule: the kill pops' glyph scale, a shorter rise, the overcap role", () => {
		const o = BUILDS_V2_FX.overcap;
		expect([o.scale, o.role]).toEqual([1, "build.overcap"]);
		expect(overcapPopRise(0.8, 1)).toBe(math.round(scorePopRise(0.8, 1) * o.riseShare));
		expect(overcapPopRise(0.8, 0)).toBe(0);
	});
});
