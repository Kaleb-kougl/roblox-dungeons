/**
 * The stored onboarding document (one DataStore value per player, OnboardingService) and the status the client
 * gets. Pure: decoding never throws, so a garbage or old-shaped value reads as "never played".
 */
import type { DocCodec } from "shared/settings";
import { ONBOARDING_DOC_VERSION, ONBOARDING_TUTORIAL_VERSION } from "./config";

export type TutorialOutcome = "completed" | "skipped";

export const TUTORIAL_OUTCOMES: ReadonlyArray<TutorialOutcome> = ["completed", "skipped"];

export interface OnboardingDoc {
	/** The ONBOARDING_TUTORIAL_VERSION the player last finished; 0 = never finished one. */
	tutorialVersion: number;
	/** How they finished it. Meaningless while tutorialVersion is 0 (the empty doc says "skipped"). */
	outcome: TutorialOutcome;
	/** os.time() of the finish (0 in the empty doc). */
	at: number;
}

/** What the server tells the client (`onboardingStatus`). */
export interface OnboardingStatus {
	/** False when the join load failed: the stored state is unknown, so the client must not force the tutorial. */
	loaded: boolean;
	/** isTutorialDone of this session's document (false after a failed load, until the player finishes it). */
	tutorialDone: boolean;
}

/** The value as written to the DataStore. */
export interface StoredOnboardingDoc {
	v: number;
	tutorialVersion: number;
	outcome: TutorialOutcome;
	at: number;
}

export function emptyOnboardingDoc(): OnboardingDoc {
	return { tutorialVersion: 0, outcome: "skipped", at: 0 };
}

/** The document written when a player finishes the current tutorial at `at` (os.time()). */
export function finishedOnboardingDoc(outcome: TutorialOutcome, at: number): OnboardingDoc {
	return { tutorialVersion: ONBOARDING_TUTORIAL_VERSION, outcome, at };
}

/** True when the player finished (completed or skipped) the current tutorial version or a later one. */
export function isTutorialDone(doc: Readonly<OnboardingDoc>): boolean {
	return doc.tutorialVersion >= ONBOARDING_TUTORIAL_VERSION;
}

export function isTutorialOutcome(v: unknown): v is TutorialOutcome {
	return typeIs(v, "string") && TUTORIAL_OUTCOMES.includes(v as TutorialOutcome);
}

function isFiniteNumber(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

function isNonNegativeInteger(v: unknown): v is number {
	return isFiniteNumber(v) && v >= 0 && v % 1 === 0;
}

export function encodeOnboardingDoc(doc: Readonly<OnboardingDoc>): StoredOnboardingDoc {
	return { v: ONBOARDING_DOC_VERSION, tutorialVersion: doc.tutorialVersion, outcome: doc.outcome, at: doc.at };
}

/**
 * A stored value -> document. Missing, another doc version, a non-table, a bad tutorialVersion or outcome: the empty
 * doc (the player is offered the tutorial again, which is the safe direction). A bad `at` alone reads as 0, so a
 * finished player is not sent back through the tutorial over a timestamp.
 */
export function decodeOnboardingDoc(raw: unknown): OnboardingDoc {
	if (!typeIs(raw, "table")) return emptyOnboardingDoc();
	const doc = raw as { v?: unknown; tutorialVersion?: unknown; outcome?: unknown; at?: unknown };
	if (doc.v !== ONBOARDING_DOC_VERSION) return emptyOnboardingDoc();
	if (!isNonNegativeInteger(doc.tutorialVersion) || !isTutorialOutcome(doc.outcome)) return emptyOnboardingDoc();
	const at = isFiniteNumber(doc.at) && doc.at >= 0 ? doc.at : 0;
	return { tutorialVersion: doc.tutorialVersion, outcome: doc.outcome, at };
}

export function sameOnboardingDoc(a: Readonly<OnboardingDoc>, b: Readonly<OnboardingDoc>): boolean {
	return a.tutorialVersion === b.tutorialVersion && a.outcome === b.outcome && a.at === b.at;
}

/** The status for a session's document (`loaded` = the join load succeeded). */
export function onboardingStatusOf(doc: Readonly<OnboardingDoc> | undefined, loaded: boolean): OnboardingStatus {
	return { loaded, tutorialDone: doc !== undefined && isTutorialDone(doc) };
}

/** PlayerDocCache codec (shared/settings store.ts). */
export const ONBOARDING_CODEC: DocCodec<OnboardingDoc> = {
	decode(raw) {
		return decodeOnboardingDoc(raw);
	},
	encode(doc) {
		return encodeOnboardingDoc(doc);
	},
	equals(a, b) {
		return sameOnboardingDoc(a, b);
	},
	empty() {
		return emptyOnboardingDoc();
	},
};
