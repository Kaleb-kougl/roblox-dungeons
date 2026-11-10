/**
 * Barrel for the rollback probe's worker side (docs/ROLLBACK_SPIKE.md Design 5 / 7, tasks R3a / R3 / R4b),
 * Roblox-API-free so the headless specs drive it as the client does:
 *
 *   stats.ts     WindowSamples (p50 / p95 / max over a window)
 *   device.ts    rollbackDeviceClass / rollbackDeviceLabel (what the game knows of the device), rollbackProbeCase
 *   protocol.ts  the main <-> worker messages (setup, frames, control; cpu, live, mirrorHash, status, digest, error),
 *                their validators and the input packing
 *   setup.ts     buildRollbackMirror: the mirror run built from a setup exactly as the main client builds its run
 *   core.ts      RollbackWorkerCore: the mirror, the CPU probe, the live model, the windows (the host injects the rest)
 *   feed.ts      RollbackFeed: the main thread's frames messages and the mirror hash check
 *   sources.ts   RollbackFrameSource adapters over a LockstepClient and a solo LiveRun
 *   facts.ts     R3a's pure pieces (the facts run, the message probes, the frame-time line)
 */
export * from "./stats";
export * from "./device";
export * from "./protocol";
export * from "./setup";
export * from "./core";
export * from "./feed";
export * from "./sources";
export * from "./facts";
