# Sniper art: the Lords of Pain subservient

`enemy.sniper` is still a placeholder wedge. This plan draws it as the **subservient** from the full Lords of Pain pack
(`art/vendor/lords-of-pain/none-playable character/subservient/`): a chained thrall, standing bowed with its hands
pressed to its head. Work it task by task, like `PLAN.md` and `docs/ART.md`; each task ends with a **Verify**. It is
**presentation only**: nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, collision or a replay hash.

Owner choice (2026-10-26): of the variants, the sniper wears it (over the sprayer turret and the bruiser).

## Status (2026-10-26, `main`, uncommitted)

SN1-SN5 and the SN8 docs are **code-complete and verified headlessly only**: typecheck, build, `check:assets`,
`test:art` (30 specs) and every Lune suite (130 of 130, run in filtered chunks on the aarch64 VM), eslint on the changed
files (the whole-repo lint was not run to completion). Nothing under `sim/**` or `dungeon/**` changed. SN6: both sheets were uploaded
2026-10-26 13:16 PT (ids in `assetIds.ts`; the uploaded PNGs are the current `art:build` output), so the bundled vale
pack now draws the sniper and `turret.sniper` as the subservient, rimmed. **Nothing has run in Studio.** Open: SN7.

As built, differing from the text below:

- **SN1.** A sprite set's optional `lockAlso: { name: { folder, frames } }` adds files to the lock that no sheet reads
  (the 128 `working` frames, for Phase 2). The lock went 371 -> 627 entries.
- **SN2.** A set gives exactly one of `bodyTiles` / `pixelsPerTileFrom`; sets build in dependency order
  (`spriteSetOrder`; a missing, cyclic or self reference fails). Every older output is byte-identical.
- **SN3.** Cells 126x93, pivot (56, 57), pixelsPerTile 29.6; `art/build/contact/enemy.sniper.png` checked by eye in
  all 16 facings. The per-facing feet measure spreads (y 57-70) because the lit ankle chain counts as body in facings
  3-7; the pivot is measured facing the camera, where it is right (`pivotNote`).
- **SN4.** `sniperAttack`, `sniperSpriteInput`, `turretSpriteInputOf(data)` / `turretSniperSpriteInput`,
  `SPRITE_VIEW.sniperMoveRefSpeed`; `ACTOR_SPRITE_INPUTS` holds the swarmer, the sniper and `turret.sniper` (D3).

## Why the sniper

- **It is seen.** `ENDLESS_ROOM_KINDS` weights swarmer 3 / sniper 2 / bruiser 1, so about a third of endless combat
  rooms are sniper rooms. The tutorial's `turret.sniper` shares the ID (decision D3).
- **The body fits.** Sniper radius 0.35, 4 hp, no contact damage: a slim figure that fights at range. The subservient
  stands upright where the skeleton hunches, so the two LoP enemies read apart by silhouette.
- **The pose fits.** `worship` (hands to the head, a slow sway) reads as channelling the aimed line. The sniper stands
  still while it telegraphs (`telegraphing()` never moves it) and faces its aim (`aimAtPlayer` -> `faceToward`), so the
  16 facings show where the line will go, the job the placeholder wedge did.

## What the art has (measured 2026-10-26)

| | `subservient_special_worship` | `subservient_special_working` |
|---|---|---|
| What it shows | standing, bowed, hands clasped to the head, chain at the ankle; slow sway, almost static | on hands and knees, scrubbing / hauling, a long chain trailing behind |
| Frames x facings | 8 x 16 (same file layout and angles as the skeleton) | 8 x 16 |
| Union box (alpha > 2, pad 3) | 120x87 -> **126x93 cells, 88 per 1024 atlas** | 153x119 -> 159x125 cells, 48 per atlas |

- **No walk, attack, hit or death.** Those are the only two animations (`Animation Index.txt`; `+ Update.txt` lists
  no more). Every slot animation except one is a stand-in.
- **Scale.** The worship body (lit, alpha > 64) is 43 px tall facing the camera; the skeleton's walk is 37 px. At
  the skeleton's 29.6 px per tile (same pack, same render scale) the thrall stands **1.45 tiles** and its body is ~22 px
  (~0.74 tiles) wide: about the sniper's 0.7-tile hitbox.
- **It is very dark.** Opaque body pixels average `#201a1f`; the biome 1 floor is `#1a1619`: a **1.05:1** contrast.
  Without the enemy rim (`docs/OUTLINE.md`, `enemyOutline` >= 3:1 on every floor) it is invisible.
