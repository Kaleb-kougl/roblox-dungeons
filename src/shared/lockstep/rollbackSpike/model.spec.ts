/**
 * The rollback spike's prediction model (docs/ROLLBACK_SPIKE.md Design 2-4, task R2), default `npm test` path: the two
 * sanity rules (Design 3) hold exactly on real bot fights, the model never changes the confirmed state's hash, a sliced
 * prediction (the worker's way) and another copy function give the same numbers, a LiveSummary built from its counts
 * passes the server's reader, any capture present replays through it, and one small real pass prints the report
 * table (a 3-player recordPartyRun's first floor 1 fight, L 11, D 4, repeatLast) with the cost per frame. The sanity
 * rules run over two windows of that run (its first fight: kills, swings, erases; its boss fight: the boss's bullets)
 * and of the noisy bot's run (drifting aim, tapped attacks, random rolls). The full sweep is model.sweep.spec.ts
 * (opt-in).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { ROLLBACK_LIVE_METRICS, ROLLBACK_ROOM_TYPES, readLiveSummary, type LiveSummary } from "shared/spikes";
import {
	Button,
	createSimState,
	hashState,
	partyFrameAt,
	simWorldConfig,
	stepParty,
	stepRecorded,
	type InputFrame,
	type Recording,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { recordNoisyPartyRun, recordPartyRun, type RecordedPartyRun } from "shared/run/testing";
import {
	BulletTracker,
	ERROR_ENTITY_NAMES,
	RESULTS_TABLE_HEADER,
	ROLLBACK_GLITCH_METRICS,
	ROLLBACK_SPIKE,
	RollbackMetrics,
	RollbackModel,
	RoomKind,
	ViewDigest,
	captureModelInput,
	cloneSimState,
	fillDigest,
	firstTickWhere,
	formatReport,
	formatResultsRow,
	loadCaptureModules,
	roomTypeOf,
	runModelOverRecording,
	sharedRootOf,
	type ModelRunOptions,
} from ".";

const SEED = 4242;
const PLAYERS = 3;
/** Frames of the real pass (the first fight), of each sanity window, of the equality checks. */
const REAL_FRAMES = 300;
const SANITY_FRAMES = 150;
const SAME_FRAMES = 90;
/** Into the boss fight before its window starts (the boss's first volleys are in flight). */
const WINDOW_LEAD_IN = 60;
/** Frames of a capture's pass (from its start). */
const CAPTURE_FRAMES = 300;

interface Windowed {
	readonly run: RecordedPartyRun;
	/** The first floor 1 fight's first tick, and the boss fight's (plus WINDOW_LEAD_IN). */
	readonly fightTick: number;
	readonly bossTick: number;
}

function windowed(run: RecordedPartyRun): Windowed {
	const config = run.setup.config;
	const fight = firstTickWhere(config, run.recording, (s) => roomTypeOf(s, 0) === RoomKind.COMBAT);
	const boss = firstTickWhere(config, run.recording, (s) => roomTypeOf(s, 0) === RoomKind.BOSS);
	if (fight === undefined || boss === undefined) error("model.spec: a bot run never fought", 0);
	return { run, fightTick: fight, bossTick: boss + WINDOW_LEAD_IN };
}

let botRun: Windowed | undefined;
let noisyRun: Windowed | undefined;

function bot(): Windowed {
	if (botRun === undefined) botRun = windowed(recordPartyRun(SEED, PLAYERS, { walkTicks: 900 }));
	return botRun;
}

function noisy(): Windowed {
	if (noisyRun === undefined) noisyRun = windowed(recordNoisyPartyRun(SEED, PLAYERS, { walkTicks: 900 }));
	return noisyRun;
}

function glitches(m: RollbackMetrics): string {
	const parts: string[] = [];
	for (const name of ROLLBACK_GLITCH_METRICS) {
		const n = m.total(name);
		if (n !== 0) parts.push(`${name}=${n}`);
	}
	return parts.join(" ");
}

/** Windows per sanity pass: both runs' first fight and boss fight. */
const SANITY_WINDOWS = 4;

