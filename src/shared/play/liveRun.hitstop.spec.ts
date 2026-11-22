// Freeze frames and slow motion never change what the sim does, only when ticks run (wall-time pacing).
//
// Port of the web build's src/fx/freeze/freeze.determinism.test.ts @ 42897e2, driven through the client's own loop
// (LiveRun) the way SimController + FxTrackerController + FreezeFrameController drive it: a scripted boss fight on the
// real seed-1337 floor (buildRunConfig, boss door start): walk in, swap to the bow, circle the boss shooting it, press
// J (DEBUG_BOSS, an input bit) on a cadence through phases 2 and 3 to its death. Input is sampled ONCE per frame from
// the state, LiveRun.frame(dt, input, hitstopClock) runs the frame's ticks, then the hit tracker diffs the live state
// and the freeze-frame rules turn its events (kills, phases, the boss death + slow-mo) into hitstop requests.
//
// Checks:
//   - 60 Hz frames, hitstop ON vs OFF: identical input per tick (the serialized recordings are equal), identical
//     hashes at every checkpoint and at the end. The ON run simply needs more frames (frozen / slowed ones).
//   - Irregular frames (jitter, 144 / 30 fps stretches, hitches, a 5 s frame), hitstop ON: frozen frames run no tick
//     and record nothing; the recording replays (runReplay) to the live hash, and the server's validateRun accepts it;
//     the same per-tick inputs played through a hitstop-free LiveRun reproduce every checkpoint hash.
//   - Settings off: the same loop never freezes or slows.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEFAULT_RUN_LIMITS, buildRunConfig, validateRun } from "shared/run";
import { defaultJuiceSettings, type JuiceSettings } from "shared/settings";
import {
	BOSS_ACT1_ID,
	Button,
	EMPTY_INPUT,
	NO_KIND,
	SIM_HZ,
	archetypeIndex,
	hashState,
	quantizeInput,
	runReplay,
	serializeRecording,
	weaponIndex,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { HitTracker, HitstopClock, RenderRng, applyFreezeEvent } from "shared/view/fx";
import { LiveRun, type LiveRunSetup } from "./liveRun";

const SEED = 1337;
const MAX_TICKS = 120 * SIM_HZ;
const CHECKPOINT = 120;
/** Stop this many ticks after the boss died. */
const AFTER_DEFEAT = 3 * SIM_HZ;
/** Adds closer than this are shot first. */
const ADD_RANGE = 7;
/** Orbit radius around the boss and the radial correction gain. */
const ORBIT = 6;
const RADIAL_GAIN = 0.8;
const STRAFE = 0.6;
/** J cadence: every ~0.6 s in phases 1-2, slower in phase 3 so its charge summons swarmers to shoot. */
const J_PERIOD = 36;
const J_PERIOD_PHASE3 = 240;
const J_HOLD = 6;
const STRAFE_FLIP_TICKS = 200;
const SWAP_PERIOD = 30;
const SWAP_HOLD = 4;

function bootSetup(): LiveRunSetup {
	const setup = buildRunConfig(SEED, { atBossDoor: true });
	const spawn = setup.spawn!;
	return { seed: SEED, spawnX: spawn.x, spawnZ: spawn.z, config: setup.config, atBossDoor: true };
}

function unit(x: number, z: number): [number, number] {
	const m = math.sqrt(x * x + z * z);
	return m > 0 ? [x / m, z / m] : [0, 0];
}

/** The scripted player: a pure function of the state (sampled once per frame, like the devices). */
function scriptedPlayer(s: SimState, out: InputFrame): InputFrame {
	const bossKind = archetypeIndex(BOSS_ACT1_ID);
	const sword = weaponIndex("weapon.sword");
	const p = s.player;
	let boss: ActorState | undefined;
	let add: ActorState | undefined;
	let best = math.huge;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		if (a.kind === bossKind) {
			boss = a;
			continue;
		}
		const d = math.sqrt((a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z));
		if (d < ADD_RANGE && d < best) {
			best = d;
			add = a;
		}
	}
	let buttons = 0;
	const w = s.combat.weapons;
	if (w.sets[w.activeSet].weapon === sword && s.tick % SWAP_PERIOD < SWAP_HOLD)
		buttons = bit32.bor(buttons, Button.SWAP);
	let mx = 0;
	let mz = 0;
	let ax = 0;
	let az = 0;
	if (boss !== undefined) {
		const dx = boss.x - p.x;
		const dz = boss.z - p.z;
		const dist = math.max(math.sqrt(dx * dx + dz * dz), 1e-6);
		if (boss.phase === 0) {
			mx = dx;
			mz = dz;
		} else {
			const strafe = math.floor(s.tick / STRAFE_FLIP_TICKS) % 2 === 0 ? 1 : -1;
			const radial = (dist - ORBIT) * RADIAL_GAIN;
			mx = (-dz / dist) * strafe * STRAFE + (dx / dist) * radial;
			mz = (dx / dist) * strafe * STRAFE + (dz / dist) * radial;
			buttons = bit32.bor(buttons, Button.FIRE);
			const period = boss.phase >= 3 ? J_PERIOD_PHASE3 : J_PERIOD;
			if (s.tick % period < J_HOLD) buttons = bit32.bor(buttons, Button.DEBUG_BOSS);
		}
		ax = add !== undefined ? add.x - p.x : dx;
		az = add !== undefined ? add.z - p.z : dz;
	} else if (add !== undefined) {
		ax = add.x - p.x;
		az = add.z - p.z;
		buttons = bit32.bor(buttons, Button.FIRE);
	}
	const [umx, umz] = unit(mx, mz);
	const [uax, uaz] = unit(ax, az);
	return quantizeInput(umx, umz, uax, uaz, buttons, out);
}

