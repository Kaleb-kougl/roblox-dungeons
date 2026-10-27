# Mother Bramble art: `boss.act1` as a Demon Elite

`boss.act1` (Mother Bramble) is still a placeholder block. This plan draws it as a **Demon Elite** from the
2D Demons - TopDown asset pack v1.1 (docs/DEMON_ART.md has the pack, its licence gap and the shared pipeline work).
Work it task by task, like `PLAN.md`; each task ends with a **Verify**. It is **presentation only**: the fight (`archetypes/boss/
act1.ts`), its states, timings, hitbox and telegraph previews do not change, so `run-boss-1337`, `run-full-1337`, the
TTK spec and every fixture stay bit-identical. Lords of Pain art is untouched (owner, 2026-10-26).

Owner choice (2026-10-26): Mother Bramble wears a Demon Elite. Which of the six is BD1.

## Status (2026-10-26)

**Code-complete, verified headlessly and uploaded; waiting on Studio.** BR2-BR4 and the spec part of BR6
are built: the optional boss animations, the `boss.act1` set (Demon Elite 3, `art/atlases.json` -> `layout.ts`), the
phased renderer timeline with measured frame marks (`SPRITE_ANIM_MARKS.bossAct1`) and the vale pack's switch-over
(`vale.spec`). Verified: typecheck, whole-repo eslint, `check:assets`, `test:art`, build and every Lune spec, in chunks
on the aarch64 VM. The licence is recorded (SmallScaleInt's Standard Commercial License, docs/DEMON_ART.md DD6) and
the 14 sheets were uploaded 2026-10-26 (`assetIds.ts`), so the bundled vale pack draws Mother Bramble as the Elite.
**Nothing has run in Studio.** Open: BR1's look by eye at `art/build/contact/boss.act1.png`, BR5, the Studio part of
BR6, BR7 (`docs/CLIENT.md`), and BD8.
DEMON_ART DA0 (the pack is in `art/vendor/demons-topdown/`) and DA2 are done.

## Where Mother Bramble is seen

Every endless boss floor (5, 10, 15, ...; after docs/BOSS_DEMONLORD.md D5, the floors the seeded pick gives her), the
tutorial's fast boss, and M1's first fight. The art lands in all three; none of their sims change.

## The fight the sprite has to show (act1.ts, unchanged)

r 1.2 (a 2.4-tile body), 540 hp, phases at 66 % / 33 %, faces the player (`faceToward`) while it telegraphs.

| `aiState` | What happens | Length |
|---|---|---|
| DORMANT | on the room centre, immune, waiting | until engaged |
| TRANSITION (`ROAR`) | intro roar, then one per phase change; immune, own bullets cleared | intro 1 s, phases 1.5 s |
| TELEGRAPH | stands still, directions locked (previews drawn) | FAN 36, RING 42, DOUBLE_RING 48, SPIRAL 48, SLAM 54, FAST_FAN 33 ticks |
| ACTIVE | FAN 3 volleys / 12 ticks; FAST_FAN 4 / 8; RING one ring; DOUBLE_RING two, 48 ticks apart; SPIRAL 3 s, a burst every 6 ticks; SLAM a charge (15 u/s, <= 45 ticks), impact (shockwave ring), summons 3 swarmers | per attack |
| RECOVER | standing still and vulnerable: the melee opening | 0.8-1 s (1.2 s after a slam) |
| REPOSITION | walks back to the centre after a slam left it far away | until close |

## What the Elites have (measured 2026-10-26, row 2, separated body + shadow sheets)

All six share the Elite animation layout: Idle, Walk, Run, Taunt, Attack 1-3 (swings), **Attack 4 (a leap that lands
in a dust burst)**, Run Attack, TakeDamage 1, Die 1 / 2, plus Jump (Elite 2) and Point (Elite 4).

| Elite | Look | Union, body + shadow (idle / widest) | Body mean | Fit |
|---|---|---|---|---|
| **3** | dark armoured demon with **thorned bat wings**, white horns; wings spread wide in Taunt | 100x102 / 118x128 | `#56403e` | Thorny, winged silhouette reads as a bramble mother; the largest Elite |
| 1 | bright red horned brute, spiked shoulders, curved blades; arms flung wide in Taunt | 62x75 / 100x126 | `#7f3834` | Most readable (red); the best roar; cheapest idle / walk cells |
| 2 | hulking grey brute with blades; has **Jump** | 85x77 / 126x122 | `#3c2d28` | Heaviest body; very dark |
| 4 | horned, spear and shield; has **Point** | | | Point could cue the aimed fan; the spear reads as melee |
| 5 | bone-pale knight, sword and shield | | | A knight, not a mother |
| 6 | black armour, axe and tower shield | | | The shield hides the body in half the facings |

Baked effects on every Elite attack are magenta-white swipes (close to `enemyBullet` `#ff3fa4`) and Attack 4's white
dust: dropped by the layered source (DEMON_ART DD3). The dust is the slam's impact cue, so BD5 replaces it.

## The mapping (Elite 3)

Every state gets a real animation. Wind-up frames are stretched over the telegraph and the release frames over the
attack, so a swing or landing lands on the tick its bullets appear (DA1-style frame pins in BR1).

| State | Animation slot | Source | How it plays |
|---|---|---|---|
| DORMANT | `idle` | Idle, 4 frames (0, 3, 7, 10) | loop |
| TRANSITION (intro, phases) | `taunt` (optional boss slot; `intro` falls back to it: no separate intro animation) | Taunt, 6 (0, 3, 5, 7, 9, 12) | stretched over the roar's 60 / 90 ticks |
| TELEGRAPH + ACTIVE: FAN, FAST_FAN | `attack` | Attack 1 (horizontal sweep), 6 (0, 2, 4, 5, 6, 8) | wind-up 0-2 over the telegraph; the release (index 3, contact 4, follow-through 5) replays once per volley (12 / 8 ticks) |
| TELEGRAPH + ACTIVE: RING, DOUBLE_RING | `attack.2` | Attack 2 (overhead strike), 6 (same frames) | wind-up 0-2 over the telegraph; release 3-5 on each ring (DOUBLE_RING twice, 48 ticks apart) |
| TELEGRAPH + ACTIVE: SPIRAL | `attack.3` | Attack 3 (a 360 spin), 6 (0-5) | indices 0-1 over the telegraph; indices 2-5 (one revolution) loop at fps 10, one frame per 6-tick burst, for the 3 s |
| TELEGRAPH + ACTIVE: SLAM | `attack.4` | Attack 4 (leap), 8 (0, 2, 3, 4, 5, 6, 8, 10) | crouch 0-2 over the telegraph, take-off 3 and airborne 4-5 over the charge, the landing (index 6) on the impact tick (`V_MARK`), 7 after |
| RECOVER | `idle` | Idle | loop (BD4: Crouch, held, if the opening needs to read as "winded") |
| REPOSITION | `move` | Walk, 8 (0, 2, 4, 5, 7, 9, 11, 12) | loop, scaled by speed |
| hit | `hit` | `cellsOf: idle`, 1 frame (BD3) | the tint shows hits; the boss is hit nonstop during RECOVER |
| death | `death` | Die 1, 8 (0, 2, 4, 5, 6, 8, 11, 14) | held while the corpse fades; the existing boss death fx plays on top. Clipped by the source cell in three facings (BD8) |

### Size and budget (estimate; measured below)

- **Size.** Elite 3's idle body is ~60 px wide (wings in). For the 2.4-tile hitbox that is ~25 px per tile (BD2), so
  its texels draw ~1.5x the knight's (38 px per tile): chunkier pixels on a boss, the price of a 128 px source.
- **Cells.** Per-sheet cells (DEMON_ART DD4) at ~106x112 each (pad 3): 9 x 9 = 81 per 1024 atlas, so each
  8-facing animation of <= 8 frames is one atlas. idle 4 + taunt 6 + attack 6 + attack.2 6 + attack.3 6 + attack.4 8
  + move 8 + death 8 = 52 frames x 8 facings = 416 cells: **~7 atlases + 7 rims = 14 textures (~56 MB)**, the same as
  the Demon Lord's estimate. Without per-sheet cells (one 124x134 cell, 56 per atlas): 8 + 8.
- **Measured (BR3).** The idle body (alpha > 250, facing the camera) is 59x61 px; `bodyTiles` 2.5 (height-based)
  gives **24.4 px per tile**, so it is 2.5 tiles tall and 2.4 wide: the r 1.2 hitbox. Union cell 124x134 (Die 1 and
  Attack 4 reach the 128 source edges), pivot (63, 88) = source (65, 85). Per-sheet cells, one 1024 atlas each:

  | Sheet | Animations | Cell | Pivot | Cells | Size |
  |---|---|---|---|---|---|
  | `bramble-idle` | idle, attack.3 (hit = idle frame 0) | 107x113 | (54, 78) | 80 | 963x1017 |
  | `bramble-move` | move | 102x112 | (52, 79) | 64 | 816x896 |
  | `bramble-taunt` | taunt | 99x106 | (51, 74) | 48 | 594x848 |
  | `bramble-attack1` | attack | 102x112 | (52, 79) | 48 | 612x896 |
  | `bramble-attack2` | attack.2 | 99x118 | (51, 85) | 48 | 594x944 |
  | `bramble-attack4` | attack.4 | 104x126 | (53, 88) | 64 | 832x1008 |
  | `bramble-death` | death | 124x116 | (63, 70) | 64 | 992x928 |

  **7 atlases + 7 rims = 14 textures**, as estimated. Required for the switch-over: idle, move, attack1, death;
  taunt / attack2 / attack4 join when uploaded (absent: the renderer falls back to `attack` / idle).
- **Only on boss floors.** The sheets are assigned when a `boss.act1` actor exists; preload on the floor change (as
  BOSS_DEMONLORD plans for its boss), so room floors pay nothing. Fallbacks, in order: 6 frames for move and death;
  `attack.3` as `cellsOf: attack`; drop `taunt` to the Idle loop.

## Decisions (recommended first)

- **BD1. Elite 3.** The thorned wings make the silhouette; it is the biggest Elite. *Alternatives:* Elite 1 (red,
  most readable, cheaper idle / walk) or Elite 2 (heaviest, Jump for the slam). Owner picks from the BR1 sheet.
- **BD2. Draw the body at the hitbox.** `bodyTiles` so the idle body spans ~2.4 tiles (the 1.2 radius), not the
  knight's density: a boss smaller than its hitbox would hit players with thin air. `resample` judged in Studio
  (Default blurs a 1.5x upscale a little; Pixelated keeps edges but shimmers).
- **BD3. No hit flinch.** The tint carries hits; a flinch restarting on every sword hit in RECOVER would jitter and
  costs a sheet. *Alternative:* TakeDamage 1, 4 frames, only outside RECOVER.
- **BD4. RECOVER = Idle.** The opening is already shown by the boss standing still and the attack ending.
  *Alternative:* Crouch, held, for a clearer "winded" pose (+1 sheet).
- **BD5. The slam's impact cue.** With the baked dust dropped (DD3), the impact is the landing frame plus the existing
  shockwave render hint and `fx.boss.slam` (BOSS_DEMONLORD D6 adds that cue; if it is not in yet, this plan adds it).
  *Alternative:* keep only Attack 4's `Effects/` dust (white, not near the bullet colours) as a second layer.
- **BD6. The name stays "Mother Bramble".** `boss.act1.name` is a theme string; renaming is a one-line pack change if
  the owner wants it.
- **BD7. Shared boss sprite machinery.** The optional boss animations and named attacks / specials are the same work
  as BOSS_DEMONLORD D2 / D6: whichever plan runs first builds it, the other reuses it (that plan's "Bramble stays a
  placeholder" and its out-of-scope line are updated in BR7).

- **BD8. Die 1's clipped wing tips (open, owner).** Elite 3's Die 1 is cut by the 128 cell's bottom edge in rows 1-3
  (output facings 5-7), source frames 5/6-14: a 9-11 px flat edge on the wing tips, held while the corpse fades. Kept
  as specified for now. Options: *keep* it (the corpse fades, the fx plays on top); use a *shorter death held earlier*
  (e.g. Die 1 frames 0-4, before the clip); or *accept* it after the Studio look (BR6). Also measured: Attack 4's peak
  frames touch the source cell's top edge by 1-3 px in rows 1, 3 and 5 (f5 / f6), likely invisible at the boss's size.

## Tasks

- [x] **BR0. Prerequisites.** docs/DEMON_ART.md DA0 (pack in `art/vendor/demons-topdown`, licence recorded) and DA2
  (layers, per-sheet cells). → Verify: those tasks' checks.

- [ ] **BR1. Confirm the assumptions.** Labelled contact sheet (3x, mid-grey) of Elite 3 (and 1, 2): Idle, Walk,
  Taunt, Attack 1-4, Die 1, Crouch, all 8 rows. Pin the frames: each attack's last wind-up frame and its release
  frame, Attack 4's take-off and landing frames; decide whether Attack 3 looped reads as the spiral. Measure the
  per-sheet cells and atlas count. Find how a Studio test reaches a boss floor fast (the tutorial's fast boss, a
  debug seed, or BOSS_DEMONLORD D0's answer).
  → Verify: this doc's mapping and budget updated with the measured numbers; BD1 chosen.

- [x] **BR2. Theme contract (shared with BOSS_DEMONLORD D2).** Optional boss `sprites` animations `attack.2`,
  `attack.3`, `attack.4`, `intro`, `taunt` (absent: the renderer falls back to `attack` / `taunt` / `idle`); the
  required set stays idle, move, attack, hit, death.
  → Verify: `contract.spec` / `validate.spec` cases; every pack validates with zero problems.
  *As built:* `BOSS.optionalAnimations` + `optionalBaseAnimations(slot)` (`theme/contract.ts`). The validator already
  checked every animation a set defines, required or not, so it needed no code change: the specs pin that the five
  are accepted, optional, and checked like any other when present.

- [x] **BR3. The `boss.act1` set in `art/atlases.json`.** Source the Elite's separated sheets with `layers: ["Shadows",
  ""]` (bottom to top), the knight's `rowForFacing` (or BR1's), `noiseAlpha` 2, `pad` 3, `outline: { "widthPx": 2 }`, pivot on
  idle facing-down frame 0, `bodyTiles` from BD2, per-sheet cells, one sheet per animation, the mapping's frames.
  → Verify: two builds byte-identical; `layout.ts` gains `boss.act1` (8 facings, an `outlineFile` per sheet); the
  contact sheet shows the feet on the pivot in every facing; the knight / skeleton / subservient / bruiser outputs are
  byte-identical.
  *As built (2026-10-26):* as specified with `bodyTiles` 2.5, `pivot` `{ measure: idle facing 6 frame 0, bodyAlpha 250,
  bodyMinRgb 0, footBand 6 }` (output facing 6 = source row 2, towards the camera), `"cells": "perSheet"`, the mapping's
  frames, `hit` = `cellsOf: idle`, 1 frame, and seven sheets (idle shares with attack.3; numbers in the budget).
  `art:lock` added exactly the sixteen files the set reads (eight body sheets + their `Shadows/` layers). Two builds
  byte-identical; every older output unchanged. Checked numerically: every frame inside its atlas, a rim on every cell,
  no body pixel in the 3 px pad. **Not yet looked at by eye:** `art/build/contact/boss.act1.png`.

- [x] **BR4. Renderer (`shared/view/sprites.ts`, shared with BOSS_DEMONLORD D6).** `ActorAttack.anim` (a named attack
  animation, falling back to `attack`) and `ActorAttack.special` (`intro` / `taunt`, stretched over the roar's timer);
  choice death > special > attack > hit > move > idle. `bossAct1SpriteInput`: from `aiState`, `attack`, `aiTicks` and
  `v[V_MARK]` (the slam's impact tick) build the phase timeline of the mapping (wind-up over the telegraph, release per
  volley / ring, looped spiral, leap over the charge, landing on impact); `REPOSITION` moves at the boss's speed.
  Add `BOSS_ACT1_ID` to `ACTOR_SPRITE_INPUTS`. Read every timing from act1's exports (`BOSS_TELEGRAPH_TICKS`,
  `FAN_VOLLEY_TICKS`, `DOUBLE_RING_DELAY_TICKS`, `SPIRAL_TICKS`, `SLAM_MAX_TICKS`, the data's intro / transition
  ticks), never a copied number.
  → Verify: `sprites.spec` cases per state: DORMANT idle; intro and phase roars play `taunt` start to end over 60 / 90
  ticks; each attack's last wind-up frame on its last telegraph tick and its release frame on each volley / ring tick;
  the slam's landing frame on the impact tick; RECOVER idle; REPOSITION move; dead -> death. Every timing spec reads
  the act1 exports.
  *As built:* `ActorAttack.anim` / `segment` (`AnimSegment`: fractions of the frames) / `loop`, `ActorSpecial`,
  `ActorSpriteInput.special` / `flinch` (false for the boss, BD3); `bossAct1Attack` / `bossAct1Special` /
  `bossAct1SpriteInput`. The split frames are **placeholders** in `SPRITE_ANIM_MARKS.bossAct1` (`shared/view/config.ts`:
  `fanRelease`, `ringRelease`, `spiralRelease` 3/6, `slamTakeoff` 3/8, `slamLanding` 6/8, `ringReleaseTicks` 12); BR1
  fills them. *Marks measured (2026-10-26):* `fanRelease` 3/6, `ringRelease` 3/6, `spiralRelease` **2/6** (the spin's
  telegraph shows 0-1 and the channel loops 2-5 to the end of `attack.3`), `slamTakeoff` 3/8, `slamLanding` 6/8,
  `ringReleaseTicks` 12; a `sprites.spec` case checks them on the built set (and the loop 2, 3, 4, 5, 2 at fps 10). Intro vs phase roar: the phase (engaging sets phase 1 and starts the intro; `beginTransition` moves to 2 /
  3 first). An attack's LAST burst fires on the tick that enters RECOVER (the third fan volley, the ring, the second
  ring), so that release plays on over RECOVER's first ticks (read from the RECOVER timer and `v[V_LAST]`). The slam's
  airborne part is stretched over an estimate of the charge (distance to the target / step, capped at
  `SLAM_MAX_TICKS`); the landing frame is exact (`V_MARK`). A `sprites.spec` case runs a real fight (seed 1337) and
  checks the wind-up / release frames on every telegraph end and bullet tick.

- [ ] **BR5. Placement and draw order.** `ActorRenderController`: the boss sprite sits under the telegraph previews
  (`render/bossAct1.ts`), the markings and every bullet; the enemy rim stays on; preload the sheets on a boss floor's
  change (and the tutorial's boss room). No change to `TelegraphController`, fx cues or the bots beyond BD5.
  → Verify: a client-side check in Studio (BR6); `npm run verify`.

- [ ] **BR6. Vale pack, upload, Studio.** `vale.spec`: with no ids `boss.act1` is the placeholder; with every required
  sheet it is `sprites`; optional sheets and rims join without holding it back. Upload the sheets + rims; ids in
  `assetIds.ts`. Studio, solo and a 2-player party, PC and the phone emulator, on an endless boss floor and the
  tutorial boss:
  - each attack's wind-up and release line up with the previews and the bullets; the slam lands on the shockwave;
  - roars read (intro, both phase changes); summoned skeletons (the swarmers stay LoP) around the Elite;
  - drawn size against the hitbox debug view (tune `bodyTiles`); 1.5x upscale sharpness, `resample`;
  - bullets and markings stay readable over the large sprite, rim on and off;
  - fps and GraphicsTexture memory on the boss floor against the S5 numbers.
  Record in `docs/SPIKES.md`. → Verify: `npm run verify`; the owner signs off BD1-BD4.
  *Spec part done (2026-10-26):* `vale.spec` "vale enemy.bruiser and boss.act1": as bundled the placeholder (no ids,
  DD6); with idle / move / attack1 / death `sprites`, any of them missing keeps the placeholder; taunt / attack2 /
  attack4 join when uploaded and never hold it back (attack.3 rides on idle's sheet); rims per sheet; per-sheet cells
  copied and drawn. *Upload done 2026-10-26 3:48 PM (k9kbdev):* 7 sheets + 7 outlines in `assetIds.ts`; the bundled
  pack now draws `boss.act1` as sprites with every rim (`vale.spec`). Studio: open.

- [ ] **BR7. Docs.** `docs/ART.md` (slice table: `boss.act1` -> Demon Elite N; budget), `docs/DEMON_ART.md` (Phase 3
  points here), `docs/BOSS_DEMONLORD.md` (D6 and out-of-scope: Bramble has art; the shared machinery, BD7),
  `docs/CLIENT.md` (boss sprite smoke steps), `CLAUDE.md` (document table; decision log: optional boss animations).

## Risks

- **Style mix.** A top-down Elite summoning isometric LoP skeletons, and (with BOSS_DEMONLORD) alternating with the
  isometric Demon Lord. BR6 judges it; the LoP art does not change.
- **Upscale.** 128 px source cells drawn ~1.5x larger than the knight's texels; if it looks soft or blocky, BD2's
  `resample` and a slightly smaller `bodyTiles` (sprite a little inside the hitbox) are the levers.
- **Texture memory on boss floors** (~56 MB, more if BOSS_DEMONLORD's boss shares a floor's preload). Fallbacks in
  the budget section.
- **Timeline drift.** The sprite timeline mirrors act1's state machine; if act1's timings change, BR4's specs (which
  read act1's exports) catch it.
- **Row order** was measured by eye (DEMON_ART DA1, the knight's); a wrong reading would mirror the boss (BR6 checks).
