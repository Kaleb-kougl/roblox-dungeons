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
 *   nameTags.ts   co-op name tags (docs/PLAYER_NAMES.md): who gets one, its floor place above the head (below the
 *                 feet by a wall), its duck and fade (NameTagLook; tunables NAME_TAGS in nameTagsConfig.ts)
 *   spectate.ts   co-op spectating (docs/SPECTATE.md): whose player the views follow after the local player died, the
 *                 switch command, SpectateTracker (tunables: SPECTATE in spectateConfig.ts)
 *   portrait.ts   portrait play (docs/PORTRAIT.md): the view's framing on any aspect (the short side keeps
 *                 VIEW_TILES_HIGH), the upright lift, the backdrop's reach (tunables: PORTRAIT)
 *   cursor.ts     the gauntlet cursor (docs/CURSOR.md C3): the pointer mode (custom in menus only / system / hidden),
 *                 the hover art id, the whole-number scale per Cursor size, the label's placement with the fingertip
 *                 on the mouse through the click squeeze (tunables: CURSOR_VIEW in cursorConfig.ts)
 *   floorTexture.ts  world-anchored Texture offsets so merged floor slabs show one continuous pattern
 *   wallTexture.ts   the same for wall Parts' Top and side faces (a biome with a repeating wall image)
 *   sprites.ts    sprite renderer logic: world facing -> screen facing, animation + frame from sim state, billboard
 *   characters.ts each player's character and theme visual (docs/ARCHER.md AR9: the run's pick, else the weapons')
 *   variants.ts   enemy variants on screen (docs/ENEMY_VARIANTS.md EV9): affix reads / looks (ring, chip, shield row,
 *                 shield flash, Hulking scale, elite), the Vengeful corpse, the goo pool split and decal look, imp
 *                 landings (BlinkWatch), the summoner's ring filter (tunables: variantsConfig.ts)
 *   newEnemies.ts the second endless set on screen (docs/NEW_ENEMIES.md NE8): the Bomber's fuse flash and detonation
 *                 (DetonationWatch, the quick corpse), the stun / dizzy stars, the Warbanner's aura (AuraView, its
 *                 ring), the strike flash's pool filter and look (tunables: newEnemiesConfig.ts; sprite inputs in
 *                 sprites.ts, the strike row in markings.ts)
 *   hazards.ts    the floor hazards' sprites (docs/HAZARD_ART.md HA4): the strike flash, the scorch it leaves
 *                 (ScorchTracker), the ember's burn loop, the strike's flat size (tunables: hazardsConfig.ts)
 *   buildBullets.ts  build effect bullets (docs/BUILDS.md BU8): player bullet look by payload kind (burst / shard /
 *                 bolt), trails, the ember decal pool split and look (tunables: BUILD_BULLET_VIEW in buildBulletsConfig.ts)
 *   bullets/      sprite bullets (docs/PROJECTILE_ART.md PA4): enemy looks by kind, flicker frame, yaw along the
 *                 velocity, screen heading, player bullet impacts (tunables: BULLET_ART_VIEW / BULLET_IMPACT_VIEW)
 *   spriteCell.ts per-sheet cells (docs/DEMON_ART.md DD4): the billboard layout of one sheet's own cell and pivot
 *   breakables.ts breakable barrels / crates on screen: the frame diff, hit blink / shake, placement, debris, aim clip
 *                 (tunables: BREAKABLE_VIEW in breakablesConfig.ts)
 *   breakableLoot.ts  boosts from breakables (docs/BREAKABLE_DROPS.md BL6): the loaded piece's glint (phase, cadence,
 *                 billboard, duck), the released boost's hop, the KV_LootDebug label (tunables: BREAKABLE_LOOT_VIEW in
 *                 breakableLootConfig.ts)
 *   outline.ts    enemy outlines (enemy outline plan O2 / O4): who gets the rim (actorOutlined), the actor folder's
 *                 groups, the shared Highlight's look, the KV_EnemyOutline switch (ACTOR_OUTLINE) and when a sprite's
 *                 baked rim draws (spriteOutlineVisible); the player outline (docs/PLAYER_OUTLINE.md): who gets it
 *                 (playerOutlined: the watched player, alive, setting and KV_PlayerOutline on) and its look (PLAYER_OUTLINE)
 *   roomEdges.ts  room edges (docs/ROOM_EDGES.md): the dashed corridor-to-room edge runs of a floor (tunables:
 *                 ROOM_EDGE_VIEW in roomEdgesConfig.ts); roomEdgeState.ts: each room's safe / waiting / live state
 *                 and fightOn (the LIVE rule alone: a fight is on; docs/COMBO.md CB1)
 *   collisionDebug.ts  KV_CollisionDebug (docs/WALL_SLIDE.md WS6): the blocking cells near the watched player
 *                 (isolated 1x1 blockers apart), the input magnitude, the StallDetector and its log line, the sword
 *                 spacing keep circles (keepRingsNear, docs/SWORD_SPACING.md SP6) (tunables: COLLISION_DEBUG in
 *                 collisionDebugConfig.ts)
 *   watch.ts      StateWatch: per-player and per-floor edges from sim state (hurt and its HurtKind, death, roll,
 *                 swing, ...) for the audio mapper and the feel controllers (docs/FEEL.md J1)
 *   preload.ts    asset preloading (docs/PRELOAD.md): the core / later tiers of a pack's content ids, the loading
 *                 screen's release and Skip rules, PreloadProgress, a boss floor's push (tunables: PRELOAD in
 *                 preloadConfig.ts), PreloadQueue (the client's three-lane download queue: front / next / back) and
 *                 JoinGate (the join flow fires once the first-run gate decided and the screen released);
 *                 preloadStrings.ts: the loading screen's string keys (LOADING_STRINGS; its layout: LOADING_VIEW in
 *                 preloadConfig.ts)
 *   artReadiness.ts  ArtReadiness (docs/STAGE_ASSETS.md SA15): per content id pending / ready / failed (one retry),
 *                 logical ids ready once every content id resolved, epoch + flippedSince for the stand-in swaps,
 *                 the KV_StandInsForce force (tunables: ART_READINESS in artReadinessConfig.ts)
 *   standIns.ts   the renderers' stand-in swaps (docs/STAGE_ASSETS.md SA17): drawsArt, FlipTracker (per-frame flips),
 *                 ReadyIds (a fixed id list's readiness, re-read per epoch)
 *   stageLoader.ts  the stage loader (docs/STAGE_LOADER.md): StageLoad (one cover's phases: server wait, forge, view
 *                 rebuild, assets, settle, reveal), stageMerge, floorChangeStaged, pregenTarget / PregenTracker (floor
 *                 n + 1 during floor n's draft), the KV_Debug listener timing line (tunables: STAGE_LOADER and the
 *                 cover's layout STAGE_VIEW in stageLoaderConfig.ts; string keys: STAGE_STRINGS in stageStrings.ts)
 *   stageAssets.ts  the stage asset manifest (docs/STAGE_ASSETS.md SA2): every logical id a floor can show or play,
 *                 in front-lane order (stageAssetGroups / stageAssets / stageContentRefs), the audit diff; its theme
 *                 groups (actor kind, character, biome, free decor, feature) in stageGroups.ts (SA1)
 *                 (tunables: STAGE_ASSETS in stageAssetsConfig.ts; floor inputs: shared/run stageInput.ts)
 *   stageAudit.ts  the KV_StageAssetAudit recording's pure half (STAGE_AUDIT, StageAuditLog, SA11) and the merged
 *                 prefetch manifest (stageMergedAssets, SA7)
 *   pieceStandIns.ts  stand-ins while art downloads (docs/STAGE_ASSETS.md SA18): ReadinessCursor (a renderer's flips),
 *                 lookWhenReady, the solid decor stand-in boxes solidStandIns / solidStandInShown (tunables:
 *                 SOLID_DECOR_STAND_IN in standInsConfig.ts)
 *   decor/        the decor plan (docs/DECOR.md R3 / R6 / R8): planDecor, decorProfile, fade selection, glow points
 *   voidDecor/    void decoration (docs/VOID_DECOR.md VD2-VD4, VD9): voidField, planVoid (shoulder / ledge / outcrop /
 *                 abyss per cell, greedy rects), VOID / VOID_DEPTH, the VoidController's columns (voidColumnOf,
 *                 voidLayerStyle, voidRunInput, VOID_VIEW)
 *   modifiers/    floor modifiers on screen (docs/FLOOR_MODIFIERS.md FM5 / FM6): the floor card banner's rows, stamp
 *                 and hold, the status chip's pulse, ModifierPayoff (the once-per-floor payoff frame) and its input
 *                 from a run view (tunables: FLOOR_MODIFIER_VIEW in modifiers/config.ts)
 *   minimap/      the minimap with fog of war (docs/MINIMAP.md M1-M5): map tiles, sight, FogOfWar, the turned map
 *                 transform, the RGBA8 painter (tunables: MINIMAP_VIEW in minimap/config.ts)
 *
 * Sub-barrels (import from the folder): `shared/view/fx` (the juice layer: hit tracker, hitstop, bars, numbers,
 * particles), `shared/view/audio` (sim events -> theme sound IDs, music), `shared/view/hud` (HUD font token, layout,
 * string keys), `shared/view/dummy` (the training dummy's sprite input and view-side hit clip, docs/DUMMY_ART.md),
 * `shared/view/predict` (local prediction's correction smoothing, docs/LOCAL_PREDICTION.md LP4).
 */
export * from "./iso";
export * from "./config";
export * from "./space";
export * from "./tileMerge";
export * from "./markings";
export * from "./party";
export * from "./spectateConfig";
export * from "./spectate";
export * from "./nameTagsConfig";
export * from "./nameTags";
export * from "./portrait";
export * from "./cursorConfig";
export * from "./cursor";
export * from "./sprites";
export * from "./characters";
export * from "./variantsConfig";
export * from "./buildBulletsConfig";
export * from "./buildBullets";
export * from "./bullets";
export * from "./variants";
export * from "./newEnemiesConfig";
export * from "./newEnemies";
export * from "./hazardsConfig";
export * from "./hazards";
export * from "./newEnemySprites";
// docs/NEW_ENEMIES_2.md NX7: the third endless set on screen (rules, tunables, sprite inputs).
export * from "./newEnemies2Config";
export * from "./newEnemies2";
export * from "./newEnemy2Sprites";
// docs/NEW_ENEMIES_3.md NT7: the fourth endless set on screen (rules, tunables, sprite inputs).
export * from "./newEnemies3Config";
export * from "./newEnemies3";
export * from "./newEnemy3Sprites";
export * from "./spriteCell";
export * from "./floorTexture";
export * from "./wallTexture";
export * from "./breakablesConfig";
export * from "./breakables";
export * from "./breakableLootConfig";
export * from "./breakableLoot";
export * from "./outline";
export * from "./roomEdgesConfig";
export * from "./roomEdges";
export * from "./roomEdgeState";
export * from "./decor";
export * from "./voidDecor";
export * from "./minimap";
export * from "./modifiers";
export * from "./collisionDebugConfig";
export * from "./collisionDebug";
export * from "./watch";
export * from "./latencyProbeConfig";
export * from "./latencyProbe";
export * from "./preloadConfig";
export * from "./artReadinessConfig";
export * from "./artReadiness";
export * from "./standIns";
export * from "./preload";
export * from "./preloadStrings";
export * from "./stageLoaderConfig";
export * from "./stageStrings";
export * from "./stageLoader";
export * from "./stageAssetsConfig";
export * from "./stageGroups";
export * from "./stageAssets";
export * from "./stageAudit";
export * from "./standInsConfig";
export * from "./pieceStandIns";