interface Played {
	run: LiveRun;
	clock: HitstopClock;
	frames: number;
	hashes: Map<number, string>;
	bossPhases: number[];
	bossDefeatedTick: number;
	kills: number;
	ticksInFrozenFrames: number;
}

/**
 * The live loop: input once per frame, LiveRun.frame with (or without) the hitstop clock as pacer, then the tracker
 * and the freeze rules on the frame's events, as the client controllers run them.
 */
function playLive(deltaFor: (frame: number) => number, hitstop: boolean, settings: Readonly<JuiceSettings>): Played {
	const run = new LiveRun(bootSetup());
	const clock = new HitstopClock();
	const tracker = new HitTracker();
	const input = { ...EMPTY_INPUT };
	const out: Played = {
		run,
		clock,
		frames: 0,
		hashes: new Map(),
		bossPhases: [],
		bossDefeatedTick: -1,
		kills: 0,
		ticksInFrozenFrames: 0,
	};
	let frame = 0;
	while (run.state.tick < MAX_TICKS) {
		if (out.bossDefeatedTick >= 0 && run.state.tick > out.bossDefeatedTick + AFTER_DEFEAT) break;
		scriptedPlayer(run.state, input);
		const tickBefore = run.state.tick;
		const recBefore = run.ticks();
		const accBefore = run.loop.accumulator;
		const alphaBefore = run.getAlpha();
		const ticks = run.frame(deltaFor(frame), input, hitstop ? clock : undefined);
		frame++;
		if (hitstop && run.lastAdvance.frozen) {
			// A true still: nothing ran, nothing recorded, the loop untouched.
			out.ticksInFrozenFrames += ticks;
			expect(run.state.tick).toBe(tickBefore);
			expect(run.ticks()).toBe(recBefore);
			expect(run.loop.accumulator).toBe(accBefore);
			expect(run.getAlpha()).toBe(alphaBefore);
		}
		// Checkpoints: the state hash whenever a frame crosses a multiple of CHECKPOINT (checked at its end).
		const t = run.state.tick;
		if (t !== tickBefore && t % CHECKPOINT === 0) out.hashes.set(t, hashState(run.state));
		const n = tracker.update(run.state, run.getAlpha(), run.setup.config.encounter);
		for (let i = 0; i < n; i++) {
			const e = tracker.events.at(i);
			applyFreezeEvent(e, clock, settings);
			if (e.type === "killed") out.kills++;
			if (e.type === "bossPhase") out.bossPhases.push(e.phase);
			if (e.type === "bossDefeated") out.bossDefeatedTick = run.state.tick;
		}
	}
	out.frames = frame;
	out.hashes.set(run.state.tick, hashState(run.state));
	return out;
}

/** Recorded per-tick inputs through a hitstop-free LiveRun, one tick per 60 Hz frame; hashes at the same ticks. */
function playRecording(recording: ReturnType<LiveRun["recorder"]["getRecording"]>): Map<number, string> {
	const run = new LiveRun(bootSetup());
	const hashes = new Map<number, string>();
	const frames = recording.frames;
	while (run.state.tick < frames.size()) {
		const ticks = run.frame(1 / 60, frames[run.state.tick]);
		expect(ticks).toBe(1);
		if (run.state.tick % CHECKPOINT === 0) hashes.set(run.state.tick, hashState(run.state));
	}
	hashes.set(run.state.tick, hashState(run.state));
	return hashes;
}

