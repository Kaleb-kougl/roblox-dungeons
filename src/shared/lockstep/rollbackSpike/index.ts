/**
 * Barrel for the rollback measurement spike (docs/ROLLBACK_SPIKE.md), Roblox-API-free (headless specs and the
 * client's worker run it):
 *
 *   config.ts  ROLLBACK_SPIKE tunables (slices, windows, mirror hash period, digest sizes, horizons)
 *   clone.ts   cloneSimState: a generic deep copy of a live SimState (R1), SHARED_BY_REFERENCE, cloneStats
 *   pooledCopy.ts  PooledStateCopier: an exact copy INTO a reused scratch state (R1b), StateCopyFn, stateDifference
 *
 * Spike only (RBD1): nothing here reaches the sim, a hash or a recording.
 */
export * from "./config";
export * from "./clone";
export * from "./pooledCopy";
