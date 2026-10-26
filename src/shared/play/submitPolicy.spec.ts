// Which finished runs the client submits (R-spam must not burn the server's rate budget, a quick retry after a death
// still counts), and the server's caps checked before anything is sent.
import { describe, expect, it } from "@rbxts/jest-globals";
import { MIN_ABANDONED_SUBMIT_TICKS, oversizeSubmission, shouldSubmitRun, unsubmittedReason } from "shared/play";
import {
	DEFAULT_RUN_LIMITS,
	MAX_RECORDING_BYTES,
	MAX_RUN_TICKS,
	RUN_SUBMIT_RATE,
	type RunSubmission,
} from "shared/run";
import { SIM_HZ } from "shared/sim";

function submission(bytes: number, ticks: number): RunSubmission {
	return {
		seed: 1,
		atBossDoor: false,
		recording: buffer.create(bytes),
		claimedHash: "deadbeef",
		claimed: { ticks, kills: 0, bossDefeated: false, died: false },
	};
}

describe("shouldSubmitRun", () => {
	it("deaths and victories are always submitted; empty runs never", () => {
		expect(shouldSubmitRun("death", 1, false)).toBe(true);
		expect(shouldSubmitRun("victory", 1, false)).toBe(true);
		expect(shouldSubmitRun("death", 0, false)).toBe(false);
		expect(shouldSubmitRun("abandoned", 0, true)).toBe(false);
	});

	it("abandoned runs only from 10 s of sim time, or as the first run after a death", () => {
		expect(MIN_ABANDONED_SUBMIT_TICKS).toBe(SIM_HZ * 10);
		expect(shouldSubmitRun("abandoned", MIN_ABANDONED_SUBMIT_TICKS - 1, false)).toBe(false);
		expect(shouldSubmitRun("abandoned", MIN_ABANDONED_SUBMIT_TICKS, false)).toBe(true);
		expect(shouldSubmitRun("abandoned", 1, true)).toBe(true);
	});

	it("restarting as fast as the threshold allows stays inside the server's rate budget", () => {
		const fastestPerWindow = (RUN_SUBMIT_RATE.windowSeconds * SIM_HZ) / MIN_ABANDONED_SUBMIT_TICKS;
		expect(fastestPerWindow).toBeLessThanOrEqual(RUN_SUBMIT_RATE.count);
	});
});

describe("oversizeSubmission", () => {
	it("passes anything within the caps", () => {
		expect(oversizeSubmission(submission(MAX_RECORDING_BYTES, MAX_RUN_TICKS))).toBe(undefined);
	});

	it("keeps a recording over the byte cap (too_large) or a run over the tick cap (too_long)", () => {
		expect(oversizeSubmission(submission(MAX_RECORDING_BYTES + 1, 10))).toEqual({
			code: "too_large",
			reason: "not sent: recording over cap",
		});
		expect(oversizeSubmission(submission(10, MAX_RUN_TICKS + 1))?.code).toBe("too_long");
		expect(oversizeSubmission(submission(200, 10), { ...DEFAULT_RUN_LIMITS, maxRecordingBytes: 100 })?.code).toBe(
			"too_large",
		);
	});
});

describe("unsubmittedReason", () => {
	it("a tutorial run is never submitted, before any other reason", () => {
		expect(unsubmittedReason({ tutorial: true, stress: 0, scoring: false })).toBe("tutorial");
		expect(unsubmittedReason({ tutorial: true, stress: 100, scoring: true })).toBe("tutorial");
	});

	it("stress, then KV_Scoring on an M1 world; otherwise the run may be submitted", () => {
		expect(unsubmittedReason({ tutorial: false, stress: 100, scoring: true })).toBe("stress");
		expect(unsubmittedReason({ tutorial: false, stress: 0, scoring: true })).toBe("scored");
		expect(unsubmittedReason({ tutorial: false, stress: 0, scoring: false })).toBe(undefined);
	});
});
