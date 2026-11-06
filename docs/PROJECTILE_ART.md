# Projectile art (Player Bullets pack): plan

Every flying projectile is drawn with sprites from the **Player Bullets** pack instead of the neon placeholder
parts: the player's arrows and build bolts with the pack's yellow / green bolts and its Hyper flame, and every enemy
bullet with shapes the player never fires (chevron, needle, teardrop), recoloured into the danger pink by the atlas
pipeline's existing `recolor`. A 5-frame impact strip becomes an optional `fx.bullet.hit` effect. Work it task by
task; each task ends with a **Verify**.

**Presentation only.** No sim, dungeon, lockstep, server, hash, replay, fixture or score change. Bullet positions,
radii, hit tests, kinds and payloads stay as built; only what `bullet.*` resolves to in the vale pack, and how
`BulletRenderController` draws it, change. The placeholder pack keeps its neon parts, so every placeholder screenshot
and spec is unchanged.

**This plan revisits a standing rule.** docs/ART.md's slice table says "every `bullet.*`: neon placeholders
(unchanged: they keep the GDD bullet-readability rule)". That rule still holds: a sprite only replaces the neon part
once it passes the same readability bar (contrast and colour distance, enforced by the validator, PA3), plus a Studio
sign-off (PA9). If PA0's performance or PA9's readability check fails, the fallback is player bullets only (PAD9).

## Status (2026-11-05, branch `projectile-art`)

PA0-PA7 are built headlessly. PA0 is a Studio spike harness whose measurements are still to be made. PA10 docs are
done. **Open:**

- **PA8, upload.** Upload `bullets.png` and paste its id into `assetIds.ts`. Until then the bundled vale pack draws
  every bullet as its neon placeholder, so the game looks exactly as before.
- **PA0 / PA9, Studio.** Run the spike, then the Studio check.
- **The full `art:build` on the laptop.** It must leave every other output byte-identical, and it is the only build
  that checks the `pixelsPerTileFrom` swarmer density.

The defaults PAD4-PAD11 were followed. See "As built" for what differs from the plan text.

## As built (PA1-PA7)

