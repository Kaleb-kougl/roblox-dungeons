/**
 * Barrel for client controllers.
 *
 * `Flamework.addPaths("src/client/controllers")` in runtime.client.ts discovers controllers by
 * scanning this directory tree; this barrel is how the rest of the client imports them.
 * Re-export each subfolder as it is added.
 *
 *   game/    theme, input, the live sim, camera, world, character guard (task 8)
 *   render/  bullets, actors + player, weapon arcs, telegraphs (task 8)
 *   fx/      juice: the FX hit tracker, health bars, damage numbers, particles, freeze frame (task 8 part B)
 *   audio/   theme sounds for sim events, music (task 8 part B)
 *   ui/      the HUD mount and the juice settings (task 8 part B; React HUD in client/ui/hud)
 *   spikes/  task 1 go/no-go spikes (off by default)
 */
export * from "./game";
export * from "./render";
export * from "./fx";
export * from "./audio";
export * from "./ui";
export * from "./spikes";
