// Live-vs-replay determinism with irregular frames through the FixedStepLoop. Ported from src/sim/determinism.test.ts
// and the open-arena half of src/sim/player.determinism.test.ts (the dungeon halves need shared/dungeon: task 5).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ALL_BUTTONS,
	AXIS_MAX,
	Button,
	DEFAULT_SIM_CONFIG,
	FixedStepLoop,
	Recorder,
	Rng,
	SIM_DT,
	cloneSimState,
	createSimState,
	deserializeRecording,
	hashState,
	runReplay,
	serializeRecording,
	step,
	type InputFrame,
	type Recording,
	type SimConfig,
	type SimState,
} from "shared/sim";

const TICKS = 3600;
const SEED = 0xc0ffee;
const SPAWN = { x: 0, z: 3 };
/** Chance that a new held input frame also holds DEBUG_HIT. */
const DEBUG_HIT_CHANCE = 0.03;
/** Every button except DEBUG_BOSS (as in the source test): SWAP brings the bow in, so arrows fly too. */
const RANDOM_BUTTONS = ALL_BUTTONS - Button.DEBUG_BOSS;

interface EventCounts {
	rolls: number;
	flasks: number;
	embers: number;
	hits: number;
	deaths: number;
	swings: number;
	shots: number;
	swaps: number;
}

/** Random-but-seeded input source that holds each frame for a random number of rendered frames. */
function makeInputSource(seed: number): () => InputFrame {
	const rng = new Rng(seed);
	let current: InputFrame = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, buttons: 0 };
	let hold = 0;
	const axis = (): number => {
		const kind = rng.int(0, 3);
		if (kind === 0) return 0;
		if (kind === 1) return rng.int(0, 1) !== 0 ? 707 : -707; // keyboard diagonal
		if (kind === 2) return rng.int(0, 1) !== 0 ? AXIS_MAX : -AXIS_MAX;
		return rng.int(-AXIS_MAX, AXIS_MAX); // analog
	};
	return (): InputFrame => {
		if (hold <= 0) {
			hold = rng.int(1, 40);
			const aiming = rng.next() < 0.6;
			const moveX = axis();
			const moveZ = axis();
			const aimX = aiming ? axis() : 0;
			const aimZ = aiming ? axis() : 0;
			const random = bit32.band(rng.int(0, ALL_BUTTONS), RANDOM_BUTTONS);
			const hit = rng.next() < DEBUG_HIT_CHANCE ? Button.DEBUG_HIT : 0;
			current = {
				moveX,
				moveZ,
				aimX,
				aimZ,
				buttons: bit32.bor(bit32.band(random, bit32.bnot(Button.DEBUG_HIT)), hit),
			};
		}
		hold--;
		return current;
	};
}

interface LiveRun {
	state: SimState;
	recording: Recording;
	frames: number;
	loop: FixedStepLoop;
	events: EventCounts;
}

/** Simulates the real driver: irregular frame deltas, one input sample per frame, recorded per tick. */
function runLive(seed: number, ticks: number): LiveRun {
	const deltaRng = new Rng(bit32.bxor(seed, 0x5eed));
	const nextInput = makeInputSource(seed);
	const state = createSimState(seed, SPAWN.x, SPAWN.z);
	const recorder = new Recorder(seed, SPAWN.x, SPAWN.z);
	const loop = new FixedStepLoop();
	let frames = 0;
	const events: EventCounts = { rolls: 0, flasks: 0, embers: 0, hits: 0, deaths: 0, swings: 0, shots: 0, swaps: 0 };

	while (recorder.size() < ticks) {
		// Mostly 30-240 Hz frames, occasional hitches (exercise the 5-tick cap), occasional junk deltas.
		const r = deltaRng.next();
		let delta: number;
		if (r < 0.02) delta = 0.25 + deltaRng.next();
		else if (r < 0.03) delta = deltaRng.int(0, 1) !== 0 ? -0.01 : 0 / 0;
		else delta = (1 + deltaRng.next() * 7) / 240;
		const input = nextInput();
		loop.advance(delta, () => {
			recorder.record(input);
			step(state, input, DEFAULT_SIM_CONFIG);
			events.rolls += state.events.rollStarted;
			events.flasks += state.events.flaskUsed;
			events.embers += state.events.emberUsed;
			events.hits += state.events.playerHits;
			events.deaths += state.events.playerDied;
			events.swings += state.events.meleeSwings;
			events.shots += state.events.shotsFired;
			events.swaps += state.events.weaponSwapped;
		});
		frames++;
	}
	return { state, recording: recorder.getRecording(), frames, loop, events };
}

