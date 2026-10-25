// The client loop, headlessly: sampling input ONCE per rendered frame and recording it per tick must produce a
// recording that runReplay (and the server's validateRun) reproduces bit for bit, at any frame rate, with pauses.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEFAULT_RUN_LIMITS, buildRunConfig, validateRun, type RunLimits } from "shared/run";
import {
	Button,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	MAX_TICKS_PER_FRAME,
	SIM_DT,
	START_HALF_HEARTS,
	decodeRecording,
	hashState,
	quantizeInput,
	runReplay,
	type InputFrame,
} from "shared/sim";
import { LiveRun, mapDevicesToInput, type LiveRunSetup } from "shared/play";

/** Frame deltas cycled by the scripted session: 60, 144, 30 and 165 fps, a hitch (capped), a zero-length frame. */
const DELTAS = [1 / 60, 1 / 144, 1 / 30, 1 / 165, 0.25, 0, 1 / 60, 1 / 90];

/** A scripted "player" for frame n: walks, aims around, swaps, rolls, fires the sword then the bow, charges. */
function scriptedInput(n: number, out: InputFrame): InputFrame {
	const phase = math.floor(n / 40) % 6;
	const keys = new Array<string>();
	if (phase === 0) keys.push("W", "D");
	else if (phase === 1) keys.push("S");
	else if (phase === 2) keys.push("A", "W");
	else if (phase === 3) keys.push("D");
	if (n % 97 === 5) keys.push("Space");
	if (n % 150 === 70) keys.push("E");
	if (n % 211 === 9) keys.push("Q");
	if (n % 173 === 33) keys.push("F");
	const mouse = new Array<string>();
	if (phase === 1 || phase === 4) mouse.push("MouseButton1");
	if (phase === 5) mouse.push("MouseButton2");
	return mapDevicesToInput(
		{
			kbm: { keys: new Set(keys), mouseButtons: new Set(mouse) },
			pad: undefined,
			aimDevice: "mouse",
			pointerAimX: math.cos(n * 0.05) * 3,
			pointerAimZ: math.sin(n * 0.05) * 3 + 0.25,
		},
		out,
	);
}

function play(run: LiveRun, frames: number, inputFor: (n: number, out: InputFrame) => InputFrame): void {
	const input = { ...EMPTY_INPUT };
	for (let n = 0; n < frames; n++) run.frame(DELTAS[n % DELTAS.size()], inputFor(n, input));
}

function dungeonSetup(): LiveRunSetup {
	const setup = buildRunConfig(1337, { world: "dungeonNoEncounter" });
	return { seed: 1337, spawnX: setup.spawn!.x, spawnZ: setup.spawn!.z, config: setup.config, atBossDoor: false };
}

const NO_ENCOUNTER_LIMITS: RunLimits = { ...DEFAULT_RUN_LIMITS, world: "dungeonNoEncounter" };

