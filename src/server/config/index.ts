/**
 * Barrel for server-only configuration: values that must never reach a client (they would be readable there), such as
 * the daily seed's key (daily.ts). Tunables clients may know live in shared/.
 *
 * @module
 */
export * from "./daily";
