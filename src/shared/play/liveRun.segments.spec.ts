// Ranked runs on the client (M3): a LiveRun with a runId cuts its recording into segments (a hook such as the endless
// floors' floor change, plus the time fallback), and the server's SegmentedValidator accepts them with the live
// hash, score and summary. Without a runId nothing is cut.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_SEGMENT_LIMITS,
	MAX_SEGMENT_BYTES,
	MAX_SEGMENT_TICKS,
	SEGMENT_FALLBACK_TICKS,
	SegmentedValidator,
	buildWorldSetup,
	type RunSegment,
} from "shared/run";
import { EMPTY_INPUT, SIM_DT, decodeRecording, hashState, quantizeInput, type InputFrame } from "shared/sim";
import { LiveRun, shouldRequestServerRun, type LiveRunSetup } from "shared/play";

const SEED = 1337;
const WORLD = "dungeonNoEncounter";

function setupWith(extra: Partial<LiveRunSetup>): LiveRunSetup {
	const s = buildWorldSetup(WORLD, SEED, { atBossDoor: false });
	return { seed: SEED, spawnX: s.spawn!.x, spawnZ: s.spawn!.z, config: s.config, atBossDoor: false, ...extra };
}

/** Walks in a slow circle while aiming around; one tick per frame. */
function play(run: LiveRun, frames: number): void {
	const input: InputFrame = { ...EMPTY_INPUT };
	for (let n = 0; n < frames; n++) {
		quantizeInput(math.cos(n * 0.01), math.sin(n * 0.01), math.cos(n * 0.03), math.sin(n * 0.03), 0, input);
		run.frame(SIM_DT, input);
	}
}

function frameCount(s: RunSegment): number {
	const r = decodeRecording(s.recording, { maxTicks: MAX_SEGMENT_TICKS, maxRecordingBytes: MAX_SEGMENT_BYTES });
	if (!r.ok) error(r.reason);
	return r.recording.frames.size();
}

describe("LiveRun segments", () => {
	it("cuts on the hook and on the time fallback; the segments cover the run and the server accepts them", () => {
		const run = new LiveRun(
			setupWith({
				runId: "run-1",
				segmentCutAfterTick: (s) => s.tick === 333 || s.tick === 700,
				segmentFallbackTicks: 250,
			}),
		);
		play(run, 1000);
		const final = run.final()!;
		const segments = run.takeSegments();
		expect(run.takeSegments()).toEqual([]); // drained
		// Ends: 250 (fallback), 333 (hook), 583 (fallback), 700 (hook), 950 (fallback), 1000 (final cut).
		const ends = segments.map((s) => s.startTick + frameCount(s));
		expect(ends).toEqual([250, 333, 583, 700, 950, 1000]);
		expect(segments.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(segments[3].startTick).toBe(583);
		expect(run.segmentCount()).toBe(6);
		expect(final.finalTick).toBe(1000);
		expect(final.claimedHash).toBe(hashState(run.state));
		expect(final.claimed.score).toBe(0);
		expect(final.claimed.floor).toBe(1);

		// Every frame of the recorder, in order, exactly once.
		const recorded = run.recorder.frames;
		let t = 0;
		for (const s of segments) {
			const r = decodeRecording(s.recording, {
				maxTicks: MAX_SEGMENT_TICKS,
				maxRecordingBytes: MAX_SEGMENT_BYTES,
			});
			if (!r.ok) error(r.reason);
			for (const f of r.recording.frames) {
				expect(f).toEqual(recorded[t]);
				t++;
			}
		}
		expect(t).toBe(1000);

		const v = new SegmentedValidator({
			runId: "run-1",
			seed: SEED,
			worldKind: WORLD,
			setup: buildWorldSetup(WORLD, SEED, { atBossDoor: false }),
			createdAt: 0,
			limits: DEFAULT_SEGMENT_LIMITS,
		});
		for (const s of segments) expect(v.offer(s, 1e9).ok).toBe(true);
		expect(v.finish(final, 1e9)).toBe(undefined);
		let result = v.getResult();
		while (v.hasWork()) result = v.advance(97).result ?? result;
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(final.claimedHash);
		expect(result?.summary).toEqual(run.summary());
	});

	it("the default fallback keeps every segment under the server's cap", () => {
		expect(SEGMENT_FALLBACK_TICKS).toBeLessThan(MAX_SEGMENT_TICKS);
	});

	it("cutSegment between ticks; nothing to cut twice in a row", () => {
		const run = new LiveRun(setupWith({ runId: "run-2" }));
		play(run, 120);
		const a = run.cutSegment();
		expect(a?.startTick).toBe(0);
		expect(run.cutSegment()).toBe(undefined);
		play(run, 30);
		expect(run.cutSegment()?.startTick).toBe(120);
		expect(run.takeSegments().size()).toBe(2);
	});

	it("an unranked run (no runId) cuts nothing and has no final claim", () => {
		const run = new LiveRun(setupWith({}));
		play(run, 60);
		expect(run.runId()).toBe(undefined);
		expect(run.cutSegment()).toBe(undefined);
		expect(run.final()).toBe(undefined);
		expect(run.takeSegments()).toEqual([]);
	});
});

describe("shouldRequestServerRun", () => {
	it("asks the server unless a debug attribute fixed the seed or world, or stress is on", () => {
		const base = { seedAttributeSet: false, worldAttributeSet: false, stress: 0 };
		expect(shouldRequestServerRun(base)).toBe(true);
		expect(shouldRequestServerRun({ ...base, seedAttributeSet: true })).toBe(false);
		expect(shouldRequestServerRun({ ...base, worldAttributeSet: true })).toBe(false);
		expect(shouldRequestServerRun({ ...base, stress: 200 })).toBe(false);
	});
});
