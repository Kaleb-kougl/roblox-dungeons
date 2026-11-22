# Actor render split

`src/client/controllers/render/ActorRenderController.ts` draws every actor and every player. It is 1,315 lines, has no
spec (only `src/shared/**` runs headlessly) and mixes five jobs in one class. This plan splits it into a directory where
the `@Controller` class is the frame's wiring and each job is a plain module or a small owned class.

2026-11-21, base commit `d4936547`. Task SE6 of the staff presentation plan.

**Presentation only, and a pure move.** No sim change, no hash group, no wire change, no new setting. The per-frame
order of operations, the pools and their keys, and the order properties are written in do not change.

## Census (base `d4936547`)

Lines are the old file's. "Delegates to" lists the pure rules each group already reads from `shared/`.

| Group | Lines | Members | Delegates to |
|---|---|---|---|
| Imports, constants | 1-131 | `RENDER_STEP`, `PARKED`, `TAU`, `HIDDEN`, `UNWRITTEN`, pip sizes, `CAMERA_YAW`, `SPRITE_KEY` | `shared/view` `BULLET_VIEW.parkedStuds` |
| View records | 133-213 | `Ring`, `PlayerView`, `ActorView` | - |
| Class doc | 215-292 | the two paths, outlines, variants, stand-ins | - |
| Frame and move batch | 388-489 | `onStart`, `frame`, `place`, `moveParts` / `moveCFrames`, the animation clock (`dtSec`) | `animDtSec`, `isoBasis`, `RENDER_ORDER` |
| Actor pool and lifecycle | 300-312, 491-624 | `views`, `free`, `freeSprites`, `parking`, `spriteParking`, `spriteSets`, `swapDue`, `spriteSet`, `acquire`, `release`, `pushFree` | `ACTOR_SPRITE_INPUTS`, `actorSpriteScale`, `bossSpriteLayout`, `scaledSpriteLayout`, `affixDrawScale`, `viewAffix`, `actorGroup`, `VIEW_HIT_CLIP_SEC`, `FlipTracker` |
| Actor draw (animation, look, corpse, rim, placement) | 510-515, 626-748 | `drawActor`, `lookColor`, `goldenFlicker` | `chooseActorAnim`, `actorLook`, `variantLook`, `corpseTransparency`, `detonationCorpseView`, `vengefulCorpseView`, `vengefulArmed`, `vengefulPulseOn`, `bomber*`, `AuraView`, `ShieldFlashWatch`, `actorOutlined`, `goldenFlickerTransparency` |
| Enemy outline | 296-297, 326-327, 396-416, 1301-1315 | the `Enemies` / `Corpses` / `Players` groups, `buildOutline`, the `KV_EnemyOutline` switch | `ACTOR_OUTLINE`, `outlineSwitchOn` |
| Players (bodies, stand-in swap, ring / pip, capsule) | 315, 321-325, 750-880, 931-1021, 1064-1104, 1127-1154 | `players`, `buildPlayerView`, `usePlayerBody`, `drawPlayers`, `drawPlayer`, `drawPlayerModel`, `sword`, `bow`, `playerVisualId`, `buildRing`, `destroyPlayerView` | `playerLook`, `playerBlinkVisible`, `choosePlayerAnim`, `playerSpriteInputFor`, `playerVisualIdOf`, `floorImageSize`, `floorImageOffset` |
| Player outline | 328-333, 1023-1062 | `setPlayerOutlined`, `startPlayerOutline`, the `KV_PlayerOutline` switch and the Display setting | `PLAYER_OUTLINE`, `playerOutlined`, `outlineSwitchOn` |
| Cosmetics | 371-379, 882-929, 1262-1264 | `applyLook`, `cosmeticSec`, `dyeEpoch`, `dyeReady`, `color3Of` | `shared/view/cosmetics` (`lookAt`, `cosmeticRgb8`, `rgb8Key`, `dyeForVisual`, `lookAnimated`, `cosmeticClockSec`) |
| Hit reaction | 337-348, 1156-1248 | `startHitReact`, `setPinHolds`, `holdActor`, `hitReactFrame`, `applyHitReact`, `syncModelGroup` | `HitReactSlots`, `motionScale`, `freezeFrameOn`, `nearestLivingPlayer`, `pushOffsetStuds`, `FEEL_HIT` |
| Motion feel | 334-335, 1106-1125 | `startMotion`, `motionActor` | `./motionFx.ts` (already its own module) |
| Stand-ins | 363-369, 439-442, 495-498, 779-823 | `flips`, `readiness`, `ringReady`, `swapDue`, `usePlayerBody` | `FlipTracker`, `PreloadController.getReadiness` / `isArtReady` |
| Teardown | 1250-1257 | `destroy` | - |

Findings:

