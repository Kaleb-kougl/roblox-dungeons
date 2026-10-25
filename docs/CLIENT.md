# Client (task 8): the playable game loop, HUD, juice and audio

The client runs the deterministic sim live (single-player first, PLAN.md), draws it with theme placeholders, and at
the end of a run sends the recording to the server, which replays it (docs/SERVER.md). Part A built the loop and the
renderers; part B added the React HUD, the juice layer (health bars, damage numbers, freeze frame, particles, camera
nudge), the juice settings panel and audio. Everything presentation-side reads the sim and never writes it.

## Controller map

| Controller | File | Job |
|---|---|---|
| `ThemeController` | `src/client/controllers/game/ThemeController.ts` | Loads the theme pack in `onInit`; every visual comes from it (placeholder shapes + colour roles). |
| `InputController` | `.../game/InputController.ts` | Polls keyboard, mouse and the gamepad once per frame into an `InputFrame` (pure mapping: `shared/play/inputMapping.ts`). Sinks every bound key and both sticks in ContextActionService (High priority) so stock controls never act. Mouse aim: camera ray through the pointer onto the floor plane. Tracks the last-used device for the HUD hint (`game.inputDevice` in Reflex). Reports driver keys (R, F8 / L, D-pad down). |
| `SimController` | `.../game/SimController.ts` | Owns the live run: `buildWorldSetup(world, seed, { atBossDoor })` (the server's own world registry; `endless` by default), a `LiveRun` (`shared/play/liveRun.ts`), pause, restart, F8 replay check, the ranked start (`startRun`), per-floor segments (`submitSegment`, cut on `floorChanged`) and `finishRun`, the unranked `submitRun`, verdicts, the ~10 Hz HUD snapshot. Read-only accessors for views: `getContext()` (the current floor's config / dungeon in endless runs), `getState()`, `getAlpha()`, `getFrameEvents()`, `onRunStarted(cb)`, `onFloorChanged(cb)` (endless: WorldController rebuilds, CameraController snaps). |
| `CameraController` | `.../game/CameraController.ts` | Spike B's iso rig on the live run: Scriptable, FOV 7, yaw 45 / pitch 55, distance for 16.875 tiles of view height, damped follow (tau 1/6 s) of the interpolated player, 1-texel snap. Snaps to the player at every run start. Stands down while `KV_SpikeCamera` is on. |
| `WorldController` | `.../game/WorldController.ts` | Builds the floor: greedy-merged floor / wall / pool Parts (`shared/view/tileMerge.ts`) in the biome's `tile.biome.N.*` placeholder colours, plus one backdrop slab (`background` role). Rebuilds only when the floor changes. When the pack has the biome floor tile as an image with `tilesPerImage`, each floor slab gets a top-face `Texture` repeating every `tilesPerImage * STUDS_PER_TILE` studs (colour stays the biome's). Each Part takes the biome's `materials` (`ThemePack.biome(id).materials.floor / wall / pool`, `Enum.Material[name]`, SmoothPlastic by default); a textured floor is always SmoothPlastic. Solid pillars are WALL tiles and merge into the wall Parts. |
| `CharacterController` | `.../game/CharacterController.ts` | Makes a spawned default character inert (root anchored locally); see "The default character". |
| `BulletRenderController` | `.../render/BulletRenderController.ts` | Both bullet simulations: one pooled Part per bullet slot, interpolated with `previousPositionAt`, ONE `workspace:BulkMoveTo` per pool per frame (spike A), parked far below when unused, pool grows lazily to the high-water mark. |
| `ActorRenderController` | `.../render/ActorRenderController.ts` | One placeholder model per occupied actor slot (archetype index -> `archetypeAt(kind).data.spriteId` -> placeholder), facing, hit flash, telegraph pulse, corpse fade, removal; the player capsule with facing pip, roll tumble, i-frame tint, hurt blink, death pose. One BulkMoveTo per frame. Sprite-backed IDs draw a `SpriteView` instead (see "Sprites replace placeholders"). |
| `SpriteView` | `.../render/SpriteView.ts` | One pooled sprite for a theme `sprites` set: a BillboardGui + ImageLabel on an invisible feet-anchor Part (moved in the actors' BulkMoveTo). Size / StudsOffset from `spriteBillboard` (pivot pixel on the feet), `ResampleMode` from the set, `LightInfluence` 0, not AlwaysOnTop; writes Image / ImageRect only when the frame, facing or sheet changes; tint (ImageColor3), fade (ImageTransparency) and blink (Visible) only on change. |
| `WeaponViewController` | `.../render/WeaponViewController.ts` | Sword swing fans + sweeping blade, finisher wind-up, guard fan, bow charge ring + aim line, heavy-arrow release ring (dashed floor markings). |
| `RunMarkerController` | `.../render/RunMarkerController.ts` | M2 (endless runs): a relic pedestal (Cylinder, `uiAccent`) on each TREASURE room's centre tile and the curse shrine's zone (flat disc, `uiMana`) in the SHRINE room; a taken pedestal / used shrine dims (`uiTextDim`). Rebuilt per floor. With the `ui.marker.pedestal` image, a camera-facing beam stands on each live pedestal (hidden once taken). |
| `TelegraphController` | `.../render/TelegraphController.ts` | Sniper aim lines, bruiser shockwave rings (archetype `data.fx`), a ring for any other wind-up, Mother Bramble's attack previews, slam lane, roar rings and the arena seal fence. |
| `FxTrackerController` | `.../fx/FxTrackerController.ts` | Right after the sim (render step 102): the pure `HitTracker` diffs the live actors and dispatches the frame's FX events (hit, killed, spawned, capped, bossPhase, bossDefeated, reset) to the juice views and audio, with the effective juice settings. |
| `FreezeFrameController` | `.../fx/FreezeFrameController.ts` | FX events -> hitstop requests on `SimController.hitstop` (kill 50 ms, heavy / elite 80 ms, boss phase 120 ms, boss death 250 ms + slow-mo); clears it when the setting goes off; the 1-render-pixel camera nudge (`getNudge()`, read by CameraController). |
| `HealthBarController` | `.../fx/HealthBarController.ts` | Enemy health bars: one pooled BillboardGui per actor slot (64), plate / chip / fill or pips, elite outline. |
| `DamageNumberController` | `.../fx/DamageNumberController.ts` | Damage numbers: 48 pooled BillboardGuis, merge window, heavy / capped colours, "CAP" tag, rise + fade. |
| `ScorePopController` | `.../fx/ScorePopController.ts` | Scored runs (M2): a rising, fading `+points` BillboardGui per kill (`LiveRun.scorePops`, pooled `ScorePopPool`). |
| `ParticleController` | `.../fx/ParticleController.ts` | Death bursts, boss waves, roar sparks, hit sparks: pooled 1-3 px Parts, one BulkMoveTo per frame, particle budget. |
| `AudioController` | `.../audio/AudioController.ts` | Theme sounds for sim events and music through the `sfx` / `music` SoundGroups (all silent today). |
| `SettingsController` | `.../ui/SettingsController.ts` | Juice settings: server sync (request / update / reset / settingsChanged), the system Reduce Motion flag, O toggles the panel, B closes it, the panel pauses the run. |
| `HudController` | `.../ui/HudController.tsx` | Mounts `GameHud` (React + Reflex; two ScreenGuis through a portal) with the menu actions, switches gamepad navigation on while a menu is open, hides the stock Health / Backpack CoreGui. |

Pure, headlessly tested logic: `src/shared/play/` (input mapping, live loop, HUD snapshot), `src/shared/view/`
(iso camera, studs <-> sim units, aim ray, greedy tile merge, marking geometry, dash layout, presentation tunables),
`src/shared/view/fx/` (hit tracker, juice rules, hitstop clock, freeze rules, bar layout / state, damage number pool,
particle system), `src/shared/view/audio/` (event -> sound mapping, music choice) and `src/shared/view/hud/` (font
token, layout sizes, UIScale rule, HUD helpers, every HUD string key).

## Sprites replace placeholders (docs/ART.md S4)

Per logical ID, at the time a view is built: if `pack.sprites(id)` returns a set (and, for actors, the archetype is in
`shared/view` `ACTOR_SPRITE_INPUTS`: the swarmer today), `ActorRenderController` draws a `SpriteView`; otherwise the
placeholder model, exactly as before. With the placeholder pack every ID takes the placeholder path. Sniper, bruiser,
turrets and the bosses stay placeholders until they get an input builder.

All sprite logic is pure and specced in `src/shared/view/sprites.ts`:

- **Facing:** `spriteFacing` projects the sim's ground facing (the roll direction while rolling) through the camera
  basis (yaw 45, pitch 55) to the true on-screen angle and picks the nearest of the set's 4 / 8 / 16 facings.
- **Animation:** `choosePlayerAnim` (death > roll > attack.1/2/3 > hit > run > idle) and `chooseActorAnim` (death >
  attack > hit > move > idle) from sim fields (`playerSpriteInput`, `swarmerSpriteInput`). One-shots are stretched over
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
3. **Camera + 1 (201) `KV_GameCamera`**: follows the interpolated player (+ the freeze-frame nudge).
4. **Camera + 2 (202)** `KV_Bullets`, `KV_Actors`, `KV_Weapons`, `KV_Telegraphs`, `KV_HealthBars`,
   `KV_DamageNumbers`, `KV_Particles`: read `getState()` / `getAlpha()`, move pooled Parts / BillboardGuis. They never
   write the sim.
5. React re-renders the HUD from Reflex when the snapshot changed (at most ~10 Hz).

Mouse aim uses the previous frame's camera (the web build does the same).

## Controls

| Input | Keyboard / mouse | Gamepad | Web build |
|---|---|---|---|
| Move (screen-relative) | WASD (arrows too) | Left stick | WASD / left stick |
| Aim | Mouse | Right stick | same |
| Attack (hold) | Left click | RT | same |
| Alt: sword guard / bow charge | Right click | LT | same |
| Swap weapon sets | **E** | Y | **Tab** / Y |
| Dodge roll | Space | LB | same |
| Flask | F | D-pad up | same |
| Ember (bullet clear) | Q | RB | same |
| Pause (overlay: Resume / Restart / Juice settings) | **P** | Start | **Escape** / Start |
| Juice settings panel | **O** (B or Close closes it) | pause overlay -> Juice settings; B closes | O |
| Restart (same seed) | R (any time) | **D-pad down** (only when dead, victorious or paused) | R |
| Debug: one hit on the player | K (KV_Debug only) | | K |
| Debug: 10 % off an engaged boss | J (KV_Debug only) | | J |
| Debug: replay check | F8 or **L** (KV_Debug only) | | F8 |
| Debug (endless): end the floor now | **N** (KV_Debug only; `DEBUG_FLOOR_BUTTON`, a port bit) | | (none) |
| Leaderboard panel | **B** (B again, pad B or Close closes it) | pause overlay -> Leaderboards; B closes | (none) |
| Boon draft (M2): pick a card | A / D (screen left / right; neither = centre card) | left stick left / right | (none) |
| Boon draft: take the card | Left click (after 0.5 s) | RT | (none) |
| Curse shrine (M2): accept | **1** (in the shrine zone) | A | (none) |

Roblox remaps: Roblox reserves Escape (game menu) and Tab (player list), so Pause is P and Swap is E (one swap key,
so the HUD hint is unambiguous; C is not bound). The leaderboard panel is on B ("boards"), not N: N is the endless
debug floor skip, and `inputMapping.spec.ts` checks B against every game and driver key. The pad restart is new (the web build had none) and is limited to a
finished / paused run so a stray press cannot end a fight. L duplicates F8 because Studio may keep F8 for itself.
Opening the Roblox menu (Escape, or Start on some pads) also pauses the run and resumes it when the menu closes.

The boon draft (M2, after every endless floor) uses the existing sim input only (no new bit, no codec change): the
sim reads the move vector's SCREEN-horizontal component (the InputFrame's move is world space; `DRAFT_SCREEN_RIGHT_*`
is screen-right for the 45-degree camera, checked against `screenToWorld` in `inputMapping.spec.ts`), beyond a 0.5
dead zone left / right, else the centre card (two cards: left / right, centre selects none); a FIRE press edge
confirms once the draft has been open `DRAFT_MIN_OPEN_TICKS` (0.5 s). The world is frozen meanwhile. The shrine uses
SKILL1 (key 1 / pad A), which does nothing else anywhere in the sim (FIRE would swing the sword there). Co-op
(`KV_Party`): every player drafts from their own offers with their own stick / FIRE (through the lockstep input like
any other frame), and the world stays frozen until all of them confirmed.

