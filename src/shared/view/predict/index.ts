/**
 * Barrel for local prediction on screen (docs/LOCAL_PREDICTION.md Design 4): the smoother that turns the predictor's
 * heads (shared/lockstep predict.ts) into the drawn pose, and its tunables. Presentation only; tested headlessly
 * (smoother.spec.ts).
 */
export * from "./config";
export * from "./smoother";