1. **Nothing boss-specific or debug lives here.** A boss differs only by `bossSpriteLayout` / the minimum draw width
   in `acquire`; its layers are `bossAct1.ts`, `demonlord.ts` and `TelegraphController`. The debug switches are two
   Workspace attributes read on change.
2. **Almost every decision is already pure and in `shared/view`.** What the controller still decides inline: the
   placeholder's draw scale (the boss minimum width, also copied in `fx/fxHelpers.ts`) and the capsule's roll tumble
   turn. Both move to `shared/view` with a spec (R5).
3. **Stand-ins are not a group that can move.** They are three lines in `frame`, one predicate, and a branch in each
   of `acquire` and `usePlayerBody`: they stay with the pool and with the players.
4. **`drawActor` and the pool share `ActorView` and the move batch** and run inside the one actor loop. They stay in
   the class: splitting them would hand six fields back and forth for no reader's gain.
5. **Public API**: `setPinHolds`, `holdActor`, `destroy`. Injected into `SiegeFxController` and `RoomClearController`
   (constructor parameters; no `Dependency<>` call).

## Split

`src/client/controllers/render/actors/`, exported through the `render` barrel as before:

| Module | Holds |
|---|---|
| `ActorRenderController.ts` | The `@Controller` class: `onStart`, `frame`, the move batch, the actor pool, `drawActor`, the enemy outline groups, motion wiring, the public API |
| `actorViews.ts` | `Ring`, `PlayerView`, `ActorView`, the shared constants |
| `actorParts.ts` | Instance builders and small helpers: `buildOutline`, `buildRing`, `buildPlayerView`, `destroyPlayerView`, `placeModel`, `pushFree`, `color3Of` |
| `ActorHitReact.ts` | The hit reaction: its clock, the flashing Model, the pin holds, `applyHitReact`, `syncModelGroup` |
| `PlayerViews.ts` | Every player's view: bodies and stand-in swap, ring / pip, capsule, the player outline, cosmetics |
| `index.ts` | The barrel: the controller only |

Rules of the move:

- Code is cut by script, byte for byte. A method that moves keeps its name and body; `this.x` becomes the new owner's
  field of the same name, so the bodies do not change. The forced edits are listed under "As built".
- The owned classes are built in the controller's constructor and started from `onStart` at the lines their code ran
  at, so the order instances are created in and callbacks are registered in is the same.
- `PlayerViews` reaches the controller's sprite-set cache and look colours through two callbacks (`PlayerHost`), and
  writes into the controller's own move arrays: still ONE `BulkMoveTo` per frame.

## Tasks

- [x] **R0. Census** (this section).
- [x] **R1. Directory.** `git mv` into `actors/`, its barrel, the two importers.
- [x] **R2. Records and part builders** into `actorViews.ts` / `actorParts.ts`.
- [x] **R3. Hit reaction** into `ActorHitReact.ts`.
- [x] **R4. Players** into `PlayerViews.ts`.
- [x] **R5. Pure rules** `placeholderDrawScale`, `rollTumbleTurn` into `shared/view/actorDraw.ts` with a spec.
- [ ] **R6. Studio check (owner)**, below.

## As built (2026-11-21)

| Module | Lines | Was |
|---|---|---|
| `actors/ActorRenderController.ts` | 631 (78 of them the class doc) | 1,315 |
| `actors/PlayerViews.ts` | 511 | - |
| `actors/ActorHitReact.ts` | 159 | - |
| `actors/actorViews.ts` | 110 | - |
| `actors/actorParts.ts` | 109 | - |
| `shared/view/actorDraw.ts` (+ spec, 8 tests) | 38 | inline, and copied in `fx/fxHelpers.ts` |

**What the move forced** (everything else is the old text, checked by script against `d4936547`):

- `PlayerViews`: `this.groups.players` is its own `folder`; `drawPlayers` is public; `place`, `spriteSet` and
  `lookColor` are three one-line methods (the move batch, and the two `PlayerHost` callbacks into the controller), so
  the moved bodies call them unchanged. `beginFrame(dtSec, readiness)` takes the three writes `frame` made
  (`cosmeticSec`, `readiness`, `ringReady`), at the line `readiness` / `ringReady` were written.
- `ActorHitReact`: `startHitReact` is `start` and is handed the groups and the shield colour; `applyHitReact` and
  `syncModelGroup` are public; `drawActor` asks `hit.hitAge(slot, id)` instead of reading the clock itself.
- The controller's `place` calls `placeModel` (one more call per placed model); `buildPlayerView` is a function (it
  read no field); `setPinHolds` / `holdActor` delegate.
- `placeholderDrawScale` returns `scale * affixScale` where the controller wrote `scale *= affixScale`: the same
  product, so the pool key `${id}@${scale}` is the same string.
- Construction order: `HitReactSlots` is now built in the constructor body, after the other field initialisers (all of
  them plain objects). In `onStart` the pack colour `playerOutline` is read inside `PlayerViews.start` (after the
  folder is built, not before); nothing reads it in between.

