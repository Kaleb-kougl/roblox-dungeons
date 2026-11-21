/**
 * Test support for specs (never imported by the game): the endless room pool census (poolCensus.ts,
 * docs/ENEMY_VARIANTS.md EV5), the spender fallback trace (spenderFallback.ts, EV13), the wall-slide scenes
 * (slideScenes.ts, docs/WALL_SLIDE.md WS0-WS2), the elite affix census (affixCensus.ts, EV6), the census shards
 * (shards.ts: a long census split over several spec files by run seed) and the floor without the Goldling's piece
 * (goldenPiece.ts, docs/GOLDLING_RUMOURS.md GR1) and the secret room census (secretCensus.ts, docs/SECRET_ROOMS.md SR1).
 *
 * @module
 */
export * from "./poolCensus";
export * from "./spenderFallback";
export * from "./slideScenes";
export * from "./affixCensus";
export * from "./shards";
export * from "./goldenPiece";
export * from "./secretCensus";
