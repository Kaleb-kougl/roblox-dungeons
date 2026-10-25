/**
 * Barrel for the audio layer's pure logic: the sim event -> theme sound ID mapping (with per-ID cooldowns), the music
 * choice, and the mixing tunables. The client's AudioController plays the IDs through ThemePack.sound(id).
 */
export * from "./cues";
export * from "./config";
