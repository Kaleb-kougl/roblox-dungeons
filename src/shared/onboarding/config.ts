/**
 * Onboarding (first-run tutorial) persistence and telemetry tunables (OnboardingService; the telemetry plan is
 * docs/TUTORIAL_FUNNEL.md). Data only.
 */
import { SETTINGS_AUTOSAVE_SECONDS, SETTINGS_RETRY, type RetryPolicy } from "shared/settings";
import { TUTORIAL_STEP_COUNT } from "shared/tutorial";

/**
 * The tutorial's version. A player whose stored `tutorialVersion` is below it has not done the current tutorial
 * (`isTutorialDone`). Bump it after a major rewrite to offer the tutorial again (it is offered, not forced).
 */
export const ONBOARDING_TUTORIAL_VERSION = 1;

/**
 * Bump when the stored document's shape changes incompatibly (old documents then read as empty, which sends every
 * existing player through the first-run tutorial again). An optional field needs no bump: the first sightings' `seen`
 * (docs/ENEMY_VARIANTS.md EV12, plan change 9) is one, under version 1.
 */
export const ONBOARDING_DOC_VERSION = 1;

/** DataStore holding one OnboardingDoc per player, keyed by shared/settings `playerDataKey(userId)`. */
export const ONBOARDING_DATASTORE_NAME = "KV_Onboarding_v1";

/** DataStore calls: the settings policy (3 tries, waiting 1 s then 2 s). */
export const ONBOARDING_RETRY: RetryPolicy = SETTINGS_RETRY;

/** Dirty onboarding docs are also written every this many seconds (besides leave / shutdown). */
export const ONBOARDING_AUTOSAVE_SECONDS = SETTINGS_AUTOSAVE_SECONDS;

/** Per-player budget for `requestOnboarding`. */
export const ONBOARDING_REQUEST_RATE = table.freeze({ count: 10, windowSeconds: 10 });

/**
 * Per-player budget for `tutorialStarted` (an honest client sends one per tutorial run; a restart passes the stage
 * loader's cover first). Over it the start still opens an attempt, UNLOGGED (TutorialFunnelTracker `silent`), so the
 * player is still busy for lobbies while their client plays the tutorial.
 */
export const TUTORIAL_START_RATE = table.freeze({ count: 3, windowSeconds: 10 });

/**
 * Per-player budget for `tutorialFinished`, its own so request / start traffic can never starve the one message that
 * records the tutorial as done (an honest client sends one per tutorial attempt). Over it, the finish is not recorded
 * but the attempt still closes (the player is no longer in the tutorial).
 */
export const TUTORIAL_FINISH_RATE = table.freeze({ count: 10, windowSeconds: 10 });

/**
 * Per-player budget for `tutorialStep`. Lessons can finish together (several in one frame, out of order), so it is
 * looser than the request budget; the funnel filter drops repeats anyway.
 */
export const TUTORIAL_STEP_RATE = table.freeze({ count: 30, windowSeconds: 10 });

/**
 * The attempt funnel's AnalyticsService name (docs/TUTORIAL_FUNNEL.md §3, TFD5: replaces the old `tutorial` funnel,
 * which stops logging). A recurring funnel: every attempt (first join, Restart tutorial, a menu replay, Play again) is
 * one funnel session (a server GUID). Roblox allows 10 funnels per experience (analyticsCatalog.ts checks it).
 */
export const TUTORIAL_FUNNEL = "TutorialAttempt";

/**
 * Highest lesson step the client may report (`tutorialStep(step)`, 1-based): the tutorial's step count
 * (shared/tutorial TUTORIAL_STEPS). Lesson n is attempt funnel step n + TUTORIAL_FUNNEL_LESSON_OFFSET (after step 1
 * `started`); Roblox counts every step number below a logged one as reached.
 */
export const TUTORIAL_FUNNEL_MAX_STEP = TUTORIAL_STEP_COUNT;

/** Attempt funnel step 1: the attempt began (`tutorialStarted`). Its custom fields carry entry / revision / device. */
export const TUTORIAL_FUNNEL_STARTED_STEP = 1;
/** Attempt funnel step 1's name. */
export const TUTORIAL_FUNNEL_STARTED_NAME = "started";

/** Lesson n is attempt funnel step n + this (step 1 is `started`). */
export const TUTORIAL_FUNNEL_LESSON_OFFSET = TUTORIAL_FUNNEL_STARTED_STEP;

/**
 * The attempt funnel step logged when the tutorial is completed (named TUTORIAL_FUNNEL_COMPLETED_NAME): right after
 * the last lesson's step, so TUTORIAL_FUNNEL_MAX_STEP + 2 (19 with 17 lessons).
 */
export const TUTORIAL_FUNNEL_COMPLETED_STEP = TUTORIAL_FUNNEL_MAX_STEP + TUTORIAL_FUNNEL_LESSON_OFFSET + 1;
/** The attempt funnel's `completed` step name. */
export const TUTORIAL_FUNNEL_COMPLETED_NAME = "completed";

/** Longest funnel step name (the shared/tutorial step ids and every onboarding / attempt step name are checked). */
export const MAX_TUTORIAL_STEP_NAME_CHARS = 32;

/**
 * Bump whenever lesson steps are added, removed or reordered (docs/TUTORIAL_FUNNEL.md §2): the funnels' step 1
 * `revision` field (tutorialFunnelRevision: `t<ONBOARDING_TUTORIAL_VERSION>r<this>`) then splits the charts instead of
 * dates. Never rename a shipped step id. 1: the 16-lesson tutorial; 2: the `map` lesson (step 11, 17 lessons;
 * 2026-11-01, docs/TUTORIAL_MAP.md).
 */
