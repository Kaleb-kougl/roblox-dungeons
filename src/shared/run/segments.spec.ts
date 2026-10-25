// Segmented validation (M3): golden recordings split into segments at many cut points replay to the fixtures' final
// hashes; tampering is caught in the segment it happened in (never earlier); protocol violations reject with their
// own codes; budgeted stepping over many slices equals one pass.
import { describe, expect, it } from "@rbxts/jest-globals";
import runBoss from "shared/fixtures-generated/run-boss-1337";
import runFull from "shared/fixtures-generated/run-full-1337";
import runPlayerDungeon from "shared/fixtures-generated/run-player-dungeon-1337";
import {
	Button,
	createSimState,
	decodeRecording,
	deserializeRecording,
	encodeRecording,
	hashState,
	step,
	type InputFrame,
	type Recording,
	type SimState,
} from "shared/sim";
import { SegmentCutter } from "shared/play";
import {
	DEFAULT_SEGMENT_LIMITS,
	MAX_SEGMENT_BYTES,
	MAX_SEGMENT_TICKS,
	SEGMENT_CHECKPOINT_TICKS,
	SegmentedValidator,
	buildWorldSetup,
	checkpointCount,
	replayTurn,
	type RunFinal,
	type RunSegment,
	type RunSetup,
	type SegmentLimits,
	type SegmentRejectCode,
	type SegmentVerdict,
	type SegmentedRunResult,
} from "shared/run";

interface RunFixtureLike {
	readonly seed: number;
	readonly recording: string;
	readonly finalHash: string;
	readonly ticks: number;
	readonly totals: { readonly enemiesKilled: number; readonly bossDefeated: number; readonly playerDied: number };
}

const RUN_ID = "run-test";
/** A well-formed hash no real state has (a state hash, not an asset id). */
const ZERO_HASH = "00000000"; // check-asset-ids: allow (a state hash, not an asset id)
/** A session clock far past every run's length (the clock_ahead check has its own test). */
const LATE = 1e9;
const DEV_LIMITS: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, allowDebugInput: true };

interface World {
	readonly kind: string;
	readonly atBossDoor: boolean;
	readonly limits: SegmentLimits;
}

const GAME: World = { kind: "game", atBossDoor: false, limits: DEFAULT_SEGMENT_LIMITS };
/** run-boss-1337 starts at the boss door and presses J (DEBUG_BOSS): dev limits. */
const BOSS: World = { kind: "game", atBossDoor: true, limits: DEV_LIMITS };
const NO_ENEMIES: World = { kind: "dungeonNoEncounter", atBossDoor: false, limits: DEFAULT_SEGMENT_LIMITS };

function setupFor(f: RunFixtureLike, w: World): RunSetup {
	return buildWorldSetup(w.kind, f.seed, { atBossDoor: w.atBossDoor });
}

/** The client's side, exactly as LiveRun does it: step every frame, cut with SegmentCutter after the listed ticks. */
function cutRun(
	recording: Recording,
	setup: RunSetup,
	cutAfter: ReadonlyArray<number>,
	frames: ReadonlyArray<InputFrame> = recording.frames,
): { segments: RunSegment[]; final: RunFinal; state: SimState } {
	const state = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, setup.config);
	const cutter = new SegmentCutter(RUN_ID);
	const cuts = new Set(cutAfter);
	const segments: RunSegment[] = [];
	for (let t = 0; t < frames.size(); t++) {
		step(state, frames[t], setup.config);
		cutter.observe(state);
		if (cuts.has(state.tick)) {
			const s = cutter.cut(state, frames, recording.seed, recording.spawn);
			if (s !== undefined) segments.push(s);
		}
	}
	const last = cutter.cut(state, frames, recording.seed, recording.spawn);
	if (last !== undefined) segments.push(last);
	const final: RunFinal = {
		runId: RUN_ID,
		finalTick: state.tick,
		claimedHash: hashState(state),
		claimed: { ticks: state.tick, kills: 0, bossDefeated: false, died: false, score: 0, floor: 1 },
	};
	return { segments, final, state };
}

function claimFor(f: RunFixtureLike, final: RunFinal): RunFinal {
	return {
		...final,
		claimed: {
			...final.claimed,
			kills: f.totals.enemiesKilled,
			bossDefeated: f.totals.bossDefeated > 0,
			died: f.totals.playerDied > 0,
		},
	};
}

