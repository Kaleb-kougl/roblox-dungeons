/**
 * Barrel for the join loading screen (docs/PRELOAD.md P4; React + Reflex): LoadingScreen, its own ScreenGui over every
 * other layer. LoadingController mounts it on join and unmounts it after the release's fade. Its rules are pure in
 * shared/view (preload.ts, LOADING_VIEW, LOADING_STRINGS); its state is the Reflex `loading` slice.
 */
export * from "./LoadingScreen";
