/**
 * Barrel for the audio layer's pure logic: the sim event -> theme sound ID mapping (per-ID cooldowns, the per-frame
 * cap, the co-op split through the state watch), the music and ambience choice, the per-start choices (variant,
 * pitch, duck) and the mixing tunables. The client's AudioController plays the cues through ThemePack.sound(id).
 */
export * from "./cues";
export * from "./config";
export * from "./music";
export * from "./voices";
export * from "./watch";
