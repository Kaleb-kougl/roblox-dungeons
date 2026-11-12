# Art assets: vertical-slice plan

Scope: **only what the vertical slice draws** (PLAN.md "Vertical slice": the endless solo and co-op run, M1 sim,
swarmer / sniper / bruiser rooms, Mother Mayhem, relic pedestals and the curse shrine). Work it task by task, like
`PLAN.md`; each task ends with a **Verify**. Art is presentation only: nothing here touches `src/shared/sim/**` or
`src/shared/dungeon/**`, and every fixture hash must stay the same.

## What the slice draws, and what fills it

The slice's code asks for one class (`class.vanguard`; co-op parties are all vanguards), three enemies, one boss,
six bullet IDs, the biome tiles, `ui.cursor` (the facing pip) and the pedestal / shrine markers.

| Logical ID / view | Slice art | Source |
|---|---|---|
| `class.vanguard` (every player, solo and co-op) | **Knight** | SmallScaleInt free edition (already here) |
| `enemy.swarmer` (packs of 4-6, the most common enemy) | **Skeleton** (walk, death) | Lords of Pain demo |
| `tile.biome.1.floor` | **`ground_stone1`**, tiled | Lords of Pain demo |
| `tile.biome.2.floor` / `tile.biome.2.wall` (the molten biome; "As built: molten tiles" below) | **Original art**: basalt flagstones / coursed basalt blocks with lava in the joints, by `scripts/art/molten/gen_molten_tiles.py`, tiled (256 x 256, `tilesPerImage` 4); built and uploaded 2026-11-08 (`assetIds.ts`), so the bundled vale pack draws them | none (original) |
| `tile.biome.3.floor` / `tile.biome.3.wall` (the frost biome; "As built: frost tiles" below) | **Original art**: slate flagstones with snow-packed joints, rime and hoarfrost / coursed slate blocks with snow on their tops and icicles, by `scripts/art/frost/gen_frost_tiles.py`, tiled (256 x 256, `tilesPerImage` 4); built and uploaded 2026-11-08 (`assetIds.ts`), so the bundled vale pack draws them | none (original) |
| `tile.biome.4.floor` / `tile.biome.4.wall` (the grim biome; "As built: grim tiles" below) | **Original art**: crypt slate slabs with worn corners, cracks, an engraved grave slab and grave moss in the joints / mixed-height crypt masonry with damp streaks, moss caps and tendrils, by `scripts/art/grim/gen_grim_tiles.py`, tiled (256 x 256, `tilesPerImage` 4); built and uploaded 2026-11-09 (`assetIds.ts`), so the bundled vale pack draws them | none (original) |
| `tile.biome.5.floor` / `tile.biome.5.wall` (the verdant biome; "As built: verdant tiles" below) | **Original art**: mossy grey-green limestone flagstones with moss in the joints, grass tufts, leaf litter and lichen / coursed limestone blocks with moss caps, lichen and trailing ivy, by `scripts/art/verdant/gen_verdant_tiles.py`, tiled (256 x 256, `tilesPerImage` 4); built and uploaded 2026-11-09 (`assetIds.ts`), so the bundled vale pack draws them | none (original) |
| co-op player marker / under-player ring | **`highlight_yellow`**, tinted per player | Lords of Pain demo |
| relic pedestal marker (`RunMarkerController`) | **`loot_indicator_yellow`** beam (+ `glint`, stretch) | Lords of Pain demo |
| `enemy.golden` (the Goldling, docs/FORTUNE.md FO10 / FD14) | **Skeleton recoloured gold** (`recolor`, below; bodyTiles 0.95): `golden-move.png`, `golden-death.png` + rims, built 2026-11-04, not uploaded | Lords of Pain demo |
| `enemy.dummy` (the tutorial's training dummy, docs/DUMMY_ART.md) | **Training Dummy** (idle 1, hit 7, break 9; one facing, pixel art, `Pixelated`, bodyTiles 1.4; the hit wobble on a view-side 0.7 s clip): `dummy.png` + rim, built 2026-11-06, not uploaded | Training Dummy 2D Pixel Art |
| `enemy.sniper` (+ the tutorial's `turret.sniper`) | **Subservient** (worship; every other animation a stand-in, docs/SNIPER_ART.md) | Lords of Pain (full pack) |
| `enemy.bruiser` | **Demon Beast 3** (idle, walk, Attack 4 leap and slam, TakeDamage 1, Die 1; docs/DEMON_ART.md): 3 sheets + rims, uploaded 2026-10-26 | 2D Demons - TopDown asset pack v1.1 |
| `boss.act1` (Mother Mayhem) | **Demon Elite 3** (idle, walk, taunt, Attack 1-4, Die 1; docs/BRAMBLE_ART.md): 7 sheets + rims, uploaded 2026-10-26 | 2D Demons - TopDown asset pack v1.1 |
| `enemy.sprayer` / `enemy.caster` (M1's turrets, the tutorial's sprayers) | **Demon Spawn 8** / **Demon Spawn 11** (Idle 1, TakeDamage 1, Die 1; the baked staff glow cut by `layerNoiseAlpha`; docs/DEMON_ART.md Phase 2): 2 sheets + rims each, uploaded 2026-10-30 (DA13) | 2D Demons - TopDown asset pack v1.1 |
| boost drops `boost.fury` / `.quickstep` / `.frenzy` / `.aegis` (docs/BOOST_ART.md) | **`gold_drop`** (Fury) and **`gemstones_blue` / `_green` / `_white`**, S facing frame 0, 29.6 px/tile; halo `decor.fx.glow` and sparkle `decor.fx.glint` (the decor atlas), beam **`loot_indicator_white`** (`ui.marker.boost`), all tinted by the kind's role | Lords of Pain (full pack) |
| the UI (menus, overlays, in-run HUD, touch; docs/UI_ART.md) | 12 sliced pieces (`ui.panel.*`, `ui.button*`, `ui.option.*`, `ui.bar.*`, `ui.slot*`) and the `ui-icons.png` atlas (hearts, flasks, candle, chips, glyphs, ornament); uploaded 2026-10-30 | UI User Interface Pack - Horror |
| the menus' mouse pointer `ui.cursor` / `ui.cursor.hover` (docs/CURSOR.md) | **`cursor_gauntlet_white`** (normal) and **`cursor_gauntlet_yellow`** (over a button), cut to the same 29 x 29 rect, fingertip pivot source (53, 54) -> (4, 4); drawn as a software cursor in menus only, Pixelated at whole scales. `ui-cursor.png` / `ui-cursor-hover.png` built and uploaded 2026-11-11 | Lords of Pain (full pack) |
| walls, the shrine | placeholder primitives (unchanged) | none |
| every flying `bullet.*` (docs/PROJECTILE_ART.md) | **Player Bullets**: yellow / green bolts and the Hyper flame for the player; chevron / teardrops / needle recoloured into the danger pink (`recolor`, one ramp per set) for enemies; the impact burst as `fx.bullet.hit`. One atlas `bullets.png` (`--only bullets`), built and uploaded 2026-11-05 (`assetIds.ts`), so the bundled vale pack draws them. Strike / ember stay neon floor decals (PAD3); goo has its own art (next row). The GDD bullet-readability rule now lives in `bulletArtReport` | 16Bit Bullets Asset Pack (J i m) |
| the Ooze's goo puddles `bullet.enemy.goo` (docs/GOO_ART.md) | **Free Slimes Asset Pack** green slime death, frames 3 (land) and 4 (splat), recoloured into `enemyGoo`, flat on the floor. Own sheet `goo.png` (`--only goo`), built and uploaded 2026-11-06 (`assetIds.ts`), so the bundled vale pack draws them | Free Slimes Asset Pack (heimlich3) |
| the boost auras under a boosted player `fx.boost.aura.<kind>` (docs/BOOST_ART.md BAD3) | **Original art** drawn by `scripts/art/gen-boost-auras.js` (Fury flame ring with embers, Quickstep three comets, Frenzy six whirling blades, Aegis six shield plates with a sweeping glint), greyscale tinted by `boost.<kind>`, 8-frame loops, every stack rank (ring 16 / 20 / 25 / 29 px) drawn natively. Own sheet `boost-auras.png` (`--only boostAuras`), built and uploaded 2026-11-06 (`assetIds.ts`), so the bundled vale pack draws them | none (original) |
| audio | silent (unchanged) | none |

**Not in the slice:** the other four classes and the paid SmallScaleInt edition, the LoP warrior, other biomes'
tiles. (`gold_drop` and the full LoP pack joined later: the boost drops above and the sniper.) Nothing needs to be
bought for this plan.

## The packs

| Pack | Folder | Contents (measured) | Licence |
|---|---|---|---|
| **HD 8-Directional Top-Down Character Pack 1**, free edition (Knight), SmallScaleInt ([itch.io](https://smallscaleint.itch.io/hd-8-directional-top-down-character-pack-1)) | `2D HD Character Knight/Spritesheets/With shadows/` | 29 sheets. Each is **1920x1024** = 15 frames x **8 facings** in **128x128** cells, one animation per sheet, baked shadow | Commercial use, no attribution, may modify; **may not redistribute the raw files**; shipping them in a compiled game is allowed (author) |
| **Lords of Pain: Old School Isometric Assets (DEMO)**, Pupkin Assets ([itch.io](https://trevor-pupkin.itch.io/lords-of-pain)) | `(DEMO) Lords Of Pain - Old School Isometric Assets/` | 539 PNGs, one **256x256** frame each, **16 facings** (E = 0 deg, counter-clockwise, 22.5 deg steps), baked shadow | Free and commercial use, may modify; **may not redistribute or resell, even if modified** |
| **2D Demons - TopDown asset pack v1.1** ("Top-down Demons"), SmallScaleInt ([itch.io](https://smallscaleint.itch.io/top-down-demons)) | `art/vendor/demons-topdown/` | 34 creatures; separated body / `Shadows/` / `Effects/` sheets, each **1920x1024** = 15 frames x **8 facings** in **128x128** cells, the knight's format (docs/DEMON_ART.md) | Standard Commercial License: commercial use, no attribution, may modify; **may not redistribute or resell the raw files** (DEMON_ART DD6, `THIRD_PARTY_NOTICES.md`) |
| **UI User Interface Pack - Horror**, ToffeeCraft ([itch.io](https://toffeecraft.itch.io/ui-user-interface-pack-horror)) | `art/vendor/toffeecraft-horror-ui/` | "32x32 pixel horror UI": panels, buttons, skulls, candles, bones, eyes, potions, icons, a pixel font. One sheet, `UiHorror.png`, **1024x607** RGBA (the paid download). Used for the boon draft cards (docs/DRAFT_REVEAL.md) and the UI skin: panels, buttons, bars, hearts, flasks, icons (docs/UI_ART.md) | Free licence: personal use only. **Paid licence** (held by the owner, 2026-10-30): commercial or personal use, may edit, no attribution; **may not redistribute or resell** |
| **16Bit Bullets, missiles, Explosions & Misc Asset Pack**, J i m ([itch.io](https://jinvorionstg.itch.io/bullet-asset-pack-top-down-or-shmup-classic-bullet-hell-style)) | `art/vendor/player-bullets/` | The free `Player Bullets.rar` (6 kB): 10 PNG strips of 6-32 px frames, fully opaque or clear, art pointing up (docs/PROJECTILE_ART.md "The pack") | No licence field; the author's comment on the page: "You can use them however you want, even for commercial use." Credited anyway (Credits screen); raw files not redistributed |

Slice frames used:

| Animation | Frames x facings | Visible box (union over all frames) |
|---|---|---|
| Knight Idle / Run / Rolling / TakeDamage / Die | 15 x 8 each | 60x79 / 88x97 / 123x94 / 80x96 / 128x103 in the 128 cell |
| Knight Melee / Melee2 / MeleeSpin (the sword's 3-hit combo) | 15 x 8 each | 125x106 / 128x128 / 115x111 |
| Skeleton `default_walk` / `special_death` | 8 x 16 each | 64x49 / 68x52 in the 256 cell |
| `ground_stone1` | 1 | 256x256, seamless, mean colour `#1a1618` |
| `highlight_yellow`, `loot_indicator_yellow`, `glint` | 1, 1, 8 | soft ring / 2x83 beam / 21x17 sparkle |

## Gaps between this art and the code

1. **The sprite contract rejects the art.** `src/shared/theme/contract.ts` fixes classes at 16x24 cells and enemies at
   16x16, 4 facings and exact frame counts (class idle 4 / run 6 / roll 4 / hit 2 / death 6). The knight is 128 px,
   8 facings, 15 frames; the skeleton 256 px, 16 facings, 8 frames. The contract has to grow (task S2), a deviation
   from the web build's contract to log in `CLAUDE.md`.
2. **No sprite renderer exists.** `ActorRenderController` only builds placeholder Parts (task S4).
3. **Roblox stores images at most 1024 px on a side**, so the 1920x1024 knight sheets must be repacked (task S3).
   Confirm on a real upload in S0.
4. **One asset ID = one sheet** in the manifest today; the knight needs several 1024 atlases.
5. **World scale.** Placeholders assume 16 px per tile; each new sheet needs its own texel density.
6. **Style mix.** The bright HD knight next to the dark low-res skeleton and stone floor, with shadows falling in
   different directions. Judged in Studio after S5 (risk R1).
7. **Licences and git.** Neither pack may be redistributed as raw files, and the repo has no commits yet (task S1).

## Status (2026-10-25)

Code-complete and verified **headlessly only** (`npm run verify`: 89 suites, 1165 of 1166 tests; the one failure is the
known x86 `forge.spec.ts` seedToState vector). Nothing has run in Studio and **nothing is uploaded**, so
`VALE_ASSET_IDS` is empty and the default `vale` pack draws exactly the placeholders it drew before. To switch the art
on: `npm run art:build`, upload `art/upload/*.png` (every PNG to upload; decor props: docs/DECOR.md R5), paste the
ids into `src/shared/theme/packs/vale/assetIds.ts`, run `npm run verify`, then do S0 and the S5 Studio checks
(`docs/CLIENT.md` "Sprites replace placeholders" lists them).

As built, differing from the text below: the new asset kind is `"sprites"` (additive; `MANIFEST_FORMAT` stays 1);
one cell size and pivot per set, so the knight keeps its full 128x128 cell (8 frames per facing, one 1024 atlas per
animation) and the skeleton is 94x70 in two 940x910 atlases; the floor mean is `#1a1619`; the knight's rows run
clockwise from screen right (`art/atlases.json` `rowOrderEvidence`); no Asphalt (ids are pasted by hand).

Sniper (docs/SNIPER_ART.md SN1-SN5, 2026-10-26): `enemy.sniper` is the Lords of Pain subservient, one 1008x744
atlas `sniper-idle.png` (16 facings x 4 worship frames, 126x93 cells) + its outline sheet, drawn at the skeleton's
exact 29.6 px/tile through the new sprite-set key `pixelsPerTileFrom`. Both sheets uploaded 2026-10-26
(`assetIds.ts`); the Studio check is open (SN7).

Enemy outlines (docs/OUTLINE.md O3, 2026-10-26): a set with `"outline": { "widthPx": n }` also gets
`<sheet>-outline.png` per sheet (same size and cells: the body mask dilated by a disc of radius n, white, alpha
`255 - spriteAlpha` inside it), listed as `outlineFile` in `layout.ts` and tinted red in the contact sheet. It needs
`pad >= widthPx + 1`, so the skeleton's pad is 3: cells 98x74, atlases 980x962, pivot +2. `swarmer-move.png`,
`swarmer-death.png` and both outline sheets were re-uploaded on 2026-10-26 (`assetIds.ts`). `npm run test:art`
covers the pipeline's pure parts.
Player outline (docs/PLAYER_OUTLINE.md P2, 2026-10-28): `class.vanguard` has `"outline": { "widthPx": 1,
"clipAtCellEdge": true }`. Its 128 px cells already fill the 1024 atlases, so the pad stays 0 and the rim is cut at the
cell edge instead (the build prints the clip: `vanguard-attack2`, 3 cells, 20 px); the body sheets stay byte-identical
and only the 8 `vanguard-*-outline.png` sheets were uploaded (2026-10-28).

Layered sources and per-sheet cells (docs/DEMON_ART.md DA2, 2026-10-26): a `grid` source may list `"layers"`
(sub-folders of `dir`, bottom to top, `""` = the dir itself; e.g. `["Shadows", ""]`), composited before the crop and
locked file by file; a set with `"cells": "perSheet"` trims each sheet to its own animations and gives it its own
`frameW` / `frameH` / `pivot` in `layout.ts` and the theme (`SpriteSheetImage`, actor slots only), the pivot being the
same point of the art in every sheet. No set uses either yet; every existing output is unchanged. (Since used by
`enemy.bruiser`, `boss.act1` and the turrets.) Per-layer noise cut (docs/DEMON_ART.md DA9 / DD7, 2026-10-30): with
`layers`, `"layerNoiseAlpha": { <layer>: n }` clears that layer's pixels with alpha <= n before compositing; the
turrets (Demon Spawn 8 / 11) use `{ "": 254 }` to drop the staff glow baked into their body sheets.

Recolour (docs/FORTUNE.md FO10 / FD14, 2026-11-04): a sprite set may carry `"recolor": { "ramp": [[luminance,
"#rrggbb"], ...] }`, a gradient map by luminance applied to every source region the set reads, before the crop box,
the pivot, the packing and the outline rim (which keep their own logic on the recoloured pixels). Each pixel's
luminance is the integer Rec. 601 one (299 / 587 / 114, rounded, the `rgb: "grey"` weights); its RGB becomes the ramp's
colour there, linear between the two stops around it (integer maths, rounded half up: `recolorLut`), alpha kept, so
every alpha cut and crop box is exactly the uncoloured set's. Stops are integer luminances strictly increasing from 0 to
255, positioned in the SOURCE's luminance. One set uses it: `enemy.golden`, the swarmer's skeleton (same files, facings,
frames, cells 98x74, pivot (42, 51), 2 px rim) on the ramp black 0 / `#080500` 6 / dark bronze `#6e4004` 20 / bronze
`#d29c00` 36 / gold `#f8c600` 52 / pale gold `#ffe050` 80 / `#fff4c0` 112 / `#fffbe6` 255. The skeleton's lit body only
spans luminance ~30-89 (mean `#3b3132`), hence the low stops; black at the bottom keeps the baked shadow black and out of
the body mask. Body mean (alpha > 64, max RGB > 8): `#eebe0e` on golden-move, 3.9 CIE76 from the `enemy.golden` role
`#f5c400` (`#e7ba13` on golden-death, 6.8). bodyTiles 0.95 (the swarmer 1.25): the same 37 px body drawn 0.95 tiles
tall, 76 % of a skeleton, near the bomber's 0.9. Every other output of the build is byte-identical; the four `golden-*`
files await upload (the vale pack draws the placeholder gold block until all its sheets have ids in `assetIds.ts`).

Gauntlet cursor (docs/CURSOR.md C1, 2026-11-11): two `images` entries, `ui.cursor` (white glow) and `ui.cursor.hover`
(yellow glow), `crop: "alpha"`, `noiseAlpha` 2, `pad` 2, both 29 x 29 from source (49, 50). An image `pivot` may now be
`{ x, y }` in SOURCE pixels (converted to the cut image and checked inside it): the fingertip (53, 54) -> (4, 4). A
variant's `sameCropAs: "<images id>"` fails the build unless it crops to the identical rect, size and pivot; images
with a pivot get a contact sheet with the red cross; `--only <images id>` (and `--lock --only`) builds one image's crop
family alone (`--only ui.cursor`). Every other output byte-identical. `ui-cursor.png` /
`ui-cursor-hover.png` uploaded 2026-11-11 (keys of the same names in `assetIds.ts`), so the bundled vale pack draws them.

## Tasks

- [ ] **S0. Spike C: sprite billboards in Studio (go/no-go).** Upload one repacked knight atlas (Run) and the skeleton
  atlas by hand. Put 1 knight and 30 animated skeletons on BillboardGuis over a WorldController floor at the real
  camera (FOV 7, yaw 45, pitch 55). Record in `docs/SPIKES.md`:
  - does `ImageRectOffset/Size` address the uploaded pixels exactly (no downscale, no neighbour bleed)?
  - `ResampleMode` Default vs Pixelated per pack (expect Default for pre-rendered art);
  - alpha fringe: both packs hold white RGB under transparent pixels, so expect a white halo until S3 bleeds alpha;
  - depth: does a camera-facing sprite's top clip into the wall behind it, and does an offset toward the camera fix
    it without drawing over walls in front? The FLOOR case is handled by construction: `spriteBillboard` shifts every
    billboard toward the camera by (cell height below the pivot) x cot(pitch) + a margin, so the feet and baked shadow
    never sink under the floor (knight ~1.7 studs, skeleton ~2.0). S0 still checks walls in front of and behind a
    sprite with that shift in place, and tunes `SPRITE_VIEW.depthBiasStuds` (added on top); also confirm that
    `BillboardGui.StudsOffset` +Z points toward the camera;
  - floor texture: no seams where merged floor slabs meet (`GAME_WORLD.floorTextureUV`: the Top-face U / V mapping
    the offsets assume; flip the wrong sign if seams show);
  - fps and texture memory (Developer Console, Memory, GraphicsTexture) on PC and the phone emulator.
  → Verify: sprites read cleanly at 1080p and on the phone emulator, and 31 sprites cost under 1 ms per frame.
  **If it fails,** try a SurfaceGui on a camera-facing Part before changing the plan.

- [x] **S1. Repo hygiene.** Move the packs to `art/vendor/smallscale-knight/` and `art/vendor/lords-of-pain-demo/`,
  gitignore `/art/vendor/` and `/art/build/`, commit `art/README.md` (download links) and `art/vendor.lock.json`
  (file list + sha256), add both packs and their terms to `THIRD_PARTY_NOTICES.md`.
  → Verify: `git status` shows no PNGs; `npm run verify` passes.

- [x] **S2. Theme contract v2 (manifest `format: 2`), only what the slice needs.** Format-1 assets keep today's
  exact checks. A format-2 spritesheet adds, all presentation-only (`GAMEPLAY_KEY_WORDS` still applies):
  - free `frameW` / `frameH` and a `pivot` per sheet;
  - `facings: { count: 4 | 8 | 16, zeroDeg, ccw }` plus the row order;
  - each required animation present with at least 1 frame (no exact count);
  - `sheet` per animation (its own `rbxassetid://`) and the frame's start cell;
  - `pixelsPerTile` (sizes the billboard in studs) and `resample` (Default / Pixelated);
  - optional `attack.1` / `attack.2` / `attack.3` for the sword combo.
  Tile images get a free size and `tilesPerImage`. UI images are already free size.
  → Verify: new `contract.spec` / `validate.spec` cases; the placeholder pack still validates with zero problems.

- [x] **S3. Atlas pipeline: `scripts/art/build-atlases.js`.** Plain Node plus `pngjs`, driven by a committed
  `art/atlases.json`. For each slice animation it:
  1. checks the sources against `art/vendor.lock.json`;
  2. crops every frame to the animation's union box, keeping the **feet pivot fixed** in cell space (measure it per
     pack: the knight's feet sit near (64, ~104), LoP figures near the cell centre);
  3. maps facings to the contract row order. LoP: E = 0, counter-clockwise. Knight: **row order undocumented** (a
     store-page comment implies row 0 = east, then towards north-east): confirm with a labelled contact sheet and
     record it in `art/atlases.json`;
  4. packs cells into <= 1024x1024 atlases, dropping every other frame when an animation would otherwise need two
     (knight Run at 88x97 fits 110 cells per atlas: 120 won't fit, 8 frames x 8 = 64 will);
  5. alpha-bleeds colour into transparent pixels;
  6. writes `art/build/*.png` and a generated layout module in `src/shared/theme/packs/vale/` (frame sizes, pivots,
     rows, `pixelsPerTile`), plus the floor texture's mean colour.
  Expected output: about 8 knight atlases (5 core + 3 sword swings) and 1 skeleton atlas (walk + death: 256 cells
  of ~68x52 fit one 1024 atlas), plus the floor, ring and beam images.
  → Verify: deterministic (same inputs, byte-identical outputs); a contact sheet per atlas looks right.

- [x] **S4. Sprite renderer.** *(code and headless specs done; the Studio half of its Verify is open)* A `SpriteView` used by `ActorRenderController` when `pack.spriteSheet(id).assetId` is
  set; the placeholder path stays per ID, so sniper / bruiser / Mother Mayhem are untouched:
  - one BillboardGui + ImageLabel per pooled actor slot, adorned to the existing anchor Part (already moved by
    BulkMoveTo); size from `frameW / pixelsPerTile * STUDS_PER_TILE`, offset so the pivot sits on the feet;
  - facing: a pure function in `src/shared/view/` projecting the sim's world facing (`faceX`, `faceZ`) through the
    camera yaw to a screen angle and one of N facings (headless spec for 8 and 16, the yaw-45 offset and boundaries);
  - animation from sim state: idle / run (fps scaled by speed: swarmer 4.2 u/s, player 6 u/s), and roll / hit / death
    stretched to the gameplay timers that drive them (timings stay in gameplay data, never in the manifest); the
    sword's swings 1 / 2 / finisher play `attack.1/2/3`; the bow has no knight animation, so it keeps idle / run;
  - juice: hit and i-frame tints through `ImageColor3`, corpse fade through `ImageTransparency`. `ImageColor3`
    multiplies, so a white hit flash is impossible: use a blink;
  - co-op: every player is the same knight, so the `highlight_yellow` ring under each player is tinted per player
    and marks the local player; it can also replace the `ui.cursor` facing pip, since the 8-way sprite shows facing.
  → Verify: headless specs for facing and animation choice; in Studio the knight runs, rolls, swings, gets hit and
  dies in all 8 facings on keyboard and gamepad; skeletons walk, lunge and die; replay hashes unchanged.

- [ ] **S5. Upload and the `vale` pack.** *(the pack, its specs and the default-pack switch are done; upload and the Studio run are open)* Add Asphalt to `rokit.toml` (its ID file goes inside `src/shared/theme/`, the
  only folder allowed to hold asset IDs), upload `art/build/*.png`, and add `packs/vale/` (registered in
  `packs/index.ts`): a copy of `placeholder` that overrides
  - `class.vanguard` -> Knight (idle, run, roll, hit, death, attack.1-3);
  - `enemy.swarmer` -> Skeleton (move = walk, death = death; idle = walk frame 0 held; attack = walk under the
    telegraph tint; hit = blink), drawn at a readable size (the hitbox does not change);
  - `tile.biome.1.floor` -> `ground_stone1` as a tiled `Texture` on WorldController's merged floor Parts
    (`tilesPerImage` tuned in Studio), with the `biome.1` floor colour set to `#1a1618` so the enemy-bullet and
    damage-number contrast checks describe what the player sees. Check which Dungeon Forge themes the endless floors
    actually use; any other biome they reach stays a placeholder for now;
  - the ring and beam images for the co-op ring and the relic pedestals.
  → Verify: `npm run verify` (validator, contrast, `check-asset-ids`); in Studio a full endless run through a Mother
  Mayhem floor, solo and in a 2-player party, on PC and the phone emulator, with fps and texture memory written down.

- [x] **S6. Docs.** `src/shared/theme/README.md` (format 2), `docs/CLIENT.md` (SpriteView), the `CLAUDE.md` decision log
  (contract v2, the `vale` pack, where the art lives), `docs/SPIKES.md` (spike C).

## Risks

- **R1. Style mix.** HD knight vs low-res LoP skeleton and floor, and baked shadows in different directions. Judge it
  in Studio after S5. Options then: the paid SmallScaleInt edition's shadowless sheets plus one shared blob shadow, or
  enemies in the knight's style.
- **Texture memory.** A 1024x1024 RGBA atlas is about 4 MB on the GPU: ~9 atlases, ~36 MB for the slice. Co-op shares
  them (every player is the same knight). Keep a half-resolution option in the pipeline in case the phone numbers in
  S0 / S5 are bad.
- **Readability.** A skeleton drawn larger than the swarmer's small hitbox can make dodges feel unfair; tune the
  drawn size with the hitbox debug view on.
- **Faked animations.** The skeleton has no idle, attack or hit frames; they are stand-ins.

## As built: molten tiles (2026-11-08)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change). The molten biome (`biome.2`)
gets a repeating floor and a repeating wall texture, ORIGINAL art in the Lords of Pain ground's style: dark basalt with
bright red lava in the cracks.

- **Art.** `scripts/art/molten/gen_molten_tiles.py` (python3 with numpy + Pillow; NOT run by `art:build` / `art:lock`,
  so the PNGs are inputs like any vendor file) writes `art/vendor/kaleb-vale/molten/molten-floor.png` (basalt
  flagstones: a domain-warped jittered hex Voronoi, grit, a top-left bevel, lava glowing in many joints) and
  `molten-wall.png` (8 staggered courses of 32 px blocks lit from above, faint embers in a few joints). Both 256 x 256,
  opaque and seamless (every layer periodic), at the stone floor's density (`tilesPerImage` 4). Means `#2d211e` (floor)
  and `#342622` (wall); the lava's hottest pixel is 30.8 CIE76 from `telegraph` `#ff8a3d` (about 0.4 % of pixels lie
  within 40).
- **Pipeline.** `art/atlases.json` images `tile.biome.2.floor` / `tile.biome.2.wall` (`crop: "none"`,
  `tilesPerImage` 4, `meanHex`) -> `art/upload/tile-biome2-floor.png` / `tile-biome2-wall.png`. `build-atlases.js`
  now takes `VALE_FLOOR_HEX` from `tile.biome.1.floor` by id (`FLOOR_IMAGE_ID`; it had taken the first `meanHex`
  image) and writes `VALE_TILE_MEAN_HEX` to `layout.ts`: asset id -> rounded mean colour for every `meanHex` image. A
  repeating tile (`tilesPerImage`) without `meanHex` fails the build.
- **Pack.** `packs/vale/manifest.ts`: a biome floor or wall whose tile is an uploaded repeating texture (an `image` with
  `tilesPerImage`) takes its `VALE_TILE_MEAN_HEX` colour as that surface's biome colour (so the contrast checks describe
  what is drawn) and keeps the biome's material (molten Basalt / Rock). Each texture switches on alone; the other biomes
  never pick up the molten means. Without the IDs `biome.2` is exactly as before (vale.spec "vale molten tiles").
- **Validator.** A textured floor or wall must name a rough material: not `SmoothPlastic` (also the default when the
  biome names none) or `Glass`. **Reversed in the Studio check (2026-11-08):** the first build drew textured surfaces in
  SmoothPlastic (so the material's own pattern would not fight the image), and every textured top face came out pale
  grey. At the game camera (7 degrees FOV, ~551 studs out, yaw 45, pitch 55) every up-facing face is seen from the same
  angle, and with the place's sun that angle catches SmoothPlastic's sun glint across the whole floor: a plain `#2d211e`
  SmoothPlastic slab turned as pale as the textured ones, the side faces and the Basalt void stayed dark, and removing
  `Atmosphere` or `EnvironmentSpecularScale` 0 did not help. The molten texture on Basalt reads as drawn (dark basalt,
  lit lava), so every textured surface now keeps its biome's rough material (biome.1's stone floor: Pavement).
- **Renderer.** `WorldController`: when the biome's wall image has `tilesPerImage`, every wall Part gets 5 Textures
  (`GAME_WORLD.wallTextureFaces`: Top and the four sides; the Bottom lies on the floor) in the biome's wall material;
  otherwise walls draw as before. shared/view `wallTexture.ts` (`wallTextureOffsets`) anchors each face's pattern to
  the world (U along the face's world axis, V down from the wall's top edge), so merged wall Parts run on without
  seams; the Top face is the floor's rule (`floorTexture.ts`, whose per-axis helper is now `textureAxisOffset`). The
  side faces' U / V conventions are assumed in `GAME_WORLD.wallTextureUV` (from a Decal's: upright and unmirrored from
  outside the face) until Studio confirms them. Faces hidden between merged wall Parts are drawn anyway (no per-face
  neighbour test).
- **Uploaded** 2026-11-08 (`tile-biome2-floor.png` / `tile-biome2-wall.png`, IDs in `packs/vale/assetIds.ts`), so the
  bundled vale pack draws them. **Pending:** the Studio checks: biome.1's stone floor on Pavement (does the slab pattern
  fight the image?); no seams where wall Parts meet; the stone upright on the side faces (flip a
  face's sign in `GAME_WORLD.wallTextureUV` if not); telegraph rings still readable on molten floors (the 30.8 CIE76
  above). Optional: `scripts/art/kenney/kenney.json` still bakes the biome.2 Kenney floor patches toward the old
  placeholder floor `#2a1a16`; rebake toward `#2d211e` once the floor is uploaded.

## As built: frost tiles (2026-11-08)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change). The frost biome (`biome.3`,
Frost Reach) gets a repeating floor and wall texture like the molten tiles above, ORIGINAL art in the Lords of Pain
ground's style: cold blue-grey slate with pale frost.

- **Art.** `scripts/art/frost/gen_frost_tiles.py` (python3 with numpy + Pillow; NOT run by `art:build` / `art:lock`;
  it imports the molten script's periodic helpers: `fbm`, `wrapped_voronoi`, `shade`, `scratches`, `blur_wrap`) writes
  `art/vendor/kaleb-vale/frost/frost-floor.png` (slate flagstones: a lightly warped jittered hex Voronoi, the pack's grit
  and scratches, a top-left bevel; snow packed into the joints where a slow "cold" field allows, a rime rim inside the
  stones' edges, hoarfrost crystal speckle in patches, a few pale ice-filled hairline cracks) and `frost-wall.png` (8
  staggered courses of 32 px blocks lit from above; snow lying along the top of about 3 blocks in 4, rime in the joints,
  short icicles hanging from the snow with a faint shadow). Both 256 x 256, opaque and seamless, `tilesPerImage` 4.
  Means `#222a32` (floor) and `#303941` (wall), near the placeholder `#1e2a33` / `#2a3842`. Measured: `enemyBullet` on
  the means 4.50:1 / 3.64:1; the brightest frost pixel is 78 CIE76 from `telegraph` and 81 from `enemyBullet` (no pixel
  within 40 of either); the shoulder `#28353f` is 5.2 CIE76 from the floor mean (>= `VOID_CONTRAST.shoulderVsFloor` 4)
  and nearer the wall (2.9). The stone stays dark on purpose: a pale ice floor could not keep 3:1 for the pink bullets.
- **Pipeline / pack / renderer.** Nothing new: `art/atlases.json` images `tile.biome.3.floor` / `.wall` (`crop: "none"`,
  `tilesPerImage` 4, `meanHex`) -> `art/upload/tile-biome3-floor.png` / `-wall.png`; `VALE_TILE_MEAN_HEX` and the
  manifest's textured-surface rule pick them up as for molten; the biome keeps `Snow` / `Glacier`
  (`VALE_BIOME_MATERIALS`). Without the IDs `biome.3` is exactly as before (vale.spec "vale frost tiles").
- **Uploaded** 2026-11-08 (`tile-biome3-floor.png` / `tile-biome3-wall.png`, IDs in `packs/vale/assetIds.ts`), so the
  bundled vale pack draws them. **Pending:** the Studio checks: **Glacier under the textured walls**
  (a glossy material: if it glints like SmoothPlastic did, move the wall to `Slate` or `Rock` in
  `VALE_BIOME_MATERIALS`), Snow's own pattern under the floor image, and the icicles on the walls' Top faces (the Top
  face shares the wall image, as on molten). Optional: rebake the biome.3 Kenney floor patches toward `#222a32`.

## As built: grim tiles (2026-11-09)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change). The grim biome (`biome.4`, the
Grim Vaults) gets a repeating floor and wall texture like the molten and frost tiles above, ORIGINAL art in the Lords
of Pain ground's style: dark violet-grey crypt slate with dim grave moss.

- **Art.** `scripts/art/grim/gen_grim_tiles.py` (python3 with numpy + Pillow; NOT run by `art:build` / `art:lock`; it
  imports the molten script's periodic helpers, as the frost script does) writes `art/vendor/kaleb-vale/grim/grim-floor.png`
  (crypt flagstones: slabs of 1 x 1 to 3 x 2 cells on a 32 px lattice, packed with wrap-around, their edges warped and
  chipped and their corners worn round; the pack's grit and scratches, a top-left bevel with a slight per-slab tilt,
  damp stains, hairline cracks in about 3 slabs in 10, one slab broken into shards, and one 2 x 3 grave slab with a
  faint engraved border and cross; grave moss in the joints where a slow field lets it grow, with lichen freckles) and
  `grim-wall.png` (crypt masonry: courses of 24 / 32 / 40 px, staggered blocks with worn corners lit from above, cracks
  in about 1 block in 5, damp streaks leaking down from some joints, moss in some joints and capping about 3 blocks in
  10 with short tendrils hanging from the caps). Both 256 x 256, opaque and seamless, `tilesPerImage` 4. The moss is the
  biome's wisp green (`decor.fx.ambient.b4` `#9fe66a`) darkened and greyed (`#3a4c2c`), far from `fx.heal`. Means
  `#212023` (floor) and `#353338` (wall), near the placeholder `#1c1a20` / `#34303a` (3.6 CIE76 for the floor).
  Measured: `enemyBullet` on the means 5.02:1 / 3.86:1; the brightest pixel (`#756f7d`, wall) is >= 73.5 CIE76 from
  `enemyBullet` and >= 74.9 from `telegraph`; the shoulder `#2e2a34` is 7.3 CIE76 from the floor mean
  (>= `VOID_CONTRAST.shoulderVsFloor` 4) and nearer the wall (5.3).
- **Pipeline / pack / renderer.** Nothing new: `art/atlases.json` images `tile.biome.4.floor` / `.wall` (`crop: "none"`,
  `tilesPerImage` 4, `meanHex`) -> `art/upload/tile-biome4-floor.png` / `-wall.png`; `VALE_TILE_MEAN_HEX` and the
  manifest's textured-surface rule pick them up as for molten; the biome keeps `Slate` / `Cobblestone`
  (`VALE_BIOME_MATERIALS`). Without the IDs `biome.4` is exactly as before (vale.spec "vale grim tiles").
- **Uploaded** 2026-11-09 (`tile-biome4-floor.png` / `tile-biome4-wall.png`, IDs in `packs/vale/assetIds.ts`), so the
  bundled vale pack draws them. **Pending:** the Studio checks: Slate's and Cobblestone's own patterns under the images (Cobblestone
  is busy: if it fights the masonry, move the wall to `Slate` or `Rock`), the moss tendrils on the walls' Top faces (the
  Top face shares the wall image), and whether the grave slab's cross, once every 4 tiles, reads as a repeat. Optional:
  rebake the biome.4 Kenney floor patches toward `#212023`.

## As built: verdant tiles (2026-11-09)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change). The verdant biome (`biome.5`, the
overgrown ruin) gets a repeating floor and wall texture like the molten, frost and grim tiles above, ORIGINAL art in the
Lords of Pain ground's style: dark weathered limestone taken over by moss, grass and ivy.

- **Art.** `scripts/art/verdant/gen_verdant_tiles.py` (python3 with numpy + Pillow; NOT run by `art:build` /
  `art:lock`; it imports the molten script's periodic helpers, as the frost script does) writes
  `art/vendor/kaleb-vale/verdant/verdant-floor.png` (limestone flagstones: the frost floor's lightly warped jittered hex
  Voronoi, the pack's grit and scratches, a top-left bevel, damp stains; a slow "damp" field decides where the growth has
  taken, about half the floor: moss filling the joints and creeping over the stones' edges with a ragged, fuzzy front and
  a dark rim, moss cushions on some stones (a bumpy surface lit top-left), 140 grass tufts of 3-6 tapered blades sprouting
  from the joints with a shadow down-right, mossy hairline cracks, lichen speckle on the dry stone and 26 small fallen
  leaves in a dry olive-brown) and `verdant-wall.png` (8 staggered courses of 32 px limestone blocks lit from above, as
  the frost wall; damp streaks, lichen, patchy moss in the joints, a moss cap with a ragged lower edge on about 7 blocks
  in 10, and 5 ivy vines trailing 3-6 courses down, wrapping, with leaves on alternating sides, a lit edge and a cast
  shadow). Both 256 x 256, opaque and seamless, `tilesPerImage` 4. Means `#1e2a1a` (floor) and `#273125` (wall), near
  the placeholder `#1d2a1d` / `#283626` (2.1 / 3.7 CIE76); the limestone is kept dark on purpose (a pale stone could not
  keep 3:1 for the pink bullets). Measured: `enemyBullet` on the means 4.64:1 / 4.19:1; every pixel (brightest `#48692e`
  floor, `#5a6c5a` wall) is >= 90 CIE76 from `enemyBullet` and >= 74 from `telegraph`; the shoulder `#263324` is 4.3
  CIE76 from the floor mean (>= `VOID_CONTRAST.shoulderVsFloor` 4, the narrowest margin: a lighter or greyer floor fails
  it) and nearer the wall (2.5); the wall is darker than the placeholder's, so `boost.aegis` keeps boosts.spec's 5.8:1.
- **Pipeline / pack / renderer.** Nothing new: `art/atlases.json` images `tile.biome.5.floor` / `.wall` (`crop: "none"`,
  `tilesPerImage` 4, `meanHex`) -> `art/upload/tile-biome5-floor.png` / `-wall.png`; `VALE_TILE_MEAN_HEX` and the
  manifest's textured-surface rule pick them up as for molten; the biome keeps `Grass` / `Limestone`
  (`VALE_BIOME_MATERIALS`). Without the IDs `biome.5` is exactly as before (vale.spec "vale verdant tiles").
- **Uploaded** 2026-11-09 (`tile-biome5-floor.png` / `tile-biome5-wall.png`, IDs in `packs/vale/assetIds.ts`), so the
  bundled vale pack draws them. **Pending:** the Studio checks: Grass's own pattern under the
  floor image (if it fights the art, move the floor to `Ground` or `Slate` in `VALE_BIOME_MATERIALS`), the ivy and moss
  caps on the walls' Top faces (the Top face shares the wall image), and the telegraph rings on the mossy floor.
  Optional: rebake the biome.5 Kenney floor patches toward `#1e2a1a`.
