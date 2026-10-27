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
 *   watch.ts      StateWatch: per-player and per-floor edges from sim state (hurt and its HurtKind, death, roll,
 *                 swing, ...) for the audio mapper and the feel controllers (docs/FEEL.md J1)
 *   preload.ts    asset preloading (docs/PRELOAD.md): the core / later tiers of a pack's content ids, the loading
 *                 screen's release and Skip rules, PreloadProgress, a boss floor's push (tunables: PRELOAD in
 *                 preloadConfig.ts), PreloadQueue (the client's two-lane download queue) and JoinGate (the join
 *                 flow fires once the first-run gate decided and the screen released); preloadStrings.ts: the
 *                 loading screen's string keys (LOADING_STRINGS; its layout: LOADING_VIEW in preloadConfig.ts)
 *   decor/        the decor plan (docs/DECOR.md R3 / R6 / R8): planDecor, decorProfile, fade selection, glow points
 *   minimap/      the minimap with fog of war (docs/MINIMAP.md M1-M5): map tiles, sight, FogOfWar, the turned map
 *                 transform, the RGBA8 painter (tunables: MINIMAP_VIEW in minimap/config.ts)
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
export * from "./minimap";
export * from "./watch";
export * from "./latencyProbeConfig";
export * from "./latencyProbe";
export * from "./preloadConfig";
export * from "./preload";
export * from "./preloadStrings";
