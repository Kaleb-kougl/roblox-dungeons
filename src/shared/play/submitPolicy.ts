/**
 * When the client submits a finished run, and what it refuses to send (the SimController applies these; pure so they
 * are tested headlessly). docs/SERVER.md "Client submit rules".
 */
import { DEFAULT_RUN_LIMITS, type RunLimits, type RunSubmission } from "shared/run";
import { MIN_ABANDONED_SUBMIT_TICKS } from "./config";

/** Why a run ended, as the SimController submits it. */
export type RunEnding = "death" | "victory" | "abandoned";

/**
 * Whether a finished run is submitted: always for a death or a victory; an abandoned run (R) only when it lasted at
 * least MIN_ABANDONED_SUBMIT_TICKS, or when it is the first run after a death (the session's retry signal).
 */
export function shouldSubmitRun(ending: RunEnding, ticks: number, firstRunAfterDeath: boolean): boolean {
	if (ticks <= 0) return false;
	if (ending !== "abandoned") return true;
	return firstRunAfterDeath || ticks >= MIN_ABANDONED_SUBMIT_TICKS;
}

/** Why a run is never sent, whatever its length (the verdict line's `skipped` code). */
export type UnsubmittedReason = "tutorial" | "stress" | "scored";

/** What decides whether a run can be submitted at all (the SimController's RunContext). */
export interface SubmitEligibility {
	/** A first-run tutorial run (world `tutorial`): played locally, never submitted, no segments. */
	readonly tutorial: boolean;
	/** Stress target (0 = off): the server never builds a stress config. */
	readonly stress: number;
	/** KV_Scoring on an M1 world: the server replays the unscored config, so the hash would never match. */
	readonly scoring: boolean;
}

/** The reason a run is never submitted, or undefined when it may be (then shouldSubmitRun decides). */
export function unsubmittedReason(run: Readonly<SubmitEligibility>): UnsubmittedReason | undefined {
	if (run.tutorial) return "tutorial";
	if (run.stress > 0) return "stress";
	if (run.scoring) return "scored";
	return undefined;
}

/** A submission the server would reject unread, so the client keeps it (code + reason for the verdict line). */
export interface LocalRejection {
	readonly code: "too_large" | "too_long";
	readonly reason: string;
}

/** The server's size and length caps, checked before sending: undefined when the submission may be sent. */
export function oversizeSubmission(
	submission: Readonly<RunSubmission>,
	limits: Readonly<RunLimits> = DEFAULT_RUN_LIMITS,
): LocalRejection | undefined {
	if (buffer.len(submission.recording) > limits.maxRecordingBytes) {
		return { code: "too_large", reason: "not sent: recording over cap" };
	}
	if (submission.claimed.ticks > limits.maxTicks) return { code: "too_long", reason: "not sent: run over tick cap" };
	return undefined;
}

/** What decides whether a run start asks the server for a ranked run (Workspace attributes, shared/play config). */
export interface RankedRunInputs {
	/** KV_Seed is set: the player (developer) picked the seed, which a ranked run never allows. */
	readonly seedAttributeSet: boolean;
	/** KV_World is set: a debug world. */
	readonly worldAttributeSet: boolean;
	/** Stress target (0 = off). Stress runs are never submitted. */
	readonly stress: number;
}

/**
 * A run start asks the server (`startRun`) for a ranked run, unless a debug attribute fixed the seed or the world,
 * or stress is on: those play unranked on the local seed (and submit the old way, except stress).
 */
export function shouldRequestServerRun(inputs: RankedRunInputs): boolean {
	return !inputs.seedAttributeSet && !inputs.worldAttributeSet && !(inputs.stress > 0);
}