/** A pass over the sanity windows, merged. */
function sanityPass(options: Omit<ModelRunOptions, "fromTick" | "toTick">): RollbackMetrics {
	const merged = new RollbackMetrics();
	for (const w of [bot(), noisy()]) {
		for (const from of [w.fightTick, w.bossTick]) {
			const r = runModelOverRecording(w.run.setup.config, w.run.recording, {
				...options,
				fromTick: from,
				toTick: from + SANITY_FRAMES,
			});
			merged.merge(r.metrics);
		}
	}
	return merged;
}

/** What there was to get wrong: events and bullets in the truth (a sanity pass must not be vacuous). */
function material(m: RollbackMetrics): string {
	let events = 0;
	for (const n of m.truthEvents) events += n;
	return `${events} true events (kill ${m.truthEvents[0]}, erase ${m.truthEvents[3]}, hit ${m.truthEvents[4]}), ${m.truthBullets} bullet-ticks in view, ${m.correction[0].count} enemy and ${m.correction[3].count} bullet corrections compared`;
}

/** Every number two passes must share (counts, distributions, counters), as one string. */
function fingerprint(m: RollbackMetrics): string {
	const parts: string[] = [];
	for (let r = 0; r < ROLLBACK_ROOM_TYPES.size(); r++) {
		parts.push(`${ROLLBACK_ROOM_TYPES[r]} ${string.format("%.6f", m.seconds[r])}: ${m.counts[r].join(",")}`);
	}
	for (let e = 0; e < ERROR_ENTITY_NAMES.size(); e++) {
		for (const h of [m.truthError[e], m.correction[e], m.cheapError[e]]) {
			parts.push(`${ERROR_ENTITY_NAMES[e]} ${h.count} ${string.format("%.9f", h.sum)} ${h.max} ${h.nonzero}`);
		}
	}
	parts.push(`events ${m.truthEvents.join(",")} / ${m.drawnEvents.join(",")}, bullets ${m.truthBullets}`);
	parts.push(`frames ${m.frames} predictions ${m.predictions} ticks ${m.predictedTicks} draft ${m.draftTicks}`);
	return parts.join("\n");
}

/** The confirmed state replayed plainly to `tick`. */
function replayTo(config: Readonly<SimConfig>, rec: Readonly<Recording>, tick: number): SimState {
	const state = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
	while (state.tick < tick) stepRecorded(state, rec, state.tick, config);
	return state;
}

