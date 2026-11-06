# Goo art (the Ooze's trail as slime puddle sprites)

The Ooze's goo puddles (docs/ENEMY_VARIANTS.md EVD5) are drawn today as flat neon discs in `enemyGoo`. This plan
draws them with the last two frames of heimlich3's **Slime** pack (https://heimlich3.itch.io/slime): frame 3 (a
flattened blob) as the puddle landing, frame 4 (the spread splat) as the puddle for the rest of its life.
**Presentation only:** no sim, dungeon, lockstep, hash, replay, fixture or score change. The goo stays an ordinary
`BulletKind.GOO` bullet (speed 0, 3 s, hit radius `GOO_BULLET_RADIUS` 0.35); only the goo `DecalPool` changes how it
draws one. Supersedes docs/PROJECTILE_ART.md PAD3 for goo only (strike and ember stay neon decals).

## Status (2026-11-06)

GA0-GA5 built on branch `goo-art` (2026-11-06); see "As built". GA6 done: `goo.png` uploaded 2026-11-06
(`rbxassetid://82002931490706`, `assetIds.ts`), so the bundled vale pack draws the puddles. **Open:** GA7 (Studio
check, after PA0).

## The art (measured 2026-11-06)

Two strips, 320 x 64 px each: 5 cells of 64 x 64, hard alpha (0 / 255), five colours (green `#56c44d`, light
`#a1e09c`, mid `#418e3b`, dark `#376633`, a black outline). The two strips are the pack's `Green Slime/green slime-Death Down.png` and
`-Death Up.png` (frames 0 and 1 differ; frame 4 by only 2 px; 2 and 3 are identical). The pack also ships Blue,
Purple and Yellow slimes and King variants with the same frames; none is close enough to `enemyGoo` to skip the recolour.

| Frame | Lit box (x, y, w x h) | Use |
|---|---|---|
| 0-2 | the slime sitting, then slumping | not used |
| **3** | (20, 40) 24 x 11 | **land**: the drop hitting the floor (one cell, both variants identical) |
| **4** | (17, 36) 31 x 17 | **hold**: the splat (Death Down's; one cell, Death Up's adds nothing) |

Not measured yet (GA0): the pack's real file layout and any other colours or variants it ships.

## Licence (pack page terms, given by the owner 2026-11-06)

- Use in any game project, personal and commercial: yes.
- Modification: allowed (the recolour, GAD2, and the crop are modifications).
- Redistribution, resale, NFTs and **AI use: prohibited.**
- Credit: not required, appreciated. We credit it anyway (Credits screen, `THIRD_PARTY_NOTICES.md`), like every pack.

What this means here: the raw files stay in gitignored `art/vendor/Free Slimes Asset Pack/` and are never committed or
shared (as with Lords of Pain); the built `goo.png` goes to Roblox only as an in-game asset, which is normal game use.
"AI use" means training AI on the art (owner, 2026-11-06): the port's normal workflow (the atlas pipeline,
the recolour, an assistant helping build it) is not AI use. Never put the pack's files into any AI training set.

## What the code gives us

