# Hazard art (the Stormcaller's strike and the ember flames as sprites)

The two floor hazards PAD3 left neon (docs/PROJECTILE_ART.md) get pixel-art sprites: the Stormcaller's lightning
strike (`bullet.enemy.strike`, docs/NEW_ENEMIES.md NE5) and the build embers (`bullet.player.ember`, Fire Arrows /
Blazing Trail, docs/BUILDS.md BU8). **Presentation only:** no sim, dungeon, lockstep, hash, replay, fixture or score
change. A strike stays a `BulletKind.STRIKE` bullet (speed 0, 6 collision passes, hit radius 1.1), an ember a
`BulletKind.EMBER` bullet (speed 0, 1.2 s); only their decal pools change how they draw one. Supersedes PAD3 for
both (goo was lifted by docs/GOO_ART.md); after this no bullet is a neon floor decal in a pack with the art.

## Status (2026-11-06)

HA0-HA6 built on branch `hazard-art` (2026-11-06); see "As built". **Open:** HA7 (upload `art/upload/hazards.png`, then
its id into `packs/vale/assetIds.ts`: until then the bundled vale pack still draws the discs), HA8 (Studio check, after
PA0).

## The art (original, HAD1)

Drawn by code, `scripts/art/gen-hazard-art.js` (art:build and art:lock run it first, like the boost auras), into
`art/vendor/kaleb-vale/hazards/`: greyscale strips (white = the tint's full colour), one canvas per hazard. Original
art: no licence, notices or Credits entry.

| Hazard | Canvas | Animations | How it is drawn |
|---|---|---|---|
| Strike | 77 x 77, seen from straight above (a true circle, like the boost auras) | `flash` 3 frames over the strike's life; `scorch` 2 frames (hot, cold) | flash: a white core, six jagged forks to the hit rim with branches, a thin rim ring; then a shock ring at the rim with crackles; then the ring breaking into sparks past the rim. scorch: an irregular char blot (dark), radial cracks glowing hot, a few sparks; cold: the cracks dim |
| Ember | 17 x 30, in the game's 3/4 view | `burn` 6 frames, a seamless loop | a burning patch on the floor (an ellipse squashed to sin 55 deg) and one flame tongue rising off it, swaying and flickering, with a spark climbing off the tip |

Strike geometry: the hit rim is `rimPx` 33 = round(1.1 x 29.6) px from the centre (the swarmer's 29.6 px a tile,
the density every vale bullet sheet uses); the canvas holds the sparks to R + 5. Ember geometry: the burning patch's
box (`lit`, 15 x 12 px) is what covers the drawn disc (0.5 tiles), the tongue rises above it.

Tints (HAD2): every strike cell in `enemyBullet` (the flash IS danger; the char drawn dark reads as soot with the
cracks glowing in the danger colour while they still look hot), every ember cell in `build.ember`. Both roles are
already held to their rules (enemy-bullet contrast on every floor; `buildReport`), and the sheets are grey, so the
rules hold by construction; the pipeline writes the sheet's grey mean and the validator checks it is grey.

## What the code gives us

| Fact | Where | Consequence |
|---|---|---|
| Strikes and embers are `DecalPool`s (`STRIKE_DECAL` / `EMBER_DECAL`): one flat Neon cylinder per live bullet slot | `BulletRenderController.ts` | The sprite is a second mode of the same pool (as the goo's); the disc stays the fallback |
| `BULLET_ART.decalIds` (strike, ember): `bulletArtReport` and `ThemeCore.bullet` reject any art on them (PAD3) | `contract.ts`, `bulletArt.ts`, `core.ts` | A contract change: the two become `hazardSpriteIds`, with their own rules (`hazardArtReport`) |
| A strike lives 6 ticks (0.1 s); the flash would be over before it reads | `STORMCALLER` `strikeLifeTicks` | The view keeps a scorch for `scorch.lifeSec` after the bullet goes (HAD3): pure view state, harmless (the bullet is gone) |
| Bullet slots are deterministic and a stationary bullet keeps its slot | `BulletSimulation` | Variety (flips, loop phase) from slot bits, as the goo's; the scorch is seeded by the slot it came from |
| Floor sprites: `createSpriteAnchor` (invisible Part + Top-face SurfaceGui, LightInfluence 0), `FLOOR_CANVAS_YAW`, `floorCanvasPartSize` | `SpriteBulletPool.ts`, `floorCanvas.ts` | Reused; rides PA0's verdict like the goo |
| `gooSpriteSize` / `gooSpritePlacement` (cover the hit with a lit box, depth stretched by 1 / sin(pitch); any pivot) | `shared/view/variants.ts` | The ember (3/4 art) uses them as they are; the strike (top-down art) is laid flat UNstretched so the camera foreshortens it exactly onto the hit circle |
| `state.tick` / `SIM_HZ`, `state.endless.floor` | sim state | The scorch and ember clocks are sim seconds (a pause freezes them); a floor change drops every scorch |

## Look

- **Strike flash.** Frame = floor(age / life x 3), age in bullet time (the strike's life is tick-counted, so the
  Hourglass never stretches it). Opaque. Flipped by slot bits 0 / 1 (X / Y: the art is top-down, so every flip is
  still a valid strike).
- **Scorch (HAD3).** When a slot that showed a strike last frame no longer shows that strike (it ended or hit a
  player), a scorch starts at its spot: the hot cell for `hotSec` 0.15 s, then the cold cell, fading from
  `startTransparency` 0.15 to gone over its last `fadeSec` 0.45 s of `lifeSec` 0.8 s; flips from the slot. At most
  `maxScorches` 16 (the oldest is reused). Under the flash (a new strike on an old scorch draws over it).
- **Ember.** The `burn` loop at 12 fps on sim seconds, its phase offset by `slot x phaseStep` so a trail never
  flickers in step; X mirror from slot bit 0 (3/4 art: never flipped in Y). Fade over the last 0.3 s of its life as
  the disc did (`BUILD_BULLET_VIEW.ember.fadeSec`); no scale pop (pixel art).
- **Size.** Strike: `rimPx` maps onto `STRIKE_BULLET_RADIUS` exactly (studs per art px = 1.1 tiles / 33 px), the
  scorch at the same scale. Ember: `gooSpriteSize(lit, radius = the disc's 0.25)`: the patch covers the disc on screen.
- **Layer.** Unchanged: the strike at `STRIKE_VIEW.liftStuds` (over the goo, under rings and markings), the scorch
  just under it, the ember at the ember decal's lift (under the goo).

## Architecture

1. **Generator.** `scripts/art/gen-hazard-art.js` (+ `gen-hazard-art.test.js`): `strike_flash.png`,
   `strike_scorch.png`, `ember_burn.png` (horizontal strips). Same inputs, byte-identical PNGs.
2. **Atlas.** Group `hazards` in `art/atlases.json` (`--only hazards`): per set a canvas, a pivot (source px), the
   strips per animation; no crop (the canvases are tight), greyed; one sheet `hazards.png` packed by `packFx`;
   generated `packs/vale/hazardLayout.ts`. Every other output byte-identical.
3. **Theme.** `BULLET_ART.hazardSpriteIds` replaces `decalIds`; per-id animations (`idBaseAnimations`: strike
   `flash` / `scorch`, ember `burn`); `rimPx` (strike) and `lit` (ember) on the set; `hazardArt.ts`
   `hazardArtReport` / `hazardArtProblems` (own module, folded into `variantColorProblems`); `ThemeCore` /
   `ThemePack.hazardSprite(id)`; `bullet(id)` and `floorSprite(id)` ignore hazard ids. Vale: `packs/vale/hazards.ts`
   (nothing until `hazards.png` has an id). Placeholder unchanged (the discs).
4. **View, pure.** `shared/view/hazards.ts` + `HAZARD_ART_VIEW` (`hazardsConfig.ts`): `strikeFlashLook`,
   `scorchLook`, `emberSpriteLook`, `strikeSpriteScale`, `ScorchTracker` (the slot memory and the scorch ring). Specs.
5. **Client.** `HazardSpritePool.ts`: `StrikeSpritePool` (flashes by slot + scorches) and `EmberSpritePool`, both on
   `FloorAnchors` (the anchor list: grow, cell, flips, tint, alpha, BulkMoveTo). `DecalPool`'s sprite mode takes any
   `FloorSpriteDrawer` (the goo's `FloorSpritePool` is one).

## Tasks

- **HA0. Measure.** Hit radius, strike life, ember life and disc size from code (table above).
- **HA1. Generator.** **Verify:** test: byte-identical twice; canvases and frame counts; the burn loop seamless; the
  strike's flash frame 0 reaches the rim and stays inside the canvas; only grey pixels.
- **HA2. Atlas group.** **Verify:** `npm run test:art`; `--only hazards` writes only its files; the layout's
  `rimPx` / `lit` / pivot match the generator's.
- **HA3. Theme contract and `hazardArtReport`.** **Verify:** specs: hazard art passes only within the rules; flying
  bullet art on a hazard id still fails; contract.luau / validate.luau within 200 locals.
- **HA4. Pure view.** **Verify:** specs: flash frames over life; scorch start on end / hit, not on a floor change or a
  new run; hot then cold; fade; cap; ember loop phase per slot; strike scale maps the rim onto the hit radius.
- **HA5. Client.** **Verify:** without the id the discs (unchanged); with it the sprites; floor change clears scorches.
- **HA6. Docs.** CLAUDE.md decision log, PAD3 note in docs/PROJECTILE_ART.md.
- **HA7. Upload (owner).** `art/upload/hazards.png` -> `packs/vale/assetIds.ts`.
- **HA8. Studio check.** Every biome: the flash reads at 0.1 s and lands on the telegraph ring; the scorch reads as
  harmless soot; flips look right (negative ImageRectSize, unchecked like the goo's mirror); embers read as the
  player's flames, never as enemy fire; a Blazing Trail of 6 embers flickers out of step; frame time.

## As built (HA0-HA6, 2026-11-06)

- **Generator (HA1).** `scripts/art/gen-hazard-art.js` writes `strike_flash.png` (3 x 77x77), `strike_scorch.png`
  (2 x 77x77), `ember_burn.png` (6 x 17x31) into `art/vendor/kaleb-vale/hazards/`; `art:build` / `art:lock` run it after
  the boost auras. `gen-hazard-art.test.js`: deterministic, grey, nothing on a canvas edge, the rim at 33 px every 30
  degrees in flash 0 / 1, the scorch hot / cold and inside the rim, the burn loop seamless, the config's geometry.
- **Atlas (HA2).** Group `hazards` (`--only hazards` / `--lock --only hazards`): `art/build/hazards.png` 77 x 465 (11
  cells: strike 0-4, ember 52-57 at 4 a row), generated `packs/vale/hazardLayout.ts` (`VALE_HAZARD_SHEET`,
  `VALE_HAZARD_LAYOUTS`: per hazard frameW / frameH / pivot / animations / grey meanColor / pixelsPerTile, the strike's
  `rimPx`, the ember's `lit`). No crop, no recolour; a non-grey pixel fails the build. `hazards.test.js`. Every other
  output unchanged (`test:art` 180 / 180).
- **Theme (HA3).** `BULLET_ART.decalIds` is gone; `hazardSpriteIds` (strike, ember), animation names `flash` / `scorch` /
  `burn`, `maxHazardFrames` 8; BULLET `idBaseAnimations` gains the two. The strike's rim is `rimPx`, not `radiusPx`:
  the validator's gameplay-key guard refuses any key containing "radius" in a theme pack. `hazardArt.ts`
  (`hazardArtReport` / `hazardArtProblems`, `isGreyHex`, `HAZARD_STRIKE_ID` / `HAZARD_EMBER_ID`), folded into
  `variantColorProblems`; `ThemeCore` / `ThemePack.hazardSprite(id)` (`HazardSpriteArt` / `HazardSprite`); `bullet(id)`
  skips hazard ids without a warning. Vale: `packs/vale/hazards.ts` `valeHazardAssets` (nothing until `hazards.png` has
  an id). Specs: `hazardArt.spec.ts`, `valeHazards.spec.ts`; the PAD3 pins in bulletArt / gooArt / valeBullets /
  valeGoo specs now pin `hazardSpriteIds`. contract.luau / validate.luau 186 / 192 top-level locals (counted on out/).
- **View (HA4).** `shared/view/hazards.ts` (`strikeFlashLook`, `scorchLook`, `emberSpriteLook`, `strikeTilesPerPixel`,
  `flatCellPlacement`, `ScorchTracker`) and `HAZARD_ART_VIEW` (`hazardsConfig.ts`). `hazards.spec.ts`.
- **Client (HA5).** `client/controllers/render/HazardSpritePool.ts`: `FloorAnchors` (createSpriteAnchor anchors,
  tinted, flips as negative ImageRectSize, one BulkMoveTo, CFrames cached per spot so still sprites never move),
  `StrikeSpritePool` (flashes by slot + scorches, folders `KV_StrikeSprites` / `KV_Scorches`), `EmberSpritePool`
  (`KV_EmberSprites`). `DecalPool` takes any `FloorSpriteDrawer` (the goo's FloorSpritePool is now built by the
  controller) and a `HazardClock` per frame (sim seconds, `state.endless.floor`, motion).
- **Not run here:** `npm run verify` in one go (the device shell's call limit and a full `/sessions` disk). Typecheck,
  lint (whole `src`), check:assets, check:autolocalize, test:art, test:checks, test:l10n and the theme / view specs
  touched (theme 46 suites, view hazards / variants / gooSprite / bullets / buildBullets / newEnemies / preload /
  sprites / fx) ran, all passing; sim / dungeon specs were not rerun (no sim or dungeon file changed).

## Decisions (defaults, owner may change)

- **HAD1. Original art by code** (the boost auras' route), not a pack: no pack had a top-down strike that lands on a
  circle, and the ember must be tinted into `build.ember` anyway.
- **HAD2. Greyscale, tinted by the hazards' own roles** (`enemyBullet`, `build.ember`): no new colour role, and the
  family rules hold by construction.
- **HAD3. Flash + a short scorch** (owner, 2026-11-06): the scorch is view-only and harmless; it never extends the hit.
- **HAD4. Top-down strike laid flat unstretched; 3/4 ember with the goo's depth stretch.**
- **HAD5. No new string, sound, setting or debug flag.**

## Out of scope

The strike's telegraph ring (markings), `fx.enemy.strike` (Thunder), any sound; a lingering ember hit; goo.