function validatorFor(f: RunFixtureLike, w: World, limits: SegmentLimits = w.limits): SegmentedValidator {
	return new SegmentedValidator({
		runId: RUN_ID,
		seed: f.seed,
		worldKind: w.kind,
		setup: setupFor(f, w),
		createdAt: 0,
		limits,
	});
}

interface Outcome {
	readonly verdicts: SegmentVerdict[];
	readonly result: SegmentedRunResult | undefined;
	readonly advances: number;
}

/** Offers every segment, then the final, draining with advance(slice) after each offer. */
function runSegmented(
	v: SegmentedValidator,
	segments: ReadonlyArray<RunSegment>,
	final: RunFinal,
	slice: number,
): Outcome {
	const verdicts: SegmentVerdict[] = [];
	let result: SegmentedRunResult | undefined;
	let advances = 0;
	const drain = () => {
		while (v.hasWork()) {
			const r = v.advance(slice);
			advances++;
			for (const x of r.verdicts) verdicts.push(x);
			if (r.result !== undefined) result = r.result;
		}
	};
	for (const s of segments) {
		const offer = v.offer(s, LATE);
		if (!offer.ok) {
			verdicts.push(offer.verdict);
			return { verdicts, result: v.getResult(), advances };
		}
		drain();
		if (v.getResult() !== undefined) return { verdicts, result: v.getResult(), advances };
	}
	const decided = v.finish(final, LATE);
	if (decided !== undefined) result = decided;
	drain();
	return { verdicts, result: result ?? v.getResult(), advances };
}

function honestSegmented(f: RunFixtureLike, w: World, cutAfter: ReadonlyArray<number>, slice = MAX_SEGMENT_TICKS) {
	const recording = deserializeRecording(f.recording);
	const { segments, final } = cutRun(recording, setupFor(f, w), cutAfter);
	return { segments, outcome: runSegmented(validatorFor(f, w), segments, claimFor(f, final), slice) };
}