describe("determinism", () => {
	const live = runLive(SEED, TICKS);

	it("runs at least 3600 ticks with irregular frames and a capped hitch", () => {
		expect(live.state.tick).toBe(live.recording.frames.size());
		expect(live.state.tick).toBeGreaterThanOrEqual(TICKS);
		expect(live.frames).never.toBe(live.state.tick); // frames and ticks really were decoupled
		expect(live.loop.droppedTime).toBeGreaterThan(0); // hitches hit the cap
	});

	it("the random input exercises roll, flask, Ember, debug hits, sword swings, swaps and bow arrows", () => {
		expect(live.events.rolls).toBeGreaterThan(20);
		expect(live.events.embers).toBe(2); // 2 per area, never refilled in this run
		expect(live.events.flasks).toBeGreaterThan(0);
		expect(live.events.hits).toBeGreaterThan(0);
		expect(live.events.swings).toBeGreaterThan(0);
		expect(live.events.swaps).toBeGreaterThan(0);
		expect(live.events.shots).toBeGreaterThan(0);
		expect(live.state.combat.playerSpawned).toBeGreaterThan(0);
	});

	it("replaying the recording reproduces the live state bit for bit", () => {
		const replayed = runReplay(live.recording);
		expect(hashState(replayed)).toBe(hashState(live.state));
		expect(replayed.player).toEqual(live.state.player);
		expect(replayed.combat.weapons).toEqual(live.state.combat.weapons);
		expect(replayed.combat.playerSpawned).toBe(live.state.combat.playerSpawned);
		const a: number[] = [];
		const b: number[] = [];
		replayed.combat.playerBullets.writeStateHash(a);
		live.state.combat.playerBullets.writeStateHash(b);
		expect(a).toEqual(b);
	});

	it("two live runs with the same seed give the same hash", () => {
		const again = runLive(SEED, TICKS);
		expect(hashState(again.state)).toBe(hashState(live.state));
		expect(hashState(runReplay(again.recording))).toBe(hashState(runReplay(live.recording)));
	});

	it("a different seed gives a different hash", () => {
		expect(hashState(runLive(SEED + 1, TICKS).state)).never.toBe(hashState(live.state));
	});

	it("a single changed input bit changes the hash", () => {
		const frames = [...live.recording.frames];
		const last = frames.size() - 1;
		frames[last] = { ...frames[last], aimX: 333, aimZ: 444 };
		const base: Recording = { ...live.recording, frames };
		const flipped: Recording = { ...live.recording, frames: [...frames] };
		flipped.frames[last] = { ...frames[last], aimX: bit32.bxor(333, 1) };
		expect(hashState(runReplay(flipped))).never.toBe(hashState(runReplay(base)));
	});

	it("JSON round trip preserves frames and the hash", () => {
		const json = serializeRecording(live.recording);
		const back = deserializeRecording(json);
		expect(back.seed).toBe(live.recording.seed);
		expect(back.spawn).toEqual(live.recording.spawn);
		expect(back.frames).toEqual(live.recording.frames);
		expect(hashState(runReplay(back))).toBe(hashState(live.state));
		// Compact: RLE beats one object per tick by a wide margin (~60 bytes per frame as plain JSON objects).
		expect(json.size()).toBeLessThan((live.recording.frames.size() * 60) / 4);
	});

	it("replay checks partway through a run also match", () => {
		const half = math.floor(live.recording.frames.size() / 2);
		const s = createSimState(SEED, SPAWN.x, SPAWN.z);
		for (let t = 0; t < half; t++) step(s, live.recording.frames[t]);
		expect(hashState(runReplay(live.recording, DEFAULT_SIM_CONFIG, half))).toBe(hashState(s));
		expect(s.tick * SIM_DT).toBeCloseTo(half / 60, 9);
	});
});

// --- player.determinism.test.ts, open arena ---------------------------------------------------------------

const VERB_TICKS = 2400;
const VERBS = [Button.ROLL, Button.FLASK, Button.EMBER, Button.DEBUG_HIT];

