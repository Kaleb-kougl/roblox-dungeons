/**
 * Barrel for the pacts on screen (docs/FORTUNE.md FO7 / FO9): the presentation tunables (PACTS_VIEW, HORDE_CHIP_VIEW),
 * the frame's collected pact events (PactFrameEvents), and the pure rules the altar renderer, the floor cards, the HUD
 * (hint, draft title, Horde chip), the room edges, the score pops, the wave rings and the debug labels draw from.
 * Presentation only; tested headlessly (pacts.spec.ts).
 *
 * @module
 */
export * from "./config";
export * from "./events";
export * from "./pacts";
