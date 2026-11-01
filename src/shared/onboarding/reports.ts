/**
 * The tutorial telemetry's client reports (docs/TUTORIAL_FUNNEL.md §6): the payload types the remotes carry and the
 * readers the server runs on them. Every reader takes `unknown` (a remote payload is untrusted) and returns a clean
 * copy, or undefined when the payload is unusable: strings must come from the fixed sets below (prompt ids and step ids
 * from shared/tutorial), integers must be integers, numbers must be finite; numbers are clamped to TUTORIAL_TELEMETRY's
 * caps and seconds rounded to TUTORIAL_TELEMETRY.secondsStep. Pure, headlessly tested (funnelReports.spec.ts).
 */
import {
	TUTORIAL_DEVICES,
	TUTORIAL_PROMPT_IDS,
	TUTORIAL_STEPS,
	tutorialStepIndex,
	type TutorialDevice,
	type TutorialLessonReport,
	type TutorialStuckReport,
} from "shared/tutorial";
import { TUTORIAL_FUNNEL_MAX_STEP, TUTORIAL_TELEMETRY } from "./config";
import { isTutorialOutcome, type TutorialOutcome } from "./doc";

export type { TutorialDevice, TutorialLessonReport, TutorialStuckReport } from "shared/tutorial";
/** Every prompt id the director can show (shared/tutorial's list): TutorialStuck's field01 values. */
export { TUTORIAL_PROMPT_IDS } from "shared/tutorial";

/**
 * How an attempt began (the attempt funnel's step 1 field01):
 *   firstJoin  the first-join gate started it
 *   restart    "Restart tutorial" from the tutorial's pause menu
 *   menu       a replay from the main menu
 *   again      the outro's Play again
 */
export type TutorialEntry = "firstJoin" | "restart" | "menu" | "again";

export const TUTORIAL_ENTRIES: ReadonlyArray<TutorialEntry> = ["firstJoin", "restart", "menu", "again"];

/** `tutorialStarted`'s payload: the entry and the last-used input device at the start (TFD9). */
export interface TutorialStartInfo {
	entry: TutorialEntry;
	device: TutorialDevice;
}

/**
 * The start info the server assumes when a `tutorialStarted` carries none or a malformed one (an older client during a
 * rollout): a first join on keyboard, the most common case.
 */
export const DEFAULT_TUTORIAL_START_INFO: Readonly<TutorialStartInfo> = table.freeze({
	entry: "firstJoin" as TutorialEntry,
	device: "keyboard" as TutorialDevice,
});

/**
 * `tutorialFinished`'s payload: the outcome and the director's current step id (TutorialView.stepId), or
 * TUTORIAL_NO_STEP_ID when there is none (the director clears it once finished).
 */
export interface TutorialFinishInfo {
	outcome: TutorialOutcome;
	stepId: string;
}

/** The step id sentinel for "no current step" (every step done; never a TUTORIAL_STEPS id, checked by the spec). */
export const TUTORIAL_NO_STEP_ID = "none";

/** Why the first-join gate went where it went (OnboardingGate's field01). */
export type OnboardingGateReason = "tutorial" | "invited" | "party" | "done" | "loadFailed" | "timeout" | "forced";

export const ONBOARDING_GATE_REASONS: ReadonlyArray<OnboardingGateReason> = [
	"tutorial",
	"invited",
	"party",
	"done",
	"loadFailed",
	"timeout",
	"forced",
];

/** What the player picked on the tutorial's outro. */
export type TutorialOutroChoice = "firstRun" | "again" | "menu";

export const TUTORIAL_OUTRO_CHOICES: ReadonlyArray<TutorialOutroChoice> = ["firstRun", "again", "menu"];

/** TutorialOutroChoice's field01 when the player left the game on the outro (server-side). */
export const TUTORIAL_OUTRO_LEFT = "left";

/** `onboardingReport`'s payload. */
export type OnboardingReport =
	| { kind: "loaded" }
	| { kind: "gate"; reason: OnboardingGateReason }
	| { kind: "outro"; choice: TutorialOutroChoice; seconds: number };

/** How a fresh player arrived (the onboarding funnel's step 1 field01; from the server's `joinIntent`). */
export type OnboardingEntry = "organic" | "invited" | "party" | "unknown";

export const ONBOARDING_ENTRIES: ReadonlyArray<OnboardingEntry> = ["organic", "invited", "party", "unknown"];

/** Entries that bypass the tutorial (TFD3): the onboarding funnel logs `Joined` only for them. */
export const BYPASSED_ONBOARDING_ENTRIES: ReadonlyArray<OnboardingEntry> = ["invited", "party"];

/** Why an attempt was abandoned (TutorialAbandoned's field03): the player left the game, or a party run took over. */
export type TutorialAbandonKind = "leave" | "partyRun";

export const TUTORIAL_ABANDON_KINDS: ReadonlyArray<TutorialAbandonKind> = ["leave", "partyRun"];

// (Helpers come before the constants they build: roblox-ts does not hoist a function called at module load.)
function collectCurrentStepIds(): ReadonlyArray<string> {
	const out: string[] = [];
	for (const s of TUTORIAL_STEPS) out.push(s.id);
	out.push(TUTORIAL_NO_STEP_ID);
	return table.freeze(out);
}