function makeVerbInput(seed: number, hitChance: number): () => InputFrame {
	const rng = new Rng(seed);
	let current: InputFrame = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, buttons: 0 };
	let hold = 0;
	const axis = (): number => {
		const choices = [0, 707, -707, AXIS_MAX, -AXIS_MAX, rng.int(-AXIS_MAX, AXIS_MAX)];
		return choices[rng.int(0, 5)];
	};
	return (): InputFrame => {
		if (hold <= 0) {
			hold = rng.int(1, 12);
			let buttons = 0;
			for (const b of VERBS)
				if (rng.next() < (b === Button.DEBUG_HIT ? hitChance : 0.35)) buttons = bit32.bor(buttons, b);
			const aiming = rng.next() < 0.5;
			const moveX = axis();
			const moveZ = axis();
			const aimX = aiming ? axis() : 0;
			const aimZ = aiming ? axis() : 0;
			current = { moveX, moveZ, aimX, aimZ, buttons };
		}
		hold--;
		return current;
	};
}

describe("player verbs replay deterministically (open arena)", () => {
	const seed = 0x1e15;
	const config: SimConfig = DEFAULT_SIM_CONFIG;
	const deltaRng = new Rng(bit32.bxor(seed, 0xbeef));
	const nextInput = makeVerbInput(seed, 0.3);
	const state = createSimState(seed, 0, 0);
	const recorder = new Recorder(seed, 0, 0);
	const loop = new FixedStepLoop();
	const counts = { rolls: 0, flasks: 0, embers: 0, hits: 0, deathTick: -1 };
	let midpoint: SimState | undefined;
	while (recorder.size() < VERB_TICKS) {
		const r = deltaRng.next();
		const delta = r < 0.02 ? 0.3 : (1 + deltaRng.next() * 7) / 240;
		const input = nextInput();
		loop.advance(delta, () => {
			recorder.record(input);
			step(state, input, config);
			counts.rolls += state.events.rollStarted;
			counts.flasks += state.events.flaskUsed;
			counts.embers += state.events.emberUsed;
			counts.hits += state.events.playerHits;
			if (state.events.playerDied !== 0) counts.deathTick = state.tick;
			if (state.tick === VERB_TICKS / 2) midpoint = cloneSimState(state);
		});
	}
	const recording = recorder.getRecording();

	it("exercises roll, flask, Ember, hits and death", () => {
		expect(counts.rolls).toBeGreaterThan(5);
		expect(counts.flasks).toBeGreaterThan(0);
		expect(counts.embers).toBe(2);
		expect(counts.hits).toBeGreaterThan(3);
		expect(counts.deathTick).toBeGreaterThan(0);
		expect(state.player.dead).toBe(1);
	});

	it("replays to the identical hash and state", () => {
		const replayed = runReplay(recording, config);
		expect(hashState(replayed)).toBe(hashState(state));
		expect(replayed.player).toEqual(state.player);
	});

	it("matches at the midpoint, and continuing a clone from there reaches the same end", () => {
		expect(midpoint).never.toBe(undefined);
		const mid = midpoint!;
		expect(hashState(runReplay(recording, config, VERB_TICKS / 2))).toBe(hashState(mid));
		const c = cloneSimState(mid);
		for (let t = VERB_TICKS / 2; t < recording.frames.size(); t++) step(c, recording.frames[t], config);
		expect(hashState(c)).toBe(hashState(state));
	});

	it("dropping the first DEBUG_HIT press that landed changes the outcome", () => {
		const frames = recording.frames.map((f) => ({ ...f }));
		const s = createSimState(recording.seed, 0, 0);
		let i = -1;
		for (let t = 0; t < frames.size() && i < 0; t++) {
			step(s, frames[t], config);
			if (s.events.playerHits > 0) i = t;
		}
		expect(i).toBeGreaterThan(0);
		while (i > 0 && bit32.band(frames[i - 1].buttons, Button.DEBUG_HIT) !== 0) i--;
		while (i < frames.size() && bit32.band(frames[i].buttons, Button.DEBUG_HIT) !== 0) {
			frames[i].buttons = bit32.band(frames[i].buttons, bit32.bnot(Button.DEBUG_HIT));
			i++;
		}
		expect(hashState(runReplay({ ...recording, frames }, config))).never.toBe(hashState(state));
	});
});
