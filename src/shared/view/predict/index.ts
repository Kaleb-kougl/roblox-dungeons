/**
 * Barrel for local prediction on screen (docs/LOCAL_PREDICTION.md Design 4 / 5 / 6): the smoother that turns the
 * predictor's heads (shared/lockstep predict.ts) into the drawn pose, the drawn player the views read (drawn.ts:
 * writeDrawnPlayer, DrawnPlayerOf, drawnOrMerged), enemy bullets drawn ahead with the knight (bulletAhead.ts, LP10),
 * prediction suspended while the local player is hooked (resume.ts, docs/NEW_ENEMIES_2.md NX7) and their tunables. Presentation only; tested headlessly (smoother.spec.ts, drawn.spec.ts, bulletAhead.spec.ts).
 */
export * from "./config";
export * from "./smoother";
export * from "./drawn";
export * from "./bulletAhead";
export * from "./resume";
