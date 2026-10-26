# Art assets: vertical-slice plan

Scope: **only what the vertical slice draws** (PLAN.md "Vertical slice": the endless solo and co-op run, M1 sim,
swarmer / sniper / bruiser rooms, Mother Bramble, relic pedestals and the curse shrine). Work it task by task, like
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
| co-op player marker / under-player ring | **`highlight_yellow`**, tinted per player | Lords of Pain demo |
| relic pedestal marker (`RunMarkerController`) | **`loot_indicator_yellow`** beam (+ `glint`, stretch) | Lords of Pain demo |
| `enemy.sniper` (+ the tutorial's `turret.sniper`) | **Subservient** (worship; every other animation a stand-in, docs/SNIPER_ART.md) | Lords of Pain (full pack) |
| `enemy.bruiser`, `boss.act1`, walls, the shrine | placeholder primitives (unchanged) | none |
| every `bullet.*` | neon placeholders (unchanged: they keep the GDD bullet-readability rule) | none |
| audio | silent (unchanged) | none |

**Not in the slice:** the other four classes and the paid SmallScaleInt edition, the LoP warrior, `gold_drop` (the
slice has no gold), other biomes' tiles, the full LoP pack. Nothing needs to be bought for this plan.

## The packs

| Pack | Folder | Contents (measured) | Licence |
|---|---|---|---|
| **HD 8-Directional Top-Down Character Pack 1**, free edition (Knight), SmallScaleInt ([itch.io](https://smallscaleint.itch.io/hd-8-directional-top-down-character-pack-1)) | `2D HD Character Knight/Spritesheets/With shadows/` | 29 sheets. Each is **1920x1024** = 15 frames x **8 facings** in **128x128** cells, one animation per sheet, baked shadow | Commercial use, no attribution, may modify; **may not redistribute the raw files**; shipping them in a compiled game is allowed (author) |
| **Lords of Pain: Old School Isometric Assets (DEMO)**, Pupkin Assets ([itch.io](https://trevor-pupkin.itch.io/lords-of-pain)) | `(DEMO) Lords Of Pain - Old School Isometric Assets/` | 539 PNGs, one **256x256** frame each, **16 facings** (E = 0 deg, counter-clockwise, 22.5 deg steps), baked shadow | Free and commercial use, may modify; **may not redistribute or resell, even if modified** |

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
  set; the placeholder path stays per ID, so sniper / bruiser / Mother Bramble are untouched:
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
  Bramble floor, solo and in a 2-player party, on PC and the phone emulator, with fps and texture memory written down.

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
