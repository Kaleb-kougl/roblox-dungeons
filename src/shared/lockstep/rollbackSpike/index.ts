/**
 * Barrel for the rollback measurement spike (docs/ROLLBACK_SPIKE.md), Roblox-API-free (headless specs and the
 * client's worker run it):
 *
 *   config.ts   ROLLBACK_SPIKE tunables (slices, windows, mirror hash period, digest sizes, horizons, the model's)
 *   clone.ts    cloneSimState: a generic deep copy of a live SimState (R1), SHARED_BY_REFERENCE, cloneStats
 *   pooledCopy.ts  PooledStateCopier: an exact copy INTO a reused scratch state (R1b), StateCopyFn, stateDifference
 *   digest.ts   the per-tick view digest (R2): BulletTracker (bullet identity keys), PreSnap, ViewDigest, fillDigest,
 *               BulletMatcher, roomTypeOf
 *   metrics.ts  RollbackMetrics (the 20 ROLLBACK_LIVE_METRICS per room type, error distributions), the report table
 *   model.ts    RollbackModel: one observing player's prediction model, fed frame by frame (R2 offline, R4b live)
 *   harness.ts  runModelOverRecording: a recorded party run replayed through a model at a fixed (L, D) (spec support)
 *
 * Spike only (RBD1): nothing here reaches the sim, a hash or a recording.
 */
export * from "./config";
export * from "./clone";
export * from "./pooledCopy";
export * from "./digest";
export * from "./metrics";
export * from "./model";
export * from "./harness";