| Fact | Where | Consequence |
|---|---|---|
| Goo is drawn by `DecalPool` (`GOO_DECAL`), one flat Cylinder per live goo bullet, look from `gooDecalLook` (pop 0.1 s, fade last 0.5 s, in bullet time) | `BulletRenderController.ts`, `shared/view/variants.ts`, `GOO_VIEW` | The sprite is a second mode of the same pool; the disc stays the fallback |
| `bullet.enemy.goo` is a `BULLET_ART.decalIds` entry: `bulletArtReport` fails ANY art on it (PAD3) | `shared/theme/bulletArt.ts`, `contract.ts` | A contract change: goo may take a floor sprite set; strike / ember still may not |
| `enemyGoo` is `#f000f0` (magenta) in every pack; `gooReport` keeps it in the danger family (>= 3:1 on every biome floor, >= 40 CIE76 from decor fx and boosts) | `placeholder/manifest.ts`, `variantColors.ts` | The pack's green would read as moss / decor and fail the family rule: recolour (GAD2) |
| Enemy bullet sprites are recoloured into the danger pink by the atlas pipeline's `recolor` (gradient map, alpha kept); `MAX_ENEMY_BULLET_ART_DIFFERENCE` 12 | docs/PROJECTILE_ART.md, docs/ART.md "Recolour" | Same tool, ramp on `enemyGoo` |
| Flat floor sprites: `SpriteBulletPool`'s anchor (invisible Part + Top-face SurfaceGui, LightInfluence 0, Pixelated ImageLabel, atlas rects) | `SpriteBulletPool.ts` | Reuse its anchor builder; goo is stationary, so it is placed once per puddle (no per-frame BulkMoveTo). Rides PA0's verdict |
| Camera pitch 55 degrees: the floor is foreshortened to sin 55 = 0.82 on screen; the art is already drawn at a 3/4 angle (frame 4 aspect 17 / 31 = 0.55) | `CAMERA_PITCH_DEG` | Laid flat as is, the splat would read 0.45 (squashed twice): the floor depth is stretched by 1 / sin(pitch) so the screen shows the art's own shape (GAD3) |
| Goo hits at 0.35 (0.7 tiles across); the hit circle on screen is 0.7 x 0.57 tiles | `combatData.ts` | Sizing rule GAD4 |
| At most 6 puddles per slime, 8 Oozes per room | `SLIME_DATA.trailMax`, `OOZES_PER_ROOM` | <= 48 anchors (plus slimelets' none): small |
| `bullet.` ids are already in `PRELOAD.core` | docs/PRELOAD.md | No preload change |

## Look

- **Timeline per puddle (bullet time, so the Hourglass stretches it like today):** age < `landSec` (0.1 s, today's
  `popSec`): frame 3; then frame 4 until it expires; transparency 0 -> 1 over the last `fadeSec` (0.5 s, unchanged).
  No scale pop (pixel art scaled mid-pop smears) and no shrink while it still hurts (frame 3 is 77 % of frame 4's
  width, so it is used only in the land window, where today's pop already under-draws).
- **Variety without rng:** an X mirror (and a hold variant, when a pack has more than one) from bits of the
  bullet's slot index (stable for a stationary bullet's whole life, the same on every co-op client because slots are
  deterministic). Two looks with today's one hold cell. Never rotated: the art is a 3/4 view.
- **Facing:** the anchor's "up" is screen-up (turned by `CAMERA_YAW_DEG`).
- **Size (GAD4, "cover the hit"):** the splat's lit ellipse on screen covers the hit circle's: 1.05 tiles wide (31 px
  at 29.6 px a tile, the swarmer skeleton's pack scale), 0.70 tiles deep on the floor. It looks
  wider than it hurts (forgiving, as bullet visuals are), never narrower.
- **Layer:** unchanged: `GOO_VIEW.liftStuds` 0.08, over sprite effects, under markings, affix rings and every
  moving bullet.
- **Colour (GAD2):** recoloured on `enemyGoo` with the black outline kept (it carries the 3:1 on light floors).

## Architecture

1. **Atlas.** New set `bullet.enemy.goo` in `art/atlases.json`, its own group `goo` and `own` sheet `goo.png` (3
   cells: land, hold A, hold B; nearest resample, `recolor` ramp on `enemyGoo`), raw files in gitignored
   `art/vendor/Free Slimes Asset Pack/`, pinned in `art/vendor.lock.json`. `node scripts/art/build-atlases.js --only goo`
   needs only that folder. Generated `packs/vale/gooLayout.ts`. `bullets.png` and every other output stay
   byte-identical (`build-atlases.test.js` pins it): nothing already uploaded is re-uploaded.
2. **Theme.** `BULLET_ART.decalIds` splits into `floorSpriteIds` (`bullet.enemy.goo`) and the rest (strike, ember:
   still no art). A floor sprite set has `heading: "none"`, animations `land` / `hold` (hold may list variants).
   New report `gooArtReport` in its own module (contract.luau 185 / validate.luau 196 top-level locals: count on
   out/ after the change): lit-pixel mean (outline excluded) <= `MAX_ENEMY_BULLET_ART_DIFFERENCE` 12 CIE76 from
   `enemyGoo`, the whole sprite >= 3:1 on every biome floor, >= 40 CIE76 from decor fx and boost roles. Placeholder
   unchanged (the disc).
3. **View, pure (`shared/view/variants.ts` + `GOO_ART_VIEW` in `variantsConfig.ts`).** `gooSpriteLook(lifeLeft,
   totalLife, slot, out)` -> `{ frame, variant, mirror, transparency }`; `gooSpriteSize(litBox, radius, pitchDeg)`
   -> floor width / depth (the GAD4 rule). Specs headless.
4. **Client.** `DecalPool` gains a sprite mode when `pack.bullet("bullet.enemy.goo")` has art: per slot one anchor
   from `SpriteBulletPool`'s builder, placed when the slot appears, its ImageRectOffset written on a frame change and
   Transparency on the quantum (`GOO_VIEW.quantum`). No art id, or `GOO_VIEW.decal` false: exactly today.

## As built (GA0-GA5, 2026-11-06)

- **Atlas (GA1).** Group `goo` in `art/atlases.json` (one set `bullet.enemy.goo`, frames 3 / 4 of Death Down, one crop
  for both: the union lit box x 17..47, y 36..52 + pad 1 = 33 x 19 cells), `node scripts/art/build-atlases.js --only
  goo` / `--lock --only goo` (`ONLY_GROUPS` bullets, goo). `art/build/goo.png` 66 x 19 (land cell 0, hold cell 1),
  generated `packs/vale/gooLayout.ts`. Recolour ramp (source luminance -> colour): 0 black, 82 `#700070`, 110 `#b000b0`,
  150 `#f000f0`, 197 `#ff80ff`, 255 white: every source colour sits on a stop. The build gates it like the enemy
  bullets: mean `#e824e8` (outline excluded), 7.1 CIE76 from `enemyGoo`, worst contrast 3.12 (on `#3a3a46`).
  `scripts/art/goo.test.js`; every other output byte-identical (hashed before and after).
- **Theme (GA2).** `BULLET_ART.floorSpriteIds` (`bullet.enemy.goo`) apart from `decalIds` (strike, ember: still no
  art); per-id animations through `SlotContract.idBaseAnimations` (goo needs `land` / `hold`, not `fly`); a goo set
  carries `lit: { w, h }` (art px) for the size rule. `gooArt.ts` (`GOO_ART_RULES`, `gooArtReport`,
  `gooArtProblems`, after `bulletArtProblems` in variantColors.ts); `ThemePack.floorSprite(id)`. Vale:
  `packs/vale/goo.ts` `valeGooAsset` (nothing until `goo.png` has an id). contract.luau / validate.luau unchanged at
  186 / 196 top-level locals (counted on out/).
- **View (GA3).** `GOO_ART_VIEW`; `gooSpriteLook` (mirror = slot bit 0, variant = (slot >> 1) % holdFrames),
  `gooSpriteSize` (31 x 17 -> 1.046 x 0.700 tiles), `gooSpritePlacement`. `gooSprite.spec.ts`.
- **Client (GA4).** `FloorSpritePool.ts`: the goo `DecalPool` delegates to it when `pack.floorSprite(GOO_BULLET_ID)` is
  defined. Anchors as SpriteBulletPool's, turned by `FLOOR_CANVAS_YAW` (the canvas-turn fix), the canvas at the disc's
  top face, the pivot on the bullet; moved only when a slot appears or moves. The mirror is a negative
  `ImageRectSize` (unchecked in Studio: GA7).
- **GA5.** THIRD_PARTY_NOTICES.md entry and a Credits line (art, modified).
- **Not run here:** `npm run verify` in one go (the device shell's call limit); typecheck, lint, `test:art` and every
  headless spec ran in groups, all passing.

## Tasks

- **GA0. Pack (owner).** Licence cleared (above). Download, put the raw files in `art/vendor/Free Slimes Asset Pack/`, `art:lock`. Check whether the pack
  ships a red / pink / purple slime that clears the family rule without a recolour (then GA1 skips `recolor`).
  **Verify:** frame size and lit boxes match the table above, or the table is corrected.
- **GA1. Atlas set.** As Architecture 1. **Verify:** `npm run test:art`; `goo.png` <= 3 cells; every other output
  byte-identical; the recolour's mean and contrast printed by the build.
- **GA2. Theme contract and `gooArtReport`.** **Verify:** a spec that strike / ember art still fails, goo art passes
  only within the rules; contract.luau / validate.luau compile under Lune within 200 locals.
- **GA3. Pure look and size.** **Verify:** specs: frame 3 only while age < landSec; under the Hourglass (totalLife
  longer) the timeline stretches; same slot -> same variant / mirror; the four looks all occur over slots 0..3; the
  drawn ellipse covers the hit circle on screen at 55 degrees.
- **GA4. DecalPool sprite mode.** **Verify:** placeholder pack and vale without an id draw the disc (unchanged); with
  an id the sprite; floor change clears them; `GOO_VIEW.decal` false still draws the normal bullet look.
- **GA5. Notices and Credits.** `THIRD_PARTY_NOTICES.md` entry (the four terms above, verbatim) and a `CREDITS` line
  (not required, appreciated).
- **GA6. Upload.** `goo.png` -> `assetIds.ts`.
- **GA7. Studio check (after PA0's technique verdict).** Every biome: the goo reads as a hazard, not decor; under
  bullets and markings; the size against the hit (walk into the edge); a six-puddle trail looks varied; the fade;
  frame time with 48 puddles on a phone.

## Decisions (defaults, owner may change)

- **GAD1. Frames 3 and 4 only**, 3 as the land, 4 (both variants) as the hold.
- **GAD2. Recolour into `enemyGoo`** (keeps EVD5 / `gooReport`: goo must read as "this hurts"). Alternative: keep the
  pack's green to match the Ooze's green dome; that needs a new decision overriding the danger-family rule for goo and
  a green `enemyGoo`, and risks reading as moss on the green biomes.
- **GAD3. Flat on the floor, depth stretched by 1 / sin(pitch)**, not a camera-facing billboard (a billboard at the
  floor would cut through markings and bullets).
- **GAD4. Cover the hit:** drawn at least as large as the hit circle on screen (1.05 x 0.70 tiles).
- **GAD5. No new colour role, string, sound, setting or debug flag.**

## Risks

- **Two slime styles.** The Ooze is the Lords of Pain dome (soft, no outline but the 2 px enemy rim); this pack has a
  hard black outline. If they clash in Studio, the fallback is the Lords of Pain death's last two frames
  (`slime_special_death` 5-6, already licensed and on disk) through the same GA1-GA4.
- **Magenta goo under a green slime** may read odd; GA7 judges it (GAD2's alternative is the answer if it does).
- **PA0 not run yet.** If the Top-face SurfaceGui technique fails PA0, goo keeps the disc.

## Out of scope

Strike and ember art; slimelet trails (they leave none); a goo splash or sound on landing; changing the goo's hit
size, life or cap.
