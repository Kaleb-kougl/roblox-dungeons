# Demon art: the placeholder enemies as 2D Demons

The enemies that are still placeholder primitives are drawn from the **2D Demons - TopDown asset pack v1.1**
(dropped into `art/` on 2026-10-26): first `enemy.bruiser`, then the turrets (Mother Bramble as a Demon Elite: docs/BRAMBLE_ART.md).
The Lords of Pain art stays exactly as it is (owner, 2026-10-26): `enemy.swarmer` (skeleton), `enemy.sniper` / `turret.sniper`
(subservient, docs/SNIPER_ART.md) and `boss.demonlord` (Demonlord, docs/BOSS_DEMONLORD.md) are out of scope.

Work it task by task, like `PLAN.md` and `docs/ART.md`; each task ends with a **Verify**. It is **presentation only**:
nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, collision or a replay hash, and every fixture stays
bit-identical.

## Status (2026-10-26)

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
| `enemy.bruiser` | placeholder primitive | 1 in 6 endless room picks (`ENDLESS_ROOM_KINDS` weight 1 of 6) | **Phase 1** |
| `enemy.sprayer` (`turret.sprayer`), `enemy.caster` (`turret.caster`) | placeholder primitives | M1's turrets | Phase 2 |
| `boss.act1` (Mother Bramble) | placeholder primitive | every endless boss floor, the tutorial boss, M1 | **docs/BRAMBLE_ART.md** (a Demon Elite) |
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
| Alpha | Body sheets are alpha 0 / 255 only; the `Shadows/` layer is flat alpha 191, RGB (2, 4, 5). Idle frame 14 duplicates frame 0 (loops pick from 0-13) |
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

`enemy.sprayer` (`turret.sprayer`) and `enemy.caster` (`turret.caster`), M1's turrets: the robed casters **Demon
Spawn 8** (dark robe, glowing staff) and its rig-mate **Spawn 11** (pale). Idle loop only, with the turret builder
`turret.sniper` already uses (turrets never attack or move in the renderer); an optional fire flash would need a
turret attack timer in `turretShared.ts`'s view data. Their baked orbs are effects: DD3 drops them. With DD4 each is
~1 atlas + rim.

## Phase 3: Mother Bramble

`boss.act1` as a **Demon Elite** (owner, 2026-10-26) has its own plan: **docs/BRAMBLE_ART.md** (tasks BR0-BR7,
decisions BD1-BD7). It depends on DA0 and DA2 here.

## Risks

- **Texture memory.** 8 textures for one enemy without DD4.
- **Style mix** (DD1). Two render styles on one floor; DA7 judges it, the LoP art does not change.
- **Baked lighting.** Shadows fall to the lower left on every demon sheet (and the knight's); LoP's shadows are its
  own.
- **Row order** was measured by eye (DA1, the knight's); a wrong reading would mirror the brute, so DA7 checks it.