describe("LiveRun: sample once per frame, record per tick", () => {
	it("records exactly one frame per tick, and runReplay reproduces the live hash (dungeon floor, no enemies)", () => {
		const setup = dungeonSetup();
		const run = new LiveRun(setup);
		play(run, 1200, scriptedInput);
		const state = run.state;
		expect(state.tick).toBeGreaterThan(1000);
		expect(run.ticks()).toBe(state.tick);
		expect(state.combat.playerSpawned).toBeGreaterThan(0); // the bow fired
		expect(state.combat.weapons.swingTick).toBeGreaterThanOrEqual(0); // the sword swung
		const replayed = runReplay(run.recorder.getRecording(), setup.config);
		expect(hashState(replayed)).toBe(hashState(state));
		expect(run.replayCheck().match).toBe(true);
	});

	it("reuses the frame's input for every tick of a multi-tick frame and caps ticks per frame", () => {
		const run = new LiveRun({ seed: 7, spawnX: 0, spawnZ: 0, config: DEFAULT_SIM_CONFIG, atBossDoor: false });
		const input = quantizeInput(1, 0, 0, 1, Button.FIRE);
		expect(run.frame(SIM_DT * 3 + 1e-6, input)).toBe(3);
		expect(run.frame(10, input)).toBe(MAX_TICKS_PER_FRAME);
		const frames = run.recorder.getRecording().frames;
		expect(frames.size()).toBe(3 + MAX_TICKS_PER_FRAME);
		for (const f of frames) expect(f).toEqual(input);
		expect(run.frameEvents.shotsFired).toBeGreaterThanOrEqual(0);
	});

	it("pause: the PAUSE edge toggles, paused frames run and record nothing, resuming starts clean", () => {
		const run = new LiveRun({ seed: 3, spawnX: 0, spawnZ: 0, config: DEFAULT_SIM_CONFIG, atBossDoor: false });
		const walk = quantizeInput(0, 1, 0, 0, 0);
		const pause = quantizeInput(0, 1, 0, 0, Button.PAUSE);
		run.frame(1 / 60, walk);
		const before = run.ticks();
		expect(run.frame(1 / 60, pause)).toBe(0); // edge frame: no ticks
		expect(run.isPaused()).toBe(true);
		for (let i = 0; i < 30; i++) expect(run.frame(1 / 60, walk)).toBe(0);
		expect(run.ticks()).toBe(before);
		expect(run.frame(1 / 60, pause)).toBe(0); // the unpause edge frame runs nothing either
		expect(run.isPaused()).toBe(false);
		expect(run.frame(1 / 60, walk)).toBe(1);
		run.setPaused(true);
		expect(run.frame(1 / 60, walk)).toBe(0);
		run.setPaused(false);
		expect(run.frame(1 / 60, walk)).toBe(1);
		expect(hashState(runReplay(run.recorder.getRecording(), DEFAULT_SIM_CONFIG))).toBe(hashState(run.state));
	});

	it("a submission validates on the server's replay (dungeon floor world) with the claimed summary", () => {
		const run = new LiveRun(dungeonSetup());
		play(run, 600, scriptedInput);
		const sub = run.submission();
		expect(sub.claimed).toEqual({ ticks: run.state.tick, kills: 0, bossDefeated: false, died: false });
		const decoded = decodeRecording(sub.recording, DEFAULT_RUN_LIMITS);
		expect(decoded.ok && decoded.recording.frames.size()).toBe(run.state.tick);
		const verdict = validateRun(sub, NO_ENCOUNTER_LIMITS);
		expect(verdict.code).toBe(undefined);
		expect(verdict.ok).toBe(true);
		expect(verdict.serverHash).toBe(sub.claimedHash);
	});

	it("dying (debug K hits) ends the run as 'dead', and the server agrees (debug input allowed)", () => {
		const run = new LiveRun(dungeonSetup());
		const hitEvery = 60; // past the post-hit invulnerability (45 ticks)
		const input = { ...EMPTY_INPUT };
		let n = 0;
		while (run.outcome() === "playing" && n < 2000) {
			quantizeInput(0, 0, 0, 0, n % hitEvery === 0 ? Button.DEBUG_HIT : 0, input);
			run.frame(1 / 60, input);
			n++;
		}
		expect(run.outcome()).toBe("dead");
		expect(run.state.player.dead).toBe(1);
		// The post-run panel's numbers: the death tick and the run's hit count.
		expect(run.endTick()).toBe(run.state.tick);
		expect(run.hitsTaken).toBe(START_HALF_HEARTS);
		expect(run.kills).toBe(0);
		expect(n).toBeGreaterThanOrEqual(START_HALF_HEARTS);
		const sub = run.submission();
		expect(sub.claimed.died).toBe(true);
		expect(validateRun(sub, NO_ENCOUNTER_LIMITS).code).toBe("debug_input");
		const dev = validateRun(sub, { ...NO_ENCOUNTER_LIMITS, allowDebugInput: true });
		expect(dev.ok).toBe(true);
	});

	it("a restart is a new LiveRun: fresh state and recording from the same setup", () => {
		const setup = dungeonSetup();
		const first = new LiveRun(setup);
		play(first, 100, scriptedInput);
		const second = new LiveRun(setup);
		expect(second.ticks()).toBe(0);
		expect(second.state.player.x).toBe(setup.spawnX);
		expect(hashState(second.state)).toBe(hashState(new LiveRun(setup).state));
	});
});
