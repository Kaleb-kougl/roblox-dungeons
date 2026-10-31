/**
 * Barrel for onboarding (the first-run tutorial's server side, docs/TUTORIAL.md §5-6): the stored "has played the
 * tutorial" document and its PlayerDocCache codec, the status the client gets, the tutorial funnel filter and its
 * analytics specs, the first-sighting ids (docs/ENEMY_VARIANTS.md EV12), and their tunables. Plain TypeScript, headlessly tested; OnboardingService wraps it.
 */
export * from "./config";
export * from "./doc";
export * from "./funnel";
export * from "./sightings";