**Unchanged:** the folder tree (`KV_Actors` with `Enemies` / `Corpses` / `Players` / `Players/Outlined` / `Flashing`,
created in that order), the order `fx.onFrame` (hit reaction) then `fx.onEvent` (motion) are registered in, the render
step name and priority, the frame's order (players, shield watch, aura, the actor loop: hit reaction -> draw -> motion,
parking, ghosts, one `BulkMoveTo`), both pools and their keys.

**Flamework.** The controller's identifier is now
`client/controllers/render/actors/ActorRenderController@ActorRenderController`: one `identifier` in `out/`, and the two
`flamework:parameters` lists that inject it (`SiegeFxController`, `RoomClearController`) carry the same string. No
`Dependency<ActorRenderController>()` call exists. `Flamework.addPaths("src/client/controllers")` walks the tree, so
the subdirectory needs no entry. `PlayerViews` and `ActorHitReact` are plain classes (no decorator, no metadata).
Start order among controllers of equal `loadOrder` comes from Flamework's dependency sort, not from file paths, so the
move does not change it.

**out:digest** against the base: `render/ActorRenderController` gone, the five `render/actors/*` modules and its
`init` new, `shared/view/actorDraw` (+ spec) new; changed: `render/init` and `shared/view/init` (barrels),
`fx/SiegeFxController` and `fx/RoomClearController` (the import path and the identifier string), `fx/fxHelpers` (reads
`placeholderDrawScale`). Nothing else.

**Left where it was, on purpose:**

- `acquire` / `release` / `drawActor` stay in the class (census finding 4). `drawActor` is 112 lines and still decides
  inline which corpse rule applies (detonated Bomber, Vengeful, plain) and which rim colour wins (aura over affix over
  outline). Both are a few lines over rules already in `shared/view`; pulling them out would be new code, not a move.
- Stand-ins stay split between the pool and the players (finding 3).
- Not checked here: anything that needs Studio. No client module has a headless spec.

## Studio check (owner)

Play solo in Studio with the vale pack unless a step says otherwise. Developer mode (docs/DEV_MODE.md, F2) jumps
floors. Output must stay free of errors from `ActorRenderController`, `PlayerViews` and `ActorHitReact` throughout.

1. **Start.** Explorer: `Workspace.KV_Actors` has `Enemies` (Model + Highlight), `Corpses`, `Players` (with
   `Outlined` + Highlight and one `FacingPip`), `Flashing` (Model + Highlight). Exactly one of each.
2. **One floor per biome** (five; jump floors until the theme changes). Each: enemies animate and face the right way,
   take the hit flash / hold / push, die and fade, and nothing is left standing at a freed slot after the room.
3. **A boss floor** (Mother Mayhem, and a seed with the Demon Lord): the boss is drawn at its usual size, its health
   bar sits on its head (`fxHelpers` shares the scale rule now), the Demon Lord's death plays before the fade and his
   charge leaves ghosts.
4. **Elites with affixes** (a floor deep enough for them, or Blood Moon via `KV_FloorModifier`): Hulking is drawn larger with the bar
   still on its head; an affixed sprite's rim is the affix colour; a Shielded hit flashes the rim; a Vengeful corpse
   holds, pulses and then fades. A Warbanner's aura tints the rims of enemies inside it.
5. **Player.** Roll (squash and afterimages; the trail colour with a trail cosmetic), take a hit (blink, i-frame
   tint), die (death animation). Options > Display > Player outline off / on; `KV_PlayerOutline = false`;
   `KV_EnemyOutline = false` hides every rim and the placeholder Highlight's outline.
6. **Archer.** A run as the Archer: the bow's draw / release animations, then a new run as the Knight: the view is
   rebuilt as the Knight's.
7. **Cosmetics.** A dye, Prismatic (it cycles), an outline colour, on both characters.
8. **Co-op teammate** (two clients): each sees both players, the local ring in the accent colour and the teammate's
   dimmed, the outline on yourself only; after a death, spectating moves the ring colour and the outline to the
   watched player; a teammate's dye shows.
9. **Stand-ins.** `workspace:SetAttribute("KV_StandInsForce", "all")` before Play: every actor and the player are
   placeholders (capsule with the facing pip and the tumble when rolling, enemies under the one `Enemies` Highlight,
   the hit flash moving them to `Flashing` and back); bosses at least 40 px wide. Then clear it and set
   `KV_FakeAssetLatency` to 0.5: placeholders turn into sprites mid-fight, no actor is drawn twice or vanishes, a
   corpse keeps the body it died with, the ring replaces the pip once its image lands.
10. **Siege Bolt and room clear.** A pinned enemy's sprite holds its frame while carried (`setPinHolds`); the last
    kill of a room holds for the slow motion (`holdActor`).
11. **Training dummy** (tutorial): the hit wobble plays over 0.7 s on each hit.
