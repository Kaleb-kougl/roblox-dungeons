/**
 * Tutorial telemetry (docs/TUTORIAL.md §6): the per-player funnel step filter and the AnalyticsService event specs.
 * Pure; OnboardingService feeds it the client's remotes and TelemetryService logs the specs.
 *
 * One ATTEMPT = one funnel session: `tutorialStarted` begins an attempt (a fresh server-generated id, the funnel
 * session id), and every start (first run, "Restart tutorial", a replay from the pause menu) begins a new one. Within
 * an attempt only strictly increasing integer steps in 1..maxStep are logged, so a repeated or late step (a lesson
 * finished out of order, a client resend, a restart that kept the same attempt) is dropped. Steps outside an attempt
 * (before `tutorialStarted`, after `tutorialFinished`) are dropped. The finish closes the attempt.
 *
 * Funnel steps: the lessons are 1..TUTORIAL_FUNNEL_MAX_STEP (the client sends only the number; the name is that
 * step's id in shared/tutorial TUTORIAL_STEPS, so a client cannot invent step names), then `completed`
 * as TUTORIAL_FUNNEL_COMPLETED_STEP. A SKIP is not a funnel step: Roblox counts every step number below a logged one
 * as reached, so a "skipped" step after the lessons would credit every skipper with every lesson. A skip logs the
 * custom event TUTORIAL_SKIPPED_EVENT instead (value = the last lesson step reached in that attempt), and the
 * funnel shows the skipper dropping off where they stopped.
 */
import type { AnalyticsEventSpec } from "shared/run";
import { tutorialStepName } from "shared/tutorial";
import {
	TUTORIAL_FUNNEL,
	TUTORIAL_FUNNEL_COMPLETED_STEP,
	TUTORIAL_FUNNEL_MAX_STEP,
	TUTORIAL_SKIPPED_EVENT,
} from "./config";
import type { TutorialOutcome } from "./doc";

/** What `finish` returns: the closed attempt. */
export interface TutorialAttemptEnd {
	readonly attemptId: string;
	/** The highest lesson step logged in it (0 = none). */
	readonly lastStep: number;
}

export class TutorialFunnelTracker {
	private attemptId: string | undefined;
	private lastStep = 0;

	constructor(private readonly maxStep: number = TUTORIAL_FUNNEL_MAX_STEP) {}

	/** Begins a new attempt (replacing any open one): steps count from 0 again. */
	start(attemptId: string): void {
		this.attemptId = attemptId;
		this.lastStep = 0;
	}

	/** True between `start` and `finish` / `clear`. */
	isActive(): boolean {
		return this.attemptId !== undefined;
	}

	/** The open attempt's id (the funnel session id), or undefined. */
	getAttemptId(): string | undefined {
		return this.attemptId;
	}

	/** The highest step accepted in the open attempt (0 = none or no attempt). */
	getLastStep(): number {
		return this.lastStep;
	}

	/** True (and records it) when `step` should be logged: an attempt is open, and step is an integer in lastStep+1..max. */
	accept(step: number): boolean {
		if (this.attemptId === undefined || !isTutorialStepNumber(step, this.maxStep)) return false;
		if (step <= this.lastStep) return false;
		this.lastStep = step;
		return true;
	}

	/** Closes the open attempt and returns it, or undefined when none was open. */
	finish(): TutorialAttemptEnd | undefined {
		const attemptId = this.attemptId;
		if (attemptId === undefined) return undefined;
		const lastStep = this.lastStep;
		this.clear();
		return { attemptId, lastStep };
	}

	/** Drops the open attempt without logging anything (player left). */
	clear(): void {
		this.attemptId = undefined;
		this.lastStep = 0;
	}
}

/** An integer in 1..maxStep (NaN, infinities, fractions and out-of-range values are not). */
export function isTutorialStepNumber(step: unknown, maxStep: number = TUTORIAL_FUNNEL_MAX_STEP): step is number {
	return typeIs(step, "number") && step === step && step % 1 === 0 && step >= 1 && step <= maxStep;
}

/** The funnel step name of lesson step `step`: its shared/tutorial step id (`step<N>` outside the step list). */
export function tutorialFunnelStepName(step: number): string {
	return tutorialStepName(step) ?? `step${step}`;
}

/** The funnel event of an accepted lesson step (named by the shared step list, never by the client). */
export function tutorialStepEvent(step: number): AnalyticsEventSpec {
	return { kind: "funnel", funnel: TUTORIAL_FUNNEL, step, stepName: tutorialFunnelStepName(step) };
}

/** What a finished attempt logs: `completed` as the final funnel step, or the TUTORIAL_SKIPPED_EVENT custom event. */
export function tutorialFinishEvents(outcome: TutorialOutcome, lastStep: number): AnalyticsEventSpec[] {
	if (outcome === "completed") {
		return [{ kind: "funnel", funnel: TUTORIAL_FUNNEL, step: TUTORIAL_FUNNEL_COMPLETED_STEP, stepName: outcome }];
	}
	return [{ kind: "custom", name: TUTORIAL_SKIPPED_EVENT, value: lastStep }];
}