Menus (pause overlay, settings panel): while one is open the gamepad's A / B / D-pad / left stick go to Roblox's GUI
selection (InputController passes them through instead of sinking them; the D-pad-down restart is off then, the
overlay has a Restart button) and the selection starts on the first button. The settings panel pauses the run while
it is open (the web panel did not; on Roblox its clicks and the pad's A would otherwise reach the game); P inside it
does not resume under it. After a menu button is clicked, the mouse buttons read as released until they are (no sword
swing on Resume).

## HUD (`src/client/ui/hud/`, React + Reflex)

Two ScreenGuis (`KV_GameHud` display order 10, `KV_GameMenu` 20), laid out at a 1280x720 reference under a UIScale
(`useHudScale`: min(w / 1280, h / 720) clamped to 0.6..1.75, x1.25 on a ten-foot console screen; `computeHudScale`)
inside the safe area (`ScreenInsets = CoreUISafeInsets`). Every text is a theme string (`shared/view/hud` HUD_STRINGS /
SETTINGS_STRINGS, all checked to exist by `hud.spec.ts`), every colour a theme role, the font the token
`HUD_FONTS.text` (Roblox's pixel font **Arcade**; `HUD_FONTS.mono` = Code for the debug line), resolved once in
`client/ui/theme`. Change the font there and only there.

| Where | Component | Shows |
| --- | --- | --- |
| top left | `StatusPanel` | `HP` + one heart per 2 half hearts (full / half / empty, `uiHealth`), armor pips (diamonds, `uiMana`), `Flask` pips (`uiAccent`), `Ember` pips (diamonds, `ember`) |
| bottom left | `WeaponPanel` | both weapon sets (number + `<weapon id>.name`), the set in hand opaque with a `uiAccent` ring; `E swap` / `Y swap` by `game.inputDevice` |
| top left (endless) | `StatusPanel` | a `Floor N · Depth D` line under the pips (snapshot `floor` / `depth`, 0 outside endless runs) |
| top right | `ScorePanel` | scored runs (every endless run; M1 with `KV_Scoring`): the score, `x1.3` combo and its decay meter (snapshot `comboWindowTicks`: `COMBO_WINDOW_TICKS` or what boons / curses make of it) |
| top left (endless) | `StatusPanel` / `RunItems` | M2 (co-op: the local player's): a row of icons for the owned boons (rarity colour: `rarity.normal` / `rarity.rare` / `rarity.unique`), relics (`uiAccent`) and curses (`uiHealth`), each labelled with its `<id>.icon` string |
| centre (endless) | `DraftOverlay` | M2 boon draft: `Choose a boon`, up to 3 cards (`<id>.name` in the rarity colour, `boon.rarity.<r>`, `<id>.desc`), the card under the stick highlighted (`uiAccent` ring, scaled up; the snapshot is taken every frame while the draft is open), the device's hint (`A / D to choose · Click to take`) once a confirm counts. Co-op: the LOCAL player's offers and selection, plus `Waiting for N teammate(s) to choose` (`hud.draft.waiting`) while others still choose (alone once this player confirmed) |
| top centre (endless) | `ToastPanel` | M2: `Boon: <name>` / `Relic found: <name>` / `Cursed: <name>` / `Second Wind!` / Vampire Fang heals for 3 s (store `game.toasts`, from the run view's `runEvents`: the local player's own events, solo or co-op), and the `1: accept a curse` hint while the player stands in an unused shrine's zone |
| top centre | `BossBar` | while a boss is engaged: `<boss id>.name`, `Phase I / II / III`, an hp bar (`boss` role) with notches at the phase marks (66 % / 33 %, from the archetype's `phaseHp`) |
| centre | `RunOverPanel` | after a death / victory: `Run over` / `Victory`, `You died — press R to retry` / `Mother Bramble defeated — press R to play again` (R or D-pad down by device) + `or <other key>`, time, hits taken, kills; in scored runs the score, best combo and the points per source (kills, grazes, guard, rooms, perfect, fast, floors, boss). Endless runs have no victory: only death ends them. |
| centre (menu) | `PauseOverlay` | while paused and playing: dimmed scene, `Paused`, Resume / Restart / Juice settings, `P to resume` / `Start to resume` |
| centre (menu) | `SettingsPanel` | the juice settings (below) |
| bottom right | `InfoPanel` | `Project Kaleb-Vale · <biome> · seed N · <dungeon>`, the fallback notice, the verdict line (`Run 2 (death): verified by the server (ab12cd34)` / `submitted, checking...` / `rejected (code) reason` / `not submitted (stress)`), and with KV_Debug the debug line (tick, recorded ticks, enemies, bullets, replay check) |

The snapshot (`shared/play` `GameSnapshot`) gained `bossPhaseMarks`, `kills`, `hitsTaken` and `endTick` (the tick the
run ended on, for the post-run time), and for M2 progression `comboWindowTicks`, `draftOpen` / `draftOffers` /
`draftSelected` / `draftReady`, `boons` / `relics` / `curses` and `atShrine` (SnapshotExtras.config). Co-op
(SnapshotExtras.playerIndex = the client's `localIndex`): hearts, weapons, the draft, the run items and the shrine hint
are the local player's, `draftWaiting` counts teammates still choosing, and `comboWindowTicks` is the team's.

## Juice (`src/shared/view/fx/` logic, `src/client/controllers/fx/` drawing)

A port of the web build's `src/fx` (README there). Render side only; nothing feeds back into `step()` except the
freeze frame's pacing (below).

| Feature | Web source | Roblox drawing | Settings |
| --- | --- | --- | --- |
| FX tracker | `tracker.ts`, `events.ts`, `FxTracker.tsx` | `FxTrackerController` (after the sim) | |
| Health bars | `bars/*` | a BillboardGui per actor slot at the feet, camera-space `StudsOffset` up to the placeholder's top edge (1 render px = 0.25 studs); plate `enemyHealthBack` / elite `enemyHealthElite`, chip `enemyHealthChip`, fill `enemyHealth` (flash `uiText`); pips for hpMax <= 4; bosses none | `healthBars` always / when hit (2 s + 0.4 s fade) / off; reduced motion: no 1 px shake |
| Damage numbers | `numbers/*` | 48 BillboardGuis, a TextLabel in the HUD font; `damageNumber`, heavy (>= 4) `damageHeavy` at 2x, `damageCapped` "CAP" (`fx.cap`); merge within 0.25 s; rise 12 px + fade over 0.7 s | `damageNumbers`; reduced motion: no jitter / rise / pop |
| Freeze frame | `hitstop.ts`, `freeze/*` | `SimController.hitstop` paces `LiveRun` | `freezeFrame`; off under reduced motion |
| Camera nudge (the only screen shake) | `freeze/rules.ts` nudge | CameraController adds 1 render px (0.25 studs) on boss phase 2/3 (80 ms) and boss death (240 ms) | off under reduced motion |
| Particles | `particles/*` | pooled Parts (1-3 px cubes) in the palette `uiText`, `particleSpark`, `enemyHealthElite`, `boss`, then each archetype's `enemy.<id>` role; hops lift the part (h px / cos(pitch)) | `particles` off / low / normal / high = budget 0 / 128 / 320 / 512 live (one level lower under reduced motion; slower, shorter, no hop, rings in place) |

Settings resolve as the web build's (`shared/settings` resolveJuiceSettings): the player's overrides on top of the
defaults (bars when hit, numbers on, freeze on, particles normal), and **reduced motion defaults to the Roblox "Reduce
Motion" setting** (GuiService.ReducedMotionEnabled, followed live) unless the player set it; the shared rules
(`juiceRules.ts`: effectiveParticles, particleBudget, freezeFrameOn, screenShakeOn, motionScale) are the only place
features read it.

Time bases (as the web): bars and numbers age on sim time ((tick + alpha) / 60), so they hold during pause and
hitstop; particles run on real time x the hitstop clock's time scale (0 during a freeze, the ramp in slow motion), 0
while paused.

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

Every sound is a logical ID resolved by `ThemePack.sound(id)` -> `{ assetId | undefined, volume, group }`. The
placeholder pack has every `sfx.*` / `music.*` ID `silent`, so today nothing is created or played; put
`{ kind: "sound", assetId: "rbxassetid://<n>", volume: 0.8 }` on an ID in `packs/placeholder/manifest.ts` and it plays,
no code change. Sounds play through SoundService SoundGroups `sfx` and `music` (created if missing; volume =
`AUDIO_VIEW.groupVolume[group]` x `AUDIO_VIEW.masterVolume`), each Sound at the manifest's per-ID volume, 4 pooled
voices per sfx ID. Music loops and cross-fades (0.75 s).

| Event (per rendered frame) | Sound ID | Min gap |
| --- | --- | --- |
| `playerDied` | `sfx.player.death` | |
| `playerHits` | `sfx.player.hurt` | 0.1 s |
| `emberUsed` | `sfx.ember` | |
| `rollStarted` | `sfx.player.roll` | |
| `flaskUsed` | `sfx.player.flask` * | |
| `weaponSwapped` | `sfx.player.swap` * | |
| `shotsFired` | `sfx.player.shoot` | 0.06 s |
| `meleeSwings` | `sfx.player.swing` * | 0.05 s |
| `bulletsDeleted` (sword / guard deletes bullets) | `sfx.player.deflect` * | 0.08 s |
| `telegraphs` | `sfx.enemy.telegraph` * | 0.15 s |
| `bossEngaged` | `sfx.boss.roar` | |
| `bossDefeated` (sim event) | `sfx.victory` * | |
| enemy bullet spawn counter grew | `sfx.enemy.shoot` | 0.08 s |
| FX `hit` (any actor) | `sfx.enemy.hurt` | 0.05 s |
| FX `killed` (not a boss) | `sfx.enemy.death` | 0.04 s |
| FX `bossPhase` (phase >= 2) | `sfx.boss.roar` | |
| FX `bossDefeated` | `sfx.boss.death` * | |
| pause overlay / settings buttons | `sfx.ui.confirm` (resume, restart, reset) / `sfx.ui.click` (options, settings, close) | |
| music | `music.biome.<1..5>` (the floor's biome), `music.boss` while a boss is engaged, none after a death | cross-fade |

\* Roblox-port additions to the placeholder pack (`PORT_SFX`; the web contract has no ID for these events; extra IDs
under a known prefix validate). Each sound starts at most once per frame. `sfx.loot.*` and `music.menu` are unused
in M1. `hud.spec.ts` checks the mapping table and that every ID it can play exists in the placeholder pack, in the
right SoundGroup.

## Juice settings panel and persistence

O (keyboard) or the pause overlay's "Juice settings" (gamepad route) opens it; B, O or Close closes it. Rows: enemy
health bars (always / when hit / off), damage numbers, freeze frame on kill, particles (off / low / normal / high),
reduced motion (on / off, with `(system: on/off)` below), then Reset to defaults and Close. Every pick applies at once
(Reflex `settings` slice, `patchOverrides`) and is sent with `updateSettings`; the server's `settingsChanged` (sent
after join and after every request) replaces the overrides. Before the server answers the panel shows "Not saved yet:
the server has not answered" and the game runs on the defaults plus the local changes. (The client does need the
server runtime to have created the remotes: `client/network.ts` waits for them, with no timeout, while the controllers
load. If the server script dies before `GlobalEvents.createServer`, no controller starts.)
Reset clears the overrides (`resetSettings`), so reduced motion follows the system again.

## Ranked runs and the leaderboard panel (M3 / M5)

Unless `KV_Seed` or `KV_World` is set (or stress is on), every run start asks the server for a run (`startRun`) and
plays the seed the server picked on `RANKED_WORLD_KIND` (`"endless"`: scored, one segment per floor); the views see
no run until it answers (an unranked local run after `RUN_START_TIMEOUT_SECONDS` or a refusal; a `busy` answer, e.g.
the player's party run still being decided, is retried every `RUN_START_BUSY_RETRY_SECONDS` up to
`RUN_START_BUSY_RETRIES` times first). A `runFinished` with code `abandoned` for a run the client already left (a
restart, or joining a party run) is not shown. The LiveRun cuts a
segment on every floor change (`segmentCutAfterTick: (s) => s.events.floorChanged !== 0`, else every
`SEGMENT_FALLBACK_TICKS`), the SimController uploads them as they are cut (`submitSegment`) and sends `finishRun` at
the end; `runFinished` fills the verdict line, with the leaderboard status. Each `segmentVerdict` ok releases that
segment's recorded frames (`LiveRun.releaseVerifiedFrames`; not with `KV_Debug`, whose F8 replay check needs the
whole recording). Details: docs/SERVER.md "Segmented runs".

B (or Leaderboards in the pause overlay) opens the leaderboard panel: Solo / Co-op tabs, the top 100 (your row
highlighted) and your best with its rank when it is in the top. B, pad B or Close closes it; the run pauses while it
is open, and only one of the juice settings / leaderboard panels is open at a time.

## Workspace attributes (read at every run start, i.e. on R)

| Attribute | Type | Effect |
|---|---|---|
| `KV_Seed` | number | Run seed (default 1337). Changing it and pressing R rebuilds the floor. Set: the run is unranked (the server picks ranked seeds). |
| `KV_Debug` | boolean | K / J / F8 / L and the debug HUD line. Off by default. |
| `KV_SpawnBoss` | boolean | With KV_Debug: start outside the boss room's door. The server rejects such runs unless `KV_AllowDebugRuns`. |
| `KV_Stress` | number | The web build's `?stress=N`: rings keep ~N enemy bullets alive. Stress runs are never submitted. |
| `KV_World` | string | `endless` (default: shared/config `PLAY_MODE`), `game` (the M1 run), `dungeonNoEncounter`, `greybox`. Set: the run is unranked. Pair with the server's `KV_RunValidationWorld` (Studio). |
| `KV_Scoring` | boolean | M2 scoring on an M1 world (`game` etc.; endless is always scored). Such runs are not submitted (`not submitted (scored)`): the server replays M1 unscored. |
| `KV_Party` | boolean | M4 co-op (until the Hub's party pad exists): at each run start the lowest UserId INVITES everyone else in the server (`partyInvite`); everyone keeps playing solo meanwhile. Each invited player gets the `PartyInvitePanel` prompt (top centre: "<host> invites you to a co-op run", Join / Decline); the party run starts only once every one of them joined (the server enforces it), their solo runs end as abandoned, and a client only switches to a party run whose `inviteId` it accepted (or hosts). The camera, HUD and weapon view follow this client's own player; every member is drawn; in parties of 5+ teammates' bolts draw at 40 % opacity. No pause and no restart until the whole party is down, and then R starts the next run once the party's verdict arrived (pressed earlier, it waits for it); hitstop never slows the co-op sim (docs/SERVER.md "Co-op lockstep (M4)"). |
| `KV_PartyAutoAccept` | boolean | Dev only: accept every co-op invite at once, without the prompt. Off by default. |

If the `game` world cannot start (e.g. a build without the actor archetypes: "Unknown archetype"), the client falls
back to `dungeonNoEncounter` and says so in the HUD's info line.

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
| Enemy bullets | up to the pool's high-water mark (capacity 2,048; stress raises it) | one Part per slot, never destroyed |
| Player bullets | up to 512 | |
| Actors | <= 64 models (1 Part; capsules 3) + player 3 + pip 1 | models are reused per visual |
| Telegraph dashes | ~10-160 while a preview is up (a 5-lane fan ~80) | TELEGRAPH_VISUAL dashes: 1 stud + 0.75 gap |
| Arena seal | ~144 (seed 1337: 72-tile perimeter, one 1.5-stud dash per 2 studs) | while the boss fight is on |
| Weapon arcs | ~20-60 | 0.5-stud dashes |
| Particles | up to 512 live particles + 16 rings x 32 dots (1,024 Parts at most; budget 128 / 320 / 512 by setting) | grows lazily to the high-water mark, parked when unused |
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
and helpers.

Studio only: every controller (input polling and sinking, camera, Parts, BulkMoveTo, BillboardGuis, the React HUD,
GUI selection, SoundGroups / Sounds, remotes).

## Studio smoke test

Setup: `npm run build`, `rojo serve`, open a **Baseplate** place, connect Rojo. In Lighting, delete `Atmosphere`
(its haze washes out a scene seen from ~550 studs). Game Settings > Security: enable Studio Access to API Services.
With the actors merged the default `game` world has enemies; without them see "fallback" below.

1. **Start (F5).** Output: `[Sim] run 1 started: seed 1337, world game` and `[World] built 134 parts (...)`.
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
8. **Pause.** P: the scene dims, the overlay shows `Paused`, `Resume`, `Restart`, `Juice settings`, `P to resume`;
   everything freezes; P again (or Resume) resumes, and the click on Resume does not swing the sword. Restart starts
   a new run. Escape (Roblox menu) also freezes the game, and it resumes when the menu closes.
9. **Boss.** (Faster: set `KV_Debug` and `KV_SpawnBoss` true on Workspace, then R.) Enter the boss room: a large
   yellow block wakes, a translucent yellow fence of dashes outlines the room (the seal), the top centre shows
   `Mother Bramble` and `Phase I` over a yellow bar with two white notches (66 % / 33 %) that shrinks as you hit it;
   the phase reads `II` / `III` past each notch. Before every attack orange
   dashed previews show exactly where the bullets will go (5 fan lanes, ring arcs with two gaps, spiral arms with
   arrow heads, the slam lane), dim then bright, blinking at the end. Phase changes show expanding yellow roar rings.
   With KV_Debug, J takes 10 % off.
10. **Victory.** Kill the boss: a short freeze, then ~0.5 s of slow motion, the camera jiggles one pixel, three
    waves of yellow particles. The centre panel: `Victory` (gold), `Mother Bramble defeated — press R to play again`,
    `or D-pad down`, the time, hits taken and kills. Bottom right `Run 1 (victory): submitted, checking...` then
    `Run 1 (victory): verified by the server (<hash>)`.
    (A boss-door / K / J run is rejected `debug_spawn` / `debug_input` unless the server has `KV_AllowDebugRuns`.)
11. **Death.** R, then let enemies (or K with KV_Debug) take all hearts: the capsule lies down grey, the centre panel
    `Run over` (red), `You died — press R to retry`, `or D-pad down`, the time survived, hits taken, kills; the verdict
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
    reads `Y swap`), LB roll, D-pad up flask, RB Ember, Start pause. After a death or victory, **D-pad down**
    restarts; mid-run it does nothing. Moving the mouse switches aim back to the mouse. Start opens the pause
    overlay with `Resume` selected; D-pad / stick move the selection, A presses, Start resumes; `Juice settings`
    opens the panel with the first option selected, A picks, B closes it (back to the overlay).
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
20. **Juice settings.** Press O mid-fight: the game pauses behind the panel `Juice`; rows Enemy health bars (Always /
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
    settings panel fit on screen and are usable by touch.

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
- The pause overlay also shows while the Roblox menu is open (it pauses the run); the Roblox menu covers it.
- Dungeon props, torches and arches are not drawn: the web build does not draw them either and the theme has no IDs
  for them. Pools use the Dungeon Forge theme's liquid colour (as the web build), since the theme has no pool role.
- Every HUD text is a theme string now (`hud.verdict.*`, `hud.seed`, `hud.info`, `hud.notice.fallback`,
  `hud.debug*`, `hud.pause.*`, `hud.ending.*`, `hud.restartAlt`, `fx.settings.reset / close / system / offline`,
  `fx.cap` were added to the placeholder pack). Keys, IDs and enum names stay in code.
