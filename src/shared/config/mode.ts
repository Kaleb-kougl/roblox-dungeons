/**
 * Which game the place plays (GDD M1 "Endless solo loop"). Read by the client (the live run's world) AND the server
 * (the world it validates submissions in: shared/run LIVE_RUN_LIMITS), so both always agree.
 *
 *   endless  an unbroken descent through Dungeon Forge floors until death (shared/run buildEndlessRunConfig)
 *   m1       the original M1 "First fight": one floor, Mother Mayhem, victory on her death (buildRunConfig "game")
 *
 * Studio can still pick any world per run with the client's KV_World and the server's KV_RunValidationWorld attributes.
 */
export type PlayMode = "endless" | "m1";

/**
 * The game this build of the place plays: `endless`. A compile-time constant shared by client and server, from which
 * shared/run derives the world a live server validates in and the client plays by default (`LIVE_RUN_WORLD`); switching
 * to `m1` means changing it here and rebuilding.
 */
export const PLAY_MODE = "endless" as PlayMode;
