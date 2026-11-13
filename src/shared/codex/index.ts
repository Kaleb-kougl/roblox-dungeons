/**
 * Barrel for the Codex (claude/codex-plan.md): the catalog of every entry (boons, evolutions, duos, relics, curses,
 * boosts, enemies, champion affixes, bosses, the secret rooms: docs/SECRET_ROOMS.md SRD12) with its stable ids and the lookups from game facts to ids (CX1); the
 * stored document `KV_Codex_v1` with its codec, merges, claims, views and the one-time seed, the claim policy, the
 * Studio fake parser and the tunables (CX2); the `codexStatus` payload and the remotes' pure rules (CX3); the client's
 * send queue (outbox.ts: batching and pacing of claims and views) and the menu's counts (progress.ts) (CX6). Plain
 * TypeScript, headlessly tested; CodexService wraps the doc, CodexController the outbox.
 */
export * from "./catalog";
export * from "./config";
export * from "./doc";
export * from "./policy";
export * from "./fake";
export * from "./status";
export * from "./outbox";
export * from "./progress";
