/**
 * Barrel for local prediction on screen (docs/LOCAL_PREDICTION.md Design 4 / 6): the smoother that turns the
 * predictor's heads (shared/lockstep predict.ts) into the drawn pose, its tunables, and the drawn player the views read
 * (drawn.ts: writeDrawnPlayer, DrawnPlayerOf, drawnOrMerged). Presentation only; tested headlessly (smoother.spec.ts,
 * drawn.spec.ts).
 */
export * from "./config";
export * from "./smoother";
export * from "./drawn";
