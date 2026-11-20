/**
 * Barrel for onboarding (the first-run tutorial's server side, docs/TUTORIAL.md §5-6): the stored "has played the
 * tutorial" document and its PlayerDocCache codec, the status the client gets, the first-sighting ids
 * (docs/ENEMY_VARIANTS.md EV12), and their tunables. Tutorial telemetry (docs/TUTORIAL_FUNNEL.md): the client report
 * payloads and their readers (reports.ts), the attempt funnel tracker and its event specs (funnel.ts), the
 * once-per-user onboarding funnel tracker (onboardingFunnel.ts), the new-player window (newPlayer.ts), the game's
 * analytics catalog (analyticsCatalog.ts), the per-player orchestration OnboardingService feeds (playerTelemetry.ts)
 * and the KV_AnalyticsDebug echo's formatting (analyticsDebug.ts). Plain TypeScript, headlessly tested; OnboardingService wraps it.
 *
 * @module
 */
export * from "./config";
export * from "./doc";
export * from "./reports";
export * from "./funnel";
export * from "./onboardingFunnel";
export * from "./newPlayer";
export * from "./analyticsCatalog";
export * from "./playerTelemetry";
export * from "./analyticsDebug";
export * from "./sightings";
