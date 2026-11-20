/**
 * Barrel for the first-run tutorial's script (docs/TUTORIAL.md "Architecture §3"): the ordered steps and callouts
 * (steps.ts), the TutorialDirector state machine the client runs once per frame (director.ts), and every tutorial
 * theme string key (strings.ts), and the client's flow (flow.ts: the first-run gate, the HUD state, the outro beat). Pure and Roblox-API-free; headlessly tested by tutorial.spec.ts with the tutorial
 * bot (shared/run/testing tutorialBot.ts). guide.ts: the guidance arrow's TutorialGuide (docs/TUTORIAL_ARROW.md;
 * guide.spec.ts). metrics.ts: TutorialMetrics, the funnel's per-lesson time / hits and stuck episodes
 * (docs/TUTORIAL_FUNNEL.md §5; fed by the director, metrics.spec.ts).
 *
 * @module
 */
export * from "./steps";
export * from "./strings";
export * from "./director";
export * from "./metrics";
export * from "./flow";
export * from "./guide";