describe("SegmentedValidator: golden runs split into segments", () => {
	const CUTS: ReadonlyArray<ReadonlyArray<number>> = [
		[],
		[1800],
		[1, 600, 601, 2999],
		[500, 1000, 1500, 2000, 2500, 3000, 3500],
		[599, 600, 1200, 3599],
	];
	for (const cuts of CUTS) {
		it(`run-full-1337 cut after [${cuts.join(", ")}] reaches the fixture's final hash and is accepted`, () => {
			const { segments, outcome } = honestSegmented(runFull, GAME, cuts);
			expect(segments.size()).toBe(cuts.size() + 1);
			expect(outcome.result?.reason).toBe(undefined);
			expect(outcome.result?.ok).toBe(true);
			expect(outcome.result?.serverHash).toBe(runFull.finalHash);
			expect(outcome.result?.verifiedTicks).toBe(runFull.ticks);
			expect(outcome.result?.summary).toEqual({
				ticks: runFull.ticks,
				kills: runFull.totals.enemiesKilled,
				bossDefeated: runFull.totals.bossDefeated > 0,
				died: runFull.totals.playerDied > 0,
			});
			expect(outcome.result?.score).toEqual({ score: 0, floor: 1 });
			expect(outcome.result?.telemetry?.kills).toBe(runFull.totals.enemiesKilled);
			expect(outcome.verdicts.size()).toBe(segments.size());
			for (let i = 0; i < segments.size(); i++) {
				const v = outcome.verdicts[i];
				expect([v.index, v.ok, v.startTick, v.endTick]).toEqual([i, true, segments[i].startTick, v.endTick]);
				expect(v.serverHash).toBe(segments[i].claimedEndHash);
			}
		});
	}

	it("run-boss-1337 (boss door, debug input under dev limits) in 4 segments reaches the fixture's final hash", () => {
		const { outcome } = honestSegmented(runBoss, BOSS, [450, 900, 1350]);
		expect(outcome.result?.reason).toBe(undefined);
		expect(outcome.result?.ok).toBe(true);
		expect(outcome.result?.serverHash).toBe(runBoss.finalHash);
		expect(outcome.result?.summary.bossDefeated).toBe(runBoss.totals.bossDefeated > 0);
	});

	it("carries one checkpoint hash per SEGMENT_CHECKPOINT_TICKS multiple strictly inside each segment", () => {
		const recording = deserializeRecording(runFull.recording);
		const { segments } = cutRun(recording, setupFor(runFull, GAME), [600, 1000]);
		const sizes = segments.map((s) => s.checkpointHashes.size());
		// [0, 600): none (600 is the end); [600, 1000): none; [1000, 3600): 1200, 1800, 2400, 3000.
		expect(sizes).toEqual([0, 0, 4]);
		expect(checkpointCount(0, 600, SEGMENT_CHECKPOINT_TICKS)).toBe(0);
		expect(checkpointCount(0, 601, SEGMENT_CHECKPOINT_TICKS)).toBe(1);
		expect(checkpointCount(600, 1201, SEGMENT_CHECKPOINT_TICKS)).toBe(1);
		expect(checkpointCount(599, 600, SEGMENT_CHECKPOINT_TICKS)).toBe(0);
	});

	it("budgeted stepping over many small slices gives the same verdicts and result as one pass", () => {
		const recording = deserializeRecording(runFull.recording);
		const { segments, final } = cutRun(recording, setupFor(runFull, GAME), [700, 2100]);
		const claim = claimFor(runFull, final);
		const one = runSegmented(validatorFor(runFull, GAME), segments, claim, MAX_SEGMENT_TICKS);
		const sliced = runSegmented(validatorFor(runFull, GAME), segments, claim, 7);
		expect(sliced.advances).toBeGreaterThan(500);
		expect(one.advances).toBe(3);
		expect(sliced.verdicts).toEqual(one.verdicts);
		expect(sliced.result?.ok).toBe(true);
		expect(sliced.result?.serverHash).toBe(one.result?.serverHash);
		expect(sliced.result?.summary).toEqual(one.result?.summary);
	});

	it("replayTurn: a long segment is replayed over several capped queue turns, to the same verdicts and result", () => {
		const recording = deserializeRecording(runFull.recording);
		const { segments, final } = cutRun(recording, setupFor(runFull, GAME), [700]); // 700 + 2900 ticks
		const claim = claimFor(runFull, final);
		const one = runSegmented(validatorFor(runFull, GAME), segments, claim, MAX_SEGMENT_TICKS);
		const v = validatorFor(runFull, GAME);
		for (const seg of segments) expect(v.offer(seg, LATE).ok).toBe(true);
		expect(v.finish(claim, LATE)).toBe(undefined);
		const turns: Array<[number, number]> = [];
		const verdicts: SegmentVerdict[] = [];
		let result: SegmentedRunResult | undefined;
		for (let guard = 0; guard < 100 && result === undefined; guard++) {
			const t = replayTurn(v, 300, 1000);
			turns.push([t.stepped, t.verdicts.size()]);
			for (const x of t.verdicts) verdicts.push(x);
			result = t.result;
		}
		// Segment 0 (700 ticks) in one turn; segment 1 (2900) over three turns of at most 1000 ticks.
		expect(turns).toEqual([
			[700, 1],
			[1000, 0],
			[1000, 0],
			[900, 1],
		]);
		expect(verdicts).toEqual(one.verdicts);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(one.result?.serverHash);
		expect(replayTurn(v, 300, 1000).stepped).toBe(0); // decided: nothing more
	});

	it("calls the checkpoint hook every checkpointEvery ticks and stops each advance at a segment end", () => {
		const recording = deserializeRecording(runPlayerDungeon.recording);
		const { segments } = cutRun(recording, setupFor(runPlayerDungeon, NO_ENEMIES), [100]);
		const v = validatorFor(runPlayerDungeon, NO_ENEMIES);
		for (const s of segments) expect(v.offer(s, LATE).ok).toBe(true);
		let hooks = 0;
		const r1 = v.advance(1000, { checkpointEvery: 10, onCheckpoint: () => hooks++ });
		expect([r1.stepped, r1.verdicts.size(), hooks]).toEqual([100, 1, 10]);
		const r2 = v.advance(1000);
		expect([r2.stepped, r2.verdicts.size()]).toEqual([500, 1]);
		expect(v.verifiedTicks()).toBe(600);
	});
});

/** A segment rebuilt from `frames` (edited) but carrying the honest segment's claimed hashes. */
function withFrames(s: RunSegment, recording: Recording, frames: ReadonlyArray<InputFrame>): RunSegment {
	const decoded = decodeRecording(s.recording, { maxTicks: MAX_SEGMENT_TICKS, maxRecordingBytes: MAX_SEGMENT_BYTES });
	if (!decoded.ok) error(decoded.reason);
	const n = decoded.recording.frames.size();
	const slice: InputFrame[] = [];
	for (let t = s.startTick; t < s.startTick + n; t++) slice.push(frames[t]);
	return { ...s, recording: encodeRecording({ seed: recording.seed, spawn: recording.spawn, frames: slice }) };
}

