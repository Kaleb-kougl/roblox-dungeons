/**
 * Barrel for co-op deterministic lockstep (M4), Roblox-API-free (headless specs drive it with simulated clients):
 *
 *   config.ts   tunables (input delay 3 ticks, hash reports every 60 ticks, batching, timeouts, segment size)
 *   relay.ts    LockstepRelay: the server's merged frame per tick (deadlines -> repeat last input, leavers)
 *   wire.ts     input batches (client -> server) and delta-coded merged batches (server -> clients)
 *   ledger.ts   HashLedger: clients' hash reports agreed in order; desync detection
 *   log.ts      PartyRunLog: the server's merged log, sliced into party-codec segments
 *   session.ts  LockstepSession: the server side of one party run (clock, relay, ledger, validator feed, final)
 *   pacer.ts    PlayoutPacer: co-op frame pacing, how many queued frames to step per rendered frame and the alpha
 *   lead.ts     LeadController: the net input lead from the server's echoed trips (p95 + margin, up at once, down
 *               within seconds; the legacy miss counter while no echo arrives)
 *   arrivalLog.ts  ArrivalLog: the KV_Debug co-op arrival log (batch gaps and sizes, pacing, fps; FP0)
 *   client.ts   LockstepClient: steps the sim with merged frames only, sends inputs / hashes / the final claim
 *   menuInput.ts  CoopMenuInputGate: neutral local input while a menu owns the controls (a party run never pauses)
 *   rollbackSpike/  the rollback measurement spike (docs/ROLLBACK_SPIKE.md): the state copy, its tunables
 *
 * The server's RunSessionService and the client's SimController wrap these with remotes and clocks.
 */
export * from "./config";
export * from "./relay";
export * from "./wire";
export * from "./ledger";
export * from "./log";
export * from "./session";
export * from "./pacer";
export * from "./lead";
export * from "./arrivalLog";
export * from "./client";
export * from "./menuInput";
export * from "./rollbackSpike";