/** Every value of a current-step field: the TUTORIAL_STEPS ids, then TUTORIAL_NO_STEP_ID. */
export const TUTORIAL_CURRENT_STEP_IDS: ReadonlyArray<string> = collectCurrentStepIds();

export function isTutorialPromptId(v: unknown): v is string {
	return typeIs(v, "string") && TUTORIAL_PROMPT_IDS.includes(v);
}

export function isTutorialEntry(v: unknown): v is TutorialEntry {
	return typeIs(v, "string") && TUTORIAL_ENTRIES.includes(v as TutorialEntry);
}

export function isTutorialDevice(v: unknown): v is TutorialDevice {
	return typeIs(v, "string") && TUTORIAL_DEVICES.includes(v as TutorialDevice);
}

export function isOnboardingGateReason(v: unknown): v is OnboardingGateReason {
	return typeIs(v, "string") && ONBOARDING_GATE_REASONS.includes(v as OnboardingGateReason);
}

export function isTutorialOutroChoice(v: unknown): v is TutorialOutroChoice {
	return typeIs(v, "string") && TUTORIAL_OUTRO_CHOICES.includes(v as TutorialOutroChoice);
}

export function isOnboardingEntry(v: unknown): v is OnboardingEntry {
	return typeIs(v, "string") && ONBOARDING_ENTRIES.includes(v as OnboardingEntry);
}

/** A TUTORIAL_STEPS id or TUTORIAL_NO_STEP_ID. */
export function isTutorialCurrentStepId(v: unknown): v is string {
	return typeIs(v, "string") && (v === TUTORIAL_NO_STEP_ID || tutorialStepIndex(v) >= 0);
}

function isFiniteNumber(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

function isInteger(v: unknown): v is number {
	return isFiniteNumber(v) && v % 1 === 0;
}

/** `seconds` clamped to 0..max and rounded to TUTORIAL_TELEMETRY.secondsStep; undefined when not finite. */
export function reportSeconds(seconds: unknown, max: number): number | undefined {
	if (!isFiniteNumber(seconds)) return undefined;
	// Steps per second (10): dividing the rounded count by an integer gives the double nearest to n / 10, where
	// multiplying by the step would give 0.30000000000000004.
	const perSecond = math.round(1 / TUTORIAL_TELEMETRY.secondsStep);
	return math.round(math.clamp(seconds, 0, max) * perSecond) / perSecond;
}

function asTable(v: unknown): Record<string, unknown> | undefined {
	return typeIs(v, "table") ? (v as Record<string, unknown>) : undefined;
}

/** `tutorialStarted`'s payload, or undefined (the server then assumes DEFAULT_TUTORIAL_START_INFO). */
export function readTutorialStartInfo(v: unknown): TutorialStartInfo | undefined {
	const t = asTable(v);
	if (t === undefined || !isTutorialEntry(t.entry) || !isTutorialDevice(t.device)) return undefined;
	return { entry: t.entry, device: t.device };
}

/** `tutorialLesson`'s payload: step an integer 1..max, hits a non-negative integer (clamped), seconds finite. */
export function readLessonReport(v: unknown): TutorialLessonReport | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const step = t.step;
	if (!isInteger(step) || step < 1 || step > TUTORIAL_FUNNEL_MAX_STEP) return undefined;
	const hits = t.hits;
	if (!isInteger(hits) || hits < 0) return undefined;
	const seconds = reportSeconds(t.seconds, TUTORIAL_TELEMETRY.maxLessonSeconds);
	if (seconds === undefined) return undefined;
	return { step, seconds, hits: math.min(hits, TUTORIAL_TELEMETRY.maxLessonHits) };
}

/** `tutorialStuck`'s payload: a known prompt id, seconds finite (clamped). */
export function readStuckReport(v: unknown): TutorialStuckReport | undefined {
	const t = asTable(v);
	if (t === undefined || !isTutorialPromptId(t.prompt)) return undefined;
	const seconds = reportSeconds(t.seconds, TUTORIAL_TELEMETRY.maxStuckSeconds);
	if (seconds === undefined) return undefined;
	return { prompt: t.prompt, seconds };
}

/** `tutorialFinished`'s payload: a known outcome and a current-step id (a TUTORIAL_STEPS id or TUTORIAL_NO_STEP_ID). */
export function readFinishInfo(v: unknown): TutorialFinishInfo | undefined {
	const t = asTable(v);
	if (t === undefined || !isTutorialOutcome(t.outcome) || !isTutorialCurrentStepId(t.stepId)) return undefined;
	return { outcome: t.outcome, stepId: t.stepId };
}

/** `onboardingReport`'s payload. */
export function readOnboardingReport(v: unknown): OnboardingReport | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	if (t.kind === "loaded") return { kind: "loaded" };
	if (t.kind === "gate") return isOnboardingGateReason(t.reason) ? { kind: "gate", reason: t.reason } : undefined;
	if (t.kind === "outro") {
		if (!isTutorialOutroChoice(t.choice)) return undefined;
		const seconds = reportSeconds(t.seconds, TUTORIAL_TELEMETRY.maxOutroSeconds);
		return seconds !== undefined ? { kind: "outro", choice: t.choice, seconds } : undefined;
	}
	return undefined;
}
