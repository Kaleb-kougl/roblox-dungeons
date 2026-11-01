/**
 * Tutorial ATTEMPT telemetry (docs/TUTORIAL_FUNNEL.md §3-4; first built in docs/TUTORIAL.md §6): the per-player
 * attempt filter and the AnalyticsService event specs. Pure; OnboardingService feeds it the client's remotes (read by
 * reports.ts) and TelemetryService logs the specs.
 *
 * One ATTEMPT = one session of the recurring funnel TUTORIAL_FUNNEL (`TutorialAttempt`): `tutorialStarted` begins an
 * attempt (a fresh server-generated id, the funnel session id) with its entry and device (TutorialStartInfo), and
 * every start (first join, Restart tutorial, a menu replay, Play again) begins a new one. Within an attempt only
 * strictly increasing integer lesson steps in 1..maxStep are logged, so a repeated or late step (a lesson finished out
 * of order, a client resend, a restart that kept the same attempt) is dropped. Steps outside an attempt (before
 * `tutorialStarted`, after `tutorialFinished`) are dropped. The finish closes the attempt.
 *
 * Attempt funnel steps: 1 `started` (fields: entry / revision / device; Roblox filters apply to step 1 only), lesson n
 * as n + TUTORIAL_FUNNEL_LESSON_OFFSET (the client sends only the number; the name is that step's id in shared/tutorial
 * TUTORIAL_STEPS, so a client cannot invent step names), then `completed` as TUTORIAL_FUNNEL_COMPLETED_STEP. A SKIP is
 * not a funnel step: Roblox counts every step number below a logged one as reached, so a "skipped" step after the
 * lessons would credit every skipper with every lesson. A skip logs the custom event TutorialSkipped instead (value =
 * the last lesson step reached in that attempt), and the funnel shows the skipper dropping off where they stopped.
 *
 * Per attempt the tracker also keeps: the current step id (the latest of the client's noted id and the step after the
 * last funnel step, by step order: the director's current step never moves back), each lesson report once per step,
 * each stuck report once per prompt (at most TUTORIAL_TELEMETRY.maxStuckReportsPerAttempt), and an event counter: the
 * attempt's events stay within TUTORIAL_TELEMETRY.maxEventsPerAttempt, the last exitEventReserve of them kept for the
 * exit (completed / skipped / abandoned / restarted) and the outro, which are never refused. After a completion the
 * outro is open: one TutorialOutroChoice (a client choice, or `left` when the player leaves on it) until the next start.
 */
import type { AnalyticsEventSpec } from "shared/run";
import { TUTORIAL_STEPS, tutorialStepIndex, tutorialStepName } from "shared/tutorial";
import {
	ONBOARDING_TUTORIAL_VERSION,
	TUTORIAL_ANALYTICS_EVENT,
	TUTORIAL_FUNNEL,
	TUTORIAL_FUNNEL_COMPLETED_NAME,
	TUTORIAL_FUNNEL_COMPLETED_STEP,
	TUTORIAL_FUNNEL_LESSON_OFFSET,
	TUTORIAL_FUNNEL_MAX_STEP,
	TUTORIAL_FUNNEL_REVISION,
	TUTORIAL_FUNNEL_STARTED_NAME,
	TUTORIAL_FUNNEL_STARTED_STEP,
	TUTORIAL_TELEMETRY,
} from "./config";
import type { TutorialOutcome } from "./doc";
import {
	TUTORIAL_NO_STEP_ID,
	TUTORIAL_OUTRO_LEFT,
	isTutorialCurrentStepId,
	isTutorialPromptId,
	reportSeconds,
	type TutorialAbandonKind,
	type TutorialEntry,
	type TutorialLessonReport,
	type TutorialOutroChoice,
	type TutorialStartInfo,
	type TutorialStuckReport,
} from "./reports";

/** What `finish` / `abandon` / a replacing `start` return: the closed attempt. */
export interface TutorialAttemptEnd extends TutorialStartInfo {
	readonly attemptId: string;
	/** The highest lesson step logged in it (0 = none). */
	readonly lastStep: number;
	/** Its current step id when it closed (a TUTORIAL_STEPS id, or TUTORIAL_NO_STEP_ID). */
	readonly stepId: string;
}

/** What `takeOutro` returns: the finished attempt's entry and the seconds since its outro opened (0 when unknown). */
export interface TutorialOutroContext {
	readonly entry: TutorialEntry;
	readonly seconds: number;
}

