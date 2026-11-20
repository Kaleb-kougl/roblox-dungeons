/**
 * Barrel for the Goldling on screen (docs/FORTUNE.md FO8 / FO9): the presentation tunables (GOLDEN_VIEW), the frame's
 * collected Goldling events (GoldenFrameEvents), the pure rules its views draw from (golden.ts) and its sprite input
 * (sprite.ts, registered in sprites.ts by file), and its rumours (rumour.ts: the phase and the per-client clock of the
 * floor / room cues and the chip, docs/GOLDLING_RUMOURS.md GR5). Presentation only; tested headlessly (golden.spec.ts,
 * release.spec.ts, rumour.spec.ts).
 *
 * @module
 */
export * from "./config";
export * from "./events";
export * from "./golden";
export * from "./sprite";
export * from "./rumour";
