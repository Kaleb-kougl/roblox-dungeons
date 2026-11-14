/**
 * Barrel for Silver's earn side (docs/SILVER.md SV1): the tunables (config.ts), the pure integer earn function and its
 * reads from a replayed state (earn.ts), and which runs pay (policy.ts). Plain TypeScript, headlessly tested. Never
 * imported by the sim; shared/run segments.ts reads a run's Silver through it (it must not import shared/run).
 */
export * from "./config";
export * from "./earn";
export * from "./policy";
