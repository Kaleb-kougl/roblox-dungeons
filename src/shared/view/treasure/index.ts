/**
 * Barrel for a vault on screen (docs/TREASURE.md TR7): the presentation tunables (TREASURE_VIEW), the frame's collected
 * vault events (TreasureFrameEvents, on every RunView; NO_TREASURE_EVENTS elsewhere), every animation as a pure
 * function of time (timeline.ts), the per-frame look (TreasureViewTracker) and every text (text.ts). The client's
 * TreasureRenderController draws it; TR8's toasts, minimap mark and cue mapper read the same events. Presentation only;
 * tested headlessly. Never imports the shared/view/hud barrel (hud imports shared/play, which imports this barrel).
 */
export * from "./config";
export * from "./events";
export * from "./timeline";
export * from "./text";
export * from "./vault";
export * from "./layout";
