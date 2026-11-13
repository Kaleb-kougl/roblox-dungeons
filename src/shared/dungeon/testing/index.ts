/**
 * Test support for specs (never imported by the game): the endless room pool census (poolCensus.ts,
 * docs/ENEMY_VARIANTS.md EV5), the spender fallback trace (spenderFallback.ts, EV13), the wall-slide scenes
 * (slideScenes.ts, docs/WALL_SLIDE.md WS0-WS2), the elite affix census (affixCensus.ts, EV6) and the census shards
 * (shards.ts: a long census split over several spec files by run seed).
 */
export * from "./poolCensus";
export * from "./spenderFallback";
export * from "./slideScenes";
export * from "./affixCensus";
export * from "./shards";