/** The step id for "the step after lesson step `n`" (TUTORIAL_NO_STEP_ID past the last). */
function stepIdAfter(n: number): string {
	return tutorialStepName(n + 1) ?? TUTORIAL_NO_STEP_ID;
}

/** The order of a current-step id (TUTORIAL_NO_STEP_ID last). */
function stepOrder(id: string): number {
	return id === TUTORIAL_NO_STEP_ID ? TUTORIAL_STEPS.size() : tutorialStepIndex(id);
}

export class TutorialFunnelTracker {
	private attemptId: string | undefined;
	private info: TutorialStartInfo | undefined;
	private lastStep = 0;
	private notedStepId: string | undefined;
	private readonly lessonsReported = new Set<number>();
	private readonly stuckPrompts = new Set<string>();
	private events = 0;
	private outro: { entry: TutorialEntry; openedAt: number | undefined } | undefined;

	constructor(private readonly maxStep: number = TUTORIAL_FUNNEL_MAX_STEP) {}

	/**
	 * Begins a new attempt (replacing any open one, which it returns closed: a `restart` logs it as restarted). Steps
	 * count from 0 again, the report dedupe and the event counter reset (the start event counts as one), any open
	 * outro closes.
	 */
	start(attemptId: string, info: TutorialStartInfo): TutorialAttemptEnd | undefined {
		const replaced = this.close();
		this.reset();
		this.attemptId = attemptId;
		this.info = { entry: info.entry, device: info.device };
		this.events = 1;
		return replaced;
	}

	/** True between `start` and `finish` / `abandon` / `clear`. */
	isActive(): boolean {
		return this.attemptId !== undefined;
	}

	/** The open attempt's id (the funnel session id), or undefined. */
	getAttemptId(): string | undefined {
		return this.attemptId;
	}

	/** The open attempt's entry and device, or undefined. */
	getInfo(): Readonly<TutorialStartInfo> | undefined {
		return this.info;
	}

	/** The highest step accepted in the open attempt (0 = none or no attempt). */
	getLastStep(): number {
		return this.lastStep;
	}

	/** The open attempt's current step id (TUTORIAL_NO_STEP_ID once every step is behind it), or undefined. */
	getStepId(): string | undefined {
		if (this.attemptId === undefined) return undefined;
		const derived = stepIdAfter(this.lastStep);
		const noted = this.notedStepId;
		return noted !== undefined && stepOrder(noted) > stepOrder(derived) ? noted : derived;
	}

	/** Events counted for the open attempt (or the last one, until the next start). */
	getEventCount(): number {
		return this.events;
	}

	/** Records the client's current step id (a TUTORIAL_STEPS id or TUTORIAL_NO_STEP_ID); false when dropped. */
	noteStepId(id: unknown): boolean {
		if (this.attemptId === undefined || !isTutorialCurrentStepId(id)) return false;
		if (this.notedStepId === undefined || stepOrder(id) > stepOrder(this.notedStepId)) this.notedStepId = id;
		return true;
	}

	/**
	 * True (and records it) when lesson `step` should be logged: an attempt is open, step is an integer in
	 * lastStep+1..max, and the event budget has room for its one event.
	 */
	accept(step: number): boolean {
		if (this.attemptId === undefined || !isTutorialStepNumber(step, this.maxStep)) return false;
		if (step <= this.lastStep || !this.charge(1)) return false;
		this.lastStep = step;
		return true;
	}

	/**
	 * True (and records it) when a lesson report should be logged: an attempt is open, its step is in 1..max, not yet
	 * reported in this attempt, and the budget has room for its events (tutorialLessonReportEventCount). Takes a
	 * report already read by readLessonReport.
	 */
	acceptLessonReport(r: Readonly<TutorialLessonReport>): boolean {
		if (this.attemptId === undefined || !isTutorialStepNumber(r.step, this.maxStep)) return false;
		if (this.lessonsReported.has(r.step) || !this.charge(tutorialLessonReportEventCount(r))) return false;
		this.lessonsReported.add(r.step);
		return true;
	}

