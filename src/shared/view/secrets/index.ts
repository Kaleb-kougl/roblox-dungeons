/**
 * Barrel for a secret room on screen (docs/SECRET_ROOMS.md SR6-SR9, the view core; "As built (Track V1)" lists what each
 * client controller calls): the presentation tunables (SECRET_VIEW), the frame's collected events (SecretFrameEvents, on
 * every RunView as `secrets`; NO_SECRET_EVENTS elsewhere), the look and its edges (secretLook, SecretViewTracker), the
 * knock throttle and the first-knock latch (knock.ts), the sound edges (SecretCueTracker, read by the shared/view/audio
 * cue mapper), the world cells (geometry.ts: the crack's hole in the wall merge, the chamber built hidden, the void
 * hold-out and decor keep-out rectangle), the minimap's change, reveal and chest mark (minimap.ts) and the HUD's news
 * (news.ts: the SECRET! shout, the co-op toast, the reward cards) and the client's drawn parts (parts.ts: the crack
 * Part's rect and face, the overlay variant, the front box, the burst shards, the fallback rubble). Presentation only;
 * tested headlessly. Not in the
 * shared/view barrel (like shared/view/treasure): import "shared/view/secrets".
 *
 * @module
 */
export * from "./config";
export * from "./events";
export * from "./geometry";
export * from "./knock";
export * from "./look";
export * from "./cues";
export * from "./minimap";
export * from "./news";
export * from "./parts";