- **Atlas (PA2, PA7).** The `bullets` group in `art/atlases.json` packs one atlas, `bullets.png` (18x405): the nine
  bullet sets of the mapping table and `fx.bullet.hit` (5 frames, 15x15, 20 fps, one-shot). Every cell carries 1 px
  of pad; the player heavy is the Hyper's 16x32 content box.
  - The build writes `packs/vale/bulletLayout.ts`: `VALE_BULLET_SHEET`, `VALE_BULLET_LAYOUTS`, and
    `VALE_BULLET_FX_LAYOUTS` (the hit, in the fx layout's shape).
  - `node scripts/art/build-atlases.js --only bullets` builds just this group, needing only
    `art/vendor/player-bullets/`. `--lock --only bullets` re-hashes just those files into the lock.
  - A full `art:build` builds the group after `fx`. No other builder reads it, and `packFx` only gained an optional
    label. `fx-effects.png` is untouched: the hit rides in `bullets.png` and the vale fx assets now come from a list
    of sheets (`VALE_FX_SOURCES`).
- **Ramps (PAD1).** One ramp per enemy set: the pack's luminance levels differ too much for a shared one. All four
  use the plan's six colours (`#1a0610` .. `#ffe0f0`) at their own stops (`recolorNote` per set).
  - Measured means: small `#f24ca2`, medium `#f24ba1`, large `#f24aa2`, needle `#f24ca1`.
  - They are 7.1-7.9 CIE76 from `enemyBullet`, and the worst contrast is 3.35-3.38:1, on `#3a3a46`.
  - The build fails on any gate miss (`gates.enemy` / `.player` / `.fx`).
- **Player colours (deviation).** The plan never measured against `telegraph` (`#ff8a3d`), and the validator rule
  does. As drawn, the Hyper flame (heavy) and the plain yellow bolt (shard) measured 38.3 / 36.6 from it, under the
  40 bar. A mild gold-lift `recolor` takes them to 44.6 / 44.8. The thin yellow (basic) passes as drawn at 40.6:
  close, and worth a look in PA9.
  - The hit burst is 104.6 from the enemy pink but 30.1 from the telegraph. The fx rule does not include the
    telegraph, so the build gates it against the enemy-bullet roles only (`gates.fx`).
- **Contract and theme (PA3).**
  - Contract: BULLET takes `spritesheet` / `sprites` / `placeholder`, with `heading: "up"`. `BULLET_ART` holds
    `animation` `fly`, `maxFrames` 4, `decalIds` and `hitFx`, and `MAX_ENEMY_BULLET_ART_DIFFERENCE` is 12.
  - Runtime: `ThemeCore.bullet(id)` / `ThemePack.bullet(id)`, cached. Art it cannot draw warns once and falls back to
    the placeholder.
  - Validator: `bulletArtReport` in `shared/theme/bulletArt.ts`, folded into `variantColorProblems`. **Ember is a
    decal id too:** goo, strike and ember may not take art (PAD3).
  - Top-level locals: `contract.luau` 185 -> 186, `validate.luau` unchanged (counted on out/).
- **Vale (PA6).** `packs/vale/bullets.ts` `valeBulletAssets` builds one-facing Pixelated sprite sets over the sheet
  once `bullets.png` has an id.
  - Test seam: `ValeLayoutSources.bullets`.
  - `valeBullets.spec` proves that the real generated layouts pass `validateManifest`, `bulletArtReport` and the fx
    colour rule.
- **View (PA4).** `shared/view/bullets`:
  - `enemyBulletLookOf` maps SNIPER to the needle, CASTER to medium, BOSS to large, and every other kind to small.
  - `bulletFrame` gives the phase by slot, and holds frame 0 under reduced motion.
  - Orientation: `bulletYaw` / `bulletYawAxes` with no trig, the art's up on the canvas up with `canvasTurnDeg` 90
    (the FX floor finding), plus `screenHeading`.
  - `BulletImpacts`: projected life over multi-tick frames, slot reuse, restarts.
  - `BULLET_ART_VIEW`: canvas 4 px per art px, enemy sprites lifted 0.02 studs over player sprites.
- **Renderer (PA5).** `SpriteBulletPool` (one anchor Part per slot with a Top-face SurfaceGui and a Pixelated
  ImageLabel, LightInfluence 0) is option B of PA0, provisional until PA0's numbers are in.
  - It does one BulkMoveTo a frame, with the yaw in the CFrame. Writes happen only on change.
  - The flicker runs on the sim clock, so it freezes with hitstop.
  - The neon pool skips the payloads whose look has art (`skip(payload, scale)`). It is built only when some look has
    art. Trails moved unchanged to `bulletTrails.ts`.
  - **Deviation:** every enemy look keeps the small ball as its neon placeholder, so a sniper's bullet does not
    become an unturned `needle` sliver while art is missing.
- **Impact effect (PA7).**
  - Cue: `FxCueMapper.bulletHit(x, z)` is the lowest-ranked source. It shows at most `FX_SPRITE_VIEW.bulletHitQueue`
    (3) a frame, starts only while live effects are under `bulletHitBudgetShare` (0.5) of the budget, and shows none
    under reduced motion.
  - Feed: `FxSpriteController` owns a `BulletImpacts` over the player bullets only, with embers skipped, built only
    when the pack has the hit art.
- **Preload.** `bullet.` joined `PRELOAD.core`.
- **Spike (PA0).**
  - Spike A gained render modes N / A / B / C (keys 5-8) and `+200` player bullets (key 0).
  - With no bullet art, the engine's particle textures stand in: `shared/theme` `SPIKE_ENGINE_TEXTURES`, which
    `check:assets` requires there.
  - The script and the result tables are in docs/SPIKES.md "Spike PA0".
- **Notes for PA9.**
  - The needle's dark frame alone is 2.92:1. The set mean passes, but the dark frame is under 3:1 on its own.
  - The medium teardrop has no dark rim: 72 % of its pixels share one level. PAD6's baked rim is the fix if it reads
    soft.
  - Studio must confirm the canvas orientation (`canvasTurnDeg`), the face mapping and the Pixelated look.

## The pack (measured 2026-11-05)

**Source.** "16Bit Bullets, missiles, Explosions & Misc Asset Pack - Shooter/RPG/Any 2D Genre - Pixel Art" by
**J i m** (itch.io `jinvorionstg`,
<https://jinvorionstg.itch.io/bullet-asset-pack-top-down-or-shmup-classic-bullet-hell-style>; published 2025-08-28,
tagged "No AI"). The page offers two downloads: `Player Bullets.rar` (6 kB, name your own price: the file used here)
and `BulletPack.rar` (1 MB, $3.77 or more: missiles, explosions, lasers and more, not held). **Terms:** the page has
no licence field. The author's only statement is a reply in its comments (about 9 months before 2026-11-05) to
"what are the terms of your assets? for commercial use?": "You can use them however you want, even for commercial
use." Credit is not required by the page. The owner credits it anyway (PAD2). Redistribution of the raw files is not
addressed, so they stay in gitignored `art/vendor/` like every pack.

`Player Bullets.rar` (6 KB): 10 PNGs in `Player Bullets/`, horizontal strips of equal-width frames, every pixel
opaque or clear (no partial alpha). Each frame's art points **screen-up** (the direction of travel). The mean colour
covers opaque pixels. ΔE is CIE76 from `enemyBullet` `#ff3fa4`. The contrast is the worst WCAG ratio over the 12
biome floor and wall colours.

| File | Size | Frames | Mean | ΔE pink | Worst contrast | Reads as |
|---|---|---|---|---|---|---|
| `P1 Bullet_Yellow_Thinier.png` | 18x19 | 3 @ 6x19 | `#edc134` | 113 | 6.6 | thin yellow bolt, flicker |
| `P1 Bullet_Yellow.png` | 18x17 | 3 @ 6x17 | `#eebc36` | 110 | 6.4 | yellow bolt, flicker |
| `P1 Bullet _Thinier_BermudaGreen.png` | 18x21 | 3 @ 6x21 | `#52df9a` | 137 | 6.6 | thin green bolt, flicker |
| `P1 Bullet_BermudaGreen.png` | 18x21 | 3 @ 6x21 | `#4cd69b` | 133 | 6.1 | wide green bolt, flicker |
| `P1 Bullet Stream.png` | 16x16 | 2 @ 8x16 | `#61e3b1` | 130 | 7.0 | mint teardrop, large / small |
| `P1_Hyper_Bullet.png` | 64x32 | 2 @ 32x32 (content 16x32) | `#f7cb6b` | 100 | 7.4 | large flame shot |
| `P1_Bullet_Alt2.png` | 26x26 | 2 @ 13x26 (content 13x15) | cyan `#3eb9c5` / pink `#c44d92` | 108 / **25** | 4.8 / **2.6** | chevron, two colourways |
| `P1_Bullet_Pink.png` | 6x17 | 1 | `#5c5c5c` | 81 | **1.7** | grey needle (misnamed; a tint template) |
| `p1_Bullet_Alt.png` | 12x19 | 2 @ 6x19 | `#656565` | 80 | **1.9** | grey needle, 2 frames |
| `P1_Bullet_Hit.png` | 70x14 | 5 @ 14x14 | `#e8ad2c` | 105 | 5.6 | impact burst |

What follows from this:

- **The bolts, teardrop and flame are safe player art.** Each is >= 100 ΔE from the enemy pink and >= 6:1 on every
  floor.
- **The pink chevron cannot be used as it is.** As player art it sits too close to the danger colour (25 ΔE, and the
  validator's bar is 40). As enemy art it is too dark (2.6:1, and `MIN_ENEMY_BULLET_CONTRAST` is 3.0). Hence PAD1:
  recolour it.
- **The grey needles are tint templates, but `ImageColor3` cannot tint them.** It multiplies, so a pink tint makes
  them darker still (1.7-1.9:1 before any tint). They need a gradient map at build time, which the pipeline's
  `recolor` already does (docs/ART.md "Recolour", built for the Goldling).
- **The art is small.** Its frames are 6-16 px wide. At the world art's shared 29.6 px/tile, the thin bolt is
  0.2 x 0.64 tiles, close to today's arrow (`BULLET_VIEW.playerDrawHalfLength` 0.3, so 0.6 long).

## What the code gives us (checked against `main` @ `bc03573`)

| Fact | Where | Consequence |
|---|---|---|
| Bullets are pooled neon Parts. Part i is bullet slot i, and every visible bullet moves in ONE `workspace:BulkMoveTo` a frame | `client/controllers/render/BulletRenderController.ts` `BulletPool` | A sprite pool must keep a single batched move, or match its cost (PA0) |
| Capacities: 2048 enemy bullets, 512 player bullets | `sim/combat/combatData.ts` | PA0 measures 1,000 / 2,000 enemy bullets plus 200 player bullets |
| Spike A's results table was **never filled in** | docs/SPIKES.md "Results / Spike A" | PA0 records the neon baseline first, in the same session |
| The player pool already picks a look per bullet: `playerBulletLookOf` gives basic / heavy / burst / shard / bolt / ember | `shared/view/buildBullets.ts` | Each look gets its own sprite. Embers stay floor decals (PAD3) |
| The enemy pool always uses look 0 (`bullet.enemy.small`). `BulletKind` already tells SPRAYER / SNIPER / CASTER / ENEMY / BOSS / STRESS apart, and `BulletPool` takes a `lookOf` | `sim/combat/patterns.ts`, `BULLET_VIEW.enemyVisualId` | A new `enemyBulletLookOf(payload)` can light up the unused `.medium` / `.large` / `.needle` IDs with no sim change |
| The `BULLET` slot accepts only `spritesheet` / `placeholder`, at one 8x8 cell with `fly: 2` | `shared/theme/contract.ts` `BULLET` | The contract must accept `sprites` with per-sheet cells and its own frame count (PA3) |
| The renderer reads only `pack.placeholder(id)` for bullets | `bulletLook()` | It needs a new `pack.bullet(id)` accessor |
| `FxSpriteController` draws flipbooks as an ImageLabel in an anchor Part's floor SurfaceGui (or a BillboardGui), using `ImageRectOffset`, `LightInfluence` 0 and Pixelated filtering | `client/controllers/fx/FxSpriteController.ts` | A tested construction for PA0's option B, and the home of `fx.bullet.hit` (PA7) |
| Camera: yaw 45°, pitch 55° | `shared/config/view.ts` | A flat-on-floor sprite is foreshortened to 0.82 along screen-up. A billboard needs a screen-space heading (PA4) |
| `contract.luau` / `validate.luau` sit at 185 / 196 of Luau's 200 top-level locals | CLAUDE.md (treasure / fortune) | New contract constants go inside functions or existing tables; count them on `out/` (PA3) |
| Placeholder colours: `enemyBullet` `#ff3fa4`, `enemyBulletOutline` `#1a0610`, `playerBullet` `#9db8c8`, build roles spark / burst / shard / ember | `packs/placeholder/manifest.ts` | The enemy recolour ramp runs from the outline to the role. The roles stay as trail and fallback colours |

## The mapping

**Shape rule (PAD4).** Bolts and the flame are the player's. Chevrons, needles and teardrops are the enemy's, always
in the danger ramp. A player never sees their own shape in pink, or an enemy shape in yellow or green.

| Logical ID | Who fires it | Art | Frames | Notes |
|---|---|---|---|---|
| `bullet.player.basic` | bow stream arrow (`PlayerBulletLook.BASIC`) | Yellow_Thinier | 3 | the shot you see most: thin, warm |
| `bullet.player.heavy` | charged piercing arrow (scale > `heavyScaleThreshold`) | Hyper_Bullet (content box 16x32) | 2 | drawn at the arrow's scale; its own size key |
| `bullet.player.bolt` | Flurry / Thrill Seeker (`SPARK_BOLT`) | Thinier_BermudaGreen | 3 | green marks build fire |
| `bullet.player.burst` | Volatile's ring (`BURST`) | BermudaGreen (wide) | 3 | keeps its trail part |
| `bullet.player.shard` | Soul Shards (`SHARD`) | Yellow | 3 | keeps its trail part. PAD4 alternative: Stream teardrop, if the enemy side does not take it |
| `bullet.player.ember` | Fire Arrows / Blazing Trail | unchanged floor decal | | PAD3 |
| `bullet.enemy.small` | SPRAYER / ENEMY / STRESS | Alt2 **cyan half**, recoloured to the danger ramp | 1 (+ frame 2 = pink half recoloured, if it reads as a flicker) | turned along the velocity |
| `bullet.enemy.medium` | CASTER | Stream frame 1 (small teardrop), recoloured | 1 | |
| `bullet.enemy.large` | BOSS (Mother Bramble, Demon Lord) | Stream frame 0 (large teardrop), recoloured | 1 | big, round-bottomed: reads as heavy |
| `bullet.enemy.needle` | SNIPER | p1_Bullet_Alt, recoloured | 2 | `Pink.png` (one frame) is the spare |
| `bullet.enemy.goo` / `.strike` | Ooze / Stormcaller | unchanged floor decals | | PAD3 |
| `fx.bullet.hit` (new, optional) | player bullet impact | Bullet_Hit | 5 | PA7, one-shot |

**Danger ramp (PAD1, a starting point tuned in PA2).** Stops by source luminance: 0 `#1a0610` (the outline) / 40
`#5a0a33` / 90 `#c0206f` / 150 `#ff3fa4` (the role) / 210 `#ff8ac6` / 255 `#ffe0f0`. The art's darkest pixels become
the dark rim that makes today's bullets read, and its lit core lands on the role. Gate: the set's mean colour must be
<= 12 ΔE from `enemyBullet` and >= 3:1 on every floor and wall (PA3).

## Architecture

### 1. Atlas (`art/atlases.json`, `npm run art:build`)

- Vendor folder: `art/vendor/player-bullets/` (gitignored like every pack; `art:lock` hashes the 10 PNGs).
- One new atlas, `bullets.png` (every frame of every bullet, < 2 KB of pixels before padding), and a generated
  `packs/vale/bulletLayout.ts` (per ID: frame rects, frame count, pivot = frame centre, `meanColor`,
  `pixelsPerTile`). Sources are one-row strips (the fx pipeline's strip source, or `grid` with `frameW` / `frameH`). A
  per-source `rect` cuts Alt2's halves and Hyper's content box.
- `recolor` on the four enemy sets (the existing gradient map, unchanged).
- `pixelsPerTileFrom: "enemy.swarmer"` (29.6) on every set (PAD5).
- If PA0 picks Decals (bilinear only), an opt-in `upscale: n` nearest-neighbour step before packing. The pixel art
  then stays crisp under linear filtering. The Pixelated ImageLabel path does not need it.
- `fx-effects.png` gains `fx.bullet.hit` (5 x 14x14), or the strip rides in `bullets.png` if the fx atlas would repack
  (decide in PA2: a repack means a re-upload).
- Every older output must be byte-identical (`test:art`).

### 2. Theme (`shared/theme`, `packs/vale`)

- `BULLET` slot: `kinds` adds `sprites`, `perSheetCells: true`, base animation `fly` (frame count from the art,
  1-4), one facing, a new field `heading: "up"` (the art's direction of travel).
- `ThemePack.bullet(id)`: `BulletArt | undefined`, where undefined means draw `.placeholder`. A `BulletArt` is
  `{ image, frames: rects, fps, sizeTiles, meanColor }`.
- Validator `bulletArtReport`, folded into the existing report list:
  - player bullet art's `meanColor` is >= `MIN_FX_BULLET_DIFFERENCE` (40) ΔE from `ENEMY_BULLET_ROLES` and
    `telegraph`;
  - enemy bullet art's `meanColor` is <= 12 ΔE from `enemyBullet` and >= `MIN_ENEMY_BULLET_CONTRAST` on every biome
    floor and wall;
  - an ID with art must have every frame in range.
- Placeholder pack: no change. Vale manifest: art once `bullets.png` has an ID in `assetIds.ts`, else the placeholder
  (the boost / ui-marker pattern).

### 3. View (`shared/view/bullets/`, pure, specs headless)

- `ENEMY_BULLET_LOOK_IDS` + `enemyBulletLookOf(payload)` by `BulletKind`. The placeholder pack draws all four IDs
  alike, so nothing changes without art.
- `BULLET_ART_VIEW`: draw sizes, the flicker rate (`fps` 10, phase = slot index mod frames so a ring does not pulse
  in step), `frozenFrame` 0 under reduced motion, and `maxFrameWritesPerFrame` if PA0 needs a budget.
- `bulletFrame(tick, slot, frames, reduced)`. `screenHeading(vx, vz)` gives the velocity's angle on screen through
  the iso basis, for billboards. Flat-on-floor sprites use the world yaw instead.
- `bulletImpacts`: a view-side diff, presentation only. A player slot that lost its bullet while `lifeAt` > 1 tick
  was an impact at its last position. Capped per frame. Feeds PA7.

### 4. Client (`BulletRenderController`)

- A `SpriteBulletPool` next to `BulletPool`, behind the same `frame(sim, alpha, fade)` call, built with PA0's winning
  technique.
- A look's Image / rect / size changes only on a look or quantized-size change (as Size / Color today). The frame
  rect changes only when its flicker frame changes. Unused slots park.
- Co-op teammate fade writes `ImageTransparency` (`playerBulletTransparency`, unchanged).
- The end-of-life fade shrinks the size (unchanged).
- Trails stay neon parts in the role colour.
- The placeholder path is untouched: a look with no art stays a `BulletPool` part.
- Unlit: `LightInfluence` 0 (or an unlit Decal equivalent), so a sprite keeps the neon's "glows on every floor" (PAD10).

## Tasks

- [ ] **PA0. Spike: sprite bullets at bullet-hell counts.** (Harness built: docs/SPIKES.md "Spike PA0"; measurements pending.) Extend `BulletSpikeController` (`KV_SpikeBullets`) with
  a mode switch. Measure at 100 / 500 / 1,000 / 2,000 bullets, rings and spiral, a 6x19 3-frame sprite turned along
  the velocity:
  - **(N)** today's neon Parts (fills spike A's empty table: the baseline);
  - **(A)** a Part per slot with a top-face `Decal` (BulkMoveTo, frames as separate textures, bilinear);
  - **(B)** a Part per slot with a floor `SurfaceGui` + `ImageLabel` (BulkMoveTo for the anchors, Pixelated, atlas
    rects; FxSpriteController's construction);
  - **(C)** one canvas `SurfaceGui` per pool with an ImageLabel per slot (`Position` / `Rotation` writes, no Part
    moves).

  Record fps, update / BulkMoveTo / property-write ms and the worst frame in docs/SPIKES.md, on PC and the phone
  emulator, at quality 1 and 10. Look at each for blur, lighting and draw order (under walls, over the floor).
  → Verify: go if the best option holds 60 fps on PC with 1,000 enemy + 200 player bullets and its update is
  <= 1.5x the neon baseline's. That option is PAD9's pick. No go: PAD9's fallback.

- [x] **PA1. Lock the pack and its credit.** Unpack `Player Bullets.rar` into `art/vendor/player-bullets/` and run
  `npm run art:lock`. Add a `THIRD_PARTY_NOTICES.md` section: the pack's title, J i m (itch.io
  `jinvorionstg`), the page URL, the author's quoted terms with their date and where they were found (the page's
  comments), the files used (`Player Bullets.rar`), the recolouring ("modified": enemy sets), "Used for: every flying
  projectile", and "raw files not redistributed". Add a `CREDITS` row (`shared/view/menu/credits.ts`):
  `{ section: "art", work: "16Bit Bullets Asset Pack", author: "J i m", modified: true }`, with no `license` line
  (none is named).
  → Verify: `art:build` checks the files against the lock; `git status` shows no PNGs; `fit.spec` still passes with
  the extra Credits row.

- [x] **PA2. The bullet atlas.** Add the `bullets` entries in `art/atlases.json` from the mapping table: strips, rects,
  the danger ramp on the four enemy sets, `pixelsPerTileFrom`, `meanColor`, and `upscale` if PA0 chose (A). The
  generated `bulletLayout.ts` follows. Any pipeline option it needs (strip `rect`, `upscale`) is opt-in, with a
  `test:art` spec.
  → Verify: two builds are byte-identical; every older atlas is byte-identical; the contact sheet shows each bullet
  pointing up, the enemy four in pink with a dark rim; the printed enemy means are <= 12 ΔE from `#ff3fa4` and the
  worst contrast is >= 3:1 (tune the ramp until they are).

- [x] **PA3. Contract, theme API, validator.** `BULLET` accepts `sprites` (Architecture §2), adds `ThemePack.bullet(id)`
  and `bulletArtReport`. Specs: an art-less pack is unchanged; a pink player bullet fails; a dim enemy bullet fails;
  bad frame rects fail. Count top-level locals on `out/` (`contract.luau` 185, `validate.luau` 196 before this task).
  → Verify: `npm run verify`; both counts stay <= 199 and compile under Lune.

- [x] **PA4. Pure view core.** `shared/view/bullets/` (§3) with specs:
  - `enemyBulletLookOf` covers every `BulletKind`, and goo / strike never reach it;
  - frame phase and reduced-motion freeze;
  - `screenHeading` for the 8 compass velocities against the camera basis;
  - `bulletImpacts` on a scripted slot timeline (a hit vs natural expiry vs a run restart).

  → Verify: `npm test`; every fixture hash unchanged.

- [x] **PA5. Renderer.** `SpriteBulletPool` (§4) for the player pool (five looks) and the enemy pool (four looks, its
  new `lookOf`). It is chosen per look: a look with art draws sprites, a look without draws the part. The goo, strike
  and ember decal pools are unchanged. MicroProfiler label `KV Bullets` kept.
  → Verify: placeholder pack in Studio looks exactly as before; with fake vale IDs (KV_Debug), every look draws.

- [x] **PA6. The vale pack.** Wire `bulletLayout.ts` into `manifest.ts`. Extend `vale.spec`: with no IDs every
  `bullet.*` is the placeholder; with the `bullets.png` ID each mapped ID is `sprites` and passes `bulletArtReport`.
  → Verify: `npm run verify`.

- [x] **PA7. Impact effect (optional, PAD11).** `fx.bullet.hit` (5 frames, `sizeTiles` 0.5, untinted, additive) as a
  new low-rank source in the fx cue mapper, fed by `bulletImpacts`, under `FX_SPRITE_VIEW.maxSprites` with a
  per-frame cap, and off under reduced motion. Never for enemy bullets.
  → Verify: an `fxCues.spec` case (a scripted bow stream into a wall gives capped cues; a stream that expires gives
  none); `fx.spec` colour rule passes.

- [ ] **PA8. Upload.** Upload `bullets.png` (and the fx atlas if PA2 repacked it) and paste the IDs into
  `assetIds.ts` with the upload note. → Verify: `npm run verify`; `check-asset-ids` clean.

- [ ] **PA9. Studio check.** Endless floors on every biome (solo and a 2-player party), the tutorial, the
  `?stress` 1,000 / 2,000 rings, both bosses, PC and the phone emulator:
  - enemy bullets read at a glance on the darkest floor and in the densest pattern; side-by-side with the neon build;
  - player shots never read as danger;
  - drawn size against the hitbox (hitbox debug on): the hot core covers the hitbox and the chevron's tips do not make
    grazes feel unfair;
  - turning along the velocity, flicker, the co-op teammate fade, the end-of-life shrink;
  - fps and texture memory next to PA0's numbers.

  Record in docs/SPIKES.md. → Verify: the owner signs off PAD4-PAD10; a failed readability check takes PAD9's
  fallback.

- [x] **PA10. Docs.** docs/ART.md (the slice table's `bullet.*` row, the packs table, and the "neon placeholders"
  line), CLAUDE.md (decision log entry and document table), docs/FX_AUDIO.md (`fx.bullet.hit`), docs/CLIENT.md
  (sprite smoke steps), `art/atlases.json` comments, this file's Status.

## Decisions

Owner answers (2026-11-05, Kaleb):

- **PAD1. Enemy bullets: recoloured pack shapes.** They use shapes the player never fires (chevron, needles,
  teardrops), gradient-mapped into the danger pink by the pipeline's `recolor`. The pack's own pink chevron is not
  used as it is.
- **PAD2. Licence: free, credited.** The pack goes on the Credits screen and in `THIRD_PARTY_NOTICES.md` (owner's
  choice; the page does not require credit). The source is J i m's itch.io pack, and its terms are the author's
  comment, "use them however you want, even for commercial use" (see "The pack"). The raw files stay out of git, since
  redistribution is not addressed. A written licence from the author (jinvostg@gmail.com, listed on the page) would
  be stronger evidence than a comment, but it is optional.
  The paid `BulletPack.rar` may hold purpose-made enemy bullets. If bought, it could replace PAD1's recoloured
  shapes; that would need a new art pass and is not part of this plan.
- **PAD3. Floor hazards unchanged.** Goo puddles, lightning strikes and ember flames stay flat neon decals. Only
  projectiles that fly get sprites.

Recommended defaults (confirm or change before the task in brackets):

- **PAD4. Shape split [PA2].** Bolts and the flame are the player's; chevron, needle and teardrop are the enemy's. Soul
  Shards take the plain yellow bolt (alternative: the Stream teardrop, with the boss taking the chevron at a larger
  size).
- **PAD5. One texel density [PA2].** 29.6 px/tile like all world art, not each sprite stretched to the gameplay
  radius. A bullet whose drawn size strays more than about 40 % from today's draw size gets a per-ID `sizeTiles`
  override.
- **PAD6. The dark rim comes from the ramp [PA2].** The ramp's bottom stop is `enemyBulletOutline`, so no separate
  outline sheet (which would double the draws). Add a 1 px baked rim only if PA9 finds the edges soft.
- **PAD7. Vale only [PA3].** The placeholder pack and every spec keep the neon parts.
- **PAD8. Flicker [PA4].** Bolt frames loop at 10 fps. Each bullet's phase comes from its slot index. Bullets hold
  frame 0 under reduced motion.
- **PAD9. Technique and fallback [PA0].** The renderer uses PA0's winner. If none is good enough, player bullets
  (<= 512) get sprites and enemy bullets stay neon. If even that fails, the plan stops at PA4 and the art waits.
- **PAD10. Unlit [PA5].** Sprites ignore scene lighting, so a bullet is as bright in the frost biome as in molten,
  like the neon.
- **PAD11. Impacts are optional and player-only [PA7].** Enemy bullets dying at walls would fill dense rooms with
  bursts.

## Risks

- **Performance.** Today 2,000 neon Parts move in one engine call. GUI-backed sprites cost more per bullet, and
  Decals cannot use atlas rects. PA0 decides before any production code; the fallback is PAD9.
- **Readability.** Sprites lose the neon glow and the round silhouette players have learnt. The validator rules,
  unlit drawing and the PA9 side-by-side guard this. The rule from docs/ART.md wins over the art.
- **Hitbox honesty.** The enemy hitbox is 0.12 tiles in radius and the drawn chevron about 0.44 tiles wide. Grazes
  (docs/GRAZE_PARRY.md) may then feel like hits that missed. Tune `sizeTiles` in PA9.
- **Blur.** Decals filter linearly. If PA0 picks Decals, the `upscale` step is mandatory.
- **Luau locals.** `contract.luau` / `validate.luau` are near the 200-local limit (PA3).
- **Terms rest on a comment (PAD2).** The page has no licence field, so the author's comment could change or
  vanish. The notice quotes it with its date. A screenshot of the comment, kept beside the vendor files, records it.

## Out of scope

- Goo, strike and ember decals (PAD3).
- Any sim change: new bullet kinds, radii or speeds.
- Bullet audio.
- The placeholder pack.
- Melee swing art (`fx.swing.*`).
- The graze / parry sparks.
- New enemy bullet colours per archetype: one danger colour stays the rule.
