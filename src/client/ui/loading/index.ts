/**
 * Barrel for the loading covers (React + Reflex), each its own ScreenGui over every other layer:
 *
 *   LoadingScreen  the join loading screen (docs/PRELOAD.md P4): LoadingController mounts it on join and unmounts it
 *                  after the release's fade; rules pure in shared/view (preload.ts, LOADING_VIEW, LOADING_STRINGS),
 *                  state in the Reflex `loading` slice
 *   StageCard      the stage loader's cover (docs/STAGE_LOADER.md SL5): "Starting run..." / "Forging floor 1..." and a
 *                  slim bar at a run start, the "Floor 4 · Ancient Halls" card at a floor change; StageController
 *                  mounts it once and drives its fade; rules pure in shared/view (stageLoader.ts, STAGE_VIEW,
 *                  STAGE_STRINGS), state in the Reflex `stage` slice
 *   parts          the shared cover and progress bar (SD6: one look)
 *
 * @module
 */
export * from "./parts";
export * from "./LoadingScreen";
export * from "./StageCard";
