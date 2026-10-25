/**
 * Barrel for same-server lobbies: tunables, visibility / phase / preset name vocabularies (config.ts), the pure
 * lobby model with its invites, countdown and browse list (lobbies.ts), and the pieces LobbyService wraps around it:
 * who hears what after a change (outbox.ts), the friend answers cache (friendCache.ts), which lobby a run belongs to
 * (runTracker.ts) and the analytics events (analytics.ts). Replaces the M4 co-op invite flow (removed in
 * task L7).
 *
 * Plain TypeScript, no Roblox APIs (headlessly tested); server/services/LobbyService.ts wraps it.
 */
export * from "./config";
export * from "./lobbies";
export * from "./outbox";
export * from "./friendCache";
export * from "./runTracker";
export * from "./analytics";
