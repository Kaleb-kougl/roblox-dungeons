/**
 * Barrel for run setup and server-side run validation (PLAN.md task 9): the run's SimConfig from its seed, validation
 * of a submitted recording by replay, telemetry derived from the replay, and its AnalyticsService mapping.
 *
 * M3 / M5 add segmented validation: the world registry (worlds.ts), server run sessions with server-picked seeds
 * (runSessions.ts), the segment protocol and SegmentedValidator (segments.ts) and the injectable score reader
 * (score.ts). M4 co-op: a party run starts only with consent (`partyConsent`): the
 * members of a lobby whose host pressed Start (shared/lobby).
 *
 * Plain TypeScript, no Roblox APIs (headlessly tested); the Flamework services in src/server/services wrap it.
 * docs/SERVER.md describes the flow.
 */
export * from "./limits";
export * from "./config";
export * from "./endless";
export * from "./replay";
export * from "./telemetry";
export * from "./session";
export * from "./validate";
export * from "./analytics";
export * from "./dailyAnalytics";
export * from "./recapAnalytics";
export * from "./rateLimit";
export * from "./queue";
export * from "./worlds";
export * from "./score";
export * from "./segments";
export * from "./runSessions";
export * from "./tutorialLayout";
export * from "./tutorial";
export * from "./dev";
