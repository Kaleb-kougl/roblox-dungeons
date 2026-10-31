/**
 * Barrel for server-only configuration: values that must never reach a client (they would be readable there), such as
 * the daily seed's secret (daily.ts). Tunables clients may know live in shared/.
 */
export * from "./daily";
