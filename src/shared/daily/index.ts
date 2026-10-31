/**
 * Barrel for the Daily (docs/DAILY.md): tunables and the `daily` world kind (config.ts), day math (day.ts: day index,
 * reset time, label, board scope), the keyless seed mixer (seed.ts; the secret is server-only, DSD8) and the wire
 * status (status.ts).
 *
 * Plain TypeScript, no Roblox APIs (headlessly tested). Never put the daily secret under shared/ or client/.
 */
export * from "./config";
export * from "./day";
export * from "./seed";
export * from "./status";
