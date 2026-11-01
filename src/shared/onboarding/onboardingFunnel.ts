/**
 * The once-per-user ONBOARDING funnel (docs/TUTORIAL_FUNNEL.md §2, TFD1-TFD3; `LogOnboardingFunnelStepEvent`) and the
 * first-join gate event. Pure; OnboardingService keeps one OnboardingFunnelTracker per player per server session and
 * TelemetryService logs the specs.
 *
 * Steps: 1 `Joined`, 2 `Loaded`, 3 `TutorialStarted`, lesson n as n + 3 (named by its TUTORIAL_STEPS id), then
 * `Completed` (ONBOARDING_FUNNEL). Rules:
 *   - OPEN only for a fresh player: the doc loaded and empty (tutorialVersion 0, never finished: TFD2). A failed load
 *     logs nothing (we do not know whether they are new); a done player logs nothing.
 *   - `Joined` once the server knows the entry (`entryKnown`, from the server's joinIntent), or `unknown` when the
 *     player leaves first (`leaving`). Its fields: field01 entry, field02 revision, field03 the experiment arm (`none`).
 *     Join and entry may come in either order: Joined logs when both are in.
 *   - Bypassed players (entry invited / party, TFD3) log `Joined` only: nothing after it, ever, this session.
 *   - Steps 2+ log only after `Joined` (a step that comes first waits and logs right after it, in order), strictly
 *     increasing (a repeat or a lower step is dropped; Roblox counts a repeated step once anyway), and only while open.
 *     `TutorialStarted` only for a `firstJoin` start (a menu replay never touches this funnel).
 *   - `completed` logs `Completed` and closes; `skipped` closes with nothing. A leave closes this session's tracker;
 *     the next join (still fresh) keeps filling the same once-per-user funnel.
 *   - The OnboardingGate custom event logs once per session, for any player (also after a failed load: reason
 *     `loadFailed`), independent of the funnel.
 */
import type { AnalyticsEventSpec, AnalyticsFields } from "shared/run";
import { TUTORIAL_STEPS } from "shared/tutorial";
import { ONBOARDING_FUNNEL, TUTORIAL_ANALYTICS_EVENT, TUTORIAL_FUNNEL_MAX_STEP } from "./config";
import { isTutorialStepNumber, tutorialFunnelRevision, tutorialFunnelStepName } from "./funnel";
import {
	BYPASSED_ONBOARDING_ENTRIES,
	isOnboardingEntry,
	type OnboardingEntry,
	type OnboardingGateReason,
	type TutorialEntry,
} from "./reports";

// Before the constant it builds (roblox-ts does not hoist a function called at module load).
function collectOnboardingSteps(): ReadonlyArray<string> {
	const out = [ONBOARDING_FUNNEL.joined.name, ONBOARDING_FUNNEL.loaded.name, ONBOARDING_FUNNEL.tutorialStarted.name];
	for (const s of TUTORIAL_STEPS) out.push(s.id);
	out.push(ONBOARDING_FUNNEL.completed.name);
	return table.freeze(out);
}

/** The onboarding funnel's step names in step order (index + 1 = step number). */
export const ONBOARDING_FUNNEL_STEPS: ReadonlyArray<string> = collectOnboardingSteps();

/** The onboarding funnel step of lesson `n` (n + 3). */
export function onboardingLessonStep(n: number): number {
	return n + ONBOARDING_FUNNEL.lessonOffset;
}

/** The onboarding funnel step event `step` (named from ONBOARDING_FUNNEL_STEPS). */
export function onboardingStepEvent(step: number, fields?: AnalyticsFields): AnalyticsEventSpec {
	const stepName = ONBOARDING_FUNNEL_STEPS[step - 1] ?? tutorialFunnelStepName(step - ONBOARDING_FUNNEL.lessonOffset);
	return fields !== undefined
		? { kind: "onboarding", step, stepName, fields }
		: { kind: "onboarding", step, stepName };
}

/** Step 1 `Joined`: field01 entry, field02 revision, field03 the experiment arm. */
export function onboardingJoinedEvent(entry: OnboardingEntry): AnalyticsEventSpec {
	return onboardingStepEvent(ONBOARDING_FUNNEL.joined.step, {
		field01: entry,
		field02: tutorialFunnelRevision(),
		field03: ONBOARDING_FUNNEL.noExperimentArm,
	});
}

/** The first-join gate's choice: OnboardingGate (value 1, field01 reason). */
export function onboardingGateEvents(reason: OnboardingGateReason): AnalyticsEventSpec[] {
	return [{ kind: "custom", name: TUTORIAL_ANALYTICS_EVENT.onboardingGate, value: 1, fields: { field01: reason } }];
}

/** What OnboardingService knows at the join load. */
export interface OnboardingJoinFacts {
	/** The doc load succeeded. */
	readonly loaded: boolean;
	/** The loaded doc is empty: tutorialVersion 0 (never finished a tutorial). */
	readonly fresh: boolean;
}

