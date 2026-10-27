/**
 * Barrel for Roblox invites and parties (docs/INVITES.md): tunables (config.ts), the LaunchData codec
 * (launchData.ts) and the arrival resolver (arrival.ts). The platform / party invites themselves live in the lobby
 * model (shared/lobby `Lobbies.platformInvites` / `partyInvite`), their analytics in shared/lobby analytics.ts.
 *
 * Plain TypeScript, no Roblox APIs (headlessly tested); server/services/InviteService.ts (task I4) wraps it.
 */
export * from "./config";
export * from "./launchData";
export * from "./arrival";