export const TUTORIAL_FUNNEL_REVISION = 2;

/**
 * The once-per-user onboarding funnel (`LogOnboardingFunnelStepEvent`, docs/TUTORIAL_FUNNEL.md §2): fixed step numbers
 * and names. Lesson n is step n + `lessonOffset` (named by its TUTORIAL_STEPS id); `completed` follows the last lesson
 * (TUTORIAL_STEP_COUNT + 4: 21 with 17 lessons). The whole ordered list is funnel.ts ONBOARDING_FUNNEL_STEPS.
 */
export const ONBOARDING_FUNNEL = table.freeze({
	joined: table.freeze({ step: 1, name: "Joined" }),
	loaded: table.freeze({ step: 2, name: "Loaded" }),
	tutorialStarted: table.freeze({ step: 3, name: "TutorialStarted" }),
	/** Lesson n -> onboarding step n + 3. */
	lessonOffset: 3,
	completed: table.freeze({ step: TUTORIAL_STEP_COUNT + 4, name: "Completed" }),
	/** Step 1's field03: the experiment arm, reserved (docs/TUTORIAL_FUNNEL.md "Out of scope"); this until one exists. */
	noExperimentArm: "none",
});

/** Tutorial telemetry bounds (docs/TUTORIAL_FUNNEL.md §4, §6). Client reports are clamped to them (reports.ts). */
export const TUTORIAL_TELEMETRY = table.freeze({
	/** TutorialLessonTime's value is clamped to 0..this (TFD10). */
	maxLessonSeconds: 900,
	/** TutorialLessonHits' value is clamped to 0..this. */
	maxLessonHits: 500,
	/** TutorialStuck's value is clamped to 0..this. */
	maxStuckSeconds: 900,
	/** At most this many TutorialStuck reports per attempt (each prompt once). */
	maxStuckReportsPerAttempt: 6,
	/** TutorialOutroChoice's value (seconds on the outro) is clamped to 0..this. */
	maxOutroSeconds: 3600,
	/**
	 * Events one attempt may log (TutorialFunnelTracker's counter). The computed worst case of a FIRST attempt (the
	 * attempt's own events plus the onboarding funnel and the gate: analyticsCatalog.ts firstAttemptEventBound, 82 with 17 lessons)
	 * fits, so the counter never bites an honest client; it bounds a misbehaving one.
	 */
	maxEventsPerAttempt: 84,
	/**
	 * Of maxEventsPerAttempt, kept for the attempt's exit (completed / skipped / abandoned / restarted) and its outro:
	 * lesson steps and lesson / stuck reports never use these.
	 */
	exitEventReserve: 2,
	/**
	 * Per player per server session: only the first this many tutorial attempts are logged (the attempt funnel and its
	 * custom events). Later attempts still open and close (busy for lobbies) but log nothing, so a client looping
	 * Restart cannot drain the game-wide AnalyticsService budget (120 + 20 x CCU events per minute). The once-per-user
	 * onboarding funnel (bounded by its own once-each rule) is not affected.
	 */
	maxAttemptsLoggedPerSession: 3,
	/**
	 * Per player per server session: attempt events of every attempt together (starts, steps, reports, exits, outros)
	 * stay within this, exitEventReserve kept for a logged attempt's exit and outro. 3 x maxEventsPerAttempt: a backstop
	 * to the attempt cap.
	 */
	maxEventsPerSession: 252,
	/** Report seconds are rounded to a multiple of this (0.1 s). */
	secondsStep: 0.1,
});

/** The new-player window (docs/TUTORIAL_FUNNEL.md §7, TFD8): the first `runs` ranked runs; a return within `returnDays`. */
export const NEW_PLAYER = table.freeze({ runs: 3, returnDays: 7 });

/** Seconds per UTC day: callers pass `today = math.floor(os.time() / SECONDS_PER_DAY)` (pure code never reads clocks). */
export const SECONDS_PER_DAY = 86400;

/**
 * Per-player budget shared by the tutorial's reports (`tutorialLesson`, `tutorialStuck`, `onboardingReport`), apart
 * from the finish budget (TUTORIAL_FINISH_RATE).
 */
export const TUTORIAL_REPORT_RATE = table.freeze({ count: 40, windowSeconds: 10 });

/** Custom event logged on a skip (value = the last lesson step reached in that attempt, 0 for none). */
export const TUTORIAL_SKIPPED_EVENT = "TutorialSkipped";

/** Every tutorial / onboarding custom event name (docs/TUTORIAL_FUNNEL.md §4; analyticsCatalog.ts lists their fields). */
export const TUTORIAL_ANALYTICS_EVENT = table.freeze({
	lessonTime: "TutorialLessonTime",
	lessonHits: "TutorialLessonHits",
	stuck: "TutorialStuck",
	skipped: TUTORIAL_SKIPPED_EVENT,
	abandoned: "TutorialAbandoned",
	restarted: "TutorialRestarted",
	outroChoice: "TutorialOutroChoice",
	onboardingGate: "OnboardingGate",
	newPlayerRun: "NewPlayerRun",
	newPlayerRunStarted: "NewPlayerRunStarted",
	newPlayerReturned: "NewPlayerReturned",
});

/**
 * Studio-only Workspace attribute: when true, a joining player's onboarding doc is reset to empty (and that empty
 * doc is saved like any change), so the tutorial is offered on every Studio join. Ignored on live servers.
 */
export const ONBOARDING_RESET_ATTRIBUTE = "KV_ResetOnboarding";
