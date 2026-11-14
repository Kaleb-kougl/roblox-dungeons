// docs/SILVER.md SV4: the validator's final check reads the run's Silver rows (readSilver) from the server's own final
// state and carries them on accepted results only. Two recorded endless runs (the solo descent recordEndlessRun: debug
// skips, a boss kill on floor 5, two stairwells walked; the 2-player party run recordPartyRun: floor 1 walked, the
// floor-5 boss fought) are cut into segments with checkpoint hashes, offered to a SegmentedValidator built from the
// recording's config and finished with the honest claim: `result.silver` equals runSilver(silverRunInputOf(...)) on
// the recorder's final state. A lying claim (rejected at the final check) and an aborted run carry none.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	createSimState,
	encodeRecording,
	hashState,
	runStartHalfHearts,
	stepRecorded,
	type InputFrame,
	type Recording,
	type SimState,
} from "shared/sim";
import { runSilver, silverRowOf, silverRunInputOf, type RunSilver } from "shared/silver";
import {
	DEFAULT_SEGMENT_LIMITS,
	RunTelemetry,
	SegmentedValidator,
	readSilver,
	stateRunScore,
	summarizeRun,
	type RunFinal,
	type RunSegment,
	type RunSetup,
	type SegmentedRunResult,
} from "shared/run";
import { recordEndlessRun, recordPartyRun } from "shared/run/testing";

/** Far past every segment's sim time (the clock check is not under test here). */
const LATE = 1e9;
/** The recordings press debug buttons (floor skips, J). */
const LIMITS = { ...DEFAULT_SEGMENT_LIMITS, allowDebugInput: true };
/** Ticks per segment (well under MAX_SEGMENT_TICKS). */
const CUT = 3000;

function rowsText(r: RunSilver): string {
	return `${r.rows.map((x) => `${x.row} ${x.count}/${x.silver}`).join(", ")} = ${r.sum}`;
}

function sliceOf(rec: Readonly<Recording>, a: number, b: number): Recording {
	const take = (frames: ReadonlyArray<InputFrame>) => {
		const out: InputFrame[] = [];
		const last = b - 1;
		for (let t = a; t <= last; t++) out.push(frames[t]);
		return out;
	};
	const out: Recording = { seed: rec.seed, spawn: { x: rec.spawn.x, z: rec.spawn.z }, frames: take(rec.frames) };
	if (rec.others !== undefined) out.others = rec.others.map(take);
	return out;
}

/** The client's side: replay `rec`, cutting every CUT ticks with checkpoint hashes; the honest final claim. */
function segmentsOf(
	runId: string,
	rec: Readonly<Recording>,
	setup: RunSetup,
): { segments: RunSegment[]; final: RunFinal; state: SimState } {
	const config = setup.config;
	const state = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
	const telemetry = new RunTelemetry(runStartHalfHearts(config));
	const every = LIMITS.checkpointEvery;
	const n = rec.frames.size();
	const segments: RunSegment[] = [];
	let start = 0;
	let checkpoints: string[] = [];
	for (let t = 0; t < n; t++) {
		stepRecorded(state, rec, t, config);
		telemetry.observe(state);
		const tick = state.tick;
		const cut = tick - start >= CUT || tick === n;
		if (!cut && tick % every === 0) checkpoints.push(hashState(state));
		if (cut) {
			segments.push({
				runId,
				index: segments.size(),
				startTick: start,
				recording: encodeRecording(sliceOf(rec, start, tick)),
				claimedEndHash: hashState(state),
				checkpointHashes: checkpoints,
			});
			start = tick;
			checkpoints = [];
		}
	}
	const summary = summarizeRun(state, telemetry.finish());
	const score = stateRunScore(state);
	const final: RunFinal = {
		runId,
		finalTick: state.tick,
		claimedHash: hashState(state),
		claimed: { ...summary, score: score.score, floor: score.floor },
	};
	return { segments, final, state };
}

function validate(
	runId: string,
	rec: Readonly<Recording>,
	setup: RunSetup,
	edit?: (f: RunFinal) => RunFinal,
): { result: SegmentedRunResult | undefined; state: SimState; final: RunFinal } {
	const v = new SegmentedValidator({
		runId,
		seed: rec.seed,
		worldKind: "endless",
		setup,
		createdAt: 0,
		limits: LIMITS,
	});
	const { segments, final, state } = segmentsOf(runId, rec, setup);
	for (const seg of segments) expect(v.offer(seg, LATE).ok).toBe(true);
	const claim = edit !== undefined ? edit(final) : final;
	let result = v.finish(claim, LATE);
	while (v.hasWork()) result = v.advance(2000).result ?? result;
	return { result: result ?? v.getResult(), state, final };
}

describe("SegmentedRunResult.silver (SV4)", () => {
	const solo = recordEndlessRun(1337);
	const soloSetup: RunSetup = solo.setup;
	const soloRun = validate("silver-solo", solo.recording, soloSetup);

	it("a solo replay: accepted, silver = runSilver on the final state", () => {
		const r = soloRun.result!;
		expect([r.ok, r.reason]).toEqual([true, undefined]);
		const want = runSilver(silverRunInputOf(solo.drv.state, r.summary, soloSetup.config));
		expect(r.silver).toEqual(want);
		expect(readSilver(soloRun.state, r.summary, soloSetup.config)).toEqual(want);
		// the descent killed the floor-5 boss (Depth 2) and descended floors 1-7
		expect(silverRowOf(want, "bosses")).toBe(80);
		expect(silverRowOf(want, "floors")).toBe(7 * 5 + 28);
		expect(want.sum > 0).toBe(true);
		print(`[silver SV4] solo 1337: ${rowsText(want)}`);
	});

	it("a party replay: accepted, silver = runSilver on the final state", () => {
		const party = recordPartyRun(4242, 2);
		const setup: RunSetup = party.setup;
		const { result } = validate("silver-party", party.recording, setup);
		expect([result?.ok, result?.reason]).toEqual([true, undefined]);
		const want = runSilver(silverRunInputOf(party.drv.state, result!.summary, setup.config));
		expect(result!.silver).toEqual(want);
		print(`[silver SV4] party 4242 x2: ${rowsText(want)}`);
	});

	it("absent on rejections (a lying final claim, an abort)", () => {
		const lie = validate("silver-lie", solo.recording, soloSetup, (f) => ({
			...f,
			claimed: { ...f.claimed, score: f.claimed.score + 1 },
		}));
		expect([lie.result?.ok, lie.result?.code]).toEqual([false, "score_mismatch"]);
		expect(lie.result?.silver).toBe(undefined);
		const v = new SegmentedValidator({
			runId: "silver-abort",
			seed: solo.recording.seed,
			worldKind: "endless",
			setup: soloSetup,
			createdAt: 0,
			limits: LIMITS,
		});
		const aborted = v.abort("abandoned", "left");
		expect([aborted.ok, aborted.silver]).toEqual([false, undefined]);
	});
});