function irregularDeltas(): (frame: number) => number {
	const rng = new RenderRng(SEED ^ 0x51ac);
	const HIDDEN_TAB_FRAME = 900;
	return (frame) => {
		if (frame === HIDDEN_TAB_FRAME) return 5;
		const r = rng.next();
		if (r < 0.02) return 0.1 + rng.next() * 0.2;
		if (r < 0.2) return 1 / 144;
		if (r < 0.3) return 1 / 30;
		return 1 / 60 + (rng.next() - 0.5) * 0.004;
	};
}

const steady = () => 1 / 60;
const ON = defaultJuiceSettings(false);

describe("hitstop never changes the recording or the hashes", () => {
	it("60 Hz frames: hitstop on and off record identical input per tick and identical hashes", () => {
		const live = playLive(steady, true, ON);
		const plain = playLive(steady, false, ON);
		const st = live.clock.stats;
		print(
			`[hitstop determinism] seed ${SEED}: ${live.run.state.tick} ticks; hitstop on ${live.frames} frames ` +
				`(${st.frozenFrames} frozen, ${st.partialFrames} partial, ${st.slowFrames} slow-mo, ` +
				`${math.round(st.frozenMs)} ms frozen, ${st.throttled} throttled) vs off ${plain.frames} frames; ` +
				`boss phases ${live.bossPhases.join(",")}, boss down at tick ${live.bossDefeatedTick}, kills ${
					live.kills
				}`,
		);
		// The fight happened, with freezes and slow motion in it.
		expect(live.bossPhases).toEqual([1, 2, 3]);
		expect(live.bossDefeatedTick).toBeGreaterThan(0);
		expect(st.frozenFrames).toBeGreaterThan(10);
		expect(st.slowFrames).toBeGreaterThan(5);
		expect(st.frozenMs).toBeGreaterThan(2 * 120 + 250 - 1e-6);
		expect(live.ticksInFrozenFrames).toBe(0);
		expect(live.frames).toBeGreaterThan(plain.frames);
		// Same ticks, same input per tick, same hashes.
		expect(live.run.state.tick).toBe(plain.run.state.tick);
		const a = serializeRecording(live.run.recorder.getRecording());
		const b = serializeRecording(plain.run.recorder.getRecording());
		expect(a === b).toBe(true);
		expect(live.hashes.size()).toBeGreaterThan(5);
		for (const [tick, hash] of plain.hashes) expect([tick, live.hashes.get(tick)]).toEqual([tick, hash]);
		expect(hashState(live.run.state)).toBe(hashState(plain.run.state));
	});

	it("irregular frames with hitstop: the recording replays exactly, validates, and matches a hitstop-free run", () => {
		const live = playLive(irregularDeltas(), true, ON);
		const st = live.clock.stats;
		expect(live.bossDefeatedTick).toBeGreaterThan(0);
		expect(st.frozenFrames).toBeGreaterThan(10);
		expect(live.ticksInFrozenFrames).toBe(0);
		const recording = live.run.recorder.getRecording();
		expect(recording.frames.size()).toBe(live.run.state.tick);
		const replayed = runReplay(recording, live.run.setup.config);
		expect(hashState(replayed)).toBe(hashState(live.run.state));
		expect(live.run.replayCheck().match).toBe(true);
		const verdict = validateRun(live.run.submission(), {
			...DEFAULT_RUN_LIMITS,
			allowDebugInput: true,
			allowBossDoorSpawn: true,
		});
		expect(verdict.code).toBe(undefined);
		expect(verdict.ok).toBe(true);
		const plain = playRecording(recording);
		for (const [tick, hash] of live.hashes) {
			if (tick % CHECKPOINT === 0 || tick === live.run.state.tick) {
				expect([tick, plain.get(tick)]).toEqual([tick, hash]);
			}
		}
	});

	it("settings off: the same loop never freezes or slows, and still replays", () => {
		const live = playLive(irregularDeltas(), true, { ...ON, freezeFrame: false });
		const st = live.clock.stats;
		expect(st.frozenFrames + st.partialFrames + st.slowFrames).toBe(0);
		expect(st.ignored).toBeGreaterThan(0);
		expect(st.lostMs).toBeCloseTo(0, 6);
		expect(hashState(runReplay(live.run.recorder.getRecording(), live.run.setup.config))).toBe(
			hashState(live.run.state),
		);
	});
});
