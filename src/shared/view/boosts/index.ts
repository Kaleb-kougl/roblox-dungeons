/**
 * Barrel for boost drops on screen (docs/BOOSTS.md B6 / B7): the presentation tunables (BOOST_VIEW), the frame's
 * collected drop events (BoostFrameEvents), and the pure rules the drop renderer, the player aura and the HUD's boost
 * row draw from. Presentation only; tested headlessly (boosts.spec.ts).
 */
export * from "./config";
export * from "./events";
export * from "./boosts";
