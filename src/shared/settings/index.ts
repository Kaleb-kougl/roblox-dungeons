/**
 * Barrel for per-player settings: the juice settings schema (port of the web build's src/fx/settings.ts), the audio
 * and display groups (task L4), the stored document v2 (every group, with the controls overrides of shared/play
 * bindings.ts; v1 migrates), and the small mockable persistence layer SettingsService uses. Plain TypeScript,
 * headlessly tested.
 *
 * @module
 */
export * from "./juice";
export * from "./audio";
export * from "./display";
export * from "./doc";
export * from "./store";
export * from "./config";
export * from "./vibration";