describe("rollback spike model (R2)", () => {
	it("sanity: perfect guesses (teammates' true inputs) give zero glitches", () => {
		const m = sanityPass({ playerIndex: 0, L: 11, D: 4, perfect: true });
		print(`[R2] perfect guesses: ${m.frames} frames; ${material(m)}; glitches: ${glitches(m)}`);
		expect(m.predictions).toBe(SANITY_WINDOWS * SANITY_FRAMES);
		expect(m.truthTicks).toBe(SANITY_WINDOWS * SANITY_FRAMES);
		expect(m.truthEvents[0]).toBeGreaterThan(0);
		expect(m.truthBullets).toBeGreaterThan(0);
		expect(glitches(m)).toBe("");
		expect(m.glitchTotal()).toBe(0);
		// Exact: every prediction equals the truth, so every distance compared is 0.
		for (let e = 0; e < ERROR_ENTITY_NAMES.size(); e++) {
			expect(m.truthError[e].nonzero).toBe(0);
			expect(m.correction[e].nonzero).toBe(0);
		}
	});

	it("sanity: L = 0 (no guessed span) gives zero glitches", () => {
		const m = sanityPass({ playerIndex: 1, L: 0, D: 4 });
		print(`[R2] L = 0: ${m.frames} frames; ${material(m)}; glitches: ${glitches(m)}`);
		expect(m.predictions).toBe(SANITY_WINDOWS * SANITY_FRAMES);
		expect(m.truthEvents[0]).toBeGreaterThan(0);
		expect(glitches(m)).toBe("");
		expect(m.glitchTotal()).toBe(0);
		expect(m.total("lateEvent")).toBe(0);
	});

	it("never changes the confirmed state; sliced and copy-swapped passes give the same numbers", () => {
		const w = bot();
		const config = w.run.setup.config;
		const rec = w.run.recording;
		const from = w.bossTick;
		const base: ModelRunOptions = { playerIndex: 2, L: 11, D: 4, fromTick: from, toTick: from + SAME_FRAMES };
		const whole = runModelOverRecording(config, rec, base);
		const sliced = runModelOverRecording(config, rec, { ...base, sliceTicks: ROLLBACK_SPIKE.sliceTicks });
		const cloned = runModelOverRecording(config, rec, { ...base, copy: cloneSimState });
		// The confirmed state after the window is the plain replay's: the model never wrote it.
		const plain = hashState(replayTo(config, rec, from + SAME_FRAMES));
		expect(whole.state.tick).toBe(from + SAME_FRAMES);
		expect(hashState(whole.state)).toBe(plain);
		expect(hashState(sliced.state)).toBe(plain);
		expect(hashState(cloned.state)).toBe(plain);
		const f = fingerprint(whole.metrics);
		expect(fingerprint(sliced.metrics)).toBe(f);
		expect(fingerprint(cloned.metrics)).toBe(f);
		expect(whole.metrics.correction[0].count).toBeGreaterThan(0);

		// One prediction by hand: the state's hash is unchanged, the drawn digest is K's.
		const state = replayTo(config, rec, from);
		const model = new RollbackModel({ playerIndex: 2, config });
		model.reset(state);
		const merged: Array<Readonly<InputFrame>> = [];
		for (let t = from; t < from + 4; t++) model.putTruth(t, partyFrameAt(rec, t, merged));
		for (let t = from + 4; t < from + 12; t++) model.putOwn(t, rec.others![1][t]);
		const before = hashState(state);
		const k = model.beginPredict(state);
		expect(k).toBe(from + 12);
		expect(model.isPredicting()).toBe(true);
		expect(() => model.confirm(state)).toThrow();
		let slices = 1;
		while (!model.stepPredict(ROLLBACK_SPIKE.sliceTicks)) slices++;
		expect(slices).toBe(12 / ROLLBACK_SPIKE.sliceTicks);
		expect(model.finishPredict()).toBe(k);
		expect(hashState(state)).toBe(before);
		const times = model.lastTimes();
		expect(times.copy).toBeGreaterThan(0);
		expect(times.step).toBeGreaterThan(0);
		const drawn = model.drawn();
		expect(drawn?.tick).toBe(k);
		expect(drawn!.actorCount).toBeGreaterThan(0);
		expect(drawn!.playerCount).toBe(PLAYERS);
		// A fresh tracker on the confirmed state digests it too (a start: no events).
		const tracker = BulletTracker.forState(state);
		tracker.init(state);
		const d = new ViewDigest();
		fillDigest(d, state, undefined, tracker, 2, state.tick);
		expect(d.tick).toBe(from);
		expect(d.eventCount).toBe(0);
	});

	it("tracks bullets by key and reads an Ember's clear as erases", () => {
		const w = bot();
		const config = w.run.setup.config;
		const rec = w.run.recording;
		const state = replayTo(config, rec, w.bossTick);
		const tracker = BulletTracker.forState(state);
		tracker.init(state);
		const merged: Array<Readonly<InputFrame>> = [];
		// Follow the fight until a few enemy bullets fly: keys stay put while they fly.
		let guard = 0;
		while (state.combat.enemyBullets.activeCount < 4 && guard < 600) {
			const world = simWorldConfig(state, config);
			stepRecorded(state, rec, state.tick, config);
			tracker.observe(state, world);
			guard++;
		}
		expect(state.combat.enemyBullets.activeCount).toBeGreaterThanOrEqual(4);
		const keys = new Set<number>();
		for (let k = 0; k < tracker.enemy.count; k++) keys.add(tracker.enemy.key[tracker.enemy.list[k]]);
		expect(keys.size()).toBe(tracker.enemy.count);
		// Player 0 fires an Ember (a press edge): every enemy bullet is cleared.
		const frames = partyFrameAt(rec, state.tick, merged).map((f) => ({ ...f }));
		frames[0].buttons = bit32.band(frames[0].buttons, bit32.bnot(Button.EMBER));
		const world = simWorldConfig(state, config);
		stepParty(state, frames, config);
		tracker.observe(state, world);
		frames[0].buttons = bit32.bor(frames[0].buttons, Button.EMBER);
		const before = tracker.enemy.count;
		const live = new Set<number>();
		for (let k = 0; k < before; k++) live.add(tracker.enemy.key[tracker.enemy.list[k]]);
		const world2 = simWorldConfig(state, config);
		stepParty(state, frames, config);
		tracker.observe(state, world2);
		expect(state.events.bulletsCleared).toBeGreaterThan(0);
		expect(tracker.erasedCount).toBeGreaterThan(0);
		expect(tracker.erasedCount).toBeLessThanOrEqual(before);
		for (let k = 0; k < tracker.erasedCount; k++) expect(live.has(tracker.erased[k])).toBe(true);
	});

	it("builds a LiveSummary the server's reader accepts (round trip)", () => {
		const w = noisy();
		const r = runModelOverRecording(w.run.setup.config, w.run.recording, {
			playerIndex: 1,
			L: 16,
			D: 4,
			strategy: "repeatLastAxesOnly",
			fromTick: w.fightTick,
			toTick: w.fightTick + SANITY_FRAMES,
		});
		const summary: LiveSummary = {
			sessionId: "spec-session",
			windowIndex: 0,
			strategy: "repeatLastAxesOnly",
			horizon: 20,
			partySize: PLAYERS,
			playerIndex: 1,
			seconds: r.seconds,
			lead: r.metrics.leadSeen(),
			rooms: r.metrics.toLiveSummaryCounts(),
			deviceLabel: "headless",
			deviceClass: "pc",
		};
		const back = readLiveSummary(summary);
		expect(back).toBeDefined();
		let counted = 0;
		for (const room of ROLLBACK_ROOM_TYPES) {
			expect(back!.rooms[room]?.seconds ?? 0).toBe(r.metrics.totalSeconds(room));
			for (const name of ROLLBACK_LIVE_METRICS) {
				expect(back!.rooms[room]?.counts[name] ?? 0).toBe(r.metrics.total(name, room));
				counted += r.metrics.total(name, room);
			}
		}
		expect(counted).toBeGreaterThan(0);
		expect(back!.seconds).toBe(r.seconds);
		expect(back!.lead.lMax).toBe(16);
		expect(back!.lead.dMax).toBe(4);
	});

	it("replays any capture present through the model (skipped when none)", () => {
		const captures = loadCaptureModules(sharedRootOf(script as LuaSourceContainer), print);
		if (captures.size() === 0) {
			print("[R2] no captures (gitignored captures/*.json): capture pass skipped");
			return;
		}
		for (const { name, capture } of captures) {
			const input = captureModelInput(capture);
			if (input === undefined) {
				print(`[R2] capture ${name}: unknown world ${capture.setup.worldKind}, skipped`);
				continue;
			}
			expect(input.hashOk === false).toBe(false);
			const r = runModelOverRecording(input.config, input.recording, {
				playerIndex: 0,
				L: 11,
				D: 4,
				toTick: math.min(input.ticks, CAPTURE_FRAMES),
			});
			print(formatReport(`capture ${name} (${capture.setup.worldKind} seed ${capture.setup.seed})`, r.metrics));
		}
	});

	it("prints the report for one bot fight (L 11, D 4, repeatLast)", () => {
		const w = bot();
		const r = runModelOverRecording(w.run.setup.config, w.run.recording, {
			playerIndex: 0,
			L: 11,
			D: 4,
			strategy: "repeatLast",
			fromTick: w.fightTick,
			toTick: w.fightTick + REAL_FRAMES,
		});
		const perFrame = (r.runtimeSec / math.max(1, r.frames)) * 1000;
		print(
			[
				"",
				formatReport(
					`bot floor 1 fight, ${PLAYERS} players, seed ${SEED}, ticks ${w.fightTick}+${REAL_FRAMES}, player 0`,
					r.metrics,
				),
				"",
				RESULTS_TABLE_HEADER,
				formatResultsRow("bot", 11, 4, "repeatLast", r.metrics),
				"",
				string.format(
					"[R2] %d frames in %.1f s (%.2f ms a frame incl. the confirmed step; per prediction of %d ticks: copy %.2f, step %.2f, other %.2f ms)",
					r.frames,
					r.runtimeSec,
					perFrame,
					15,
					(r.times.copy / r.frames) * 1000,
					(r.times.step / r.frames) * 1000,
					(r.times.other / r.frames) * 1000,
				),
			].join("\n"),
		);
		expect(r.frames).toBe(REAL_FRAMES);
		expect(r.metrics.predictedTicks).toBe(REAL_FRAMES * 15);
		// Not vacuous: bots' guesses are wrong sometimes, so a real pass shows corrections.
		expect(r.metrics.correction[0].count).toBeGreaterThan(0);
	});
});
