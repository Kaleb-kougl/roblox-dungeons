// L6a "Leave run counts as a death": FORFEIT_BUTTON (= PARTY_LEFT_BUTTON) in a solo tick's input kills the player at
// that tick through the death bookkeeping a lethal hit uses (step.ts forfeitSoloRun). It is in the recording, so a
// replay reproduces it bit for bit; it can only end a run (never revive, skip, score); a run without it is unchanged.
import { describe, expect, it } from "@rbxts/jest-globals";
import runFull from "shared/fixtures-generated/run-full-1337";
import { buildEndlessRunConfig, buildRunConfig } from "shared/run";
import { frame } from "shared/run/testing";
import {
	Button,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_SIM_CONFIG,
	DRAFT_MIN_OPEN_TICKS,
	EMPTY_INPUT,
	FORFEIT_BUTTON,
	PARTY_LEFT_BUTTON,
	RECORDED_BUTTONS,
	Relic,
	SIM_BUTTONS,
	SOLO_PLAYER,
	createSimState,
	decodeRecording,
	deserializeRecording,
	encodeRecording,
	forfeitSoloRun,
	grantRelic,
	hashState,
	isDraftOpen,
	isPartyWiped,
	runReplay,
	step,
	type InputFrame,
	type Recording,
	type RunFixture,
	type SimConfig,
	type SimState,
} from "shared/sim";

const LIMITS = { maxTicks: 1e6, maxRecordingBytes: 1e7 };
const FORFEIT = frame(0, 0, FORFEIT_BUTTON);

/** A fresh state stepped through `frames`. */
function play(config: Readonly<SimConfig>, seed: number, x: number, z: number, frames: InputFrame[]): SimState {
	const s = createSimState(seed, x, z, config);
	for (const f of frames) step(s, f, config);
	return s;
}

/** A walk in a slow circle, firing now and then: `n` frames. */
function walk(n: number): InputFrame[] {
	const out: InputFrame[] = [];
	for (let i = 0; i < n; i++) out.push(frame(math.cos(i * 0.02), math.sin(i * 0.02), i % 30 === 0 ? Button.FIRE : 0));
	return out;
}

describe("FORFEIT_BUTTON: the bit", () => {
	it("is the co-op leave bit, outside SIM_BUTTONS (the relay still refuses it from clients), inside RECORDED_BUTTONS", () => {
		expect(FORFEIT_BUTTON).toBe(PARTY_LEFT_BUTTON);
		expect(bit32.band(SIM_BUTTONS, FORFEIT_BUTTON)).toBe(0);
		expect(bit32.band(RECORDED_BUTTONS, FORFEIT_BUTTON)).toBe(FORFEIT_BUTTON);
		expect(RECORDED_BUTTONS).toBe(bit32.bor(SIM_BUTTONS, FORFEIT_BUTTON));
	});
});

