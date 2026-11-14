/**
 * Barrel for Silver in crates on screen (docs/SILVER.md SC3, the pure core): the presentation tunables
 * (SILVER_CRATE_FX), the frame's collected breaks (SilverFrameEvents; NO_SILVER_EVENTS elsewhere) and the crate burst's
 * planner (SilverCrateFx: the counter's gain, the `+N` pops, the coins' hop and flight, the clink's climbing step). The
 * twinkle on a Silver piece is shared/view breakableLoot.ts pieceGlints (the boost pieces' own). Presentation only;
 * tested headlessly. Not in the shared/view barrel (like shared/view/secrets): import "shared/view/silver".
 */
export * from "./config";
export * from "./events";
export * from "./crateFx";
