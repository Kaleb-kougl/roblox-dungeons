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
 *   spectate.ts   co-op spectating (docs/SPECTATE.md): whose player the views follow after the local player died, the
 *                 switch command, SpectateTracker (tunables: SPECTATE in spectateConfig.ts)
 *   floorTexture.ts  world-anchored Texture offsets so merged floor slabs show one continuous pattern
 *   sprites.ts    sprite renderer logic: world facing -> screen facing, animation + frame from sim state, billboard
 *   spriteCell.ts per-sheet cells (docs/DEMON_ART.md DD4): the billboard layout of one sheet's own cell and pivot
 *   breakables.ts breakable barrels / crates on screen: the frame diff, hit blink / shake, placement, debris, aim clip
 *                 (tunables: BREAKABLE_VIEW in breakablesConfig.ts)
 *   outline.ts    enemy outlines (enemy outline plan O2 / O4): who gets the rim (actorOutlined), the actor folder's
 *                 groups, the shared Highlight's look, the KV_EnemyOutline switch (ACTOR_OUTLINE) and when a sprite's
 *                 baked rim draws (spriteOutlineVisible)
 *   roomEdges.ts  room edges (docs/ROOM_EDGES.md): the dashed corridor-to-room edge runs of a floor (tunables:
 *                 ROOM_EDGE_VIEW in roomEdgesConfig.ts); roomEdgeState.ts: each room's safe / waiting / live state
 *   decor/        the decor plan (docs/DECOR.md R3 / R6 / R8): planDecor, decorProfile, fade selection, glow points
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
export * from "./spectateConfig";
export * from "./spectate";
export * from "./sprites";
export * from "./spriteCell";
export * from "./floorTexture";
export * from "./breakablesConfig";
export * from "./breakables";
export * from "./outline";
export * from "./roomEdgesConfig";
export * from "./roomEdges";
export * from "./roomEdgeState";
export * from "./decor";
export * from "./latencyProbeConfig";
export * from "./latencyProbe";