describe("SegmentedValidator: tampering is caught in its segment", () => {
	it("an edited input frame in segment 2 rejects at segment 2 (segments 0 and 1 verified), located to 10 s", () => {
		const recording = deserializeRecording(runFull.recording);
		const setup = setupFor(runFull, GAME);
		const cuts = [400, 800, 1600];
		const honest = cutRun(recording, setup, cuts);
		const edited = [...recording.frames];
		const at = 1000;
		const f = edited[at];
		edited[at] = { ...f, moveX: f.moveX > 0 ? f.moveX - 7 : f.moveX + 7 };
		const segments = honest.segments.map((s, i) => (i === 2 ? withFrames(s, recording, edited) : s));
		const v = validatorFor(runFull, GAME);
		const outcome = runSegmented(v, segments, claimFor(runFull, honest.final), MAX_SEGMENT_TICKS);
		expect(outcome.verdicts.map((x) => [x.index, x.ok])).toEqual([
			[0, true],
			[1, true],
			[2, false],
		]);
		const bad = outcome.verdicts[2];
		expect(bad.code).toBe("hash_mismatch");
		expect(outcome.result?.ok).toBe(false);
		expect(outcome.result?.code).toBe("hash_mismatch");
		expect(outcome.result?.failedSegment).toBe(2);
		expect(outcome.result?.verifiedTicks).toBe(800);
		const matched = outcome.result!.matchedThroughTick!;
		const mismatch = outcome.result!.mismatchAtTick!;
		expect(matched).toBeLessThanOrEqual(at);
		expect(mismatch).toBeGreaterThan(at);
		expect(mismatch - matched).toBeLessThanOrEqual(SEGMENT_CHECKPOINT_TICKS);
		// The run is over: later segments and the final are refused without touching the verdict.
		expect(v.getStatus()).toBe("rejected");
		const later = v.offer(honest.segments[3], LATE);
		expect(later.ok ? "" : later.verdict.code).toBe("run_rejected");
		expect(v.finish(claimFor(runFull, honest.final), LATE)?.code).toBe("hash_mismatch");
	});

	it("a forged end hash rejects at the end of its segment", () => {
		const recording = deserializeRecording(runPlayerDungeon.recording);
		const { segments, final } = cutRun(recording, setupFor(runPlayerDungeon, NO_ENEMIES), [200, 400]);
		segments[1] = { ...segments[1], claimedEndHash: "deadbeef" };
		const outcome = runSegmented(validatorFor(runPlayerDungeon, NO_ENEMIES), segments, final, MAX_SEGMENT_TICKS);
		expect(outcome.result?.code).toBe("hash_mismatch");
		expect(outcome.result?.failedSegment).toBe(1);
		expect(outcome.result?.mismatchAtTick).toBe(400);
	});

	it("a lying final claim (hash, summary, score, tick) is rejected after every segment verified", () => {
		const recording = deserializeRecording(runPlayerDungeon.recording);
		const setup = setupFor(runPlayerDungeon, NO_ENEMIES);
		const { segments, final } = cutRun(recording, setup, [300]);
		const cases: Array<[RunFinal, SegmentRejectCode]> = [
			[{ ...final, claimedHash: ZERO_HASH }, "hash_mismatch"],
			[{ ...final, claimed: { ...final.claimed, kills: 3 } }, "summary_mismatch"],
			[{ ...final, claimed: { ...final.claimed, score: 999 } }, "score_mismatch"],
			[{ ...final, claimed: { ...final.claimed, floor: 7 } }, "score_mismatch"],
			[{ ...final, finalTick: 599 }, "final_tick_mismatch"],
			// Malformed numbers are refused up front (runFinalProblem), never compared.
			[{ ...final, finalTick: 0 / 0 }, "bad_final"],
			[{ ...final, finalTick: 599.5 }, "bad_final"],
			[{ ...final, finalTick: -600 }, "bad_final"],
			[{ ...final, claimed: { ...final.claimed, score: 0 / 0 } }, "bad_final"],
			[{ ...final, claimed: { ...final.claimed, floor: 1.5 } }, "bad_final"],
			[{ ...final, claimed: { ...final.claimed, kills: -1 } }, "bad_final"],
			[{ ...final, claimed: { ...final.claimed, ticks: math.huge } }, "bad_final"],
		];
		for (const [claim, code] of cases) {
			const outcome = runSegmented(validatorFor(runPlayerDungeon, NO_ENEMIES), segments, claim, 64);
			expect([code, outcome.result?.code]).toEqual([code, code]);
		}
	});

	it("the score comes from the injected reader on the SERVER's state; the claim is only compared", () => {
		const recording = deserializeRecording(runPlayerDungeon.recording);
		const setup = setupFor(runPlayerDungeon, NO_ENEMIES);
		const { segments, final } = cutRun(recording, setup, []);
		const reader = (s: Readonly<SimState>) => ({ score: s.tick * 2, floor: 3 });
		const make = () =>
			new SegmentedValidator({
				runId: RUN_ID,
				seed: runPlayerDungeon.seed,
				worldKind: NO_ENEMIES.kind,
				setup,
				createdAt: 0,
				readScore: reader,
			});
		const good = runSegmented(
			make(),
			segments,
			{ ...final, claimed: { ...final.claimed, score: 1200, floor: 3 } },
			600,
		);
		expect(good.result?.ok).toBe(true);
		expect(good.result?.score).toEqual({ score: 1200, floor: 3 });
		const lie = runSegmented(
			make(),
			segments,
			{ ...final, claimed: { ...final.claimed, score: 1201, floor: 3 } },
			600,
		);
		expect(lie.result?.code).toBe("score_mismatch");
		expect(lie.result?.score).toEqual({ score: 1200, floor: 3 });
	});
});

