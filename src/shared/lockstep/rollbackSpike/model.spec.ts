/**
 * The rollback spike's prediction model (docs/ROLLBACK_SPIKE.md Design 2-4, task R2), default `npm test` path: the two
 * sanity rules (Design 3) hold exactly on a real bot fight, the model never touches the confirmed state, a LiveSummary
 * built from its counts passes the server's reader, and one small real pass prints the report table (a 3-player
 * recordPartyRun's first floor 1 fight, L 11, D 4, repeatLast). The sanity rules run over two windows of that run (its
 * first fight: kills, swings, erases; its boss fight: the boss's bullets) and of the noisy bot's run (drifting aim,
 * tapped attacks, random rolls). The full sweep is model.sweep.spec.ts (opt-in).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { ROLLBACK_LIVE_METRICS, readLiveSummary, type LiveSummary, type RollbackLiveMetric } from "shared/spikes";
import {
	Button,
	createSimState,
	hashState,
	partyFrameAt,
	simWorldConfig,
	stepParty,
	stepRecorded,
	type InputFrame,
} from "shared/sim";
import { recordNoisyPartyRun, recordPartyRun, type RecordedPartyRun } from "shared/run/testing";
import {
	BulletTracker,
	RESULTS_TABLE_HEADER,
	ROLLBACK_GLITCH_METRICS,
	RollbackMetrics,
	RollbackModel,
	RoomKind,
	ViewDigest,
	fillDigest,
	firstTickWhere,
	formatReport,
	formatResultsRow,
	roomTypeOf,
	runModelOverRecording,
	type ModelRunOptions,
} from ".";

const SEED = 4242;
const PLAYERS = 3;
/** Frames of the real pass (the first fight) and of each sanity window. */
const REAL_FRAMES = 300;
const SANITY_FRAMES = 150;
/** Into the boss fight before its window starts (the boss's first volleys are in flight). */
const WINDOW_LEAD_IN = 60;

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
let fightTick = 0;
let bossTick = 0;

