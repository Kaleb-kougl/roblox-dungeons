/**
 * Barrel for the client's play session logic that needs no Roblox API (task 8), so it is unit-tested headlessly:
 *
 *   bindings.ts      rebindable controls: actions, default layout, rebind / swap rules, stored overrides, labels
 *   config.ts        run setup attributes, HUD snapshot rate, device thresholds, rebinding lists
 *   draftGate.ts     the boon draft reveal's confirm gate: confirm masked until the reveal settles, a press skips it; a
 *                    draft card click's mouse press kept off the sim (dropDraftGuiMouse)
 *   inputMapping.ts  device snapshots -> quantized InputFrame (port of the web build's devices.ts) through a layout
 *   liveRun.ts       one live run: fixed-step loop, recording per tick, pause, outcome, submission, F8 replay check
 *   rebindFlow.ts    the Options screen's rebinding flow: capture -> bind / swap prompt / refusal, countdown, test strip
 *   runOverGate.ts   the run-over retry gate: Again / confirm / FIRE skip the recap before its arm, retry after (RR7)
 *   snapshot.ts      the ~10 Hz HUD snapshot and its change check
 *   submitPolicy.ts  which finished runs are submitted, and the size caps checked before sending
 *   touch/           touch controls state machine: fingers -> one TouchSnapshot per frame (docs/MOBILE_IMPL.md MB3)
 *
 * The client controllers (src/client/controllers/game) wrap these with Roblox input, attributes and remotes.
 *
 * @module
 */
export * from "./bindings";
export * from "./config";
export * from "./draftGate";
export * from "./inputMapping";
export * from "./liveRun";
export * from "./rebindFlow";
export * from "./runOverGate";
export * from "./snapshot";
export * from "./submitPolicy";
export * from "./touch";
