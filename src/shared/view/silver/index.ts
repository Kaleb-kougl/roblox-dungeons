/**
 * Barrel for Silver on screen (docs/SILVER.md SC3 / SV8 / SV9 / SV18, the pure core): the presentation tunables
 * (SILVER_CRATE_FX, SILVER_COUNTER, SILVER_RECAP), the frame's collected breaks (SilverFrameEvents; NO_SILVER_EVENTS
 * elsewhere), the crate burst's planner (SilverCrateFx), the live counter (SilverTracker, SilverCounterChip,
 * silverCounterShown) and its place on the score panel (silverRowFit), the run-over rows (silverRecapModel), the
 * wallet reads (statusOwns, statusUpgrades, ...) and the Armory item labels. The twinkle on a Silver piece is
 * shared/view breakableLoot.ts pieceGlints (the boost pieces' own). Presentation only; tested headlessly. Not in the
 * shared/view barrel (like shared/view/secrets): import "shared/view/silver".
 *
 * @module
 */
export * from "./config";
export * from "./events";
export * from "./crateFx";
export * from "./tracker";
export * from "./counter";
export * from "./names";
export * from "./recap";
export * from "./wallet";
