# Draft reveal (plan)

Status (2026-10-30): **in progress on branch `draft-reveal`** (from `main` @ `3900250`), card art included (owner,
2026-10-30: "do the reveal work on this branch and skin it"). Owner answers (2026-10-30): DRD3 (the look and colours come from the dark
UI sheet the owner supplied: see "Look" below), DRD5 (legendary flips last: yes), DRD8 (no new setting), DRD11 (the
charge is a pitch-up, no riser clip). The sheet is **UI User Interface Pack - Horror** by ToffeeCraft
([itch.io](https://toffeecraft.itch.io/ui-user-interface-pack-horror)), **paid licence** (the owner has the paid
file, 2026-10-30). The sheet is in gitignored `art/vendor/toffeecraft-horror-ui/UiHorror.png` (1024 x 607 RGBA, one
sheet; the rects below are measured on it).

Goal: make the boon draft a moment the player looks forward to on every floor. Today the three cards appear all at
once, already face up, the moment the stage cover fades, and nothing plays when they appear or when a boon is taken.
After this plan the cards **deal in face down and flip one by one**, each flip a little higher in pitch; a **rare**
card lands with a chime and a shine; a **legendary** card gets a **beat of anticipation** (the other cards dim, the
music dips, its back trembles and glows), then a hush, then a fast flip into a **flare** (a flash, a burst of rays, a
pop and a sting), and it keeps a slow halo of rays while the draft is open. Taking a boon **stamps** the card with a
sound.

**Presentation and client input only:** no sim, dungeon, lockstep, hash, replay or fixture change. The offers, their
rarities, the selection and the confirm rule (`DRAFT_MIN_OPEN_TICKS`) are untouched. The client holds back the
confirm button while its own reveal plays (like the stage cover's `coverGate`), so the sim simply sees the press later.
Theme additions: five port audio IDs (SILENT in the placeholder), three colour roles (`boon.common` / `.rare` /
`.legendary`), optional port ui images cut from the dark UI sheet (9-sliced: the ui image contract gains an optional
`slice`). No new setting (DRD8), no new strings.

## What already exists (and is reused)

| Piece | Today | Where |
|---|---|---|
| Offers | `drawBoonOffers`: per card one rarity roll (Common 70 / Rare 25 / Legendary 5 %, legendary +1 point per floor cleared after the first, at most 15 %), then a boon of that rarity among the unowned, not yet offered ones (none left: any remaining boon). With 3 or fewer unowned boons left, all of them, no rng. 1 to 3 cards | shared/sim/progression/progression.ts, progressionData.ts |
| Boon rarities | 7 Common, 3 Rare (Sharpened, Hearty, Warding), **2 Legendary (Ember Wake, Composure)** | progressionData.ts `BOONS` |
| Draft lifecycle | Opens for every present player on each endless floor change (`openDraft`), world frozen until every open draft is closed; the stick picks the column; a FIRE press edge after `DRAFT_MIN_OPEN_TICKS` (30 = 0.5 s) confirms; `draftOpened` / `draftChosen` run events | progression.ts `stepDraft` |
| Stage cover | A floor change shows the floor card (`minCardSec` 0.6), then fades (`fadeSec` 0.25) to the new floor **with the draft already open**. Input is neutral under the cover and through the fade (`coverGate`, a `CoopMenuInputGate`) | client StageController, SimController, shared/view stageLoader.ts |
| Overlay | `DraftOverlay`: title, three `DraftCard`s (name in the rarity colour, rarity name, effect), the selected card at 1.06x with a `uiAccent` stroke, the hint (`hud.draft.wait` until `draftReady`), co-op "waiting for N". Re-rendered from the snapshot every frame while a draft is open | client/ui/hud/DraftOverlay.tsx, shared/play/snapshot.ts |
| Rarity colours | `RARITY_COLOR_ROLES` = common `rarity.normal` (#e8e6e3), rare `rarity.rare` (#ffe066, yellow), legendary `rarity.unique` (#c7864b, bronze). Also the owned-boon icons (RunItems) | shared/view/hud/progression.ts |
| Touch | A tapped card queues a pick (`InputController.queueDraftPick`: its column, then the confirm) | client HudController, shared/play/touch/draft.ts |
| Sounds | **None** on draft open, flip or pick (only the boon toast shows). `sfx.ui.confirm` / `sfx.ui.move` exist for menus | shared/view/audio/cues.ts |
| Juice tools | Per-frame React bindings written by a controller (`ROOM_CLEAR_UI`, `COMBO_UI`), UIScale pops in fixed slots, swept UIGradient shine (ComboRow), `MusicDuck` (jingles dip the music), `AudioController.play(id, scale, speed)` | client/ui/hud, client/controllers/audio |

Three facts shape the design:

1. **The draft opens under the stage cover.** By the time the cards can be seen, `draftTicks` is usually past the
   0.5 s confirm guard, so the sim's guard cannot protect the reveal. The reveal starts when the cover starts to fade,
   and the client masks FIRE until its reveal has settled (DRD2). A press during the reveal skips it instead (DRD6).
2. **Legendary is rare and runs out.** Only 2 of 12 boons are legendary and an owned boon is never offered again. A
   floor 1 draft shows one with about 14 % odds (1 - 0.95^3), rising to about 39 % per draft at the 15 % cap; a
   player sees a legendary card perhaps one to three times a run. That rarity is what pays for a ~1 s beat, and why
   the beat must **never** play for a card that is not legendary (no fake-outs, DRD4).
3. **The rare colour outshines the legendary one.** Rare is a bright yellow and legendary a muted bronze, so the
   flare would land on the dullest colour. The new look (DRD3) gives the ladder bone, blood red, candle gold.

## Look (the dark UI sheet, DRD3)

Source: **UI User Interface Pack - Horror**, ToffeeCraft (itch.io, name your own price; "a 32x32 pixel horror UI
pack": skulls, candles, bones, eyes, potions). Two downloads: `FreeHorrorUi.png.zip` (12 kB, free) and
`UiHorror.png.zip` (133 kB, at $1.80 or more). Licence as the store page states it (recorded 2026-10-30): **Free
License** "For personal use. - It can be used and edit freely. - Not redistribute or resell this assets. - It can be
used for game development and other productions."; **Paid License** "For commercial or personal use." with the same
other terms. No attribution required. A published Roblox experience is not personal use, so the build uses the paid
file; the raw files stay in gitignored `art/vendor/` and only the cropped, uploaded images ship, the same rule as Lords
of Pain and the Demons pack. The owner holds the paid tier (2026-10-30), which settles which licence applies.

The cards take the sheet's style: charcoal panels (#1c1c1c - #232323) with dried-blood trim (#340c0c / #410505),
round corner studs, bone-white skulls (#d7d0c0) and the one warm light in the sheet, the candle flame (#f1bd44). The
ladder climbs in ornament as well as colour, so rarity never rests on colour alone:

| Card | Sheet piece (preview sheet, x y w h) | Drawn as | Colour role (contrast on `uiPanel`) |
|---|---|---|---|
| **Back** (every card, DRD4) | The skull-and-chain landscape panel, two silver skulls on top (`UiHorror.png` 897 241 93 47) | `ui.draft.back` | - |
| **Common** face | The plain rounded landscape panel (834 290 91 46) | `ui.draft.card.common` | `boon.common` bone #d7d0c0 (11.0:1) |
| **Rare** face | The studded panel with the red trim and the top tab (931 369 88 61) | `ui.draft.card.rare` | `boon.rare` blood red #f46669 (5.6:1; the hearts' highlight) |
| **Legendary** face | The rare panel plus the **red-eyed black skulls** on its two top corners (cut from the menu panel at 290 194 91 119, about 16 x 14 each) | `ui.draft.card.rare` + `ui.draft.skull.left` / `.right` | `boon.legendary` candle gold #f1bd44 (9.8:1) |
| Charge tell | The back's two skull sockets light up red: a white mask of the back's socket pixels, derived by `art:build`, tinted the red-eyed skulls' red | `ui.draft.back.eyes` | the skulls' red (a draw constant) |
| Flare, halo, rays | Code-drawn rays and flash in candle gold over white | - | `boon.legendary` |

- **Scale:** the panels are 9-sliced to the card's 240 x 150 (the art's corners and studs keep their size) at
  `SliceScale` 2 (one art pixel = 2 reference pixels), `ResampleMode` Pixelated. The ui image contract gains an
  optional `slice` (`{ left, top, right, bottom }` insets in art pixels, ui.* only), carried through
  `art/atlases.json` `images` (`"slice": [l, t, r, b]`) and `VALE_IMAGE_LAYOUTS` like `pivot`.
- **Flat centres:** a stretched centre would smear the panels' noise texture into blocks, so the pipeline's
  `"centre": "flat"` fills each sliced image's centre with its rounded mean colour.
- **Shared with docs/UI_ART.md** (the whole-UI reskin from the same sheet, planned on `main`): the `slice` field, the
  flat centre and the `SlicedImage` primitive are the ones that plan builds on (its UAD1 pixel snapping and its
  `ui-atlas.png` packing come later and replace this branch's per-image files without changing the ids).
- **Text** stays `HUD_FONT`: the name in the rarity colour, the rarity name, the effect in `uiText`. The sheet's
  pixel font is Later.
- **Fallback:** every `ui.draft.*` id is an optional port id. The placeholder pack (and vale until uploaded) draws
  today's flat card with the new colour roles as its stroke; a missing `.legendary` skull just leaves the corners plain.
- **Owned-boon icons** (RunItems) and the card names use the three new roles (`RARITY_COLOR_ROLES` points at them). The
  loot `rarity.*` roles are untouched.
- The rects above are the pieces' alpha bounding boxes in `UiHorror.png`; DR3 pins the skulls' exact rects and every
  `slice` inset.

## Player experience (target)

### The deal and the flips (no legendary)

Times from the moment the stage cover starts to fade (`t = 0`). Three cards; one or two cards follow the same rules.

| t (s) | What happens |
|---|---|
| 0 | The title fades in (0.15 s). Three card **backs** (the skull-and-chain panel) rise 24 px into their slots and fade in, 0.05 s apart (0.18 s each). All backs look the same |
| 0.35 | Card 1 **flips** (0.20 s): its width squashes to 0 over 0.10 s, the face swaps in, and it springs back to full width over 0.10 s (overshoot 1.04 -> 1). `sfx.draft.flip` at the squash start. The name, rarity and effect fade in over 0.08 s as it lands (no text is drawn while the card is thin) |
| 0.57 | Card 2 flips, `sfx.draft.flip` +2 semitones |
| 0.79 | Card 3 flips, +4 semitones |
| 1.07 | **Settled**: the selection highlight appears on the card under the stick, the hint switches from "wait" to the key hint, and the confirm is let through |

A **common** card is a plain flip onto the plain panel. A **rare** card flips onto the red-trimmed panel, plays
`sfx.draft.rare` (a chime) on landing, its trim flares to full brightness in blood red for 0.3 s, and a white shine
sweeps across it once (0.35 s, the ComboRow UIGradient technique).

### The legendary beat

Legendary cards flip **last**, whatever their column (DRD5): the other cards flip first in left-to-right order, then
the beat. The flip order is presentation only; columns and the selection are the sim's.

| t (s) after the last other card landed | What happens |
|---|---|
| 0 | **Charge** (0.70 s): the other cards dim to 50 %; the legendary back's two **skulls' eyes light up red** and its edge glows up from nothing to full candle gold; the back trembles (0 -> 2 px, about 30 Hz); faint gold rays start to turn behind it; the music dips to `AUDIO_VIEW.duck.level` (`MusicDuck`); `sfx.draft.charge` **pitches up** (DRD11): 6 hits, closing in from 0.16 s to 0.07 s apart, climbing +0 -> +12 semitones, the last one just before the hush |
| 0.70 | **Hush** (0.12 s): the tremble stops, the charge sound has ended, nothing moves. This is the beat |
| 0.82 | A fast flip (0.14 s), no flip sound |
| 0.96 | **Flare**: the face lands with its red-eyed skulls; a white-gold flash over the card (opacity 0.8 -> 0 over 0.12 s, card area only), a ring of gold rays bursts out (scale 0.6 -> 1.4, fading over 0.5 s), the card pops (1.25x -> 1x, ease out back, 0.25 s), the other cards undim (0.2 s), `sfx.draft.legendary` (a jingle: it ducks the music for its length) |
| 1.21 | **Settled** (the pop has landed). The legendary card keeps a **halo**: gold rays turning slowly behind it (0.1 rev/s, 35 % opacity) and its edge glow pulsing gently (1 Hz), like a candle, for as long as the draft is open |

A whole draft with a legendary takes about 2.0 s instead of 1.1 s. **Two legendaries** in one draft share one beat:
both charge together and flip together into one flare (one sting).

### Skipping

A confirm press (FIRE, or a tap on touch) **during** the reveal skips it: every card still face down flips at once
(0.12 s, one flip sound). A legendary still gets its flash, burst, pop, sting and halo, but no charge or hush: you skip
the wait, not the reward. The skipping press is held back until it is released (DRD6), so a held or mashed attack
never picks a card the player has not seen. A pick needs a fresh press after the cards are settled.

### Taking a boon

On the confirm frame (the local player's `draftChosen`): the chosen card **stamps** (1.0x -> 1.12x -> 1.0x over 0.15
s, a white flash at 0.5 opacity), the other cards drop 16 px and fade (0.2 s), `sfx.draft.pick` plays, and the overlay
fades out over 0.25 s after the stamp (it stays mounted from the controller's copy of the offers: the snapshot's draft
is already closed). In co-op, the "waiting for N teammates" line takes its place. The boon toast is unchanged.

### Rules

- **Every draft**: endless runs and the tutorial's floor 2 draft (its first impression; the tutorial prompt is
  unchanged). The finished tutorial's floor 3 draft is never shown, as today.
- **Local only.** Each client reveals its own offers; a teammate's draft is never shown. Co-op: the party waits for
  everyone's reveal plus pick; the world was already frozen for the slowest picker, so a reveal adds at most ~1 s, or
  ~2 s with a legendary, to that wait (and a skip removes it).
- **Start**: the first frame the local draft is open and the stage cover is fading or gone (`StagePhase` `revealing`
  or `done`). A draft opened with no cover at all (debug floor skip without a card) starts at once.
- **Selection during the reveal**: the stick still moves the sim's `draftSelected` (harmless); the highlight and the
  1.06x scale are drawn only once settled.
- **Touch**: a tap during the reveal is a skip and its queued pick is dropped (`queueDraftPick` asks the reveal first).
- **Reduced motion**: no rise, tremble, pop, burst, ray rotation or drop; a flip becomes a 0.12 s crossfade from back to
  face; the legendary flash is replaced by its edge glow going to full brightness; the charge keeps its timing, the
  skulls' eyes, glow, dim, music dip and sound (the beat is timing, not motion). Every sound stays.
- **Photosensitivity**: one flash per legendary, on the card only (never full screen), at most 0.8 opacity; the halo
  pulse is 1 Hz.
- **Pause**: a solo pause during the reveal freezes it (the reveal steps on unpaused frames). Leave run / restart drop it.
- **Fewer than three cards**: the same timings over the cards there are (two sit left and right, one in the centre).

## Design (summary)

| Piece | Where | Step |
|---|---|---|
| `DRAFT_REVEAL` (deal, flip, interval, text fade, rare chime / shine, charge, charge ladder (hits, first / last gap, top semitones), hush, fast flip, flash, burst, pop, halo, skip flip, stamp, exit; flip semitone step 2; dim 0.5; tremble px / Hz; eye red) and the reduced-motion values | shared/view/hud/draftRevealConfig.ts | DR1 |
| `revealOrder(rarities)` (non-legendary left to right, then legendaries); `DraftReveal`: `begin(rarities, reducedMotion)`, `skip()`, `pick(index)`, `step(dt)` -> a reused `DraftRevealFrame` (per card: `face` 0/1, `width`, `rise`, `alpha`, `textAlpha`, `dim`, `tremble`, `glow`, `flash`, `burst`, `pop`, `shine`, `halo`; overall: `settled`, `leaving`, `done`, and this frame's cues `{ id, speed }` and duck request) | shared/view/hud/draftReveal.ts | DR1 |
| `DraftRevealGate` (masks FIRE while the reveal is not settled; a FIRE press edge then is a skip; held until released, like `CoopMenuInputGate`) | shared/play/draftGate.ts | DR2 |
| Colour roles `BOON_RARITY_ROLES` (`boon.common` / `.rare` / `.legendary`, required, placeholder = vale = the sheet's values) + a validator rule (>= 3:1 on `uiPanel`, >= 25 CIE76 step to step); `RARITY_COLOR_ROLES` points at them | shared/theme contract / validate / packs, shared/view/hud/progression.ts | DR3 |
| Ui image `slice` (contract, types, validator: inside the image), optional port ids `ui.draft.back`, `.back.eyes`, `.card.common`, `.card.rare`, `.skull.left`, `.skull.right`; `art/atlases.json` `images` crops from `toffeecraft-horror-ui/` with `slice`, the eyes mask derived in `scripts/art`; `VALE_IMAGE_LAYOUTS` gains `slice` | shared/theme, art/atlases.json, scripts/art, packs/vale | DR3 |
| Port audio IDs `sfx.draft.flip` / `.rare` / `.charge` / `.legendary` / `.pick` in `PORT_AUDIO_EVENTS` (SILENT in the placeholder); `SFX` entries, priorities, `sfx.draft.legendary` in `DUCKING_SFX` and category `jingle`; `art/audio.json` entries | shared/theme contract, packs, shared/view/audio/cues.ts | DR4 |
| `DRAFT_UI` bindings (per card slot, plus overlay alpha); `DraftCard` gains a back face, the sliced panel per rarity (or the flat fallback), the legendary skulls, the eyes overlay, a flip holder (width from a binding, AnchorPoint centre, text hidden while `width` < 0.9), a glow stroke, a flash frame, a ray ring (behind the card, outside the layout) and a shine gradient; a `SlicedImage` primitive (theme image + `slice` -> ImageLabel `ScaleType.Slice`, `SliceCenter`, `SliceScale`, Pixelated); the overlay hides the selection until settled and stays mounted while `leaving` | client/ui/hud/DraftOverlay.tsx, DraftRays.tsx, primitives | DR5 |
| `DraftRevealController`: per frame, reads the local draft (`run.players[local]`), the stage phase and pause, begins / steps / skips / picks the reveal, writes `DRAFT_UI`, plays cues (`AudioController.play`), requests the music dip (a new `AudioController.duckFor(seconds)` on `MusicDuck`); exposes `blocksConfirm()` for SimController (solo and co-op input paths, after `coverGate`) and InputController (`queueDraftPick`) | client/controllers/fx/DraftRevealController.ts, SimController, InputController, AudioController | DR6 |
| `KV_DraftRevealDebug` (Workspace string attribute, e.g. `c,r,l`, `l,l`): the next draft's reveal uses these rarities (display only: the faces stay the real boons); off by default | client controller, `shared/config` debug flags | DR6 |

### Not changed

- **The sim**: offers, rarity odds, boon pool, selection, confirm rule, `DRAFT_MIN_OPEN_TICKS`, the frozen world, co-op
  waiting. No hashed field, run event or replay changes; the sim only sees the confirm press later.
- **The stage cover** timings and its own input gate.
- **Card layout**: same size (240 x 150), same text rows; the rays and flash draw outside the layout and never move a card.
- **The boon toast** and the owned-items panel (apart from DRD3's colours).
- **The loot `rarity.*` roles** (`RARITY_COLOR_ROLES` stops using them; nothing else changes).

## Tasks

Each step is a commit. Specs next to the code; `npm run verify` before each.

- [x] **DR0. Owner decisions.** Answered 2026-10-30: DRD3 (the dark UI sheet's look), DRD5 (legendary last), DRD8
  (no setting), DRD11 (the charge pitches up).
- [x] **DR0b. The pack.** ToffeeCraft, "UI User Interface Pack - Horror", paid tier (owner, 2026-10-30); the sheet is
  `art/vendor/toffeecraft-horror-ui/UiHorror.png`; row in `docs/ART.md`'s packs table.
- [ ] **DR1. Reveal core.** `draftRevealConfig.ts`, `draftReveal.ts` + spec: `revealOrder` (`[c,l,r]` -> 0, 2, 1;
  `[l,l,c]` -> 2, then 0 and 1 together); timelines for 3 commons (settled at 1.07 s, flip cues at +0 / +2 / +4
  semitones), a rare (chime on landing, shine), a legendary in the left column (charge -> hush -> flare, settled at
  ~2.0 s, the duck request, the six charge cues closing in and climbing to +12 semitones, none in the hush, the halo
  after), two legendaries (one beat, one sting), 1 and 2 cards; skip before the
  first flip, mid-flip and mid-charge (no charge cue after the skip, the flare and sting still once); pick (stamp,
  leaving, done); reduced motion (crossfade, no tremble / pop / burst, same cue times); `step` with dt 0 and a huge dt
  (clamped, every cue still fires once, in order).
- [ ] **DR2. Input gate.** `DraftRevealGate` + spec: FIRE masked until settled; a press edge during the reveal ->
  one skip; the held press stays masked after settle until released; other buttons and the stick pass; a press after
  settle passes on its first frame.
- [ ] **DR3. Colours and card art.** A `THIRD_PARTY_NOTICES.md` entry for the pack (author, source, the file used,
  what it is used for, the licence wording above, raw files gitignored). The three `boon.*` roles (contract, placeholder, validator rule + spec);
  `RARITY_COLOR_ROLES` -> them. The ui image `slice` field (contract, types, validator, `VALE_IMAGE_LAYOUTS`), the six
  optional `ui.draft.*` ids, the `art/atlases.json` crops with `slice`, the eyes mask (`scripts/art`, node:test spec:
  only the back's socket pixels, white on transparent, same size as the back), `npm run art:build`; vale specs (each
  id falls back until it has an asset id).
- [ ] **DR4. Audio.** The five IDs (contract, placeholder SILENT, vale), `SFX`, priorities (pick 60, flip 50, rare
  55, charge 62, legendary 72: above everything else that can play over a frozen draft), min intervals (flip 0.05),
  `DUCKING_SFX`; mapper / contract / vale specs. `art/audio.json` entries with the DRD11 candidates (`confirmed:
  false`); lock / build / upload are DR9. Note: `contract.luau` sits at Luau's 200-locals limit; the IDs join the
  existing `PORT_AUDIO_EVENTS` array (no new top-level constant).
- [ ] **DR5. Overlay.** `DRAFT_UI`, `SlicedImage`, the card back and faces (sliced art or the flat fallback), the
  skulls and eyes, flip holder, glow, flash, rays, shine, selection-after-settle, the leaving fade. Touch and HUD scale
  70 % lay out as today.
- [ ] **DR6. Controller and gate wiring.** `DraftRevealController`, `blocksConfirm()` in both SimController input
  paths and `queueDraftPick`, `AudioController.duckFor`, the debug attribute; `npm run build:place` still builds.
- [ ] **DR7. Bot check.** The headless tutorial / endless / party bots drive the sim directly and are unaffected; add a
  spec that the gate never masks anything once settled, so a bot-like client cannot stall.
- [ ] **DR8. Docs.** This doc's status and as-built notes, docs/CLIENT.md, the CLAUDE.md decision log.
- [ ] **DR9. [owner] Studio check, art and sounds.** The check below. On the Mac, after DR0b: `npm run art:build`,
  upload the six `art/upload/ui-draft-*.png`; `npm run audio:audition` (pick the candidates), `audio:lock`,
  `audio:build`, upload the five `sfx-draft-*.ogg`; ids into `packs/vale/assetIds.ts`, `npm run verify`. Tune
  `DRAFT_REVEAL` by eye and ear with `KV_DraftRevealDebug`.

## Studio check

1. Solo, endless floor 1 -> 2: the floor card, then the backs rise as the cover fades and flip one by one with a
   climbing click; mashing attack through the floor card picks nothing; one press during the flips skips; the hint
   reads "wait" until settled.
2. `KV_DraftRevealDebug = "c,l,r"`: the left and right cards flip, then the centre one charges (others dim, music
   dips, tremble, glow), the hush, the flare and sting; the halo keeps turning; pick it: the stamp and the pick sound.
3. `"l,l"` with two cards; `"r"` with one; skip during the charge.
4. Co-op (two clients): each reveals its own cards; the first to pick sees "waiting for 1 teammate"; a skip on one
   client does not touch the other.
5. Touch: a tap during the flips skips and does not pick; a tap after settle picks. Gamepad: RT the same.
6. Reduced motion on: crossfades, no tremble or burst, same timing and sounds. HUD scale 70 %.
7. The tutorial's floor 2 draft with its prompt.
8. Studio assumptions to check first (none can be checked headlessly): the width-squash flip looks like a flip (not a
   wipe) at 0.10 s per half; Frame `Rotation` on the ray holder rotates its children and the rays are not clipped by
   the overlay panel; the UIGradient shine on a Frame; 9-sliced pixel art at `SliceScale` 2 under a non-integer HUD
   UIScale (studs and trim stay crisp, no seams at the slice lines); the width-squash flip on a sliced ImageLabel (the
   corners squash with it or keep their size: either may look right); the music dip and the jingle duck stacking without a pump; the
   ~2 s legendary reveal not feeling slow by the third run (if it does: shorten the charge, never drop the hush).

## Decisions

DRD3, DRD5, DRD8 and DRD11 are the owner's answers (2026-10-30); the rest are proposed.

- **DRD1. Presentation and client input only.** Nothing in the sim knows the reveal exists.
- **DRD2. The client holds the confirm, not the sim.** Raising `DRAFT_MIN_OPEN_TICKS` would change every endless and
  tutorial replay, could not see the stage cover, and would make a co-op teammate's skip wait for the slowest
  machine. A client gate (like `coverGate`) is per player and free. *Alternative:* a sim guard; rejected.
- **DRD3. The dark UI sheet's look** (owner, 2026-10-30: "use this style"). Cards are the sheet's panels, 9-sliced;
  the ladder climbs in ornament (plain panel, red-trimmed studded panel, the same with red-eyed skulls) and colour
  (bone #d7d0c0, blood red #f46669, candle gold #f1bd44), so legendary is the brightest colour on the card and the
  flare lands on gold, the sheet's only warm light. Three new roles rather than reusing the loot `rarity.*` ones (whose
  rare is yellow); they colour the owned-boon icons too. The pack is ToffeeCraft's Horror UI pack, paid licence
(DR0b).
- **DRD4. No fake-outs.** Every back looks the same and the charge plays only for a legendary card, so the beat is a
  promise the game always keeps. No "almost legendary" teases.
- **DRD5. Legendary flips last, whatever its column** (owner, 2026-10-30). Saves the best for last and puts the beat
  after the player has seen what else is on offer.
- **DRD6. A press skips, then must be released.** Repeat players are never slowed; a skip keeps the legendary's flare
  and sting (the reward) and drops only the wait.
- **DRD7. Two legendaries share one beat.** Two charges in a row would double the wait for the same news.
- **DRD8. No setting** (owner, 2026-10-30). Skip covers impatience, reduced motion covers motion, the SFX volume covers sound. Same call as
  Combo CD11.
- **DRD9. Rare gets a small reward** (chime, stroke flare, one shine), so the ladder has three steps, not two.
- **DRD10. A pick sound and stamp.** Taking a boon plays nothing today; the stamp closes the loop the reveal opens.
- **DRD11. Sounds; the charge pitches up** (owner, 2026-10-30). The pack has no riser, so the charge is built from
  one short hit played as a rising ladder (6 hits closing in, +0 -> +12 semitones, the combo's per-cue speed; the
  ladder lives in `DraftReveal`, so it is specced headlessly). Candidates from the unused Ninja Adventure clips (CC0),
  picked at the audition: charge `Menu/Move7.wav`, `Menu/Menu5.wav` or `Alert/Alert4.wav`; flip `Menu/Move6.wav` /
  `Move8.wav` (a light card snap; variants, played at the flip ladder's pitch); rare `Magic & Skill/Magic5.wav` or
  `Heal3.wav`; legendary `Jingles/Secret3.wav` or `Secret4.wav` (category jingle); pick `Menu/Accept2.wav` /
  `Accept3.wav` / `Accept5.wav`.
- **DRD12. Card art from the sheet, effects in code.** The panels, skulls and the eyes mask are images; the rays,
  flash, glow and shine are drawn in code in the role colours (no new effect art).

## Later (not in this plan)

- The chosen card **flies** to its icon in the owned-items panel and the icon pops.
- Boon icons on the faces; the sheet's pixel font for the card names.
- A legendary **reroll-proof pity** or odds changes: sim changes (scores and replays change).
- A per-rarity music sting layer once the music has stems.