- **Shadow.** Pure black baked shadow (194 opaque pixels at max RGB <= 4 in the S frame), same as the skeleton, so
  the skeleton's body cut (alpha > 64, max RGB > 8) should hold. Confirm with the build's per-facing measure.
- **Not in `art/vendor.lock.json` yet**; the licence (`THIRD_PARTY_NOTICES.md`, full pack) already covers it.

## The mapping

One real animation, everything else reuses its cells (the skeleton's `cellsOf` pattern):

| Slot animation | Source | Plays when (`chooseActorAnim`) |
|---|---|---|
| `idle` (real) | worship frames 0, 2, 4, 6, ~6 fps, loop | calm (before aggro) and standing |
| `move` | `cellsOf: idle`, frame 0 held (D2) | strafing / backing off / closing in, 2.6 u/s |
| `attack` | `cellsOf: idle`, stretched over the 36-tick telegraph | `AiState.TELEGRAPH` (tint pulse + aim line on top) |
| `hit` | `cellsOf: idle`, 1 frame | 1-frame stand-in: the tint shows the hit, idle / move keep playing |
| `death` | `cellsOf: idle`, 1 frame | held while the corpse fades; `fx.death.puff` already plays on every kill |

Budget: 16 facings x 4 frames = 64 cells of 126x93, **one 1008x744 atlas** (`sniper-idle.png`) + its outline sheet.
That is the swarmer's cost (2 textures, ~3 MB each on the GPU).

## Decisions (recommended first)

- **D1. `working` waits.** Its chain makes the set's one cell 159x125 (48 per atlas): adding it as the calm idle
  needs 4 textures and only 3 worship frames, or per-sheet cell sizes in contract v2. Phase 2 below, if Studio shows
  the thrall needs a calm pose.
- **D2. Moving = worship frame 0 held (a glide).** The sniper strafes slowly while facing the player, so a held
  stance reads as a sidestep. Alternatives, judged in SN7: the 4-frame sway while moving, or a small view-side bob
  (`SPRITE_VIEW`, off by default).
- **D3. `turret.sniper` wears it too** (the tutorial's line turret), with a builder that never attacks and never moves
  (worship loop only). Otherwise it stays the drum and the tutorial teaches a look the endless floors don't use.
- **D4. Rim only, no brightening.** Keep the pack's colours and let the 2 px `enemyOutline` rim carry it. If SN7 finds
  it unreadable, a pipeline levels lift on this set is the next step.
- **D5. 16 facings x 4 frames** over 8 x 8: the sniper turns constantly to face the player, and the worship sway
  barely needs 8 frames.
- **D6. Size from the pack scale.** Draw it at the skeleton's exact 29.6 px/tile (`pixelsPerTileFrom`, SN2), not a
  separately rounded `bodyTiles`, so the two LoP enemies keep their relative heights.

## Tasks

- [x] **SN1. Lock the files.** `npm run art:lock` with the subservient's 128 worship PNGs (and the 128 working ones,
  for Phase 2); add `enemy.sniper` (subservient) to the Lords of Pain "Used for" line in `THIRD_PARTY_NOTICES.md`.
  → Verify: `art:build` checks them against the lock; `git status` shows no PNGs.

- [x] **SN2. `pixelsPerTileFrom` for sprite sets.** `scripts/art/build-atlases.js`: a sprite set may name another set
  for its texel density (as `worldArt.pixelsPerTileFrom` does) instead of `bodyTiles`; the pivot is still measured on
  its own frame. Sets build in dependency order; a missing or cyclic reference fails the build.
  → Verify: a `test:art` spec; the knight's and the skeleton's outputs are byte-identical.

- [x] **SN3. The `enemy.sniper` set in `art/atlases.json`.** Source `{ "type": "frames", "dir": "lords-of-pain/none-
  playable character/subservient", "frameW": 256, "frameH": 256 }`, the skeleton's 16 `facingDirs`, `noiseAlpha` 2,
  `pad` 3, `outline: { "widthPx": 2 }`, pivot measured on `idle` facing 12 frame 0 (`bodyAlpha` 64, `bodyMinRgb` 8,
  `footBand` 3), `pixelsPerTileFrom: "enemy.swarmer"`, `resample` Default, the animations in the mapping table, one
  sheet `sniper-idle`. Record the facing evidence by eye in `$comment` (N shows the back, S the bowed front, E / W the
  profile), like the skeleton's.
  → Verify: two builds are byte-identical; `layout.ts` gains `enemy.sniper` (126x93 cells, 64 cells, pixelsPerTile
  29.6) with an `outlineFile`; the contact sheet shows the figure upright, rimmed and the pivot on the feet in all 16
  facings.

- [x] **SN4. Renderer inputs (`shared/view/sprites.ts`).** `sniperAttack(aiState, aiTicks, alpha)`: during
  `AiState.TELEGRAPH`, elapsed of `SNIPER.data.telegraphTicks` (no lunge phase; undefined otherwise).
  `sniperSpriteInput` like the swarmer's, with `SPRITE_VIEW.sniperMoveRefSpeed = SNIPER.data.speed`. Add `SNIPER.id`
  to `ACTOR_SPRITE_INPUTS`; with D3, `TURRET_SNIPER.id` with a turret builder (attack undefined, speed 0).
  `ActorRenderController` needs no change (it already picks any archetype with a builder and a set).
  → Verify: `sprites.spec` cases: the timeline at the telegraph's start, lock (15 ticks left) and last tick; undefined
  while repositioning and when dead; the choice is `attack` while telegraphing, `move` while strafing, `idle` calm,
  `death` dead.

- [x] **SN5. The vale pack.** Nothing to hand-write: `VALE_SPRITE_LAYOUTS` drives `manifest.ts`. Extend `vale.spec`:
  with no IDs `enemy.sniper` is the placeholder; with `sniper-idle.png` it switches to `sprites`; the rim joins with
  `sniper-idle-outline.png` and never holds the set back; every sniper frame carries its sheet's outline.
  → Verify: `npm run verify` (validator, contrast, `check-asset-ids`, Lune suite); every fixture hash unchanged.

- [x] **SN6. Upload.** `sniper-idle.png` and `sniper-idle-outline.png`; paste both IDs into `assetIds.ts` with the
  upload note. → Verify: `npm run verify`.

- [ ] **SN7. Studio check.** Endless floors with sniper rooms (solo and a 2-player party), the tutorial's turret room
  (D3), PC and the phone emulator:
  - readable on the darkest floor and decor band (rim on, then the `KV_EnemyOutline` switch off to see the cost);
  - drawn size against the hitbox (hitbox debug view on); the feet stay planted on the floor and behind walls;
  - facing follows the aim while strafing and telegraphing; the telegraph reads (pulse + line) though the pose barely
    changes;
  - the glide (D2): try the sway loop and the bob, keep the best;
  - death: puff + fade without a fall animation;
  - fps and texture memory (+2 textures) next to the S5 numbers.
  Record in `docs/SPIKES.md`. → Verify: the owner signs off D2 and D4.

- [x] **SN8. Docs.** `docs/ART.md` (slice table: `enemy.sniper` -> subservient; status), `docs/CLIENT.md` (sprite
  smoke steps), `art/atlases.json` comments, `THIRD_PARTY_NOTICES.md` (SN1), `CLAUDE.md` document table.

## Phase 2 (only if D1 changes): `working` as the calm pose

The thrall kneels at its labour until it notices the player, then stands into the worship stance. Needs:

1. **Per-sheet cells** (contract v2 addition: `SpriteSheetImage.frameW` / `frameH` / `pivot`, defaulting to the
   set's), so `working` gets its own 159x125 sheet (16 facings x 3 frames = one atlas) without inflating the worship
   cells; the validator, `layout.ts` and `SpriteView` (billboard size and offset per sheet) follow.
2. **A `calm` animation** and a `calm` flag on `ActorSpriteInput` (the actor's calm `aiState`), chosen before `idle`.
3. There is no stand-up transition, so the switch pops; it happens on aggro, when the alert is already on screen.

Cost: 2 more textures (~6 MB). Judge after SN7.

## Risks

- **Gliding.** No locomotion frames at all; D2 and SN7. If nothing reads, a different variant (the sprayer turret
  never moves) can take the art and the sniper waits for a pack with a walk.
- **Darkness.** 1.05:1 on the floor: the rim is load-bearing, so the outline switch off makes it nearly invisible.
  Never ship with the outline sheet missing (SN6 uploads both together).
- **The telegraph pose is the idle pose.** The tint pulse and the aim line carry the warning, as they do on the
  placeholder; the sprite only adds the facing.
- **Side note, out of scope:** the full pack also has `skeleton_default_idle` (1 x 16) and `skeleton_default_attack`
  (8 x 16), which could replace the swarmer's walk-frame stand-ins later.