	/**
	 * True (and records it) when a stuck report should be logged: an attempt is open, its prompt is a known prompt id
	 * not yet reported in this attempt, fewer than maxStuckReportsPerAttempt were, and the budget has room.
	 */
	acceptStuckReport(r: Readonly<TutorialStuckReport>): boolean {
		if (this.attemptId === undefined || !isTutorialPromptId(r.prompt)) return false;
		if (this.stuckPrompts.has(r.prompt)) return false;
		if (this.stuckPrompts.size() >= TUTORIAL_TELEMETRY.maxStuckReportsPerAttempt || !this.charge(1)) return false;
		this.stuckPrompts.add(r.prompt);
		return true;
	}

	/**
	 * Closes the open attempt and returns it, or undefined when none was open. A `completed` finish opens the outro
	 * (`at`: the caller's clock in seconds, for the `left` outro's value; omitted = 0 seconds then).
	 */
	finish(outcome?: TutorialOutcome, at?: number): TutorialAttemptEnd | undefined {
		const ended = this.close();
		if (ended !== undefined && outcome === "completed") this.outro = { entry: ended.entry, openedAt: at };
		return ended;
	}

	/** Closes the open attempt without opening an outro (the player left, or a party run took over). */
	abandon(): TutorialAttemptEnd | undefined {
		return this.close();
	}

	/**
	 * The open outro, once (closing it), or undefined: the entry of the attempt it follows and the seconds since it
	 * opened at `now` (same clock as `finish`'s `at`; clamped to maxOutroSeconds, rounded; 0 when either is unknown).
	 */
	takeOutro(now?: number): TutorialOutroContext | undefined {
		const outro = this.outro;
		if (outro === undefined) return undefined;
		this.outro = undefined;
		this.events++;
		const opened = outro.openedAt;
		const elapsed = now !== undefined && opened !== undefined ? now - opened : 0;
		return { entry: outro.entry, seconds: reportSeconds(elapsed, TUTORIAL_TELEMETRY.maxOutroSeconds) ?? 0 };
	}

	/** Drops the open attempt and any open outro without logging anything. */
	clear(): void {
		this.reset();
	}

	/** Spends `n` in-attempt events when they fit under the budget minus the exit reserve. */
	private charge(n: number): boolean {
		const cap = TUTORIAL_TELEMETRY.maxEventsPerAttempt - TUTORIAL_TELEMETRY.exitEventReserve;
		if (this.events + n > cap) return false;
		this.events += n;
		return true;
	}

	/** Closes the open attempt (its exit event counts), returning it; the outro is untouched. */
	private close(): TutorialAttemptEnd | undefined {
		const attemptId = this.attemptId;
		const info = this.info;
		if (attemptId === undefined || info === undefined) return undefined;
		const ended: TutorialAttemptEnd = {
			attemptId,
			entry: info.entry,
			device: info.device,
			lastStep: this.lastStep,
			stepId: this.getStepId() ?? TUTORIAL_NO_STEP_ID,
		};
		this.attemptId = undefined;
		this.info = undefined;
		this.lastStep = 0;
		this.notedStepId = undefined;
		this.events++;
		return ended;
	}

