/**
 * Barrel for the audio layer's pure logic: the sim event -> theme sound ID mapping (per-ID cooldowns, the per-frame
 * cap, the co-op split through the state watch, shared/view watch.ts), the music and ambience choice, the per-start choices (variant,
 * pitch, duck), the run-over recap's tick / land rule (recapCues.ts, docs/RUN_RECAP.md RR4) and the mixing tunables.
 * The client's AudioController plays the cues through ThemePack.sound(id).
 *
 * @module
 */
export * from "./bedGate";
export * from "./cues";
export * from "./config";
export * from "./music";
export * from "./recapCues";
export * from "./voices";
