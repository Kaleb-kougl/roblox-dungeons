/**
 * The new-player window (docs/TUTORIAL_FUNNEL.md §7, TFD8; the pure part of TF7): does finishing the tutorial make a
 * new player play ranked runs and come back? Server-derived: OnboardingService / RunSessionService /
 * RunValidationService call these with the player's onboarding doc and log the specs; each helper that changes the
 * window returns the doc to store (a copy, every other field kept).
 *
 *   firstDayPatch         a fresh join (doc never finished, no firstDay): set firstDay = today
 *   newPlayerRunStart     a ranked / daily session start in the window: NewPlayerRunStarted (value = run number)
 *   newPlayerRunAccepted  an accepted ranked run in the window: NewPlayerRun (value = run number) + newRuns + 1
 *   newPlayerReturn       the first join on a later UTC day within returnDays: NewPlayerReturned (value = days)
 *
 * The window: `firstDay` is set and fewer than NEW_PLAYER.runs runs were counted (`newRuns`). A player who joined
 * before `firstDay` existed has none and is never in it. Runs are COUNTED AT ACCEPTANCE (the run number of a start is
 * newRuns + 1): a start whose run never validates (left mid-run, rejected) does not use up a number, so the next start
 * repeats it; NewPlayerRunStarted over NewPlayerRun for the same number is the share of runs that never validated.
 *
 * Days are integer UTC day numbers (`math.floor(os.time() / SECONDS_PER_DAY)`) passed in by the caller: pure code never
 * reads the clock. Every field value comes from a fixed set (analyticsCatalog.ts).
 *
 * @module
 */
import type { AnalyticsEventSpec, RunEndReason } from "shared/run";
import { dailyFloorBucket } from "shared/run";
import { NEW_PLAYER, TUTORIAL_ANALYTICS_EVENT } from "./config";
import { isNewPlayerFirstDay, withNewPlayerFields, type OnboardingDoc, type TutorialOutcome } from "./doc";

/** The tutorial outcome field of the new-player events: the doc's outcome, or `none` before any finish. */
export type NewPlayerTutorialOutcome = TutorialOutcome | "none";

export const NEW_PLAYER_TUTORIAL_OUTCOMES: ReadonlyArray<NewPlayerTutorialOutcome> = ["completed", "skipped", "none"];

/** Every run end NewPlayerRun's field02 can carry (shared/run RunEndReason). */
export const NEW_PLAYER_RUN_ENDS: ReadonlyArray<RunEndReason> = ["death", "abandoned", "victory"];

/** What an accepted run tells the window (from the server's replay). */
export interface NewPlayerRunFacts {
	readonly endReason: RunEndReason;
	/** The deepest floor reached (bucketed like the Daily's, shared/run dailyFloorBucket). */
	readonly floor: number;
}

/** A window change: the events to log and the doc to store. */
export interface NewPlayerUpdate {
	readonly events: AnalyticsEventSpec[];
	readonly doc: OnboardingDoc;
}

/** `completed` / `skipped` once a tutorial was finished (any version), else `none`. */
export function newPlayerTutorialOutcome(doc: Readonly<OnboardingDoc>): NewPlayerTutorialOutcome {
	return doc.tutorialVersion > 0 ? doc.outcome : "none";
}

/** Runs counted in the window so far (0 when absent). */
export function newPlayerRunsCounted(doc: Readonly<OnboardingDoc>): number {
	return doc.newRuns ?? 0;
}

/** In the window: firstDay set and fewer than NEW_PLAYER.runs runs counted. */
export function isInNewPlayerWindow(doc: Readonly<OnboardingDoc>): boolean {
	return doc.firstDay !== undefined && newPlayerRunsCounted(doc) < NEW_PLAYER.runs;
}

/**
 * A fresh join (the doc loaded, never finished a tutorial, no firstDay yet): the doc with firstDay = `today`; else
 * undefined (nothing to store). Call it only after a successful load.
 */
export function firstDayPatch(doc: Readonly<OnboardingDoc>, today: number): OnboardingDoc | undefined {
	if (doc.tutorialVersion !== 0 || doc.firstDay !== undefined || !isNewPlayerFirstDay(today)) return undefined;
	return withNewPlayerFields(doc, { firstDay: today });
}

/** A ranked session start: NewPlayerRunStarted (value = the run number, newRuns + 1; field01 outcome) in the window. */
export function newPlayerRunStart(doc: Readonly<OnboardingDoc>): AnalyticsEventSpec[] {
	if (!isInNewPlayerWindow(doc)) return [];
	return [
		{
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.newPlayerRunStarted,
			value: newPlayerRunsCounted(doc) + 1,
			fields: { field01: newPlayerTutorialOutcome(doc) },
		},
	];
}

/**
 * An accepted ranked run: in the window, NewPlayerRun (value = the run number; field01 outcome, field02 the run end,
 * field03 the floor bucket) and the doc with newRuns + 1; else undefined.
 */
export function newPlayerRunAccepted(
	doc: Readonly<OnboardingDoc>,
	facts: Readonly<NewPlayerRunFacts>,
): NewPlayerUpdate | undefined {
	if (!isInNewPlayerWindow(doc)) return undefined;
	const run = newPlayerRunsCounted(doc) + 1;
	return {
		events: [
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.newPlayerRun,
				value: run,
				fields: {
					field01: newPlayerTutorialOutcome(doc),
					field02: facts.endReason,
					field03: dailyFloorBucket(facts.floor),
				},
			},
		],
		doc: withNewPlayerFields(doc, { newRuns: run }),
	};
}

/**
 * A join on UTC day `today`: when firstDay is set, NewPlayerReturned was never logged, and `today` is 1..returnDays
 * days after firstDay, NewPlayerReturned (value = whole days; field01 outcome) and the doc with returned = true; else
 * undefined (the same day, past the window, or already logged).
 */
export function newPlayerReturn(doc: Readonly<OnboardingDoc>, today: number): NewPlayerUpdate | undefined {
	const first = doc.firstDay;
	if (first === undefined || doc.returned === true || !isNewPlayerFirstDay(today)) return undefined;
	const days = today - first;
	if (days < 1 || days > NEW_PLAYER.returnDays) return undefined;
	return {
		events: [
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.newPlayerReturned,
				value: days,
				fields: { field01: newPlayerTutorialOutcome(doc) },
			},
		],
		doc: withNewPlayerFields(doc, { returned: true }),
	};
}
