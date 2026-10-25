import { Flamework } from "@flamework/core";

/**
 * Client bootstrap: registers controller search paths, then starts Flamework.
 *
 * Single-player first (PLAN.md): the sim will run here on the client; the server only replays
 * finished runs to check them.
 */
Flamework.addPaths("src/client/controllers");
Flamework.ignite();
