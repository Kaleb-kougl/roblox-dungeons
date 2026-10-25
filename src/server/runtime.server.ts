import { Flamework } from "@flamework/core";

/**
 * Server bootstrap: registers service search paths, then starts Flamework.
 *
 * The server never runs the live sim (PLAN.md "Single-player first"); task 9 adds the
 * RunService that replays a submitted recording and compares hashes.
 */
Flamework.addPaths("src/server/services");
Flamework.ignite();
