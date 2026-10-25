/**
 * Barrel for view math shared by client presentation code: plain numbers only, so it is unit-tested headlessly. Not
 * part of the sim (trig is fine here; nothing here feeds `step()`).
 *
 *   iso.ts        iso camera basis, distance for a FOV, texel snap, damped follow
 *   config.ts     presentation tunables of the game views (camera, world, draw sizes, markings, render order)
 *   space.ts      sim units <-> studs, interpolation, the mouse-aim ray onto the floor
 *   tileMerge.ts  greedy rectangle meshing of the dungeon grid (few Parts per floor)
 *   markings.ts   telegraph / weapon arc / seal geometry as line segments, dash layout
 *   party.ts      co-op presentation rules (teammates' bullets faded in large parties)
 *   floorTexture.ts  world-anchored Texture offsets so merged floor slabs show one continuous pattern
 *   sprites.ts    sprite renderer logic: world facing -> screen facing, animation + frame from sim state, billboard
 *
 * Sub-barrels (import from the folder): `shared/view/fx` (the juice layer: hit tracker, hitstop, bars, numbers,
 * particles), `shared/view/audio` (sim events -> theme sound IDs, music), `shared/view/hud` (HUD font token, layout,
 * string keys).
 */
export * from "./iso";
export * from "./config";
export * from "./space";
export * from "./tileMerge";
export * from "./markings";
export * from "./party";
export * from "./sprites";
export * from "./floorTexture";