export class OnboardingFunnelTracker {
	/** undefined until `join`; then whether this session logs the funnel at all. */
	private open: boolean | undefined;
	private entry: OnboardingEntry | undefined;
	private joinedLogged = false;
	private bypassed = false;
	/** The tutorial finished (completed or skipped): no new steps. */
	private ended = false;
	/** The player left: nothing more at all this session. */
	private closed = false;
	private lastStep = 0;
	/** Steps that came before Joined, ascending (logged right after it). */
	private readonly pending: number[] = [];
	private gateLogged = false;

	/** The join load ended: opens the funnel for a fresh player. Returns Joined when the entry is already known. */
	join(facts: OnboardingJoinFacts): AnalyticsEventSpec[] {
		if (this.open !== undefined || this.closed) return [];
		this.open = facts.loaded && facts.fresh;
		if (!this.open) this.pending.clear();
		return this.flushJoined();
	}

	/** The server resolved the player's entry: Joined (once, when open), then any step that waited for it. */
	entryKnown(entry: OnboardingEntry): AnalyticsEventSpec[] {
		if (this.entry !== undefined || this.closed || !isOnboardingEntry(entry)) return [];
		this.entry = entry;
		return this.flushJoined();
	}

	/**
	 * The player is leaving: Joined with `unknown` when it is open and the entry never came (then any waiting steps);
	 * closes this session's tracker either way.
	 */
	leaving(): AnalyticsEventSpec[] {
		let out: AnalyticsEventSpec[] = [];
		if (this.entry === undefined && !this.closed) {
			this.entry = "unknown";
			out = this.flushJoined();
		}
		this.closed = true;
		this.pending.clear();
		return out;
	}

	/** The join loading screen released (the client's `loaded` report): step 2. */
	loaded(): AnalyticsEventSpec[] {
		return this.step(ONBOARDING_FUNNEL.loaded.step);
	}

	/** A tutorial attempt started: step 3, only for a `firstJoin` entry. */
	tutorialStarted(entry: TutorialEntry): AnalyticsEventSpec[] {
		return entry === "firstJoin" ? this.step(ONBOARDING_FUNNEL.tutorialStarted.step) : [];
	}

	/** Lesson `n` (1..TUTORIAL_FUNNEL_MAX_STEP) reached (an attempt-accepted step): step n + 3. */
	lesson(n: number): AnalyticsEventSpec[] {
		if (!isTutorialStepNumber(n, TUTORIAL_FUNNEL_MAX_STEP)) return [];
		return this.step(onboardingLessonStep(n));
	}

	/** The tutorial was completed: `Completed`, then the funnel closes for good. */
	completed(): AnalyticsEventSpec[] {
		const out = this.step(ONBOARDING_FUNNEL.completed.step);
		this.closeFunnel();
		return out;
	}

	/** The tutorial was skipped: the funnel closes with nothing logged. */
	skipped(): void {
		this.closeFunnel();
	}

	/** The gate report: OnboardingGate once per session (for any player). */
	gate(reason: OnboardingGateReason): AnalyticsEventSpec[] {
		if (this.gateLogged) return [];
		this.gateLogged = true;
		return onboardingGateEvents(reason);
	}

	/** True while steps can still be logged this session (open, not bypassed, not closed). */
	isOpen(): boolean {
		return this.open === true && !this.bypassed && !this.closed && !this.ended;
	}

	/** The highest onboarding step logged this session (0 = none). */
	getLastStep(): number {
		return this.lastStep;
	}

	/**
	 * Takes no more steps. Joined and the steps already waiting for it still log when the entry comes: they happened
	 * before the finish.
	 */
	private closeFunnel(): void {
		this.ended = true;
	}

	/** Logs or queues step `s` (> 1): after Joined, strictly increasing, while open. */
	private step(s: number): AnalyticsEventSpec[] {
		if (this.closed || this.ended || this.bypassed || this.open === false) return [];
		if (!this.joinedLogged) {
			const last = this.pending.size() > 0 ? this.pending[this.pending.size() - 1] : 0;
			if (s > last) this.pending.push(s);
			return [];
		}
		if (s <= this.lastStep) return [];
		this.lastStep = s;
		return [onboardingStepEvent(s)];
	}

	/** Joined (and the waiting steps) once both the open join and the entry are in. */
	private flushJoined(): AnalyticsEventSpec[] {
		if (this.joinedLogged || this.open !== true || this.entry === undefined) return [];
		this.joinedLogged = true;
		this.lastStep = ONBOARDING_FUNNEL.joined.step;
		const out: AnalyticsEventSpec[] = [onboardingJoinedEvent(this.entry)];
		this.bypassed = BYPASSED_ONBOARDING_ENTRIES.includes(this.entry);
		const waiting = [...this.pending];
		this.pending.clear();
		if (this.bypassed) return out;
		for (const s of waiting) {
			if (s <= this.lastStep) continue;
			this.lastStep = s;
			out.push(onboardingStepEvent(s));
		}
		return out;
	}
}
