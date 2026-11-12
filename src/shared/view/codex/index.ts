/**
 * Barrel for the Codex in a run (claude/codex-plan.md CX4): the per-frame input the client fills (frame.ts: CodexFrame,
 * readCodexFrame from the sim state, pushCodexDeath for the frame's kills) and the tracker that turns frames into tier
 * rises, toast decisions under the per-floor budget and the run-over summary (tracker.ts: CodexTracker). Pure, tested
 * headlessly; the client's CodexController owns the tracker (CX6). The catalog and the doc are shared/codex (which never
 * imports shared/view).
 */
export * from "./frame";
export * from "./tracker";
