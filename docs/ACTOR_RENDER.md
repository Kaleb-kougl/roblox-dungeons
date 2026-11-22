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
