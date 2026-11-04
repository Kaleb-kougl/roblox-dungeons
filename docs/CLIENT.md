# Client (task 8): the playable game loop, HUD, juice and audio

The client runs the deterministic sim live (single-player first, PLAN.md), draws it with theme placeholders, and at
the end of a run sends the recording to the server, which replays it (docs/SERVER.md). Part A built the loop and the
renderers; part B added the React HUD, the juice layer (health bars, damage numbers, freeze frame, particles, camera
nudge), the juice settings panel and audio; task L4 grew the panel into the Options screen (juice, controls with key
rebinding, audio, display). Everything presentation-side reads the sim and never writes it.

## Controller map

| Controller | File | Job |
|---|---|---|
| `ThemeController` | `src/client/controllers/game/ThemeController.ts` | Loads the theme pack in `onInit`; every visual comes from it (placeholder shapes + colour roles). |
| `InputController` | `.../game/InputController.ts` | Polls keyboard, mouse and the gamepad once per frame into an `InputFrame` (pure mapping: `shared/play/inputMapping.ts`). Sinks every bound key and both sticks in ContextActionService (High priority) so stock controls never act. Mouse aim: camera ray through the pointer onto the floor plane. Tracks the last-used device for the HUD hint (`game.inputDevice` in Reflex). Reports driver keys (R, F8 / L, D-pad down). Reads the player's bindings from the store (`selectBindings`) and re-binds the sink when they change (see "Options screen"). |
| `SimController` | `.../game/SimController.ts` | Owns the live run: `buildWorldSetup(world, seed, { atBossDoor })` (the server's own world registry; `endless` by default), a `LiveRun` (`shared/play/liveRun.ts`), pause, restart, F8 replay check, the ranked start (`startRun`), per-floor segments (`submitSegment`, cut on `floorChanged`) and `finishRun`, the unranked `submitRun`, verdicts, the ~10 Hz HUD snapshot. Read-only accessors for views: `getContext()` (the current floor's config / dungeon in endless runs), `getState()`, `getAlpha()`, `getFrameEvents()`, `onRunStarted(cb)`, `onFloorChanged(cb)` (endless: WorldController rebuilds, CameraController snaps). |
| `TutorialController` | `.../game/TutorialController.ts` | The first-run tutorial (docs/TUTORIAL.md; "The tutorial run" below): the first-run gate (`requestOnboarding` / `onboardingStatus`, `TUTORIAL.statusTimeoutSeconds`, `KV_Tutorial`), then per tutorial run a `TutorialDirector` updated each frame at render step 103 (`KV_Tutorial`), its view in the Reflex `tutorial` slice, `tutorialStarted` / `tutorialStep` / `tutorialLesson` / `tutorialStuck` / `tutorialFinished` and the `gate` / `outro` onboarding reports ("The tutorial run" below), callout toasts, the ghost half heart, the end (freeze, outro beat, outro) and the pause / outro / main menu actions (Restart tutorial, Skip, replay). `onFirstRunDecided(cb)` (MenuController's join flow waits for it), `getMarker()` for the world marker. |
| `PreloadController` | `.../game/PreloadController.ts` | docs/PRELOAD.md (loadOrder 1): the session's asset queue. On init `preloadPlan(pack)` (shared/view) queues the core tier, then the later tier; one worker runs `ContentProvider:PreloadAsync` in chunks (front lane first, each content id once per session); core progress to the Reflex `loading` slice; releases the loading screen on core done / Skip / timeout / `KV_SkipLoading`; `whenReleased(cb)`, `request(refs, lane)` (AudioController's run / floor audio, the boss floor's sheets). See "Preloading and the loading screen". |
| `CameraController` | `.../game/CameraController.ts` | Spike B's iso rig on the live run: Scriptable, FOV 7, yaw 45 / pitch 55, distance for 16.875 tiles of view height, damped follow (tau 1/6 s) of the interpolated player, 1-texel snap. Snaps to the player at every run start. Stands down while `KV_SpikeCamera` is on. |
| `WorldController` | `.../game/WorldController.ts` | Builds the floor: greedy-merged floor / wall / pool Parts (`shared/view/tileMerge.ts`) in the biome's `tile.biome.N.*` placeholder colours, plus one backdrop slab: the abyss, `VOID.abyssDepthTiles` (5) under the floor in the matched biome's `abyssColor` (the greybox / an unmatched theme: the `background` role; docs/VOID_DECOR.md VD3). Rebuilds only when the floor changes. When the pack has the biome floor tile as an image with `tilesPerImage`, each floor slab gets a top-face `Texture` repeating every `tilesPerImage * STUDS_PER_TILE` studs (colour stays the biome's). Each Part takes the biome's `materials` (`ThemePack.biome(id).materials.floor / wall / pool`, `Enum.Material[name]`, SmoothPlastic by default); a textured floor is always SmoothPlastic. Solid pillars are WALL tiles and merge into the wall Parts. |
| `CharacterController` | `.../game/CharacterController.ts` | Makes a spawned default character inert (root anchored locally); see "The default character". |
| `BulletRenderController` | `.../render/BulletRenderController.ts` | Both bullet simulations: one pooled Part per bullet slot, interpolated with `previousPositionAt`, ONE `workspace:BulkMoveTo` per pool per frame (spike A), parked far below when unused, pool grows lazily to the high-water mark. |
| `ActorRenderController` | `.../render/ActorRenderController.ts` | One placeholder model per occupied actor slot (archetype index -> `archetypeAt(kind).data.spriteId` -> placeholder), facing, hit flash, telegraph pulse, corpse fade, removal; the player capsule with facing pip, roll tumble, i-frame tint, hurt blink, death pose. One BulkMoveTo per frame. Sprite-backed IDs draw a `SpriteView` instead (see "Sprites replace placeholders"). Children `Enemies` (Model, one outline `Highlight`), `Corpses`, `Players` (see "Enemy outlines"). |
| `SpriteView` | `.../render/SpriteView.ts` | One pooled sprite for a theme `sprites` set: a BillboardGui + ImageLabel on an invisible feet-anchor Part (moved in the actors' BulkMoveTo). Size / StudsOffset from `spriteBillboard` (pivot pixel on the feet), `ResampleMode` from the set, `LightInfluence` 0, not AlwaysOnTop; writes Image / ImageRect only when the frame, facing or sheet changes; tint (ImageColor3), fade (ImageTransparency) and blink (Visible) only on change. Opt-in rim: a second `Outline` ImageLabel behind the frame (ZIndex 1 vs 2, `ZIndexBehavior` Sibling), written with the frame from the sheet's `outlineAssetId`; `setOutlineShown`. |
| `WeaponViewController` | `.../render/WeaponViewController.ts` | Sword swing fans + sweeping blade, finisher wind-up, guard fan, bow charge ring + aim line, heavy-arrow release ring (dashed floor markings). |
| `RunMarkerController` | `.../render/RunMarkerController.ts` | M2 (endless runs): a relic pedestal (Cylinder, `uiAccent`) on each TREASURE room's centre tile and the curse shrine's zone (flat disc, `uiMana`) in the SHRINE room; a taken pedestal / used shrine dims (`uiTextDim`). Rebuilt per floor. With the `ui.marker.pedestal` image, a camera-facing beam stands on each live pedestal (hidden once taken). |
| `BreakableRenderController` | `.../render/BreakableRenderController.ts` | Endless runs: barrels and crates from `state.breakables` (placeholder box, sprite set or image), hit blink + shake, chips, the splinter sprite effect and debris on break. See "Breakables". |
| `BoostDropRenderController` | `.../render/BoostDropRenderController.ts` | Runs with drops (docs/BOOSTS.md B6): one pooled view per ground slot under `KV_Drops` (placeholder Diamond gem in the kind's `boost.<kind>` role, a sprite set's `idle`, or an upright image billboard at the Lords of Pain scale; art bodies add a tinted floor halo, beam and glint, docs/BOOST_ART.md BA3), bob, landing pop, fade blink over the whole stack; the pickup effect (`fx.boost.collect`, else the art's glint + halo flash, else particles) and the fade's poof from the run view's `boostEvents`. See "Boost drops". |
| `BoostAuraController` | `.../render/BoostAuraController.ts` | Runs with drops: a flat tinted disc per running boost under every party member (`KV_BoostAuras`), concentric, under `BOOST_VIEW.auraMaxHeightTiles`, pulsing by motionScale. See "Boost drops". |
| `PelletRenderController` | `.../render/PelletRenderController.ts` | Pellet runs (docs/PELLETS.md PL7): from `state.pellets` and `RunView.pellets` through the pure `PelletViewTracker` (shared/view/pellets), one pooled body per untaken pellet of a live room under `KV_Pellets` (render step `KV_Pellets` after the camera): the vale art flat on the floor (0.03 studs: over floor effects, under markings and bullets, tinted by `pellet.normal` / `pellet.power`) or the placeholder Block cube; the pop-in wave, last-few pulse, the power pellet's pulse, the shrink at the clear (reduced motion: no wave or pulse, a fade). 64 normal bodies built ahead (the power one on first use), one BulkMoveTo per frame, a still pellet is not re-placed. The power pickup: `ParticleController.pelletPower` (fly-in cubes, ring) and the solo freeze. Pops are ScorePopController's third layer (0.6 of a kill pop, merged per player per frame), sounds AudioController's. `KV_PelletDebug` labels each live room `pellets <left> / <count>`. |
| `TreasureRenderController` | `.../render/TreasureRenderController.ts` | Treasure rooms (docs/TREASURE.md TR7): from `state.treasure` and `RunView.treasure` through the pure `TreasureViewTracker` (shared/view/treasure), under `KV_Treasure` (render step `KV_Treasure` after the camera): the chest on its piece's cell (closed / open art or the placeholder Block / Wedge, turned into the room; BreakableRenderController gives chest slots no view), the cage (14 placeholder bars or one art billboard; sinks at the unlock, fades under reduced motion), the tier sparkle (`decor.fx.loot`, else `decor.fx.glint`, else a Neon diamond; ducks near enemy bullets), the lock plate (floor SurfaceGui on the combo shout's construction: pips or the SWIFT countdown, at most 55 %, ducking), the crack's shards and tier line, the kept line, the wobble, the open's jolt / pop (solo 40 ms freeze, `stamp` nudge, `ParticleController.treasureBurst`, the light column) and the view player's reward cards / near-miss line (BillboardGuis). Debug `KV_TreasureLabel`. |
| `DecorController` | `.../render/DecorController.ts` | Room decoration (docs/DECOR.md R4, R10): per floor the decor plan (`planDecor` + `decorScene`, `KV_DecorBand` forces a band), drawn from the pack's `decor.*` art (pooled upright billboards on wall tops and faces, flat SurfaceGuis on the floor), tall pieces fading when a player or the boss is behind them, and the `DecorDirector` updated once per frame. See "Room decoration". |
| `DecorFxController` | `.../render/DecorFxController.ts` | Ambient life (docs/DECOR.md R9): flame loops and glows on lit torches / braziers, the 6-light pool, the fixed boss / shrine room lights, the flat boss ring and stairwell zone, the pedestal glint, the biome's ambient particle volume (a flipbook when its texture has one). See "Room decoration". |
| `VoidController` | `.../render/VoidController.ts` | The void's geometry (docs/VOID_DECOR.md VD3): per floor `planVoidCached` (input from `voidRunInput`, the same floor seed / floor / Depth / `KV_DecorBand` as DecorController's), one Part per greedy rect under `KV_Void`, each a column from the rect's top down into the backdrop slab (near-side cliff faces); shoulder in the biome's `shoulderColor` / `materials.shoulder`, ledges and outcrops in `ledgeColor` / `materials.cliff`. `KV_VoidOff` / `KV_VoidDebug`. See "Void decoration". |
| `TutorialMarkerController` | `.../render/TutorialMarkerController.ts` | Tutorial runs only: one upright beam (a Neon Cylinder in `uiAccent`; plus a camera-facing `ui.marker.tutorial` billboard if the pack has that image) on the director's marker target (next lesson door, pedestal, shrine, stairwell, the live boss, the boost drop of the `boost` step), bobbing / breathing by the juice `motionScale` (still under reduced motion), hidden without a target and once the tutorial ended. Built per tutorial run (Janitor). |
| `TutorialArrowController` | `.../render/TutorialArrowController.ts` | Tutorial runs only: the guidance arrow (docs/TUTORIAL_ARROW.md), a flat chevron on the floor `arrowOrbitTiles` from the player pointing along the walkable path to the director's marker target. shared/tutorial `TutorialGuide` decides the heading, the show rule (hidden without a target, near it, and with the target on screen (`WorldToViewportPoint`, inset `arrowScreenInset`) and a clear walk to it) and the fade; two thin Neon Parts in `uiAccent` (or a `ui.arrow.tutorial` Decal on a flat invisible Part if the pack has that image) under the markings and bullets, sliding by the juice `motionScale`. Warns once per run if the target has no path. Built per tutorial run (Janitor). |
| `RoomEdgeController` | `.../render/RoomEdgeController.ts` | Room edges (docs/ROOM_EDGES.md), every dungeon floor: a dashed line on the floor wherever a corridor (or another room) meets a room, inner edge on the room's tile edge (the `roomIdAt` trigger), on the outside. Per floor (`onRunStarted` / `onFloorChanged`, Janitor): shared/view `roomEdges` runs, one static `DashLayer` per room (`ROOM_EDGE_VIEW.dash`, SmoothPlastic, `liftStuds` 0.03, under the tutorial arrow and markings), filled once. Each frame shared/view `RoomEdgeStates` (scoring's room records; unscored M1: `buildScoreRooms` at tick 0) gives SAFE / WAITING / LIVE, `roomEdgeLook` the fade and the live pulse (juice `motionScale`), colours `ROOM_EDGE_ROLES`. Options > Display > Room edges Off takes the folder out of Workspace. Prints `[RoomEdges] built N dashes` per floor. |
| `TelegraphController` | `.../render/TelegraphController.ts` | Sniper aim lines (cut at the first intact breakable), bruiser shockwave rings (archetype `data.fx`), a ring for any other wind-up, Mother Bramble's attack previews, slam lane, roar rings and the arena seal fence. |
| `FxTrackerController` | `.../fx/FxTrackerController.ts` | Right after the sim (render step 102): the pure `HitTracker` diffs the live actors and dispatches the frame's FX events (hit, killed, spawned, capped, bossPhase, bossDefeated, reset) to the juice views and audio, with the effective juice settings. |
| `FreezeFrameController` | `.../fx/FreezeFrameController.ts` | FX events -> hitstop requests on `SimController.hitstop` (kill 50 ms, heavy / elite 80 ms, boss phase 120 ms, boss death 250 ms + slow-mo; solo: heavy hit 40 ms, a heart / lethal hurt 40 ms, docs/FEEL.md J3); clears it when the setting goes off; drains it every co-op frame (co-op never paces the sim by it); the whole-render-pixel camera nudge (`getNudge()`, read by CameraController: boss phase / death, player hurt, heavy hits; off by `screenShakeOn`). |
| `HurtFlashController` | `.../fx/HurtFlashController.ts` | docs/FEEL.md J2 / J11: a ScreenGui under the HUD with four edge Frames in `uiHealth` (UIGradient to clear at 0.18 of the short side): the hurt flash on the view player's hurt edges (`StateWatch.hurtKind`; half strength while spectating) and the low-health pulse (1 Hz; steady under reduced motion). Disabled while clear. |
| `RoomClearController` | `.../fx/RoomClearController.ts` | docs/ROOM_CLEAR.md: reads `run.roomClears` once per frame (fx.onFrame), collapses a running sequence on danger (the view player hurt, a room engaging, the stage cover, a wipe), starts the full sequence (solo, or co-op near the room) or a corner chip per clear, asks the solo slow motion (`applyRoomClearSlowMo`), the co-op last-kill hold (`ActorRenderController.holdActor`) and the spark ring (`ParticleController.roomClearBurst`), plays `sfx.room.clear` / `.perfect`, `sfx.score.tick` / `.land` and the `stamp` nudge, rolls the score (`ScoreRoller`) and writes `ROOM_CLEAR_UI` (client/ui/hud roomClearBindings.ts) for RoomClearStamp, RoomClearChips and the ScorePanel's number. Real time, stopped while paused; Room clear Off: only the mapper's jingle. |
| `HealthBarController` | `.../fx/HealthBarController.ts` | Enemy health bars: one pooled BillboardGui per actor slot (64), plate / chip / fill or pips, elite outline. |
| `DamageNumberController` | `.../fx/DamageNumberController.ts` | Damage numbers: 48 pooled BillboardGuis, merge window, heavy / capped colours, "CAP" tag, rise + fade. |
| `ComboController` | `.../fx/ComboController.ts` | docs/COMBO.md CB7: each frame steps `ComboDisplay` from `state.score` and `RunView.combo` (gated by the stage cover and run over) and writes `COMBO_UI` (ScorePanel's `ComboRow` / `ComboMeter`); the tier-up floor shout (one SurfaceGui Part, `KV_ComboShout`, under every bullet, ducking near enemy bullets); the break kick (`requestNudge("comboBreak")`); `KV_ComboDebug` forces one event (and its sound). |
| `NewBestController` | `.../fx/NewBestController.ts` | docs/NEW_BEST.md NB7-NB9: stores `records(RecordsStatus)` (asks once on start), freezes each run's `RunBaseline` (records + `SimController.pendingRunClaims`, `KV_NewBestDebug`), steps `NewBestTracker` inside RoomClearController's `scoreRoll` frame (`onShownScore`) and hands its frame to the cue mapper (`AudioController.setNewBestCues`); writes `NEW_BEST_UI` (score panel target row, gold number, touch compact line, run-over record rows), asks `ComboController.requestShout` for NEW BEST!, drops the clear jingle on the fanfare frame, draws the gold confetti (`KV_NewBestConfetti`, HUD + 1; in-run outside the clear zone and hidden under menus, full screen at run over). |
| `DraftRevealController` | `.../fx/DraftRevealController.ts` | docs/DRAFT_REVEAL.md DR6: each frame begins the local player's draft reveal once the stage cover lifts (`StageController.coverLifting()`), steps `DraftReveal` on unpaused frames, picks on the local `boon` run event and writes `DRAFT_UI` (the `DraftOverlay` cards); plays its cues through `AudioController.playCue` and its music dip through `duckFor`; drives SimController's confirm gate (`setDraftRevealDriver`: the confirm is held while the reveal plays or before it begins) and InputController's tap filter (a tap during the reveal skips). `KV_DraftRevealDebug` overrides the first cards' rarities (display only). |
| `RecapController` | `.../fx/RecapController.ts` | docs/RUN_RECAP.md RR6 / RR7 / RR9: an `FX_FRAME_PHASE.normal` frame handler (after NewBestController's `scoreRoll` step). When the run-over panel opens it builds `RunRecapInput` once (the final state, the snapshot's boss, the stairs' walking distance, `RunView.recapTally`, new best's baseline and `runOverBest`, `TeamMomentsController.totals()`), runs `nearMissFor` / `pickHighlights` and a `RecapTimeline` (real seconds, held under the stage cover), writes the store's `recap` slice and `RECAP_BINDINGS`, plays `recapCue` (one `sfx.score.tick` / `.land` a frame) and re-derives silently on a verdict with other numbers. Again / Enter / Space / FIRE go through `RunOverRetryGate` (skip before the 0.6 s arm, retry after; party runs only skip). Once per run over it sends `runRecap` (how the panel was left, seconds open, near-miss kind, record / skipped, a party run's team moments; ranked runs only). `KV_RetryTiming` prints press -> control (RR8). |
| `TeamMomentsController` | `.../fx/TeamMomentsController.ts` | docs/RUN_RECAP.md Part B (CM1 / CM2): owns the ONE `TeamMoments` (shared/view/fx): the clear half (TEAM PERFECT, its streak) in `FX_FRAME_PHASE.teamMoments` before RoomClearController's `scoreRoll`, the parry half (SYNC!) on the first `syncs()` call of a NearMissController frame (the director's `parryGroups`); `teamPerfects()` / `syncs()` for this frame, `totals()` for the recap. Party runs only. `KV_TeamMomentsDebug` fakes a team perfect or a SYNC! (never in the totals). |
| `SyncCalloutController` | `.../fx/SyncCalloutController.ts` | docs/RUN_RECAP.md CM5: a NearMissController subscriber drawing each SYNC! (`SyncCallout` timeline): `fx.parry.sync` / `.syncCount` floor text on the PARRY! flash's construction (fxHelpers `floorText`, under every bullet, <= 55 % opaque, ducking near enemy bullets) at the points' mean with one pooled Neon tether for 0.25 s, or a small text at each point when they are farther than `tetherMaxTiles`. |
| `ScorePopController` | `.../fx/ScorePopController.ts` | Scored runs (M2): a rising, fading `+points` BillboardGui per kill (`LiveRun.scorePops`, pooled `ScorePopPool`). |
| `ParticleController` | `.../fx/ParticleController.ts` | Death bursts, boss waves, roar sparks, hit sparks, breakable chips, boost pickup / fade bursts: pooled 1-3 px Parts, one BulkMoveTo per frame, particle budget. |
| `FxSpriteController` | `.../fx/FxSpriteController.ts` | Sprite effects (docs/FX_AUDIO.md F3 / F4): the pure `FxCueMapper` turns each frame's FX events, summed sim events and state into one-shot cues (hit marks, swing trails, the guard shield, roll dust, flask, Ember ring, boss phase / slam / death, relic, shrine, death puffs, breakable splinters, boost pickups) and the stairwell loop; pooled floor-flat SurfaceGuis (or billboards) flip through the theme's `fx.*` flipbooks on the hitstop clock, budgeted by the particle level. Builds nothing without `fx.*` art (today). See "Sprite effects". |
| `AudioController` | `.../audio/AudioController.ts` | Theme sounds for sim events, music and ambience through the `sfx` / `music` SoundGroups (all silent today): per-frame cue mapping with a priority cap and one jingle per frame, co-op split, variants and pitch jitter, music ducking, the ambience bed, menu / lobby / tutorial music, preload, menu sounds; the player's volumes scale the groups. Treasure rooms (docs/TREASURE.md TR8): its own `TreasureCueTracker` gives the mapper the vault look's edges (crack, the bars' sink, the lid's pop). See "Audio". |
| `SettingsController` | `.../ui/SettingsController.ts` | The player's settings (juice, controls, audio, display): server sync (request / update / reset / settingsChanged), the system Reduce Motion flag, `KV_ResetBindings`, O toggles the Options screen, B closes a prompt on it or the screen, the screen pauses the run. |
| `RebindController` | `.../ui/RebindController.ts` | The Options screen's rebinding: capture (countdown, cancel, owns the input), swap prompt, refusal notes, Clear, Reset device, the input test strip. |
| `HudController` | `.../ui/HudController.tsx` | Mounts `GameHud` (React + Reflex; two ScreenGuis through a portal) and the menu shell `MenuLayer` (client/ui/menu, its own ScreenGui) with the HUD and menu actions, switches gamepad navigation on while a menu is open (menu screens, pause / party overlay, run-over panel, panels), hides the stock Health / Backpack CoreGui. |
| `HudOcclusionController` | `.../ui/HudOcclusionController.ts` | docs/HUD_LAYOUT.md H7: render step after the camera; every `HUD_OCCLUSION.everyFrames` frames projects the watched player, living actors and up to `maxBullets` enemy bullets with `Camera:WorldToScreenPoint` (GUI space, the same space as `AbsolutePosition`) and tests them against the mounted corner panels (client/ui/hud `cornerFade` registry); one `OcclusionFader` per corner writes the corner's `GroupTransparency` binding (the corner `Panel` is a CanvasGroup inside a transparent placed frame; no React re-render). Options > Display > HUD fade Off or no run: opaque, no work. Under `KV_Debug` it also warns once per panel per run when an always-on panel outgrows its `HUD_FOOTPRINT` box (H1). Read only on the sim. |
| `LoadingController` | `.../ui/LoadingController.tsx` | Mounts `LoadingScreen` (client/ui/loading, its own ScreenGui, display order 30) on join until PreloadController releases; Skip plays `sfx.ui.click`. See "Preloading and the loading screen". |
| `StageController` | `.../game/StageController.tsx` | docs/STAGE_LOADER.md (loadOrder 2, `sim.setStageDriver`): the stage loader. Covers run starts and floor changes (`StageCard`, bindings so the cover draws in the event frame), drives SimController's deferred work one item per frame (forge, listeners, floor pre-gen), holds a solo run start, waits for the floor's assets (`PreloadController.whenLoaded`, 3 s cap), pre-generates floor n + 1 during floor n's draft. See "Stage loader". |
| `MinimapController` | `.../ui/MinimapController.ts` | docs/MINIMAP.md M8 / M9, every dungeon floor (not the greybox): per floor `minimapTiles` (endless stairwell), a fresh `FogOfWar` (`seedFromState` at tick > 0), `RoomEdgeStates`, a painted RGBA8 buffer and ONE `EditableImage` (`AssetService:CreateEditableImage`, pcall; failure warns once, no map), destroyed with the floor. Render step `KV_Minimap` after the camera: fog from the living players' interpolated positions, room tints (`roomEdge.*`), dirty cells repainted and uploaded (`WritePixelsBuffer`, at most `MINIMAP_VIEW.writeHz`). Draws a map layer (ImageLabel on the shared image, `Pixelated`, turned by the camera yaw, plus pooled upright Frame markers: self arrow, teammates by index in `class.*`, enemies / bosses / boost drops in sight, the stairwell once seen, treasure / shrine marks, the vault's chest once revealed: docs/TREASURE.md TR8 `vaultMarkStyle`, the tier's floor colour, a ring once opened) into each mounted host of `client/ui/hud/minimapHosts` (the corner `MinimapPanel`, whose CanvasGroup clips it; `FullMapOverlay`; the solo `PauseMap`). `InputController.onMapAction` toggles Reflex `game.map.open`; closes on floor change and run over. Prints `[Minimap] W x H map` per floor. |
| `TreasureToastController` | `.../ui/TreasureToastController.ts` | Treasure rooms (docs/TREASURE.md TR8): render step `KV_TreasureToasts` after the FX tracker; the pure `VaultToastTracker` (shared/view/treasure) pushes ToastPanel lines: the floor reveal's `hud.toast.vault` (2 s, once per floor, once the stage cover is gone, no draft open and not paused; only while the vault is sealed) and one arm toast per lock as its room engages (`hud.toast.vaultLock.*`, 2.5 s: solo UNTOUCHED, the party's allowance, the SWIFT countdown). Ids from `TREASURE_VIEW.toast.idBase` down. Never in the tutorial or after run over. |
| `MenuController` | `.../ui/MenuController.ts` | L3 / L6: the main menu on join, once the first-run gate decided against the tutorial (a first-time player goes straight into it instead; no run starts on its own; `KV_SkipMenu` starts one at once), the screen + back stack (Reflex `menu`; pad B / Backspace go back), Play solo / Lobbies / Tutorial / Options / Leaderboard, the menu after a run (the lobby room while in a lobby, else the main menu), the co-op party overlay (the pause key in a party run) and Leave run. See "Main menu, lobbies and Leave run". |
| `LobbyController` | `.../ui/LobbyController.ts` | L5: the lobby remotes into the Reflex `lobby` slice (list, my lobby, invites, notice toasts, the players in this server), the lobby requests, and `lobbyRunStart` (a one-player lobby's ranked solo run). I5 (docs/INVITES.md): `invitePrompt`, `inviteEligibility` (start + menu open when stale) -> `inviteEligible`, `joinIntent` into the slice, `invitePromptOnClient` (the client prompt path; the options kept until the local prompt closes or `INVITE.promptOptionsSeconds`) and the local `GameInvitePromptClosed` relayed as `inviteRecipients`. |

Pure, headlessly tested logic: `src/shared/play/` (input mapping, live loop, HUD snapshot), `src/shared/view/`
(iso camera, studs <-> sim units, aim ray, greedy tile merge, marking geometry, dash layout, presentation tunables),
`src/shared/view/fx/` (hit tracker, juice rules, hitstop clock, freeze rules, bar layout / state, damage number pool,
particle system), `src/shared/view/audio/` (event -> sound mapping, music choice), `src/shared/view/boosts/` (boost
drops: the frame's drop events, slot diff, bob / pop / blink, aura discs, HUD entries) and `src/shared/view/hud/` (font
token, layout sizes, UIScale rule, HUD helpers, every HUD string key).

## Sprites replace placeholders (docs/ART.md S4)

Per logical ID, at the time a view is built: if `pack.sprites(id)` returns a set (and, for actors, the archetype is in
`shared/view` `ACTOR_SPRITE_INPUTS`: the swarmer, the sniper, the tutorial's `turret.sniper` and the Demon Lord),
`ActorRenderController` draws a `SpriteView`; otherwise the placeholder model, exactly as before. With the placeholder
pack every ID takes the placeholder path. The bruiser, the other turrets and Mother Bramble stay placeholders until they
get art and an input builder.

All sprite logic is pure and specced in `src/shared/view/sprites.ts`:

- **Facing:** `spriteFacing` projects the sim's ground facing (the roll direction while rolling) through the camera
  basis (yaw 45, pitch 55) to the true on-screen angle and picks the nearest of the set's 4 / 8 / 16 facings.
- **Animation:** `choosePlayerAnim` (death > roll > attack.1/2/3 > hit > run > idle) and `chooseActorAnim` (death >
  attack > hit > move > idle) from sim fields (`playerSpriteInput`, `swarmerSpriteInput`, `sniperSpriteInput`: the line telegraph is its attack;
  `turretSpriteInputOf`: never attacks or moves, a respawned turret is live again). One-shots are stretched over
  the gameplay timers (roll, sword recovery / finisher wind-up, hurt, hit flash, corpse); loops run on a per-view
  `SpriteClock` at the set's fps, run / move scaled by speed / walk speed. The clock steps by sim time (`animDtSec`),
  so it stops while paused and follows hitstop. The bow and the guard have no knight animation (idle / run).
- **Depth:** the billboard sits toward the camera by (cell height below the pivot) x cot(pitch) + a margin, so the part
  of the cell under the feet (the baked shadow) is not hidden by the floor; `SPRITE_VIEW.depthBiasStuds` adds to it.
- **Hit:** a 1-frame `hit` (the skeleton's stand-in) does not interrupt move / idle; the tint shows the hit. A
  multi-frame hit plays over the flash. Sword swings use each player's own timings (`swordTimingOf`: Swift Strikes).
- **Juice:** the same rules as the placeholders (`actorLook`, `playerLook`, `playerBlinkVisible`,
  `corpseTransparency`, roles in `ACTOR_VIEW.lookRoles`): hit flash, telegraph pulse and i-frames tint `ImageColor3`
  (it multiplies, so a tint, never a white flash), the corpse fades `ImageTransparency`, the post-hit blink toggles
  `Visible`. A dead player plays the death animation untinted (the capsule greys out instead).
- **Ring:** with a player sprite set and the `ui.ring.player` image, each player gets the ring (a Decal on a flat
  invisible Part turned by the camera yaw, sized by `floorImageSize` from the set's `pixelsPerTile`, depth stretched by
  1 / sin(pitch) so it shows at its authored aspect), tinted `uiAccent` for the local player and `uiTextDim` for
  teammates (`SPRITE_VIEW.ring*Role`), placed by the image's pivot (`ThemePack.image(id).pivot`); it replaces the facing
  pip. Without it the pip stays. The pedestal beam stands on its pivot (the image's own, else its bottom centre).
- **Floor texture:** each merged floor slab's Texture is offset by the slab's world corner (`floorTextureOffsets`) so
  the pattern is continuous; only on a floor whose biome matched (the greybox keeps the plain `floor` role).
- Tunables: `SPRITE_VIEW` (depth bias, reference speeds, loop rate clamp, hit / death stretch, anchor and ring sizes),
  `PROGRESSION_VIEW.pedestalBeamHeightTiles`.

### Boss sprites (docs/BOSS_DEMONLORD.md D6)

The Demon Lord (`boss.demonlord`) is the first boss drawn as a sprite (Mother Bramble has no art). His set draws once
the vale pack has ids for its required sheets (idle, move, attack, death; `hit` = idle frame 0); `attack.2`, `intro`
and `taunt` join when uploaded. `chooseActorAnim` adds two choices for him: a named attack (`ActorAttack.anim`,
falling back to `attack`) and a special (`ActorSpecial`: intro / taunt / summon, skipped when the set lacks it), in the
order death > special > attack > hit > move > idle; `demonlordSpriteInput` maps his states (table in
docs/BOSS_DEMONLORD.md D6, names in `SPRITE_VIEW.demonlordAnims`), every one-shot stretched over the sim timer that
drives it. A boss sprite is drawn at least `ACTOR_VIEW.bossMinDrawPx` wide (`bossSpriteLayout`), its corpse fades
only after its death animation (`SPRITE_VIEW.bossDeathCorpseFraction` / `bossCorpseFadeFrom`), and its outline sheet
draws like every enemy's. Telegraph previews: `TelegraphController.drawBoss` draws the seal and the roar for any boss,
then Mother Bramble's (`render/bossAct1.ts`) or the Demon Lord's previews (`render/demonlord.ts`, builders in
`shared/view/markings.ts`: cleave lanes to their reach, the 3-gap hellfire ring, the charge lane + shockwave, the
adds' landing spots).

## Enemy outlines (docs/OUTLINE.md)

Every live enemy and boss gets a rim in the theme's `enemyOutline` colour; corpses, decor and breakables never do
(the watched player gets its own rim, see "Player outline"). The rule is `shared/view` `actorOutlined(hasOutline, alive, enabled)` (`hasOutline` = the actor's
placeholder visual has an `outline` role); names and Highlight settings are `ACTOR_OUTLINE` (`shared/view/outline.ts`).

- **Placeholders:** `KV_Actors` holds `Enemies` (a Model), `Corpses` and `Players` (Folders). One `Highlight`
  (`EnemyOutline`: fill transparency 1, outline transparency 0, DepthMode Occluded) adorns `Enemies`, so it outlines
  every live placeholder enemy at the cost of one Highlight. A model is reparented only when its group changes: to
  `Corpses` at death and on release (pooled models wait there), back to `Enemies` when reused. Overlapping enemies
  share one silhouette.
- **Sprites:** sheets built with an `outline` entry in `art/atlases.json` have a `<sheet>-outline.png` (white rim,
  same cell grid); `vale/manifest.ts` maps it to the sheet's `outlineAssetId` when its id is uploaded, and frames
  carry `outlineImage`. Enemy `SpriteView`s draw it tinted `enemyOutline` behind the frame; the rim hides at death
  (the corpse fades without it). A sheet without an uploaded outline draws rimless. Sprite anchors stay directly in
  `KV_Actors`, outside the Highlight.
- **Switch:** Workspace `KV_EnemyOutline` (see the attribute table) toggles the Highlight and every sprite rim at once.

## Player outline (docs/PLAYER_OUTLINE.md)

The watched player (the local player, or the teammate a dead player spectates) gets a rim in the theme's
`playerOutline` colour (`#f4f1ea`, the minimap's "you"), alive only, while Options > Display > Player outline and
Workspace `KV_PlayerOutline` are on. The rule is `shared/view` `playerOutlined(isView, dead, settingOn, switchOn)`;
names and Highlight settings are `PLAYER_OUTLINE`.

- **Sprites:** the knight's `vanguard-*-outline.png` sheets (1 px, `clipAtCellEdge`), drawn by every player's
  `SpriteView` behind the frame, shown only on the watched player. Afterimages stay rimless.
- **Placeholders:** the capsule moves into `KV_Actors/Players/Outlined` (a Model with ONE `PlayerOutline` Highlight,
  Occluded) while outlined; the Highlight is off while the capsule blinks out.

## Breakables (docs/DECOR.md D4, R13)

`BreakableRenderController` (`src/client/controllers/render/`, render step `KV_Breakables` at Camera + 2) draws the
endless floors' barrels and crates. Pure logic and tunables: `src/shared/view/breakables.ts` (spec next to it) and
`BREAKABLE_VIEW` in `src/shared/view/breakablesConfig.ts`.

- **What it reads, each frame:** `getContext().run.state.breakables` (no state: nothing drawn), the tick and alpha.
  `BreakableTracker` diffs every piece's `hp` / `brokenTick` against its copy from the last frame, so a frame that
  ran several ticks loses nothing (the sim's `hitSlots` / `brokenSlots` keep only the last tick and are not read). A
  new layout (first frame, `onRunStarted`, `onFloorChanged`, the tick going back on a restart, a different piece list)
  rebuilds every view without effects; a piece already broken shows its debris. `onRunExited` / no run parks
  everything and drops the floor's debris (floor Janitor).
- **Intact:** per kind, what `pack.breakable(kind)` has: a sprite set's `idle` (a `SpriteView`), an image billboard,
  or the placeholder box in the kind's colour role. Nothing is drawn taller than `maxHeightTiles` (5/8 tile): the box
  height is capped (`breakableBoxStuds`), art is scaled down (`breakableArtLayout`). Bodies are pooled per kind across
  floors; static pieces are placed once, all moves go in one BulkMoveTo.
- **Hit:** a blink in `flashRole` (`hitBlinkSec`, `blinkPeriodSec`) and a decaying shake along the screen's x axis
  (`shakeSec`, `shakeStuds`, `shakeHz`) x the juice `motionScale` (none under reduced motion), on sim time; the juice
  layer's hit sparks at the piece (`ParticleController.breakableHitSparks`), which is the spark a bullet stopped by a
  crate ends in (at the piece's centre: the sim does not say which bullet stopped where).
- **Break:** chips (`ParticleController.breakableChips` -> `DeathParticleSystem.chips`, `chips` per kind, in the
  `breakable.<kind>` role, scaled by the particle level), the splinter sprite effect
  (`FxSpriteController.breakableSplinter(x, z)`: `fx.breakable.splinter` on the next frame, at most
  `FX_SPRITE_VIEW.splinterQueue` queued; nothing without fx art), the set's one-shot `shatter` if it has one, then the flat
  debris decal: the floor biome's decor `brokenBarrel` / `brokenCrate`, a variant by cell hash (`debrisVariant`), laid
  as a top-face SurfaceGui on a thin invisible Part turned by the camera yaw (nothing when the pack has none).
- **Sounds:** `AudioController` maps the frame's summed `breakablesBroken` / `breakableHits` (table under "Audio").
- **Sniper aim line:** `TelegraphController` cuts it where it first enters an intact piece's cell
  (`clipToSolidCells` over `solidCells(state)`), where its bullet will stop; sight is not blocked (B2).

## Boost drops (docs/BOOSTS.md B6 / B7)

Runs with `SimConfig.drops` (none set it until B4 / B9; `KV_Debug` + Semicolon drops one anywhere drops are on; M until docs/MINIMAP.md MD11). Pure half in
`src/shared/view/boosts/` (tunables `BOOST_VIEW`), headless specs `boosts.spec.ts` and `art.spec.ts`; nothing here
writes the sim.

- **Events:** the sim's `DropsEvents` are per tick and cleared every tick, so `LiveRun` / `LockstepClient` collect
  them after every tick into `boostEvents` (`BoostFrameEvents`: `dropped` with kind and position, `collected`,
  `expired`, `ended`, `aegisBroke`), reset at the start of every frame, like `frameEvents`. `collectRunEvents` adds
  the local player's pickups to `runEvents` (`kind: "boost"`), which SimController turns into toasts
  (`toastFor("boost", kind)`: `hud.toast.boost` with `{name}` / `{desc}` from `boost.<kind>.name` / `.desc`).
- **Drops** (`BoostDropRenderController`, render step `KV_Drops` at Camera + 2, folder `KV_Drops`): `DropSlotTracker`
  diffs the ground slots (kind + landing tick) every frame; a new drop gets a pooled body per kind: the placeholder
  gem (the new `Diamond` case of `buildPlaceholder`, placeholders.ts: a cube stood on a corner, as wide and tall as the
  smaller of the visual's width and height), a sprite set's `idle`, or an upright image billboard, art capped at
  `BOOST_VIEW.maxHeightTiles` (5/8 tile). Each frame from state: bob (`dropBobStuds`, x motionScale), the landing pop
  (`dropPopScale`, placeholder and image paths), the fade blink in the last 2 s of `ticksLeft`
  (`boostBlinkTransparency`; steady dim under reduced motion). Pickups: `fx.boost.collect` when the pack has it
  (FxSpriteController), else the art's pickup flash (below) for a kind with art, else `ParticleController.boostBurst`
  in the kind's colour; a fade: a small poof.
- **Drop art layers** (docs/BOOST_ART.md BA3; pure half `shared/view/boosts/art.ts`, spec `art.spec.ts`). Only for a
  kind whose `boost.<kind>` is art (image or sprites); the placeholder gem is unchanged. An image prop is drawn at
  `BOOST_VIEW.artPixelsPerTile` (29.6, the Lords of Pain scale: a 13 px gem ~0.44 tiles wide) and never taller than
  `maxHeightTiles` in all (`boostImageLayout`: the 25 px coin scatter draws 0.625 tiles tall). Bottom to top, pooled,
  parked and released with the body:
  - **halo**: `ThemePack.decor(decorFxId("glow"))` (`decor.fx.glow`) laid flat (decorParts `buildFloorArt`, a top-face
    SurfaceGui, LightInfluence 0) under the drop, `ImageColor3` = the kind's role (`ThemePack.boost(kind).color`),
    `haloTiles` (1.2) across, `haloTransparency` (0.35) + `haloPulse` (0.2) x the bob's phase (`dropBobPhase`; none
    under reduced motion). Its top at `haloLiftStuds` (0.08): over the decor flats (0.06) and floor effects
    (0.06-0.076), under every marking (0.16) and bullet. No glow art: a Neon Cylinder disc in the role
    (`haloFallbackTransparency` 0.55), the aura's look. It does not bob.
  - **prop**: the billboard (bob, pop, blink as before).
  - **beam**: `ThemePack.image(BOOST_BEAM_IMAGE_ID)` (`ui.marker.boost`, the white loot indicator) built like the
    pedestal beam (RunMarkerController: `uprightImageBillboard`, own anchor on the drop's base), tinted by the role,
    `beamHeightTiles` (1.4; the spec keeps it under half `PROGRESSION_VIEW.pedestalBeamHeightTiles`),
    `beamTransparency` (0.3). Not bobbing. No image (not uploaded / placeholder): no beam.
  - **glint**: `ThemePack.decor(decorFxId("glint"))` (`decor.fx.glint`) as a second BillboardGui on the prop's anchor,
    centred on the prop's centre, `glintScale` (0.7) x its own size, `glintDepthStuds` (0.1) in front of it, scaled
    with the pop; its loop on drop age with a phase per slot (`boostGlintFrame`: slot x `glintSlotPhaseFrames`);
    `glintStillFrame` under reduced motion. Untinted.
  - **blink**: every layer's own transparency is combined with the drop's blink (`boostLayerTransparency`: the
    opacities multiply), so the stack blinks and dims together.
  - **pickup flash** (BA-P4, when the pack has no `fx.boost.collect`): at the pickup point, the halo in the kind's
    role from `pickupHaloFromTransparency` (0.1) to gone over `pickupFlashSeconds` (0.35), growing to
    `pickupHaloGrow` (1.8x; no growth under reduced motion), and the glint played once from frame 0 at
    `pickupGlintScale` (2x the drop's glint; reduced motion: the still frame, fading with the halo). On sim time
    (holds in pause); pooled; a new run / floor / exit parks every flash.
- **Aura** (`BoostAuraController`, `KV_BoostAuras`): per party member, one Neon disc per running boost in its colour,
  the first running kind innermost and on top (`auraDisc`), the stack under `auraMaxHeightTiles` (0.1 tile, under the
  bullets' plane), transparency pulsing by motionScale. The optional `fx.boost.aura.<kind>` effects are not drawn yet
  (no pack has them).
- **HUD:** `BoostRow` in the StatusPanel (above the floor line) and the Aegis pip in the armor row; see the HUD table.
  The tutorial's ring: GameHud passes `boostsHighlight={isBoostsHighlight(highlight)}` (shared/view/boosts, id
  `BOOST_VIEW.hudHighlight` = `"boosts"`), so the tutorial only has to emit that highlight id.
- **Audio:** the cue table under "Audio" (`AudioCueMapper.frame(..., boostEvents)`).
- **Boosts from breakables** (docs/BREAKABLE_DROPS.md BL6): `BreakableRenderController` puts the `decor.fx.glint`
  sparkle on every intact piece with `breakableLootAt(state, slot) !== NO_BOOST` (pooled anchors, `syncLoot` every
  frame, phase per cell, sim time, hidden near enemy bullets but not goo, cleared the frame it breaks and on a new
  layout; reduced motion: still). `BoostDropRenderController` hops a drop in from the piece's top when its slot and
  landing tick match `boostEvents.fromPiece`, and `ParticleController.lootFizzle` marks `lostLoot`. Shared glint parts
  in `render/glintParts.ts`. Debug: Workspace boolean `KV_LootDebug` (Studio or KV_Debug, off by default) labels each
  loaded piece with its kind. Sound `sfx.breakable.loot` (falls back to `sfx.boost.drop`).

## Room decoration (docs/DECOR.md R4, R9, R10)

Pure logic in `src/shared/view/decor/` (specs next to it): the plan (`decorPlan.ts`, R3 / R6 / R8), the floor's scene
(`scene.ts`: plan + boss ring + stairwell + shrine + pedestals), the director (`director.ts`), the light pool and
flicker (`lights.ts`) and renderer helpers (`render.ts`). Tunables: `DECOR_REACT` (`reactConfig.ts`, the director),
`DECOR_VIEW` / `DECOR_LIGHTS` / `DECOR_FX` / `DECOR_RENDER_ORDER` (`fxConfig.ts`, the client). Presentation only:
nothing here writes the sim.

- **Per floor** (`DecorController`, on run start and every floor change, and when `KV_DecorBand` changes):
  `decorInputOfLayout(layout, depth)` (M1: the bare dungeon) + `decorProfile` (`KV_DecorBand` forces a band) +
  `planDecor` with the pack's variant counts -> `decorScene`. Output: `[Decor] floor N (band, biome): plan E (flat,
  low, tall, wall), drawn D (~I instances), T ms`. An entry is drawn only when the pack has art for its kind
  (`pack.decorVariants(biome, kind)`, the variant by the plan's cell hash).
- **Pieces**: tall / low on the wall top and wall pieces as pooled upright billboards (a sprite set: `SpriteView`,
  facing from `decorFacingDir`, grid pieces along their wall's normal, round ones by hash; an image: `ArtBillboard`),
  the floor clearance from `spriteBillboard`; wall pieces pushed `WALL_DEPTH_BIAS` (0.6 tiles) toward the camera off
  the face. Flat pieces: a top-face SurfaceGui on a thin invisible floor Part (`buildFloorArt`). A brazier sprite set
  with `lit` plays it once lit; the used shrine's crystal dims (`DECOR_VIEW.dimBrightness`).
- **Fade**: `selectDecorFades` with every living player and the live boss (`decorFadeBodies`): a tall piece hiding
  one fades to `DECOR_VIEW.fadeTransparency` (0.75) over `fadeSeconds` (0.15 s).
- **Director** (`DecorDirector.update`, in `KV_Decor` before the pieces; not while paused, in a frozen tutorial, or
  with a draft open, which it also checks itself): reads `state.endless` (roomsEntered, stairsOpen), `state.score`
  rooms (engaged / cleared), the live boss (phase), `state.run` (shrine, pedestals), every player (sweep origin,
  Embers, all down) and `frameEvents.emberUsed`; returns the reused `DecorView` (per entry lit / flare / flame / dim,
  per room entered / engaged / cleared, ring, stairGlow, shrineDim, glint, gutter, cold). Trigger table: rooms not
  entered dark; first entry lights the room's torches in a sweep from the entering player (`igniteStepSeconds` 0.08
  apart); engaged rooms' flames x1.35; a clear lights the room's braziers with a flare; a boss floor's boss room stays
  dark until the boss is engaged and its **flat boss ring** lights a third per phase, all after the kill (steady);
  the open stairwell glows; a taken pedestal's glint and the used shrine dim; an Ember gutters every flame (0.3 s); a
  wiped run fades to the cold palette (`DECOR_LIGHTS.coldRole`). Reduced motion: no sweep (all at once), no flare,
  no gutter, no taller flames, no flicker. Robust to multi-tick frames (state diffs), floor changes, restarts and
  co-op (it reads the shared state).
- **The boss ring** is flat by design: the decor plan moves the Forge's ring braziers onto far walls under the
  footprint rule and most lose their spot, so the ring is drawn as floor-level fire pits at the Forge's brazier spots
  (`decorBossRing`): `decor.fx.glow` laid flat (`ringGlowTiles`) plus a PointLight, never a standing sprite, so nothing
  in the arena can hide a bullet.
- **Lights** (`DecorFxController`, `KV_DecorFx` right after): `DECOR_LIGHTS.pool` (6) PointLights shared by the lit
  torches / braziers nearest the camera focus (`DecorLightPool`, reassigned every 0.25 s with 0.3 s fades), seeded
  flicker (`decorFlicker`, x motionScale), x the band's light, flare / gutter / cold; no shadows, brightness capped
  (`maxBrightness`). Fixed lights outside the pool: up to 3 over the boss ring + 1 on the open stairwell, and 2 in the
  shrine room (nearest the shrine, dimmed once used). Colour `decor.fx.flame`.
- **Flames and fx**: `decor.fx.torch` (wall torches) / `decor.fx.flame` (braziers) loops at each lit piece's glow point
  when its art has `glow`, with `decor.fx.glow` behind, a per-piece phase (`decorLoopFrame`), animated within
  `flameAnimateRadiusTiles` (24) of the focus; `decor.fx.zone` flat on the open stairwell; `decor.fx.glint` over live
  pedestals.
- **Ambient particles**: one ParticleEmitter volume (30 x 3 x 30 tiles) following the camera focus, the biome's
  `pack.ambient(biome)` texture / size / transparency / colour; rate from `ambientEmitterSpec` (the Forge theme's
  particle count x the band's light x the juice particle level share, 0 under reduced motion, at most
  `DECOR_FX.maxParticles` = 150 alive); TimeScale 0 while paused. A texture with a theme `flipbook` (`particle.flipbook`
  `{ grid, fps, mode }`, docs/FX_AUDIO.md F6; vale's `decor.fx.ambient.b<n>` from `art:build`) plays it per particle:
  `FlipbookLayout` Grid2x2 / Grid4x4 / Grid8x8 by `grid` (another grid: no flipbook), `FlipbookMode` = `mode`,
  `FlipbookFramerate` = `fps`, a random start frame unless `OneShot`.
- **What draws today**: the placeholder and `vale` packs have no `decor.*` art and no ambient textures, so no piece,
  flame, glow, zone, glint or particle is drawn; the **PointLights do** (they need no art): pool lights on lit torches
  (sweeping on as rooms are entered), the boss ring / stairwell / shrine lights. Under Studio's default bright
  Lighting they are faint. Everything else appears as R5 pastes the Lords of Pain ids.
- **Budgets** (seed 1337, floors 1-10, `decorFx.spec.ts` prints them): ~233 plan entries per floor (151-337; ~60 %
  flat, ~28 % wall, ~11 % tall / low), ~58 lit lights, 6 ring pits. Every drawn piece is 3 instances (anchor or floor
  Part + Gui + ImageLabel), a lit light with flame and glow art 6 more: ~1,050 instances per floor if every kind had
  art (Lords of Pain covers about half the kinds), plus 6 pool + at most 6 fixed PointLights and 1 emitter. Standing
  bodies are pooled across floors; flat parts and fx are rebuilt per floor (Janitor).
- **Debug** (`KV_DecorDebug`): the fade boxes (neon outlines in their billboard planes), each standing piece's
  footprint stencil (cells at bullet height its art could hide: all must be walls) and the breakable cells.

## Void decoration (docs/VOID_DECOR.md VD3, VD8, VD9)

Pure logic in `src/shared/view/voidDecor/` (specs next to it): the planner (`planVoid` / `planVoidCached`, VD2), the
client's columns (`parts.ts`: `voidRunInput`, `voidColumnOf`, `voidLayerStyle`) and tunables `VOID` / `VOID_DEPTH`
(`config.ts`) and `VOID_VIEW` (`viewConfig.ts`). Presentation only: nothing here writes the sim, collision or the
minimap; VOID cells stay VOID.

- **Per floor** (`VoidController`, on run start and every floor change, inside the listeners so behind the stage cover
  like the world and decor builds, and when `KV_DecorBand` / `KV_VoidOff` / `KV_VoidDebug` change): `voidRunInput(dungeon,
  layout, depth, KV_DecorBand)` (an endless floor's layout seed / floor and the run's Depth, else the bare dungeon; the
  input DecorController's `decorInputOfLayout` + `decorProfile` makes, so both read ONE cached plan) ->
  `planVoidCached` -> one anchored, collision / query / touch-free Part per rect (`renderPart`, shadows like the
  walls). Skipped when the Dungeon, floor seed, band and debug attributes are unchanged. Output: `[Void] built P parts
  (floor F, band, biome.N: shoulder S / ledge L / outcrop O), plan X ms, T ms`.
- **Columns**: each rect's Part runs from its top (shoulder `VOID.shoulderTopTiles` 0.85, ledge 0.35 tiles; walls are 1)
  down to the abyss plane and `VOID_VIEW.columnSinkTiles` (half the backdrop slab) into the backdrop, so the +X / +Z
  cliff faces drop straight into the abyss with no seam and nothing pokes out under the slab. The shoulder top sits
  below the wall top (no z-fight); void columns touch walls side-on only.
- **Look**: shoulder in the biome's `shoulderColor` and `materials.shoulder`; ledges and outcrops in `ledgeColor`
  (`voidLedgeColor`, what `voidReport` validates) and `materials.cliff`; SmoothPlastic where the pack names none. The
  biome is matched like WorldController's (`themeKey` -> `BIOMES` `forgeTheme`); an unmatched theme (none today) gets
  no void. The backdrop (WorldController) is the abyss: `VOID.abyssDepthTiles` under the floor in `abyssColor`.
- **Abyss motes** (DecorFxController, VD8): a second emitter volume with the biome's ambient look, centred
  `DECOR_FX.abyssMoteLiftTiles` above the abyss plane under the camera focus; `abyssMoteSpec` = `abyssMoteShare` (0.3)
  of the ambient emitter's live count (same band light, particle level and motionScale scaling: none under Reduced
  motion) drifting by `abyssMoteMotion`. Under the floor plane, so floor / wall / void Parts hide every mote not over
  open abyss and none can draw over a bullet (a spec checks the highest climb stays under the floor). Off with
  `KV_VoidOff`. Like the ambient motes, nothing draws without a `decor.fx.ambient.b<n>` texture.
- **Budget**: ~290 Parts per floor on average, at most ~470 (VD2 census; `VOID.maxRects` 500). Static, no per-frame
  work. Preload: built-in materials only, no content ids.
- **Debug**: `KV_VoidOff` (no void Parts, no abyss motes), `KV_VoidDebug` (flat per-layer tints).

## Data flow per rendered frame

BindToRenderStep priorities (`shared/view` `RENDER_ORDER`):

1. **Input + 1 (101) `KV_Sim`** (SimController): apply a pending restart / replay check (tick boundary) ->
   `InputController.sample(player.x, player.z)` polls devices ONCE -> `LiveRun.frame(dt, input, hitstop)`: the PAUSE
   edge toggles pause; otherwise the hitstop clock turns the real delta into the sim delta (a frozen frame stops here)
   and `FixedStepLoop.advance` runs 0..5 ticks, each `recorder.record(input)` then `step(state, input, config)`,
   telemetry observes, per-frame event totals accumulate -> alpha. If the run just ended (death / boss defeated) it is
   submitted. Every 0.1 s (and at once on a pause toggle) a `GameSnapshot` goes to Reflex (only if it changed).
2. **Input + 2 (102) `KV_FxTracker`** (FxTrackerController): the hit tracker diffs the actors -> FX events -> the
   freeze rules (hitstop requests for the NEXT frame), bars, numbers, particles; then audio maps the frame's events to
   sounds.
   **Input + 3 (103) `KV_Tutorial`** (TutorialController, `RENDER_ORDER.tutorialAfterFx`): on join, until it decided,
   the first-run gate; in a tutorial run (not paused, not frozen) `TutorialDirector.update` with the state, the run's
   config, `LiveRun.frameEvents`, the frame's sampled buttons and dt -> the `tutorial` slice (on a revision change),
   `tutorialStep` per new funnel step, callout toasts, the ghost heart.
3. **Camera + 1 (201) `KV_GameCamera`**: follows the interpolated player (+ the freeze-frame nudge).
4. **Camera + 2 (202)** `KV_Bullets`, `KV_Actors`, `KV_Weapons`, `KV_Telegraphs`, `KV_HealthBars`,
   `KV_DamageNumbers`, `KV_Particles`, `KV_FxSprites` (FxSpriteController: the cue mapper, then the pooled effects),
   `KV_Breakables`, `KV_Drops`, `KV_BoostAuras`, `KV_Decor` (DecorController: the DecorDirector update, then
   the pieces and fades; `DECOR_RENDER_ORDER.decorAfterCamera`): read `getState()` / `getAlpha()`, move pooled Parts /
   BillboardGuis. They never write the sim.
   **Camera + 3 (203) `KV_DecorFx`** (DecorFxController, `DECOR_RENDER_ORDER.decorFxAfterDecor`): flames, the light
   pool, fixed lights and particles from this frame's DecorView.
5. React re-renders the HUD from Reflex when the snapshot changed (at most ~10 Hz).

Mouse aim uses the previous frame's camera (the web build does the same).

## Controls

| Input | Keyboard / mouse | Gamepad | Web build | Touch |
|---|---|---|---|---|
| Move (screen-relative) | WASD (arrows too) | Left stick | WASD / left stick | Move stick (left side, floating) |
| Aim | Mouse | Right stick | same | Drag Attack / Alt (centre: auto-target) |
| Attack (hold) | Left click | RT | same | Attack stick (right side) |
| Alt: sword guard / bow charge | Right click | LT | same | Alt stick (up and left of Attack) |
| Swap weapon sets | **E** | Y | **Tab** / Y | Swap |
| Dodge roll | Space | LB | same | Roll |
| Flask | F | D-pad up | same | Flask |
| Ember (bullet clear) | Q | RB | same | Ember |
| Pause (overlay: Resume / Restart / Leave run / Options / Leaderboards; co-op: the non-pausing party overlay; a tutorial run: Resume / Restart tutorial / Skip tutorial / Options) | **P** | Start | **Escape** / Start | Pause button (top bar) |
| Options screen (juice settings, controls, audio, display) | **O** (B or Close closes it) | pause overlay -> Options; B closes | O (juice panel) | Pause overlay -> Options (tap) |
| Restart (same seed) | R (any time but in a tutorial run; a ranked run still being played is forfeited first: a death) | the pause overlay's Restart; after a death / victory **A** on the selected Again (menus and the run-over panel take the pad, so the D-pad-down restart binding never fires there) | R | Restart in the pause overlay or run-over panel (tap) |
| Menu back (main menu, lobby screens, the Leave run confirm, the party overlay) | Backspace | B | (none) | Back button (tap) |
| Debug: one hit on the player | K (KV_Debug only) | | K | (none) |
| Debug: 10 % off an engaged boss | J (KV_Debug only) | | J | (none) |
| Debug: replay check | F8 or **L** (KV_Debug only) | | F8 | (none) |
| Debug (endless): end the floor now | **N** (KV_Debug only; `DEBUG_FLOOR_BUTTON`, a port bit) | | (none) | (none) |
| Debug (runs with drops): drop the next boost kind (Fury, Quickstep, Frenzy, Aegis, ...) 1.5 tiles ahead | **;** Semicolon (KV_Debug only; `DEBUG_DROP_BUTTON`, a port bit; M until docs/MINIMAP.md MD11) | | (none) | (none) |
| Leaderboard panel | **B** (B again, pad B or Close closes it) | pause overlay -> Leaderboards; B closes | (none) | Pause overlay -> Leaderboards (tap) |
| Full map toggle (docs/MINIMAP.md M9; not sim input: `InputController.onMapAction` -> MinimapController) | **M** | D-pad left | (none) | Map from the pause overlay (solo) or the party overlay's Map item; tap to close |
| Boon draft (M2): pick a card | A / D (screen left / right; neither = centre card) | left stick left / right | (none) | Tap the card |
| Boon draft: take the card | Left click (after 0.5 s) | RT | (none) | Same tap |
| Curse shrine (M2): accept | **1** (in the shrine zone) | A | (none) | Accept button (only in a shrine's zone) |

Roblox remaps: Roblox reserves Escape (game menu) and Tab (player list), so Pause is P and Swap is E (one swap key,
so the HUD hint is unambiguous; C is not bound). The leaderboard panel is on B ("boards"), not N: N is the endless
debug floor skip, and `inputMapping.spec.ts` checks B against every game and driver key. The pad restart is new (the web build had none) and is limited to a
finished / paused run so a stray press cannot end a fight. L duplicates F8 because Studio may keep F8 for itself.
Opening the Roblox menu (Escape, or Start on some pads; a game cannot take those keys) also pauses a solo run; the
pause overlay stays hidden under it and shows once the menu closes, the run still paused, so the player resumes with
P / Start / Resume when ready (`shared/view/menu` `pause.ts`: `pauseOverlayShown`, `afterRobloxMenuClosed`; a
finished or frozen run resumes as before). Mouse and touch can also pause with the on-screen pause button
(`PauseButton`, in the Roblox top bar right of its own buttons, `PAUSE_BUTTON_VIEW`): it acts on the press, so the
click never swings, and in a co-op run it opens the party overlay instead.

Rebinding (task L4b; pure half in `shared/play/bindings.ts`, lists in `shared/play/config.ts`): the table above is
`DEFAULT_BINDINGS`. Rebindable: move (keyboard only, a primary and a secondary key each), attack, alt, roll, Ember,
flask, swap, skills 1-4 (skill 1 is also the shrine accept), restart, the leaderboard key (keyboard only) and the
full map toggle (`map`, docs/MINIMAP.md M9); a
keyboard slot also takes MouseButton1-3, a pad action one button (a trigger keeps its analog threshold wherever bound).
Fixed: pause (P / Start), settings (O; pad B closes panels), aim, the pad's sticks, UI navigation and the debug keys.
Refused: Escape, Tab, Slash, F9, F11 and every fixed key (P, O, K, J, N, Semicolon, F8, L). `rebind` swaps with the action that held the input, so no
input is ever bound twice on a device and every action keeps a primary; the stored form is `ControlsOverrides` (the
actions that differ), cleaned by `sanitizeControlsOverrides`. The sim only sees the resulting bits: a rebound layout
pressed the same way gives the same InputFrame (`bindings.spec.ts`). The client half (Options > Controls, stored in
the settings document v2's `controls` group) is in "Options screen" below; the table above is only the default.

The boon draft (M2, after every endless floor) uses the existing sim input only (no new bit, no codec change): the
sim reads the move vector's SCREEN-horizontal component (the InputFrame's move is world space; `DRAFT_SCREEN_RIGHT_*`
is screen-right for the 45-degree camera, checked against `screenToWorld` in `inputMapping.spec.ts`), beyond a 0.5
dead zone left / right, else the centre card (two cards: left / right, centre selects none); a FIRE press edge
confirms once the draft has been open `DRAFT_MIN_OPEN_TICKS` (0.5 s). The world is frozen meanwhile. The shrine uses
SKILL1 (key 1 / pad A), which does nothing else anywhere in the sim (FIRE would swing the sword there). Co-op
(a lobby's party run): every player drafts from their own offers with their own stick / FIRE (through the lockstep input like
any other frame), and the world stays frozen until all of them confirmed.

Menus (pause overlay, settings panel): while one is open the gamepad's A / B / D-pad / left stick go to Roblox's GUI
selection (InputController passes them through instead of sinking them; the D-pad-down restart is off then, the
overlay has a Restart button) and the selection starts on the first button. The settings panel pauses the run while
it is open (the web panel did not; on Roblox its clicks and the pad's A would otherwise reach the game); P inside it
does not resume under it. After a menu button is clicked, the mouse buttons read as released until they are (no sword
swing on Resume).

## Touch controls (docs/MOBILE.md)

Touch is a third input device. `mapDevicesToInput` merges `DeviceSnapshot.touch` with the keyboard and pad, so every
touch control becomes an ordinary `InputFrame` (no sim change). The pure core is `shared/play/touch/` (`TouchControls`,
`pickAutoTarget` (MBD6), the draft helpers, `touchMode`); the placement is `shared/view/hud/touchLayout.ts`
(`TOUCH_LAYOUT`), and the tunables are `TOUCH` in `shared/config/touch.ts`. `TouchControlsController` draws the sticks
and buttons (one ScreenGui, `KV_TouchControls`), turns off the stock touch GUI and sets `Sensor` (either way up: docs/PORTRAIT.md).

`touchMode` gives `play` (move and action controls), `spectate` (only Next / Prev) or `hidden` (under the pause overlay,
any other menu, the full map, the boon draft and a frozen tutorial). The last device used wins: a keyboard or pad hides
the touch controls until the next touch.

Settings: `DisplaySettings.touchSize`, `touchOpacity`, `touchAutoTarget` and `touchLeftHanded` (overrides-only; the
settings document stays v2), shown on Options > Display on touch-capable devices only.

Spike: `KV_TouchSpike` (`TouchSpikeController`, off by default; see `docs/SPIKES.md`) is the MB0 device probe: input
flags, fps and memory, one number per finger, and the touch-to-GUI offset.

## HUD (`src/client/ui/hud/`, React + Reflex)

Two ScreenGuis (`KV_GameHud` display order 10, `KV_GameMenu` 20), laid out at a 1280x720 reference under a UIScale
(`useHudScale`: min(w / 1280, h / 720) clamped to 0.6..1.75, x1.25 on a ten-foot console screen, then x the player's
HUD scale, Options > Display, 70-125 %; `computeHudScale`) inside the safe area (`ScreenInsets =
CoreUISafeInsets`). Every text is a theme string (`shared/view/hud` HUD_STRINGS / SETTINGS_STRINGS / OPTIONS_STRINGS,
all checked to exist by `hud.spec.ts`), every colour a theme role, the font the token `HUD_FONTS.text` (Roblox's pixel
font **Arcade**; `HUD_FONTS.mono` = Code for the debug line), resolved once in `client/ui/theme`. Change the font there
and only there. Every key prompt (swap, restart, the shrine accept, the boon draft, the leaderboard close) names the
player's bound key for the last-used device (`selectBindings` + shared/play `swapHint` / `restartHint` / `shrineHint` /
`draftHint` / `leaderboardHint`); pause (P / Start) and Options (O / B) are fixed.

Footprint (docs/HUD_LAYOUT.md): the always-on panels (StatusPanel, ScorePanel, WeaponPanel) are corner `Panel`s
(`corner` prop) that hug their content: a `Text` with no `width` sizes to its text, and `fill` / `wrap` opt into the
parent's width (a scale-width Text inside an auto-sized Panel stretched it to the whole screen, the bug H1 fixed).
Each stays inside its `HUD_FOOTPRINT` box (shared/view/hud footprint.ts, status 240x160, score 200x160, weapons
240x80 reference px) and out of `HUD_CLEAR_ZONE` (the middle 50 % x 56 % of the screen) at HUD scale <= 100 % on every
`HUD_TEST_VIEWPORTS` entry (footprint.spec.ts); transient panels (boss bar, toasts, tutorial, spectate, verdict) use
the centre bands. Corner panels fade when the watched player, an enemy or an enemy bullet is under them
(`HudOcclusionController`, Options > Display > HUD fade).

| Where | Component | Shows |
| --- | --- | --- |
| top left | `StatusPanel` | `HP` + one heart per 2 half hearts (full / half / empty, `uiHealth`), armor pips (diamonds, `uiMana`) and, with a running Aegis, its pip after them (a diamond in `boost.aegis`), `Flask` pips (`uiAccent`), `Ember` pips (diamonds, `ember`) |
| top left (drops) | `StatusPanel` / `BoostRow` | docs/BOOSTS.md B7: one entry per running boost of the shown player (snapshot `boosts`, Boost order): an icon square in `boost.<kind>` with its `boost.<kind>.icon` label and a bar beside it draining with `fraction` (the snapshot's tenths); both blink in the last `BOOST_VIEW.blinkSeconds` (2 s; a steady dim under reduced motion); the tutorial's highlight ring when its highlight is `boosts` |
| bottom left | `WeaponPanel` | both weapon sets (number + `<weapon id>.name`, 108x30 slots), the set in hand opaque with a `uiAccent` ring; above them `E swap` / `Y swap` by `game.inputDevice`, shown for `HUD_HINTS.swapHintSeconds` after a run start or device change and while the tutorial teaches weapons (`useTimedHint`), then fading; always in the pause overlay |
| top right (endless) | `ScorePanel` | a `Floor N · Depth D` line under the combo meter (snapshot `floor` / `depth`, 0 outside endless runs; an unscored run keeps it under the StatusPanel's pips) |
| top right | `ScorePanel` | scored runs (every endless run; M1 with `KV_Scoring`): the score, `x1.3` combo and its decay meter (snapshot `comboWindowTicks`: `COMBO_WINDOW_TICKS` or what boons / curses make of it) |
| top left (endless) | `StatusPanel` / `RunItems` | M2 (co-op: the local player's): a row of icons for the owned boons (rarity colour: `rarity.normal` / `rarity.rare` / `rarity.unique`), relics (`uiAccent`) and curses (`uiHealth`), each labelled with its `<id>.icon` string; one row at most (`capOneRow`: the newest that fit after a `+N` cell, `hud.items.more`) |
| centre (endless) | `DraftOverlay` | M2 boon draft: `Choose a boon`, up to 3 cards (`<id>.name` in the rarity colour, `boon.rarity.<r>`, `<id>.desc`), the card under the stick highlighted (`uiAccent` ring, scaled up; the snapshot is taken every frame while the draft is open), the device's hint (`A / D to choose · Click to take`) once a confirm counts. Co-op: the LOCAL player's offers and selection, plus `Waiting for N teammate(s) to choose` (`hud.draft.waiting`) while others still choose (alone once this player confirmed) |
| top centre (endless) | `ToastPanel` | M2: `Boon: <name>` / `Relic found: <name>` / `Cursed: <name>` / `Second Wind!` / Vampire Fang heals / a boost pickup (`hud.toast.boost`: `Fury: +50% damage for 30 s`, the local player's only) for 3 s (store `game.toasts`, from the run view's `runEvents`: the local player's own events, solo or co-op), and the `1: accept a curse` hint while the player stands in an unused shrine's zone |
| top centre | `BossBar` | while a boss is engaged: `<boss id>.name`, `Phase I / II / III`, an hp bar (`boss` role) with notches at the phase marks (66 % / 33 %, from the archetype's `phaseHp`) |
| centre | `RunOverPanel` | after a death / victory: `Run over` / `Victory`, `You died — press R to retry` / `Mother Bramble defeated — press R to play again` (R, or A with a pad: the selection starts on Again) + `or <other key>`, time, hits taken, kills; in scored runs the score, best combo and the points per source (kills, grazes, guard, rooms, perfect, fast, floors, boss); then **Again** (solo) and **Main menu**, or **Back to lobby** while in a lobby. A party run: `The party is down — press R to return` (or `The server ended the run (<reason>) — press R to return` once the server rejected it, also before the wipe), Back to lobby only. Endless runs have no victory: only death ends them. |
| centre (menu) | `PauseOverlay` | solo, while paused and playing: dimmed scene, `Paused`, Resume / Restart / Leave run / Options / Leaderboards, `P to resume` / `Start to resume`. Co-op (the pause key; the run goes on, no dimming): `Party run`, Resume / Leave run / Options / Leaderboards, `P to close · the run does not pause`. Leave run shows the confirm first (`Leaving ends your run. It counts as a death and your score is submitted.`, Leave / Cancel; Cancel selected with a pad). In a tutorial run: Resume / Restart tutorial / Skip tutorial / Options; Skip asks `Skip the tutorial?` (Skip / Keep playing; Keep playing selected with a pad). Buttons: `shared/view/menu` `pauseItems(coop, tutorial)` |
| lower centre (tutorial) | `TutorialPanel` | the step's prompt in the last-used device's words (`tutorial.prompt.<id>.<keyboard\|gamepad>`, a template naming the player's BOUND keys: `{flask}`, `{roll}`, ... from `shared/view/hud` `tutorialPromptVars(device, bindings)`), progress `{step} / {count}` (steps done), `P: pause / skip` / `Start: pause / skip`; hidden while the objective card is up and once the tutorial ended |
| centre (tutorial) | `ObjectiveCard` | the first step: `Practice Descent`, the objective in two lines, `Click: Continue` / `RT: Continue` (the bound attack input; FIRE, after 0.75 s) |
| centre (menu, tutorial) | `TutorialOutro` | 1.5 s after the tutorial's end: `That's the descent.`, what a real run is (the bound leaderboard key, default `B`; `Start` on a pad: `tutorialLeaderboardHint`), Start my first run / Play the tutorial again; gamepad selection on the first button |
| on the taught element (tutorial) | `HighlightRing` (`TutorialFx.tsx`) | a pulsing `uiAccent` UIStroke on the hearts row / flask row (StatusPanel `highlight`), WeaponPanel, ScorePanel or BossBar (`highlight` props, from the slice); static under reduced motion. StatusPanel's `ghostHeart` token flashes a fading half heart (`uiHealth`) after the first harmless hits |
| centre (menu) | `OptionsScreen` | the Options screen: Juice / Controls / Audio / Display tabs (below) |
| bottom right | `InfoPanel` | (docs/HUD_LAYOUT.md H6) the fallback notice and, while the run is playing, the verdict line, each for `HUD_HINTS.verdictSeconds` after it changes, then fading (the info line `Project Kaleb-Vale · <biome> · seed N · <dungeon>` is `RunInfoLine`, in the pause overlay and the run-over panel only); the verdict line (`Run 2 (death): verified by the server (ab12cd34)` / `submitted, checking...` / `rejected (code) reason` / `not submitted (stress)`), and with KV_Debug the debug line (tick, recorded ticks, enemies, bullets, replay check) |

The snapshot (`shared/play` `GameSnapshot`) gained `bossPhaseMarks`, `kills`, `hitsTaken` and `endTick` (the tick the
run ended on, for the post-run time), and for M2 progression `comboWindowTicks`, `draftOpen` / `draftOffers` /
`draftSelected` / `draftReady`, `boons` / `relics` / `curses` and `atShrine` (SnapshotExtras.config). Co-op
(SnapshotExtras.playerIndex = the client's `localIndex`): hearts, weapons, the draft, the run items and the shrine hint
are the local player's, `draftWaiting` counts teammates still choosing, and `comboWindowTicks` is the team's. Boost
drops (docs/BOOSTS.md B7) added `boosts` (`{ kind, secondsLeft, fraction }` per running boost, seconds rounded up to
tenths and the fraction in the same steps, so the row changes at most 10 times a second) and `aegisPips`, read for
`playerIndex` (they move to the vitals index once docs/SPECTATE.md S2 adds `SnapshotExtras.vitalsIndex`).

## Juice (`src/shared/view/fx/` logic, `src/client/controllers/fx/` drawing)

A port of the web build's `src/fx` (README there). Render side only; nothing feeds back into `step()` except the
freeze frame's pacing (below).

| Feature | Web source | Roblox drawing | Settings |
| --- | --- | --- | --- |
| FX tracker | `tracker.ts`, `events.ts`, `FxTracker.tsx` | `FxTrackerController` (after the sim) | |
| Health bars | `bars/*` | a BillboardGui per actor slot at the feet, camera-space `StudsOffset` up to the placeholder's top edge (1 render px = 0.25 studs); plate `enemyHealthBack` / elite `enemyHealthElite`, chip `enemyHealthChip`, fill `enemyHealth` (flash `uiText`); pips for hpMax <= 4; bosses none | `healthBars` always / when hit (2 s + 0.4 s fade) / off; reduced motion: no 1 px shake |
| Damage numbers | `numbers/*` | 48 BillboardGuis, a TextLabel in the HUD font; `damageNumber`, heavy (>= 4) `damageHeavy` at 2x, `damageCapped` "CAP" (`fx.cap`); merge within 0.25 s; rise 12 px + fade over 0.7 s | `damageNumbers`; reduced motion: no jitter / rise / pop |
| Freeze frame | `hitstop.ts`, `freeze/*` | `SimController.hitstop` paces `LiveRun` | `freezeFrame`; off under reduced motion |
| Camera nudge | `freeze/rules.ts` nudge (+ port kinds) | CameraController adds whole render px (0.25 studs): boss phase 2/3 (1 px, 80 ms), boss death (1 px, 240 ms), player hurt (2 px, 3 x 40 ms; port), heavy hit (1 px, 50 ms, solo; port); priority death > hurt > phase > heavy | `screenShake`; off under reduced motion |
| Hurt flash, low-health pulse (port) | none (docs/FEEL.md J2 / J11) | `HurtFlashController`: screen-edge gradients in `uiHealth` | flashes stay under reduced motion (the pulse turns steady) |
| Hit reaction (port) | none (docs/FEEL.md J4 / J5) | ActorRenderController: rim flash (`uiText`) / hold / 1-2 texel push on sprite enemies (`SpriteView.setRimFlash` / `setHold` / `setPushTexels`); placeholders move under `KV_Actors/Flashing` (one fill Highlight) and push | reduced motion: flash only; kill holds off with `freezeFrame` off |
| Squash, afterimages (port) | none (docs/FEEL.md J6 / J7) | `motionFx.ts` (ActorRenderController): `SpriteView.setScale` on roll start / end, hits, spawns, deaths; ghost billboards under `KV_Actors/Ghosts` on rolls and the Demon Lord's brimstone charge | off under reduced motion; ghosts off at particles off |
| Particles | `particles/*` | pooled Parts (1-3 px cubes) in the palette `uiText`, `particleSpark`, `enemyHealthElite`, `boss`, then each archetype's `enemy.<id>` role; hops lift the part (h px / cos(pitch)) | `particles` off / low / normal / high = budget 0 / 128 / 320 / 512 live (one level lower under reduced motion; slower, shorter, no hop, rings in place) |
| Sprite effects (port) | none (docs/FX_AUDIO.md F3 / F4) | `FxSpriteController`: theme `fx.*` flipbooks on pooled floor-flat SurfaceGuis ("Sprite effects" below) | `particles` off / low / normal / high = 0 / 24 / 48 / 64 live effects (one level lower under reduced motion) |

Settings resolve as the web build's (`shared/settings` resolveJuiceSettings): the player's overrides on top of the
defaults (bars when hit, numbers on, freeze on, screen shake on, particles normal), and **reduced motion defaults to the Roblox "Reduce
Motion" setting** (GuiService.ReducedMotionEnabled, followed live) unless the player set it; the shared rules
(`juiceRules.ts`: effectiveParticles, particleBudget, freezeFrameOn, screenShakeOn, motionScale) are the only place
features read it.

Time bases (as the web): bars and numbers age on sim time ((tick + alpha) / 60), so they hold during pause and
hitstop; particles run on real time x the hitstop clock's time scale (0 during a freeze, the ramp in slow motion), 0
while paused.

### Room clear celebration (docs/ROOM_CLEAR.md; not run in Studio yet)

Per tick, `RoomClearEvents` (shared/view/fx roomClears.ts, on LiveRun and LockstepClient) turns a room record's
`cleared` 0 -> 1 into a `RoomClear` (exact ROOMS / PERFECT / FAST points from the per-source deltas, kill points since
the engagement, the last killed member). `RoomClearController` runs the pure `RoomClearSequence` (1.5 s: stamp at
0.06-0.16 s, tally segments from 0.3 s, the bonus lands at 1.15 s, fade 1.2-1.5 s; corner chips merge at 0.9 s) on real
time and writes React bindings, so nothing re-renders per frame. The score panel shows `ScoreRoller`'s number: kill
points roll over 0.15 s, a room bonus is hidden until it lands, then rolls over 0.3 s.

### New-best celebration (docs/NEW_BEST.md; not run in Studio yet)

At each run start `NewBestController` freezes the run's `RunBaseline` (shared/view/hud `baselineFrom` over
`withPendingRuns`) in the store's `records` slice: the server's `records` status plus earlier ranked runs of the session
whose verdict or records push has not arrived (`SimController.pendingRunClaims`), so an R-restart or a quick Again
never aims at the old best. Only a ranked run (a server `runId`, not the tutorial, scored) draws anything. Each frame
the tracker runs on the score roller's **shown** score inside RoomClearController's frame (`FX_FRAME_PHASE.scoreRoll`,
before every normal handler), so the target row, the fanfare (`sfx.best.new`, outranking that frame's clear jingle), the
gold flare and the NEW BEST! floor shout (ComboController's slot; a request under the stage cover waits for it to
lift) agree with the number on screen; an edge due under the cover fires on the reveal's first frame (the stairwell
card's `NEW DEEPEST` fanfare). In-run confetti stays outside `HUD_CLEAR_ZONE` and hides while a menu is up. At run over
the panel and the controller share `runOverBest` (the verdict's `records` win once they arrive): ribbon, rolling record
rows with tick / land, full-screen confetti, `Saved` / `Not saved`; a record run's jingle is `sfx.jingle.record`.

### Run-over recap and co-op moments (docs/RUN_RECAP.md; not run in Studio yet)

Presentation plus one telemetry remote. At run over `RecapController` adds one near-miss line and up to four counting
highlights to the run-over panel (client/ui/hud RecapBlocks.tsx; the breakdown and Build list behind Details), arms
Again at 0.6 s and reports how the panel was left (`runRecap` -> the server's `RunRecap` event). In a party run
`TeamMomentsController` turns the sim's PERFECT into TEAM PERFECT with a streak (RoomClearController's stamp, chip,
gold pulse rings and `sfx.room.teamperfect`) and two players' parry groups starting within 0.2 s into SYNC!
(`SyncCalloutController`'s floor text and tether, the mapper's `sfx.player.syncparry`).

### Sprite effects (docs/FX_AUDIO.md F3 / F4; Roblox port, no web source)

`FxSpriteController` (render step `KV_FxSprites` at Camera + 2) draws the cues of the pure `FxCueMapper`
(`shared/view/fx` `fxCues.ts`, `fxCues.spec.ts`; tunables `FX_SPRITE_VIEW` in `shared/view/fx/config.ts`) with the
theme's `fx.*` sprite sets (`ThemePack.fx(id)`: a one-facing flipbook, drawn size `sizeTiles` <= `FX_SPRITE_MAX_TILES`
(3), `tint` role or the sheet's own colours (`meanColor`), `additive`).

- **Cues**, once per frame after the sim, from state wherever it keeps the fact (so a frame of 0..5 ticks loses
  nothing): hit marks (`fx.hit.light` / `.heavy`, at most every `hitMarkMinSec` per actor, turned by
  `hitRotationsDeg`), swing trails (`fx.swing.1..3` by the sword's last swing, `swingAheadFraction` ahead, turned to
  the swing), the guard shield (`fx.guard.shield` when the guard goes up, re-shown on a deflect at most every
  `guardMinSec`; the sim sums `bulletsDeleted` over the party and swings delete bullets too, so in co-op the re-flash
  goes only to the one player who could have made the deletes: no other guard up this frame or the last, no other
  swing), roll dust, flask, Ember ring, boss phase 2+ / slam impact / death (three staggered `bossDeathBursts`), relic
  and shrine at their spots (DecorController's scene), death puffs, breakable splinters (`breakableSplinter`), and the
  `fx.stairwell` loop while the stairwell is open. A cue within `telegraphClearTiles` of an actor on its telegraph's
  first frame (or the slam target) is dropped. A new run, a floor change or the tracker's reset parks everything.
- **Placement** (`FX_SPRITE_VIEW.placement`): `"floor"` (default) lays each effect flat on the floor like the decor
  flats: a top-face SurfaceGui on a thin invisible Part (`thicknessStuds`) at `liftStuds` plus a per-slot layer step
  (`layers` x `layerStepStuds`, no z-fighting), sized by `floorImageSize` and turned by the camera yaw. That is under
  every floor marking and every bullet, so an effect never covers one; standing bodies draw over it. `"billboard"` is
  the alternative for comparing in Studio: SpriteView's camera-facing BillboardGui with its floor clearance. The canvas
  is a square of the cell's diagonal so a rotated label never clips; `additive` sets LightInfluence 0 and
  `additiveBrightness`.
- **Budgets:** at most `maxSprites[effectiveParticles]` live one-shots (0 / 24 / 48 / 64 by the particle level, one
  level lower under reduced motion; cues past it are dropped and counted in `stats.overBudget`), `cueCapacity` (64)
  cues per frame. Slots (anchor Part + Gui + ImageLabel) are pooled and only grow; finished ones are parked, moves go
  in one BulkMoveTo. The mapper allocates nothing per frame, nor does the controller (its `FxCueFrame` is one reused
  object).
- **Clock:** the effect clock advances by the real frame time (clamped to `maxFrameDt`) x the hitstop clock's time
  scale (`SimController.hitstop`), and not at all while paused or frozen, so effects hold in a freeze frame and slow
  down in slow motion like the particles.
- **Today:** no bundled pack has `fx.*` art (vale's switch on once `fx-effects.png` has an ID in `assetIds.ts`), so
  the controller builds nothing.

### Freeze frame and replays

The web build delays sim stepping: SimDriver feeds `computeFrameAdvance(delta)` to the FixedStepLoop (a frozen frame
runs no tick, slow motion feeds less time) and never adds frozen time to the accumulator. The port does exactly that
in `LiveRun.frame(dt, input, pacer)`: paused frames never reach the pacer; a frozen frame returns before the loop (no
step, nothing recorded, accumulator and alpha untouched). Ticks still record the frame's input, so **the recording does
not depend on hitstop**. `shared/play/liveRun.hitstop.spec.ts` drives a scripted Mother Bramble fight on the seed-1337
floor (boss door, bow, J through phases 2 and 3, summoned swarmers) through the client's own loop with the tracker and
the freeze rules, and checks: at 60 Hz, hitstop on vs off records the identical serialized recording (input per tick)
and identical hashes every 120 ticks and at the end (57 frozen frames, 13 partial, 30 slow-mo frames, ~1.1 s frozen);
with irregular frames (jitter, 144 / 30 fps, hitches, a 5 s frame) frozen frames run nothing, `runReplay` and the
server's `validateRun` reproduce the live hash, and the recorded inputs replayed without hitstop match every
checkpoint; with the setting off nothing freezes.

## Audio (`src/shared/view/audio/` mapping, `AudioController`)

Every sound is a logical ID resolved by `ThemePack.sound(id)` -> `{ assetId | undefined, variants, volume, pitch,
minInterval, group }`. The placeholder pack has every `sfx.*` / `music.*` / `amb.*` ID `silent`, and vale's sounds
switch on only once every one of their built files has an ID (`packs/vale/audioLayout.ts`, `npm run audio:build`), so
today nothing is created or played; put `{ kind: "sound", assetId: "rbxassetid://<n>", volume: 0.8 }` on an ID in
`packs/placeholder/manifest.ts` and it plays, no code change. Sounds play through SoundService SoundGroups `sfx` and
`music` (created if missing; volume = `AUDIO_VIEW.groupVolume[group]` x `AUDIO_VIEW.masterVolume` x the player's
master and group volume, live), each Sound at the manifest's per-ID volume x the cue's volume scale.

- **Cues** (`AudioCueMapper`, once per frame from `LiveRun.frameEvents`, the tracker's FX events and the state through
  `AudioStateWatch`): each ID at most once per frame and once per its minimum interval (the pack's `minInterval`
  overrides `SFX_MIN_INTERVAL`); at most one jingle per frame (`JINGLE_SFX`: game over, depth up, victory, room clear,
  shrine; the highest `SFX_PRIORITY` wins, and depth up ranks above victory, so an endless boss kill plays the depth
  jingle and M1's plays the victory); then at most `AUDIO_VIEW.maxStartsPerFrame` (6), the highest `SFX_PRIORITY`
  kept (the player's hurt and death, the run-over jingle, the telegraph and the Ember first; enemy hits and shots
  last). A dropped cue starts no cooldown.
- **Silent IDs:** the mapper gets the controller's `playable(id)` (an assetId in the pack; `musicFor` gets the same):
  a silent ID cues its `SFX_FALLBACK` when that one plays (no finisher clip: the swing; no back clip: the click), else
  nothing, so it never takes a cap slot, the jingle slot or a cooldown. `sfx.ui.move` has no fallback on purpose (a
  click on every focus move would buzz).
- **Co-op** (X4): in a party run the player sounds come from the watch's per-player edges: the local player's at full
  volume, a teammate's at `AUDIO_VIEW.teammateVolume` (0.4) and `TEAMMATE_PRIORITY_DROP` lower; shots, swaps and the
  bow's full charge are the local player's only. The deflect (summed `bulletsDeleted`; the sim keeps no per-player
  count) is full volume when the local player could have made it (guard up this frame or the last, or a swing:
  `AudioStateWatch.mayDeflect`), else a teammate's. A solo run reads the summed events as before.
- **Per start:** one clip of the ID's pool (assetId + `variants`, round-robin per ID: `VariantPicker`; a pool of
  `AUDIO_VIEW.voicesPerSfx` Sounds per ID split over the clips, a busy clip restarts its oldest voice) at a jittered
  PlaybackSpeed inside the pack's `pitch` range (`PitchVariance` over `PitchJitter`, seeded `AUDIO_VIEW.pitchSeed`;
  1 without a range) that never lands within `AUDIO_VIEW.pitchRepeatGap` of the range from the same ID's previous
  start, so a repeated sound never plays twice at nearly the same pitch.
- **Ducking:** a `DUCKING_SFX` sound (every jingle and the Ember) dips the music SoundGroup to `AUDIO_VIEW.duck.level`
  for the clip's length (`holdSec` while the length is not known yet), in `attackSec`, back in `releaseSec`
  (`MusicDuck`, every Heartbeat).
- **Music** (`musicFor`, a Reflex selector over the HUD snapshot, the run info and the menu screen): `music.menu` in
  the main menu and lobby browser, `music.lobby` in the lobby room (`music.menu` while silent), the floor's
  `music.biome.<n>` in a run (`music.tutorial` in the tutorial, its biome track while silent), `music.boss` while a
  boss is engaged, silence after a death (the run-over jingle `sfx.jingle.gameover` plays, X7) and while no run or
  menu is up. Looped, cross-faded over `AUDIO_VIEW.musicFadeSec` (0.75 s).
- **Ambience** (`ambienceFor`): the floor's `amb.b<n>` bed during a run, under the music through the `sfx` group (X5:
  no new slider), x `AUDIO_VIEW.ambientVolume`, cross-faded over `ambientFadeSec`; none in menus or after a death.
  Music and ambience loop ONE clip at speed 1, so the validator rejects `variants` / `pitch` on `music.*` / `amb.*`.
- **Preload:** requests to PreloadController's queue (docs/PRELOAD.md): on every run start every sound effect's clips,
  the floor's music and ambience and the tutorial's track (front lane), on every floor change that floor's beds (front),
  and the boss track (back lane); the queue skips what the join's core tier already fetched. Nothing when all of it is
  silent.
- **Menu sounds:** `playUi(id)` (the HUD's and menus' buttons, MenuController's B / Backspace back: `sfx.ui.back` when
  back changes something) goes through the same fallback; a gamepad focus move (`GuiService.SelectedObject` changing
  while the device is a gamepad) plays `sfx.ui.move`, rate-limited by `mapper.uiCue` (`SFX_MIN_INTERVAL` 0.08 s).

| Event (per rendered frame) | Sound ID | Min gap |
| --- | --- | --- |
| `playerDied` | `sfx.player.death` | |
| `playerHits` | `sfx.player.hurt` | 0.1 s |
| `emberUsed` | `sfx.ember` (ducks) | |
| `rollStarted` | `sfx.player.roll` | |
| `flaskUsed` | `sfx.player.flask` * | |
| `weaponSwapped` | `sfx.player.swap` * | |
| `shotsFired` | `sfx.player.shoot` | 0.06 s |
| `meleeSwings` | `sfx.player.swing` *, `sfx.player.finisher` * for the sword's finisher | 0.05 s |
| bow charge reaches full (local player) | `sfx.player.charged` * | |
| `bulletsDeleted` (sword / guard deletes bullets) | `sfx.player.deflect` * | 0.08 s |
| `telegraphs` | `sfx.enemy.telegraph` * | 0.15 s |
| `bossEngaged` | `sfx.boss.roar` | |
| `bossDefeated` (sim event) | `sfx.victory` * (jingle) | |
| `stairwellOpened` / `floorChanged` | `sfx.stairwell.open` * / `sfx.floor.enter` * | |
| `depthChanged` | `sfx.depth.up` * (jingle) | |
| a combat room cleared / a relic taken / the shrine used (state) | `sfx.room.clear` * (jingle) / `sfx.relic.take` * / `sfx.shrine.use` * (jingle) | |
| every player dead (state) | `sfx.jingle.gameover` * (jingle) | |
| enemy bullet spawn counter grew | `sfx.enemy.shoot` | 0.08 s |
| FX `hit` (any actor) | `sfx.enemy.hurt` | 0.05 s |
| FX `killed` (not a boss) | `sfx.enemy.death` | 0.04 s |
| FX `bossPhase` (phase >= 2) | `sfx.boss.roar` | |
| FX `bossDefeated` | `sfx.boss.death` * | |
| `breakablesBroken` | `sfx.breakable.break` | 0.05 s |
| `breakableHits` > `breakablesBroken` (hits that did not break) | `sfx.breakable.hit` | 0.06 s |
| a boost drop landed (`boostEvents.dropped`) | `sfx.boost.drop` * | 0.1 s |
| a boost picked up (`boostEvents.collected`; a teammate's quiet) | `sfx.boost.collect` * | 0.05 s |
| the local player's boost ran out (`boostEvents.ended`) | `sfx.boost.expire` * | |
| an Aegis pip absorbed a hit (`boostEvents.aegisBroke`; a teammate's quiet) | `sfx.boost.aegisbreak` * | |
| menu buttons | `sfx.ui.confirm` (resume, restart, reset) / `sfx.ui.click` (options, settings, close) / `sfx.ui.back` * (back, cancel) | |
| gamepad focus move | `sfx.ui.move` * | 0.08 s |
| music | `music.menu`, `music.lobby`, `music.biome.<1..5>`, `music.tutorial`, `music.boss`, none after a death | cross-fade |
| ambience | `amb.b<1..5>` (the floor's biome, in a run) | cross-fade |

\* Roblox-port additions to the placeholder pack (`PORT_SFX` / the theme's `PORT_AUDIO_EVENTS`; the web contract has
no ID for these events). `sfx.loot.*` are unused. `shared/view/audio/audio.spec.ts` checks the mapping, cooldowns,
cap and priorities, the one-jingle rule, silent IDs and fallbacks, the co-op split (deflects too), variants, pitch,
the duck, the music and ambience choice and the volume rule, over synthetic frames and the recorded seed-1337 endless
run, and that every ID it can play exists in the placeholder pack, in the right SoundGroup.

## Options screen and persistence (task L4 / L4b client)

`OptionsScreen` (`client/ui/hud/OptionsScreen.tsx`) is the former juice settings panel grown into tabs. It opens and
closes exactly as the panel did: O (keyboard), the pause overlay's "Options" button (the gamepad route) and the HUD
action `setSettingsOpen(true)` (any other menu, e.g. a main menu, opens it through that action; the Reflex flag is still
`settings.panelOpen`); B, O or Close closes it, and the run is paused while it is open. Tabs (`OPTIONS_TABS`):

| Tab | Rows | Group (stored) |
| --- | --- | --- |
| Juice | enemy health bars (always / when hit / off), damage numbers, freeze frame on kill, particles (off / low / normal / high), reduced motion (on / off, `(system: on/off)` below) | `juice` |
| Controls | Keyboard & mouse / Gamepad sub-tabs; one row per rebindable action (`KBM_ACTIONS` / `PAD_ACTIONS`, names `options.action.*`): primary + secondary (+ Clear when a secondary is set) on keyboard / mouse, one button on the pad; the input test strip; Reset <device> (asks first) | `controls` (`ControlsOverrides`) |
| Audio | master, music, sound effects: `-` / `+` in 10 % steps (0..100) | `audio` |
| Display | HUD scale 80 / 90 / 100 / 110 / 125 % (multiplies the automatic scale) | `display` |

Juice, Audio and Display have a "Reset to defaults" for that tab only (`updateSettings({ <group>: {} })`); Controls
resets per device. Every pick applies at once (Reflex `patchOverrides`, optimistic) and is sent with `updateSettings`
as the whole changed group; the server sanitizes it and its `settingsChanged` (sent after join and after every request)
replaces the overrides. Before the server answers the screen shows "Not saved yet: the server has not answered" and
the game runs on the defaults plus the local changes. (The client does need the server runtime to have created the
remotes: `client/network.ts` waits for them, with no timeout, while the controllers load. If the server script dies
before `GlobalEvents.createServer`, no controller starts.) Audio volumes scale the SoundGroups live
(`soundGroupVolume`: group x master x the group's own percent); everything is silent with the placeholder pack, so the
Audio tab only becomes audible once sound IDs are uploaded. No separate screen-shake option: the only shake is the
1-pixel boss nudge, which Reduced motion already turns off.

Rebinding (Controls tab; RebindController, pure flow in `shared/play/rebindFlow.ts`):

- **Capture.** Activating a slot shows `Press a key... (5)` (`Press a button...` on the pad sub-tab), counting down from
  `REBIND.captureTimeoutSeconds`; the timeout, Escape, or opening the Roblox menu cancels with nothing changed. The press
  that opened it never counts (input is taken from the next frame). The capture OWNS the input from its start until
  the frame after it ends (`options.inputCaptured`): InputController sinks everything and reports no driver keys (so R
  does not restart), O / the pad's B close / the leaderboard key do nothing, and Roblox's GUI selection is switched off
  (`GuiNavigationEnabled`) so pad A does not press the selected button. Keyboard captures take keys and mouse buttons
  1-3; pad captures take pad buttons (triggers included).
- **Result** (`planRebind`): a free input binds at once; one held by another action asks `X is already used by Y.`
  [Swap] [Cancel] (Swap gives Y this slot's old input, or clears Y's secondary when this slot was empty; B also
  cancels); the action's own other slot swaps the two silently; a reserved input (Escape, Tab, Slash, F9, F11, P, O,
  the debug keys; Start / Select / sticks on the pad) or a swap that would leave Y with no input is refused with a note
  under the list.
- **Clear** empties a keyboard / mouse secondary; **Reset <device>** asks `Reset every <device> binding to the
  default?` first.
- **Test strip.** While the Controls tab is open, one chip per action of the shown device lights up while its input is
  held (`pressedActions`). With a pad, A / B / the D-pad still navigate the menu while you test them.
- **Applying.** InputController reads `selectBindings` (DEFAULT_BINDINGS + the stored overrides; memoized, the store
  keeps an unchanged group's object so other settings changes do not re-bind), re-binds its CAS sink with the new key
  list, and treats every input held at the change as released until it is let go (`HeldInputGate`), so the key you
  just pressed into a slot does not fire on resume. The default layout gives exactly the old key lists and sim bits.
- **Gamepad.** Every control is a Selectable MenuButton; the first tab is selected on open; a prompt selects its first
  button and makes the rows behind it unselectable; when the prompt closes the selection returns to the slot that
  opened it. The bindings list scrolls (ScrollingFrame) and follows the selection.

`KV_ResetBindings` (Workspace attribute, below) clears the saved bindings once on join.

## Ranked runs and the leaderboard panel (M3 / M5)

Unless `KV_Seed` or `KV_World` is set (or stress is on), every run start asks the server for a run (`startRun`) and
plays the seed the server picked on `RANKED_WORLD_KIND` (`"endless"`: scored, one segment per floor); the views see
no run until it answers (an unranked local run after `RUN_START_TIMEOUT_SECONDS` or a refusal; a `busy` answer, e.g.
the player's party run still being decided, is retried every `RUN_START_BUSY_RETRY_SECONDS` up to
`RUN_START_BUSY_RETRIES` times first). A `runFinished` for a run the client already left (a forfeiting restart whose
next run already started, Leave run, a party run left for the menu or a new run) only goes to the output log; only
the current run's verdict reaches the verdict line. The LiveRun cuts a
segment on every floor change (`segmentCutAfterTick: (s) => s.events.floorChanged !== 0`, else every
`SEGMENT_FALLBACK_TICKS`), the SimController uploads them as they are cut (`submitSegment`) and sends `finishRun` at
the end; `runFinished` fills the verdict line, with the leaderboard status. Each `segmentVerdict` ok releases that
segment's recorded frames (`LiveRun.releaseVerifiedFrames`; not with `KV_Debug`, whose F8 replay check needs the
whole recording). Details: docs/SERVER.md "Segmented runs".

B (or Leaderboards in the pause overlay) opens the leaderboard panel: Solo / Co-op tabs, the top 100 (your row
highlighted) and your best with its rank when it is in the top. B, pad B or Close closes it; the run pauses while it
is open, and only one of the Options screen / leaderboard panel is open at a time.

## Workspace attributes (read at every run start, i.e. on R)

| Attribute | Type | Effect |
|---|---|---|
| `KV_Seed` | number | Run seed (default 1337). Changing it and pressing R rebuilds the floor. Set: the run is unranked (the server picks ranked seeds). |
| `KV_Debug` | boolean | K / J / N / Semicolon / F8 / L and the debug HUD line. Off by default. |
| `KV_SpawnBoss` | boolean | With KV_Debug: start outside the boss room's door. The server rejects such runs unless `KV_AllowDebugRuns`. |
| `KV_Stress` | number | The web build's `?stress=N`: rings keep ~N enemy bullets alive. Stress runs are never submitted. |
| `KV_World` | string | `endless` (default: shared/config `PLAY_MODE`), `game` (the M1 run), `dungeonNoEncounter`, `greybox`. Set: the run is unranked. Pair with the server's `KV_RunValidationWorld` (Studio). |
| `KV_Scoring` | boolean | M2 scoring on an M1 world (`game` etc.; endless is always scored). Such runs are not submitted (`not submitted (scored)`): the server replays M1 unscored. |
| `KV_SkipMenu` | boolean | Dev only (read once, on join): no main menu; a solo run starts at once, as before the menu existed. Off by default. Co-op runs start from a lobby (Lobbies in the main menu): see "Main menu, lobbies and Leave run". |
| `KV_ResetBindings` | boolean | Dev only, read ONCE when the client starts (not on R): when the server's settings arrive, the saved key bindings (`controls` group) are cleared and saved that way; the other groups are kept. Off by default (shared/settings `SETTINGS_ATTRIBUTES`). |
| `KV_DecorBand` | number | Forces the decor depth band (0 kept, 1 worn, 2 ruined, 3 abyss; clamped) for every floor; changing it rebuilds the current floor's decoration at once. Unset: the floor's own band. Presentation only. |
| `KV_PlayerOutline` | boolean | Player outline (docs/PLAYER_OUTLINE.md): `false` hides the watched player's rim (sprite and Highlight). Unset or `true`: on (the Options setting still applies). Presentation only. |
| `KV_EnemyOutline` | boolean | Enemy outlines (docs/OUTLINE.md): `false` hides the Highlight and every sprite rim at once (toggles live, no reparenting). Unset or `true`: on. Presentation only. |
| `KV_DecorDebug` | boolean | Draws the decor debug overlay: fade boxes, footprint stencils, breakable cells (toggles at once). Off by default. |
| `KV_VoidOff` | boolean | Void decoration (docs/VOID_DECOR.md VD9): `true` builds no void Parts (`KV_Void`) and no abyss motes, leaving the bare abyss backdrop (toggles at once). Off by default. Presentation only. |
| `KV_VoidDebug` | boolean | Tints every void layer a flat debug colour (`VOID_VIEW.debugColors`: shoulder blue, ledge amber, outcrop magenta) so the bands read at a glance (toggles at once). Off by default. |
| `KV_DraftRevealDebug` | string | Draft reveal (docs/DRAFT_REVEAL.md): `c` / `r` / `l` letters (or names), comma separated, e.g. `c,l,r`, `l,l`: every draft's reveal gives its first cards these rarities (art, glow, beat and sounds); the real offers, their text and the pick are unchanged. Off by default. |
| `KV_NewBestDebug` | string | New best (docs/NEW_BEST.md): read at each ranked run start, forces the run's baseline: `score:2000`, `floor:2`, both (`score:2000,floor:3`), `first` (no record) or `unknown` (records not loaded). The server-side Studio fake `KV_FakeRecords` (`solo:48210:9`, `none`, `unknown`; docs/SERVER.md "Personal records") changes what the records say instead. Off by default. Presentation only. |
| `KV_PelletDebug` | boolean | Pellets (docs/PELLETS.md): with Studio or KV_Debug, labels every live room's centre `pellets <left> / <count>` (developer English; toggles at once). Off by default. Presentation only. |
| `KV_TreasureDebug` | string | Treasure rooms (docs/TREASURE.md TR5): read when the DEV panel's Go starts a dev run (docs/DEV_MODE.md; R / Restart keep it): words, any case and separator, last of a kind wins: `every` (every floor from 2 has a vault, when a room is eligible), `legendary` / `rare` (its starting tier), `untouched` / `swift` (its lock), e.g. `every,legendary,untouched`. A `VaultOverride` on the dev world's floors only (client-only world, never submitted). Unset: the run's own vaults. |
| `KV_TreasureLabel` | boolean | Treasure rooms (docs/TREASURE.md TR7): with Studio or KV_Debug, a label over the vault's chest: lock, tier, status and the SWIFT `t=<ticksLeft>` or UNTOUCHED `hits <hits>/<allowance>` (developer English; toggles at once). Off by default. Presentation only. |
| `KV_Tutorial` | boolean | Read once on join (not on R). `true`: the join starts the tutorial whatever the server says (the server is not asked; no main menu first); `false`: never (the normal join flow at once: the main menu, or `KV_SkipMenu`'s solo run). Unset: the server's `onboardingStatus` decides. Server side, `KV_ResetOnboarding` (docs/SERVER.md) resets the stored flag instead. |

If the `game` world cannot start (e.g. a build without the actor archetypes: "Unknown archetype"), the client falls
back to `dungeonNoEncounter` and says so in the HUD's info line.

## Preloading and the loading screen (docs/PRELOAD.md; not run in Studio yet)

Pure half: `shared/theme` `contentIds` / `assetIdList` / `biomeContentIds` (every `rbxassetid://` of a logical id or
biome, deep walk), `shared/view/preload.ts` (`preloadPlan` tiers by longest prefix, `PreloadQueue`, `PreloadProgress`,
`JoinGate`, `loadingReleased`, `skipVisible`, `bossContentIds`), tunables `PRELOAD` / `LOADING_VIEW`
(`shared/view/preloadConfig.ts`), strings `LOADING_STRINGS`. Specced in `preload.spec.ts`, `contentIds.spec.ts`.

- **Tiers:** core = what the menu, the tutorial and floor 1 can show or play (UI, the knight, regular enemies, every
  sfx, breakables, boosts, fx, decor, biome 1, then the menu / lobby / floor 1 / tutorial music); later = bosses, other
  music, ambience, biomes 2-5.
- **Join:** the loading screen (opaque `background`, title, bar, `Loading n / m`, Skip after `PRELOAD.skipAfterSec`)
  covers the join until the core tier resolved, Skip, or `PRELOAD.timeoutSec`; it fades out over `fadeSec` (instant
  under reduced motion). The first-run gate still decides meanwhile, but its decision (the tutorial, the main menu,
  `KV_SkipMenu`'s solo run) fires only once the screen released (`JoinGate`).
- **After:** the later tier keeps loading; a run start's / floor change's audio and a boss floor's sheets go to the
  front lane. A failed id warns once (`[Preload] image rbxassetid://...: Failure (not retried)`) and never holds the
  screen.
- `KV_SkipLoading` (Workspace, boolean): no screen; the queue still runs. `KV_SpikePreload`: the P0 spike
  (docs/SPIKES.md).

## Stage loader (docs/STAGE_LOADER.md; not run in Studio yet)

Pure half: `shared/view/stageLoader.ts` (`StageLoad`, `stageMerge`, `floorChangeStaged`, `PregenTracker`), tunables
`STAGE_LOADER` / `STAGE_VIEW`, strings `STAGE_STRINGS` (`stage.starting` / `.forging` / `.building` / `.floorCard` /
`.bossFloor`, biome line from `biome.<n>.name`); specced in `stageLoader.spec.ts`. Drawing: `client/ui/loading/StageCard`
(shares `Cover` / `ProgressBar` with `LoadingScreen`, display order `LOADING_VIEW.displayOrder`), Reflex `stage`.

- **Run start** (Play solo, R, Again, the tutorial): the cover at once ("Starting run..." during a ranked start's server
  wait, then "Forging floor 1..."), the run held (no tick, nothing recorded); then, one per frame: build the run,
  the `onRunStarted` listeners, floor 2 pre-generated; the floor's assets (cap 3 s), two settle frames, the reveal.
- **Floor change:** the card "Floor N" + the biome name (+ "Boss floor") cuts in the frame the floor changes; the
  `onFloorChanged` listeners run the next frame; it lifts after the assets (cap 3 s), the settle frames and 0.6 s, on
  the open draft. No draft open: only the rebuild and settle frames. The tutorial's ending change is not covered.
- **Pre-generation:** floor n + 1 is built (`ctx.endlessFloor`) once floor n's draft has been up a frame, so the
  stairwell tick finds it cached; missed ones are built mid-tick by the sim, as before.
- **Co-op:** the client is built in the `partyRunStarted` frame (not covered); listeners deferred; never held; no
  pre-gen; covered frames send neutral input through the menu gate.
- **Input** is neutral while covered and through the fade (held buttons stay masked), pause and the party overlay are
  ignored, no gamepad selection under the cover. KV_Debug bits pass.
- `KV_Debug` adds `[Stage] listeners (...)` per-listener times and `[Stage] floor step T ms` (SL0).

## Main menu, lobbies and Leave run (L3 / L5 / L6, client half)

Pure half: `src/shared/view/menu/` (the screen + back stack reducer `menuNavReduce`, the lobby view models
`browserRows` / `lobbyRoomModel` / `inviteCandidates` / `receivedInvites` / `noticeSpec`, the run handoff and exit
rules `lobbyStartAccepted` / `afterRunPath` / `runOverExits` / `pauseItems` / `restartForfeits`, every `menu.*` /
`lobby.*` string key, layout tunables), specced in `menu.spec.ts` (string keys in `hud.spec.ts`). Drawing:
`src/client/ui/menu/` (`MenuLayer`, ScreenGui `KV_MenuShell`, display order 15: over the HUD, under the pause /
settings layer). Reflex: `menu` (screen, back stack, Leave run confirm, party overlay) and `lobby` (list, my lobby with
its arrival time, received invites, notices, the players in this server).

- **Join**: once the first-run gate decided (a first-time player goes straight into the tutorial instead: "The
  tutorial run" below; until then only the dark backdrop), the main menu over a dark backdrop (no world yet): the
  title, **Play solo** (a ranked solo run; "Starting run..." while the server answers), **Lobbies** ("Your lobby"
  while in one: straight to the room), **Tutorial** (the Practice Descent again), **Options** (the Options screen)
  and **Leaderboard** (the leaderboard panel). Pad: the selection starts on Play solo;
  B / Backspace go back a screen (not while a panel is open: B closes the panel). Escape stays Roblox's menu key.
- **Lobby browser**: one row per lobby the server lists for this player (never closed ones): the preset name
  (`lobby.name.*`; "{host}'s descent" with the host's DisplayName from the Player in this server), count / max,
  Open / Friends, a tag (In run greyed, Starting, Your lobby, Friend inside) and Join (only when not in a lobby, the
  lobby forming and not full). Top bar: the new lobby's visibility (Open / Friends / Closed) and Create lobby (or Your
  lobby while in one). Refresh and Back. Opening the browser sends `lobbyRequestList`; the server pushes changes.
- **Lobby room** (opens on create / join; leaving or a kick goes back to the browser): name, status (waiting /
  everyone ready / `Starting in N...` counted down locally from `countdownIn` / `Run in progress`), members in join
  order (name, `(you)`, Host, Ready / Not ready; the host also sees Kick and Make host on the others' rows while
  forming), host-only controls (visibility, Rename: the next preset), everyone's Ready toggle, Invite (the players in
  this server outside the lobby; `Invited` while `LobbyView.invited` has them), Start (host only: `Start solo run`
  when alone, enabled once everyone is ready), Leave lobby, Back.
- **Invites**: top-right toasts on menu screens (`{from} invites you to {lobby}`, Join / Decline; gone when expired,
  counted from the list's arrival); during a run a `Lobby invites: N` badge (bottom centre). **Notices**
  (`lobbyNotice`) are top-centre toasts for 4 s: refusals read `lobby.err.<code>`, arrivals their `key`, the rest
  `lobby.notice.<kind>`.
- **Roblox invites (docs/INVITES.md I5)**: the lobby room's invite panel starts with **Invite friends (Roblox)**
  (`invitePrompt({ withLobby: true })`; off while the lobby is in a run or full) and the main menu has **Invite
  friends** under Lobbies (`withLobby: false`). Both are disabled with `Invites aren't available on this account or
  device` once the server's `inviteEligible` says `canSend: false` (unknown: enabled). LobbyController sends
  `inviteEligibility` at start and again when a menu screen opens and the last ask is
  `INVITE.eligibilityCacheSeconds` (300 s) old. Friends invited through Roblox (or a party invite) read
  `Invited (Roblox)`; those not in this server yet get their own dim rows (`#<UserId>`: no web name lookups). With
  `INVITE.promptSide` "client" the server's `invitePromptOnClient` opens the prompt here; the local
  `GameInvitePromptClosed` recipients always go back as `inviteRecipients`. Toasts: `{name} joined from your invite`
  (10 s, with **Invite** = the in-server `lobbyInvite` while you are in a lobby with room and they are here, outside it
  and not invited), `Your Roblox party is together in {lobby}`, and the arrival toasts (`That lobby has closed`,
  `Your party's lobby is full`, `That lobby is full`, ...). An arrival the server put into a lobby lands in its room
  (on join, or at once if a menu screen is up; never during a run, the tutorial or the first-run wait; Options /
  Leaderboard stay open over it): shared/view/menu `lobbyChangePath`, `afterRunPath`.
- **Run handoff**: `partyRunStarted` is taken only when its `lobbyId` is the lobby this client is in (replaces the
  old invite consent); `lobbyRunStart` (`kind: "solo"`) starts a ranked solo run the same way. Any run start closes
  the menu. After a run that came from a lobby (while still in it) the run-over panel offers Back to lobby.
- **Leave run**: the pause overlay's Leave run, after the confirm. Solo: `LiveRun.requestForfeit()`; the next frame
  steps the forfeit tick (paused or not), the run is a death, submitted through the normal death / segment / finish
  path, then the run stops and the menu opens (the lobby room while in a lobby, else the main menu). Party runs never
  pause: the pause key opens the **party overlay** over the running run (Resume closes it); Leave run sends
  `lockstepLeave(runId)`, stops the lockstep client and opens the lobby room, which reads `Run in progress` until the
  lobby is back to forming. R / Restart / Again mid-run on a **ranked** solo run is a forfeit too (a death,
  submitted), and the next run starts once that death was submitted; unranked runs restart as before (abandoned). In
  a party run R does nothing until the party is down, then goes back to the lobby (after the party's verdict).
- **A party run the server ended**: when the party's `runFinished` arrives while the party is still up (desync,
  `replay_error`, expiry), the run ends on this client too (`LockstepClient.end`: `isOver()`, nothing more stepped or
  sent): the run-over panel shows `The server ended the run (<reason>) — press R to return` (shared/view/menu
  `partyRunOverLine`; also for a wiped party's run the server rejected) with Back to lobby / Main menu, R goes back,
  and the verdict line reads `Run N (ended by the server): rejected (desync) ...`.
- **Co-op input under a menu**: a party run never pauses, so while a menu owns the controls (the party overlay,
  Options, a rebind capture, Leaderboards, the run-over panel, the Roblox menu: `InputController.menuOwnsInput()` or
  `GuiService.MenuOpened`) the co-op frames carry EMPTY_INPUT (shared/lockstep `CoopMenuInputGate`): no move, no
  buttons, no aim (a pointer over the menu would turn the character; with neither move nor aim the facing stays).
  Buttons still held when the menu closes (the A on Close) stay masked until released. Solo runs pause instead.
- **Run over is a menu**: while the run-over panel shows, the pad drives the GUI selection (Again / Main menu), so
  D-pad down (the pad's restart binding) no longer restarts there; the panel's pad hint is A (Again starts selected).
- When a run stops, the HUD goes inactive (Reflex `endRun`); the world views keep their last frame under the menu
  backdrop until the next run starts.

The old M4 invite flow is gone (task L7): `KV_Party`, `KV_PartyAutoAccept`, `PartyInvitePanel`, the
`partyInvite*` remotes, `shared/run/partyInvites.ts` and the `hud.party.*` strings.

## Co-op spectating (docs/SPECTATE.md; not run in Studio yet)

Presentation only (no sim, lockstep, server or hash change). In a party run a dead player watches a living teammate:
after `SPECTATE.holdOnDeathSec` (1.5 s) on their own corpse the view moves to the living teammate nearest to it;
Attack / Alt (left / right click, RT / LT; the player's own bindings) cycle to the next / previous living teammate in
party order, skipping the dead and the left. The watched player's death holds 1.5 s, then moves to the one nearest to
them; the floor change revives everyone and the view snaps back; a wipe keeps the last view under the run-over panel.
`SimController` owns the `SpectateTracker` (shared/view/spectate.ts) and exposes `getViewPlayerIndex()`, which the
camera, weapon view, bullet transparency, actor ring colour and audio read instead of the local index. The HUD's
vitals (hearts, armor, flask, Embers, weapons) follow the watched player (`SnapshotExtras.vitalsIndex`); boons,
toasts, drafts and the shrine hint stay the local player's. `SpectateBar` (bottom centre): `Spectating <name> · 2 / 3`,
the next / previous hint, `You're back on the next floor`. While dead the co-op frames carry EMPTY_INPUT (plus debug
bits under KV_Debug); buttons held at the revive stay masked until released; a press that began over a GUI button
never switches.

**Studio smoke test**: docs/SPECTATE.md "Studio smoke test" (3 clients, `KV_Debug`).

## The tutorial run (first-run flow, docs/TUTORIAL.md)

1. **Join.** Nothing starts until the TutorialController's first-run gate decides (`shared/tutorial`
   `FirstRunGate` / `firstRunChoice`, specced in `flow.spec.ts`): the menu shell shows only its backdrop
   (`menu.awaitingFirstRun`; no menu, no invite toasts). The client sends `requestOnboarding` (the server also sends
   `onboardingStatus` after its join load) and waits up to `TUTORIAL.statusTimeoutSeconds` (6 s).
   `loaded && !tutorialDone` -> **straight into the tutorial** (no main menu first); done, a failed load
   (`loaded: false`) or no answer -> the normal join flow, exactly as without the tutorial (MenuController: the main
   menu, or a solo run with `KV_SkipMenu`). `KV_Tutorial` overrides it without asking. MenuController waits for
   `TutorialController.onFirstRunDecided`. **Join intent (docs/INVITES.md ID6):** the gate is shared/view/menu
   `FirstJoinGate` / `firstJoinChoice` (`firstJoin.spec.ts`): a choice that would start the tutorial also waits for
   the server's `joinIntent` (the `lobby` slice), at most `INVITE.intentWaitSeconds` (2 s) from join. `lobby` /
   `party` (an invite or party arrival the server already put in a lobby) -> the normal flow, which opens the lobby
   room; `none` or no intent in time -> the tutorial exactly as before. Done / failed load / no status never waits for
   the intent. The log line reads `[Tutorial] first run: <choice> (after t s, join intent <kind | not received>)`.
   The latched choice is provisional until it is dispatched (when the loading screen released): `joinIntent` may come
   more than once (the server upgrades none -> lobby / party when it places the player later, within
   `INVITE.launchDataWaitSeconds` + `intentUpgradeMarginSeconds` of join), so the dispatch re-checks
   (`firstJoinDispatchChoice`): a latched tutorial becomes the normal flow when the player is in a lobby by now or the
   latest intent is lobby / party, unless `KV_Tutorial` is true (log `[Tutorial] first run: tutorial -> normal
   (placed in a lobby, ...)`).
2. **Tutorial run.** `SimController.startTutorial()` (the gate, the main menu's **Tutorial**, Restart tutorial, Play
   the tutorial again): the old solo run is left as by Play solo (submitted as abandoned when it qualifies) and world
   `tutorial` (`buildWorldSetup`, `TUTORIAL.runSeed`) starts **locally**: no `startRun`, no segments, never submitted
   (`unsubmittedReason` = `tutorial`; verdict line `Practice: not submitted (tutorial)`). `RunContext.tutorial` is
   true, `lobbyId` "". Every tutorial start fires `tutorialStarted` and gets a fresh `TutorialDirector`. R / D-pad
   down do nothing (`handleReset`).
3. **Lobbies during it.** The server treats a player in the tutorial as busy (docs/SERVER.md "Onboarding"): no lobby
   create / join / invite, and a lobby Start or countdown with them in it is refused / cancelled. Client side nothing
   can take a running tutorial over: `partyRunStarted` and a solo `lobbyRunStart` are ignored while
   `SimController.inRunningTutorial()` (a finished tutorial on its outro is over: a lobby start may take it), the
   in-run `Lobby invites: N` badge is hidden, and invite toasts only ever show on menu screens.
4. **End.** The director's `finished` (the floor 2 -> 3 change): `SimController.freezeTutorialRun` freezes the run on
   screen at once (a pacer that freezes every frame: no tick, no recording, no events; the floor 3 draft never shows:
   DraftOverlay is hidden while the slice says `ended`), the verdict line shows the tutorial's and
   `tutorialFinished("completed")` goes out in the same frame; `TUTORIAL.outroDelaySeconds` (1.5 s) later the outro
   card opens (only the card waits for the beat).
5. **Outro.** Start my first run = the main menu's **Play solo** (`MenuController.playSolo` -> `startSolo`: a ranked
   run unless KV_Seed / KV_World / stress). Play the tutorial again -> a new tutorial run.
6. **Pause.** Resume / Restart tutorial / Skip tutorial / Options (`pauseItems(false, true)`; no Leave run and no
   Leaderboards). Skip tutorial -> `Skip the tutorial?` -> Skip -> `tutorialFinished("skipped")`, then the run is
   left like Leave run (`SimController.leaveRun`: a tutorial run is stopped at once, unsubmitted, no forfeit) and
   MenuController opens the menu after a run: the lobby room while in a lobby, else the main menu. The replay lives
   in the main menu (Tutorial), not in the pause overlay.

Leaving mid-tutorial marks nothing: the next join offers it again.

**What the client reports (docs/TUTORIAL_FUNNEL.md TF6; not run in Studio yet).** Telemetry only; the server re-reads
every payload (shared/onboarding `read*`) and logs the events. Outside a tutorial the client sends only `loaded` and
`gate`.

| Report | When | Code point |
|---|---|---|
| `onboardingReport({ kind: "loaded" })` | once per session, when the join loading screen releases (core tier, Skip, timeout, or at once with `KV_SkipLoading`) | `PreloadController.release` |
| `onboardingReport({ kind: "gate", reason })` | once per session, when the first-join choice is dispatched; reason from shared/view/menu `firstJoinGateReason` (`forced` / `tutorial` / `timeout` / `loadFailed` / `done` / `party` / `invited`; the status is the one the gate latched with, `firstJoin.spec.ts`) | `TutorialController.dispatch` |
| `tutorialStarted({ entry, device })` | every tutorial run start. Entry: `firstJoin` (the gate, `KV_Tutorial` too), `menu` (main menu Tutorial), `restart` (pause Restart tutorial, HudActions `restartTutorial`), `again` (outro Play the tutorial again, HudActions `playTutorial`), threaded through `TutorialController.playTutorial(entry)`; device = `tutorialDeviceFor(game.inputDevice)` at the start | `TutorialController.onRunStarted` |
| `tutorialStep(step)` | each newly reached funnel step (unchanged) | `TutorialController.frame` |
| `tutorialLesson({ step, seconds, hits })` / `tutorialStuck({ prompt, seconds })` | every director update's `newLessonReports` / `newStuckReports` (copied: the arrays are reused), right after the funnel steps; on the finish frame before `tutorialFinished` | `TutorialController.frame` |
| `tutorialFinished({ outcome: "skipped", stepId })` | Skip: `director.flushMetrics()` goes out first as `tutorialStuck`, then the finish with the view's current `stepId` (`TUTORIAL_NO_STEP_ID` when "") | `TutorialController.skipTutorial` |
| `tutorialFinished({ outcome: "completed", stepId })` | the finish frame, with that frame's `stepId` (the director clears it once finished, so `TUTORIAL_NO_STEP_ID`) | `TutorialController.finish` |
| `onboardingReport({ kind: "outro", choice, seconds })` | once per attempt, when the outro card closes: `firstRun` (Start my first run), `again` (Play again, or Restart tutorial from the pause menu while the card is open), `menu` (another run started, e.g. a lobby start, or the run was left for the menu); seconds = real `os.clock()` seconds the card was open. Leaving the game on it is the server's `left` | `TutorialController.reportOutro` (from `closeOutro`, `playTutorial`, `onRunStarted`, `onRunExited`) |

## The default character

The player is a sim entity, so there is **no character**: both `default.project.json` and `publish.project.json` set
`Players.CharacterAutoLoads = false`. If a place spawns one anyway (a server script calling LoadCharacter, a project
file without the property), the client copes: all controls are sunk, the camera is Scriptable, the world sits 64 studs up
(`GAME_WORLD.originStuds`) above a backdrop slab that hides a character standing on a template Baseplate, and the
character's root is anchored locally so it never falls and respawns in a loop.

## Part budgets

| What | Parts | Notes |
|---|---|---|
| World, seed 1337 (77 x 52) | **134** | 1,431 floor tiles -> 46 Parts, 409 wall tiles -> 87, 0 pools, + 1 backdrop (`tileMerge.spec.ts` prints it) |
| Void (docs/VOID_DECOR.md VD3) | ~290 per endless floor (max ~470; `VOID.maxRects` 500) | one column per greedy rect of shoulder / ledge / outcrop (`plan.spec.ts` prints the census); static |
| Enemy bullets | up to the pool's high-water mark (capacity 2,048; stress raises it) | one Part per slot, never destroyed |
| Player bullets | up to 512 | |
| Actors | <= 64 models (1 Part; capsules 3) + player 3 + pip 1 | models are reused per visual |
| Telegraph dashes | ~10-160 while a preview is up (a 5-lane fan ~80) | TELEGRAPH_VISUAL dashes: 1 stud + 0.75 gap |
| Arena seal | ~144 (seed 1337: 72-tile perimeter, one 1.5-stud dash per 2 studs) | while the boss fight is on |
| Weapon arcs | ~20-60 | 0.5-stud dashes |
| Particles | up to 512 live particles + 16 rings x 32 dots (1,024 Parts at most; budget 128 / 320 / 512 by setting) | grows lazily to the high-water mark, parked when unused |
| Breakables | 1 Part per intact piece (placeholder) or an anchor + BillboardGui (art), + 1 Part per debris decal | pooled per kind; endless floors only |
| Sprite effects | up to 64 live effects + the stairwell loop, each an anchor Part + SurfaceGui (or BillboardGui) + ImageLabel (budget 24 / 48 / 64 by the particle level) | pooled, grows to the high-water mark, parked when unused; none without `fx.*` art |
| Decor | per drawn piece 3 instances (pooled standing bodies; flat Parts per floor); with art ~1,050 per floor; 6 pool + <= 6 fixed PointLights, 1 emitter (<= 150 particles) | nothing but the PointLights with the placeholder pack ("Room decoration") |
| Health bars / damage numbers | 64 / 48 BillboardGuis (built at start, disabled when unused) | Attachments on one anchored holder Part each |

Pools only grow; parked parts sit at y = -10,000. Bullets and markings cast no shadows.

## What is verified where

Headless (`npm run verify`): the input mapping (port of the web `devices.test.ts` with Roblox key names, remaps,
up-positive sticks, debug gating, driver keys), the live loop (one input sample per frame recorded per tick replays to
the same hash at 60 / 144 / 30 / 165 fps and through hitches and pauses; a submission validates with the server's own
`validateRun` on the seed-1337 floor; dying through K is `dead` and the server agrees under dev limits), the HUD
snapshot, the aim ray, the greedy merge (exact cover on random grids and seed 1337), and the marking geometry
(including the boss previews with stand-in constants). Part B: the hit tracker, the juice rules, the hitstop clock and
freeze rules (driving a real FixedStepLoop), bar layout / state, the damage number pool, the particle system (ports of
the web build's tests), the hitstop-vs-replay determinism of the live loop (`liveRun.hitstop.spec.ts`), the audio
mapping and music choice, every sound ID and HUD / settings string key in the placeholder pack, the HUD scale rule
and helpers. Task L4 / L4b: the settings document v2 (v1 migration, unknown versions, sanitize, overrides-only, group
patches; `settings.spec.ts`), the rebinding flow (`rebindFlow.spec.ts`: bind / swap prompt / refusals, capture
events, countdown, test strip, held-input gate), every `options.*` string and action name, the input label tables, the
HUD scale setting and the SoundGroup volume rule (`hud.spec.ts`).

Headless (L3 / L5 / L6, I5): the menu back stack, the lobby browser / room / invite / notice view models (Roblox
invitees, the invite buttons, the arrival toasts, the lobby-change path), the run handoff gate and the exit rules
(`shared/view/menu/menu.spec.ts`), the first-join choice with the join intent (`firstJoin.spec.ts`), every `menu.*` / `lobby.*` string
(`hud.spec.ts`), the solo forfeit (`shared/play/liveRun.forfeit.spec.ts`).

Headless (tutorial client): the first-run gate, the view -> slice copy and the outro beat (`shared/tutorial`
`flow.spec.ts`), the ring / marker pulses, ghost heart fade, the bound-key prompt templates (`tutorialPromptVars`,
every prompt filled on every device) and the tutorial verdict line (`shared/view/hud` `tutorialHud.spec.ts`), the
tutorial pause items (`menu.spec.ts`), and `unsubmittedReason` (`submitPolicy.spec.ts`).

Headless (decor, docs/DECOR.md R4 / R9 / R10): the DecorDirector over the recorded seed-1337 endless run (rooms dark
until entered, the sweep from the entering player, braziers on the clear, the flat boss ring per phase, stairwell
glow, glint and shrine dim, frozen during drafts, the same room facts at 1-5 ticks per frame, reduced motion, resets,
scene mismatches, the Ember gutter, the run-over fade solo and in a party; `director.spec.ts`), the light pool,
flicker, loop frames, facings, fade bodies, footprints, the ambient emitter counts, the scene and the budgets
(`decorFx.spec.ts`).

Studio only: every controller (input polling and sinking, camera, Parts, BulkMoveTo, BillboardGuis, the React HUD,
the menu shell and lobby screens, GUI selection, SoundGroups / Sounds, remotes), the Options screen and the rebinding
capture.

## Studio smoke test

Setup: `npm run build`, `rojo serve`, open a **Baseplate** place, connect Rojo. In Lighting, delete `Atmosphere`
(its haze washes out a scene seen from ~550 studs). Game Settings > Security: enable Studio Access to API Services.
With the actors merged the default `game` world has enemies; without them see "fallback" below.

000. **Stage loader (docs/STAGE_LOADER.md).** Play solo: the cover at once, `[Stage] run 1: forged in t ms, built in
   t ms, revealed at t s` and `[Stage] floor 2 pre-generated in t ms (run start)`; the reveal lands on the knight with
   the camera already there. Stairwell: the card `Floor 2` / `Ancient Halls` cuts in with no stutter, then the draft;
   `[Stage] floor 3 pre-generated ... (during floor 2's draft)` while it is up; pressing confirm under the card does
   nothing. With KV_Debug, spam the floor skip: every change covered, some `built mid-tick (not pre-generated)`, and the
   `[Stage] listeners` / `floor step` timings print (record them in docs/STAGE_LOADER.md). R and Again: covered
   restarts. Party run (3 clients): card on each descent, no desync.
00. **Loading screen (F5; docs/PRELOAD.md).** Output: `[Preload] core N entries, later M (instance entries, chunks of
   4)`, then `[Preload] core N / N in t s (0 failed)` and `[Preload] screen released at t s: core done`; the screen
   (title, bar, `Loading n / N`) fades into the menu or the tutorial. Studio's cache makes it brief. With a slow load,
   Skip appears at 3 s (mouse, Enter, pad A). `KV_SkipLoading` = true: `[Preload] KV_SkipLoading: no loading screen`.
   Later: `[Preload] later done: ...`; a boss floor: `[Preload] front: boss.<kind> ...` (only when it queued
   something new).
0. **Main menu (F5).** With a played tutorial (or `KV_Tutorial` = false on Workspace; a fresh player goes straight
   into the tutorial instead: "Tutorial" below), the main menu shows (title, Play solo, Lobbies, Tutorial, Options,
   Leaderboard) over a dark backdrop; no run starts. Play solo starts the run below (with `KV_SkipMenu` on Workspace the menu is skipped). For lobbies
   use Studio's Test > Clients and Servers (3 players): Lobbies > Create lobby (Open) on Player1 -> its room;
   Player2 / Player3 see it in their browser (`Player1's descent 1/8 Open`) and Join; Ready on all three; Player1's
   Start counts down (`Starting in 3...`) and every client switches to the party run. In the run, P opens `Party run`
   without pausing; Leave run -> confirm -> Leave: that player lands in the lobby room (`Run in progress`), the others
   play on. Solo: P -> Leave run -> Leave: the run ends as a death (verdict submitted) and the main menu shows.
   Invite (from the room) shows a Join / Decline toast on the invited player's menu; Kick sends the `You were
   removed from the lobby` toast and puts them back in the browser; a closed lobby never lists.
   **Roblox invites (I5; needs the server half, I4):** the main menu shows Invite friends, the room's Invite panel
   Invite friends (Roblox) (Studio cannot open the real prompt: expect the server's failure warning or nothing).
   `KV_FakeInviteEligible` = false (docs/SERVER.md for where the server reads it): both buttons grey with `Invites
   aren't available on this account or device`. Fresh profile (a never-saved Studio test user, or the onboarding doc cleared) with
   `KV_FakeLaunchData` naming Player1's lobby: Output `[Invite] join intent: lobby`, `[Tutorial] first run: normal
   (... join intent lobby)` and the client opens the lobby room, not the tutorial; Player1 sees the joiner in the room.
   The same fresh profile without the attribute: `join intent none` and the tutorial within 2 s (6 s at most with no
   status). A launch naming a deleted lobby: the main menu with `That lobby has closed`. A `kv1|g|<Player1 id>`
   launch: Player1 gets `<Name> joined from your invite` with Invite while Player1 is in a lobby.
1. **Start (Play solo).** Output: `[Sim] run 1 started: seed 1337, world game` and `[World] built 134 parts (...)`.
   The view is an angled top-down dungeon (dark floor, lighter walls one tile tall), the tan capsule (the player)
   centred, a small light diamond on the floor in front of it. No Roblox character, health bar or backpack is
   visible. HUD (pixel font): top left `HP` + three red hearts, `Flask` + three gold dots, `Ember` + two amber
   diamonds; bottom left two weapon slots `1 Sword` (gold ring, opaque) and `2 Bow` (dim), `E swap` under them;
   bottom right `Project Kaleb-Vale · <biome name> · seed 1337 · <dungeon name>`. Nothing overlaps the top bar or a
   notch.
2. **Move.** W moves toward the top of the screen, D toward the right, diagonals at the same speed; walls block. The
   camera follows smoothly with a slight lag and the floor does not shimmer. Arrow keys also move.
3. **Aim.** Move the mouse around the player: the diamond follows the pointer's direction.
4. **Sword.** Hold left click: dashed pale fans appear in front (two swings, then a lunge and a wider gold finisher
   fan) with a bright blade line sweeping across each. Right click: a wide blue fan (guard), then a 1 s cooldown.
5. **Swap.** Press E: the gold ring moves to slot `2 Bow`. Hold left click: thin bolts stream toward the
   pointer, 5 per second. Hold right click: a ring fills around the player plus a growing aim line (gold when full,
   ~0.6 s); release when full: a thick bolt flies and a white ring flashes.
6. **Roll / flask / Ember.** Space: the capsule tumbles forward ~2.5 tiles (blue-grey tint during i-frames). F at
   full health does nothing (flask only heals when hurt). Q: one Ember diamond empties, every enemy bullet
   disappears.
7. **Enemies (actors merged).** Walk into the first combat room: green balls (swarmers) rush you, blue wedges
   (snipers) show an orange dashed aim line before shooting pink neon balls, red blocks (bruisers) flash and send an
   orange dashed shockwave ring with a gap. Enemies flash near-white when hit, fade out when killed. Getting hit:
   the last heart turns half red and the capsule blinks for ~0.75 s.
8. **Pause.** P: the scene dims, the overlay shows `Paused`, `Resume`, `Restart`, `Options`, `Leaderboards`, `P to resume`;
   everything freezes; P again (or Resume) resumes, and the click on Resume does not swing the sword. Restart starts
   a new run. Escape (Roblox menu) also freezes the game with no pause overlay under it; closing the menu shows the
   pause overlay (the run stays paused until Resume / P). The round pause button in the top bar (right of Roblox's
   buttons, only while playing) pauses the same way, and clicking it does not swing the sword.
9. **Boss.** (Faster: set `KV_Debug` and `KV_SpawnBoss` true on Workspace, then R.) Enter the boss room: a large
   yellow block wakes, a translucent yellow fence of dashes outlines the room (the seal), the top centre shows
   `Mother Bramble` and `Phase I` over a yellow bar with two white notches (66 % / 33 %) that shrinks as you hit it;
   the phase reads `II` / `III` past each notch. Before every attack orange
   dashed previews show exactly where the bullets will go (5 fan lanes, ring arcs with two gaps, spiral arms with
   arrow heads, the slam lane), dim then bright, blinking at the end. Phase changes show expanding yellow roar rings.
   With KV_Debug, J takes 10 % off.
10. **Victory.** Kill the boss: a short freeze, then ~0.5 s of slow motion, the camera jiggles one pixel, three
    waves of yellow particles. The centre panel: `Victory` (gold), `Mother Bramble defeated — press R to play again`,
    `or A`, the time, hits taken and kills. Bottom right `Run 1 (victory): submitted, checking...` then
    `Run 1 (victory): verified by the server (<hash>)`.
    (A boss-door / K / J run is rejected `debug_spawn` / `debug_input` unless the server has `KV_AllowDebugRuns`.)
11. **Death.** R, then let enemies (or K with KV_Debug) take all hearts: the capsule lies down grey, the centre panel
    `Run over` (red), `You died — press R to retry`, `or A`, the time survived, hits taken, kills; the verdict
    line `Run 2 (death): ... verified`. Press R: a fresh run from the entrance (`[Sim] run 3 started`), the panel
    disappears, the floor is not rebuilt (no new `[World] built` line).
12. **Abandon.** Play at least 10 s, press R: the old run is submitted as `abandoned` (Output: `[Sim] submitted run N
    (abandoned): T ticks, B bytes, hash H`; the recording goes as a binary `buffer`, docs/SERVER.md "The wire
    format"). Press R again within 10 s: not submitted (`not submitted (short)` on the verdict line), unless that run
    was the first after a death. More than 6 submissions a minute answer `rate_limited` (expected). A recording over
    the server's byte cap (`MAX_RECORDING_BYTES`, ~20 min of play) is never sent: the verdict line shows
    `rejected (too_large) not sent: recording over cap` (rules: `shared/play/submitPolicy.ts`, docs/SERVER.md
    "Client submit rules").
13. **Replay check (KV_Debug).** Play 20 s, press F8 (or L): Output `[Sim] replay check @ tick N: MATCH`, the HUD's
    debug line (monospace, bottom right) `replay match @ N`. Repeat right after a boss phase change or a kill (a
    freeze frame was just applied): still MATCH.
14. **Seed change.** Set `KV_Seed` = 42, press R: a different floor (`[World] built ...` again).
15. **Gamepad.** Connect a controller and repeat 2-11 with the pad: left stick moves, right stick aims (the diamond
    follows it and keeps the last direction when released), RT attack, LT guard / charge, Y swap (the hint now
    reads `Y swap`), LB roll, D-pad up flask, RB Ember, Start pause. After a death or victory the run-over panel
    has `Again` selected: **A** restarts (D-pad right moves to Main menu); mid-run D-pad down does nothing. Moving the mouse switches aim back to the mouse. Start opens the pause
    overlay with `Resume` selected; D-pad / stick move the selection, A presses, Start resumes; `Options`
    opens the Options screen with the `Juice` tab button selected, A picks, B closes it (back to the overlay).
16. **Stress (optional).** `KV_Stress` = 1000, R: rings of pink bullets from the entrance; check fps (Shift+F5 /
    MicroProfiler label `KV Bullets`). Verdict line: `not submitted (stress)`. Clear the attribute and press R.
17. **Fallback (no actors merged).** HUD info line in orange: `enemies unavailable (Unknown archetype ...); playing
    the floor without enemies`. Steps 2-6, 8, 11 (with K), 13-16 still apply. Set the server's
    `KV_RunValidationWorld` = `dungeonNoEncounter` so submissions verify.
18. **Health bars and damage numbers.** Hit a swarmer with the bow: a 2-pip bar appears above it (pips fill red, the
    lost one flashes light then empties), a small light `1` pops above and rises ~3 studs while fading (~0.7 s); a
    bow stream on one enemy keeps adding into one number. A bruiser shows a red bar with a light chip that drains
    after ~0.15 s; the sword finisher shows a bigger yellow number. The bar fades ~2 s after the last hit. Boss hits
    show numbers low on the boss's body; when its damage cap absorbs hits a grey `CAP` appears beside it (at most
    every 0.5 s). No bar over the boss (the top bar is its).
19. **Kills, freeze frame, particles.** Kill a swarmer: a ~50 ms hitch (the world holds still, then continues with
    no jump), a burst of green and orange/white bits that hop and fade in ~0.5 s, and a ring of dots. A bruiser: a
    slightly longer hitch and 3 bigger chunks. Kill a whole pack at once: the hitches never add up past ~150 ms per
    second. Boss phase 2 / 3: a 120 ms hitch, a 1-pixel camera dip, yellow roar sparks.
20. **Juice settings.** Press O mid-fight: the game pauses behind the `Options` screen, tabs Juice / Controls / Audio /
    Display, Juice open; rows Enemy health bars (Always /
    When hit / Off), Damage numbers (On / Off), Freeze frame on kill, Particles (Off / Low / Normal / High), Reduced
    motion, `(system: off)`, Reset to defaults, Close, `O to close`. Pick Always: close: every enemy shows a bar.
    Damage numbers Off: no numbers. Freeze frame Off: kills no longer hitch. Particles Off: no bursts; High: denser.
    Reduced motion On: no hitches, no camera nudge, numbers fade in place, bars do not shake, fewer and slower
    particles. Leave and rejoin (Studio API access on): the choices come back (`settingsChanged`). Reset to defaults:
    everything back, reduced motion follows the Roblox setting. In Studio's Roblox settings, turn Reduce Motion on:
    with no override, `(system: on)` and reduced motion applies at once. Without API access the panel says `Not
    saved yet: the server has not answered` and the choices still apply for the session.
21. **Audio (silent today).** With the placeholder pack nothing plays and SoundService has two SoundGroups `sfx` and
    `music` and an empty `KV_Audio` folder. To hear it: in `packs/placeholder/manifest.ts` set e.g.
    `"sfx.ember": { kind: "sound", assetId: "rbxassetid://<an audio id you own>", volume: 0.8 }` and
    `"music.biome.1": { kind: "sound", assetId: "rbxassetid://<n>", volume: 0.5 }`, rebuild: Q plays the Ember sound
    (in the `sfx` group), the biome track loops, entering the boss room cross-fades to `music.boss` if set, dying
    fades the music out.
22. **Phone / console layout.** Studio's device emulator (a phone in landscape, an Xbox / 1080p TV): the HUD keeps
    its layout, scaled (never below 0.6 of the reference size), inside the safe area; the pause overlay and the
    Options screen fit on screen and are usable by touch.
23. **Rebinding (Options > Controls).** O, Controls: Keyboard & mouse rows `Move up  W  Up arrow  Clear`, ...,
    `Attack  Click  -`. Click `E` on Swap weapons: `Press a key... (5)` counts down; press G: the row reads `G`, close,
    the weapon panel says `G swap`, G swaps and E does nothing. Swap again, press Q: `Q is already used by Ember.`
    [Swap] [Cancel]; Swap: Swap weapons = Q, Ember = G; Cancel (or pad B) changes nothing. Press Escape (or wait 5 s)
    during a capture: cancelled, nothing changed, the Roblox menu may open. Press P or Tab: `P is reserved and cannot
    be bound`. Press R during a capture: bound if free, and the run does NOT restart. Capture Left Shift into Dodge roll
    and keep it held while closing with the mouse: no roll until Shift is released and pressed again. Clear on Move up: the
    secondary reads `-`, the arrow no longer moves up. Hold W / click: the test strip lights `Move up` / `Attack`.
    `Reset Keyboard & mouse` asks first; Reset: the defaults are back. Gamepad sub-tab (with a pad): one `Button`
    column (RT, LT, LB, ...), select a row with the D-pad, A: `Press a button... (5)`, press X: bound or the swap
    prompt opens with `Swap` selected; the selection returns to the row after it; the rows behind a prompt cannot be
    selected. Leave and rejoin: the bindings come back. With `KV_ResetBindings` on Workspace, rejoin: the defaults
    are back (juice / audio / display choices kept). The draft hint, shrine hint, restart line and leaderboard hint
    name the rebound keys.
24. **Audio / Display tabs.** Audio: `-` / `+` steps Master / Music / Sound effects by 10 % (0..100 %); SoundService's
    `sfx` / `music` SoundGroup Volume follows (Explorer; music = 0.6 x master x music). Display: HUD scale 80 % shrinks
    every panel, 125 % grows it, at once; it survives a rejoin. Each tab's Reset to defaults resets only that tab.

### Room decoration (docs/DECOR.md R4 / R9 / R10; not run in Studio yet)

25. **Placeholder pack.** Output `[Decor] floor 1 (kept, biome.N): plan E (...), drawn 0 (~0 instances), T ms` and
    `[DecorFx] P pool candidates, 0 flames, 0 glows, F fixed lights, 6 ring pits, 0 glints, ambient none`. Darken
    Lighting (e.g. ClockTime 0, Ambient / OutdoorAmbient black, Brightness 0) to see the lights: walking into a room
    turns its torch lights on one after another from the door; corridor torches are on from the start; never more
    than 6 pool lights at once (Explorer: `KV_DecorFx`), handed over with fades as you walk. Note `T` (plan time) on
    PC and the phone emulator.
26. **Boss floor** (`KV_Debug`, N to floor 5): the boss room is dark until Mother Bramble wakes; the ring lights come on
    a third per phase (J), all steady after the kill; the stairwell light comes on with the stairwell.
27. **Shrine / pedestal**: the shrine room's 2 lights dim once the curse is taken.
28. **Ember / death / pause / draft**: Q flickers the lights down for 0.3 s; dying fades them to blue; P and a boon
    draft freeze the flicker and the sweep; Reduced motion: rooms light all at once, no flicker.
29. **Bands and debug**: `KV_DecorBand` 0..3 rebuilds the floor at once (fewer lit torches deeper: `litTorchShare`);
    `KV_DecorDebug` true draws the fade boxes, footprint cells (each must sit on a wall) and breakable cells.
30. **With art (after R5)**: pieces on far-wall tops line up with the walls, wall torches sit on the faces the camera
    sees, a pillar or column fades when you walk behind it, flames loop out of step, the ambient motes / embers /
    snow / wisps / spores drift around the camera (none under Reduced motion), and no piece ever hides a bullet. Write
    down fps, instance counts and texture memory on PC and the phone emulator.
31. **Co-op (2 players)**: both clients light the same rooms; the cold fade only when both are down.

### Enemy outlines (docs/OUTLINE.md O6; not run in Studio yet)

- **Placeholders:** every archetype, the dummy and Mother Bramble show a red rim on every biome and at every
  `KV_DecorBand`; Explorer shows them under `KV_Actors/Enemies` with one `EnemyOutline` Highlight; a kill moves the
  body to `Corpses` and the rim goes at once, with no flicker; a crowded room (or the boss summoning swarmers) keeps fps.
- **Switch:** `Workspace:SetAttribute("KV_EnemyOutline", false)` hides every rim at once; `true` brings them back.
- **Sprites (after the skeleton re-upload):** the skeleton stands where it did (pivot moved with the pad), the rim
  sits behind the body and follows every facing and frame, it goes at death, comes back on pooled reuse; the player
  has none. Compare the sprite rim's width with the Highlight's on PC and the phone emulator (tune `widthPx`).
- **Readability:** the rim never reads as an enemy bullet or a telegraph; write down fps and texture memory.

### Player outline (docs/PLAYER_OUTLINE.md P7; not run in Studio yet)

- **Solo, vale pack:** a thin near-white rim around the knight in every animation and facing (idle, run, roll, hit,
  the three attacks); it blinks with the post-hit blink, goes at death, and walls hide it with the body. Roll
  afterimages have none. Compare it with the enemy rim and the ring on PC and the phone emulator (1 px: tune
  `widthPx` if it shimmers or vanishes).
- **Placeholder pack:** the capsule shows a near-white Highlight rim; Explorer shows it under `KV_Actors/Players/Outlined`.
- **Switches:** Options > Display > Player outline Off hides it at once and survives a rejoin;
  `Workspace:SetAttribute("KV_PlayerOutline", false)` hides it, `true` brings it back.
- **Co-op:** only your own knight has it; once dead, it moves to the teammate you spectate and follows Attack / Alt.
- **Readability:** every biome and `KV_DecorBand`, snow especially; it never reads as a bullet, telegraph or boost.

### Demon Lord (docs/BOSS_DEMONLORD.md D6 / D7; not run in Studio yet)

Reach a Demon Lord floor: `KV_Debug` = true, `KV_Seed` = 1 (floor 5 holds the Demon Lord; also 2, 8, 9, 13, 14, 1337;
Mother Bramble on 3, 4, 5, 6, 7, 10: `node scripts/find-boss-seed.js`, `--floor 10` for later boss floors), endless
world (`KV_World` unset), Play solo, then **N** on floors 1-4 (debug floor skip) and walk into floor 5's boss room.
**J** takes 10 % of his hp per press (never past a phase threshold) to reach phases 2 and 3 fast.

- **Placeholder pack / no ids yet:** a tall narrow red block (9 x 12 x 9 studs) with the red rim; HUD boss bar `The
  Demon Lord`. Previews: while he walks at you nothing is drawn; then the cleave's 7 dashed lanes ending ~4.5 tiles
  out with an arc across their ends, the hellfire ring with 3 gaps (one on you), the charge lane to where you stood
  with the impact circle and the shockwave arc (gap toward him), in phase 3 the double cleave's second, offset arc
  ahead of him and the summon rings where the swarmers land. Bullets leave exactly along the lanes / out of the gaps.
  The roar rings on engage and on each phase change; the arena seal stays up for the whole fight.
- **Sprites (after the D7 upload):** idle when standing, walk while chasing / walking home / charging; the overhead
  swing over the cleave's wind-up, landing about when the arc fires; the level swing for the hellfire and from the
  charge's impact; rising from the crouch on engage and when summoning; the laugh on phases 2 and 3; the death darkens
  and holds, then fades over the last 40 % of the 1.5 s corpse time. 16 facings follow his heading. Check that bullets
  and markings draw over the large sprite and the rim stays on.
- **FX and audio:** the slam burst on his charge impact (and on Mother Bramble's slam on a Bramble seed), never during
  a wind-up; the boss death bursts and the phase effect as for Mother Bramble; the roar on engage; on phases 2 / 3 the
  roar until `sfx.boss.taunt` has a clip, then the taunt.
- **Bramble regression (seed 3):** her placeholder, previews, slam cue and roars exactly as before.

### Boost drops (docs/BOOSTS.md B6 / B7; not run in Studio yet)

Needs a run with `SimConfig.drops` (endless after B4; before that, set `drops: DROPS_CONFIG` on the endless config
locally) and `KV_Debug` = true.

- **Each kind:** Semicolon (the debug drop key; M before docs/MINIMAP.md MD11) drops Fury, again Quickstep, then Frenzy, Aegis (cycling), 1.5 tiles ahead of the facing: a small
  gem in gold / aqua / lime / lavender pops in, bobs, sits under `KV_Drops`. Visible on every biome floor (N through
  floors 1-20 and drop one on each), never hiding a bullet or an enemy behind it.
- **Fade:** leave one: it blinks for its last 2 s and vanishes at 10 s with a small poof. Options > Juice > Reduced
  motion On: no bob, no pop, a steady dim instead of the blink (HUD row too).
- **Pickup:** walk over it: a burst in its colour, the toast `Fury: +50% damage for 30 s`, a coloured disc under the
  player, the boost row's icon + bar appear and drain; under 2 s it blinks; at 0 the disc and entry go. Pick up two
  kinds: two concentric discs, two entries. Pick the same kind again mid-way: its bar resets to full.
- **Aegis:** pick it up: a lavender diamond after the armor pips; K (one hit): the pip goes (no heart or armor lost),
  the aura and entry go.
- **Readability:** in a bullet storm (`KV_Stress`), the discs never cover a bullet; fps unchanged with 4 drops and
  4 boosts.
- **Co-op (2 players):** player A picks a drop: B sees the burst and A's disc; only A gets the toast and the row.
- **Debug key gating:** without `KV_Debug`, Semicolon does nothing; Options > Controls refuses Semicolon for any action.

### Boost drop art (docs/BOOST_ART.md BA3 / BA5; not run in Studio yet)

Needs the vale pack with the boost images, `decor.fx.glow` / `decor.fx.glint` (decor atlas) and `ui.marker.boost`
uploaded (`assetIds.ts`), a run with drops and `KV_Debug` = true.

- **Each biome (floors 1-5 of the five biomes):** the debug drop key (Semicolon) four times: gold coins, blue / green / white gems, each on a halo in
  gold / aqua / lime / lavender (never the pedestal's yellow), a thin beam in the same colour rising from it, a glint
  twinkling on the prop. Each reads at a glance next to bullets, decor (no gems left in the decor) and a relic
  pedestal (its beam clearly taller). The halo lies under telegraphs, the aim line and every bullet, over decor flats.
- **Sizes:** the gems ~half a tile wide, the coins no taller than the placeholder gem was; phone emulator size too.
- **Stack:** the four glints are out of step; the prop and glint bob, the halo breathes with the bob, the beam stays
  put. In the last 2 s the whole stack blinks together and goes at 10 s (poof); nothing is left behind on the floor
  (`KV_Drops` holds only parked parts far below).
- **Pickup:** walk over one: the glint plays once at double size over a growing, fading halo in the kind's colour
  (no particle burst unless the pack has no boost art).
- **Reduced motion** (Options > Juice): no bob, no halo pulse, every glint frozen on one frame, a steady dim instead of
  the blink; the pickup glint holds one frame and fades, the halo flash fades without growing.
- **Without the beam image** (blank `ui-marker-boost.png` id): drops draw halo, prop and glint, no beam, no errors.
- **Co-op (4 players), four drops at once:** fps unchanged (16 small instances), no overlap mess where drops lie close;
  each client sees the same drops and pickup flashes.

### Tutorial (docs/TUTORIAL.md "Studio smoke test")

Run the tutorial checklist in docs/TUTORIAL.md ("Studio smoke test", steps 1-8) with `KV_ResetOnboarding` on the
server or `KV_Tutorial` = true on Workspace. Client-side checks first (this code has not run in Studio yet):

- F5 with `KV_Tutorial` = true: Output `[Tutorial] KV_Tutorial = true ...`, `[Tutorial] first run: tutorial`,
  `[Sim] run 1 started: seed 4242, world tutorial (tutorial: local, not submitted)`, no `startRun` line and **no main
  menu** (not even for a frame: only the dark backdrop before the run); the objective card at the centre, 2 of 3
  hearts. A click within 0.75 s does nothing, after it the card goes.
- The TutorialPanel (lower centre) reads the device's words; switch to a gamepad: the text and `Start: pause / skip`
  follow. Rebind Flask to G (Options > Controls): the flask prompt says `G`. The flask row pulses (gold ring);
  Options > Juice > Reduced motion On: the ring stops pulsing (static).
- A gold beam stands on the next room's door, bobbing; it moves on as lessons finish; none inside a lesson room.
- First harmless hit: a toast, a fading half heart after the hearts, the hearts row ringed for 4 s.
- P: Resume / Restart tutorial / Skip tutorial / Options (gamepad: the first is selected; no Leave run, no
  Leaderboards). Skip tutorial -> `Skip the tutorial?` Skip / Keep playing (Keep playing selected on a pad); Keep
  playing returns; P closes it. R and D-pad down do nothing. Skip: `[Tutorial] skipped`, `[Menu] run left: back to
  the main menu`, the main menu shows; rejoin: the main menu (the skip counted as done).
- KV_Debug: N (floor 2; pick a boon), N again (floor 3): the run freezes (no draft cards), the verdict line `Practice:
  not submitted (tutorial)`, ~1.5 s later the outro (dimmed; gamepad: Start my first run selected). Start my first
  run: what Play solo does (a ranked `startRun`, "Starting run..."); Play the tutorial again: a fresh tutorial
  (`tutorialStarted` again on the server log).
- Main menu -> Tutorial: a fresh tutorial run (`[Sim] run N started: ... world tutorial`).
- `KV_Tutorial` unset, no API access: `[Tutorial] first run: normal` within a second (the server answers
  `loaded: false`) or after 6 s, then the main menu; its Tutorial entry starts it.
- Lobbies (2 players, one fresh): the fresh player's tutorial is never replaced by a lobby run; inviting them answers
  `Finish your current run first`; no `Lobby invites: N` badge shows during their tutorial.

### Mobile (docs/MOBILE.md MB14; not run on a device yet)

1. Emulator, iPhone landscape: no stock thumbstick or jump button. The controls show in a run and hide under the pause
   overlay, the boon draft and the full map.
2. Emulator, one finger: walk, attack and roll; tap a boon card to pick it.
3. Emulator: the corner map and the weapons panel are gone, and the tutorial prompt is at the top, under the boss bar.
4. Device: three fingers at once (move + attack + roll).
5. Device: a bow release keeps its aim after the Attack stick lifts (the 0.25 s latch); the auto-target ring shows under
   the enemy the centre ring would hit.
6. Device: spectate Next / Prev in a co-op run after a death; left-handed (mirrored controls); touch sizes 80 % and 120
   %.

### Draft reveal (docs/DRAFT_REVEAL.md DR9; not run in Studio yet)

1. Endless floor 1 -> 2: the backs rise as the floor card fades, flip one by one (climbing clicks); attack mashed
   through the card picks nothing; one press during the flips skips; the hint reads wait until settled.
2. `KV_DraftRevealDebug` = `c,l,r`: the centre card's charge (others dim, music dips, tremble, red eyes, gold glow,
   rising ladder), hush, flare, sting, halo; pick it: the stamp and the pick sound. Then `l,l`, `r`, and a skip mid-charge.
3. Reduced motion (crossfades, same timing; nothing confirms on the reveal's first frame), touch (a tap mid-reveal
   skips, a tap after settle picks), gamepad RT, co-op (each client its own reveal, the waiting line), HUD scale 70 %,
   the tutorial's floor 2 draft, the placeholder pack (flat cards in the boon colours).
4. Once the six `ui-draft-*.png` are uploaded: the sliced faces, back and skulls crisp at 720 / 1080 / 1440 p, the
   flip squash on the art, the dim / flash / glow following the card's body.

### Combo (docs/COMBO.md CB9; not run in Studio yet)

1. Endless floor 1: chain 10 kills: the kill sound climbs, RAMPAGE slams in with the sting and the floor shout, the
   meter turns coral; push on to CARNAGE (pulse), DOMINATING, UNSTOPPABLE (shine).
2. A tier-up inside a dense ring: every bullet draws over the shout, which ducks to 15 % while one crosses it.
3. Stop killing in a live room: the blink, then the shatter (whole-track shards, grey, struck value, COMBO LOST) and a
   1-texel kick; clear a room and walk out: the silent lapse with BEST.
4. Take a hit at x3.2: red flash, shake, `-x1.6` drop, the next kill lower; a hit at x1.0: nothing.
5. Die mid-combo, and cross a stairwell mid-combo: no sting or shatter after the run ends or under the stage card.
6. Co-op, reduced motion, Screen shake off, touch, HUD scale 70 %; `KV_ComboDebug` = `1`..`4` / `break` / `small` /
   `lapse` / `cut`.

### New best (docs/NEW_BEST.md "Studio check"; not run in Studio yet)

1. `KV_NewBestDebug` = `score:2000`, endless floor 1: `2000 TO BEST` dim, ember and pulsing near 1800; as the shown
   number passes 2000 (try a room bonus landing, also under a stairwell card): fanfare, gold flare and shine, slam,
   NEW BEST! floor shout, edge confetti; then `NEW BEST +n`. Pause right after: the confetti hides.
2. `floor:2`: floor 2's card `Record floor`, floor 3's `NEW DEEPEST` with the fanfare at the reveal, floor 4's
   `Deepest yet`.
3. Die after both: the record jingle, ribbon, rolling rows, confetti, `Saved` after the verdict; press R or Again before
   the verdict: the next run's target is the score just set, not the old best.
4. `KV_FakeRecords` = `none` / `unknown`, touch (compact line under the combo line), HUD 70 %, reduced motion, co-op.

### Treasure rooms (docs/TREASURE.md "Studio check"; not run in Studio yet)

Follow docs/TREASURE.md "Studio check" (eight steps, `KV_Debug` + `KV_TreasureDebug` + `KV_TreasureLabel` in the dev
world) and TR7's "Studio-only assumptions to check first". Client-side additions over the plan: the floor toast shows
only after the stairwell card has faded (and after the boon draft); the minimap mark is the chest's floor colour and
turns into a ring once opened; with the placeholder pack every vault sound is its fallback (combo break, stairwell
open, relic take pitched by tier, PERFECT jingle).

## Gotchas

- Typing in chat never drives the game: the keyboard poll is skipped while a TextBox or the TextChatService input
  bar (`ChatInputBarConfiguration.IsFocused`; the bar is in CoreGui, invisible to `GetFocusedTextBox`) has focus.
- Keys bound by the game are sunk by ContextActionService: with spike A on, its 1-4 / P keys may not reach it while
  the game runs (the spikes are debug tools; use their HUD buttons).
- Shift lock (if the place enables it) changes the mouse behaviour; turn `EnableMouseLockOption` off in StarterPlayer.
- Roblox may route gamepad Start to its own menu; the run pauses either way.
- The boss previews import the boss.act1 constants from `shared/sim` by name
  (`src/client/controllers/render/bossAct1.ts`), so a rename fails the build.
- Bullet outlines (the `*BulletOutline` roles) are not drawn (a Highlight per bullet is far over budget).
- Juice draws with BillboardGuis (`AlwaysOnTop`): bars and numbers are drawn over walls and bullets, like the web
  build's depth-test-off batches. Their pixel sizes are the web build's render px at 0.25 studs per px; the
  placeholder's screen-space top edge (`placeholderScreenSize`) stands in for the sprite's top.
- The digit font strip (`ui.font.digits`) is a placeholder, so damage numbers are text in the HUD font. When a strip
  is uploaded, switch DamageNumberController to ImageLabels with `ImageRectOffset` per glyph (DIGIT_FONT layout).
- Freeze frames slow the run in wall time only: a frozen frame records nothing, so a run with many kills takes a
  little longer in real time than its tick count suggests. The server never sees it (it replays ticks).
- The pause overlay hides while the Roblox menu is open (the run is paused) and shows once it closes.
- Dungeon props and torches are drawn by DecorController only where the pack has `decor.*` art (none in the
  placeholder and vale packs yet); arches and chests are never drawn (docs/DECOR.md). Pools use the Dungeon Forge theme's liquid colour (as the web build), since the theme has no pool role.
- Every HUD text is a theme string now (`hud.verdict.*`, `hud.seed`, `hud.info`, `hud.notice.fallback`,
  `hud.debug*`, `hud.pause.*`, `hud.ending.*`, `hud.restartAlt`, `fx.settings.reset / close / system / offline`,
  `fx.cap` were added to the placeholder pack). Keys, IDs and enum names stay in code.