describe("SegmentedValidator: protocol violations reject with distinct codes", () => {
	const recording = deserializeRecording(runPlayerDungeon.recording);
	const setup = setupFor(runPlayerDungeon, NO_ENEMIES);
	const honest = cutRun(recording, setup, [200, 400]);

	function firstRefusal(limits: SegmentLimits, segments: ReadonlyArray<RunSegment>, now = LATE): SegmentVerdict {
		const v = validatorFor(runPlayerDungeon, NO_ENEMIES, limits);
		for (const s of segments) {
			const o = v.offer(s, now);
			if (!o.ok) {
				expect(v.getStatus()).toBe("rejected");
				expect(v.getResult()?.code).toBe(o.verdict.code);
				return o.verdict;
			}
		}
		error("no refusal");
	}

	function rawSegment(index: number, startTick: number, frames: InputFrame[], seed = recording.seed): RunSegment {
		const every = SEGMENT_CHECKPOINT_TICKS;
		const n = checkpointCount(startTick, startTick + frames.size(), every);
		const hashes: string[] = [];
		for (let i = 0; i < n; i++) hashes.push(ZERO_HASH);
		return {
			runId: RUN_ID,
			index,
			startTick,
			recording: encodeRecording({ seed, spawn: recording.spawn, frames }),
			claimedEndHash: ZERO_HASH,
			checkpointHashes: hashes,
		};
	}

	const segs = honest.segments;
	const blank = (n: number): InputFrame[] => {
		const out: InputFrame[] = [];
		for (let i = 0; i < n; i++) out.push(recording.frames[0]);
		return out;
	};

	it("out of order, tick gap, wrong run, bad shape", () => {
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [segs[1]]).code).toBe("out_of_order");
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [segs[0], segs[0]]).code).toBe("out_of_order");
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [segs[0], { ...segs[1], startTick: 201 }]).code).toBe("tick_gap");
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [{ ...segs[0], runId: "other" }]).code).toBe("bad_segment");
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [{ ...segs[0], claimedEndHash: "xyz" }]).code).toBe("bad_segment");
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [{ ...segs[0], index: -1 }]).code).toBe("bad_segment");
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [{ ...segs[0], recording: "x" as unknown as buffer }]).code).toBe(
			"bad_segment",
		);
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [{ ...segs[0], checkpointHashes: [ZERO_HASH] }]).code).toBe(
			"bad_segment",
		);
	});

	it("oversized: too many frames, too many bytes, too long a run, too big a backlog", () => {
		const small: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, maxSegmentTicks: 150 };
		expect(firstRefusal(small, [segs[0]]).code).toBe("segment_too_long");
		const tiny: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, maxSegmentBytes: 30 };
		expect(firstRefusal(tiny, [segs[0]]).code).toBe("segment_too_large");
		const shortRun: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, maxRunTicks: 300 };
		const r = firstRefusal(shortRun, segs);
		expect([r.code, r.index]).toEqual(["run_too_long", 1]);
		const backlog: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, maxPendingTicks: 350 };
		const b = firstRefusal(backlog, segs); // offered without advancing: 200 + 200 > 350
		expect([b.code, b.index]).toEqual(["backlog_full", 1]);
	});

	it("debug input bits, unless the limits allow them", () => {
		const frames = blank(10);
		frames[4] = { ...frames[4], buttons: Button.DEBUG_HIT };
		const seg = rawSegment(0, 0, frames);
		const v = firstRefusal(DEFAULT_SEGMENT_LIMITS, [seg]);
		expect(v.code).toBe("debug_input");
		expect(v.reason).toBe("debug input: debug button bits at tick 4");
		const dev = validatorFor(runPlayerDungeon, NO_ENEMIES, DEV_LIMITS);
		expect(dev.offer(seg, LATE).ok).toBe(true);
	});

	it("empty, wrong seed, wrong spawn, malformed, wrong checkpoint count", () => {
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [rawSegment(0, 0, [])]).code).toBe("empty_segment");
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [rawSegment(0, 0, blank(5), 42)]).code).toBe("seed_mismatch");
		const moved = {
			...segs[0],
			recording: encodeRecording({
				seed: recording.seed,
				spawn: { x: recording.spawn.x + 1, z: recording.spawn.z },
				frames: blank(5),
			}),
		};
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [moved]).code).toBe("spawn_mismatch");
		const truncated = buffer.create(10);
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [{ ...segs[0], recording: truncated }]).code).toBe("malformed");
		const long = rawSegment(0, 0, blank(700));
		expect(firstRefusal(DEFAULT_SEGMENT_LIMITS, [{ ...long, checkpointHashes: [] }]).code).toBe("bad_segment");
	});

	it("a segment ahead of the session's wall clock (plus slack) is `clock_ahead`", () => {
		// 200 ticks = 3.3 s of sim time; the slack is 30 s, so 0 s of session age passes and -30 s does not.
		const v = validatorFor(runPlayerDungeon, NO_ENEMIES);
		expect(v.offer(segs[0], 0).ok).toBe(true);
		const strict: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, clockSlackSeconds: 0 };
		expect(firstRefusal(strict, [segs[0]], 1).code).toBe("clock_ahead");
	});

	it("after finish: segments are `run_closed`; finishing twice keeps the first; empty runs are rejected", () => {
		const v = validatorFor(runPlayerDungeon, NO_ENEMIES);
		for (const s of segs) expect(v.offer(s, LATE).ok).toBe(true);
		expect(v.finish(honest.final, LATE)).toBe(undefined); // still to replay
		expect(v.getStatus()).toBe("finishing");
		const again = v.offer(segs[0], LATE);
		expect(again.ok ? "" : again.verdict.code).toBe("run_closed");
		expect(v.finish({ ...honest.final, claimedHash: ZERO_HASH }, LATE)).toBe(undefined);
		while (v.hasWork()) v.advance(1000);
		expect(v.getResult()?.ok).toBe(true);
		const empty = validatorFor(runPlayerDungeon, NO_ENEMIES);
		expect(empty.finish({ ...honest.final, finalTick: 0 }, LATE)?.code).toBe("empty_run");
		const bad = validatorFor(runPlayerDungeon, NO_ENEMIES);
		expect(bad.finish({ ...honest.final, claimedHash: 5 as unknown as string }, LATE)?.code).toBe("bad_final");
	});

	it("abort (expiry, player left) rejects an undecided run and frees it; a decided run keeps its verdict", () => {
		const v = validatorFor(runPlayerDungeon, NO_ENEMIES);
		expect(v.offer(segs[0], LATE).ok).toBe(true);
		v.advance(50);
		expect(v.abort("expired", "expired: no segment for too long").code).toBe("expired");
		expect(v.hasWork()).toBe(false);
		expect(v.pendingTickCount()).toBe(0);
		expect(v.advance(1000).stepped).toBe(0);
		expect(v.abort("abandoned", "x").code).toBe("expired");
	});

	it("an abort while a checkpoint hook yields mid-slice ends that slice cleanly", () => {
		const v = validatorFor(runPlayerDungeon, NO_ENEMIES);
		expect(v.offer(segs[0], LATE).ok).toBe(true);
		let calls = 0;
		const r = v.advance(1000, {
			checkpointEvery: 10,
			onCheckpoint: () => {
				calls++;
				if (calls === 3) v.abort("abandoned", "player left");
			},
		});
		expect(r.stepped).toBe(30);
		expect(r.verdicts.size()).toBe(0);
		expect(v.getResult()?.code).toBe("abandoned");
	});
});