	private reset(): void {
		this.attemptId = undefined;
		this.info = undefined;
		this.lastStep = 0;
		this.notedStepId = undefined;
		this.lessonsReported.clear();
		this.stuckPrompts.clear();
		this.events = 0;
		this.outro = undefined;
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

/** The funnels' step 1 `revision` field: `t<ONBOARDING_TUTORIAL_VERSION>r<TUTORIAL_FUNNEL_REVISION>`. */
export function tutorialFunnelRevision(): string {
	return `t${ONBOARDING_TUTORIAL_VERSION}r${TUTORIAL_FUNNEL_REVISION}`;
}

// Before the constant it builds (roblox-ts does not hoist a function called at module load).
function collectAttemptSteps(): ReadonlyArray<string> {
	const out = [TUTORIAL_FUNNEL_STARTED_NAME];
	for (const s of TUTORIAL_STEPS) out.push(s.id);
	out.push(TUTORIAL_FUNNEL_COMPLETED_NAME);
	return table.freeze(out);
}

/** The attempt funnel's step names in step order: `started`, the lesson ids, `completed`. */
export const TUTORIAL_ATTEMPT_FUNNEL_STEPS: ReadonlyArray<string> = collectAttemptSteps();

/** Attempt funnel step 1 `started`: field01 entry, field02 revision, field03 device. */
export function tutorialAttemptStartEvents(info: Readonly<TutorialStartInfo>): AnalyticsEventSpec[] {
	return [
		{
			kind: "funnel",
			funnel: TUTORIAL_FUNNEL,
			step: TUTORIAL_FUNNEL_STARTED_STEP,
			stepName: TUTORIAL_FUNNEL_STARTED_NAME,
			fields: { field01: info.entry, field02: tutorialFunnelRevision(), field03: info.device },
		},
	];
}

/** The attempt funnel event of an accepted lesson step (step + offset, named by the shared step list). */
export function tutorialStepEvent(step: number): AnalyticsEventSpec {
	return {
		kind: "funnel",
		funnel: TUTORIAL_FUNNEL,
		step: step + TUTORIAL_FUNNEL_LESSON_OFFSET,
		stepName: tutorialFunnelStepName(step),
	};
}

/**
 * What a finished attempt logs: `completed` as the final funnel step, or TutorialSkipped (value = the last lesson
 * step reached; field01 the current step id, field02 entry, field03 device).
 */
export function tutorialFinishEvents(
	outcome: TutorialOutcome,
	ended: Readonly<TutorialAttemptEnd>,
): AnalyticsEventSpec[] {
	if (outcome === "completed") {
		return [
			{
				kind: "funnel",
				funnel: TUTORIAL_FUNNEL,
				step: TUTORIAL_FUNNEL_COMPLETED_STEP,
				stepName: TUTORIAL_FUNNEL_COMPLETED_NAME,
			},
		];
	}
	return [
		{
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.skipped,
			value: ended.lastStep,
			fields: { field01: ended.stepId, field02: ended.entry, field03: ended.device },
		},
	];
}

/** Events one lesson report logs: TutorialLessonTime always, TutorialLessonHits when it took hits. */
export function tutorialLessonReportEventCount(r: Readonly<TutorialLessonReport>): number {
	return r.hits > 0 ? 2 : 1;
}

/**
 * An accepted lesson report: TutorialLessonTime (value seconds) and, when hits > 0, TutorialLessonHits (value hits);
 * field01 the lesson's step id, field02 entry, field03 device.
 */
export function tutorialLessonReportEvents(
	r: Readonly<TutorialLessonReport>,
	info: Readonly<TutorialStartInfo>,
): AnalyticsEventSpec[] {
	const fields = { field01: tutorialFunnelStepName(r.step), field02: info.entry, field03: info.device };
	const out: AnalyticsEventSpec[] = [
		{ kind: "custom", name: TUTORIAL_ANALYTICS_EVENT.lessonTime, value: r.seconds, fields },
	];
	if (r.hits > 0) out.push({ kind: "custom", name: TUTORIAL_ANALYTICS_EVENT.lessonHits, value: r.hits, fields });
	return out;
}

/** An accepted stuck report: TutorialStuck (value seconds; field01 prompt id, field02 entry, field03 device). */
export function tutorialStuckEvents(
	r: Readonly<TutorialStuckReport>,
	info: Readonly<TutorialStartInfo>,
): AnalyticsEventSpec[] {
	return [
		{
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.stuck,
			value: r.seconds,
			fields: { field01: r.prompt, field02: info.entry, field03: info.device },
		},
	];
}

/** An attempt open when the player left or a party run took over: TutorialAbandoned (value last step). */
export function tutorialAbandonedEvents(
	ended: Readonly<TutorialAttemptEnd>,
	kind: TutorialAbandonKind,
): AnalyticsEventSpec[] {
	return [
		{
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.abandoned,
			value: ended.lastStep,
			fields: { field01: ended.stepId, field02: ended.entry, field03: kind },
		},
	];
}

/** An attempt replaced by a `restart` start: TutorialRestarted (value last step; field01 its current step id). */
export function tutorialRestartedEvents(ended: Readonly<TutorialAttemptEnd>): AnalyticsEventSpec[] {
	return [
		{
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.restarted,
			value: ended.lastStep,
			fields: { field01: ended.stepId },
		},
	];
}

/** The outro closed: TutorialOutroChoice (value seconds on it; field01 the choice or `left`, field02 entry). */
export function tutorialOutroEvents(
	choice: TutorialOutroChoice | typeof TUTORIAL_OUTRO_LEFT,
	seconds: number,
	entry: TutorialEntry,
): AnalyticsEventSpec[] {
	return [
		{
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.outroChoice,
			value: seconds,
			fields: { field01: choice, field02: entry },
		},
	];
}
