/** Onboarding (first-run tutorial) persistence and telemetry tunables (OnboardingService). Data only. */
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

/** Per-player budget for `requestOnboarding` and `tutorialStarted` together. */
export const ONBOARDING_REQUEST_RATE = table.freeze({ count: 10, windowSeconds: 10 });

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

/** AnalyticsService funnel name (Roblox allows 10 funnels per experience). */
export const TUTORIAL_FUNNEL = "tutorial";

/**
 * Highest lesson step the client may report (`tutorialStep(step)`, 1-based): the tutorial's step count
 * (shared/tutorial TUTORIAL_STEPS). The `completed` funnel step is logged as TUTORIAL_FUNNEL_MAX_STEP + 1, and Roblox
 * counts every step number below a logged one as reached.
 */
export const TUTORIAL_FUNNEL_MAX_STEP = TUTORIAL_STEP_COUNT;

/** The funnel step logged when the tutorial is completed (named "completed"). */
export const TUTORIAL_FUNNEL_COMPLETED_STEP = TUTORIAL_FUNNEL_MAX_STEP + 1;

/** Longest funnel step name (the shared/tutorial step ids are checked against it). */
export const MAX_TUTORIAL_STEP_NAME_CHARS = 32;

/** Custom event logged on a skip (value = the last lesson step reached in that attempt, 0 for none). */
export const TUTORIAL_SKIPPED_EVENT = "TutorialSkipped";

/**
 * Studio-only Workspace attribute: when true, a joining player's onboarding doc is reset to empty (and that empty
 * doc is saved like any change), so the tutorial is offered on every Studio join. Ignored on live servers.
 */
export const ONBOARDING_RESET_ATTRIBUTE = "KV_ResetOnboarding";