describe("solo forfeit in the sim", () => {
	it("forfeit at tick N: dead at N with the death event, not a hit; the run is over; dead for good", () => {
		const frames = walk(200);
		const s = play(DEFAULT_SIM_CONFIG, 7, 0, 0, frames);
		expect(s.player.dead).toBe(0);
		const before = { ...s.player };
		step(s, { ...frames[199], buttons: bit32.bor(Button.FIRE, FORFEIT_BUTTON) });
		expect(s.tick).toBe(201);
		expect([s.player.dead, s.player.hearts, s.events.playerDied, s.events.playerHits]).toEqual([1, 0, 1, 0]);
		expect([s.player.armor, s.player.flask, s.player.embers]).toEqual([before.armor, before.flask, before.embers]);
		expect([s.player.x, s.player.z]).toEqual([before.x, before.z]); // died before moving
		expect(isPartyWiped(s)).toBe(true);
		// Held, or pressed again: idempotent (no second death event); nothing brings the player back.
		step(s, FORFEIT);
		expect([s.player.dead, s.events.playerDied]).toEqual([1, 0]);
		for (let i = 0; i < 120; i++) step(s, frame(1, 0, Button.ROLL + (i % 2) * Button.FLASK));
		expect([s.player.dead, s.player.hearts, s.player.x, s.player.z]).toEqual([1, 0, before.x, before.z]);
		expect(forfeitSoloRun(s)).toBe(false);
	});

	it("Second Wind does not save a forfeit (it is not a hit)", () => {
		const setup = buildEndlessRunConfig(42);
		const s = createSimState(42, setup.spawn!.x, setup.spawn!.z, setup.config);
		grantRelic(s, SOLO_PLAYER, Relic.SECOND_WIND);
		step(s, FORFEIT, setup.config);
		expect([s.player.dead, s.events.playerDied]).toEqual([1, 1]);
		expect(s.run!.events.secondWind).toBe(0);
	});

	it("endless: a forfeit ends the descent (no floor skip, no stairwell); during a draft it closes it without a pick", () => {
		const setup = buildEndlessRunConfig(42);
		const config = setup.config;
		const s = createSimState(42, setup.spawn!.x, setup.spawn!.z, config);
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), config);
		expect([s.endless!.floor, isDraftOpen(s)]).toEqual([2, true]);
		for (let i = 0; i < DRAFT_MIN_OPEN_TICKS + 2; i++) step(s, EMPTY_INPUT, config);
		const steps = s.combat.enemyBullets.stepCount;
		const tick = s.tick;
		const score = s.score!.total;
		// The forfeit tick of an open draft stays frozen (only the draft phase runs), like a co-op leaver's.
		step(s, { ...FORFEIT, buttons: bit32.bor(FORFEIT_BUTTON, Button.FIRE) }, config);
		expect([s.tick, s.player.dead, s.events.playerDied, isDraftOpen(s)]).toEqual([tick + 1, 1, 1, false]);
		expect(s.combat.enemyBullets.stepCount).toBe(steps);
		expect(s.run!.players[SOLO_PLAYER].boons).toEqual([]);
		expect(s.run!.events.draftChosen).toBe(0);
		// Afterwards: no boon, no floor skip, no score from any of it.
		for (let i = 0; i < 20; i++) step(s, frame(0, 0, i % 2 === 0 ? DEBUG_FLOOR_BUTTON + Button.FIRE : 0), config);
		expect([s.endless!.floor, s.player.dead, s.run!.players[SOLO_PLAYER].boons.size()]).toEqual([2, 1, 0]);
		expect(s.score!.total).toBe(score);
	});

	it("a scored real run (run-full-1337, scoring on): the score at the forfeit tick is the score before it", () => {
		const run = runFull as unknown as RunFixture;
		const recording = deserializeRecording(run.recording);
		const config = buildRunConfig(run.seed, { scoring: {} }).config;
		// Where the bot died for real; forfeit 300 ticks earlier (after most of its kills).
		const full = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
		let deathTick = -1;
		for (const f of recording.frames) {
			step(full, f, config);
			if (deathTick < 0 && full.events.playerDied !== 0) deathTick = full.tick;
		}
		expect(deathTick).toBeGreaterThan(300);
		const k = deathTick - 300;
		const s = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
		for (let t = 0; t < k - 1; t++) step(s, recording.frames[t], config);
		const total = s.score!.total;
		expect(total).toBeGreaterThan(0);
		expect(s.player.dead).toBe(0);
		const f = recording.frames[k - 1];
		step(s, { ...f, buttons: bit32.bor(f.buttons, FORFEIT_BUTTON) }, config);
		expect([s.tick, s.player.dead, s.events.playerDied]).toEqual([k, 1, 1]);
		expect(s.score!.total).toBe(total);

		// The same run as a recording: through the binary codec and back, replayed to the same hash.
		const frames: InputFrame[] = [];
		for (let t = 0; t < k - 1; t++) frames.push(recording.frames[t]);
		frames.push({ ...f, buttons: bit32.bor(f.buttons, FORFEIT_BUTTON) });
		const forfeited: Recording = { seed: recording.seed, spawn: recording.spawn, frames };
		const decoded = decodeRecording(encodeRecording(forfeited), LIMITS);
		expect(decoded.ok).toBe(true);
		if (!decoded.ok) return;
		expect(decoded.recording.frames).toEqual(frames);
		const replayed = runReplay(decoded.recording, config);
		expect(hashState(replayed)).toBe(hashState(s));
		expect([replayed.player.dead, replayed.score!.total]).toEqual([1, total]);
	});
});