function bot(): RecordedPartyRun {
	if (botRun === undefined) {
		botRun = windowed(recordPartyRun(SEED, PLAYERS, { walkTicks: 900 }));
		fightTick = botRun.fightTick;
		bossTick = botRun.bossTick;
	}
	return botRun.run;
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

/** A pass over the sanity windows (both runs' first fight and boss fight), merged. */
function sanityPass(options: Omit<ModelRunOptions, "fromTick" | "toTick">): RollbackMetrics {
	bot();
	const merged = new RollbackMetrics();
	for (const w of [botRun!, noisy()]) {
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

/** Windows per sanity pass. */
const SANITY_WINDOWS = 4;

/** What there was to get wrong: events and bullets in the truth (a sanity pass must not be vacuous). */
function material(m: RollbackMetrics): string {
	let events = 0;
	for (const n of m.truthEvents) events += n;
	return `${events} true events (kill ${m.truthEvents[0]}, erase ${m.truthEvents[3]}), ${m.truthBullets} bullet-ticks, ${m.correction[0].count} enemy corrections compared`;
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
	});

	it("sanity: L = 0 (no guessed span) gives zero glitches", () => {
		const m = sanityPass({ playerIndex: 1, L: 0, D: 4 });
		print(`[R2] L = 0: ${m.frames} frames; ${material(m)}; glitches: ${glitches(m)}`);
		expect(m.predictions).toBe(SANITY_WINDOWS * SANITY_FRAMES);
		expect(m.truthEvents[0]).toBeGreaterThan(0);
		expect(glitches(m)).toBe("");
		expect(m.total("lateEvent")).toBe(0);
	});

	it("tracks bullets by key and reads an Ember's clear as erases", () => {
		const b = bot();
		const config = b.setup.config;
		const rec = b.recording;
		const state = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
		while (state.tick < bossTick) stepRecorded(state, rec, state.tick, config);
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

	it("never touches the confirmed state", () => {
		const b = bot();
		const config = b.setup.config;
		const rec = b.recording;
		const state = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
		while (state.tick < bossTick) stepRecorded(state, rec, state.tick, config);
		const model = new RollbackModel({ playerIndex: 2, config });
		model.reset(state);
		const merged: Array<Readonly<InputFrame>> = [];
		for (let t = bossTick; t < bossTick + 4; t++) model.putTruth(t, partyFrameAt(rec, t, merged));
		for (let t = bossTick + 4; t < bossTick + 12; t++) model.putOwn(t, rec.others![1][t]);
		const before = hashState(state);
		const k = model.predict(state);
		expect(k).toBe(bossTick + 12);
		expect(hashState(state)).toBe(before);
		const drawn = model.drawn();
		expect(drawn?.tick).toBe(k);
		expect(drawn!.actorCount).toBeGreaterThan(0);
		expect(drawn!.playerCount).toBe(PLAYERS);
		// A fresh tracker on the confirmed state digests it too (a start: no events).
		const tracker = BulletTracker.forState(state);
		tracker.init(state);
		const d = new ViewDigest();
		fillDigest(d, state, undefined, tracker, 2, state.tick);
		expect(d.tick).toBe(bossTick);
		expect(d.eventCount).toBe(0);
	});

	it("builds a LiveSummary the server's reader accepts", () => {
		const b = bot();
		const r = runModelOverRecording(b.setup.config, b.recording, {
			playerIndex: 0,
			L: 6,
			D: 0,
			fromTick: bossTick,
			toTick: bossTick + 60,
		});
		const summary: LiveSummary = {
			sessionId: "spec-session",
			windowIndex: 0,
			strategy: "repeatLast",
			horizon: 6,
			partySize: PLAYERS,
			playerIndex: 0,
			seconds: r.seconds,
			lead: r.metrics.leadSeen(),
			rooms: r.metrics.toLiveSummaryCounts(),
			deviceLabel: "headless",
			deviceClass: "pc",
		};
		const back = readLiveSummary(summary);
		expect(back).toBeDefined();
		for (const m of ROLLBACK_LIVE_METRICS) {
			const name = m as RollbackLiveMetric;
			expect(back!.rooms.boss?.counts[name] ?? 0).toBe(r.metrics.total(name, "boss"));
		}
		expect(back!.lead.lMax).toBe(6);
	});

	it("prints the report for one bot fight (L 11, D 4, repeatLast)", () => {
		const b = bot();
		const r = runModelOverRecording(b.setup.config, b.recording, {
			playerIndex: 0,
			L: 11,
			D: 4,
			strategy: "repeatLast",
			fromTick: fightTick,
			toTick: fightTick + REAL_FRAMES,
		});
		const perFrame = (r.runtimeSec / math.max(1, r.frames)) * 1000;
		print(
			[
				"",
				formatReport(
					`bot floor 1 fight, ${PLAYERS} players, seed ${SEED}, ticks ${fightTick}+${REAL_FRAMES}`,
					r.metrics,
				),
				"",
				RESULTS_TABLE_HEADER,
				formatResultsRow("bot", 11, 4, "repeatLast", r.metrics),
				"",
				string.format(
					"[R2] %d frames in %.1f s (%.1f ms a frame: copy %.1f, step %.1f, model %.1f ms); warm-up %.1f s",
					r.frames,
					r.runtimeSec,
					perFrame,
					(r.times.copy / r.frames) * 1000,
					(r.times.step / r.frames) * 1000,
					(r.times.other / r.frames) * 1000,
					r.warmSec,
				),
			].join("\n"),
		);
		expect(r.frames).toBe(REAL_FRAMES);
		expect(r.metrics.predictedTicks).toBe(REAL_FRAMES * 15);
		// Not vacuous: bots' guesses are wrong sometimes, so a real pass shows corrections.
		expect(r.metrics.correction[0].count).toBeGreaterThan(0);
	});
});
