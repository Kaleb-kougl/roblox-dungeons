# Demon art: the placeholder enemies as 2D Demons

The enemies that are still placeholder primitives are drawn from the **2D Demons - TopDown asset pack v1.1**
(dropped into `art/` on 2026-10-26): first `enemy.bruiser`, then the turrets `enemy.sprayer` / `enemy.caster` (Phase 2;
Mother Bramble as a Demon Elite: docs/BRAMBLE_ART.md).
The Lords of Pain art stays exactly as it is (owner, 2026-10-26): `enemy.swarmer` (skeleton), `enemy.sniper` / `turret.sniper`
(subservient, docs/SNIPER_ART.md) and `boss.demonlord` (Demonlord, docs/BOSS_DEMONLORD.md) are out of scope.

Work it task by task, like `PLAN.md` and `docs/ART.md`; each task ends with a **Verify**. It is **presentation only**:
nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, collision or a replay hash, and every fixture stays
bit-identical.

## Status (2026-10-30)

**Phase 2 (turrets) is code-complete, built and uploaded (2026-10-30); specs not yet run headlessly.** DA9-DA12 and DA15 are
done: the pipeline's `source.layerNoiseAlpha` (DD7), the `enemy.sprayer` (Demon Spawn 8) and `enemy.caster` (Demon
Spawn 11) sets (`art/atlases.json` -> `layout.ts`; 4 textures each in gitignored `art/build` / `art/upload`, contact
sheets `art/build/contact/enemy.sprayer.png` / `enemy.caster.png`), their renderer inputs (`turretSprayerSpriteInput`
/ `turretCasterSpriteInput`) and the `vale.spec` cases. Verified so far: `test:art` 62/62, two `art:build`s
byte-identical (every older output unchanged), eslint and `tsc --noEmit` on the changed files. **Not yet run:** the
Lune specs (`sprites.spec`, `vale.spec`) and the full `npm run verify`. With their 8 ids in `assetIds.ts` the bundled pack
draws both turrets (DA13 done, `vale.spec`'s bundled case rewritten). Open: DA14 (Studio).

**Phase 1 is code-complete, verified headlessly and uploaded; waiting on Studio.** DA0 and DA2-DA6 are done: the
pipeline (layered sources, per-sheet cells), the `enemy.bruiser` set (Demon Beast 3, `art/atlases.json` ->
`layout.ts`), its renderer input (`bruiserSpriteInput`, `SPRITE_ANIM_MARKS.bruiser`) and the vale pack's switch-over
(`vale.spec`). Verified: typecheck, whole-repo eslint, `check:assets`, `test:art`, build and every Lune spec, run in
chunks on the aarch64 VM. The pack is SmallScaleInt's "Top-down Demons" (licence recorded in `THIRD_PARTY_NOTICES.md`,
DD6); its 6 bruiser sheets were uploaded 2026-10-26 (`assetIds.ts`), so the bundled vale pack draws the brute.
**Nothing has run in Studio.** Open: DA1 (the owner's look at `art/build/contact/enemy.bruiser.png`), DA7, DA8
(`docs/CLIENT.md`).
Mother Bramble (docs/BRAMBLE_ART.md) is at the same point. The open decisions are under "Decisions".

The pack is in `art/vendor/demons-topdown/` (gitignored with the rest of `art/vendor/`; DA0's move is done).

## What is still a placeholder

| Slot | Drawn by | Where it is seen | This plan |
|---|---|---|---|
| `enemy.bruiser` | Demon Beast 3 (uploaded 2026-10-26) | 1 in 6 endless room picks (`ENDLESS_ROOM_KINDS` weight 1 of 6) | **Phase 1** (done but DA1 / DA7) |
| `enemy.sprayer` (`turret.sprayer`), `enemy.caster` (`turret.caster`) | Demon Spawn 8 / 11 (uploaded 2026-10-30, DA13) | M1's sandbox turrets, the tutorial's two sprayers (combat F) | **Phase 2** |
| `boss.act1` (Mother Bramble) | Demon Elite 3 (uploaded 2026-10-26) | every endless boss floor it is picked for, the tutorial boss, M1 | **docs/BRAMBLE_ART.md** (a Demon Elite) |
| `enemy.dummy` | placeholder post | the tutorial | not planned (a post, not a creature) |
| `enemy.swarmer`, `enemy.sniper`, `turret.sniper`, `boss.demonlord` | Lords of Pain | | **unchanged** |

## What the pack has (measured 2026-10-26)

| | |
|---|---|
| Creatures | 34: **Imp 1-10**, **Demon Spawn 1-13**, **Demon Beast 1-5**, **Demon Elite 1-6** |
| Two copies | `Combined/` (body + shadow + effects baked) and `Spritesheets with seperated shadows and effects/` (body sheet, plus `Shadows/` and `Effects/` sheets of the same name) |
| Sheet format | **1920x1024 = 15 frames x 8 facings in 128x128 cells**, one animation per sheet: exactly the knight's (`class.vanguard`) format, so the existing `grid` source reads it |
| Animations (20-23 per creature) | Idle, Walk, Run, Run Backwards, Strafe Left / Right, Crouch, Crouch walk, Roll, Slide, BackFlip, Block (7 frames), Attack 1-4, Run Attack, TakeDamage, Die 1 / 2, Explode, Taunt. Extras on some rigs: Attack 5 / 6 / Attack Run (Spawn 1 / 8 / 11, Imp 9), Eat (Beast 4), Jump (Beast 5, Elite 2), Point (Elite 4) |
| File names | **Not uniform**: `Idle 16.png` (Spawn 7, 10), `Idle 12.png` (Spawn 6), `Idle 1.png` (Spawn 1 / 8 / 11, Imp 9), `Idle 1 16bit.png` (Imp 7); `Strafe Left.png` vs `Strafe Left 1.png`; `Explode Copy.png`. Each animation names its `file`, as the knight's do |
| Facing order | Undocumented; **measured (DA1): the knight's**, row r faces (360 - 45 r) mod 360, clockwise from screen right, so `rowForFacing` [0, 7, 6, 5, 4, 3, 2, 1]. Evidence by eye (Spawn 10 Attack 1, Beast 3 Walk / Attack 4 / Idle, Elite 3 / Elite 1 Idle and Walk) in the sets' `rowOrderEvidence` |
| Alpha | Body sheets are alpha 0 / 255 only (not every rig: Spawn 8 / 11 bake a semi-transparent staff glow in, DD7); the `Shadows/` layer is flat alpha 191, RGB (2, 4, 5). Idle frame 14 duplicates frame 0 (loops pick from 0-13) |
| Licence | No licence file in the download; the store page is SmallScaleInt's Standard Commercial License (https://smallscaleint.itch.io/top-down-demons): commercial use, no attribution, modify freely; no resale / redistribution of the raw files (DD6) |

Rigs repeat (Beasts 4 / 5 share a winged body; Spawns 8 / 11 a robed one), so a variant can be swapped later at no
pipeline cost.

## Phase 1: `enemy.bruiser` -> Demon Beast 3

| | |
|---|---|
| Gameplay (sim, unchanged) | 10 hp, r 0.5, 2 u/s, heavy contact; plods at the player, plants, telegraphs 0.7 s (42 ticks), slams (gapped bullet ring + floor shockwave), stands still for `recoverTicks` |
| Creature (recommended) | **Demon Beast 3**: grey-and-red brute with a fanged chest. `Attack 4` is a leap and ground slam, which sells the slam and the shockwave |
| Alternatives | Beast 1 (same build, red), Elite 2 / 3 (bigger, ~97 px: would need its own `bodyTiles`) |
| Size | Body (alpha > 64, idle frame 0) **36x60 px**; at the knight's 38 px per tile that is 0.95 x 1.58 tiles, against the 1.0-tile hitbox and the knight's 1.5-tile body: a brute a head taller than the player. As built (alpha > 250, facing the camera): 59 px tall, 1.55 tiles |
| Readability | Mean body colour `#652e2e`, dark on the `#1a1619` floor: the 2 px `enemyOutline` rim carries it, as on the LoP sets |

### Animation slots

`chooseActorAnim` picks death > attack > hit > move > idle. Every slot is a real animation; frames are picked from
the 15 like the knight's.

| Slot | Source | Plays when |
|---|---|---|
| `idle` (loop) | Idle, 4 frames (0, 3, 7, 10), fps 6 | calm, standing |
| `move` (loop, scaled by speed / 2 u/s) | Walk, 8 (0, 2, 4, 5, 7, 9, 11, 12), fps 10 | plodding at the player, leashing home |
| `attack` (stretched over the sim timer) | Attack 4 (leap and ground slam), 8 (frames 0, 2, 3, 4, 5, 6, 8, 10): indices 0-5 over the 42-tick telegraph, the impact (index 6, f8) on the slam tick, the crouched follow-through (index 7, f10) held over the recover (`bruiserAttack`) | `AiState.TELEGRAPH`, `BRUISER_RECOVER` |
| `hit` (one-shot) | TakeDamage 1, 4 (1, 3, 5, 8) | the hit flash (never beats an attack) |
| `death` (held while the corpse fades) | Die 1, 6 (0, 2, 4, 6, 9, 14) | dead |

### Budget (measured, DA3)

Body + shadow union over the five animations is 93x112, so with `pad` 3 a **99x118** set cell. With one cell for the
set, 8 facings x (4 + 8 + 8 + 4 + 6) = 240 cells would be 4 atlases + 4 rims = 8 textures. With per-sheet cells (DD4)
each sheet trims to its own animations, and the set is **3 atlases + 3 rims = 6 textures** (each <= 1024, so at most
~4 MB apiece):

| Sheet | Animations | Cell | Pivot | Cells | Size |
|---|---|---|---|---|---|
| `bruiser-attack` | attack | 78x118 | (41, 89) | 64 | 624x944 |
| `bruiser-body` | idle, move, hit | 70x81 | (37, 67) | 128 | 910x810 |
| `bruiser-death` | death | 99x89 | (51, 65) | 48 | 594x712 |

Each has a `-outline` sheet of the same size. The pivot is one source point, (66, 90) in the 128 cell (the set cell's
(51, 89)), measured on idle facing the camera (output facing 6 = source row 2); 38 px per tile from `class.vanguard`.

## Decisions (recommended first)

- **DD1. Lords of Pain stays.** (Owner, 2026-10-26.) The demons fill placeholders only. The demon sheets are
  top-down 8-facing renders next to LoP's isometric 16-facing ones; DA7 checks that the mix reads, it does not change
  it.
- **DD2. Demon Beast 3 for the bruiser.** Owner picks by eye from the DA1 contact sheet; Beast 1 is a drop-in.
  Phase 2 the same way: **Demon Spawn 8 for the sprayer, Spawn 11 for the caster** (one robed rig, two colourings, so
  the M1 pair reads as kin and differs by colour), picked by eye on the DA10 contact sheets (DA14 signs it off); any
  other robed Spawn with `Idle 1` / `TakeDamage 1` / `Die 1` is a drop-in.
- **DD3. Body + shadow layers, no baked effects.** Build from the separated sheets: body over `Shadows/`, skip
  `Effects/`. Beast 3's `Attack 1` swipe is magenta-pink, close to `enemyBullet` `#ff3fa4`: baked effects would read
  as bullets the sim never fired, and they widen the cells (97x112 -> 126x124). *Alternative:* the `Combined/`
  sheets (no pipeline change, bigger cells, unvalidated colours).
- **DD4. Per-sheet cells** (the contract v2 addition already sketched as SNIPER_ART Phase 2:
  `SpriteSheetImage.frameW` / `frameH` / `pivot`), so each animation trims to its own box: about half the textures.
  It also serves Phase 2-3 and SNIPER_ART Phase 2. *Alternatives:* cut frames (death 4, attack 6: 3 atlases), or
  accept 8 textures.
- **DD5. The knight's density, 8 facings.** `pixelsPerTileFrom: "class.vanguard"` (38 px per tile): the same cell
  format as the knight and, by the look of it, the same render scale, so the brute's height against the player is
  the artist's. The pack has 8 facings (no interpolated rows). If Studio finds the brute small next to the LoP
  skeleton (drawn at 29.6), give it its own `bodyTiles`.
- **DD6. Licence: resolved (2026-10-26).** The pack is SmallScaleInt's "Top-down Demons" v1.1 (the knight's author),
  SmallScaleInt's Standard Commercial License (https://smallscaleint.itch.io/top-down-demons); recorded in `THIRD_PARTY_NOTICES.md`.
- **DD7. Cut the turrets' baked glow (`source.layerNoiseAlpha`).** Spawn 8 / 11 carry the staff orb's glow inside the
  body sheet (semi-transparent magenta / red, alpha <= 126 / 131), so DD3's "no `Effects/`" leaves it in; next to the
  enemy-bullet roles it would read as a bullet the sim never fired. An opt-in per-layer noise cut (`{ "": 254 }`:
  keep only the body layer's opaque pixels, before compositing) drops it and leaves the shadow layer whole and the
  orb's opaque core in place; it also makes the pivot / outline mask exactly the body again. *Alternatives:* accept
  the glow (no pipeline change; a fringe next to the turrets' own bullets), or pick other rigs without a baked glow
  (a robed Spawn without a staff orb; loses the caster look).

## Tasks

- [x] **DA0. Quarantine and licence.** `mv -n "art/2D Demons - TopDown assetpack v1.1" art/vendor/demons-topdown`
  (gitignored); add a "2D Demons - TopDown asset pack v1.1" section to `THIRD_PARTY_NOTICES.md` (source, author,
  licence: DD6) and the pack to `art/README.md`.
  → Verify: `git status` shows no PNGs; `git check-ignore` matches a demon sheet.

- [ ] **DA1. Confirm the assumptions.** A labelled contact sheet (mid-grey, 3x) of Beast 3 (and Beast 1) idle, walk,
  Attack 4, TakeDamage 1 and Die 1 in all 8 rows: (a) the row order (evidence by eye in `rowOrderEvidence`, as the
  knight's); (b) the shadow layer's alpha and colour, for the body cut (`bodyAlpha`, `bodyMinRgb`); (c) the Attack 4
  frame picks, with the impact frame pinned to the slam tick; (d) the real cell size and atlas count.
  → Verify: the sheet is in `art/build/contact/`; this doc's budget is updated with the measured numbers.

- [x] **DA2. Pipeline (`scripts/art/build-atlases.js`).** (1) `grid` source `layers`: composite the named sub-folder
  sheets with the body sheet, per pixel, before trimming (DD3); absent = today's single sheet. (2) `npm run art:lock`
  with only the files the set reads. (3) With DD4, per-sheet `frameW` / `frameH` / `pivot` in contract v2
  (`theme/contract.ts`, `validate.ts`, `layout.ts`, `SpriteView` billboard size and offset per sheet).
  → Verify: `test:art` specs for layers (and per-sheet cells); the knight's, skeleton's and subservient's outputs are
  byte-identical.
  *As built (2026-10-26):* `source.layers` lists sub-folders of `source.dir` **bottom to top**, `""` = the dir itself:
  `"layers": ["Shadows", ""]` is the body over its shadow (premultiplied integer "over", `compositeOver`); every layer
  file is in `sourceFiles`, so `art:lock` and the lock check cover it; a missing or mis-sized layer fails. Set-level
  `"cells": "perSheet"` trims each sheet to its own animations (+ `pad`, always covering the pivot) and writes the
  sheet's `frameW` / `frameH` / `pivot` (the set's pivot point in the sheet's crop) into `layout.ts`; the set-level
  cell, pivot and `pixelsPerTile` stay as without it. Theme: `SpriteSheetImage.frameW` / `frameH` / `pivot`
  (optional, defaulting to the set's), accepted in the class / enemy / boss slots only (`SlotContract.perSheetCells`);
  `SpriteSetLayout.cell(sheet)`, `SpriteFrame.pivot`; `SpriteView` re-places the billboard when the drawn cell changes
  (`shared/view` `sheetSpriteLayout`). Trial on Beast 3 (idle 4 / walk 8 / Attack 4 8 / TakeDamage 1 4 / Die 1 6, body
  over Shadows, pad 3): one 99x113 cell for the set; per sheet idle 44x78, walk 70x82, attack 78x112, hit 70x77, death
  99x89 (still one atlas per animation at these frame counts). Every existing output byte-identical.

- [x] **DA3. The `enemy.bruiser` set in `art/atlases.json`.** Source `{ "type": "grid", "dir": "demons-topdown/
  Spritesheets with seperated shadows and effects/Demon Beast 3", "frameW": 128, "frameH": 128, "layers":
  ["Shadows", ""] }` (bottom to top), the knight's `rowForFacing` (or DA1's), `noiseAlpha` 2, `pad` 3, `outline: { "widthPx": 2 }`, pivot
  measured on idle facing-down frame 0, `pixelsPerTileFrom: "class.vanguard"`, the slot table's animations.
  → Verify: two builds byte-identical; `layout.ts` gains `enemy.bruiser` with 8 facings and an `outlineFile` per
  sheet; the contact sheet shows the feet on the pivot in every facing.
  *As built (2026-10-26):* as specified, with `"cells": "perSheet"`, `pivot` `{ measure: idle facing 6 frame 0,
  bodyAlpha 250, bodyMinRgb 0, footBand 6 }` (facing 6 is the output facing; `rowForFacing[6]` = source row 2, towards
  the camera, as the knight's), `resample` Default, the frames in the slot table and three sheets (`bruiser-attack`,
  `bruiser-body` = idle + move + hit, `bruiser-death`; numbers in the budget). `art:lock` added exactly the ten files
  the set reads (five body sheets + their `Shadows/` layers). Two builds byte-identical; every older output
  (`art/build`, `art/upload`, `layout.ts`, `fxLayout.ts`) unchanged. Checked numerically: every frame inside its
  atlas, a rim on every cell, no body pixel in the 3 px pad, no frame touching the 128 source edge. **Not yet looked
  at by eye:** `art/build/contact/enemy.bruiser.png` (feet on the pivot per facing; the per-facing feet measure of idle
  frame 0 spreads up to ~10 px from it, as the knight's does).

- [x] **DA4. Renderer inputs (`shared/view/sprites.ts`).** `bruiserAttack(aiState, aiTicks, alpha)`: during
  `AiState.TELEGRAPH`, elapsed of `telegraphTicks`; during `BRUISER_RECOVER`, the held impact phase; undefined
  otherwise. `bruiserSpriteInput` with `SPRITE_VIEW.bruiserMoveRefSpeed = BRUISER.data.speed`; add `BRUISER.id` to
  `ACTOR_SPRITE_INPUTS`. `ActorRenderController` needs no change.
  → Verify: `sprites.spec` cases: the timeline at telegraph start, the slam tick (impact frame) and the last recover
  tick; undefined while walking and when dead; the choice is `attack` while telegraphing / recovering, `move` while
  walking, `idle` calm, `death` dead, and `hit` never beats an attack.
  *As built:* the attack plays as segments (BRAMBLE_ART BR4's `AnimSegment`): the leap `[0, impact)` over the
  telegraph, the impact `[impact, followThrough)` over the first `impactTicks` of the recover from the slam tick
  (RECOVER's first, aiTicks = `recoverTicks`), then the follow-through `[followThrough, end)` held for the rest.
  Measured marks (`SPRITE_ANIM_MARKS.bruiser`, `shared/view/config.ts`): `impact` 6/8 (f8), `followThrough` 7/8 (f10),
  `impactTicks` 10 of the 36-tick recover. (The first cut split the recover in half between frames 6 and 7; the
  integration added `followThrough` / `impactTicks` so 7 holds.) A `sprites.spec` case checks the marks on the built set.

- [x] **DA5. The vale pack.** Nothing hand-written (`VALE_SPRITE_LAYOUTS` drives `manifest.ts`). `vale.spec`: with no
  ids `enemy.bruiser` is the placeholder; with every required sheet it switches to `sprites`; the rim joins and never
  holds the set back; the LoP sets' specs are untouched.
  → Verify: `npm run verify` (validator, contrast, `check-asset-ids`, Lune suite); every fixture hash unchanged.
  *As built:* `vale.spec` "vale enemy.bruiser and boss.act1": as bundled (no ids in `assetIds.ts`, DD6) the
  placeholder; with all three sheets `sprites`, any one missing keeps the placeholder, outlines alone never switch it;
  rims join per sheet and never hold it back; every sheet's own cell is copied and drawn (hand-computed rects).
  `assetIds.ts` is unchanged: a file without an upload is simply absent there. The verify steps were run one by one
  (not `npm run verify` itself); every fixture hash unchanged (nothing under sim / dungeon / fixtures changed).

- [x] **DA6. Upload** (after DA0's licence entry): the bruiser sheets and their outline sheets from `art/upload`;
  paste ids into `assetIds.ts` with the upload note. → Verify: `npm run verify`.
  *Done 2026-10-26 3:48 PM (k9kbdev):* 3 sheets + 3 outlines; ids transcribed from Asset Manager screenshots;
  `vale.spec` now checks the bundled pack draws both demon sets with every rim. Verified: tsc, build, eslint,
  `check:assets`, every Lune spec (chunked).

- [ ] **DA7. Studio check.** Endless floors with bruiser rooms and mixed rooms (bruiser beside skeletons and
  subservients), solo and a 2-player party, PC and the phone emulator:
  - the style mix: top-down brute next to the isometric LoP enemies (DD1, DD5);
  - readability on the darkest floor and decor band, rim on and off (`KV_EnemyOutline`), against the magenta bullets
    and the telegraph tint;
  - drawn size against the hitbox (hitbox debug view); feet planted, occluded by walls;
  - the smash lands on the ring and the shockwave hint;
  - fps and texture memory against the S5 numbers.
  Record in `docs/SPIKES.md`. → Verify: the owner signs off DD2, DD4, DD5.

- [ ] **DA8. Docs.** `docs/ART.md` (slice table: `enemy.bruiser` -> Demon Beast 3; packs table; status),
  `docs/CLIENT.md` (sprite smoke steps), `THIRD_PARTY_NOTICES.md` (DA0), `CLAUDE.md` (decision log: the demon
  bruiser and layered sources).
  *Partly done (2026-10-26):* `docs/ART.md` slice and packs tables, `THIRD_PARTY_NOTICES.md` (source, author and
  licence), `art/README.md` packs table, `CLAUDE.md` decision log. Open: `docs/CLIENT.md`.

## Phase 2: turrets

`enemy.sprayer` (`turret.sprayer`) and `enemy.caster` (`turret.caster`): the robed casters **Demon Spawn 8** (dark
robe, red face marking, glowing staff) and its rig-mate **Demon Spawn 11** (a recolour: pale body, red cloth, striped
face mask; identical boxes). Where they are seen: M1's sandbox (one turret in each of the three rooms nearest the
entrance, `TEST_TURRET_KINDS`) and the tutorial's combat F (two sprayers); endless rooms never pick turrets (`ENDLESS_ROOM_KINDS`).

| | |
|---|---|
| Gameplay (sim, unchanged) | 12 hp, r 0.45, never moves; wakes within 9 u, a burst every period (the sprayer a 16-bullet ring every 1.2 s, the caster a 3-arm spiral); dead for 6 s (`TURRET_RESPAWN_TICKS` 360), then back at full hp |
| Renderer | `turretSpriteInputOf` (the builder `turret.sniper` already uses): idle loop, the hit flash, the death corpse, hidden until it respawns; never `move` or `attack`. An optional fire flash would need a turret attack timer in `turretShared.ts`'s view data (not planned) |
| Creatures (DD2) | Spawn 8 = sprayer, Spawn 11 = caster (the owner's pick by eye on the contact sheets; any robed Spawn is a drop-in) |
| Size | Idle body (alpha > 250, facing the camera) **35x43 px** = 0.92 x 1.13 tiles at the knight's 38 px per tile, against the 0.9-tile hitbox: a squat caster a little shorter than the knight |
| The glow | Unlike Beast 3's, the body sheets are not alpha 0 / 255 only: the staff orb's glow is baked in as ~6,000-7,000 semi-transparent pixels per sheet, magenta (255, 0, 255) on Spawn 8 (alpha <= 126), red (255, 0, 0) on Spawn 11 (alpha <= 131), all within 3 px of the opaque body. DD3 drops effects; this one is in the body layer, so DD7 cuts it |

### Animation slots

| Slot | Source | Plays when |
|---|---|---|
| `idle` (loop) | Idle 1, 4 frames (0, 3, 7, 10), fps 6 | alive (always: a turret never moves or attacks) |
| `move`, `attack` | idle's cells (`cellsOf`, no textures): the validator needs every base animation | never on a turret |
| `hit` (one-shot) | TakeDamage 1, 4 (1, 3, 11, 13): the recoil, then back towards the idle pose, never ending on the staff-swung frames 4-9; fps 12 over the 6-tick flash | the hit flash |
| `death` (held while the corpse fades) | Die 1, 6 (0, 2, 4, 6, 9, 14), the bruiser's picks | dead, until the corpse time; then hidden until the respawn |

### Budget (measured, DA10)

Set cell (the union) **116x99**, pivot (60, 60) = source (66, 83) in the 128 cell, measured on idle facing 6 frame 0;
38 px per tile from `class.vanguard`. Per-sheet cells (DD4), per set **2 atlases + 2 rims = 4 textures**, 8 for both:

| Sheet | Animations | Cell | Pivot | Cells | Size |
|---|---|---|---|---|---|
| `sprayer-body` / `caster-body` | idle, hit | 78x85 | (41, 60) | 64 | 624x680 |
| `sprayer-death` / `caster-death` | death | 116x97 | (60, 58) | 48 | 696x776 |

Each has a `-outline` sheet of the same size (the 2 px enemy rim, `pad` 3).

### Tasks

- [x] **DA9. Measure, and the pipeline's `layerNoiseAlpha` (DD7).** Spawn 8 / 11: same 128 grid format and file
  names (`Idle 1.png`, `TakeDamage 1.png`, `Die 1.png`), the `Shadows/` layer flat alpha 191 as Beast 3's, but the orb
  glow baked semi-transparent into the body sheet. `scripts/art/build-atlases.js`: an opt-in grid source option
  `source.layerNoiseAlpha: { <layer>: n }` (an integer 0-254 per listed layer) clears that layer's pixels with alpha
  <= n before it is composited (noiseAlpha's rule, per layer; the cached source is never touched).
  → Verify: `test:art` specs for the cut (the glow goes, the shadow under it stays whole, a cut of 0 is the plain
  composite) and its errors; every older output byte-identical.
  *As built (2026-10-30):* `gridLayerNoise` (bottom-first cuts, `MAX_LAYER_NOISE_ALPHA` 254), checked before any file
  is read; errors for a key not in `source.layers`, a value outside 0-254, a non-object, or no `layers`. The composite
  cache keys on the cuts too. Two new specs; `test:art` 62/62; the header comment in `art/atlases.json` documents it.

- [x] **DA10. The two sets in `art/atlases.json`.** `enemy.sprayer` (Demon Spawn 8) and `enemy.caster` (Demon
  Spawn 11): grid 128, `layers` `["Shadows", ""]`, `layerNoiseAlpha` `{ "": 254 }`, the knight's `rowForFacing`,
  `noiseAlpha` 2, `pad` 3, `outline` 2 px, `pixelsPerTileFrom: "class.vanguard"`, `cells: "perSheet"`, the slot table's
  frames, sheets `<x>-body` (idle + hit) and `<x>-death`.
  → Verify: two builds byte-identical; `layout.ts` gains both with 8 facings and an `outlineFile` per sheet; the
  contact sheets show the feet on the pivot in every facing.
  *As built (2026-10-30):* numbers in the budget; `art:lock` added exactly the 12 files the sets read (3 sheets + their
  `Shadows/` layers, per creature). The cut leaves the body alpha 0 / 255 again, so the pivot's `bodyAlpha` 250 /
  `bodyMinRgb` 0 is exactly the body; the per-facing feet measure sits up to 8 px lower in the other facings (the
  staff's foot), on the contact sheet the pivot is on the feet in all 8. No frame touches the 128 source edge. Row
  order checked by eye on `art/build/contact/enemy.sprayer.png` / `enemy.caster.png` (`rowOrderEvidence`): Spawn 11's
  face mask on facing 6 is clear; Spawn 8's front / back read less clearly (its red face marking; the staff hand).
  Byte-identical across rebuilds; every older output unchanged.

- [x] **DA11. Renderer inputs (`shared/view/sprites.ts`).** `turretSprayerSpriteInput` / `turretCasterSpriteInput`
  (`turretSpriteInputOf`) in `ACTOR_SPRITE_INPUTS`; nothing else on the view or client side special-cases turrets
  (`ActorRenderController`: doc comment only).
  → Verify: `sprites.spec` per turret: its own sprite id; idle alive (never attack or move, even mid-burst or
  displaced); a multi-frame hit over the flash (a 1-frame stand-in leaves it to the tint); death for the corpse time,
  then hidden until `TURRET_RESPAWN_TICKS`; an idle body again once revived. `ACTOR_SPRITE_INPUTS` has 8 builders; the
  bundled packs still draw both turrets as placeholders.
  *As built (2026-10-30):* as specified. **Not yet run headlessly.**

- [x] **DA12. The vale pack.** Nothing hand-written (`VALE_SPRITE_LAYOUTS` drives `manifest.ts`).
  → Verify: `vale.spec` "vale enemy.sprayer and enemy.caster": the layouts (cells, pivots, density, animations; the
  caster's equals the sprayer's but for file names); as bundled (no ids) both are the placeholder; with both sheets
  `sprites`, either sheet missing keeps the placeholder (the other turret unaffected), outlines alone never switch
  it; rims join per sheet and never hold a set back; each sheet's own cell is copied and drawn (hand-computed rects:
  idle, the body sheet's last hit cell, death, `move` / `attack` equal to idle in every facing); with ids, all 4
  content ids per set (sheets and rims) land in the preload core tier (`PRELOAD.core` `enemy.`, nothing hard-codes a
  set), none in later. The per-sheet list in "vale per-sheet cells" gained both sets.
  *As built (2026-10-30):* as specified; eslint and `tsc --noEmit` clean. **Not yet run headlessly** (Lune).

- [x] **DA13. Upload** (owner): the 4 sheets and 4 rims from `art/upload` (`sprayer-body`, `sprayer-body-outline`,
  `sprayer-death`, `sprayer-death-outline`, the same for `caster`); paste the ids into `assetIds.ts` with the upload
  note. Then the bundled vale pack draws both, and `vale.spec`'s "as bundled (nothing uploaded yet)" turret case fails
  by design: rewrite it as the bruiser's (every sheet has an id, both are sets with every rim; a fresh pack is still
  the placeholder). → Verify: `npm run verify`.
  *Done 2026-10-30 2:55 PM (k9kbdev):* 4 sheets + 4 outlines; ids transcribed from Asset Manager screenshots; the
  bundled turret case now checks both sets draw with every rim. `npm run verify` (Lune) still to run.

- [ ] **DA14. Studio check.** M1's sandbox turrets (sprayer, caster) and the tutorial's two sprayers (combat F),
  solo, PC and the phone emulator:
  - readability against their own bullets (magenta ring, spiral) and the telegraph tint, rim on and off
    (`KV_EnemyOutline`): the cut glow must not come back as a fringe;
  - drawn size against the hitbox (hitbox debug view); feet planted on the pivot in all 8 facings;
  - Spawn 8's row order (front / back, by eye);
  - the hit flinch on a hit, the death corpse, then the respawn as an idle body after 6 s.
  Record in `docs/SPIKES.md`. → Verify: the owner signs off DD2 (Spawn 8 / 11) and DD7.

- [x] **DA15. Docs.** This section (status, the placeholder table, DD2 / DD7), `CLAUDE.md` (the Demon art bullet
  and the docs table), `docs/ART.md` (slice table row for the turrets; the bruiser / Mother Bramble rows and the packs
  row brought up to date with the 2026-10-26 upload and licence; the per-layer cut in the status notes),
  `THIRD_PARTY_NOTICES.md` ("Used for" names the creatures, so it gained Spawn 8 / 11). `art/README.md` lists the
  pack, not its sets: unchanged. After DA13 / DA14: the upload note here and in `docs/ART.md`, the Studio results in
  `docs/SPIKES.md`.

## Phase 3: Mother Bramble

`boss.act1` as a **Demon Elite** (owner, 2026-10-26) has its own plan: **docs/BRAMBLE_ART.md** (tasks BR0-BR7,
decisions BD1-BD7). It depends on DA0 and DA2 here.

## Risks

- **Texture memory.** 8 textures for one enemy without DD4.
- **Style mix** (DD1). Two render styles on one floor; DA7 judges it, the LoP art does not change.
- **Baked lighting.** Shadows fall to the lower left on every demon sheet (and the knight's); LoP's shadows are its
  own.
- **Row order** was measured by eye (DA1, the knight's); a wrong reading would mirror the brute, so DA7 checks it.
  Spawn 8's front and back read less clearly than Spawn 11's (DA10), so DA14 checks it.
