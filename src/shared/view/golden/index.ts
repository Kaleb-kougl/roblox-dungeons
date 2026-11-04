/**
 * Barrel for the Goldling on screen (docs/FORTUNE.md FO8 / FO9): the presentation tunables (GOLDEN_VIEW), the frame's
 * collected Goldling events (GoldenFrameEvents), the pure rules its views draw from (golden.ts) and its sprite input
 * (sprite.ts, registered in sprites.ts by file). Presentation only; tested headlessly (golden.spec.ts).
 */
export * from "./config";
export * from "./events";
export * from "./golden";
export * from "./sprite";
