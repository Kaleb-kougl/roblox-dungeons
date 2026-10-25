/**
 * Barrel for the client's play session logic that needs no Roblox API (task 8), so it is unit-tested headlessly:
 *
 *   config.ts        run setup attributes, HUD snapshot rate, device thresholds
 *   inputMapping.ts  device snapshots -> quantized InputFrame (port of the web build's devices.ts), bindings, remaps
 *   liveRun.ts       one live run: fixed-step loop, recording per tick, pause, outcome, submission, F8 replay check
 *   snapshot.ts      the ~10 Hz HUD snapshot and its change check
 *   submitPolicy.ts  which finished runs are submitted, and the size caps checked before sending
 *
 * The client controllers (src/client/controllers/game) wrap these with Roblox input, attributes and remotes.
 */
export * from "./config";
export * from "./inputMapping";
export * from "./liveRun";
export * from "./snapshot";
export * from "./submitPolicy";
