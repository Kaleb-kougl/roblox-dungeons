/**
 * Barrel for Roblox invites and parties (docs/INVITES.md): tunables (config.ts), the LaunchData codec
 * (launchData.ts), the arrival resolver (arrival.ts) and the server's smaller pure decisions (serviceRules.ts:
 * recipient lists, party accept order, arrival analytics, mid-session party offers). The platform / party invites
 * themselves live in the lobby model (shared/lobby `Lobbies.platformInvites` / `partyInvite`), their analytics in
 * shared/lobby analytics.ts.
 *
 * Plain TypeScript, no Roblox APIs (headlessly tested); server/services/InviteService.ts wraps it.
 *
 * @module
 */
export * from "./config";
export * from "./launchData";
export * from "./arrival";
export * from "./serviceRules";
