/**
 * Barrel for the Codex in a run (claude/codex-plan.md CX4): the per-frame input the client fills (frame.ts: CodexFrame,
 * readCodexFrame from the sim state, pushCodexDeath for the frame's kills) and the tracker that turns frames into tier
 * rises, toast decisions under the per-floor budget and the run-over summary (tracker.ts: CodexTracker). Pure, tested
 * headlessly; the client's CodexController owns the tracker (CX6). toasts.ts: how the Codex shows on the in-run toasts
 * (the NEW! chip on a run event's toast, the codex toast's strings, the chip's pop, the sightings a seeded doc already
 * has; CX6). screen.ts: the Codex screen's rules (grid columns, tabs, tiles, the detail panel, the badge; CX7); art.ts:
 * an entry's tile art (codexTileArt: item cells, sprite stills, silhouettes; CX7); draftTag.ts: the draft card's NEW
 * tag, shown once its flip settled (DraftNewTags; CX8); recap.ts: the run-over row and the siblings' hooks (CX9). The
 * catalog and the doc are
 * shared/codex (which never imports shared/view).
 */
export * from "./frame";
export * from "./tracker";
export * from "./toasts";
export * from "./screen";
export * from "./art";
export * from "./draftTag";
export * from "./recap";
